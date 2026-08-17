package cm.afriland.titres.web;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.registration.FaceMatchService;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.Permission;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * Controle facial d'un ordre de souscription — « est-ce bien le titulaire qui
 * passe cet ordre ? » (addendum, Fonctionnalite 5). Le "taux de fiabilite"
 * compare la photo prise au moment de l'ordre au visage de reference capture a
 * l'ouverture du compte, via {@link FaceMatchService} — la meme brique deja
 * utilisee pour comparer le selfie a la piece d'identite (Fonctionnalite 2/4).
 *
 * <p><b>Jamais bloquant</b> : declenche apres coup, l'ordre est deja enregistre
 * et son sort n'attend jamais ce controle, meme en cas de panne technique.</p>
 */
@RestController
@RequestMapping("/api/v1")
public class OrderFaceCheckController {

    private static final String ORDRE_INTROUVABLE = "Ordre introuvable.";
    private static final String CONTROLE_INTROUVABLE = "Contrôle facial introuvable.";
    /** Seuil indicatif affiche cote client — l'IA rend un score continu, pas une distance. */
    private static final double SEUIL_INDICATIF = 0.5;

    private final JdbcTemplate jdbc;
    private final FaceMatchService faceMatch;
    private final AuditService audit;

    public OrderFaceCheckController(JdbcTemplate jdbc, FaceMatchService faceMatch, AuditService audit) {
        this.jdbc = jdbc;
        this.faceMatch = faceMatch;
        this.audit = audit;
    }

    record FaceCheckRequest(@NotBlank String imageBase64, Double livenessScore, String challengeType,
                             List<Double> descriptor) {
    }

    record FaceCheckResult(String matchStatus, boolean matched, double distance, double seuil) {
    }

    record OrderFaceCheckDetail(UUID orderId, String photoOuverture, String photoOrdre, double distance,
                                 double seuil, String matchStatus, Double livenessScore,
                                 String verificationStatus, Double tauxFiabilite, String commentaire) {
    }

    record VerifyRequest(@NotBlank String status) {
    }

    /** {@code POST /orders/:id/face-check} — depose la photo du jour (client, sur SON PROPRE ordre). */
    @PostMapping("/orders/{id}/face-check")
    public FaceCheckResult check(AuthUser user, @PathVariable UUID id, @Valid @RequestBody FaceCheckRequest req) {
        UUID clientId = orderClientId(id);
        // Cloisonnement : un client ne declenche ce controle que sur ses propres ordres.
        if (!clientId.equals(user.id())) {
            throw ApiException.notFound(ORDRE_INTROUVABLE);
        }

        String reference = referenceFace(clientId);
        String matchStatus;
        Double tauxFiabilite = null;
        String commentaire;
        if (reference == null) {
            matchStatus = "NON_COMPARABLE";
            commentaire = "Aucune capture de reference (ouverture de compte) disponible.";
        } else {
            FaceMatchService.Result r = faceMatch.comparer(req.imageBase64(), reference);
            tauxFiabilite = r.score();
            commentaire = r.commentaire();
            matchStatus = toMatchStatus(r.verdict());
        }

        String descriptorJson = req.descriptor() == null ? null : toJsonArray(req.descriptor());
        jdbc.update(
                "INSERT INTO order_face_checks (order_id, image_base64, liveness_score, challenge_type, "
                        + "descriptor_json, match_status, taux_fiabilite, commentaire) "
                        + "VALUES (?,?,?,?,?,?,?,?) "
                        + "ON CONFLICT (order_id) DO UPDATE SET "
                        + "image_base64 = EXCLUDED.image_base64, liveness_score = EXCLUDED.liveness_score, "
                        + "challenge_type = EXCLUDED.challenge_type, descriptor_json = EXCLUDED.descriptor_json, "
                        + "match_status = EXCLUDED.match_status, taux_fiabilite = EXCLUDED.taux_fiabilite, "
                        + "commentaire = EXCLUDED.commentaire, verification_status = 'EN_ATTENTE', "
                        + "created_at = now()",
                id, req.imageBase64(), req.livenessScore(), req.challengeType(), descriptorJson,
                matchStatus, tauxFiabilite, commentaire);

        return new FaceCheckResult(matchStatus, "CORRESPOND".equals(matchStatus),
                distanceFrom(tauxFiabilite), SEUIL_INDICATIF);
    }

