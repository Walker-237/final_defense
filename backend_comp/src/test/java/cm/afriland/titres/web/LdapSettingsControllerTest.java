package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.integration.LdapSettingsService;
import cm.afriland.titres.integration.LdapSettingsService.LdapSettings;
import cm.afriland.titres.integration.LdapSettingsService.LdapSettingsUpdate;
import cm.afriland.titres.integration.LdapSettingsService.TestResult;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.web.LdapSettingsController.UpdateRequest;

/**
 * Tests for {@link LdapSettingsController}.
 *
 * <h2>Assumptions made (source not available for these types)</h2>
 * <ul>
 * <li>{@link AuthUser}: exposes {@code id()} returning {@code UUID} and {@code role()}
 *     returning {@code String}.</li>
 * <li>{@link ClientIp}: exposes {@code value()} returning {@code String}.</li>
 * <li>{@link AuditService}: exposes public static {@code SUCCES}/{@code ECHEC} constants
 *     and {@code log(String userId, String action, String result, String reference, String ip)}.</li>
 * <li>{@link LdapSettingsService}: exposes {@code publicView()} returning
 *     {@code Map<String,Object>}, {@code update(LdapSettingsUpdate, UUID)},
 *     {@code testConnection()} returning {@code TestResult}, and {@code get()} returning
 *     a settings object exposing {@code host()}.</li>
 * <li>{@code TestResult} exposes {@code ok()} (boolean) and {@code message()} (String).</li>
 * </ul>
 */
@SuppressWarnings("unchecked")
class LdapSettingsControllerTest {

    private LdapSettingsService settings;
    private AuditService audit;
    private LdapSettingsController controller;
    private ClientIp ip;

    @BeforeEach
    void setUp() {
        settings = mock(LdapSettingsService.class);
        audit = mock(AuditService.class);
        controller = new LdapSettingsController(settings, audit);
        ip = mock(ClientIp.class);
        when(ip.value()).thenReturn("127.0.0.1");
    }

    private AuthUser adminUser(UUID id) {
        AuthUser user = mock(AuthUser.class);
        when(user.id()).thenReturn(id);
        when(user.role()).thenReturn("ADMIN");
        return user;
    }

    private AuthUser nonAdminUser(UUID id) {
        AuthUser user = mock(AuthUser.class);
        when(user.id()).thenReturn(id);
        when(user.role()).thenReturn("AGENT");
        return user;
    }

    private UpdateRequest baseRequest(Boolean enabled, String host, Integer port, Boolean ssl,
                                      Boolean startTls, String baseDn) {
        return new UpdateRequest(enabled, host, port, ssl, startTls, baseDn,
                "cn=svc,dc=example,dc=com", "secret", "ou=users,dc=example,dc=com",
                "(uid={0})");
    }

    @Nested
    class EnsureAdmin {

        @Test
        void nonAdmin_get_throwsForbidden() {
            AuthUser user = nonAdminUser(UUID.randomUUID());

            assertThatThrownBy(() -> controller.get(user)).isInstanceOf(ApiException.class);

            verifyNoInteractions(settings);
        }

        @Test
        void nonAdmin_update_throwsForbidden() {
            AuthUser user = nonAdminUser(UUID.randomUUID());
            UpdateRequest req = baseRequest(false, null, null, false, false, null);

            assertThatThrownBy(() -> controller.update(user, ip, req)).isInstanceOf(ApiException.class);

            verifyNoInteractions(settings);
            verifyNoInteractions(audit);
        }

        @Test
        void nonAdmin_test_throwsForbidden() {
            AuthUser user = nonAdminUser(UUID.randomUUID());

            assertThatThrownBy(() -> controller.test(user, ip)).isInstanceOf(ApiException.class);

            verifyNoInteractions(settings);
            verifyNoInteractions(audit);
        }
    }

    @Nested
    class Get {

