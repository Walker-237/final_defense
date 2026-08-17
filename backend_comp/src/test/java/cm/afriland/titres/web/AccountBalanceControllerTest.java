package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.integration.AifClient;
import cm.afriland.titres.integration.AifUnavailableException;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.Permission;
import cm.afriland.titres.web.AccountBalanceController.AccountBalance;
import cm.afriland.titres.web.AccountBalanceController.AccountBalanceListResponse;
import cm.afriland.titres.web.AccountBalanceController.BalanceStatus;
import cm.afriland.titres.web.AccountBalanceController.HealthResponse;

/**
 * Couverture de {@link AccountBalanceController} : RBAC, degradation
 * gracieuse AIF, cache de ping, et parsing JSON (via les endpoints publics,
 * les helpers de parsing etant prives).
 *
 * NOTE: AifClient, AuditService, AuthUser et ClientIp sont mockes ici sur la
 * base de leur usage observe dans le controleur. Si leurs signatures reelles
 * different, ce fichier de test devra etre ajuste en consequence.
 */
class AccountBalanceControllerTest {

    private AifClient aif;
    private AuditService audit;
    private AuthUser backOfficeUser;
    private AuthUser clientUser;
    private ClientIp ip;
    private AccountBalanceController controller;

    @BeforeEach
    void setUp() {
        aif = mock(AifClient.class);
        audit = mock(AuditService.class);
        backOfficeUser = mock(AuthUser.class);
        clientUser = mock(AuthUser.class);
        ip = mock(ClientIp.class);

        when(backOfficeUser.isClient()).thenReturn(false);
        when(backOfficeUser.id()).thenReturn(UUID.fromString("00000000-0000-0000-0000-000000000001"));
        when(clientUser.isClient()).thenReturn(true);
        when(ip.value()).thenReturn("127.0.0.1");

        controller = new AccountBalanceController(aif, audit);
    }

    // ───────────────────────────── /health ─────────────────────────────

    @Nested
    class Health {

        @Test
        void refuse_les_clients() {
            assertThatThrownBy(() -> controller.health(clientUser))
                    .isInstanceOf(ApiException.class);
            verify(aif, never()).ping();
        }

        @Test
        void interroge_aif_puis_reutilise_le_cache() {
            AifClient.PingResult pong = new AifClient.PingResult(true, 42L, "https://aif.local");
            when(aif.ping()).thenReturn(pong);

            HealthResponse first = controller.health(backOfficeUser);
            HealthResponse second = controller.health(backOfficeUser);

            assertThat(first.available()).isTrue();
            assertThat(first.latencyMs()).isEqualTo(42L);
            assertThat(second).isEqualTo(first);
            // Deuxieme appel doit venir du cache (< PING_CACHE_MS), pas d'un second ping.
            verify(aif, times(1)).ping();
        }
    }

    // ───────────────────────────── /account-balance ─────────────────────────────

    @Nested
    class Search {

        @Test
        void refuse_les_clients_avant_toute_validation() {
            assertThatThrownBy(() -> controller.search(clientUser, ip, "ANY"))
                    .isInstanceOf(ApiException.class);
            verify(aif, never()).getJson(anyString(), any());
        }

