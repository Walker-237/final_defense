package cm.afriland.titres.liveness;

import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.DoublePredicate;
import java.util.function.Function;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.registration.FaceMatchService;

/**
 * Defi de vivacite a actions imprevisibles.
 *
 * <p><b>Regle d'architecture non negociable</b> (deja dans le cahier des
 * charges) : le navigateur ne rend jamais de verdict. Il capture, mesure et
 * transmet ; toute la logique de decision vit ici, cote serveur. La sequence
 * d'actions est tiree par {@link #tirerActions()} avec {@link SecureRandom} et
 * n'est jamais derivable d'une valeur envoyee au client. Les seuils de
 * detection ({@link LivenessThresholds}) ne quittent jamais cette classe.</p>
 */
@Service
public class LivenessChallengeService {

    private static final Logger log = LoggerFactory.getLogger(LivenessChallengeService.class);

    /** Duree de vie d'un defi — usage unique, non rejouable une fois consomme. */
    private static final long DUREE_VALIDITE_SECONDES = 90;

    private static final int MAX_ECHECS_CONSECUTIFS = 3;
    private static final long BLOCAGE_SECONDES = 15 * 60;

    /** Meme idiome que ClientController (numeros de compte) : generateur cryptographiquement
     *  sur, instance partagee sans etat sensible. */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final FaceMatchService faceMatch;
    private final AuditService audit;

    public LivenessChallengeService(JdbcTemplate jdbc, ObjectMapper json, FaceMatchService faceMatch,
                                     AuditService audit) {
        this.jdbc = jdbc;
        this.json = json;
        this.faceMatch = faceMatch;
        this.audit = audit;
    }

    // ─────────────────────────────── DTOs ────────────────────────────────────

    public record ActionAffichable(String code, String consigne) {
    }

    public record ChallengeCree(UUID challengeId, List<ActionAffichable> actions, OffsetDateTime expiresAt) {
    }

    public record ActionAffichee(String actionCode, long afficheeAtMs) {
    }

    public record VerifyRequest(String imageBase64, List<ActionAffichee> actionsAffichees,
                                 List<LivenessFrame> frames) {
    }

    /** Package-private (non {@code private}) : construit directement par les tests unitaires. */
    record ChallengeRow(UUID id, UUID userId, String contexteType, String actionsJson, String statut,
                         OffsetDateTime expiresAt) {
    }

    private record Verdict(boolean reussi, String motif) {
    }

    private static final RowMapper<ChallengeRow> CHALLENGE_MAPPER = (rs, n) -> new ChallengeRow(
            rs.getObject("id", UUID.class), rs.getObject("user_id", UUID.class),
            rs.getString("contexte_type"), rs.getString("actions"), rs.getString("statut"),
            rs.getObject("expires_at", OffsetDateTime.class));

    // ─────────────────────────────── Emission ────────────────────────────────

    /** {@code POST /liveness/challenge} — tire et persiste un nouveau defi. */
    public ChallengeCree creer(UUID userId, String contexteType, UUID contexteRef, String ip) {
        checkLockout(userId);

        List<LivenessAction> actions = tirerActions();
        String actionsJson = toJson(actions.stream().map(Enum::name).toList());
        OffsetDateTime expiresAt = OffsetDateTime.now().plusSeconds(DUREE_VALIDITE_SECONDES);

        UUID challengeId = jdbc.queryForObject(
                "INSERT INTO liveness_challenges (user_id, contexte_type, contexte_ref, actions, expires_at) "
                        + "VALUES (?,?,?,?,?) RETURNING id",
                UUID.class, userId, contexteType, contexteRef, actionsJson, expiresAt);

        audit.log(userId.toString(), "DEFI_VIVACITE_EMIS", AuditService.SUCCES,
                contexteType + (contexteRef != null ? ":" + contexteRef : ""), ip);

        List<ActionAffichable> affichables = actions.stream()
                .map(a -> new ActionAffichable(a.name(), a.consigne())).toList();
        return new ChallengeCree(challengeId, affichables, expiresAt);
    }

