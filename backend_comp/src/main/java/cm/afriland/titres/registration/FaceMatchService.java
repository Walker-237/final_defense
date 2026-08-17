package cm.afriland.titres.registration;

import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.errors.AnthropicException;
import com.anthropic.models.messages.Base64ImageSource;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.ImageBlockParam;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.MessageParam;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.TextBlockParam;

import cm.afriland.titres.config.AppProperties;

/**
 * Compare le visage capture en direct a l'ouverture de compte (selfie, avec
 * controle de vivacite) au visage imprime sur la piece d'identite deposee, via
 * la vision de Claude (Anthropic) — c'est ce score qui constitue le "taux de
 * fiabilite" affiche au back-office (Fonctionnalite 4/5 de l'addendum).
 *
 * <p>Meme principe que {@link IdAuthenticityService} : indicatif, jamais
 * bloquant. Le verdict n'est expose qu'a l'agent back-office lors de la
 * verification du dossier ; une indisponibilite de l'IA degrade silencieusement
 * vers {@code INDETERMINE} plutot que de faire echouer le depot.</p>
 */
@Service
public class FaceMatchService {

    private static final Logger log = LoggerFactory.getLogger(FaceMatchService.class);

    private static final String SYSTEM_PROMPT = """
            Tu compares deux photos de visage prises dans le cadre d'une ouverture de compte-titres \
            en ligne :
            1. Un "selfie" captured en direct par la camera du prospect, avec controle de vivacite \
            (clignement des yeux) deja valide separement.
            2. Une photo extraite de la piece d'identite (CNI, passeport ou carte de sejour) \
            deposee par ce meme prospect.

            Determine si les deux photos montrent la meme personne, en comparant les traits du \
            visage (forme, ecartement des yeux, nez, bouche, morphologie generale) — pas la \
            qualite de l'image, l'eclairage ou l'angle de prise de vue, qui different naturellement \
            entre un selfie et une photo d'identite imprimee/scannee.

            Consignes :
            - Reste conservateur : en cas de doute ou si un des deux visages est trop peu visible \
            (flou, mal cadre, illisible), choisis INDETERMINE plutot qu'un verdict tranche.
            - Ne conclus jamais avec une certitude absolue dans un sens ou l'autre — tu fournis un \
            signal d'aide a la decision, la decision finale revient a l'agent back-office.
            """;

    private final AppProperties props;
    private volatile AnthropicClient client;

    public FaceMatchService(AppProperties props) {
        this.props = props;
    }

    public record Result(String verdict, Double score, String commentaire) {
        static Result indetermine(String commentaire) {
            return new Result("INDETERMINE", null, commentaire);
        }
    }

    /** {@code selfieDataUrl} / {@code pieceDataUrl} : data URLs completes (data:image/...;base64,...). */
    public Result comparer(String selfieDataUrl, String pieceDataUrl) {
        if (props.getAnthropicApiKey() == null) {
            return Result.indetermine("Comparaison faciale non configuree.");
        }
        DataUri selfie = DataUri.parse(selfieDataUrl);
        DataUri piece = DataUri.parse(pieceDataUrl);
        if (selfie == null || piece == null) {
            return Result.indetermine("Format d'image non reconnu pour la comparaison.");
        }

        try {
            FaceMatchAi ai = callClaude(selfie, piece);
            return new Result(ai.verdict(), ai.score(), ai.commentaire());
        } catch (AnthropicException e) {
            log.error("Comparaison faciale en echec : {}", e.getMessage(), e);
            return Result.indetermine("Comparaison momentanement indisponible.");
        }
    }

    private FaceMatchAi callClaude(DataUri selfie, DataUri piece) {
        AnthropicClient anthropic = client();

        ImageBlockParam selfieBlock = ImageBlockParam.builder()
                .source(Base64ImageSource.builder().data(selfie.data()).mediaType(selfie.mediaType()).build())
                .build();
        ImageBlockParam pieceBlock = ImageBlockParam.builder()
                .source(Base64ImageSource.builder().data(piece.data()).mediaType(piece.mediaType()).build())
                .build();
        TextBlockParam textBlock = TextBlockParam.builder()
                .text("Premiere image : selfie captured en direct. Deuxieme image : photo extraite "
                        + "de la piece d'identite. Compare ces deux visages.")
                .build();

        MessageParam userMessage = MessageParam.builder()
                .role(MessageParam.Role.USER)
                .contentOfBlockParams(List.of(
                        ContentBlockParam.ofText(textBlock),
                        ContentBlockParam.ofImage(selfieBlock),
                        ContentBlockParam.ofImage(pieceBlock)))
                .build();

        StructuredMessageCreateParams<FaceMatchAi> params = MessageCreateParams.builder()
                .model("claude-sonnet-5")
                .maxTokens(1024L)
                .system(SYSTEM_PROMPT)
                .outputConfig(FaceMatchAi.class)
                .messages(List.of(userMessage))
                .build();

        List<FaceMatchAi> results = new ArrayList<>();
        anthropic.messages().create(params).content().stream()
                .flatMap(cb -> cb.text().stream())
                .forEach(typed -> results.add(typed.text()));

        if (results.isEmpty()) {
            return new FaceMatchAi("INDETERMINE", 0.0, "Reponse IA vide.");
        }
        return results.get(0);
    }

    private AnthropicClient client() {
        AnthropicClient current = client;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (client == null) {
                client = AnthropicOkHttpClient.builder().apiKey(props.getAnthropicApiKey()).build();
            }
            return client;
        }
    }
}
