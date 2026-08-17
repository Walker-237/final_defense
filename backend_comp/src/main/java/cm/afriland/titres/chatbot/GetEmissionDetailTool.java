package cm.afriland.titres.chatbot;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.AuthUser;

/** Detail complet d'une emission par son code — memes regles de visibilite que
 *  {@code GET /emissions/:id} : un non-membre du staff ne voit que le statut PUBLIE. */
@Component
class GetEmissionDetailTool implements ChatTool {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    GetEmissionDetailTool(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    @Override
    public String name() {
        return "get_emission_detail";
    }

    @Override
    public String description() {
        return "Recupere le detail complet d'une emission, par son code (ex. BTA-2026-03) : "
                + "montants, echeances, mode d'adjudication, description.";
    }

    @Override
    public Map<String, Map<String, String>> parameters() {
        return Map.of("code", Map.of("type", "string", "description", "Code de l'emission, ex. BTA-2026-03"));
    }

    @Override
    public List<String> required() {
        return List.of("code");
    }

    @Override
    public String execute(Map<String, Object> args, AuthUser user) {
        Object codeArg = args.get("code");
        if (codeArg == null || codeArg.toString().isBlank()) {
            return "Code d'emission manquant.";
        }
        String code = codeArg.toString().trim();
        // Cloisonnement identique a la fiche publique : un visiteur non connecte ou un
        // client ne voit jamais un brouillon interne, seul le staff le peut.
        boolean staff = user != null && user.isStaff();
        String sql = "SELECT code, isin, libelle, nature, pays_code, date_emission, ouverture_souscription, "
                + "fermeture_souscription, date_echeance, valeur_nominale_unitaire, montant_global, "
                + "taux_nominal, montant_minimum, frequence_coupon, mode_adjudication, description, status "
                + "FROM emissions WHERE code = ?" + (staff ? "" : " AND status = 'PUBLIE'");

        List<Map<String, Object>> rows = jdbc.query(sql, (rs, n) -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("code", rs.getString("code"));
            row.put("isin", rs.getString("isin"));
            row.put("libelle", rs.getString("libelle"));
            row.put("nature", rs.getString("nature"));
            row.put("paysCode", rs.getString("pays_code"));
            row.put("dateEmission", String.valueOf(rs.getObject("date_emission")));
            row.put("ouvertureSouscription", String.valueOf(rs.getObject("ouverture_souscription")));
            row.put("fermetureSouscription", String.valueOf(rs.getObject("fermeture_souscription")));
            row.put("dateEcheance", String.valueOf(rs.getObject("date_echeance")));
            row.put("valeurNominaleUnitaire", rs.getLong("valeur_nominale_unitaire"));
            row.put("montantGlobal", rs.getLong("montant_global"));
            row.put("tauxNominal", rs.getDouble("taux_nominal"));
            row.put("montantMinimum", rs.getLong("montant_minimum"));
            row.put("frequenceCoupon", rs.getString("frequence_coupon"));
            row.put("modeAdjudication", rs.getString("mode_adjudication"));
            row.put("description", rs.getString("description"));
            row.put("status", rs.getString("status"));
            return row;
        }, code);

        if (rows.isEmpty()) {
            return "Aucune emission publiee trouvee avec le code " + code + ".";
        }
        return ChatTool.toJson(json, rows.get(0));
    }
}
