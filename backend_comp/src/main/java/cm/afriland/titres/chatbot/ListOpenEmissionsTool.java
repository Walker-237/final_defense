package cm.afriland.titres.chatbot;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.AuthUser;

/** Liste les emissions actuellement PUBLIEES — donnee publique, identique a {@code GET /emissions}. */
@Component
class ListOpenEmissionsTool implements ChatTool {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    ListOpenEmissionsTool(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public String name() {
        return "list_open_emissions";
    }

    @Override
    public String description() {
        return "Liste les emissions de titres publics (BTA/OTA) actuellement ouvertes a la "
                + "souscription sur la plateforme, avec leurs caracteristiques principales. "
                + "Donnee publique, a jour.";
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
        List<Map<String, Object>> rows = jdbc.query(
                "SELECT code, nature, pays_code, taux_nominal, mode_adjudication, montant_global, "
                        + "montant_minimum, fermeture_souscription, date_echeance "
                        + "FROM emissions WHERE status = 'PUBLIE' ORDER BY fermeture_souscription LIMIT 20",
                (rs, n) -> {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("code", rs.getString("code"));
                    row.put("nature", rs.getString("nature"));
                    row.put("paysCode", rs.getString("pays_code"));
                    row.put("tauxNominal", rs.getDouble("taux_nominal"));
                    row.put("modeAdjudication", rs.getString("mode_adjudication"));
                    row.put("montantGlobal", rs.getLong("montant_global"));
                    row.put("montantMinimum", rs.getLong("montant_minimum"));
                    row.put("fermetureSouscription", String.valueOf(rs.getObject("fermeture_souscription")));
                    row.put("dateEcheance", String.valueOf(rs.getObject("date_echeance")));
                    return row;
                });
        return rows.isEmpty() ? "Aucune emission publiee actuellement." : ChatTool.toJson(json, rows);
    }
}