    /**
     * Tire 2 ou 3 familles DISTINCTES (jamais deux actions de la meme famille dans
     * un defi), puis une action au hasard dans chacune. Generateur cryptographiquement
     * sur — {@link SecureRandom}, pas {@code java.util.Random} ni {@code Math.random()}.
     */
    List<LivenessAction> tirerActions() {
        List<LivenessAction.Family> familles = new ArrayList<>(List.of(LivenessAction.Family.values()));
        Collections.shuffle(familles, SECURE_RANDOM);
        int nombre = 2 + SECURE_RANDOM.nextInt(2); // 2 ou 3

        List<LivenessAction> actions = new ArrayList<>(nombre);
        for (int i = 0; i < nombre; i++) {
            LivenessAction.Family famille = familles.get(i);
            List<LivenessAction> candidats = java.util.Arrays.stream(LivenessAction.values())
                    .filter(a -> a.family() == famille).toList();
            actions.add(candidats.get(SECURE_RANDOM.nextInt(candidats.size())));
        }
        return actions;
    }

    // ─────────────────────────────── Verification ────────────────────────────

    /**
     * {@code POST /liveness/challenge/:id/verify}. Renvoie uniquement REUSSI/ECHOUE —
     * jamais l'etape ni le motif, qui restent dans le journal serveur (audit,
     * consultable au back-office). Rejette des le premier manquement.
     */
    public String verifier(UUID userId, UUID challengeId, VerifyRequest req, String ip) {
        checkLockout(userId);

        ChallengeRow ch = jdbc.query(
                        "SELECT id, user_id, contexte_type, actions, statut, expires_at "
                                + "FROM liveness_challenges WHERE id = ?",
                        CHALLENGE_MAPPER, challengeId)
                .stream().findFirst().orElse(null);

        String motif;
        boolean reussi;

        if (ch == null) {
            motif = "defi introuvable";
            reussi = false;
        } else if (!ch.userId().equals(userId)) {
            motif = "defi appartenant a un autre utilisateur";
            reussi = false;
        } else if (!"EN_ATTENTE".equals(ch.statut())) {
            motif = "defi deja consomme (statut " + ch.statut() + ")";
            reussi = false;
        } else if (ch.expiresAt().isBefore(OffsetDateTime.now())) {
            motif = "defi expire";
            reussi = false;
            marquerStatut(ch.id(), "EXPIRE", motif);
        } else {
            jdbc.update("UPDATE liveness_challenges SET tentatives = tentatives + 1 WHERE id = ?", ch.id());
            Verdict v = executerVerification(ch, req);
            motif = v.motif();
            reussi = v.reussi();
            marquerStatut(ch.id(), reussi ? "REUSSI" : "ECHOUE", motif);
        }

        // Le compteur de blocage ne s'applique qu'aux echecs sur SON PROPRE defi —
        // sinon un tiers pourrait faire bloquer un compte cible en presentant des
        // identifiants de defis invalides en son nom.
        if (ch != null && ch.userId().equals(userId)) {
            enregistrerResultatLockout(userId, reussi, ip);
        }

        audit.log(userId.toString(), "VERIFICATION_DEFI_VIVACITE",
                reussi ? AuditService.SUCCES : AuditService.ECHEC, motif, ip);

        return reussi ? "REUSSI" : "ECHOUE";
    }

