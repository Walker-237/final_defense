package cm.afriland.titres.audit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.time.OffsetDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@SuppressWarnings("unchecked")
class AuditServiceTest {

    @Mock JdbcTemplate jdbc;
    @InjectMocks AuditService auditService;

    // ─── log() — chemin nominal ───────────────────────────────────────────────

    @Test
    void log_readsCurrentTip_thenInsertsChainedEntry_thenAdvancesTip() {
        when(jdbc.queryForObject(contains("SELECT tip_hash"), eq(String.class))).thenReturn("tip-abc");

        auditService.log("user-1", "CONNEXION", AuditService.SUCCES, "ref-1", "127.0.0.1");

        verify(jdbc).update(
                contains("INSERT INTO audit_log"),
                any(OffsetDateTime.class), eq("user-1"), eq("CONNEXION"), eq(AuditService.SUCCES),
                eq("ref-1"), eq("127.0.0.1"), eq("tip-abc"), any(String.class));
        verify(jdbc).update(contains("UPDATE audit_chain_state"), any(String.class));
    }

    @Test
    void log_sameFields_chainedFromDifferentTip_producesDifferentHash() {
        // Meme contenu d'evenement, tip different -> hash different : c'est
        // precisement ce qui rend une reecriture retroactive detectable.
        when(jdbc.queryForObject(contains("SELECT tip_hash"), eq(String.class)))
                .thenReturn("tip-A").thenReturn("tip-B");
        org.mockito.ArgumentCaptor<String> hash1 = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.ArgumentCaptor<String> hash2 = org.mockito.ArgumentCaptor.forClass(String.class);

        auditService.log("u", "A", AuditService.SUCCES, "ref", "1.2.3.4");
        verify(jdbc).update(contains("INSERT INTO audit_log"), any(), any(), any(), any(), any(), any(),
                eq("tip-A"), hash1.capture());
        auditService.log("u", "A", AuditService.SUCCES, "ref", "1.2.3.4");
        verify(jdbc).update(contains("INSERT INTO audit_log"), any(), any(), any(), any(), any(), any(),
                eq("tip-B"), hash2.capture());

        assertNotEquals(hash1.getValue(), hash2.getValue());
    }

    // ─── log() — exception avalée ────────────────────────────────────────────

    @Test
    void log_exception_jdbc_ne_propage_pas() {
        when(jdbc.queryForObject(contains("SELECT tip_hash"), eq(String.class)))
                .thenThrow(new RuntimeException("DB down"));
        assertDoesNotThrow(() ->
                auditService.log("user-2", "ACTION", AuditService.ECHEC, "ref-2", "10.0.0.1"));
    }

    // ─── constantes publiques ─────────────────────────────────────────────────

    @Test
    void constante_SUCCES_vaut_SUCCES() {
        assertEquals("SUCCES", AuditService.SUCCES);
    }

    @Test
    void constante_ECHEC_vaut_ECHEC() {
        assertEquals("ECHEC", AuditService.ECHEC);
    }

    // ─── verifierChaine() — le coeur de la detection d'alteration ─────────────

    @Test
    void verifierChaine_emptyLog_isIntact() {
        when(jdbc.query(contains("FROM audit_log"), any(RowMapper.class))).thenReturn(List.of());

        AuditService.IntegrityReport rapport = auditService.verifierChaine();

        assertTrue(rapport.intacte());
        assertEquals(AuditService.GENESIS_HASH, rapport.tipActuel());
    }

    @Test
    void verifierChaine_untamperedChain_isIntact() {
        // Construit une chaine de 2 entrees en utilisant la MEME fonction de hash
        // que log() (via une premiere passe reelle), pour verifier que le
        // recalcul redonne bien le meme resultat qu'a l'ecriture.
        when(jdbc.queryForObject(contains("SELECT tip_hash"), eq(String.class)))
                .thenReturn(AuditService.GENESIS_HASH);
        org.mockito.ArgumentCaptor<String> hash1 = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.ArgumentCaptor<OffsetDateTime> ts1 = org.mockito.ArgumentCaptor.forClass(OffsetDateTime.class);
        auditService.log("u1", "A1", AuditService.SUCCES, "ref1", "1.1.1.1");
        verify(jdbc).update(contains("INSERT INTO audit_log"), ts1.capture(), any(), any(), any(), any(), any(),
                any(), hash1.capture());

        AuditService.AuditEntry entree = new AuditService.AuditEntry(1, ts1.getValue(), "u1", "A1",
                AuditService.SUCCES, "ref1", "1.1.1.1", AuditService.GENESIS_HASH, hash1.getValue());
        when(jdbc.query(contains("FROM audit_log"), any(RowMapper.class))).thenReturn(List.of(entree));

        AuditService.IntegrityReport rapport = auditService.verifierChaine();

        assertTrue(rapport.intacte());
        assertEquals(hash1.getValue(), rapport.tipActuel());
    }

    @Test
    void verifierChaine_tamperedField_breaksChain_atThatEntry() {
        // Une entree dont le contenu a ete modifie APRES coup (ex. UPDATE SQL
        // direct changeant "reference") ne correspond plus a son propre
        // entry_hash, meme si prev_hash pointe correctement vers la precedente.
        AuditService.AuditEntry alteree = new AuditService.AuditEntry(1, OffsetDateTime.now(), "u1", "A1",
                AuditService.SUCCES, "REFERENCE-MODIFIEE-APRES-COUP", "1.1.1.1",
                AuditService.GENESIS_HASH, "hash-enregistre-avant-modification");
        when(jdbc.query(contains("FROM audit_log"), any(RowMapper.class))).thenReturn(List.of(alteree));

        AuditService.IntegrityReport rapport = auditService.verifierChaine();

        assertFalse(rapport.intacte());
        assertEquals(1, rapport.sequenceRupture());
    }

    @Test
    void verifierChaine_deletedEntry_breaksChainAtTheNextOne() {
        // Une ligne SUPPRIMEE directement en base (pas seulement modifiee) casse
        // le chainage a l'entree SUIVANTE : son prev_hash ne correspond plus a
        // rien dans la chaine recalculee.
        AuditService.AuditEntry survivante = new AuditService.AuditEntry(2, OffsetDateTime.now(), "u2", "A2",
                AuditService.SUCCES, "ref2", "2.2.2.2", "hash-de-la-ligne-supprimee", "hash-quelconque");
        when(jdbc.query(contains("FROM audit_log"), any(RowMapper.class))).thenReturn(List.of(survivante));

        AuditService.IntegrityReport rapport = auditService.verifierChaine();

        assertFalse(rapport.intacte());
        assertEquals(2, rapport.sequenceRupture());
    }
}