    /** {@code GET /admin/orders/:id/face-check} — les deux photos + le taux de fiabilite (back-office). */
    @GetMapping("/admin/orders/{id}/face-check")
    public OrderFaceCheckDetail adminGet(AuthUser user, @PathVariable UUID id) {
        user.require(Permission.CLIENT_MANAGE);
        return jdbc.query(
                        "SELECT ofc.image_base64 AS photo_ordre, ofc.liveness_score, ofc.match_status, "
                                + "ofc.taux_fiabilite, ofc.commentaire, ofc.verification_status, "
                                + "rf.image_base64 AS photo_ouverture "
                                + "FROM order_face_checks ofc "
                                + "JOIN orders o ON o.id = ofc.order_id "
                                + "LEFT JOIN registration_dossiers rd ON rd.user_id = o.client_id "
                                + "LEFT JOIN registration_faces rf ON rf.dossier_id = rd.id "
                                + "WHERE ofc.order_id = ?",
                        (rs, n) -> {
                            Double taux = (Double) rs.getObject("taux_fiabilite");
                            return new OrderFaceCheckDetail(id, rs.getString("photo_ouverture"),
                                    rs.getString("photo_ordre"), distanceFrom(taux), SEUIL_INDICATIF,
                                    rs.getString("match_status"), (Double) rs.getObject("liveness_score"),
                                    rs.getString("verification_status"), taux, rs.getString("commentaire"));
                        },
                        id)
                .stream().findFirst()
                .orElseThrow(() -> ApiException.notFound(CONTROLE_INTROUVABLE));
    }

    /** {@code POST /admin/orders/:id/face-check/verify} — revue humaine : valide/rejette. */
    @PostMapping("/admin/orders/{id}/face-check/verify")
    public Map<String, Object> adminVerify(AuthUser user, ClientIp ip, @PathVariable UUID id,
                                           @Valid @RequestBody VerifyRequest req) {
        user.require(Permission.CLIENT_MANAGE);
        String status = "VALIDE".equals(req.status()) ? "VALIDE" : "REJETE";
        int updated = jdbc.update(
                "UPDATE order_face_checks SET verification_status = ? WHERE order_id = ?", status, id);
        ApiException.ensure(updated > 0, CONTROLE_INTROUVABLE);
        audit.log(user.id().toString(), "VERIFICATION_FACIALE_ORDRE", AuditService.SUCCES, id.toString(), ip.value());
        return Map.of("status", status);
    }

    private UUID orderClientId(UUID orderId) {
        return jdbc.query("SELECT client_id FROM orders WHERE id = ?",
                        (rs, n) -> rs.getObject("client_id", UUID.class), orderId)
                .stream().findFirst()
                .orElseThrow(() -> ApiException.notFound(ORDRE_INTROUVABLE));
    }

    private String referenceFace(UUID clientId) {
        return jdbc.query(
                        "SELECT rf.image_base64 FROM registration_faces rf "
                                + "JOIN registration_dossiers rd ON rd.id = rf.dossier_id "
                                + "WHERE rd.user_id = ?",
                        (rs, n) -> rs.getString("image_base64"), clientId)
                .stream().findFirst().orElse(null);
    }

    private static String toMatchStatus(String faceMatchVerdict) {
        return switch (faceMatchVerdict) {
            case "CORRESPOND" -> "CORRESPOND";
            case "NE_CORRESPOND_PAS" -> "DIFFERENT";
            default -> "NON_COMPARABLE";
        };
    }

    /** "Distance" affichee cote client : purement derivee du score IA (1 - score), \
     *  pour rester compatible avec l'UI existante (seuil indicatif) sans faire croire \
     *  a une metrique geometrique reelle. */
    private static double distanceFrom(Double tauxFiabilite) {
        return tauxFiabilite == null ? -1 : 1 - tauxFiabilite;
    }

    private static String toJsonArray(List<Double> values) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(values.get(i));
        }
        return sb.append(']').toString();
    }
}
