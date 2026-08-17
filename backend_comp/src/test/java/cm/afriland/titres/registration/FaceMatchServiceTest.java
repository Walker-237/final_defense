package cm.afriland.titres.registration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

import cm.afriland.titres.config.AppProperties;

/**
 * Tests for {@link FaceMatchService}.
 *
 * <p>Only the guard-clause paths (no API key, malformed image) are covered here
 * without touching the network — same scope constraint as {@link IdAuthenticityServiceTest}.</p>
 */
class FaceMatchServiceTest {

    @Test
    void noApiKeyConfigured_returnsIndetermineWithoutCallingClaude() {
        AppProperties props = mock(AppProperties.class);
        when(props.getAnthropicApiKey()).thenReturn(null);
        FaceMatchService service = new FaceMatchService(props);

        FaceMatchService.Result result = service.comparer(
                "data:image/jpeg;base64,xx", "data:image/jpeg;base64,yy");

        assertThat(result.verdict()).isEqualTo("INDETERMINE");
        assertThat(result.score()).isNull();
    }

    @Test
    void malformedSelfie_returnsIndetermine() {
        AppProperties props = mock(AppProperties.class);
        when(props.getAnthropicApiKey()).thenReturn("sk-test-key");
        FaceMatchService service = new FaceMatchService(props);

        FaceMatchService.Result result = service.comparer("not-a-data-url", "data:image/jpeg;base64,yy");

        assertThat(result.verdict()).isEqualTo("INDETERMINE");
    }

    @Test
    void malformedPiece_returnsIndetermine() {
        AppProperties props = mock(AppProperties.class);
        when(props.getAnthropicApiKey()).thenReturn("sk-test-key");
        FaceMatchService service = new FaceMatchService(props);

        FaceMatchService.Result result = service.comparer("data:image/jpeg;base64,xx", "not-a-data-url");

        assertThat(result.verdict()).isEqualTo("INDETERMINE");
    }
}
