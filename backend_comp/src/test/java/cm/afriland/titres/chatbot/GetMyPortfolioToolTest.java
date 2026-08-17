package cm.afriland.titres.chatbot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
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

/** Tests for {@link GetMyPortfolioTool} — same scoping invariant as {@link ListMyOrdersTool}. */
@SuppressWarnings("unchecked")
class GetMyPortfolioToolTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void staffCaller_getsReservedMessage_neverQueriesDb() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AuthUser staff = mock(AuthUser.class);
        when(staff.isClient()).thenReturn(false);

        String result = new GetMyPortfolioTool(jdbc, mapper).execute(Map.of(), staff);

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

        String result = new GetMyPortfolioTool(jdbc, mapper).execute(Map.of(), client);

        verify(jdbc).query(any(String.class), any(RowMapper.class), eq(clientId));
        assertThat(result).contains("Aucune position");
    }

    @Test
    void takesNoParameters() {
        GetMyPortfolioTool tool = new GetMyPortfolioTool(mock(JdbcTemplate.class), mapper);
        assertThat(tool.parameters()).isEmpty();
        assertThat(tool.required()).isEmpty();
    }

    @Test
    void anonymousCaller_getsLoginPrompt_neverQueriesDb() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);

        String result = new GetMyPortfolioTool(jdbc, mapper).execute(Map.of(), null);

        assertThat(result).contains("Connectez-vous");
        verifyNoInteractions(jdbc);
    }
}
