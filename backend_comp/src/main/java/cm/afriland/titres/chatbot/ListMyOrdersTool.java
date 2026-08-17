package cm.afriland.titres.chatbot;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.AuthUser;

/**
 * Liste les ordres de souscription du client actuellement connecte.
 *
 * <p>Ne prend AUCUN parametre — porte toujours sur {@code user.id()}. C'est
 * l'absence meme de parametre "client" qui garantit qu'aucun client ne peut
 * consulter les ordres d'un autre via le chatbot.</p>
 */
@Component
class ListMyOrdersTool implements ChatTool {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    ListMyOrdersTool(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public String name() {
        return "list_my_orders";
    }

    @Override
    public String description() {
        return "Liste les ordres de souscription du client actuellement connecte (jamais ceux d'un "
                + "autre client — cet outil ne prend aucun identifiant de client en parametre).";
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
            return "Connectez-vous a votre espace client pour consulter vos ordres.";
        }
        if (!user.isClient()) {
            return "Cet outil est reserve aux clients. Un membre du back-office consulte les ordres "
                    + "via le menu back-office « Ordres ».";
        }
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT o.reference, e.code AS emission_code, o.status, o.volume, o.montant, "
                        + "o.taux_soumis, o.date_soumission "
                        + "FROM orders o JOIN emissions e ON e.id = o.emission_id "
                        + "WHERE o.client_id = ? ORDER BY o.date_soumission DESC LIMIT 20",
                (rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("reference", rs.getString("reference"));
                    row.put("emissionCode", rs.getString("emission_code"));
                    row.put("status", rs.getString("status"));
                    row.put("volume", rs.getInt("volume"));
                    row.put("montant", rs.getLong("montant"));
                    row.put("tauxSoumis", rs.getDouble("taux_soumis"));
                    row.put("dateSoumission", String.valueOf(rs.getObject("date_soumission")));
                    return row;
                },
                user.id());
        return rows.isEmpty() ? "Aucun ordre pour ce client." : ChatTool.toJson(json, rows);
    }
}
