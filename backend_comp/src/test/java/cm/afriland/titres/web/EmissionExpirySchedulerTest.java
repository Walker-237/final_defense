package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;

@ExtendWith(MockitoExtension.class)
class EmissionExpirySchedulerTest {

    @Mock
    private JdbcTemplate jdbc;

    private EmissionExpiryScheduler scheduler;

    @BeforeEach
    void setUp() {
        scheduler = new EmissionExpiryScheduler(jdbc);
    }

    @Nested
    class ClosesExpiredEmissions {

        @Test
        void updatesRowsAndUsesExpectedSql() {
            when(jdbc.update(anyString())).thenReturn(3);

            scheduler.closeExpired();

            ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
            verify(jdbc, times(1)).update(sqlCaptor.capture());
            verifyNoMoreInteractions(jdbc);

            String sql = sqlCaptor.getValue();
            assertThat(sql)
                    .contains("UPDATE emissions")
                    .contains("status = 'CLOTURE'")
                    .contains("WHERE status = 'PUBLIE'")
                    .contains("fermeture_souscription < now()");
        }

        @Test
        void doesNothingNotableWhenNoRowsAreExpired() {
            when(jdbc.update(anyString())).thenReturn(0);

            assertThatCode(() -> scheduler.closeExpired()).doesNotThrowAnyException();

            verify(jdbc, times(1)).update(anyString());
            verifyNoMoreInteractions(jdbc);
        }
    }

    @Nested
    class SwallowsFailures {

        @Test
        void doesNotPropagateRuntimeExceptionFromJdbc() {
            when(jdbc.update(anyString()))
                    .thenThrow(new DataAccessResourceFailureException("db unreachable"));

            assertThatCode(() -> scheduler.closeExpired()).doesNotThrowAnyException();

            verify(jdbc, times(1)).update(anyString());
        }

        @Test
        void doesNotPropagatePlainRuntimeException() {
            when(jdbc.update(anyString())).thenThrow(new RuntimeException("boom"));

            assertThatCode(() -> scheduler.closeExpired()).doesNotThrowAnyException();

            verify(jdbc, times(1)).update(anyString());
        }
    }
}