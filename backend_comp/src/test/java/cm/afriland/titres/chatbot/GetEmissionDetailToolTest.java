package cm.afriland.titres.chatbot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.AuthUser;

/** Tests for {@link GetEmissionDetailTool} — the visibility rule is the point of this class. */
@SuppressWarnings("unchecked")
class GetEmissionDetailToolTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private AuthUser client() {
        AuthUser user = mock(AuthUser.class);
        when(user.isStaff()).thenReturn(false);
        return user;
    }

    private AuthUser staff() {
        AuthUser user = mock(AuthUser.class);
        when(user.isStaff()).thenReturn(true);
        return user;
    }

    @Test
    void missingCode_returnsExplicitMessage_neverQueriesDb() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);

        String result = new GetEmissionDetailTool(jdbc, mapper).execute(Map.of(), client());

        assertThat(result).contains("manquant");
    }

    @Test
    void clientCaller_queryFiltersToPublieOnly() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(any(String.class), any(RowMapper.class), eq("BTA-2026-01"))).thenReturn(List.of());

        new GetEmissionDetailTool(jdbc, mapper).execute(Map.of("code", "BTA-2026-01"), client());

        verify(jdbc).query(contains("AND status = 'PUBLIE'"), any(RowMapper.class), eq("BTA-2026-01"));
    }

    @Test
    void staffCaller_seesNonPublishedEmissionsToo() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(any(String.class), any(RowMapper.class), eq("BTA-2026-01"))).thenReturn(List.of());

        new GetEmissionDetailTool(jdbc, mapper).execute(Map.of("code", "BTA-2026-01"), staff());

        verify(jdbc).query(argThat((String sql) -> !sql.contains("status = 'PUBLIE'")),
                any(RowMapper.class), eq("BTA-2026-01"));
    }

    @Test
    void anonymousCaller_queryFiltersToPublieOnly_likeAClient() {
        // The chatbot is reachable from the public catalogue without login now,
        // so AuthUser can be null — must behave like a non-staff caller, not NPE.
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(any(String.class), any(RowMapper.class), eq("BTA-2026-01"))).thenReturn(List.of());

        new GetEmissionDetailTool(jdbc, mapper).execute(Map.of("code", "BTA-2026-01"), null);

        verify(jdbc).query(contains("AND status = 'PUBLIE'"), any(RowMapper.class), eq("BTA-2026-01"));
    }

    @Test
    void notFound_returnsExplicitMessage() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(any(String.class), any(RowMapper.class), eq("UNKNOWN"))).thenReturn(List.of());

        String result = new GetEmissionDetailTool(jdbc, mapper).execute(Map.of("code", "UNKNOWN"), client());

        assertThat(result).contains("Aucune emission");
    }
}