        @Test
        void rejette_un_numero_de_compte_trop_court() {
            assertThatThrownBy(() -> controller.search(backOfficeUser, ip, "ab"))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void rejette_un_numero_de_compte_avec_caracteres_invalides() {
            assertThatThrownBy(() -> controller.search(backOfficeUser, ip, "abc$%"))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void retourne_les_comptes_et_trace_le_succes() {
            String json = """
                    {"accounts":[
                        {"accountId":"A1","branch":"01","currency":"XAF","account":"12345","suffix":"01",
                         "status":"ACTIF","openingDate":"2024-01-01",
                         "customer":{"customerNumber":"C1","customerDisplayedName":"ACME SA"},
                         "instantBalance":1000,"accountingBalance":"950"}
                    ]}
                    """;
            when(aif.getJson(eq("/"), any())).thenReturn(json);

            AccountBalanceListResponse resp = controller.search(backOfficeUser, ip, "12345");

            assertThat(resp.status()).isEqualTo(BalanceStatus.OK);
            assertThat(resp.totalCount()).isEqualTo(1);
            AccountBalance b = resp.accounts().get(0);
            assertThat(b.customerName()).isEqualTo("ACME SA");
            assertThat(b.instantBalance()).isEqualTo(1000L);
            assertThat(b.accountingBalance()).isEqualTo(950L);

            verify(audit).log(anyString(), eq("CONSULTATION_SOLDE_AIF"),
                    eq(AuditService.SUCCES), eq("12345"), eq("127.0.0.1"));
        }

        @Test
        void degrade_proprement_quand_aif_est_indisponible() {
            when(aif.getJson(eq("/"), any()))
                    .thenThrow(new AifUnavailableException("AIF down", new RuntimeException()));

            AccountBalanceListResponse resp = controller.search(backOfficeUser, ip, "12345");

            assertThat(resp.status()).isEqualTo(BalanceStatus.UNAVAILABLE);
            assertThat(resp.accounts()).isEmpty();
            verify(audit).log(anyString(), eq("CONSULTATION_SOLDE_AIF"),
                    eq(AuditService.ECHEC), eq("12345"), eq("127.0.0.1"));
        }

        @Test
        void degrade_quand_la_reponse_aif_nest_pas_du_json_valide() {
            when(aif.getJson(eq("/"), any())).thenReturn("<<< pas du json >>>");

            AccountBalanceListResponse resp = controller.search(backOfficeUser, ip, "12345");

            assertThat(resp.status()).isEqualTo(BalanceStatus.UNAVAILABLE);
            verify(audit).log(anyString(), eq("CONSULTATION_SOLDE_AIF"),
                    eq(AuditService.ECHEC), eq("12345"), eq("127.0.0.1"));
        }

        @Test
        void retourne_une_liste_vide_si_le_champ_accounts_est_absent() {
            when(aif.getJson(eq("/"), any())).thenReturn("{\"foo\":\"bar\"}");

            AccountBalanceListResponse resp = controller.search(backOfficeUser, ip, "12345");

            assertThat(resp.status()).isEqualTo(BalanceStatus.OK);
            assertThat(resp.accounts()).isEmpty();
        }
    }

    // ───────────────────────────── /account-balance/{...} ─────────────────────────────

    @Nested
    class Detail {

        @Test
        void rejette_un_segment_vide() {
            assertThatThrownBy(() -> controller.detail(backOfficeUser, ip, "", "XAF", "12345", "01"))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void rejette_un_segment_avec_caracteres_invalides() {
            assertThatThrownBy(() -> controller.detail(backOfficeUser, ip, "01", "XA/F", "12345", "01"))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void retourne_le_detail_et_trace_le_succes() {
            String json = """
                    {"accountId":"01-XAF-12345-01","branch":"01","currency":"XAF","account":"12345","suffix":"01",
                     "status":"ACTIF","openingDate":"2024-01-01",
                     "customer":{"customerNumber":"C1","customerDisplayedName":"ACME SA"},
                     "instantBalance":2000,"accountingBalance":1800}
                    """;
            when(aif.getJson(eq("/01-XAF-12345-01"), eq(Map.of()))).thenReturn(json);

            AccountBalance b = controller.detail(backOfficeUser, ip, "01", "XAF", "12345", "01");

            assertThat(b.accountId()).isEqualTo("01-XAF-12345-01");
            assertThat(b.instantBalance()).isEqualTo(2000L);
            verify(audit).log(anyString(), eq("CONSULTATION_SOLDE_AIF"),
                    eq(AuditService.SUCCES), eq("01-XAF-12345-01"), eq("127.0.0.1"));
        }

        @Test
        void degrade_proprement_quand_aif_est_indisponible() {
            when(aif.getJson(eq("/01-XAF-12345-01"), eq(Map.of())))
                    .thenThrow(new AifUnavailableException("AIF down", new RuntimeException()));

            AccountBalance b = controller.detail(backOfficeUser, ip, "01", "XAF", "12345", "01");

            assertThat(b.accountId()).isEqualTo("01-XAF-12345-01");
            assertThat(b.status()).isNull();
            assertThat(b.instantBalance()).isNull();
            verify(audit).log(anyString(), eq("CONSULTATION_SOLDE_AIF"),
                    eq(AuditService.ECHEC), eq("01-XAF-12345-01"), eq("127.0.0.1"));
        }

        @Test
        void degrade_quand_le_solde_comptable_nest_pas_un_nombre_valide() {
            String json = """
                    {"accountId":"01-XAF-12345-01","branch":"01","currency":"XAF","account":"12345","suffix":"01",
                     "instantBalance":2000,"accountingBalance":"abc"}
                    """;
            when(aif.getJson(eq("/01-XAF-12345-01"), eq(Map.of()))).thenReturn(json);

            AccountBalance b = controller.detail(backOfficeUser, ip, "01", "XAF", "12345", "01");

            assertThat(b.instantBalance()).isEqualTo(2000L);
            assertThat(b.accountingBalance()).isNull();
        }
    }

    // ───────────────────────────── ensureAuthorized (indirect) ─────────────────────────────

    @Test
    void search_verifie_la_permission_ACCOUNT_BALANCE_READ() {
        when(aif.getJson(anyString(), any())).thenReturn("{\"accounts\":[]}");

        controller.search(backOfficeUser, ip, "12345");

        verify(backOfficeUser).require(Permission.ACCOUNT_BALANCE_READ);
    }
}