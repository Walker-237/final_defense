package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Tests for {@link JointSignatureScheduler}.
 *
 * <h2>Assumptions made</h2>
 * <ul>
 * <li>{@code queryForList} rows expose keys {@code "id"}, {@code "client_id"} (both
 *     {@link UUID}), and {@code "reference"} (String).</li>
 * <li>The bulk EXPIRED update is a no-arg {@code update(String)} call; the per-order
 *     cancellation and notification-insert calls use {@code update(String, Object...)}.</li>
 * </ul>
 */
class JointSignatureSchedulerTest {

    private JdbcTemplate jdbc;
    private JointSignatureScheduler scheduler;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        scheduler = new JointSignatureScheduler(jdbc);
    }

    private Map<String, Object> order(UUID id, UUID clientId, String reference) {
        return Map.of("id", id, "client_id", clientId, "reference", reference);
    }

    @Nested
    class NoExpiredOrders {

        @Test
        void emptyResult_returnsEarly_issuesNoUpdates() {
            when(jdbc.queryForList(anyString())).thenReturn(List.of());

            scheduler.rejectExpired();

            verify(jdbc).queryForList(anyString());
            verifyNoMoreInteractions(jdbc);
        }
    }

    @Nested
    class ExpiredOrders {

        @Test
        void orderStillEligible_cancelsOrder_andInsertsNotification() {
            UUID id = UUID.randomUUID();
            UUID account = UUID.randomUUID();
            String reference = "ORD-1001";
            when(jdbc.queryForList(anyString())).thenReturn(List.of(order(id, account, reference)));
            when(jdbc.update(anyString())).thenReturn(1);
            when(jdbc.update(anyString(), eq(id))).thenReturn(1);
            when(jdbc.update(anyString(), any(), any(), any(), any())).thenReturn(2);

            scheduler.rejectExpired();

            verify(jdbc).update(anyString());
            verify(jdbc).update(anyString(), eq(id));
            String expectedMessage = "L'ordre " + reference
                    + " a été rejeté : un signataire n'a pas validé l'opération dans le délai imparti.";
            verify(jdbc).update(anyString(), eq(expectedMessage), eq(reference), eq(account), eq(account));
        }

        @Test
        void orderNoLongerEligible_skipsNotification() {
            UUID id = UUID.randomUUID();
            UUID account = UUID.randomUUID();
            when(jdbc.queryForList(anyString())).thenReturn(List.of(order(id, account, "ORD-1002")));
            when(jdbc.update(anyString())).thenReturn(1);
            when(jdbc.update(anyString(), eq(id))).thenReturn(0);

            scheduler.rejectExpired();

            verify(jdbc).update(anyString(), eq(id));
            verify(jdbc, never()).update(anyString(), any(), any(), any(), any());
        }

        @Test
        void multipleOrders_processesEachIndependently() {
            UUID id1 = UUID.randomUUID();
            UUID account1 = UUID.randomUUID();
            UUID id2 = UUID.randomUUID();
            UUID account2 = UUID.randomUUID();
            when(jdbc.queryForList(anyString())).thenReturn(List.of(
                    order(id1, account1, "ORD-2001"),
                    order(id2, account2, "ORD-2002")));
            when(jdbc.update(anyString())).thenReturn(1);
            when(jdbc.update(anyString(), eq(id1))).thenReturn(1);
            when(jdbc.update(anyString(), eq(id2))).thenReturn(0);
            when(jdbc.update(anyString(), any(), any(), any(), any())).thenReturn(1);

            scheduler.rejectExpired();

            verify(jdbc).update(anyString(), eq(id1));
            verify(jdbc).update(anyString(), eq(id2));
            verify(jdbc).update(anyString(), any(), any(), eq(account1), eq(account1));
            verify(jdbc, never()).update(anyString(), any(), any(), eq(account2), eq(account2));
        }
    }

    @Nested
    class ErrorHandling {

        @Test
        void exceptionDuringQuery_isCaughtAndDoesNotPropagate() {
            when(jdbc.queryForList(anyString())).thenThrow(new RuntimeException("db down"));

            assertThatCode(() -> scheduler.rejectExpired()).doesNotThrowAnyException();
        }

        @Test
        void exceptionDuringCancelUpdate_isCaughtAndDoesNotPropagate() {
            UUID id = UUID.randomUUID();
            UUID account = UUID.randomUUID();
            when(jdbc.queryForList(anyString())).thenReturn(List.of(order(id, account, "ORD-3001")));
            when(jdbc.update(anyString())).thenReturn(1);
            when(jdbc.update(anyString(), eq(id))).thenThrow(new RuntimeException("constraint violation"));

            assertThatCode(() -> scheduler.rejectExpired()).doesNotThrowAnyException();
        }
    }
}