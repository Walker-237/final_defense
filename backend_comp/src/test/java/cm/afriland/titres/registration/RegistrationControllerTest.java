package cm.afriland.titres.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.registration.RegistrationController.ConventionDto;
import cm.afriland.titres.registration.RegistrationController.FaceRequest;
import cm.afriland.titres.registration.RegistrationController.PieceRequest;
import cm.afriland.titres.registration.RegistrationController.RegisterRequest;
import cm.afriland.titres.registration.RegistrationController.RegisterResponse;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.JwtService;
import cm.afriland.titres.security.PasswordService;

/**
 * Tests for {@link RegistrationController}.
 *
 * <p>{@link JdbcTemplate} is mocked: the {@code RowMapper} lambdas built inside
 * the controller are never invoked, so {@code jdbc.query(...)} stubs return
 * ready-made result objects directly (same convention as the other controller
 * tests in this module).</p>
 */
@SuppressWarnings("unchecked")
class RegistrationControllerTest {

    private JdbcTemplate jdbc;
    private AppProperties props;
    private JwtService jwt;
    private PasswordService password;
    private IdAuthenticityService authenticity;
    private FaceMatchService faceMatch;
    private RegistrationController controller;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        props = mock(AppProperties.class);
        jwt = mock(JwtService.class);
        password = mock(PasswordService.class);
        authenticity = mock(IdAuthenticityService.class);
        faceMatch = mock(FaceMatchService.class);
        controller = new RegistrationController(jdbc, props, jwt, password, authenticity, faceMatch);
    }

    private AuthUser userWithId(UUID id) {
        AuthUser user = mock(AuthUser.class);
        when(user.id()).thenReturn(id);
        return user;
    }

    private RegisterRequest registerRequest(String email) {
        return new RegisterRequest(email, "Passw0rd!", "Mballa", "Jean", "+237600000000",
                "PP", "INDIVIDUEL", "037100010000000000");
    }

    @Nested
    class Register {

        @Test
        void newEmail_createsUserAndDossier_andIssuesToken() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            when(jdbc.queryForObject(eq("SELECT count(*) FROM users WHERE email = ?"), eq(Long.class),
                    eq("jean.mballa@example.cm"))).thenReturn(0L);
            when(password.hash("Passw0rd!")).thenReturn("hashed");
            when(jdbc.queryForObject(contains("INSERT INTO users"), eq(UUID.class), any(), any(), any(), any(),
                    any(), any(), any(), any())).thenReturn(userId);
            when(jdbc.queryForObject(contains("INSERT INTO registration_dossiers"), eq(UUID.class), any(), any(),
                    any())).thenReturn(dossierId);
            when(jwt.issue(userId, "jean.mballa@example.cm", "CLIENT_PP", false)).thenReturn("token123");
            when(props.getAccessTokenTtl()).thenReturn(900L);

            RegisterResponse response = controller.register(registerRequest("Jean.Mballa@example.cm"));

            assertThat(response.dossierId()).isEqualTo(dossierId);
            assertThat(response.titulaireId()).isEqualTo(userId);
            assertThat(response.auth().accessToken()).isEqualTo("token123");
            assertThat(response.auth().tokenType()).isEqualTo("Bearer");
            assertThat(response.auth().expiresIn()).isEqualTo(900L);
        }

        @Test
        void existingEmail_throwsConflict() {
            // 409, pas 400 : le frontend (auth.ts, RegisterPPPage.messageErreur()) distingue
            // explicitement ce cas d'une saisie invalide via le code de statut HTTP.
            when(jdbc.queryForObject(eq("SELECT count(*) FROM users WHERE email = ?"), eq(Long.class),
                    eq("jean.mballa@example.cm"))).thenReturn(1L);

            assertThatThrownBy(() -> controller.register(registerRequest("jean.mballa@example.cm")))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("existe deja")
                    .satisfies(e -> assertThat(((ApiException) e).getStatus())
                            .isEqualTo(org.springframework.http.HttpStatus.CONFLICT));
        }
    }

    @Nested
    class GetDossier {

        @Test
        void ownDossier_returnsState() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "BROUILLON", "PP", "INDIVIDUEL")));
            when(jdbc.queryForList(contains("FROM registration_pieces WHERE dossier_id = ?"), eq(dossierId)))
                    .thenReturn(List.of());
            when(jdbc.queryForObject(contains("EXISTS(SELECT 1 FROM registration_faces"), eq(Boolean.class),
                    eq(dossierId))).thenReturn(false);

            var body = controller.getDossier(userWithId(userId), dossierId);

            assertThat(body).containsEntry("dossierId", dossierId).containsEntry("statut", "BROUILLON");
        }

        @Test
        void otherUsersDossier_throwsNotFound() {
            UUID ownerId = UUID.randomUUID();
            UUID otherId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, ownerId, "BROUILLON", "PP", "INDIVIDUEL")));

            assertThatThrownBy(() -> controller.getDossier(userWithId(otherId), dossierId))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("introuvable");
        }

        @Test
        void unknownDossier_throwsNotFound() {
            UUID dossierId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of());

            assertThatThrownBy(() -> controller.getDossier(userWithId(UUID.randomUUID()), dossierId))
                    .isInstanceOf(ApiException.class);
        }
    }

    @Nested
    class UploadFace {

        @Test
        void ownDossier_insertsFaceRow() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            UUID faceId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "BROUILLON", "PP", "INDIVIDUEL")));
            when(jdbc.queryForObject(contains("INSERT INTO registration_faces"), eq(UUID.class),
                    any(), any(), any(), anyDouble(), any(), any(), any(), any(), any())).thenReturn(faceId);

            FaceRequest req = new FaceRequest("data:image/jpeg;base64,xx", "[[0.1,0.2,0.3]]", 0.92, true,
                    "BLINK", 480, 640, List.of(0.1, 0.2, 0.3));
            var body = controller.uploadFace(userWithId(userId), dossierId, req);

            assertThat(body).containsEntry("faceId", faceId);
            verify(jdbc).update(eq("UPDATE registration_dossiers SET updated_at = now() WHERE id = ?"), eq(dossierId));
        }

        @Test
        void existingRectoPiece_triggersFaceMatchUpdate() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            UUID faceId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "BROUILLON", "PP", "INDIVIDUEL")));
            when(jdbc.queryForObject(contains("INSERT INTO registration_faces"), eq(UUID.class),
                    any(), any(), any(), anyDouble(), any(), any(), any(), any(), any())).thenReturn(faceId);
            when(jdbc.query(eq("SELECT image_base64 FROM registration_faces WHERE dossier_id = ?"),
                    any(org.springframework.jdbc.core.RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of("data:image/jpeg;base64,selfie"));
            when(jdbc.query(contains("FROM registration_pieces WHERE dossier_id = ? AND cote = 'RECTO'"),
                    any(org.springframework.jdbc.core.RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of("data:image/jpeg;base64,piece"));
            FaceMatchService.Result result = new FaceMatchService.Result("CORRESPOND", 0.9, "Traits coherents.");
            when(faceMatch.comparer("data:image/jpeg;base64,selfie", "data:image/jpeg;base64,piece"))
                    .thenReturn(result);

            FaceRequest req = new FaceRequest("data:image/jpeg;base64,selfie", "[[0.1,0.2,0.3]]", 0.92, true,
                    "BLINK", 480, 640, List.of(0.1, 0.2, 0.3));
            controller.uploadFace(userWithId(userId), dossierId, req);

            verify(jdbc).update(contains("face_match_verdict"), eq("CORRESPOND"), eq(0.9),
                    eq("Traits coherents."), eq(dossierId));
        }

        @Test
        void noPieceYet_skipsFaceMatch_silently() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            UUID faceId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "BROUILLON", "PP", "INDIVIDUEL")));
            when(jdbc.queryForObject(contains("INSERT INTO registration_faces"), eq(UUID.class),
                    any(), any(), any(), anyDouble(), any(), any(), any(), any(), any())).thenReturn(faceId);
            when(jdbc.query(eq("SELECT image_base64 FROM registration_faces WHERE dossier_id = ?"),
                    any(org.springframework.jdbc.core.RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of("data:image/jpeg;base64,selfie"));
            when(jdbc.query(contains("FROM registration_pieces WHERE dossier_id = ? AND cote = 'RECTO'"),
                    any(org.springframework.jdbc.core.RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of());

            FaceRequest req = new FaceRequest("data:image/jpeg;base64,selfie", "[[0.1,0.2,0.3]]", 0.92, true,
                    "BLINK", 480, 640, List.of(0.1, 0.2, 0.3));
            controller.uploadFace(userWithId(userId), dossierId, req);

            verify(faceMatch, org.mockito.Mockito.never()).comparer(any(), any());
            verify(jdbc, org.mockito.Mockito.never()).update(contains("face_match_verdict"), any(), any(), any(), any());
        }
    }

    @Nested
    class UploadPiece {

        @Test
        void ownDossier_storesAuthenticityVerdict() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            UUID pieceId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "BROUILLON", "PP", "INDIVIDUEL")));
            IdAuthenticityService.Result result = new IdAuthenticityService.Result("SUSPECT", 0.7, "Alignement incoherent.");
            when(authenticity.analyser("data:image/jpeg;base64,xx")).thenReturn(result);
            when(jdbc.queryForObject(contains("INSERT INTO registration_pieces"), eq(UUID.class),
                    any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(pieceId);

            PieceRequest req = new PieceRequest("data:image/jpeg;base64,xx", "RECTO", "CNI", "texte ocr", 80.0, 1200, 800);
            var body = controller.uploadPiece(userWithId(userId), dossierId, req);

            assertThat(body).containsEntry("pieceId", pieceId);
            verify(jdbc).queryForObject(contains("authenticite_verdict"), eq(UUID.class),
                    eq(dossierId), eq("RECTO"), eq("CNI"), eq("texte ocr"), eq(80.0), eq(1200), eq(800),
                    eq("data:image/jpeg;base64,xx"), eq("SUSPECT"), eq(0.7), eq("Alignement incoherent."));
        }

        @Test
        void rectoWithExistingFace_triggersFaceMatchUpdate() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            UUID pieceId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "BROUILLON", "PP", "INDIVIDUEL")));
            when(authenticity.analyser(any())).thenReturn(
                    new IdAuthenticityService.Result("AUTHENTIQUE", 0.8, "RAS."));
            when(jdbc.queryForObject(contains("INSERT INTO registration_pieces"), eq(UUID.class),
                    any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(pieceId);
            when(jdbc.query(eq("SELECT image_base64 FROM registration_faces WHERE dossier_id = ?"),
                    any(org.springframework.jdbc.core.RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of("data:image/jpeg;base64,selfie"));
            when(jdbc.query(contains("FROM registration_pieces WHERE dossier_id = ? AND cote = 'RECTO'"),
                    any(org.springframework.jdbc.core.RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of("data:image/jpeg;base64,piece"));
            FaceMatchService.Result result = new FaceMatchService.Result("NE_CORRESPOND_PAS", 0.85, "Traits differents.");
            when(faceMatch.comparer("data:image/jpeg;base64,selfie", "data:image/jpeg;base64,piece"))
                    .thenReturn(result);

            PieceRequest req = new PieceRequest("data:image/jpeg;base64,piece", "RECTO", "CNI", "texte", 80.0, 1200, 800);
            controller.uploadPiece(userWithId(userId), dossierId, req);

            verify(jdbc).update(contains("face_match_verdict"), eq("NE_CORRESPOND_PAS"), eq(0.85),
                    eq("Traits differents."), eq(dossierId));
        }

        @Test
        void versoUpload_neverTriggersFaceMatch() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            UUID pieceId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "BROUILLON", "PP", "INDIVIDUEL")));
            when(authenticity.analyser(any())).thenReturn(
                    new IdAuthenticityService.Result("AUTHENTIQUE", 0.8, "RAS."));
            when(jdbc.queryForObject(contains("INSERT INTO registration_pieces"), eq(UUID.class),
                    any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(pieceId);

            PieceRequest req = new PieceRequest("data:image/jpeg;base64,piece", "VERSO", "CNI", "texte", 80.0, 1200, 800);
            controller.uploadPiece(userWithId(userId), dossierId, req);

            verify(faceMatch, org.mockito.Mockito.never()).comparer(any(), any());
            verify(jdbc, org.mockito.Mockito.never()).query(
                    eq("SELECT image_base64 FROM registration_faces WHERE dossier_id = ?"),
                    any(org.springframework.jdbc.core.RowMapper.class), eq(dossierId));
        }
    }

    @Nested
    class Submit {

        @Test
        void draftDossier_movesToPendingVerification() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "BROUILLON", "PP", "INDIVIDUEL")));

            var body = controller.submit(userWithId(userId), dossierId);

            assertThat(body).containsEntry("statut", "EN_ATTENTE_VERIFICATION");
            verify(jdbc).update(contains("SET statut = 'EN_ATTENTE_VERIFICATION'"), eq(dossierId));
        }

        @Test
        void alreadySubmittedDossier_throwsBadRequest() {
            UUID userId = UUID.randomUUID();
            UUID dossierId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers WHERE id = ?"), any(org.springframework.jdbc.core.RowMapper.class),
                    eq(dossierId))).thenReturn(List.of(
                            row(dossierId, userId, "EN_ATTENTE_VERIFICATION", "PP", "INDIVIDUEL")));

            assertThatThrownBy(() -> controller.submit(userWithId(userId), dossierId))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("deja");
        }
    }

    @Nested
    class Convention {

        @Test
        void french_isDefault() {
            ConventionDto dto = controller.convention("FR");
            assertThat(dto.langue()).isEqualTo("FR");
            assertThat(dto.contenuHtml()).isNotBlank();
        }

        @Test
        void english_whenRequested() {
            ConventionDto dto = controller.convention("EN");
            assertThat(dto.langue()).isEqualTo("EN");
            assertThat(dto.contenuHtml()).isNotBlank();
        }
    }

    /** Construit une ligne telle que renvoyee par {@code DOSSIER_MAPPER} — jamais execute
     *  reellement puisque {@code jdbc} est un mock, mais garde la forme des colonnes lisible. */
    private static RegistrationController.Dossier row(UUID id, UUID userId, String statut,
                                                       String typePersonne, String typeCompte) {
        return new RegistrationController.Dossier(id, userId, statut, typePersonne, typeCompte);
    }
}
