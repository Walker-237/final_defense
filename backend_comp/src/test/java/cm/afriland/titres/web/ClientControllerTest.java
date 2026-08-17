package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.notif.CredentialDelivery;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.PasswordService;
import cm.afriland.titres.security.Permission;
import cm.afriland.titres.security.SecretCipher;
import cm.afriland.titres.web.ClientController.ClientDossier;
import cm.afriland.titres.web.ClientController.CreateClientRequest;
import cm.afriland.titres.web.ClientController.ReqAdresse;
import cm.afriland.titres.web.ClientController.ReqContact;
import cm.afriland.titres.web.ClientController.ReqSousCompte;
import cm.afriland.titres.web.ClientController.UpdateClientRequest;

/**
 * Couverture de {@link ClientController}.
 *
 * NOTE (comme dans AccountBalanceControllerTest) : {@link JdbcTemplate} est
 * mocke directement. Le {@code NamedParameterJdbcTemplate} interne du
 * controleur reste reel mais delegue vers ce mock ; les appels qu'il fait
 * pour charger adresses/contacts/sous-comptes (via {@code RowCallbackHandler})
 * deviennent donc des no-op silencieux (comportement par defaut de Mockito
 * pour une methode void), ce qui revient a simuler des dossiers sans
 * adresses/contacts/sous-comptes detailles. On se concentre ici sur la
 * logique metier du controleur (RBAC, validation, orchestration des
 * requetes) plutot que sur le contenu exact des lignes SQL.
 *
 * Si les signatures reelles de {@code PasswordService}, {@code SecretCipher}
 * ou {@code CredentialDelivery} different de celles supposees ici (ex. type
 * de retour de {@code SecretCipher#encrypt}), ajuster les stubs en
 * consequence.
 */
@SuppressWarnings({"unchecked", "rawtypes"})
class ClientControllerTest {

    private static final UUID CLIENT_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID MANAGER_ID = UUID.fromString("00000000-0000-0000-0000-000000000099");

    private JdbcTemplate jdbc;
    private PasswordService password;
    private AuditService audit;
    private CredentialDelivery credentials;
    private SecretCipher cipher;
    private ClientController controller;

    private AuthUser manager;
    private AuthUser clientUser;
    private ClientIp ip;

    @BeforeEach
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        password = mock(PasswordService.class);
        audit = mock(AuditService.class);
        credentials = mock(CredentialDelivery.class);
        cipher = mock(SecretCipher.class);

        manager = mock(AuthUser.class);
        clientUser = mock(AuthUser.class);
        ip = mock(ClientIp.class);

        when(manager.isClient()).thenReturn(false);
        when(manager.id()).thenReturn(MANAGER_ID);
        when(clientUser.isClient()).thenReturn(true);
        when(clientUser.id()).thenReturn(CLIENT_ID);
        when(ip.value()).thenReturn("127.0.0.1");

