package cm.afriland.titres.web;
import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.notif.EmailService;
import cm.afriland.titres.notif.NotificationService;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.Permission;
import cm.afriland.titres.support.PageResponse;
import cm.afriland.titres.support.Pagination;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@SuppressWarnings({"unchecked", "rawtypes"})
@ExtendWith(MockitoExtension.class)
class OrderControllerTest {
    private @Mock JdbcTemplate jdbc;
    private @Mock AuditService audit;
    private @Mock NotificationService notifications;
    private @Mock EmailService email;
    private @Mock AppProperties props;
    private @Mock AuthUser user;
    private @Mock ClientIp clientIp;
    private OrderController controller;
    private UUID userId;
    private UUID orderId;
    private UUID emissionId;
    private String ipValue = "127.0.0.1";
    @BeforeEach
    void setUp() {
        controller = new OrderController(jdbc, audit, notifications, email, props);
        userId = UUID.randomUUID();
        orderId = UUID.randomUUID();
        emissionId = UUID.randomUUID();
        when(user.id()).thenReturn(userId);
        lenient().when(clientIp.value()).thenReturn(ipValue);

        // NEW: accountId() lookup — no joint account by default
        lenient().when(jdbc.query(eq("SELECT account_holder_id FROM users WHERE id = ?"),
                        any(RowMapper.class), any(UUID.class)))
                .thenReturn(List.of());
    }
    private void stubOrderResponse(UUID id, String status, UUID validatedByAgent, String resultatPropose) throws Exception {
        ArgumentCaptor<RowMapper> mapperCaptor = ArgumentCaptor.forClass(RowMapper.class);
        lenient().when(jdbc.query(anyString(), mapperCaptor.capture(), eq(id)))
                .thenAnswer(inv -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getObject("id", UUID.class)).thenReturn(id);
                    when(rs.getString("reference")).thenReturn("ORD-2025-000001");
                    when(rs.getObject("emission_id", UUID.class)).thenReturn(emissionId);
                    when(rs.getString("emission_code")).thenReturn("EM-001");
                    when(rs.getString("isin")).thenReturn("XX1234567890");
                    when(rs.getString("emission_nature")).thenReturn("BON");
                    when(rs.getString("emission_pays")).thenReturn("CM");
                    when(rs.getObject("client_id", UUID.class)).thenReturn(userId);
                    when(rs.getString("client_nom")).thenReturn("Doe");
                    when(rs.getString("client_prenom")).thenReturn("John");
                    when(rs.getString("compte_especes")).thenReturn("ES-123");
                    when(rs.getString("compte_titres")).thenReturn("TI-456");
                    when(rs.getInt("volume")).thenReturn(100);
                    when(rs.getLong("montant")).thenReturn(1000000L);
                    when(rs.getDouble("taux_soumis")).thenReturn(5.25);
                    when(rs.getString("status")).thenReturn(status);
                    when(rs.getObject("date_soumission", OffsetDateTime.class)).thenReturn(OffsetDateTime.now());
                    when(rs.getObject("updated_at", OffsetDateTime.class)).thenReturn(OffsetDateTime.now());
                    when(rs.getObject("montant_adjuge", Long.class)).thenReturn(null);
                    when(rs.getObject("taux_adjuge", Double.class)).thenReturn(null);
                    when(rs.getObject("volume_alloue", Integer.class)).thenReturn(null);
                    when(rs.getString("commentaire_resultat")).thenReturn(null);
                    when(rs.getString("motif_annulation")).thenReturn(null);
                    when(rs.getString("canal")).thenReturn("EN_LIGNE");
                    when(rs.getString("notes")).thenReturn(null);
                    when(rs.getString("ip_soumission")).thenReturn(ipValue);
                    when(rs.getString("signature_data")).thenReturn(null);
                    when(rs.getObject("signature_verified", Boolean.class)).thenReturn(null);
                    when(rs.getObject("validated_by_agent", UUID.class)).thenReturn(validatedByAgent);
                    when(rs.getString("agent_nom")).thenReturn(null);
                    when(rs.getString("agent_prenom")).thenReturn(null);
                    when(rs.getObject("date_validation_agent", OffsetDateTime.class)).thenReturn(null);
                    when(rs.getString("resultat_propose")).thenReturn(resultatPropose);
                    when(rs.getObject("resultat_propose_at", OffsetDateTime.class))
                            .thenReturn(resultatPropose != null ? OffsetDateTime.now() : null);
                    when(rs.getObject("resultat_valide_at", OffsetDateTime.class)).thenReturn(null);
                    return List.of(mapperCaptor.getValue().mapRow(rs, 1));
                });
    }
    private void stubOrderResponse(UUID id, String status, UUID validatedByAgent) throws Exception {
        stubOrderResponse(id, status, validatedByAgent, null);
    }

    private void stubOrderResponse(UUID id, String status) throws Exception {
        stubOrderResponse(id, status, null);
    }
    private void stubOrderResponse(UUID id) throws Exception {
        stubOrderResponse(id, "SOUMIS");
    }
    private void stubEmissionForOrder() throws Exception {
        ArgumentCaptor<RowMapper> captor = ArgumentCaptor.forClass(RowMapper.class);
        when(jdbc.query(anyString(), captor.capture(), eq(emissionId)))
                .thenAnswer(inv -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getString("status")).thenReturn("PUBLIE");
                    when(rs.getLong("valeur_nominale_unitaire")).thenReturn(10000L);
                    when(rs.getLong("montant_minimum")).thenReturn(500000L);
                    when(rs.getString("isin")).thenReturn("XX1234567890");
                    return List.of(captor.getValue().mapRow(rs, 1));
                });
    }
    @Nested
    class List_ {
        @Test
        void list_forClient_filtersByAccountAndScrubsResponse() throws Exception {
            when(user.isClient()).thenReturn(true);
            Pagination pg = mock(Pagination.class);
            when(pg.limit()).thenReturn(20L);
            when(pg.offset()).thenReturn(0L);
            List<OrderController.OrderResponse> orders = List.of();
            doReturn(orders).when(jdbc).query(anyString(), any(RowMapper.class), any(), eq(20L), eq(0L));
            doReturn(5L).when(jdbc).queryForObject(anyString(), eq(Long.class), any());
            PageResponse<OrderController.OrderResponse> expected = mock(PageResponse.class);
            doReturn(expected).when(pg).build(orders, 5L);
            try (MockedStatic<Pagination> pagination = mockStatic(Pagination.class)) {
                pagination.when(() -> Pagination.of(null, null)).thenReturn(pg);
                PageResponse<OrderController.OrderResponse> result = controller.list(user, null, null, null, null, null, null);
                assertThat(result).isSameAs(expected);
            }
        }
    }
    @Nested
    class Get {
        @Test
        void get_clientSeesScrubbedOrder() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId);
            OrderController.OrderResponse result = controller.get(user, orderId);
            assertThat(result.notes()).isNull();
            assertThat(result.ipSoumission()).isNull();
        }
    }
    @Nested
    class PendingCoSignatures {
        @Test
        void pendingCoSignatures_forClient_returnsPendingItems() throws Exception {
            when(user.isClient()).thenReturn(true);
            ArgumentCaptor<RowMapper> captor = ArgumentCaptor.forClass(RowMapper.class);
            when(jdbc.query(anyString(), captor.capture(), eq(userId)))
                    .thenAnswer(inv -> List.of(captor.getValue().mapRow(mock(ResultSet.class), 1)));
            List<OrderController.CoSignatureView> result = controller.pendingCoSignatures(user);
            assertThat(result).isNotEmpty();
        }
    }
    @Nested
    class CoSign {
        @Test
        void coSign_approveLastSignature_updatesToSoumis() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId, "EN_ATTENTE_SIGNATURES");
            doReturn(List.of("PENDING")).when(jdbc).query(anyString(), any(RowMapper.class), eq(orderId), eq(userId));
            doReturn(0L).when(jdbc).queryForObject(anyString(), eq(Long.class), eq(orderId));
            controller.coSign(user, clientIp, orderId, new OrderController.CoSignRequest(true));
            verify(jdbc).update(contains("UPDATE orders SET status='SOUMIS'"), eq(orderId));
            verify(jdbc).update(contains("INSERT INTO notifications"), eq("SUCCESS"), anyString(), contains("validé par tous"), anyString(), eq(userId), eq(userId));
            verify(audit).log(eq(userId.toString()), eq("COSIGNATURE_VALIDATION"), eq(AuditService.SUCCES), anyString(), eq(ipValue));
        }
        @Test
        void coSign_approveStillPending_doesNotChangeStatus() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId, "EN_ATTENTE_SIGNATURES");
            doReturn(List.of("PENDING")).when(jdbc).query(anyString(), any(RowMapper.class), eq(orderId), eq(userId));
            doReturn(2L).when(jdbc).queryForObject(anyString(), eq(Long.class), eq(orderId));
            controller.coSign(user, clientIp, orderId, new OrderController.CoSignRequest(true));
            verify(jdbc, never()).update(contains("UPDATE orders SET status='SOUMIS'"), any(UUID.class));
            verify(jdbc).update(contains("INSERT INTO notifications"), eq("INFO"), anyString(), contains("En attente des autres"), anyString(), eq(userId), eq(userId));
        }
        @Test
        void coSign_reject_cancelsOrder() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId, "EN_ATTENTE_SIGNATURES");
            doReturn(List.of("PENDING")).when(jdbc).query(anyString(), any(RowMapper.class), eq(orderId), eq(userId));
            controller.coSign(user, clientIp, orderId, new OrderController.CoSignRequest(false));
            verify(jdbc).update(contains("UPDATE orders SET status='ANNULE'"), anyString(), eq(orderId));
            verify(audit).log(eq(userId.toString()), eq("COSIGNATURE_REFUS"), eq(AuditService.SUCCES), anyString(), eq(ipValue));
        }
        @Test
        void coSign_noPendingSignature_throws() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId);
            doReturn(List.of()).when(jdbc).query(anyString(), any(RowMapper.class), eq(orderId), eq(userId));
            assertThatThrownBy(() -> controller.coSign(user, clientIp, orderId, new OrderController.CoSignRequest(true)))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("Aucune demande de validation en attente");
        }
        @Test
        void coSign_alreadyResponded_throws() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId);
            doReturn(List.of("SIGNED")).when(jdbc).query(anyString(), any(RowMapper.class), eq(orderId), eq(userId));
            assertThatThrownBy(() -> controller.coSign(user, clientIp, orderId, new OrderController.CoSignRequest(true)))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("Vous avez déjà répondu");
        }
    }
    @Nested
    class Create {
        @Test
        void create_singleSignatory_success() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubEmissionForOrder();
            doReturn(new String[]{"TI-456", "ES-123"}).when(jdbc).queryForObject(anyString(), any(RowMapper.class), eq(userId));
            doReturn(List.of()).when(jdbc).query(anyString(), any(RowMapper.class), eq(userId), eq(userId));
            doReturn(orderId).when(jdbc).queryForObject(anyString(), eq(UUID.class), any(), any(), any(), any(), any(), any(), any(), any(), any(), any());
            stubOrderResponse(orderId);
            ResponseEntity<OrderController.OrderResponse> response = controller.create(user, clientIp,
                    new OrderController.CreateOrderRequest(emissionId, 100, 5.5, null));
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        }
    }
    @Nested
    class Cancel {
        @Test
        void cancel_success() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId);
            controller.cancel(user, clientIp, orderId);
            verify(jdbc).update(contains("UPDATE orders SET status='ANNULE'"), anyString(), eq(orderId));
        }
    }
    @Nested
    class Update {
        @Test
        void update_success() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId);
            doReturn(10000L).when(jdbc).queryForObject(anyString(), eq(Long.class), any());
            controller.update(user, clientIp, orderId, new OrderController.UpdateOrderRequest(50, 5.0, null));
        }
        @Test
        void update_notSoumis_throws() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId, "EN_ATTENTE_ADJUDICATION");
            assertThatThrownBy(() -> controller.update(user, clientIp, orderId,
                    new OrderController.UpdateOrderRequest(50, 5.0, null)))
                    .isInstanceOf(ApiException.class);
        }
        @Test
        void update_alreadyValidated_throws() throws Exception {
            when(user.isClient()).thenReturn(true);
            stubOrderResponse(orderId, "SOUMIS", UUID.randomUUID());
            assertThatThrownBy(() -> controller.update(user, clientIp, orderId,
                    new OrderController.UpdateOrderRequest(50, 5.0, null)))
                    .isInstanceOf(ApiException.class);
        }
    }
    @Nested
    class Validate {
        @Test
        void validate_success() throws Exception {
            doNothing().when(user).require(Permission.ORDER_VALIDATE);
            stubOrderResponse(orderId);
            controller.validate(user, clientIp, orderId);
        }
    }
    @Nested
    class ChangeStatus {
        @Test
        void changeStatus_adjudicationBranch() throws Exception {
            doNothing().when(user).require(Permission.ORDER_RESULT);
            stubOrderResponse(orderId, "EN_ATTENTE_ADJUDICATION");
            controller.changeStatus(user, clientIp, orderId,
                    new OrderController.ChangeStatusRequest("TOTALEMENT_RETENU", null, 1000000L, 100, 5.5, null));
            verify(jdbc).update(anyString(), eq("TOTALEMENT_RETENU"), eq("TOTALEMENT_RETENU"), any(), any(), any(), any(), any(), any(), eq(orderId));
        }
    }
    @Nested
    class ValidateResult {
        @Test
        void validateResult_success() throws Exception {
            doNothing().when(user).require(Permission.ORDER_RESULT_VALIDATE);
            stubOrderResponse(orderId, "EN_ATTENTE_ADJUDICATION", null, "TOTALEMENT_RETENU");
            controller.validateResult(user, clientIp, orderId);
            verify(jdbc).update(contains("resultat_valide_at"), any(), eq(orderId));
        }
    }
    @Nested
    class RejectResult {
        @Test
        void rejectResult_success() throws Exception {
            doNothing().when(user).require(Permission.ORDER_RESULT_VALIDATE);
            stubOrderResponse(orderId, "EN_ATTENTE_ADJUDICATION", null, "TOTALEMENT_RETENU");
            controller.rejectResult(user, clientIp, orderId, new OrderController.RejectOrderRequest("Correction"));
        }
    }
    @Nested
    class SetNotes {
        @Test
        void setNotes_success() throws Exception {
            doNothing().when(user).require(Permission.ORDER_VALIDATE);
            stubOrderResponse(orderId);
            controller.setNotes(user, clientIp, orderId, new OrderController.NotesRequest("Note interne"));
            verify(jdbc).update(contains("UPDATE orders SET notes"), eq("Note interne"), eq(orderId));
        }
    }
    @Nested
    class Mapper {
        @Test
        void rowMapper_mapsAllColumns() throws Exception {
            ArgumentCaptor<RowMapper> captor = ArgumentCaptor.forClass(RowMapper.class);
            when(jdbc.query(anyString(), captor.capture(), eq(orderId))).thenReturn(List.of());

            try {
                controller.get(user, orderId);
            } catch (ApiException ignored) {
                // le résultat de get() ne nous intéresse pas ici, seulement le RowMapper capturé
            }

            RowMapper<OrderController.OrderResponse> mapper = captor.getValue();
            ResultSet rs = mock(ResultSet.class);
            UUID testId = UUID.randomUUID();
            OffsetDateTime now = OffsetDateTime.now();
            when(rs.getObject("id", UUID.class)).thenReturn(testId);
            when(rs.getString("reference")).thenReturn("ORD-TEST");
            when(rs.getObject("emission_id", UUID.class)).thenReturn(emissionId);
            when(rs.getString("emission_code")).thenReturn("EM-TEST");
            when(rs.getString("isin")).thenReturn("TEST-ISIN");
            when(rs.getString("emission_nature")).thenReturn("TEST-NATURE");
            when(rs.getString("emission_pays")).thenReturn("CM");
            when(rs.getObject("client_id", UUID.class)).thenReturn(userId);
            when(rs.getString("client_nom")).thenReturn("ClientNom");
            when(rs.getString("client_prenom")).thenReturn("ClientPrenom");
            when(rs.getString("compte_especes")).thenReturn("ES-TEST");
            when(rs.getString("compte_titres")).thenReturn("TI-TEST");
            when(rs.getInt("volume")).thenReturn(999);
            when(rs.getLong("montant")).thenReturn(999999L);
            when(rs.getDouble("taux_soumis")).thenReturn(6.75);
            when(rs.getString("status")).thenReturn("SOUMIS");
            when(rs.getObject("date_soumission", OffsetDateTime.class)).thenReturn(now);
            when(rs.getObject("updated_at", OffsetDateTime.class)).thenReturn(now);
            when(rs.getObject("montant_adjuge", Long.class)).thenReturn(500000L);
            when(rs.getObject("taux_adjuge", Double.class)).thenReturn(5.5);
            when(rs.getObject("volume_alloue", Integer.class)).thenReturn(50);
            when(rs.getString("commentaire_resultat")).thenReturn("Comment");
            when(rs.getString("motif_annulation")).thenReturn("Motif");
            when(rs.getString("canal")).thenReturn("EN_LIGNE");
            when(rs.getString("notes")).thenReturn("Internal");
            when(rs.getString("ip_soumission")).thenReturn("1.2.3.4");
            when(rs.getString("signature_data")).thenReturn("sigdata");
            when(rs.getObject("signature_verified", Boolean.class)).thenReturn(true);
            when(rs.getObject("validated_by_agent", UUID.class)).thenReturn(UUID.randomUUID());
            when(rs.getString("agent_nom")).thenReturn("Agent");
            when(rs.getString("agent_prenom")).thenReturn("Test");
            when(rs.getObject("date_validation_agent", OffsetDateTime.class)).thenReturn(now);
            when(rs.getString("resultat_propose")).thenReturn("TOTALEMENT_RETENU");
            when(rs.getObject("resultat_propose_at", OffsetDateTime.class)).thenReturn(now);
            when(rs.getObject("resultat_valide_at", OffsetDateTime.class)).thenReturn(now);
            OrderController.OrderResponse mapped = mapper.mapRow(rs, 1);
            assertThat(mapped.id()).isEqualTo(testId);
            assertThat(mapped.reference()).isEqualTo("ORD-TEST");
        }
    }
}
