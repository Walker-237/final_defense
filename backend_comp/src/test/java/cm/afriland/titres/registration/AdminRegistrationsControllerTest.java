package cm.afriland.titres.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.registration.AdminRegistrationsController.ApproveRequest;
import cm.afriland.titres.registration.AdminRegistrationsController.CaptureRow;
import cm.afriland.titres.registration.AdminRegistrationsController.DossierDetail;
import cm.afriland.titres.registration.AdminRegistrationsController.FaceDetail;
import cm.afriland.titres.registration.AdminRegistrationsController.RejectRequest;
import cm.afriland.titres.registration.AdminRegistrationsController.VerifyRequest;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.Permission;

/**
 * Tests for {@link AdminRegistrationsController}.
 *
 * <p>{@link JdbcTemplate} is mocked: {@code RowMapper} lambdas are never actually
 * invoked, so {@code jdbc.query(...)} stubs return ready-made result objects
 * directly (same convention as the other controller tests in this module).</p>
 */
@SuppressWarnings("unchecked")
class AdminRegistrationsControllerTest {

    private JdbcTemplate jdbc;
    private AuditService audit;
    private AdminRegistrationsController controller;
    private AuthUser agent;
    private ClientIp ip;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        audit = mock(AuditService.class);
        controller = new AdminRegistrationsController(jdbc, audit);
        agent = mock(AuthUser.class);
        when(agent.id()).thenReturn(UUID.randomUUID());
        ip = mock(ClientIp.class);
        when(ip.value()).thenReturn("127.0.0.1");
    }

    @Nested
    class List_ {

        @Test
        void requiresClientManagePermission() {
            List<CaptureRow> rows = List.of(new CaptureRow(UUID.randomUUID(), "PP", "Mballa", "Jean", 0.9, "EN_ATTENTE"));
            when(jdbc.query(contains("FROM registration_faces"), any(RowMapper.class))).thenReturn(rows);

            List<CaptureRow> result = controller.list(agent, null);

            verify(agent).require(Permission.CLIENT_MANAGE);
            assertThat(result).hasSize(1);
        }

        @Test
        void withStatusFilter_appliesWhereClause() {
            when(jdbc.query(contains("WHERE f.verification_status = ?"), any(RowMapper.class), eq("VALIDE")))
                    .thenReturn(List.of());

            controller.list(agent, "VALIDE");

            verify(jdbc).query(contains("WHERE f.verification_status = ?"), any(RowMapper.class), eq("VALIDE"));
        }
    }

    @Nested
    class VerifyFace {

        @Test
        void updatesStatus_andLogsAudit() {
            UUID dossierId = UUID.randomUUID();
            when(jdbc.update(contains("UPDATE registration_faces SET verification_status = ?"),
                    eq("VALIDE"), eq(dossierId))).thenReturn(1);

            var body = controller.verifyFace(agent, ip, dossierId, new VerifyRequest("VALIDE"));

            assertThat(body).containsEntry("status", "VALIDE");
            verify(audit).log(any(), eq("VERIFICATION_FACIALE_INSCRIPTION"), eq(AuditService.SUCCES),
                    eq(dossierId.toString()), eq("127.0.0.1"));
        }

        @Test
        void unknownDossier_throwsNotFound() {
            UUID dossierId = UUID.randomUUID();
            when(jdbc.update(contains("UPDATE registration_faces"), eq("REJETE"), eq(dossierId))).thenReturn(0);

            assertThatThrownBy(() -> controller.verifyFace(agent, ip, dossierId, new VerifyRequest("REJETE")))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void anyStatusOtherThanValide_isTreatedAsRejete() {
            UUID dossierId = UUID.randomUUID();
            when(jdbc.update(contains("UPDATE registration_faces"), eq("REJETE"), eq(dossierId))).thenReturn(1);

            var body = controller.verifyFace(agent, ip, dossierId, new VerifyRequest("garbage"));

            assertThat(body).containsEntry("status", "REJETE");
        }
    }

    @Nested
    class Dossier {

        @Test
        void mergesPiecesIntoDossierDetail() {
            UUID dossierId = UUID.randomUUID();
            DossierDetail base = new DossierDetail(dossierId, "EN_ATTENTE_VERIFICATION", "PP",
                    "037100010000000001", null, "jean@example.cm", "Mballa", "Jean", "+237600000000", List.of());
            when(jdbc.query(contains("FROM registration_dossiers d JOIN users u"), any(RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of(base));
            AdminRegistrationsController.PieceDto piece = new AdminRegistrationsController.PieceDto(
                    UUID.randomUUID(), "RECTO", "CNI", "texte", "data:image/jpeg;base64,xx",
                    "SUSPECT", 0.6, "Alignement incoherent.");
            when(jdbc.query(contains("FROM registration_pieces WHERE dossier_id = ?"), any(RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of(piece));

            DossierDetail result = controller.dossier(agent, dossierId);

            assertThat(result.pieces()).containsExactly(piece);
            assertThat(result.email()).isEqualTo("jean@example.cm");
        }

        @Test
        void unknownDossier_throwsNotFound() {
            UUID dossierId = UUID.randomUUID();
            when(jdbc.query(contains("FROM registration_dossiers d JOIN users u"), any(RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of());

            assertThatThrownBy(() -> controller.dossier(agent, dossierId)).isInstanceOf(ApiException.class);
        }
    }

    @Nested
    class Approve {

        @Test
        void withCompteTitres_updatesUserAccount() {
            UUID dossierId = UUID.randomUUID();
            UUID userId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT user_id FROM registration_dossiers"), any(RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of(userId));

            var body = controller.approve(agent, ip, dossierId, new ApproveRequest("037100010000000001"));

            assertThat(body).containsEntry("statut", "VALIDE");
            verify(jdbc).update(contains("SET compte_titres = ?"), eq("037100010000000001"), eq(userId));
        }

        @Test
        void withoutCompteTitres_skipsAccountUpdate() {
            UUID dossierId = UUID.randomUUID();
            UUID userId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT user_id FROM registration_dossiers"), any(RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of(userId));

            controller.approve(agent, ip, dossierId, null);

            verify(jdbc, never()).update(contains("SET compte_titres = ?"), any(), any());
        }
    }

    @Nested
    class Reject {

        @Test
        void suspendsUserAccount_andLogsMotif() {
            UUID dossierId = UUID.randomUUID();
            UUID userId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT user_id FROM registration_dossiers"), any(RowMapper.class), eq(dossierId)))
                    .thenReturn(List.of(userId));

            var body = controller.reject(agent, ip, dossierId, new RejectRequest("Piece illisible"));

            assertThat(body).containsEntry("statut", "REJETE");
            verify(jdbc).update(contains("motif_rejet = ?"), eq("Piece illisible"), eq(dossierId));
            verify(jdbc).update(contains("SET statut = 'SUSPENDU'"), eq(userId));
        }
    }
}