        @Test
        void admin_returnsPublicView() {
            AuthUser user = adminUser(UUID.randomUUID());
            Map<String, Object> view = Map.of("enabled", false);
            when(settings.publicView()).thenReturn(view);

            Map<String, Object> result = controller.get(user);

            assertThat(result).isEqualTo(view);
        }
    }

    @Nested
    class Update {

        @Test
        void nullPort_defaultsTo389() {
            UUID userId = UUID.randomUUID();
            AuthUser user = adminUser(userId);
            UpdateRequest req = baseRequest(false, null, null, false, false, null);
            when(settings.publicView()).thenReturn(Map.of());

            controller.update(user, ip, req);

            ArgumentCaptor<LdapSettingsUpdate> captor = ArgumentCaptor.forClass(LdapSettingsUpdate.class);
            verify(settings).update(captor.capture(), eq(userId));
            assertThat(captor.getValue().port()).isEqualTo(389);
        }

        @Test
        void invalidPort_tooLow_throwsBadRequest() {
            AuthUser user = adminUser(UUID.randomUUID());
            UpdateRequest req = baseRequest(false, null, 0, false, false, null);

            assertThatThrownBy(() -> controller.update(user, ip, req)).isInstanceOf(ApiException.class);

            verify(settings, never()).update(any(), any());
            verifyNoInteractions(audit);
        }

        @Test
        void invalidPort_tooHigh_throwsBadRequest() {
            AuthUser user = adminUser(UUID.randomUUID());
            UpdateRequest req = baseRequest(false, null, 70000, false, false, null);

            assertThatThrownBy(() -> controller.update(user, ip, req)).isInstanceOf(ApiException.class);

            verify(settings, never()).update(any(), any());
            verifyNoInteractions(audit);
        }

        @Test
        void enabledWithoutHost_throwsBadRequest() {
            AuthUser user = adminUser(UUID.randomUUID());
            UpdateRequest req = baseRequest(true, null, 389, false, false, "dc=example,dc=com");

            assertThatThrownBy(() -> controller.update(user, ip, req)).isInstanceOf(ApiException.class);

            verify(settings, never()).update(any(), any());
            verifyNoInteractions(audit);
        }

        @Test
        void enabledWithBlankHost_throwsBadRequest() {
            AuthUser user = adminUser(UUID.randomUUID());
            UpdateRequest req = baseRequest(true, "   ", 389, false, false, "dc=example,dc=com");

            assertThatThrownBy(() -> controller.update(user, ip, req)).isInstanceOf(ApiException.class);

            verify(settings, never()).update(any(), any());
        }

        @Test
        void enabledWithoutBaseDn_throwsBadRequest() {
            AuthUser user = adminUser(UUID.randomUUID());
            UpdateRequest req = baseRequest(true, "ldap.example.com", 389, false, false, null);

            assertThatThrownBy(() -> controller.update(user, ip, req)).isInstanceOf(ApiException.class);

            verify(settings, never()).update(any(), any());
        }

        @Test
        void enabledWithBlankBaseDn_throwsBadRequest() {
            AuthUser user = adminUser(UUID.randomUUID());
            UpdateRequest req = baseRequest(true, "ldap.example.com", 389, false, false, "   ");

            assertThatThrownBy(() -> controller.update(user, ip, req)).isInstanceOf(ApiException.class);

            verify(settings, never()).update(any(), any());
        }

        @Test
        void sslAndStartTlsBothTrue_throwsBadRequest() {
            AuthUser user = adminUser(UUID.randomUUID());
            UpdateRequest req = baseRequest(true, "ldap.example.com", 636, true, true, "dc=example,dc=com");

            assertThatThrownBy(() -> controller.update(user, ip, req)).isInstanceOf(ApiException.class);

            verify(settings, never()).update(any(), any());
            verifyNoInteractions(audit);
        }

