package cm.afriland.titres.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.Permission;
import cm.afriland.titres.web.AuditIntegrityController.AnchorDto;
import cm.afriland.titres.web.AuditIntegrityController.IntegrityStatus;

/** Tests for {@link AuditIntegrityController}. */
@SuppressWarnings("unchecked")
class AuditIntegrityControllerTest {

    @Test
    void status_requiresAuditReadPermission() {
        AuditService audit = mock(AuditService.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AuthUser user = mock(AuthUser.class);
        when(audit.verifierChaine()).thenReturn(new AuditService.IntegrityReport(true, 5, -1, "tip-x"));
        when(jdbc.query(contains("FROM audit_chain_anchors"), any(RowMapper.class))).thenReturn(List.of());

        new AuditIntegrityController(audit, jdbc).status(user);

        verify(user).require(Permission.AUDIT_READ);
    }

    @Test
    void status_noAnchorYet_allEntriesCountAsUnanchored() {
        AuditService audit = mock(AuditService.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AuthUser user = mock(AuthUser.class);
        when(audit.verifierChaine()).thenReturn(new AuditService.IntegrityReport(true, 12, -1, "tip-x"));
        when(jdbc.query(contains("FROM audit_chain_anchors"), any(RowMapper.class))).thenReturn(List.of());

        IntegrityStatus status = new AuditIntegrityController(audit, jdbc).status(user);

        assertThat(status.intacte()).isTrue();
        assertThat(status.dernierAncrage()).isNull();
        assertThat(status.entreesNonAncrees()).isEqualTo(12);
    }

    @Test
    void status_withAnchor_countsOnlyEntriesSinceLastAnchor() {
        AuditService audit = mock(AuditService.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AuthUser user = mock(AuthUser.class);
        when(audit.verifierChaine()).thenReturn(new AuditService.IntegrityReport(true, 20, -1, "tip-x"));
        AnchorDto ancrage = new AnchorDto(UUID.randomUUID(), "tip-at-15", 15, "0xabc", "sepolia",
                "0xcontract", OffsetDateTime.now());
        when(jdbc.query(contains("FROM audit_chain_anchors"), any(RowMapper.class))).thenReturn(List.of(ancrage));

        IntegrityStatus status = new AuditIntegrityController(audit, jdbc).status(user);

        assertThat(status.entreesNonAncrees()).isEqualTo(5);
    }

    @Test
    void brokenChain_isReportedAsNotIntact() {
        AuditService audit = mock(AuditService.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AuthUser user = mock(AuthUser.class);
        when(audit.verifierChaine()).thenReturn(new AuditService.IntegrityReport(false, 20, 7, "tip-avant-rupture"));
        when(jdbc.query(contains("FROM audit_chain_anchors"), any(RowMapper.class))).thenReturn(List.of());

        IntegrityStatus status = new AuditIntegrityController(audit, jdbc).status(user);

        assertThat(status.intacte()).isFalse();
        assertThat(status.sequenceRupture()).isEqualTo(7);
    }
}
