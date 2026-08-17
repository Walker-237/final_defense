package cm.afriland.titres.integration;

import java.util.Hashtable;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import java.io.IOException;

import javax.naming.AuthenticationException;
import javax.naming.Context;
import javax.naming.NamingEnumeration;
import javax.naming.NamingException;
import javax.naming.directory.SearchControls;
import javax.naming.directory.SearchResult;
import javax.naming.ldap.InitialLdapContext;
import javax.naming.ldap.LdapContext;
import javax.naming.ldap.StartTlsRequest;
import javax.naming.ldap.StartTlsResponse;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import cm.afriland.titres.security.SecretCipher;
import jakarta.annotation.PostConstruct;

import java.util.HashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Parametres LDAP / Active Directory persistes en base et configurables par
 * l'administrateur. Le mot de passe du compte de service (bind) est chiffre au
 * repos (AES-GCM) et n'est jamais expose par l'API.
 *
 * <p>La methode {@link #testConnection()} tente une liaison (bind) reelle vers
 * l'annuaire avec les parametres enregistres — utile pour valider la
 * configuration depuis l'interface d'administration.</p>
 */
@Service
public class LdapSettingsService {

    private static final Logger log = LoggerFactory.getLogger(LdapSettingsService.class);

    private static final String DEFAULT_USER_SEARCH_FILTER = "(sAMAccountName={0})";

    private final JdbcTemplate jdbc;
    private final SecretCipher cipher;
    private final AtomicReference<LdapSettings> cache = new AtomicReference<>();

    public LdapSettingsService(JdbcTemplate jdbc, SecretCipher cipher) {
        this.jdbc = jdbc;
        this.cipher = cipher;
    }

    /** Vue interne ; {@code bindPassword} est en clair (jamais serialise vers l'API). */
    public record LdapSettings(
            boolean enabled, String host, int port, boolean ssl, boolean startTls,
            String baseDn, String bindDn, String bindPassword,
            String userSearchBase, String userSearchFilter) {
    }

    /** Resultat d'une tentative d'authentification LDAP. */
    public enum LdapAuthResult {
        AUTHENTICATED,
        REJECTED,
        UNAVAILABLE
    }

    public record LdapSettingsUpdate(
            boolean enabled, String host, int port, boolean ssl, boolean startTls,
            String baseDn, String bindDn, String newPassword,
            String userSearchBase, String userSearchFilter) {
    }

    public record TestResult(boolean ok, String message) {
    }

    @PostConstruct
    public void reload() {
        try {
            LdapSettings loaded = jdbc.queryForObject(
                    "SELECT enabled, host, port, ssl, start_tls, base_dn, bind_dn, bind_password_enc, "
                            + "user_search_base, user_search_filter FROM ldap_settings WHERE id = TRUE",
                    (rs, n) -> new LdapSettings(
                            rs.getBoolean("enabled"),
                            rs.getString("host"),
                            rs.getInt("port"),
                            rs.getBoolean("ssl"),
                            rs.getBoolean("start_tls"),
                            rs.getString("base_dn"),
                            rs.getString("bind_dn"),
                            cipher.decrypt(rs.getString("bind_password_enc")),
                            rs.getString("user_search_base"),
                            rs.getString("user_search_filter")));
            cache.set(loaded);
        } catch (RuntimeException e) {
            log.warn("Parametres LDAP indisponibles : {}", e.getMessage());
            cache.set(new LdapSettings(false, null, 389, false, false,
                    null, null, null, null, DEFAULT_USER_SEARCH_FILTER));
        }
    }

    public LdapSettings get() {
        LdapSettings s = cache.get();
        if (s == null) {
            reload();
            s = cache.get();
        }
        return s;
    }

    /** Met a jour les parametres. {@code newPassword} null = inchange ; "" = efface. */
    public void update(LdapSettingsUpdate u, UUID adminId) {
        String passwordEnc;
        if (u.newPassword() == null) {
            passwordEnc = jdbc.query("SELECT bind_password_enc FROM ldap_settings WHERE id = TRUE",
                    rs -> rs.next() ? rs.getString("bind_password_enc") : null);
        } else {
            passwordEnc = cipher.encrypt(u.newPassword());
        }
        jdbc.update(
                "UPDATE ldap_settings SET enabled = ?, host = ?, port = ?, ssl = ?, start_tls = ?, "
                        + "base_dn = ?, bind_dn = ?, bind_password_enc = ?, user_search_base = ?, "
                        + "user_search_filter = ?, updated_at = now(), updated_by = ? WHERE id = TRUE",
                u.enabled(), trimToNull(u.host()), u.port(), u.ssl(), u.startTls(),
                trimToNull(u.baseDn()), trimToNull(u.bindDn()), passwordEnc,
                trimToNull(u.userSearchBase()),
                u.userSearchFilter() == null || u.userSearchFilter().isBlank()
                        ? DEFAULT_USER_SEARCH_FILTER : u.userSearchFilter().trim(),
                adminId);
        reload();
    }

    /** Expose les parametres pour l'API (sans mot de passe). */
    public Map<String, Object> publicView() {
        LdapSettings s = get();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", s.enabled());
        m.put("host", s.host() == null ? "" : s.host());
        m.put("port", s.port());
        m.put("ssl", s.ssl());
        m.put("startTls", s.startTls());
        m.put("baseDn", s.baseDn() == null ? "" : s.baseDn());
        m.put("bindDn", s.bindDn() == null ? "" : s.bindDn());
        m.put("userSearchBase", s.userSearchBase() == null ? "" : s.userSearchBase());
        m.put("userSearchFilter", s.userSearchFilter() == null ? "" : s.userSearchFilter());
        m.put("bindPasswordSet", s.bindPassword() != null && !s.bindPassword().isBlank());
        return m;
    }

    /** Tente une liaison (bind) vers l'annuaire avec les parametres enregistres. */
    public TestResult testConnection() {
        LdapSettings s = get();
        if (s.host() == null || s.host().isBlank()) {
            return new TestResult(false, "Hote LDAP non renseigne.");
        }
        String principal = (s.bindDn() != null && !s.bindDn().isBlank()) ? s.bindDn() : null;
        String url = (s.ssl() ? "ldaps://" : "ldap://") + s.host() + ":" + s.port();
        try {
            openContext(s, principal, s.bindPassword()).close();
            return new TestResult(true, "Connexion LDAP reussie (" + url + ").");
        } catch (Exception e) {
            log.info("Echec du test LDAP vers {} : {}", url, e.getMessage());
            return new TestResult(false, "Echec de connexion : " + e.getMessage());
        }
    }

    public LdapAuthResult authenticate(String identifier, String password) {
        LdapSettings s = get();
        if (!s.enabled() || s.host() == null || s.host().isBlank()) {
            return LdapAuthResult.UNAVAILABLE;
        }
        if (identifier == null || identifier.isBlank() || password == null || password.isEmpty()) {
            return LdapAuthResult.REJECTED;
        }
        String searchBase = (s.userSearchBase() != null && !s.userSearchBase().isBlank())
                ? s.userSearchBase() : s.baseDn();
        if (searchBase == null || searchBase.isBlank()) {
            return LdapAuthResult.UNAVAILABLE;
        }
        LdapContext ctx = null;
        try {
            ctx = bindServiceAccount(s);
            String userDn = findUserDn(ctx, s, searchBase, identifier);
            if (userDn == null) {
                return LdapAuthResult.UNAVAILABLE;
            }
            return bindAsUser(s, userDn, password) ? LdapAuthResult.AUTHENTICATED : LdapAuthResult.REJECTED;
        } catch (Exception e) {
            log.info("Authentification LDAP impossible pour {} : {}", identifier, e.getMessage());
            return LdapAuthResult.UNAVAILABLE;
        } finally {
            closeQuietly(ctx);
        }
    }

    private LdapContext bindServiceAccount(LdapSettings s) throws NamingException, IOException {
        String principal = (s.bindDn() != null && !s.bindDn().isBlank()) ? s.bindDn() : null;
        return openContext(s, principal, s.bindPassword());
    }

    private String findUserDn(LdapContext ctx, LdapSettings s, String searchBase, String identifier)
            throws NamingException {
        SearchControls sc = new SearchControls();
        sc.setSearchScope(SearchControls.SUBTREE_SCOPE);
        sc.setCountLimit(1);
        sc.setReturningAttributes(new String[0]);
        String filter = (s.userSearchFilter() == null || s.userSearchFilter().isBlank())
                ? DEFAULT_USER_SEARCH_FILTER : s.userSearchFilter();
        NamingEnumeration<SearchResult> res = ctx.search(searchBase, filter, new Object[]{ identifier }, sc);
        try {
            return res.hasMore() ? res.next().getNameInNamespace() : null;
        } finally {
            res.close();
        }
    }

    private boolean bindAsUser(LdapSettings s, String userDn, String password)
            throws NamingException, IOException {
        try {
            openContext(s, userDn, password).close();
            return true;
        } catch (AuthenticationException ae) {
            return false;
        }
    }

    private static void closeQuietly(LdapContext ctx) {
        if (ctx != null) {
            try {
                ctx.close();
            } catch (NamingException ignored) {
                /* */
            }
        }
    }

    /** Ouvre un contexte LDAP, avec liaison simple (bind) si principal fourni. */
    private LdapContext openContext(LdapSettings s, String principal, String credentials)
            throws NamingException, IOException {
        String url = (s.ssl() ? "ldaps://" : "ldap://") + s.host() + ":" + s.port();
        Map<String, Object> env = new HashMap<>();
        env.put(Context.INITIAL_CONTEXT_FACTORY, "com.sun.jndi.ldap.LdapCtxFactory");
        env.put(Context.PROVIDER_URL, url);
        env.put("com.sun.jndi.ldap.connect.timeout", "5000");
        env.put("com.sun.jndi.ldap.read.timeout", "5000");
        if (s.startTls() && !s.ssl()) {
            LdapContext ctx = new InitialLdapContext(new Hashtable<>(env), null);
            StartTlsResponse tls = (StartTlsResponse) ctx.extendedOperation(new StartTlsRequest());
            tls.negotiate();
            if (principal != null) {
                ctx.addToEnvironment(Context.SECURITY_AUTHENTICATION, "simple");
                ctx.addToEnvironment(Context.SECURITY_PRINCIPAL, principal);
                ctx.addToEnvironment(Context.SECURITY_CREDENTIALS, credentials == null ? "" : credentials);
                ctx.reconnect(null);
            }
            return ctx;
        }
        if (principal != null) {
            env.put(Context.SECURITY_AUTHENTICATION, "simple");
            env.put(Context.SECURITY_PRINCIPAL, principal);
            env.put(Context.SECURITY_CREDENTIALS, credentials == null ? "" : credentials);
        }
        return new InitialLdapContext(new Hashtable<>(env), null);
    }

    private static String trimToNull(String v) {
        if (v == null) return null;
        String t = v.trim();
        return t.isEmpty() ? null : t;
    }
}