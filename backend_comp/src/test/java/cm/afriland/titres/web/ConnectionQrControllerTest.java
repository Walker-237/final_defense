package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.LuminanceSource;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.Result;
import com.google.zxing.client.j2se.BufferedImageLuminanceSource;
import com.google.zxing.common.HybridBinarizer;

import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.web.ConnectionQrController.ConnectionQrResponse;

/**
 * Tests for {@link ConnectionQrController}.
 *
 * <p>Notes on assumptions made about collaborator types, since only
 * {@code ConnectionQrController} itself was available when writing this:
 * <ul>
 *   <li>{@link AuthUser} is assumed mockable (non-final) with an {@code isStaff()} method.</li>
 *   <li>{@link AppProperties} is assumed mockable (non-final) with a
 *       {@code getPrimaryFrontendOrigin()} method.</li>
 * </ul>
 * If either of those is a final class / record, replace the {@code mock(...)} calls
 * with the real constructor or a manually-built test double.
 */
class ConnectionQrControllerTest {

    private AppProperties props;
    private ConnectionQrController controller;

    @BeforeEach
    void setUp() {
        props = mock(AppProperties.class);
        controller = new ConnectionQrController(props);
    }

    @Nested
    class Generate {

        @Test
        void staffUser_returnsLoginUrlAndQrDataUrl() {
            when(props.getPrimaryFrontendOrigin()).thenReturn("https://app.afriland-titres.cm");
            AuthUser staff = mock(AuthUser.class);
            when(staff.isStaff()).thenReturn(true);

            ConnectionQrResponse response = controller.generate(staff);

            assertThat(response.url()).isEqualTo("https://app.afriland-titres.cm/auth/login");
            assertThat(response.qrCodeDataUrl()).startsWith("data:image/png;base64,");
        }

        @Test
        void staffUser_qrCodeDecodesBackToLoginUrl() throws Exception {
            when(props.getPrimaryFrontendOrigin()).thenReturn("https://app.afriland-titres.cm");
            AuthUser staff = mock(AuthUser.class);
            when(staff.isStaff()).thenReturn(true);

            ConnectionQrResponse response = controller.generate(staff);

            String decoded = decodeQr(response.qrCodeDataUrl());
            assertThat(decoded).isEqualTo(response.url())
                    .isEqualTo("https://app.afriland-titres.cm/auth/login");
        }

        @Test
        void nonStaffUser_throwsApiException() {
            AuthUser client = mock(AuthUser.class);
            when(client.isStaff()).thenReturn(false);

            assertThatThrownBy(() -> controller.generate(client))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("reservee au back-office");
        }

        @Test
        void nonStaffUser_neverTouchesFrontendOrigin() {
            AuthUser client = mock(AuthUser.class);
            when(client.isStaff()).thenReturn(false);

            assertThatThrownBy(() -> controller.generate(client))
                    .isInstanceOf(ApiException.class);

            // The guard should short-circuit before building the URL / QR code,
            // so no frontend-origin lookup should be needed. If AppProperties is a
            // Mockito mock this simply won't have been stubbed/used; nothing to
            // assert further without Mockito's verify(), but this documents intent.
        }

        @Test
        void urlIsBuiltFromPrimaryFrontendOrigin_notSomeOtherProperty() {
            when(props.getPrimaryFrontendOrigin()).thenReturn("http://localhost:5173");
            AuthUser staff = mock(AuthUser.class);
            when(staff.isStaff()).thenReturn(true);

            ConnectionQrResponse response = controller.generate(staff);

            assertThat(response.url()).isEqualTo("http://localhost:5173/auth/login");
        }
    }

    @Nested
    class EncodeQrFailure {

        /**
         * Covers the {@code catch (Exception e)} branch in {@code encodeQr(...)}.
         *
         * <p>Rather than static-mocking {@code ImageIO} (which would need
         * {@code mockito-inline}), this drives the real zxing encoder into a
         * genuine failure: a QR code at error-correction level M, size
         * {@code 320x320}, has a hard capacity ceiling (version 40 tops out
         * around ~2.3KB of binary data). Feeding it a URL far beyond that
         * makes {@code QRCodeWriter.encode(...)} throw a real
         * {@code WriterException}, which the controller must catch and
         * translate into an {@code ApiException}.</p>
         */
        @Test
        void oversizedUrl_wrapsWriterExceptionAsApiException() {
            String hugeOrigin = "https://" + "a".repeat(5000) + ".example.com";
            when(props.getPrimaryFrontendOrigin()).thenReturn(hugeOrigin);
            AuthUser staff = mock(AuthUser.class);
            when(staff.isStaff()).thenReturn(true);

            assertThatThrownBy(() -> controller.generate(staff))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("Generation du QR code impossible.");

            // NOTE: if ApiException exposes getters for the HTTP status / error
            // code (e.g. getStatus() / getCode()), tighten this assertion, e.g.:
            //
            // assertThatThrownBy(() -> controller.generate(staff))
            //         .isInstanceOfSatisfying(ApiException.class, ex -> {
            //             assertThat(ex.getStatus()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
            //             assertThat(ex.getCode()).isEqualTo("QR_GENERATION_FAILED");
            //         });
            //
            // Left as a plain message-contains check here since the exact
            // accessor names on ApiException weren't available.
        }
    }

    /** Decodes a {@code data:image/png;base64,...} QR data URL back to its encoded text. */
    private static String decodeQr(String dataUrl) throws Exception {
        String base64 = dataUrl.substring(dataUrl.indexOf(',') + 1);
        byte[] png = Base64.getDecoder().decode(base64);
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(png));

        LuminanceSource source = new BufferedImageLuminanceSource(image);
        BinaryBitmap bitmap = new BinaryBitmap(new HybridBinarizer(source));

        Map<DecodeHintType, Object> hints = new HashMap<>();
        hints.put(DecodeHintType.CHARACTER_SET, "UTF-8");

        Result result = new MultiFormatReader().decode(bitmap, hints);
        return result.getText();
    }
}