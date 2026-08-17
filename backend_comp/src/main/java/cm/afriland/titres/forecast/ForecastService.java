package cm.afriland.titres.forecast;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessageCreateParams;

import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.error.ApiException;

/**
 * Estimation indicative de taux/prix pour une emission, a partir de
 * l'historique des emissions comparables (meme nature de titre, meme pays
 * emetteur). Les BTA/OTA etant attribues par adjudication (encheres) et non
 * par cotation de marche continue, cette estimation est une tendance, jamais
 * un engagement chiffre garanti — le commentaire genere le rappelle explicitement.
 */
@Service
public class ForecastService {

    private static final Logger log = LoggerFactory.getLogger(ForecastService.class);

    /** En dessous de ce nombre de points, une tendance n'a pas de sens a degager. */
    private static final int MIN_HISTORICAL_POINTS = 2;
    private static final int MAX_HISTORICAL_POINTS = 8;

    private static final String SYSTEM_PROMPT = """
            Tu es un analyste qui aide les investisseurs a se positionner sur les emissions \
            de titres publics de la zone CEMAC (Bons du Tresor Assimilables - BTA - et \
            Obligations du Tresor Assimilables - OTA) proposees par Afriland First Bond.

            A partir de l'historique fourni (emissions comparables passees, meme nature de \
            titre et meme pays emetteur), degage la tendance et propose une estimation \
            indicative pour la prochaine emission comparable.

            Consignes :
            - Les BTA/OTA sont attribues par adjudication (mecanisme d'encheres), pas par \
            cotation de marche continue : ton estimation est une tendance indicative, jamais \
            un engagement chiffre garanti.
            - Le mode d'adjudication de l'emission determine ce que represente le chiffre \
            fourni pour chaque point d'historique : en mode TAUX, il s'agit du taux \
            d'adjudication (ce que les investisseurs proposent) — ton estimation porte alors \
            sur le taux a proposer. En mode PRIX (OTA), il s'agit du taux facial (coupon) fixe \
            a l'emission, PAS d'un prix de soumission : precise explicitement dans le \
            commentaire que cette tendance reflete l'environnement de coupon observe, et non \
            une recommandation de prix a soumettre.
            - Fonde ton estimation uniquement sur les donnees fournies, sans supposer de \
            facteurs macroeconomiques non mentionnes.
            - Sois concis et concret dans le commentaire.
            """;

    private final JdbcTemplate jdbc;
    private final AppProperties props;
    private volatile AnthropicClient client;

    public ForecastService(JdbcTemplate jdbc, AppProperties props) {
        this.jdbc = jdbc;
        this.props = props;
    }

    public ForecastResponse forecast(UUID emissionId) {
        record EmissionRef(String nature, String paysCode, String modeAdjudication) {
        }
        EmissionRef ref = jdbc.query(
                        "SELECT nature, pays_code, mode_adjudication FROM emissions WHERE id = ?",
                        (rs, n) -> new EmissionRef(rs.getString("nature"), rs.getString("pays_code"),
                                rs.getString("mode_adjudication")),
                        emissionId)
                .stream().findFirst()
                .orElseThrow(() -> ApiException.notFound("Émission introuvable."));

        List<HistoricalPoint> historique = jdbc.query(
                "SELECT code, date_emission, taux_nominal FROM emissions "
                        + "WHERE nature = ? AND pays_code = ? AND id != ? "
                        + "AND status IN ('CLOTURE','ARCHIVE','PUBLIE') "
                        + "ORDER BY date_emission DESC LIMIT ?",
                (rs, n) -> new HistoricalPoint(rs.getString("code"),
                        rs.getObject("date_emission", LocalDate.class), rs.getDouble("taux_nominal")),
                ref.nature(), ref.paysCode(), emissionId, MAX_HISTORICAL_POINTS);
        Collections.reverse(historique); // ordre chronologique pour le graphique

        if (historique.size() < MIN_HISTORICAL_POINTS) {
            return ForecastResponse.indisponible(historique,
                    "Pas assez d'émissions comparables passées pour dégager une tendance.");
        }

        try {
            ForecastAi ai = callClaude(ref.nature(), ref.paysCode(), ref.modeAdjudication(), historique);
            return ForecastResponse.avecProjection(historique, ai);
        } catch (AnthropicServiceException e) {
            log.error("Prevision IA en echec : {}", e.getMessage(), e);
            return ForecastResponse.indisponible(historique, "Estimation momentanément indisponible.");
        }
    }

    private ForecastAi callClaude(String nature, String paysCode, String modeAdjudication,
                                  List<HistoricalPoint> historique) {
        AnthropicClient anthropic = client();

        StructuredMessageCreateParams<ForecastAi> params = MessageCreateParams.builder()
                .model("claude-sonnet-5")
                .maxTokens(2048L)
                .system(SYSTEM_PROMPT)
                .outputConfig(ForecastAi.class)
                .addUserMessage(buildPrompt(nature, paysCode, modeAdjudication, historique))
                .build();

        List<ForecastAi> results = new ArrayList<>();
        anthropic.messages().create(params).content().stream()
                .flatMap(cb -> cb.text().stream())
                .forEach(typed -> results.add(typed.text()));

        if (results.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_GATEWAY, "FORECAST_ERROR", "Réponse IA vide.");
        }
        return results.get(0);
    }

    private String buildPrompt(String nature, String paysCode, String modeAdjudication,
                               List<HistoricalPoint> historique) {
        StringBuilder sb = new StringBuilder();
        sb.append("Historique des emissions ").append(nature).append(" (pays ").append(paysCode)
                .append(", mode d'adjudication ").append(modeAdjudication)
                .append("), de la plus ancienne a la plus recente :\n");
        for (HistoricalPoint p : historique) {
            sb.append("- ").append(p.dateEmission()).append(" (").append(p.code()).append(") : ")
                    .append(p.tauxNominal()).append(" %\n");
        }
        sb.append("\nDegage la tendance et propose une estimation pour la prochaine emission comparable.");
        return sb.toString();
    }

    private AnthropicClient client() {
        AnthropicClient current = client;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (client == null) {
                String apiKey = props.getAnthropicApiKey();
                if (apiKey == null) {
                    throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "FORECAST_NOT_CONFIGURED",
                            "La prévision n'est pas configurée (clé API Claude absente).");
                }
                client = AnthropicOkHttpClient.builder().apiKey(apiKey).build();
            }
            return client;
        }
    }
}