    private Verdict executerVerification(ChallengeRow ch, VerifyRequest req) {
        List<LivenessAction> actions;
        try {
            actions = fromJson(ch.actionsJson()).stream().map(LivenessAction::valueOf).toList();
        } catch (RuntimeException e) {
            return new Verdict(false, "actions du defi illisibles");
        }

        List<ActionAffichee> affichees = req.actionsAffichees();
        if (affichees == null || affichees.size() != actions.size()) {
            return new Verdict(false, "nombre d'affichages incoherent avec le defi");
        }
        for (int i = 0; i < actions.size(); i++) {
            if (!actions.get(i).name().equals(affichees.get(i).actionCode())) {
                return new Verdict(false, "sequence d'affichage incoherente avec le defi");
            }
        }

        List<LivenessFrame> frames = req.frames() == null ? List.of() : req.frames();
        List<LivenessFrame> triees = frames.stream()
                .sorted(Comparator.comparingLong(LivenessFrame::tMs)).toList();

        // 2) + 3) — actions detectees DANS L'ORDRE, chacune dans SA fenetre
        // temporelle propre (entre l'affichage de sa consigne et celui de la
        // suivante) : une action detectee hors sequence ne peut structurellement
        // pas etre trouvee dans la fenetre d'une autre action.
        for (int i = 0; i < actions.size(); i++) {
            long debut = affichees.get(i).afficheeAtMs();
            long fin = (i + 1 < actions.size())
                    ? affichees.get(i + 1).afficheeAtMs()
                    : (triees.isEmpty() ? debut : triees.get(triees.size() - 1).tMs() + 1);
            List<LivenessFrame> fenetre = triees.stream()
                    .filter(f -> f.tMs() >= debut && f.tMs() < fin).toList();

            Optional<Long> franchi = detecter(actions.get(i), fenetre);
            if (franchi.isEmpty()) {
                return new Verdict(false, "action non detectee : " + actions.get(i));
            }
            long delai = franchi.get() - debut;
            if (delai < LivenessThresholds.DELAI_MIN_MS || delai > LivenessThresholds.DELAI_MAX_MS) {
                return new Verdict(false, "delai hors bornes (" + delai + " ms) pour " + actions.get(i));
            }
        }

        // 4) Continuite du visage entre images consecutives.
        for (int i = 1; i < triees.size(); i++) {
            if (discontinu(triees.get(i - 1), triees.get(i))) {
                return new Verdict(false, "discontinuite du cadre facial");
            }
        }

        // 5) Correspondance a la reference enrolee — sauf a l'inscription : ce
        // defi ETABLIT la reference, il n'y a encore rien a quoi la comparer.
        if (!"INSCRIPTION".equals(ch.contexteType())) {
            String reference = referenceFace(ch.userId());
            if (reference == null) {
                return new Verdict(false, "aucun visage de reference disponible");
            }
            FaceMatchService.Result r = faceMatch.comparer(req.imageBase64(), reference);
            if (!"CORRESPOND".equals(r.verdict())) {
                return new Verdict(false, "correspondance faciale : " + r.verdict());
            }
        }

        return new Verdict(true, null);
    }

    // ── Detection par action (chaque cas renvoie l'instant de franchissement, ou vide) ──

    private Optional<Long> detecter(LivenessAction action, List<LivenessFrame> fenetre) {
        return switch (action) {
            case BLINK_BOTH -> detecterClignements(fenetre, 1);
            case BLINK_TWICE -> detecterClignements(fenetre, 2);
            case TURN_LEFT -> detecterSeuil(fenetre, LivenessFrame::yaw, v -> v <= -LivenessThresholds.SEUIL_YAW_DEG);
            case TURN_RIGHT -> detecterSeuil(fenetre, LivenessFrame::yaw, v -> v >= LivenessThresholds.SEUIL_YAW_DEG);
            case CHIN_UP -> detecterSeuil(fenetre, LivenessFrame::pitch, v -> v >= LivenessThresholds.SEUIL_PITCH_DEG);
            case CHIN_DOWN -> detecterSeuil(fenetre, LivenessFrame::pitch, v -> v <= -LivenessThresholds.SEUIL_PITCH_DEG);
            case TILT_LEFT -> detecterSeuil(fenetre, LivenessFrame::roll, v -> v <= -LivenessThresholds.SEUIL_ROLL_DEG);
            case TILT_RIGHT -> detecterSeuil(fenetre, LivenessFrame::roll, v -> v >= LivenessThresholds.SEUIL_ROLL_DEG);
            case MOUTH_OPEN -> detecterSeuil(fenetre, LivenessFrame::mouthOpen,
                    v -> v >= LivenessThresholds.SEUIL_BOUCHE_OUVERTE);
            case SMILE -> detecterSourire(fenetre);
            case BROWS_UP -> detecterSeuil(fenetre, LivenessFrame::browRatio, v -> v >= LivenessThresholds.SEUIL_SOURCILS);
            case LEAN_IN -> detecterRapprochement(fenetre);
        };
    }

    private static Optional<Long> detecterSeuil(List<LivenessFrame> fenetre,
                                                Function<LivenessFrame, Double> extracteur,
                                                DoublePredicate franchi) {
        for (LivenessFrame f : fenetre) {
            Double v = extracteur.apply(f);
            if (v != null && franchi.test(v)) {
                return Optional.of(f.tMs());
            }
        }
        return Optional.empty();
    }

