package cm.afriland.titres.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

import cm.afriland.titres.config.AppProperties;

/**
 * Tests for {@link IdAuthenticityService}.
 *
 * <p>Only the guard-clause paths (no API key, malformed image) are covered here
 * without touching the network — same scope constraint as the rest of this
 * module's Anthropic-backed services, which don't stub the SDK's HTTP client.</p>
 */
class IdAuthenticityServiceTest {

    @Test
    void noApiKeyConfigured_returnsIndetermineWithoutCallingClaude() {
        AppProperties props = mock(AppProperties.class);
        when(props.getAnthropicApiKey()).thenReturn(null);
        IdAuthenticityService service = new IdAuthenticityService(props);

        IdAuthenticityService.Result result = service.analyser("data:image/jpeg;base64,xx");

        assertThat(result.verdict()).isEqualTo("INDETERMINE");
        assertThat(result.score()).isNull();
    }

    @Test
    void malformedDataUrl_returnsIndetermine() {
        AppProperties props = mock(AppProperties.class);
        when(props.getAnthropicApiKey()).thenReturn("sk-test-key");
        IdAuthenticityService service = new IdAuthenticityService(props);

        IdAuthenticityService.Result result = service.analyser("not-a-data-url");

        assertThat(result.verdict()).isEqualTo("INDETERMINE");
    }

    @Test
    void unsupportedMimeType_returnsIndetermine() {
        AppProperties props = mock(AppProperties.class);
        when(props.getAnthropicApiKey()).thenReturn("sk-test-key");
        IdAuthenticityService service = new IdAuthenticityService(props);

        IdAuthenticityService.Result result = service.analyser("data:application/pdf;base64,xx");

        assertThat(result.verdict()).isEqualTo("INDETERMINE");
    }
}
