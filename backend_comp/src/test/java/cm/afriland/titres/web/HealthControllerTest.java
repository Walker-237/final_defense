package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Tests for {@link HealthController}.
 */
class HealthControllerTest {

    private JdbcTemplate jdbc;
    private HealthController controller;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        controller = new HealthController(jdbc);
    }

    @Nested
    class DatabaseUp {

        @Test
        void health_returns200_withOkStatusAndDatabaseUp() {
            when(jdbc.queryForObject(eq("SELECT 1"), eq(Integer.class))).thenReturn(1);

            ResponseEntity<Map<String, Object>> response = controller.health();

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(response.getBody())
                    .containsEntry("status", "ok")
                    .containsEntry("database", "up");
            verify(jdbc).queryForObject(eq("SELECT 1"), eq(Integer.class));
        }
    }

    @Nested
    class DatabaseDown {

        @Test
        void health_whenQueryThrows_returns503_withDegradedStatusAndDatabaseDown() {
            when(jdbc.queryForObject(eq("SELECT 1"), eq(Integer.class)))
                    .thenThrow(new org.springframework.dao.DataAccessResourceFailureException("boom"));

            ResponseEntity<Map<String, Object>> response = controller.health();

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            assertThat(response.getBody())
                    .containsEntry("status", "degraded")
                    .containsEntry("database", "down");
        }

        @Test
        void health_whenGenericRuntimeExceptionThrown_stillDegrades() {
            when(jdbc.queryForObject(eq("SELECT 1"), eq(Integer.class)))
                    .thenThrow(new RuntimeException("unexpected"));

            ResponseEntity<Map<String, Object>> response = controller.health();

            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
            assertThat(response.getBody()).containsEntry("database", "down");
        }
    }
}