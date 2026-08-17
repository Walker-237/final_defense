package cm.afriland.titres.chatbot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.AuthUser;

/** Tests for {@link ListOpenEmissionsTool}. */
@SuppressWarnings("unchecked")
class ListOpenEmissionsToolTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void noOpenEmissions_returnsExplicitMessage_notEmptyJson() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(contains("status = 'PUBLIE'"), any(RowMapper.class))).thenReturn(List.of());

        String result = new ListOpenEmissionsTool(jdbc, mapper).execute(Map.of(), mock(AuthUser.class));

        assertThat(result).contains("Aucune emission");
    }

    @Test
    void openEmissions_serializeAsJson() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        Map<String, Object> row = Map.of("code", "BTA-2026-01", "nature", "BTA");
        when(jdbc.query(contains("status = 'PUBLIE'"), any(RowMapper.class))).thenReturn(List.of(row));

        String result = new ListOpenEmissionsTool(jdbc, mapper).execute(Map.of(), mock(AuthUser.class));

        assertThat(result).contains("BTA-2026-01");
    }

    @Test
    void takesNoParameters() {
        ListOpenEmissionsTool tool = new ListOpenEmissionsTool(mock(JdbcTemplate.class), mapper);
        assertThat(tool.parameters()).isEmpty();
        assertThat(tool.required()).isEmpty();
    }
}