        // Par defaut : aucun conflit (email/compte libre), aucune ligne renvoyee.
        when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
        when(jdbc.queryForObject(anyString(), eq(Long.class))).thenReturn(0L);
        when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());

        controller = new ClientController(jdbc, password, audit, credentials, cipher);
    }

    /** Construit une ligne "profil" telle que consommee par {@code loadDossiers}. */
    private Object[] dossierRow(UUID id, String typePersonne, String raisonSociale, String compteStatut) {
        return new Object[] {
                id, typePersonne, raisonSociale, "RCCM123", MANAGER_ID, "Agent BO",
                OffsetDateTime.now(), "037 10001 00000000001", "INDIVIDUEL", compteStatut,
                LocalDate.now(), "NON_QUALIFIE", "037 10001 00000000002", 500_000L
        };
    }

    private void stubDossierRows(Object[]... rows) {
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
                .thenReturn(List.of(rows));
    }

    // ───────────────────────────── GET /clients/{id} & /me ─────────────────────────────

    @Nested
    class GetDossier {

        @Test
        void leve_une_exception_si_le_dossier_est_introuvable() {
            assertThatThrownBy(() -> controller.getDossier(manager, CLIENT_ID))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void un_gestionnaire_peut_consulter_le_dossier_dun_autre_client() {
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "ACTIF"));

            ClientDossier dossier = controller.getDossier(manager, CLIENT_ID);

            assertThat(dossier.id()).isEqualTo(CLIENT_ID);
            assertThat(dossier.raisonSociale()).isEqualTo("Jean Dupont");
            assertThat(dossier.compte().soldeEspeces()).isEqualTo(500_000L);
            verify(manager).require(Permission.CLIENT_MANAGE);
        }

        @Test
        void un_client_qui_consulte_son_propre_dossier_ne_declenche_pas_de_verification_de_permission() {
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "ACTIF"));

            controller.getDossier(clientUser, CLIENT_ID);

            verify(clientUser, never()).require(any());
        }

        @Test
        void masque_le_solde_especes_pour_un_client_consultant_son_propre_dossier() {
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "ACTIF"));

            ClientDossier dossier = controller.getDossier(clientUser, CLIENT_ID);

            assertThat(dossier.compte().soldeEspeces()).isZero();
        }

        @Test
        void ne_masque_pas_le_solde_pour_un_gestionnaire() {
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "ACTIF"));

            ClientDossier dossier = controller.getDossier(manager, CLIENT_ID);

            assertThat(dossier.compte().soldeEspeces()).isEqualTo(500_000L);
        }
    }

    @Nested
    class MyDossier {

        @Test
        void leve_une_exception_si_aucun_dossier_ne_correspond() {
            assertThatThrownBy(() -> controller.myDossier(clientUser))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void renvoie_le_dossier_du_client_connecte_avec_solde_masque() {
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "ACTIF"));

            ClientDossier dossier = controller.myDossier(clientUser);

            assertThat(dossier.id()).isEqualTo(CLIENT_ID);
            assertThat(dossier.compte().soldeEspeces()).isZero();
        }
    }

    // ───────────────────────────── GET /clients & /clients/dossiers ─────────────────────────────

    @Test
    void listClients_verifie_la_permission_CLIENT_MANAGE() {
        controller.listClients(manager, null, null);

        verify(manager).require(Permission.CLIENT_MANAGE);
    }

    @Test
    void listDossiers_verifie_la_permission_et_retourne_une_page() {
        stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "ACTIF"));

        var page = controller.listDossiers(manager, null, null);

        assertThat(page).isNotNull();
        verify(manager).require(Permission.CLIENT_MANAGE);
    }

    // ───────────────────────────── POST /clients ─────────────────────────────

    @Nested
    class CreateClient {

        private ReqContact signataire(String nom, String email, String telephonePortable) {
            return new ReqContact("TITULAIRE", nom, "Paul", "M.", null, telephonePortable, null, null,
                    email, null, null, null, null, null);
        }

        private ReqSousCompte sousCompte(String numero) {
            return new ReqSousCompte(numero, null, null, null, null, null, null, null);
        }

        private CreateClientRequest requestWith(String type, ReqContact signataire, List<ReqSousCompte> sousComptes) {
            return new CreateClientRequest(type, "Jean Dupont", null, "NON_QUALIFIE", "INDIVIDUEL",
                    new ReqAdresse("DOMICILE", null, "Rue de la Paix", null, "Yaounde", "Cameroun"),
                    List.of(signataire), sousComptes, null, null);
        }

        private CreateClientRequest baseRequest() {
            return requestWith("PP", signataire("Dupont", "jean.dupont@example.com", "699000000"),
                    List.of(sousCompte("SC-001")));
        }

        @Test
        void refuse_un_type_de_client_invalide() {
            CreateClientRequest req = requestWith("XX",
                    signataire("Dupont", "jean.dupont@example.com", "699000000"),
                    List.of(sousCompte("SC-001")));

            assertThatThrownBy(() -> controller.createClient(manager, ip, req))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void refuse_labsence_de_signataire() {
            CreateClientRequest req = new CreateClientRequest("PP", "Jean Dupont", null, "NON_QUALIFIE",
                    "INDIVIDUEL", null, List.of(), List.of(sousCompte("SC-001")), null, null);

            assertThatThrownBy(() -> controller.createClient(manager, ip, req))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void refuse_labsence_de_sous_compte() {
            CreateClientRequest req = requestWith("PP",
                    signataire("Dupont", "jean.dupont@example.com", "699000000"), List.of());

            assertThatThrownBy(() -> controller.createClient(manager, ip, req))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void refuse_un_email_invalide_pour_le_premier_signataire() {
            CreateClientRequest req = requestWith("PP", signataire("Dupont", "pas-un-email", "699000000"),
                    List.of(sousCompte("SC-001")));

            assertThatThrownBy(() -> controller.createClient(manager, ip, req))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void refuse_un_email_deja_utilise() {
            when(jdbc.queryForObject(eq("SELECT count(*) FROM users WHERE email = ?"), eq(Long.class),
                    any(Object[].class))).thenReturn(1L);

            assertThatThrownBy(() -> controller.createClient(manager, ip, baseRequest()))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void refuse_labsence_de_telephone_pour_le_premier_signataire() {
            CreateClientRequest req = requestWith("PP",
                    signataire("Dupont", "jean.dupont@example.com", null), List.of(sousCompte("SC-001")));

            assertThatThrownBy(() -> controller.createClient(manager, ip, req))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void cree_un_client_pp_et_envoie_les_identifiants() {
            when(jdbc.queryForObject(anyString(), eq(UUID.class), any(Object[].class))).thenReturn(CLIENT_ID);
            when(password.hash(anyString())).thenReturn("hash");
            when(cipher.encrypt(anyString())).thenReturn("cipher");
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "ACTIF"));

            var resp = controller.createClient(manager, ip, baseRequest());

            assertThat(resp.getStatusCode().value()).isEqualTo(201);
            assertThat(resp.getBody().id()).isEqualTo(CLIENT_ID);
            verify(manager).require(Permission.CLIENT_MANAGE);
            verify(credentials).sendInitialPassword(eq("jean.dupont@example.com"), eq("699000000"),
                    anyString(), anyString(), eq(true));
            verify(audit).log(anyString(), eq("CREATION_CLIENT_PP"), eq(AuditService.SUCCES),
                    eq("jean.dupont@example.com"), eq("127.0.0.1"));
        }

        @Test
        void cree_les_comptes_joints_pour_les_signataires_additionnels() {
            when(jdbc.queryForObject(anyString(), eq(UUID.class), any(Object[].class))).thenReturn(CLIENT_ID);
            when(password.hash(anyString())).thenReturn("hash");
            when(cipher.encrypt(anyString())).thenReturn("cipher");
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "ACTIF"));

            CreateClientRequest req = new CreateClientRequest("PP", "Jean Dupont", null, "NON_QUALIFIE",
                    "JOINT", new ReqAdresse("DOMICILE", null, "Rue de la Paix", null, "Yaounde", "Cameroun"),
                    List.of(signataire("Dupont", "jean.dupont@example.com", "699000000"),
                            signataire("Martin", "martin@example.com", "698000000")),
                    List.of(sousCompte("SC-001")), null, null);

            controller.createClient(manager, ip, req);

            verify(credentials).sendInitialPassword(eq("martin@example.com"), eq("698000000"),
                    anyString(), anyString(), eq(true));
        }
    }

    // ───────────────────────────── PATCH /clients/{id} ─────────────────────────────

    @Nested
    class UpdateClient {

        private UpdateClientRequest emptyRequest() {
            return new UpdateClientRequest(null, null, null, null, null, null, null, null, null, null, null, null);
        }

        @Test
        void leve_une_exception_si_le_client_est_introuvable() {
            when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenReturn(null);

            assertThatThrownBy(() -> controller.updateClient(manager, ip, CLIENT_ID, emptyRequest()))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void refuse_une_categorie_invalide() {
            when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class)))
                    .thenReturn("CLIENT_PP");

            UpdateClientRequest req = new UpdateClientRequest(null, null, "INVALIDE", null, null, null,
                    null, null, null, null, null, null);

            assertThatThrownBy(() -> controller.updateClient(manager, ip, CLIENT_ID, req))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void refuse_un_statut_invalide() {
            when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class)))
                    .thenReturn("CLIENT_PP");

            UpdateClientRequest req = new UpdateClientRequest(null, null, null, null, "PAS_UN_STATUT", null,
                    null, null, null, null, null, null);

            assertThatThrownBy(() -> controller.updateClient(manager, ip, CLIENT_ID, req))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void met_a_jour_le_dossier_et_trace_laudit() {
            when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class)))
                    .thenReturn("CLIENT_PP");
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont modifie", "BLOQUE"));

            UpdateClientRequest req = new UpdateClientRequest("Jean Dupont modifie", null, null, null,
                    "BLOQUE", null, null, null, null, null, null, null);

            ClientDossier dossier = controller.updateClient(manager, ip, CLIENT_ID, req);

            assertThat(dossier.raisonSociale()).isEqualTo("Jean Dupont modifie");
            verify(manager).require(Permission.CLIENT_MANAGE);
            verify(audit).log(anyString(), eq("MODIFICATION_CLIENT"), eq(AuditService.SUCCES),
                    eq(CLIENT_ID.toString()), eq("127.0.0.1"));
        }
    }

    // ───────────────────────────── DELETE /clients/{id} ─────────────────────────────

    @Nested
    class DeactivateClient {

        @Test
        void leve_une_exception_si_le_client_est_introuvable() {
            when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class))).thenReturn(null);

            assertThatThrownBy(() -> controller.deactivateClient(manager, ip, CLIENT_ID))
                    .isInstanceOf(ApiException.class);
        }

        @Test
        void desactive_le_client_et_trace_laudit() {
            when(jdbc.query(anyString(), any(ResultSetExtractor.class), any(Object[].class)))
                    .thenReturn("CLIENT_PP");
            stubDossierRows(dossierRow(CLIENT_ID, "PP", "Jean Dupont", "CLOTURE"));

            ClientDossier dossier = controller.deactivateClient(manager, ip, CLIENT_ID);

            assertThat(dossier.compte().statut()).isEqualTo("CLOTURE");
            verify(manager).require(Permission.CLIENT_MANAGE);
            verify(audit).log(anyString(), eq("DESACTIVATION_CLIENT"), eq(AuditService.SUCCES),
                    eq(CLIENT_ID.toString()), eq("127.0.0.1"));
        }
    }
}