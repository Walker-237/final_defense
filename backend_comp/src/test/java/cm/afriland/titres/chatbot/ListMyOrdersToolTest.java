package cm.afriland.titres.chatbot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.AuthUser;

/**
 * Tests for {@link ListMyOrdersTool} — the security invariant under test is that
 * the query is ALWAYS scoped to the caller's own id, and that staff callers never
 * get a broad query executed on their behalf.
 */
@SuppressWarnings("unchecked")
class ListMyOrdersToolTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void staffCaller_getsReservedMessage_neverQueriesDb() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AuthUser staff = mock(AuthUser.class);
        when(staff.isClient()).thenReturn(false);

        String result = new ListMyOrdersTool(jdbc, mapper).execute(Map.of(), staff);

        assertThat(result).contains("reserve aux clients");
        verifyNoInteractions(jdbc);
    }

    @Test
    void clientCaller_queryIsScopedToTheirOwnId() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID clientId = UUID.randomUUID();
        AuthUser client = mock(AuthUser.class);
        when(client.isClient()).thenReturn(true);
        when(client.id()).thenReturn(clientId);
        when(jdbc.query(any(String.class), any(RowMapper.class), eq(clientId))).thenReturn(List.of());

        new ListMyOrdersTool(jdbc, mapper).execute(Map.of(), client);

        // The only id ever bound into the query is the caller's own — no other
        // argument variant of query() should have fired.
        verify(jdbc).query(any(String.class), any(RowMapper.class), eq(clientId));
        verify(jdbc, never()).query(any(String.class), any(RowMapper.class), any(UUID.class), any(UUID.class));
    }

    @Test
    void ignoresAnyClientIdSuppliedInArgs() {
        // There IS no such parameter in the schema, but even if a model hallucinated
        // one, execute() must never read it — it only ever uses AuthUser.id().
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID callerId = UUID.randomUUID();
        UUID otherId = UUID.randomUUID();
        AuthUser client = mock(AuthUser.class);
        when(client.isClient()).thenReturn(true);
        when(client.id()).thenReturn(callerId);
        when(jdbc.query(any(String.class), any(RowMapper.class), eq(callerId))).thenReturn(List.of());

        new ListMyOrdersTool(jdbc, mapper).execute(Map.of("clientId", otherId.toString()), client);

        verify(jdbc).query(any(String.class), any(RowMapper.class), eq(callerId));
        verify(jdbc, never()).query(any(String.class), any(RowMapper.class), eq(otherId));
    }

    @Test
    void takesNoParameters() {
        ListMyOrdersTool tool = new ListMyOrdersTool(mock(JdbcTemplate.class), mapper);
        assertThat(tool.parameters()).isEmpty();
        assertThat(tool.required()).isEmpty();
    }

    @Test
    void anonymousCaller_getsLoginPrompt_neverQueriesDb() {
        // The chatbot is now reachable from the public catalogue (no login), so
        // AuthUser can genuinely be null here — must not NPE.
        JdbcTemplate jdbc = mock(JdbcTemplate.class);

        String result = new ListMyOrdersTool(jdbc, mapper).execute(Map.of(), null);

        assertThat(result).contains("Connectez-vous");
        verifyNoInteractions(jdbc);
    }
}
