package cm.afriland.titres.registration;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.Permission;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * Back-office — verification des dossiers d'inscription en ligne : capture
 * faciale (vivacite, 468 reperes) et decision finale (approbation/rejet du
 * dossier). Addendum au CSFT, Fonctionnalite 4.
 */
@RestController
@RequestMapping("/api/v1/admin/registrations")
public class AdminRegistrationsController {

    private static final String DOSSIER_INTROUVABLE = "Dossier introuvable.";
    private static final String FACE_INTROUVABLE = "Capture faciale introuvable.";

    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public AdminRegistrationsController(JdbcTemplate jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    // ─────────────────────────── Reponses / requetes ──────────────────────────

    record CaptureRow(
            @JsonProperty("dossier_id") UUID dossierId,
            @JsonProperty("type_personne") String typePersonne,
            String nom,
            String prenom,
            @JsonProperty("liveness_score") double livenessScore,
            @JsonProperty("verification_status") String verificationStatus) {
    }

    record FaceDetail(UUID faceId, String imageBase64, String landmarksJson, double livenessScore,
                       String challengeType, Integer width, Integer height, String verificationStatus,
                       @JsonInclude(JsonInclude.Include.NON_NULL) String faceMatchVerdict,
                       @JsonInclude(JsonInclude.Include.NON_NULL) Double faceMatchScore,
                       @JsonInclude(JsonInclude.Include.NON_NULL) String faceMatchCommentaire) {
    }

    record PieceDto(
            UUID id, String cote,
            @JsonProperty("document_type") String documentType,
            @JsonProperty("ocr_texte") String ocrTexte,
            String imageBase64,
            @JsonInclude(JsonInclude.Include.NON_NULL) String authenticiteVerdict,
            @JsonInclude(JsonInclude.Include.NON_NULL) Double authenticiteScore,
            @JsonInclude(JsonInclude.Include.NON_NULL) String authenticiteCommentaire) {
    }

    record DossierDetail(UUID dossierId, String statut, String typePersonne, String compteEspeces,
                          String compteTitresBase, String email, String nom, String prenom, String telephone,
                          List<PieceDto> pieces) {
    }

    record VerifyRequest(@NotBlank String status) {
    }

    record ApproveRequest(String compteTitres) {
    }

    record RejectRequest(@NotBlank String motif) {
    }

    private static final RowMapper<CaptureRow> CAPTURE_MAPPER = (rs, n) -> new CaptureRow(
            rs.getObject("dossier_id", UUID.class), rs.getString("type_personne"),
            rs.getString("nom"), rs.getString("prenom"), rs.getDouble("liveness_score"),
            rs.getString("verification_status"));

    // ─────────────────────────────── Endpoints ────────────────────────────────

    /** {@code GET /admin/registrations?status=…} — file des captures a verifier. */
    @GetMapping
    public List<CaptureRow> list(AuthUser user, @RequestParam(required = false) String status) {
        user.require(Permission.CLIENT_MANAGE);
        String sql = "SELECT d.id AS dossier_id, d.type_personne, u.nom, u.prenom, "
                + "f.liveness_score, f.verification_status "
                + "FROM registration_faces f "
                + "JOIN registration_dossiers d ON d.id = f.dossier_id "
                + "JOIN users u ON u.id = d.user_id ";
        if (status != null && !status.isBlank()) {
            return jdbc.query(sql + "WHERE f.verification_status = ? ORDER BY f.created_at DESC",
                    CAPTURE_MAPPER, status);
        }
        return jdbc.query(sql + "ORDER BY f.created_at DESC", CAPTURE_MAPPER);
    }

    /** {@code GET /admin/registrations/:id/face} — capture faciale d'un dossier (repere par dossier). */
    @GetMapping("/{id}/face")
    public FaceDetail face(AuthUser user, @PathVariable UUID id) {
        user.require(Permission.CLIENT_MANAGE);
        return faceByDossier(id);
    }

    /** {@code GET /admin/registrations/by-user/:userId/face} — capture faciale d'un client (repere par user). */
    @GetMapping("/by-user/{userId}/face")
    public FaceDetail faceByUser(AuthUser user, @PathVariable UUID userId) {
        user.require(Permission.CLIENT_MANAGE);
        UUID dossierId = jdbc.query("SELECT id FROM registration_dossiers WHERE user_id = ?",
                        (rs, n) -> rs.getObject("id", UUID.class), userId)
                .stream().findFirst().orElseThrow(() -> ApiException.notFound(DOSSIER_INTROUVABLE));
        return faceByDossier(dossierId);
    }

    private FaceDetail faceByDossier(UUID dossierId) {
        return jdbc.query(
                        "SELECT id, image_base64, landmarks_json, liveness_score, challenge_type, "
                                + "width, height, verification_status, face_match_verdict, face_match_score, "
                                + "face_match_commentaire FROM registration_faces WHERE dossier_id = ?",
                        (rs, n) -> new FaceDetail(
                                rs.getObject("id", UUID.class), rs.getString("image_base64"),
                                rs.getString("landmarks_json"), rs.getDouble("liveness_score"),
                                rs.getString("challenge_type"), (Integer) rs.getObject("width"),
                                (Integer) rs.getObject("height"), rs.getString("verification_status"),
                                rs.getString("face_match_verdict"), (Double) rs.getObject("face_match_score"),
                                rs.getString("face_match_commentaire")),
                        dossierId)
                .stream().findFirst()
                .orElseThrow(() -> ApiException.notFound(FACE_INTROUVABLE));
    }

    /** {@code POST /admin/registrations/:id/face/verify} — valide/rejette la capture faciale. */
    @PostMapping("/{id}/face/verify")
    public Map<String, Object> verifyFace(AuthUser user, ClientIp ip, @PathVariable UUID id,
                                          @Valid @RequestBody VerifyRequest req) {
        user.require(Permission.CLIENT_MANAGE);
        String status = "VALIDE".equals(req.status()) ? "VALIDE" : "REJETE";
        int updated = jdbc.update(
                "UPDATE registration_faces SET verification_status = ? WHERE dossier_id = ?", status, id);
        ApiException.ensure(updated > 0, FACE_INTROUVABLE);
        audit.log(user.id().toString(), "VERIFICATION_FACIALE_INSCRIPTION",
                AuditService.SUCCES, id.toString(), ip.value());
        return Map.of("status", status);
    }

    /** {@code GET /admin/registrations/:id/dossier} — dossier complet (identite, pieces, visage). */
    @GetMapping("/{id}/dossier")
    public DossierDetail dossier(AuthUser user, @PathVariable UUID id) {
        user.require(Permission.CLIENT_MANAGE);
        DossierDetail base = jdbc.query(
                        "SELECT d.id AS dossier_id, d.statut, d.type_personne, u.compte_especes, "
                                + "u.email, u.nom, u.prenom, u.telephone "
                                + "FROM registration_dossiers d JOIN users u ON u.id = d.user_id WHERE d.id = ?",
                        (rs, n) -> new DossierDetail(
                                rs.getObject("dossier_id", UUID.class), rs.getString("statut"),
                                rs.getString("type_personne"), rs.getString("compte_especes"), null,
                                rs.getString("email"), rs.getString("nom"), rs.getString("prenom"),
                                rs.getString("telephone"), List.of()),
                        id)
                .stream().findFirst()
                .orElseThrow(() -> ApiException.notFound(DOSSIER_INTROUVABLE));

        List<PieceDto> pieces = jdbc.query(
                "SELECT id, cote, type_detecte, ocr_texte, image_base64, authenticite_verdict, "
                        + "authenticite_score, authenticite_commentaire "
                        + "FROM registration_pieces WHERE dossier_id = ? ORDER BY created_at",
                (rs, n) -> new PieceDto(
                        rs.getObject("id", UUID.class), rs.getString("cote"), rs.getString("type_detecte"),
                        rs.getString("ocr_texte"), rs.getString("image_base64"),
                        rs.getString("authenticite_verdict"), (Double) rs.getObject("authenticite_score"),
                        rs.getString("authenticite_commentaire")),
                id);

        return new DossierDetail(base.dossierId(), base.statut(), base.typePersonne(), base.compteEspeces(),
                null, base.email(), base.nom(), base.prenom(), base.telephone(), pieces);
    }

    /** {@code POST /admin/registrations/:id/approve} — valide le dossier ET ouvre le compte-titres. */
    @PostMapping("/{id}/approve")
    public Map<String, Object> approve(AuthUser user, ClientIp ip, @PathVariable UUID id,
                                       @RequestBody(required = false) ApproveRequest req) {
        user.require(Permission.CLIENT_MANAGE);
        UUID userId = dossierUserId(id);
        String compteTitres = req == null || req.compteTitres() == null || req.compteTitres().isBlank()
                ? null : req.compteTitres().trim();

        jdbc.update("UPDATE registration_dossiers SET statut = 'VALIDE', updated_at = now() WHERE id = ?", id);
        if (compteTitres != null) {
            jdbc.update("UPDATE users SET compte_titres = ?, updated_at = now() WHERE id = ?",
                    compteTitres, userId);
        }
        audit.log(user.id().toString(), "VALIDATION_DOSSIER_INSCRIPTION",
                AuditService.SUCCES, id.toString(), ip.value());
        return Map.of("statut", "VALIDE");
    }

    /** {@code POST /admin/registrations/:id/reject} — rejette le dossier (motif obligatoire). */
    @PostMapping("/{id}/reject")
    public Map<String, Object> reject(AuthUser user, ClientIp ip, @PathVariable UUID id,
                                      @Valid @RequestBody RejectRequest req) {
        user.require(Permission.CLIENT_MANAGE);
        UUID userId = dossierUserId(id);

        jdbc.update("UPDATE registration_dossiers SET statut = 'REJETE', motif_rejet = ?, "
                + "updated_at = now() WHERE id = ?", req.motif().trim(), id);
        // Un dossier rejete ne doit pas laisser un compte pleinement operationnel :
        // le prospect non verifie ne peut plus se connecter tant qu'un agent ne
        // reexamine pas la situation.
        jdbc.update("UPDATE users SET statut = 'SUSPENDU', updated_at = now() WHERE id = ?", userId);
        audit.log(user.id().toString(), "REJET_DOSSIER_INSCRIPTION",
                AuditService.SUCCES, id.toString(), ip.value());
        return Map.of("statut", "REJETE");
    }

    private UUID dossierUserId(UUID dossierId) {
        return jdbc.query("SELECT user_id FROM registration_dossiers WHERE id = ?",
                        (rs, n) -> rs.getObject("user_id", UUID.class), dossierId)
                .stream().findFirst()
                .orElseThrow(() -> ApiException.notFound(DOSSIER_INTROUVABLE));
    }
}
