package cm.afriland.titres.web;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.dto.AuthResponse;
import cm.afriland.titres.dto.UserProfile;
import cm.afriland.titres.dto.UserRow;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.integration.LdapSettingsService;
import cm.afriland.titres.notif.EmailService;
import cm.afriland.titres.notif.OtpSettingsService;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.JwtService;
import cm.afriland.titres.security.PasswordService;
import cm.afriland.titres.security.RateLimiter;
import cm.afriland.titres.security.SecretCipher;
import cm.afriland.titres.security.Tokens;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuthControllerTest {

    // ==================== Mocks ====================
    private @Mock JdbcTemplate jdbc;
    private @Mock AppProperties props;
    private @Mock JwtService jwt;
    private @Mock PasswordService password;
    private @Mock RateLimiter rateLimiter;
    private @Mock AuditService audit;
    private @Mock OtpSettingsService otpSettings;
    private @Mock EmailService email;
    private @Mock SecretCipher cipher;
    private @Mock LdapSettingsService ldap;
    private @Mock HttpServletResponse httpServletResponse;
    private @Mock ClientIp clientIp;

    private AuthController controller;

    // ==================== Test data ====================
    private static final UUID USER_ID = UUID.randomUUID();
    private static final String EMAIL = "test@example.com";
    private static final String PASSWORD = "password123";
    private static final String HASHED_PASSWORD = "hashedPassword123";
    private static final String DEV_OTP_CODE = "123456";
    private static final UUID CHALLENGE_ID = UUID.randomUUID();
    private static final OffsetDateTime NOW = OffsetDateTime.now();
    private static final String IP = "127.0.0.1";

    @BeforeEach
    void setUp() {
        // CRITICAL: Stub before controller construction
        when(password.hash(anyString())).thenReturn(HASHED_PASSWORD);
        when(password.hash("egalisateur-de-temps-pas-un-vrai-mot-de-passe")).thenReturn("dummyHashForTiming");

        controller = new AuthController(jdbc, props, jwt, password, rateLimiter, audit, otpSettings, email, cipher, ldap);

        // Common configuration - marked lenient to avoid UnnecessaryStubbingException
        lenient().when(props.getAuthMode()).thenReturn("LOCAL");
        lenient().when(props.getMfaDevCode()).thenReturn(DEV_OTP_CODE);
        lenient().when(email.isConfigured()).thenReturn(false);
        lenient().when(props.getRefreshTokenTtl()).thenReturn(3600L);
        lenient().when(props.getAccessTokenTtl()).thenReturn(900L);
        lenient().when(props.getPrimaryFrontendOrigin()).thenReturn("https://example.com");

        lenient().when(rateLimiter.check(anyString())).thenReturn(true);
        lenient().when(rateLimiter.check(anyString(), anyInt())).thenReturn(true);

        OtpSettingsService.OtpSettings otpCfg = mock(OtpSettingsService.OtpSettings.class);
        lenient().when(otpCfg.emailEnabled()).thenReturn(false);
        lenient().when(otpCfg.smsEnabled()).thenReturn(false);
        lenient().when(otpCfg.longueur()).thenReturn(6);
        lenient().when(otpCfg.ttlSecondes()).thenReturn(300);
        lenient().when(otpCfg.maxTentatives()).thenReturn(3);
        lenient().when(otpSettings.get()).thenReturn(otpCfg);

        when(clientIp.value()).thenReturn(IP);
    }

    // ==================== Helpers ====================
    private void stubUserRowQuery(UUID userId, UserRow userRow) {
        lenient().when(jdbc.queryForObject(anyString(), any(RowMapper.class), eq(userId))).thenReturn(userRow);
    }

    private void stubMfaChallenge(OffsetDateTime expiresAt, String codeHash, boolean consumed, int attempts) throws Exception {
        ArgumentCaptor<RowMapper> mapperCaptor = ArgumentCaptor.forClass(RowMapper.class);
        when(jdbc.query(anyString(), mapperCaptor.capture(), eq(CHALLENGE_ID)))
                .thenAnswer(inv -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getObject("id", UUID.class)).thenReturn(CHALLENGE_ID);
                    when(rs.getObject("user_id", UUID.class)).thenReturn(USER_ID);
                    when(rs.getString("code_hash")).thenReturn(codeHash);
                    when(rs.getObject("expires_at", OffsetDateTime.class)).thenReturn(expiresAt);
                    when(rs.getInt("attempts")).thenReturn(attempts);
                    when(rs.getBoolean("consumed")).thenReturn(consumed);
                    return List.of(mapperCaptor.getValue().mapRow(rs, 1));
                });
    }

    @Nested
    class LoginEndpoint {

        @Test
        void login_unknownEmail_returnsGenericErrorAndHashesDummy() {
            when(jdbc.query(anyString(), any(RowMapper.class), eq(EMAIL)))
                    .thenReturn(List.of());

            assertThatThrownBy(() -> controller.login(new AuthController.LoginRequest(EMAIL, PASSWORD), clientIp))
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("Identifiants invalides");

            verify(password).verify(eq(PASSWORD), anyString());
            verify(audit).log(eq(EMAIL), eq("CONNEXION"), eq(AuditService.ECHEC), eq("—"), eq(IP));
        }

        @Test
        void login_successful_createsMfaChallengeAndReturnsChallengeInfo() {
            UserRow user = mock(UserRow.class);
            when(user.statut()).thenReturn("ACTIF");
            when(user.lockedUntil()).thenReturn(null);
            when(user.passwordHash()).thenReturn(HASHED_PASSWORD);

            when(jdbc.query(anyString(), any(RowMapper.class), eq(EMAIL)))
                    .thenReturn(List.of(user));
            when(password.verify(eq(PASSWORD), anyString())).thenReturn(true);

            lenient().when(jdbc.queryForObject(contains("INSERT INTO mfa_challenges"), eq(UUID.class), any(), any(), any(), any()))
                    .thenReturn(CHALLENGE_ID);

            Map<String, Object> response = controller.login(new AuthController.LoginRequest(EMAIL, PASSWORD), clientIp);

            assertThat(response).containsEntry("mfaRequired", true);
            assertThat(response).containsEntry("challengeId", CHALLENGE_ID);
            assertThat(response).containsKey("expiresIn");
        }
    }

    @Nested
    class MfaVerifyEndpoint {

        @Test
        void mfaVerify_wrongCode_incrementsAttempts() throws Exception {
            stubMfaChallenge(NOW.plusSeconds(300), "wrongHash", false, 0);

            assertThatThrownBy(() -> controller.mfaVerify(
                    new AuthController.MfaVerifyRequest(CHALLENGE_ID, "999999"), clientIp, httpServletResponse))
                    .isInstanceOf(ApiException.class);

            verify(jdbc).update(eq("UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?"), eq(CHALLENGE_ID));
        }

        @Test
        void mfaVerify_success_issuesTokensAndSetsCookie() throws Exception {
            stubMfaChallenge(NOW.plusSeconds(300), Tokens.sha256Hex(DEV_OTP_CODE), false, 0);

            UserRow user = mock(UserRow.class);
            when(user.id()).thenReturn(USER_ID);
            when(user.statut()).thenReturn("ACTIF");
            when(user.lockedUntil()).thenReturn(null);
            when(user.role()).thenReturn("CLIENT");
            when(user.mustChangePassword()).thenReturn(false);
            when(user.email()).thenReturn(EMAIL);

            stubUserRowQuery(USER_ID, user);

            String accessToken = "jwt.access.token";
            when(jwt.issue(any(), any(), any(), anyBoolean())).thenReturn(accessToken);

            AuthResponse response = controller.mfaVerify(
                    new AuthController.MfaVerifyRequest(CHALLENGE_ID, DEV_OTP_CODE), clientIp, httpServletResponse);

            assertThat(response.accessToken()).isEqualTo(accessToken);
            verify(httpServletResponse).addHeader(eq("Set-Cookie"), anyString());
            verify(audit).log(eq(USER_ID.toString()), eq("CONNEXION"), eq(AuditService.SUCCES), eq("—"), eq(IP));
        }
    }

    @Nested
    class ChangePasswordEndpoint {

        @Test
        void changePassword_mustChangeFlagTrue_skipsCurrentPasswordCheck() throws Exception {
            AuthUser authUser = mock(AuthUser.class);
            when(authUser.id()).thenReturn(USER_ID);

            UserRow user = mock(UserRow.class);
            when(user.mustChangePassword()).thenReturn(true);

            stubUserRowQuery(USER_ID, user);

            controller.changePassword(authUser, new AuthController.ChangePasswordRequest(null, "newPass123"), clientIp);

            verify(jdbc).update(contains("password_hash"), anyString(), eq(USER_ID));
            verify(jdbc).update(contains("revoked = TRUE"), eq(USER_ID));
        }
    }

    @Nested
    class ActionOtpEndpoints {

        @Test
        void verifyActionOtp_success() throws Exception {
            AuthUser authUser = mock(AuthUser.class);
            when(authUser.id()).thenReturn(USER_ID);

            stubMfaChallenge(NOW.plusSeconds(300), Tokens.sha256Hex(DEV_OTP_CODE), false, 0);

            Map<String, Object> response = controller.verifyActionOtp(authUser, clientIp,
                    new AuthController.MfaVerifyRequest(CHALLENGE_ID, DEV_OTP_CODE));

            assertThat(response).containsEntry("ok", true);
        }
    }
}