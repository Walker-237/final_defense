package cm.afriland.titres.liveness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.RecordComponent;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.liveness.LivenessChallengeService.ActionAffichee;
import cm.afriland.titres.liveness.LivenessChallengeService.ChallengeRow;
import cm.afriland.titres.liveness.LivenessChallengeService.VerifyRequest;
import cm.afriland.titres.registration.FaceMatchService;

/**
 * Tests for {@link LivenessChallengeService}.
 *
 * <p>{@link JdbcTemplate} is mocked: {@code RowMapper} lambdas are never
 * invoked, so {@code jdbc.query(...)} stubs return ready-made result objects
 * directly (same convention as the rest of this module).</p>
 */
@SuppressWarnings("unchecked")
class LivenessChallengeServiceTest {

    private JdbcTemplate jdbc;
    private FaceMatchService faceMatch;
    private AuditService audit;
    private LivenessChallengeService service;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        faceMatch = mock(FaceMatchService.class);
        audit = mock(AuditService.class);
        service = new LivenessChallengeService(jdbc, new ObjectMapper(), faceMatch, audit);
        // Non bloque par defaut.
        when(jdbc.query(contains("SELECT locked_until"), any(RowMapper.class), any(UUID.class)))
                .thenReturn(List.of());
    }

    // ─────────────────────────────── Tirage ────────────────────────────────

    @Nested
    class TirerActions {

        @Test
        void neverTwoActionsFromTheSameFamily_acrossManyDraws() {
            for (int i = 0; i < 20_000; i++) {
                List<LivenessAction> actions = service.tirerActions();
                assertThat(actions.size()).isIn(2, 3);
                Set<LivenessAction.Family> familles = actions.stream()
                        .map(LivenessAction::family).collect(Collectors.toSet());
                assertThat(familles).as("tirage %s", actions).hasSize(actions.size());
            }
        }

        @Test
        void neverDeducibleFromAClientSuppliedValue() {
            // Regression guard structurel : tirerActions() ne prend AUCUN parametre —
            // rien depuis un appelant ne peut influencer le tirage.
            assertThat(LivenessChallengeService.class)
                    .as("tirerActions doit rester sans parametre (tirage 100%% serveur)")
                    .satisfies(c -> {
                        var m = c.getDeclaredMethod("tirerActions");
                        assertThat(m.getParameterCount()).isZero();
                    });
        }
    }

    // ─────────────────────────────── Reponse API ───────────────────────────

    @Nested
    class ReponseApi {

        @Test
        void verifyResponseNeverCarriesAStepOrReason() {
            RecordComponent[] composants = cm.afriland.titres.liveness.LivenessController.VerifyResponse.class
                    .getRecordComponents();
            assertThat(composants).extracting(RecordComponent::getName).containsExactly("statut");
        }

        @Test
        void challengeCreatedResponseNeverCarriesAThreshold() {
            RecordComponent[] composants = LivenessChallengeService.ActionAffichable.class.getRecordComponents();
            assertThat(composants).extracting(RecordComponent::getName).containsExactly("code", "consigne");
        }
    }

    // ─────────────────────────────── Verification ──────────────────────────

    @Nested
    class Verifier {

        private final UUID userId = UUID.randomUUID();
        private final UUID challengeId = UUID.randomUUID();

        private void stubChallenge(ChallengeRow row) {
            when(jdbc.query(contains("FROM liveness_challenges WHERE id = ?"), any(RowMapper.class), eq(challengeId)))
                    .thenReturn(List.of(row));
        }

        private VerifyRequest emptyRequest() {
            return new VerifyRequest("data:image/jpeg;base64,xx", List.of(), List.of());
        }

        @Test
        void unknownChallenge_isRejected() {
            when(jdbc.query(contains("FROM liveness_challenges WHERE id = ?"), any(RowMapper.class), eq(challengeId)))
                    .thenReturn(List.of());

            String result = service.verifier(userId, challengeId, emptyRequest(), "127.0.0.1");

            assertThat(result).isEqualTo("ECHOUE");
        }

        @Test
        void belongingToAnotherUser_isRejected_andNeverMutatesTheirChallenge() {
            UUID owner = UUID.randomUUID();
            stubChallenge(new ChallengeRow(challengeId, owner, "INSCRIPTION", "[\"TURN_LEFT\",\"MOUTH_OPEN\"]",
                    "EN_ATTENTE", OffsetDateTime.now().plusMinutes(1)));

            String result = service.verifier(userId, challengeId, emptyRequest(), "127.0.0.1");

            assertThat(result).isEqualTo("ECHOUE");
            verify(jdbc, never()).update(contains("SET statut ="), any(), any(), eq(challengeId));
        }

        @Test
        void alreadyConsumed_isRejected() {
            stubChallenge(new ChallengeRow(challengeId, userId, "INSCRIPTION", "[\"TURN_LEFT\",\"MOUTH_OPEN\"]",
                    "REUSSI", OffsetDateTime.now().plusMinutes(1)));

            String result = service.verifier(userId, challengeId, emptyRequest(), "127.0.0.1");

            assertThat(result).isEqualTo("ECHOUE");
        }

        @Test
        void expired_isRejected_andMarkedExpire() {
            stubChallenge(new ChallengeRow(challengeId, userId, "INSCRIPTION", "[\"TURN_LEFT\",\"MOUTH_OPEN\"]",
                    "EN_ATTENTE", OffsetDateTime.now().minusSeconds(5)));

            String result = service.verifier(userId, challengeId, emptyRequest(), "127.0.0.1");

            assertThat(result).isEqualTo("ECHOUE");
            verify(jdbc).update(contains("SET statut = ?, motif_echec = ?"), eq("EXPIRE"), any(), eq(challengeId));
        }

        @Test
        void outOfOrderActions_areRejected() {
            stubChallenge(new ChallengeRow(challengeId, userId, "INSCRIPTION", "[\"TURN_LEFT\",\"MOUTH_OPEN\"]",
                    "EN_ATTENTE", OffsetDateTime.now().plusMinutes(1)));

            // L'utilisateur affiche les consignes dans l'ordre INVERSE de celui tire.
            VerifyRequest req = new VerifyRequest("data:image/jpeg;base64,xx",
                    List.of(new ActionAffichee("MOUTH_OPEN", 0), new ActionAffichee("TURN_LEFT", 3000)),
                    List.of());

            String result = service.verifier(userId, challengeId, req, "127.0.0.1");

            assertThat(result).isEqualTo("ECHOUE");
        }

        @Test
        void responseDelayBelowLowerBound_isRejected_simulatingAPrerecordedStream() {
            stubChallenge(new ChallengeRow(challengeId, userId, "INSCRIPTION", "[\"TURN_LEFT\"]",
                    "EN_ATTENTE", OffsetDateTime.now().plusMinutes(1)));

            // La consigne s'affiche a t=1000, mais le seuil (yaw) est deja franchi a
            // t=1050 — 50 ms de reaction, bien en-dessous de DELAI_MIN_MS (300 ms) :
            // caracteristique d'un flux qui "savait deja" avant l'affichage.
            LivenessFrame trop_rapide = new LivenessFrame(1050, -20.0, 0.0, 0.0,
                    0.0, 0.0, 0.1, 0.0, 0.0, 0.2, 0.5, 0.5);
            VerifyRequest req = new VerifyRequest("data:image/jpeg;base64,xx",
                    List.of(new ActionAffichee("TURN_LEFT", 1000)), List.of(trop_rapide));

            String result = service.verifier(userId, challengeId, req, "127.0.0.1");

            assertThat(result).isEqualTo("ECHOUE");
        }

        @Test
        void fullValidSequence_registrationContext_succeedsWithoutFaceMatch() {
            stubChallenge(new ChallengeRow(challengeId, userId, "INSCRIPTION", "[\"TURN_LEFT\",\"MOUTH_OPEN\"]",
                    "EN_ATTENTE", OffsetDateTime.now().plusMinutes(1)));

            LivenessFrame f1 = new LivenessFrame(1000, -20.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.2, 0.5, 0.5);
            LivenessFrame f2 = new LivenessFrame(6000, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.2, 0.5, 0.5);
            VerifyRequest req = new VerifyRequest("data:image/jpeg;base64,xx",
                    List.of(new ActionAffichee("TURN_LEFT", 0), new ActionAffichee("MOUTH_OPEN", 5000)),
                    List.of(f1, f2));

            String result = service.verifier(userId, challengeId, req, "127.0.0.1");

            assertThat(result).isEqualTo("REUSSI");
            verify(faceMatch, never()).comparer(any(), any());
        }

        @Test
        void fullValidSequence_orderContext_requiresFaceMatch() {
            stubChallenge(new ChallengeRow(challengeId, userId, "ORDRE", "[\"TURN_LEFT\"]",
                    "EN_ATTENTE", OffsetDateTime.now().plusMinutes(1)));
            when(jdbc.query(contains("FROM registration_faces"), any(RowMapper.class), eq(userId)))
                    .thenReturn(List.of("data:image/jpeg;base64,reference"));
            when(faceMatch.comparer(eq("data:image/jpeg;base64,xx"), eq("data:image/jpeg;base64,reference")))
                    .thenReturn(new FaceMatchService.Result("CORRESPOND", 0.9, "RAS."));

            LivenessFrame f1 = new LivenessFrame(1000, -20.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.2, 0.5, 0.5);
            VerifyRequest req = new VerifyRequest("data:image/jpeg;base64,xx",
                    List.of(new ActionAffichee("TURN_LEFT", 0)), List.of(f1));

            String result = service.verifier(userId, challengeId, req, "127.0.0.1");

            assertThat(result).isEqualTo("REUSSI");
        }

        @Test
        void orderContext_noReferenceFace_isRejected() {
            stubChallenge(new ChallengeRow(challengeId, userId, "ORDRE", "[\"TURN_LEFT\"]",
                    "EN_ATTENTE", OffsetDateTime.now().plusMinutes(1)));
            when(jdbc.query(contains("FROM registration_faces"), any(RowMapper.class), eq(userId)))
                    .thenReturn(List.of());

            LivenessFrame f1 = new LivenessFrame(1000, -20.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.2, 0.5, 0.5);
            VerifyRequest req = new VerifyRequest("data:image/jpeg;base64,xx",
                    List.of(new ActionAffichee("TURN_LEFT", 0)), List.of(f1));

            String result = service.verifier(userId, challengeId, req, "127.0.0.1");

            assertThat(result).isEqualTo("ECHOUE");
            verify(faceMatch, never()).comparer(any(), any());
        }

        @Test
        void discontinuousFaceBox_isRejected() {
            stubChallenge(new ChallengeRow(challengeId, userId, "INSCRIPTION", "[\"TURN_LEFT\"]",
                    "EN_ATTENTE", OffsetDateTime.now().plusMinutes(1)));

            // Le seuil TURN_LEFT est franchi normalement, mais le cadre facial saute
            // brutalement de position entre deux images consecutives — signe d'un
            // changement de flux en cours de defi.
            LivenessFrame f1 = new LivenessFrame(1000, -20.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.2, 0.2, 0.2);
            LivenessFrame f2 = new LivenessFrame(1500, -25.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.2, 0.9, 0.9);
            VerifyRequest req = new VerifyRequest("data:image/jpeg;base64,xx",
                    List.of(new ActionAffichee("TURN_LEFT", 0)), List.of(f1, f2));

            String result = service.verifier(userId, challengeId, req, "127.0.0.1");

            assertThat(result).isEqualTo("ECHOUE");
        }

        @Test
        void threeConsecutiveFailures_lockOutAndAudit() {
            when(jdbc.query(contains("SELECT echecs_consecutifs"), any(RowMapper.class), eq(userId)))
                    .thenReturn(List.of(0), List.of(1), List.of(2));
            stubChallenge(new ChallengeRow(challengeId, userId, "INSCRIPTION", "[\"TURN_LEFT\"]",
                    "EN_ATTENTE", OffsetDateTime.now().minusSeconds(1))); // expire -> echec garanti et deterministe

            for (int i = 0; i < 3; i++) {
                service.verifier(userId, challengeId, emptyRequest(), "127.0.0.1");
            }

            verify(audit, times(1)).log(eq(userId.toString()), eq("BLOCAGE_DEFI_VIVACITE"),
                    eq(AuditService.ECHEC), any(), eq("127.0.0.1"));
        }
    }

    // ─────────────────────────────── Blocage ────────────────────────────────

    @Nested
    class Lockout {

        @Test
        void lockedUser_cannotRequestANewChallenge() {
            UUID userId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT locked_until"), any(RowMapper.class), eq(userId)))
                    .thenReturn(List.of(OffsetDateTime.now().plusMinutes(10)));

            assertThatThrownBy(() -> service.creer(userId, "INSCRIPTION", null, "127.0.0.1"))
                    .isInstanceOf(ApiException.class)
                    .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS));
        }

        @Test
        void expiredLock_doesNotBlock() {
            UUID userId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT locked_until"), any(RowMapper.class), eq(userId)))
                    .thenReturn(List.of(OffsetDateTime.now().minusMinutes(1)));
            when(jdbc.queryForObject(contains("INSERT INTO liveness_challenges"), eq(UUID.class),
                    eq(userId), any(), any(), any(), any())).thenReturn(UUID.randomUUID());

            LivenessChallengeService.ChallengeCree result = service.creer(userId, "INSCRIPTION", null, "127.0.0.1");

            assertThat(result).isNotNull();
        }
    }

    // ─────────────────────────────── Repli accessibilite ────────────────────

    @Nested
    class DemanderRevue {

        @Test
        void ownChallenge_marksReviewRequested() {
            UUID userId = UUID.randomUUID();
            UUID challengeId = UUID.randomUUID();
            when(jdbc.query(contains("FROM liveness_challenges WHERE id = ?"), any(RowMapper.class), eq(challengeId)))
                    .thenReturn(List.of(new ChallengeRow(challengeId, userId, "INSCRIPTION", "[]", "ECHOUE",
                            OffsetDateTime.now().plusMinutes(1))));

            service.demanderRevue(userId, challengeId, "127.0.0.1");

            verify(jdbc).update(contains("revue_demandee = TRUE"), eq(challengeId));
            verify(audit).log(eq(userId.toString()), eq("REVUE_MANUELLE_DEMANDEE"), any(), any(), any());
        }

        @Test
        void unknownChallenge_throwsNotFound() {
            UUID userId = UUID.randomUUID();
            UUID challengeId = UUID.randomUUID();
            when(jdbc.query(contains("FROM liveness_challenges WHERE id = ?"), any(RowMapper.class), eq(challengeId)))
                    .thenReturn(List.of());

            assertThatThrownBy(() -> service.demanderRevue(userId, challengeId, "127.0.0.1"))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void othersChallenge_throwsNotFound() {
            UUID userId = UUID.randomUUID();
            UUID owner = UUID.randomUUID();
            UUID challengeId = UUID.randomUUID();
            when(jdbc.query(contains("FROM liveness_challenges WHERE id = ?"), any(RowMapper.class), eq(challengeId)))
                    .thenReturn(List.of(new ChallengeRow(challengeId, owner, "INSCRIPTION", "[]", "ECHOUE",
                            OffsetDateTime.now().plusMinutes(1))));

            assertThatThrownBy(() -> service.demanderRevue(userId, challengeId, "127.0.0.1"))
                    .isInstanceOf(ApiException.class);
        }
    }
}
