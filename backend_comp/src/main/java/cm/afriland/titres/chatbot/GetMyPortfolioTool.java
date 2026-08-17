package cm.afriland.titres.chatbot;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.AuthUser;

/**
 * Positions titres du client actuellement connecte (memes regles de calcul que
 * {@code GET /portfolio} : ordres adjuges, totalement ou partiellement retenus).
 *
 * <p>Ne prend AUCUN parametre — porte toujours sur {@code user.id()}, pour la
 * meme raison que {@link ListMyOrdersTool}.</p>
 */
@Component
class GetMyPortfolioTool implements ChatTool {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    GetMyPortfolioTool(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public String name() {
        return "get_my_portfolio";
    }

    @Override
    public String description() {
        return "Positions titres du client actuellement connecte, derivees des ordres adjuges "
                + "(jamais celles d'un autre client — cet outil ne prend aucun identifiant en parametre).";
    }

    @Override
    public Map<String, Map<String, String>> parameters() {
        return Map.of();
    }

    @Override
    public List<String> required() {
        return List.of();
    }

    @Override
    public String execute(Map<String, Object> args, AuthUser user) {
        if (user == null) {
            return "Connectez-vous a votre espace client pour consulter votre portefeuille.";
        }
        if (!user.isClient()) {
            return "Cet outil est reserve aux clients. Un membre du back-office consulte le "
                    + "portefeuille d'un client via GET /portfolio/:clientId.";
        }
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT e.code AS emission_code, e.nature, e.pays_code, e.date_echeance, "
                        + "sum(coalesce(o.volume_alloue, 0))::bigint AS volume, "
                        + "sum(coalesce(o.montant_adjuge, 0))::bigint AS valeur_totale "
                        + "FROM orders o JOIN emissions e ON e.id = o.emission_id "
                        + "WHERE o.client_id = ? AND o.status IN ('TOTALEMENT_RETENU', 'PARTIELLEMENT_RETENU') "
                        + "GROUP BY e.id, e.code, e.nature, e.pays_code, e.date_echeance "
                        + "HAVING sum(coalesce(o.volume_alloue, 0)) > 0 "
                        + "ORDER BY e.date_echeance",
                (rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("emissionCode", rs.getString("emission_code"));
                    row.put("nature", rs.getString("nature"));
                    row.put("paysCode", rs.getString("pays_code"));
                    row.put("dateEcheance", String.valueOf(rs.getObject("date_echeance")));
                    row.put("volume", rs.getLong("volume"));
                    row.put("valeurTotale", rs.getLong("valeur_totale"));
                    return row;
                },
                user.id());
        return rows.isEmpty() ? "Aucune position en portefeuille pour ce client." : ChatTool.toJson(json, rows);
    }
}
