package cm.afriland.titres.chatbot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;

import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;

/** Tests for {@link ChatbotService} — provider selection and fallback logic. */
class ChatbotServiceTest {

    private AppProperties props;
    private DeepSeekChatProvider deepSeek;
    private AnthropicChatProvider anthropic;
    private ChatbotService service;

    @BeforeEach
    void setUp() {
        props = mock(AppProperties.class);
        deepSeek = mock(DeepSeekChatProvider.class);
        anthropic = mock(AnthropicChatProvider.class);
        service = new ChatbotService(props, deepSeek, anthropic);
    }

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

    private ChatRequest request(String message) {
        return new ChatRequest(message, List.of());
    }

    @Nested
    class ProviderSelection {

        @Test
        void deepseekConfigured_isUsedFirst() {
            when(props.getDeepseekApiKey()).thenReturn("ds-key");
            when(props.getAnthropicApiKey()).thenReturn("an-key");
            when(deepSeek.complete(anyString(), any(), anyString(), any())).thenReturn("reponse deepseek");

            String reply = service.reply(request("bonjour"), client());

            assertThat(reply).isEqualTo("reponse deepseek");
            verify(anthropic, never()).complete(anyString(), any(), anyString(), any());
        }

        @Test
        void deepseekFails_fallsBackToAnthropic() {
            when(props.getDeepseekApiKey()).thenReturn("ds-key");
            when(props.getAnthropicApiKey()).thenReturn("an-key");
            when(deepSeek.complete(anyString(), any(), anyString(), any()))
                    .thenThrow(new ChatProviderException("reseau en panne"));
            when(anthropic.complete(anyString(), any(), anyString(), any())).thenReturn("reponse anthropic");

            String reply = service.reply(request("bonjour"), client());

            assertThat(reply).isEqualTo("reponse anthropic");
        }

        @Test
        void deepseekNotConfigured_goesStraightToAnthropic() {
            when(props.getDeepseekApiKey()).thenReturn(null);
            when(props.getAnthropicApiKey()).thenReturn("an-key");
            when(anthropic.complete(anyString(), any(), anyString(), any())).thenReturn("reponse anthropic");

            String reply = service.reply(request("bonjour"), client());

            assertThat(reply).isEqualTo("reponse anthropic");
            verify(deepSeek, never()).complete(anyString(), any(), anyString(), any());
        }

        @Test
        void neitherConfigured_throws503Immediately() {
            when(props.getDeepseekApiKey()).thenReturn(null);
            when(props.getAnthropicApiKey()).thenReturn(null);

            assertThatThrownBy(() -> service.reply(request("bonjour"), client()))
                    .isInstanceOf(ApiException.class)
                    .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE));
            verify(deepSeek, never()).complete(anyString(), any(), anyString(), any());
            verify(anthropic, never()).complete(anyString(), any(), anyString(), any());
        }

        @Test
        void bothConfiguredButBothFail_throws502() {
            when(props.getDeepseekApiKey()).thenReturn("ds-key");
            when(props.getAnthropicApiKey()).thenReturn("an-key");
            when(deepSeek.complete(anyString(), any(), anyString(), any())).thenThrow(new ChatProviderException("x"));
            when(anthropic.complete(anyString(), any(), anyString(), any())).thenThrow(new ChatProviderException("y"));

            assertThatThrownBy(() -> service.reply(request("bonjour"), client()))
                    .isInstanceOf(ApiException.class)
                    .satisfies(e -> assertThat(((ApiException) e).getStatus()).isEqualTo(HttpStatus.BAD_GATEWAY));
        }

        @Test
        void authenticatedUser_isPassedThroughToProvider_forToolScoping() {
            // The provider needs the caller's identity to scope account-bound tools
            // (list_my_orders, get_my_portfolio) to that specific user — never to an
            // id supplied by the model. Guard against this silently getting dropped.
            when(props.getDeepseekApiKey()).thenReturn("ds-key");
            AuthUser user = client();
            when(deepSeek.complete(anyString(), any(), anyString(), any())).thenReturn("ok");

            service.reply(request("mes ordres"), user);

            verify(deepSeek).complete(anyString(), any(), anyString(), org.mockito.ArgumentMatchers.eq(user));
        }
    }

    @Nested
    class SystemPromptRouting {

        @Test
        void clientUser_getsClientRoutesNotBackoffice() {
            when(props.getDeepseekApiKey()).thenReturn("ds-key");
            ArgumentCaptor<String> promptCaptor = ArgumentCaptor.forClass(String.class);
            when(deepSeek.complete(promptCaptor.capture(), any(), anyString(), any())).thenReturn("ok");

            service.reply(request("comment aller aux notifications"), client());

            assertThat(promptCaptor.getValue()).contains("/client/dashboard").doesNotContain("/backoffice/dashboard");
        }

        @Test
        void staffUser_getsBackofficeRoutesNotClient() {
            when(props.getDeepseekApiKey()).thenReturn("ds-key");
            ArgumentCaptor<String> promptCaptor = ArgumentCaptor.forClass(String.class);
            when(deepSeek.complete(promptCaptor.capture(), any(), anyString(), any())).thenReturn("ok");

            service.reply(request("ou verifier une inscription"), staff());

            assertThat(promptCaptor.getValue()).contains("/backoffice/inscriptions").doesNotContain("/client/dashboard");
        }

        @Test
        void anonymousVisitor_getsOnlyPublicRoutes_noNpe() {
            // The chatbot is now reachable from the public catalogue, where AuthUser
            // is genuinely null (no login) — buildSystemPrompt must not NPE on it,
            // and must not suggest authenticated-only pages to a logged-out visitor.
            when(props.getDeepseekApiKey()).thenReturn("ds-key");
            ArgumentCaptor<String> promptCaptor = ArgumentCaptor.forClass(String.class);
            when(deepSeek.complete(promptCaptor.capture(), any(), anyString(), any())).thenReturn("ok");

            service.reply(request("quelles emissions sont disponibles ?"), null);

            assertThat(promptCaptor.getValue())
                    .contains("/emissions")
                    .doesNotContain("/client/dashboard")
                    .doesNotContain("/backoffice/dashboard");
        }
    }
}