        @Test
        void disabled_skipsHostAndBaseDnValidation_succeeds() {
            UUID userId = UUID.randomUUID();
            AuthUser user = adminUser(userId);
            UpdateRequest req = baseRequest(false, null, 389, false, false, null);
            when(settings.publicView()).thenReturn(Map.of("enabled", false));

            Map<String, Object> result = controller.update(user, ip, req);

            assertThat(result).containsEntry("enabled", false);
            verify(settings).update(any(LdapSettingsUpdate.class), eq(userId));
        }

        @Test
        void validEnabledUpdate_persistsAndAuditsWithHostAndPort() {
            UUID userId = UUID.randomUUID();
            AuthUser user = adminUser(userId);
            UpdateRequest req = baseRequest(true, "ldap.example.com", 636, true, false, "dc=example,dc=com");
            when(settings.publicView()).thenReturn(Map.of("enabled", true));

            Map<String, Object> result = controller.update(user, ip, req);

            assertThat(result).containsEntry("enabled", true);

            ArgumentCaptor<LdapSettingsUpdate> captor = ArgumentCaptor.forClass(LdapSettingsUpdate.class);
            verify(settings).update(captor.capture(), eq(userId));
            LdapSettingsUpdate update = captor.getValue();
            assertThat(update.enabled()).isTrue();
            assertThat(update.host()).isEqualTo("ldap.example.com");
            assertThat(update.port()).isEqualTo(636);
            assertThat(update.ssl()).isTrue();
            assertThat(update.startTls()).isFalse();
            assertThat(update.baseDn()).isEqualTo("dc=example,dc=com");

            verify(audit).log(eq(userId.toString()), eq("CONFIG_LDAP"), eq(AuditService.SUCCES),
                    eq("ldap.example.com:636"), eq("127.0.0.1"));
        }

        @Test
        void disabledUpdateWithNullHost_auditsReferenceWithDashPlaceholder() {
            UUID userId = UUID.randomUUID();
            AuthUser user = adminUser(userId);
            UpdateRequest req = baseRequest(false, null, 389, false, false, null);
            when(settings.publicView()).thenReturn(Map.of());

            controller.update(user, ip, req);

            verify(audit).log(eq(userId.toString()), eq("CONFIG_LDAP"), eq(AuditService.SUCCES),
                    eq("-:389"), eq("127.0.0.1"));
        }
    }

    @Nested
    class TestConnection {

        @Test
        void successfulConnection_audItsSucces_andReturnsOkTrue() {
            UUID userId = UUID.randomUUID();
            AuthUser user = adminUser(userId);
            TestResult result = mock(TestResult.class);
            when(result.ok()).thenReturn(true);
            when(result.message()).thenReturn("Connexion reussie");
            when(settings.testConnection()).thenReturn(result);
            LdapSettings current = mock(LdapSettings.class);
            when(current.host()).thenReturn("ldap.example.com");
            when(settings.get()).thenReturn(current);

            Map<String, Object> response = controller.test(user, ip);

            assertThat(response).containsEntry("ok", true).containsEntry("message", "Connexion reussie");
            verify(audit).log(eq(userId.toString()), eq("TEST_LDAP"), eq(AuditService.SUCCES),
                    eq("ldap.example.com"), eq("127.0.0.1"));
        }

        @Test
        void failedConnection_auditsEchec_andReturnsOkFalse() {
            UUID userId = UUID.randomUUID();
            AuthUser user = adminUser(userId);
            TestResult result = mock(TestResult.class);
            when(result.ok()).thenReturn(false);
            when(result.message()).thenReturn("Connexion refusee");
            when(settings.testConnection()).thenReturn(result);
            LdapSettings current = mock(LdapSettings.class);
            when(current.host()).thenReturn(null);
            when(settings.get()).thenReturn(current);

            Map<String, Object> response = controller.test(user, ip);

            assertThat(response).containsEntry("ok", false).containsEntry("message", "Connexion refusee");
            verify(audit).log(eq(userId.toString()), eq("TEST_LDAP"), eq(AuditService.ECHEC),
                    eq("-"), eq("127.0.0.1"));
        }
    }
}