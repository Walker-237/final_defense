package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.Permission;
import cm.afriland.titres.support.PageResponse;
import cm.afriland.titres.support.Pagination;
import cm.afriland.titres.web.AuditController.AuditEntry;

/**
 * Couverture de {@link AuditController} : verification de permission et
 * construction dynamique du SQL (filtres optionnels + pagination).
 *
 * NOTE: JdbcTemplate est mocke entierement, donc le RowMapper prive MAPPER
 * n'est jamais reellement invoque ici ; on verifie plutot que le bon SQL et
 * les bons arguments sont envoyes a jdbc.queryForObject / jdbc.query.
 * Pagination et PageResponse sont utilises reellement (non mockes) car leur
 * API exacte n'est pas connue depuis ce fichier.
 */
class AuditControllerTest {

    private JdbcTemplate jdbc;
    private AuthUser user;
    private AuditController controller;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        jdbc = mock(JdbcTemplate.class);
        user = mock(AuthUser.class);
        controller = new AuditController(jdbc);

        when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
                .thenReturn(0L);
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
                .thenReturn(List.<AuditEntry>of());
    }

    @Test
    void verifie_la_permission_AUDIT_READ() {
        controller.list(user, null, null, null, null, null);
        verify(user).require(Permission.AUDIT_READ);
    }

    @Test
    void propage_le_refus_si_permission_absente() {
        doThrow(ApiException.forbidden("interdit")).when(user).require(Permission.AUDIT_READ);

        assertThatThrownBy(() -> controller.list(user, null, null, null, null, null))
                .isInstanceOf(ApiException.class);

        verify(jdbc, org.mockito.Mockito.never())
                .query(anyString(), any(RowMapper.class), any(Object[].class));
    }

    @Test
    void sans_filtres_le_sql_ne_contient_aucune_clause_supplementaire() {
        controller.list(user, null, null, null, null, null);

        ArgumentCaptor<String> countSqlCaptor = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(countSqlCaptor.capture(), eq(Long.class), any(Object[].class));

        String countSql = countSqlCaptor.getValue();
        assertThat(countSql).doesNotContain("a.utilisateur =");
        assertThat(countSql).doesNotContain("a.action =");
        assertThat(countSql).doesNotContain("a.reference =");
    }

    @Test
    @SuppressWarnings("unchecked")
    void filtre_utilisateur_vide_est_ignore() {
        controller.list(user, "", null, null, null, null);

        ArgumentCaptor<String> countSqlCaptor = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(countSqlCaptor.capture(), eq(Long.class), any(Object[].class));
        assertThat(countSqlCaptor.getValue()).doesNotContain("a.utilisateur =");
    }

    @Test
    @SuppressWarnings("unchecked")
    void filtre_utilisateur_ajoute_la_clause_et_largument() {
        controller.list(user, "u-123", null, null, null, null);

        ArgumentCaptor<String> countSqlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> countArgsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForObject(countSqlCaptor.capture(), eq(Long.class), countArgsCaptor.capture());

        assertThat(countSqlCaptor.getValue()).contains("AND a.utilisateur = ?");
        assertThat(countArgsCaptor.getValue()).containsExactly("u-123");
    }

    @Test
    @SuppressWarnings("unchecked")
    void filtre_action_ajoute_la_clause_et_largument() {
        controller.list(user, null, "CONNEXION", null, null, null);

        ArgumentCaptor<String> countSqlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> countArgsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForObject(countSqlCaptor.capture(), eq(Long.class), countArgsCaptor.capture());

        assertThat(countSqlCaptor.getValue()).contains("AND a.action = ?");
        assertThat(countArgsCaptor.getValue()).containsExactly("CONNEXION");
    }

    @Test
    @SuppressWarnings("unchecked")
    void filtre_reference_ajoute_la_clause_et_largument() {
        controller.list(user, null, null, "REF-1", null, null);

        ArgumentCaptor<String> countSqlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> countArgsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForObject(countSqlCaptor.capture(), eq(Long.class), countArgsCaptor.capture());

        assertThat(countSqlCaptor.getValue()).contains("AND a.reference = ?");
        assertThat(countArgsCaptor.getValue()).containsExactly("REF-1");
    }

    @Test
    @SuppressWarnings("unchecked")
    void combine_les_trois_filtres_dans_le_bon_ordre() {
        controller.list(user, "u-123", "CONNEXION", "REF-1", null, null);

        ArgumentCaptor<String> dataSqlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> dataArgsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(dataSqlCaptor.capture(), any(RowMapper.class), dataArgsCaptor.capture());

        String sql = dataSqlCaptor.getValue();
        int idxUser = sql.indexOf("a.utilisateur = ?");
        int idxAction = sql.indexOf("a.action = ?");
        int idxRef = sql.indexOf("a.reference = ?");
        assertThat(idxUser).isPositive();
        assertThat(idxAction).isGreaterThan(idxUser);
        assertThat(idxRef).isGreaterThan(idxAction);

        // Les 3 premiers arguments sont les filtres, dans le meme ordre que le SQL ;
        // les 2 derniers sont limit/offset ajoutes par la pagination.
        Object[] dataArgs = dataArgsCaptor.getValue();
        assertThat(dataArgs).hasSize(5);
        assertThat(dataArgs[0]).isEqualTo("u-123");
        assertThat(dataArgs[1]).isEqualTo("CONNEXION");
        assertThat(dataArgs[2]).isEqualTo("REF-1");
    }

    @Test
    @SuppressWarnings("unchecked")
    void ajoute_limit_et_offset_de_la_pagination_a_la_fin_des_arguments() {
        Pagination expected = Pagination.of(2, 10);

        controller.list(user, null, null, null, 2, 10);

        ArgumentCaptor<Object[]> dataArgsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(anyString(), any(RowMapper.class), dataArgsCaptor.capture());

        Object[] dataArgs = dataArgsCaptor.getValue();
        assertThat(dataArgs).hasSize(2);
        assertThat(dataArgs[0]).isEqualTo(expected.limit());
        assertThat(dataArgs[1]).isEqualTo(expected.offset());
    }

    @Test
    void retourne_une_reponse_paginee_non_nulle() {
        when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class)))
                .thenReturn(3L);

        PageResponse<AuditEntry> response = controller.list(user, null, null, null, null, null);

        assertThat(response).isNotNull();
    }
}