    private static Optional<Long> detecterSourire(List<LivenessFrame> fenetre) {
        for (LivenessFrame f : fenetre) {
            if (f.smileRatio() != null && f.smileRatio() >= LivenessThresholds.SEUIL_SOURIRE
                    && (f.mouthOpen() == null || f.mouthOpen() < LivenessThresholds.SEUIL_BOUCHE_FERMEE_POUR_SOURIRE)) {
                return Optional.of(f.tMs());
            }
        }
        return Optional.empty();
    }

    /** Detecte {@code cyclesRequis} cycles ferme->ouvert des paupieres (1 pour BLINK_BOTH, 2 pour BLINK_TWICE). */
    private static Optional<Long> detecterClignements(List<LivenessFrame> fenetre, int cyclesRequis) {
        boolean ferme = false;
        int cycles = 0;
        Long premiereFermeture = null;
        for (LivenessFrame f : fenetre) {
            double score = Math.max(nz(f.eyeCloseLeft()), nz(f.eyeCloseRight()));
            boolean fermeMaintenant = score > LivenessThresholds.SEUIL_YEUX_FERMES;
            if (fermeMaintenant && !ferme) {
                ferme = true;
                if (premiereFermeture == null) {
                    premiereFermeture = f.tMs();
                }
            } else if (!fermeMaintenant && ferme) {
                ferme = false;
                cycles++;
                if (cycles >= cyclesRequis) {
                    boolean tropEtale = cyclesRequis > 1 && premiereFermeture != null
                            && f.tMs() - premiereFermeture > LivenessThresholds.FENETRE_DOUBLE_CLIGNEMENT_MS;
                    if (tropEtale) {
                        return Optional.empty();
                    }
                    return Optional.of(f.tMs());
                }
            }
        }
        return Optional.empty();
    }

    /** LEAN_IN : croissance de la surface du cadre facial par rapport a la 1re mesure de la fenetre. */
    private static Optional<Long> detecterRapprochement(List<LivenessFrame> fenetre) {
        Double baseline = null;
        for (LivenessFrame f : fenetre) {
            if (f.faceBoxArea() == null) {
                continue;
            }
            if (baseline == null) {
                baseline = f.faceBoxArea();
                continue;
            }
            if (f.faceBoxArea() >= baseline * LivenessThresholds.CROISSANCE_SURFACE_MIN) {
                return Optional.of(f.tMs());
            }
        }
        return Optional.empty();
    }

    private static double nz(Double v) {
        return v == null ? 0 : v;
    }

    private static boolean discontinu(LivenessFrame a, LivenessFrame b) {
        if (a.faceBoxCx() == null || a.faceBoxCy() == null || b.faceBoxCx() == null || b.faceBoxCy() == null) {
            return false; // mesure absente : pas de conclusion, pas de rejet arbitraire
        }
        double dPos = Math.hypot(b.faceBoxCx() - a.faceBoxCx(), b.faceBoxCy() - a.faceBoxCy());
        if (dPos > LivenessThresholds.SAUT_POSITION_MAX) {
            return true;
        }
        if (a.faceBoxArea() != null && b.faceBoxArea() != null && a.faceBoxArea() > 0 && b.faceBoxArea() > 0) {
            double ratio = Math.max(a.faceBoxArea(), b.faceBoxArea()) / Math.min(a.faceBoxArea(), b.faceBoxArea());
            return ratio > LivenessThresholds.SAUT_SURFACE_RATIO_MAX;
        }
        return false;
    }

    private String referenceFace(UUID userId) {
        return jdbc.query(
                        "SELECT rf.image_base64 FROM registration_faces rf "
                                + "JOIN registration_dossiers rd ON rd.id = rf.dossier_id "
                                + "WHERE rd.user_id = ?",
                        (rs, n) -> rs.getString("image_base64"), userId)
                .stream().findFirst().orElse(null);
    }

    private void marquerStatut(UUID challengeId, String statut, String motif) {
        jdbc.update("UPDATE liveness_challenges SET statut = ?, motif_echec = ?, verified_at = now() WHERE id = ?",
                statut, motif, challengeId);
    }

    // ─────────────────────────────── Repli accessibilite ──────────────────────

