package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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
import org.springframework.jdbc.core.RowMapper;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.registration.FaceMatchService;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.Permission;
import cm.afriland.titres.web.OrderFaceCheckController.FaceCheckRequest;
import cm.afriland.titres.web.OrderFaceCheckController.FaceCheckResult;
import cm.afriland.titres.web.OrderFaceCheckController.OrderFaceCheckDetail;
import cm.afriland.titres.web.OrderFaceCheckController.VerifyRequest;

/**
 * Tests for {@link OrderFaceCheckController}.
 *
 * <p>{@link JdbcTemplate} is mocked: {@code RowMapper} lambdas are never invoked,
 * so {@code jdbc.query(...)} stubs return ready-made result objects directly
 * (same convention as the other controller tests in this project).</p>
 */
@SuppressWarnings("unchecked")
class OrderFaceCheckControllerTest {

    private JdbcTemplate jdbc;
    private FaceMatchService faceMatch;
    private AuditService audit;
    private OrderFaceCheckController controller;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        faceMatch = mock(FaceMatchService.class);
        audit = mock(AuditService.class);
        controller = new OrderFaceCheckController(jdbc, faceMatch, audit);
    }

    private AuthUser userWithId(UUID id) {
        AuthUser user = mock(AuthUser.class);
        when(user.id()).thenReturn(id);
        return user;
    }

    @Nested
    class Check {

        @Test
        void otherClientsOrder_throwsNotFound() {
            UUID orderId = UUID.randomUUID();
            UUID ownerId = UUID.randomUUID();
            UUID otherId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT client_id FROM orders"), any(RowMapper.class), eq(orderId)))
                    .thenReturn(List.of(ownerId));

            FaceCheckRequest req = new FaceCheckRequest("data:image/jpeg;base64,xx", 0.9, "BLINK", List.of());

            assertThatThrownBy(() -> controller.check(userWithId(otherId), orderId, req))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void noReferenceFace_returnsNonComparable_stillStoresCheck() {
            UUID orderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT client_id FROM orders"), any(RowMapper.class), eq(orderId)))
                    .thenReturn(List.of(clientId));
            when(jdbc.query(contains("FROM registration_faces"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of());

            FaceCheckRequest req = new FaceCheckRequest("data:image/jpeg;base64,xx", 0.9, "BLINK", List.of());
            FaceCheckResult result = controller.check(userWithId(clientId), orderId, req);

            assertThat(result.matchStatus()).isEqualTo("NON_COMPARABLE");
            assertThat(result.matched()).isFalse();
            assertThat(result.distance()).isEqualTo(-1);
            verify(faceMatch, org.mockito.Mockito.never()).comparer(any(), any());
            verify(jdbc).update(contains("INSERT INTO order_face_checks"), eq(orderId),
                    eq("data:image/jpeg;base64,xx"), eq(0.9), eq("BLINK"), any(),
                    eq("NON_COMPARABLE"), eq((Double) null), any());
        }

        @Test
        void withReferenceFace_correspond_mapsVerdictAndStoresResult() {
            UUID orderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT client_id FROM orders"), any(RowMapper.class), eq(orderId)))
                    .thenReturn(List.of(clientId));
            when(jdbc.query(contains("FROM registration_faces"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("data:image/jpeg;base64,reference"));
            when(faceMatch.comparer("data:image/jpeg;base64,xx", "data:image/jpeg;base64,reference"))
                    .thenReturn(new FaceMatchService.Result("CORRESPOND", 0.87, "Traits coherents."));

            FaceCheckRequest req = new FaceCheckRequest("data:image/jpeg;base64,xx", 0.9, "BLINK", List.of(0.1, 0.2));
            FaceCheckResult result = controller.check(userWithId(clientId), orderId, req);

            assertThat(result.matchStatus()).isEqualTo("CORRESPOND");
            assertThat(result.matched()).isTrue();
            assertThat(result.distance()).isCloseTo(0.13, org.assertj.core.data.Offset.offset(0.001));
            verify(jdbc).update(contains("INSERT INTO order_face_checks"), eq(orderId), any(), any(), any(),
                    any(), eq("CORRESPOND"), eq(0.87), eq("Traits coherents."));
        }

        @Test
        void withReferenceFace_neCorrespondPas_mapsToDifferent() {
            UUID orderId = UUID.randomUUID();
            UUID clientId = UUID.randomUUID();
            when(jdbc.query(contains("SELECT client_id FROM orders"), any(RowMapper.class), eq(orderId)))
                    .thenReturn(List.of(clientId));
            when(jdbc.query(contains("FROM registration_faces"), any(RowMapper.class), eq(clientId)))
                    .thenReturn(List.of("data:image/jpeg;base64,reference"));
            when(faceMatch.comparer(any(), any()))
                    .thenReturn(new FaceMatchService.Result("NE_CORRESPOND_PAS", 0.75, "Traits differents."));

            FaceCheckRequest req = new FaceCheckRequest("data:image/jpeg;base64,xx", 0.9, "BLINK", List.of());
            FaceCheckResult result = controller.check(userWithId(clientId), orderId, req);

            assertThat(result.matchStatus()).isEqualTo("DIFFERENT");
            assertThat(result.matched()).isFalse();
        }
    }

    @Nested
    class AdminGet {

        @Test
        void requiresClientManagePermission_andReturnsDetail() {
            UUID orderId = UUID.randomUUID();
            AuthUser agent = mock(AuthUser.class);
            OrderFaceCheckDetail detail = new OrderFaceCheckDetail(orderId, "data:ouverture", "data:ordre",
                    0.2, 0.5, "CORRESPOND", 0.9, "EN_ATTENTE", 0.8, "RAS.");
            when(jdbc.query(contains("FROM order_face_checks"), any(RowMapper.class), eq(orderId)))
                    .thenReturn(List.of(detail));

            OrderFaceCheckDetail result = controller.adminGet(agent, orderId);

            verify(agent).require(Permission.CLIENT_MANAGE);
            assertThat(result.tauxFiabilite()).isEqualTo(0.8);
        }

        @Test
        void noCheckForOrder_throwsNotFound() {
            UUID orderId = UUID.randomUUID();
            AuthUser agent = mock(AuthUser.class);
            when(jdbc.query(contains("FROM order_face_checks"), any(RowMapper.class), eq(orderId)))
                    .thenReturn(List.of());

            assertThatThrownBy(() -> controller.adminGet(agent, orderId)).isInstanceOf(ApiException.class);
        }
    }

    @Nested
    class AdminVerify {

        @Test
        void updatesStatus_andLogsAudit() {
            UUID orderId = UUID.randomUUID();
            AuthUser agent = mock(AuthUser.class);
            when(agent.id()).thenReturn(UUID.randomUUID());
            ClientIp ip = mock(ClientIp.class);
            when(ip.value()).thenReturn("127.0.0.1");
            when(jdbc.update(contains("UPDATE order_face_checks"), eq("VALIDE"), eq(orderId))).thenReturn(1);

            var body = controller.adminVerify(agent, ip, orderId, new VerifyRequest("VALIDE"));

            assertThat(body).containsEntry("status", "VALIDE");
            verify(agent).require(Permission.CLIENT_MANAGE);
            verify(audit).log(any(), eq("VERIFICATION_FACIALE_ORDRE"), eq(AuditService.SUCCES),
                    eq(orderId.toString()), eq("127.0.0.1"));
        }

        @Test
        void unknownCheck_throwsNotFound() {
            UUID orderId = UUID.randomUUID();
            AuthUser agent = mock(AuthUser.class);
            ClientIp ip = mock(ClientIp.class);
            when(jdbc.update(contains("UPDATE order_face_checks"), eq("REJETE"), eq(orderId))).thenReturn(0);

            assertThatThrownBy(() -> controller.adminVerify(agent, ip, orderId, new VerifyRequest("REJETE")))
                    .isInstanceOf(ApiException.class);
        }
    }
}
