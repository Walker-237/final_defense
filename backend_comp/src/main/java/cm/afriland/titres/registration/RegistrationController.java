package cm.afriland.titres.registration;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.JwtService;
import cm.afriland.titres.security.PasswordService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * Auto-inscription en ligne (ouverture de compte-titres a distance), sans
 * passage en agence — addendum au CSFT, Fonctionnalites 1/2/3.
 *
 * <p>{@code register} cree le compte utilisateur ET un dossier {@code BROUILLON},
 * puis ouvre une session temporaire (jeton d'acces) utilisee pour les etapes
 * suivantes du parcours (visage, piece d'identite, soumission). Cette session
 * n'a de raison d'etre que le temps du depot : une fois {@code submit} appele,
 * le frontend l'abandonne et renvoie le prospect vers l'ecran de connexion
 * habituel (avec MFA).</p>
 */
@RestController
@RequestMapping("/api/v1/registration")
public class RegistrationController {

    private static final String DOSSIER_INTROUVABLE = "Dossier introuvable.";

    private final JdbcTemplate jdbc;
    private final AppProperties props;
    private final JwtService jwt;
    private final PasswordService password;
    private final IdAuthenticityService authenticity;
    private final FaceMatchService faceMatch;

    public RegistrationController(JdbcTemplate jdbc, AppProperties props, JwtService jwt,
                                   PasswordService password, IdAuthenticityService authenticity,
                                   FaceMatchService faceMatch) {
        this.jdbc = jdbc;
        this.props = props;
        this.jwt = jwt;
        this.password = password;
        this.authenticity = authenticity;
        this.faceMatch = faceMatch;
    }

    // ─────────────────────────── Requetes / reponses ─────────────────────────

    record RegisterRequest(
            @Email(message = "format d'e-mail invalide") @NotNull String email,
            @Size(min = 8, max = 128, message = "mot de passe de 8 a 128 caracteres") String password,
            @Size(min = 1, max = 120) String nom,
            @Size(max = 120) String prenom,
            @Size(max = 40) String telephone,
            String typePersonne,
            String typeCompte,
            @NotBlank @Size(max = 40) String compteEspeces) {
    }

    record AuthTokens(String accessToken, String tokenType, long expiresIn) {
    }

    record RegisterResponse(UUID dossierId, UUID titulaireId, AuthTokens auth) {
    }

    record FaceRequest(
            @NotBlank String imageBase64,
            @NotBlank String landmarksJson,
            double livenessScore,
            boolean livenessPassed,
            String challengeType,
            Integer width,
            Integer height,
            List<Double> descriptor) {
    }

    record PieceRequest(
            @NotBlank String imageBase64,
            @NotBlank String cote,
            String type,
            String texte,
            Double nettete,
            Integer largeur,
            Integer hauteur) {
    }

    record ConventionDto(String version, String titre, String contenuHtml, String langue) {
    }

    /** Package-private (non {@code private}) : construit directement par les tests unitaires. */
    record Dossier(UUID id, UUID userId, String statut, String typePersonne, String typeCompte) {
    }

    private static final RowMapper<Dossier> DOSSIER_MAPPER = (rs, n) -> new Dossier(
            rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
            rs.getString("statut"), rs.getString("type_personne"), rs.getString("type_compte"));

    // ─────────────────────────────── Endpoints ────────────────────────────────

    /** {@code POST /registration/register} — cree le compte + un dossier BROUILLON, ouvre une session. */
    @PostMapping("/register")
    @Transactional
    public RegisterResponse register(@Valid @RequestBody RegisterRequest req) {
        String emailAddr = req.email().trim().toLowerCase();
        long existing = jdbc.queryForObject("SELECT count(*) FROM users WHERE email = ?", Long.class, emailAddr);
        // 409, pas 400 : le frontend (RegisterPPPage.messageErreur()) distingue explicitement
        // ce cas ("un compte existe deja") d'une saisie invalide, sur le code de statut.
        if (existing > 0) {
            throw ApiException.conflict("Un compte existe deja avec cet e-mail.");
        }

        String typePersonne = "PM".equalsIgnoreCase(req.typePersonne()) ? "PM" : "PP";
        String role = "PM".equals(typePersonne) ? "CLIENT_PM" : "CLIENT_PP";
        String typeCompte = "JOINT".equalsIgnoreCase(req.typeCompte()) ? "JOINT" : "INDIVIDUEL";

        UUID userId = jdbc.queryForObject(
                "INSERT INTO users (email, password_hash, role, nom, prenom, statut, compte_especes, "
                        + "type_compte, telephone, must_change_password) "
                        + "VALUES (?,?,?,?,?,'ACTIF',?,?,?,FALSE) RETURNING id",
                UUID.class, emailAddr, password.hash(req.password()), role, req.nom().trim(),
                req.prenom() == null ? null : req.prenom().trim(), req.compteEspeces().trim(),
                typeCompte, req.telephone());

        UUID dossierId = jdbc.queryForObject(
                "INSERT INTO registration_dossiers (user_id, type_personne, type_compte, statut) "
                        + "VALUES (?,?,?,'BROUILLON') RETURNING id",
                UUID.class, userId, typePersonne, typeCompte);

        String accessToken = jwt.issue(userId, emailAddr, role, false);
        return new RegisterResponse(dossierId, userId,
                new AuthTokens(accessToken, "Bearer", props.getAccessTokenTtl()));
    }

    /** {@code GET /registration/dossiers/:id} — etat courant du dossier (reprise du wizard). */
    @GetMapping("/dossiers/{id}")
    public Map<String, Object> getDossier(AuthUser user, @PathVariable UUID id) {
        Dossier d = requireOwnDossier(user, id);
        List<Map<String, Object>> pieces = jdbc.queryForList(
                "SELECT cote, type_detecte, nettete FROM registration_pieces WHERE dossier_id = ?", id);
        boolean faceDeposee = Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM registration_faces WHERE dossier_id = ?)", Boolean.class, id));

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("dossierId", d.id());
        body.put("statut", d.statut());
        body.put("typePersonne", d.typePersonne());
        body.put("typeCompte", d.typeCompte());
        body.put("pieces", pieces);
        body.put("faceDeposee", faceDeposee);
        return body;
    }

    /** {@code POST /registration/dossiers/:id/face} — depose la capture faciale de reference. */
    @PostMapping("/dossiers/{id}/face")
    public Map<String, Object> uploadFace(AuthUser user, @PathVariable UUID id,
                                          @Valid @RequestBody FaceRequest req) {
        requireOwnDossier(user, id);
        String descriptorJson = req.descriptor() == null ? null : toJsonArray(req.descriptor());
        UUID faceId = jdbc.queryForObject(
                "INSERT INTO registration_faces (dossier_id, image_base64, landmarks_json, liveness_score, "
                        + "liveness_passed, challenge_type, width, height, descriptor_json) "
                        + "VALUES (?,?,?,?,?,?,?,?,?) "
                        + "ON CONFLICT (dossier_id) DO UPDATE SET "
                        + "image_base64 = EXCLUDED.image_base64, landmarks_json = EXCLUDED.landmarks_json, "
                        + "liveness_score = EXCLUDED.liveness_score, liveness_passed = EXCLUDED.liveness_passed, "
                        + "challenge_type = EXCLUDED.challenge_type, width = EXCLUDED.width, "
                        + "height = EXCLUDED.height, descriptor_json = EXCLUDED.descriptor_json, "
                        + "verification_status = 'EN_ATTENTE' "
                        + "RETURNING id",
                UUID.class, id, req.imageBase64(), req.landmarksJson(), req.livenessScore(), req.livenessPassed(),
                req.challengeType() == null ? "BLINK" : req.challengeType(), req.width(), req.height(), descriptorJson);
        touchDossier(id);
        // Le "taux de fiabilite" (correspondance visage <-> piece) n'est calculable que
        // si une piece RECTO existe deja pour ce dossier — sinon c'est un no-op silencieux.
        runFaceMatchIfPossible(id);
        return Map.of("faceId", faceId);
    }

    /** {@code POST /registration/dossiers/:id/piece-identite} — depose une piece d'identite. */
    @PostMapping("/dossiers/{id}/piece-identite")
    public Map<String, Object> uploadPiece(AuthUser user, @PathVariable UUID id,
                                           @Valid @RequestBody PieceRequest req) {
        requireOwnDossier(user, id);
        // Analyse d'authenticite IA : indicative, ne conditionne jamais le succes du depot.
        IdAuthenticityService.Result analyse = authenticity.analyser(req.imageBase64());

        UUID pieceId = jdbc.queryForObject(
                "INSERT INTO registration_pieces (dossier_id, cote, type_detecte, ocr_texte, nettete, "
                        + "largeur, hauteur, image_base64, authenticite_verdict, authenticite_score, "
                        + "authenticite_commentaire, analysee_le) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?, now()) RETURNING id",
                UUID.class, id, req.cote(), req.type(), req.texte(), req.nettete(), req.largeur(), req.hauteur(),
                req.imageBase64(), analyse.verdict(), analyse.score(), analyse.commentaire());
        touchDossier(id);
        // Le parcours depose normalement le visage avant la piece, mais un dossier
        // repris peut inverser l'ordre — on tente la comparaison des deux cotes.
        if ("RECTO".equals(req.cote())) {
            runFaceMatchIfPossible(id);
        }
        return Map.of("pieceId", pieceId);
    }

    /**
     * Compare le visage capture (selfie) a la piece RECTO deposee, si les deux sont
     * disponibles pour ce dossier — c'est ce score qui constitue le "taux de
     * fiabilite" affiche au back-office. No-op silencieux si l'un des deux manque
     * encore (l'ordre de depot n'est pas garanti).
     */
    private void runFaceMatchIfPossible(UUID dossierId) {
        String faceImage = jdbc.query(
                        "SELECT image_base64 FROM registration_faces WHERE dossier_id = ?",
                        (rs, n) -> rs.getString("image_base64"), dossierId)
                .stream().findFirst().orElse(null);
        if (faceImage == null) {
            return;
        }
        String pieceImage = jdbc.query(
                        "SELECT image_base64 FROM registration_pieces WHERE dossier_id = ? AND cote = 'RECTO' "
                                + "ORDER BY created_at DESC LIMIT 1",
                        (rs, n) -> rs.getString("image_base64"), dossierId)
                .stream().findFirst().orElse(null);
        if (pieceImage == null) {
            return;
        }

        FaceMatchService.Result result = faceMatch.comparer(faceImage, pieceImage);
        jdbc.update("UPDATE registration_faces SET face_match_verdict = ?, face_match_score = ?, "
                        + "face_match_commentaire = ?, face_match_le = now() WHERE dossier_id = ?",
                result.verdict(), result.score(), result.commentaire(), dossierId);
    }

    /** {@code POST /registration/dossiers/:id/submit} — soumet le dossier au back-office. */
    @PostMapping("/dossiers/{id}/submit")
    public Map<String, Object> submit(AuthUser user, @PathVariable UUID id) {
        Dossier d = requireOwnDossier(user, id);
        ApiException.ensure("BROUILLON".equals(d.statut()), "Ce dossier a deja ete soumis.");
        jdbc.update("UPDATE registration_dossiers SET statut = 'EN_ATTENTE_VERIFICATION', "
                + "updated_at = now() WHERE id = ?", id);
        return Map.of("dossierId", id, "statut", "EN_ATTENTE_VERIFICATION");
    }

    /** {@code GET /registration/convention?langue=FR} — convention de compte-titres en vigueur. */
    @GetMapping("/convention")
    public ConventionDto convention(@RequestParam(defaultValue = "FR") String langue) {
        boolean en = "EN".equalsIgnoreCase(langue);
        String titre = en ? "Securities Account Agreement" : "Convention de compte-titres";
        String contenu = en
                ? "<p>By opening a securities account with Afriland First Bank, the account holder "
                + "agrees to the general terms governing the subscription, custody and management of "
                + "public debt securities (BTA/OTA) issued in the CEMAC zone, as well as the applicable "
                + "fee schedule communicated at account opening.</p>"
                + "<p>The account holder authorises Afriland First Bank to debit the linked cash account "
                + "for any subscription duly submitted through the platform, and to carry out the "
                + "identity verification (KYC) required by BEAC/COBAC regulations before account "
                + "activation.</p>"
                : "<p>En ouvrant un compte-titres aupres d'Afriland First Bank, le titulaire adhere aux "
                + "conditions generales regissant la souscription, la conservation et la gestion des "
                + "titres publics (BTA/OTA) emis dans la zone CEMAC, ainsi qu'a la grille tarifaire en "
                + "vigueur communiquee a l'ouverture du compte.</p>"
                + "<p>Le titulaire autorise Afriland First Bank a debiter le compte especes rattache pour "
                + "toute souscription valablement soumise via la plateforme, et a proceder a la "
                + "verification d'identite (KYC) exigee par la reglementation BEAC/COBAC avant "
                + "l'activation du compte.</p>";
        return new ConventionDto("1.0", titre, contenu, en ? "EN" : "FR");
    }

    // ────────────────────────────── Utilitaires ───────────────────────────────

    private Dossier requireOwnDossier(AuthUser user, UUID dossierId) {
        Dossier d = jdbc.query(
                        "SELECT id, user_id, statut, type_personne, type_compte "
                                + "FROM registration_dossiers WHERE id = ?", DOSSIER_MAPPER, dossierId)
                .stream().findFirst()
                .orElseThrow(() -> ApiException.notFound(DOSSIER_INTROUVABLE));
        // Cloisonnement : un prospect n'agit que sur son propre dossier.
        if (!d.userId().equals(user.id())) {
            throw ApiException.notFound(DOSSIER_INTROUVABLE);
        }
        return d;
    }

    private void touchDossier(UUID id) {
        jdbc.update("UPDATE registration_dossiers SET updated_at = now() WHERE id = ?", id);
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
