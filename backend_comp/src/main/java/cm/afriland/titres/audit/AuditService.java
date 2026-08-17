package cm.afriland.titres.audit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ecriture dans le journal d'audit immuable (CSFT §M6), chaine
 * cryptographiquement (hash-chaining) : chaque entree porte le SHA-256 de
 * l'entree precedente + son propre contenu — comme le principe d'une
 * blockchain, sans en avoir le cout. Une modification retroactive d'une
 * entree, meme faite directement en base (hors application), casse la chaine
 * a partir de ce point et devient detectable via {@link #verifierChaine()}.
 *
 * <p>Ce chainage seul ne protege pas contre un attaquant qui modifierait une
 * ligne ET recalculerait toute la chaine a partir de la — d'ou l'ancrage
 * periodique du "tip" sur une blockchain publique (dossier {@code blockchain/},
 * Hardhat) : ce point de controle externe ne peut pas etre reecrit apres coup,
 * meme par quelqu'un ayant un acces total a la base.</p>
 *
 * <p>L'echec d'une ecriture d'audit ne fait jamais echouer la requete metier :
 * il est journalise en erreur mais l'operation se poursuit.</p>
 */
@Service
public class AuditService {

    public static final String SUCCES = "SUCCES";
    public static final String ECHEC = "ECHEC";

    /** SHA-256 de la chaine vide — meme convention que les blocs "genese" habituels. */
    static final String GENESIS_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final JdbcTemplate jdbc;

    public AuditService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record AuditEntry(long sequence, OffsetDateTime horodatage, String utilisateur, String action,
                              String resultat, String reference, String ip, String prevHash, String entryHash) {
    }

    public record IntegrityReport(boolean intacte, long entreesVerifiees, long sequenceRupture, String tipActuel) {
    }

    /**
     * Insere une entree dans {@code audit_log} et l'ajoute a la chaine de hash.
     *
     * <p>{@code synchronized} : un seul processus backend (deploiement mono-
     * instance, cf. docker-compose) — suffisant pour serialiser lecture-du-tip
     * puis ecriture sans course. Une version horizontalement scalable devrait
     * remplacer ce verrou applicatif par un verrou base (SELECT ... FOR UPDATE
     * sur audit_chain_state).</p>
     */
    @Transactional
    public synchronized void log(String utilisateur, String action, String resultat, String reference, String ip) {
        try {
            OffsetDateTime horodatage = OffsetDateTime.now();
            String prevHash = tipActuel();
            String entryHash = calculerHash(prevHash, utilisateur, action, resultat, reference, ip, horodatage);

            jdbc.update(
                    "INSERT INTO audit_log (horodatage, utilisateur, action, resultat, reference, ip, "
                            + "prev_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    horodatage, utilisateur, action, resultat, reference, ip, prevHash, entryHash);
            jdbc.update("UPDATE audit_chain_state SET tip_hash = ?, entry_count = entry_count + 1, "
                    + "updated_at = now() WHERE id = 1", entryHash);
        } catch (RuntimeException e) {
            log.error("echec de l'ecriture du journal d'audit", e);
        }
    }

    /** Hash de la derniere entree de la chaine (ou le hash "genese" si le journal est vide). */
    public String tipActuel() {
        return jdbc.queryForObject("SELECT tip_hash FROM audit_chain_state WHERE id = 1", String.class);
    }

    /** Nombre d'entrees dans la chaine (utile pour situer un ancrage). */
    public long nombreEntrees() {
        Long n = jdbc.queryForObject("SELECT entry_count FROM audit_chain_state WHERE id = 1", Long.class);
        return n == null ? 0 : n;
    }

    /**
     * Rejoue la chaine depuis le debut et recalcule chaque hash pour verifier
     * qu'aucune entree n'a ete modifiee apres coup. S'arrete a la premiere
     * rupture — une base modifiee directement (hors application) romprait la
     * chaine au point de la modification, meme si le reste du journal semble
     * intact.
     */
    public IntegrityReport verifierChaine() {
        java.util.List<AuditEntry> entrees = jdbc.query(
                "SELECT sequence, horodatage, utilisateur, action, resultat, reference, ip, prev_hash, entry_hash "
                        + "FROM audit_log ORDER BY sequence",
                (rs, n) -> new AuditEntry(
                        rs.getLong("sequence"), rs.getObject("horodatage", OffsetDateTime.class),
                        rs.getString("utilisateur"), rs.getString("action"), rs.getString("resultat"),
                        rs.getString("reference"), rs.getString("ip"),
                        rs.getString("prev_hash"), rs.getString("entry_hash")));

        String attendu = GENESIS_HASH;
        for (AuditEntry e : entrees) {
            boolean chainonValide = attendu.equals(e.prevHash());
            String recalcule = calculerHash(e.prevHash(), e.utilisateur(), e.action(), e.resultat(),
                    e.reference(), e.ip(), e.horodatage());
            boolean contenuValide = recalcule.equals(e.entryHash());
            if (!chainonValide || !contenuValide) {
                return new IntegrityReport(false, entrees.size(), e.sequence(), attendu);
            }
            attendu = e.entryHash();
        }
        return new IntegrityReport(true, entrees.size(), -1, attendu);
    }

    private static String calculerHash(String prevHash, String utilisateur, String action, String resultat,
                                       String reference, String ip, OffsetDateTime horodatage) {
        String contenu = String.join("|", prevHash, nz(utilisateur), nz(action), nz(resultat), nz(reference),
                nz(ip), horodatage.toInstant().toString());
        try {
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            byte[] digest = sha256.digest(contenu.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 fait partie de toute JVM standard (JEP 287) — ne devrait jamais survenir.
            throw new IllegalStateException("SHA-256 indisponible", e);
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