    /**
     * {@code POST /liveness/challenge/:id/request-review} — demande une revue
     * humaine plutot qu'un nouvel essai automatise. Ce n'est pas un
     * affaiblissement du controle : c'est le meme niveau d'exigence, exerce par
     * un agent au lieu d'un seuil (accessibilite — paralysie faciale,
     * appareillage, mobilite cervicale reduite...).
     *
     * <p>Le circuit de revue humaine reel depend du contexte : pour une
     * inscription, le dossier est de toute facon examine par un agent
     * (Fonctionnalite 4, deja inconditionnel) — cet appel y ajoute simplement
     * une trace explicite. Pour un ordre/une co-signature, il n'existe pas
     * encore d'ecran de revue dedie ; l'entree d'audit reste consultable et
     * actionnable manuellement (limite documentee au recapitulatif).</p>
     */
    public void demanderRevue(UUID userId, UUID challengeId, String ip) {
        ChallengeRow ch = jdbc.query(
                        "SELECT id, user_id, contexte_type, actions, statut, expires_at "
                                + "FROM liveness_challenges WHERE id = ?",
                        CHALLENGE_MAPPER, challengeId)
                .stream().findFirst()
                .orElseThrow(() -> ApiException.notFound("Défi introuvable."));
        if (!ch.userId().equals(userId)) {
            throw ApiException.notFound("Défi introuvable.");
        }
        jdbc.update("UPDATE liveness_challenges SET revue_demandee = TRUE WHERE id = ?", challengeId);
        audit.log(userId.toString(), "REVUE_MANUELLE_DEMANDEE", AuditService.SUCCES,
                ch.contexteType(), ip);
    }

    // ─────────────────────────────── Blocage (3 echecs / 15 min) ─────────────

    private void checkLockout(UUID userId) {
        OffsetDateTime lockedUntil = jdbc.query(
                        "SELECT locked_until FROM liveness_lockouts WHERE user_id = ?",
                        (rs, n) -> rs.getObject("locked_until", OffsetDateTime.class), userId)
                .stream().findFirst().orElse(null);
        if (lockedUntil != null && lockedUntil.isAfter(OffsetDateTime.now())) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "LIVENESS_LOCKED",
                    "Trop de tentatives récentes. Réessayez plus tard, ou demandez une vérification par un agent.");
        }
    }

    private void enregistrerResultatLockout(UUID userId, boolean reussi, String ip) {
        if (reussi) {
            jdbc.update("INSERT INTO liveness_lockouts (user_id, echecs_consecutifs, locked_until, updated_at) "
                            + "VALUES (?, 0, NULL, now()) ON CONFLICT (user_id) DO UPDATE SET "
                            + "echecs_consecutifs = 0, locked_until = NULL, updated_at = now()",
                    userId);
            return;
        }
        int echecs = 1 + jdbc.query(
                        "SELECT echecs_consecutifs FROM liveness_lockouts WHERE user_id = ?",
                        (rs, n) -> rs.getInt("echecs_consecutifs"), userId)
                .stream().findFirst().orElse(0);
        OffsetDateTime lockedUntil = echecs >= MAX_ECHECS_CONSECUTIFS
                ? OffsetDateTime.now().plusSeconds(BLOCAGE_SECONDES) : null;
        jdbc.update("INSERT INTO liveness_lockouts (user_id, echecs_consecutifs, locked_until, updated_at) "
                        + "VALUES (?,?,?, now()) ON CONFLICT (user_id) DO UPDATE SET "
                        + "echecs_consecutifs = EXCLUDED.echecs_consecutifs, "
                        + "locked_until = EXCLUDED.locked_until, updated_at = now()",
                userId, echecs, lockedUntil);
        if (lockedUntil != null) {
            audit.log(userId.toString(), "BLOCAGE_DEFI_VIVACITE", AuditService.ECHEC,
                    "3 echecs consecutifs", ip);
            log.warn("Utilisateur {} bloque pour le defi de vivacite jusqu'a {}", userId, lockedUntil);
        }
    }

    // ─────────────────────────────── JSON utilitaire ─────────────────────────

    private String toJson(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Serialisation JSON impossible", e);
        }
    }

    private List<String> fromJson(String value) {
        try {
            return json.readValue(value, new TypeReference<List<String>>() {
            });
        } catch (Exception e) {
            throw new IllegalStateException("Desserialisation JSON impossible", e);
        }
    }
}
