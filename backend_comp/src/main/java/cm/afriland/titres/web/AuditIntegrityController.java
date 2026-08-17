package cm.afriland.titres.web;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.Permission;

/**
 * Etat d'integrite du journal d'audit (chainage de hash + historique des
 * ancrages on-chain). Lecture seule — l'ancrage lui-meme est effectue par le
 * script Hardhat (dossier {@code blockchain/}), qui ecrit directement dans
 * {@code audit_chain_anchors} : cette API ne fait qu'exposer l'etat pour le
 * back-office.
 */
@RestController
@RequestMapping("/api/v1/audit/integrity")
public class AuditIntegrityController {

    private final AuditService audit;
    private final JdbcTemplate jdbc;

    public AuditIntegrityController(AuditService audit, JdbcTemplate jdbc) {
        this.audit = audit;
        this.jdbc = jdbc;
    }

    record AnchorDto(UUID id, String tipHash, long entryCount, String txHash, String network,
                      String contractAddress, OffsetDateTime anchoredAt) {
    }

    record IntegrityStatus(boolean intacte, long entreesVerifiees, long sequenceRupture, String tipActuel,
                            AnchorDto dernierAncrage, long entreesNonAncrees) {
    }

    /** {@code GET /audit/integrity} — verifie la chaine + situe le dernier ancrage on-chain. */
    @GetMapping
    public IntegrityStatus status(AuthUser user) {
        user.require(Permission.AUDIT_READ);

        AuditService.IntegrityReport rapport = audit.verifierChaine();
        AnchorDto dernier = jdbc.query(
                        "SELECT id, tip_hash, entry_count, tx_hash, network, contract_address, anchored_at "
                                + "FROM audit_chain_anchors ORDER BY anchored_at DESC LIMIT 1",
                        (rs, n) -> new AnchorDto(
                                rs.getObject("id", UUID.class), rs.getString("tip_hash"),
                                rs.getLong("entry_count"), rs.getString("tx_hash"), rs.getString("network"),
                                rs.getString("contract_address"), rs.getObject("anchored_at", OffsetDateTime.class)))
                .stream().findFirst().orElse(null);

        long nonAncrees = dernier == null ? rapport.entreesVerifiees() : rapport.entreesVerifiees() - dernier.entryCount();
        return new IntegrityStatus(rapport.intacte(), rapport.entreesVerifiees(), rapport.sequenceRupture(),
                rapport.tipActuel(), dernier, Math.max(0, nonAncrees));
    }

    /** {@code GET /audit/integrity/anchors} — historique complet des ancrages on-chain. */
    @GetMapping("/anchors")
    public List<AnchorDto> anchors(AuthUser user) {
        user.require(Permission.AUDIT_READ);
        return jdbc.query(
                "SELECT id, tip_hash, entry_count, tx_hash, network, contract_address, anchored_at "
                        + "FROM audit_chain_anchors ORDER BY anchored_at DESC",
                (rs, n) -> new AnchorDto(
                        rs.getObject("id", UUID.class), rs.getString("tip_hash"),
                        rs.getLong("entry_count"), rs.getString("tx_hash"), rs.getString("network"),
                        rs.getString("contract_address"), rs.getObject("anchored_at", OffsetDateTime.class)));
    }
}
