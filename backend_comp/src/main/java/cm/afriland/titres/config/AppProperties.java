package cm.afriland.titres.config;

import java.util.Arrays;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration applicative chargee depuis l'environnement (prefixe {@code app}).
 *
 * Securite : le secret JWT est obligatoire et doit faire au moins 32 caracteres.
 */
@ConfigurationProperties(prefix = "app")
public class AppProperties {

    private static final String DEFAULT_FRONTEND_ORIGIN = "http://localhost:4200";
    private static final String AUTH_MODE_LOCAL = "LOCAL";

    /** Secret de signature des jetons JWT (HS256) — >= 32 caracteres. */
    private String jwtSecret;

    /** Duree de vie du jeton d'acces, en secondes (15 min par defaut). */
    private long accessTokenTtl = 900;

    /** Duree de vie du jeton de rafraichissement, en secondes (30 jours). */
    private long refreshTokenTtl = 2_592_000;

    /** Origine autorisee pour le CORS (frontend Angular). */
    private String frontendOrigin = DEFAULT_FRONTEND_ORIGIN;

    /**
     * Mode d'authentification a la plateforme :
     * LOCAL — mot de passe verifie en base (defaut).
     * LDAP — mot de passe verifie via LDAP / Active Directory (strict).
     * LDAP_THEN_LOCAL — verification LDAP pour les comptes de l'annuaire, repli
     * sur la base pour les comptes absents de l'annuaire (hybride).
     */
    private String authMode = AUTH_MODE_LOCAL;

    /** Insere le jeu de donnees de demonstration si la base est vide. */
    private boolean seedOnStart = true;

    /**
     * Mot de passe commun aux comptes de demonstration inseres par
     * {@code SeedRunner}. Aucune valeur par defaut en dur : doit etre fourni
     * par la configuration (ex. application-dev.yml, jamais commite pour un
     * environnement sensible). Si absent, {@code SeedRunner} refuse de peupler
     * la base plutot que d'utiliser un mot de passe implicite.
     */
    private String seedDemoPassword;

    /** Code OTP fixe pour la demo. Vide en production (OTP aleatoire). */
    private String mfaDevCode;

    /**
     * URL de base du serveur Amplitude / AIF (proxy interne uniquement). Aucune
     * valeur par defaut en dur : l'adresse du serveur AIF est une information
     * d'infrastructure interne et doit provenir uniquement de la configuration
     * (application-dev.yml en local, variable d'environnement APP_AIF_BASE_URL
     * ailleurs).
     */
    private String aifBaseUrl;

    /** Login HTTP basic ou X-SBS-login transmis a AIF (jamais expose au front). */
    private String aifLogin;

    /** Mot de passe AIF (jamais expose au front). */
    private String aifPassword;

    /** Si vrai, on accepte les certificats TLS auto-signes du serveur AIF. */
    private boolean aifTrustAllCerts = true;

    /** Adresse expediteur pour les e-mails sortants (diffusion catalogue). */
    private String mailFrom = "no-reply@afriland.cm";

    /** Nom affiche de l'expediteur. */
    private String mailFromName = "Afriland First Bank - DFT";

    /**
     * Cle d'API Claude (Anthropic) pour l'assistant conversationnel de la
     * plateforme. Aucune valeur par defaut en dur ; si absente, le chatbot
     * repond avec une erreur explicite plutot que d'echouer silencieusement.
     */
    private String anthropicApiKey;

    /**
     * Cle d'API DeepSeek pour l'assistant conversationnel — fournisseur par
     * defaut (bascule automatique vers Anthropic si indisponible ou en echec).
     */
    private String deepseekApiKey;

    /** Parametres SMTP fournis par l'environnement. */
    private String smtpHost;
    private int smtpPort = 587;
    private String smtpUsername;
    private String smtpPassword;
    private boolean smtpAuth = true;
    private boolean smtpStarttls = true;

    public void validate() {
        if (jwtSecret == null || jwtSecret.length() < 32) {
            throw new IllegalStateException("APP_JWT_SECRET doit comporter au moins 32 caracteres");
        }
    }

    public String getJwtSecret() {
        return jwtSecret;
    }

    public void setJwtSecret(String jwtSecret) {
        this.jwtSecret = jwtSecret;
    }

    public long getAccessTokenTtl() {
        return accessTokenTtl;
    }

    public void setAccessTokenTtl(long accessTokenTtl) {
        this.accessTokenTtl = accessTokenTtl;
    }

    public long getRefreshTokenTtl() {
        return refreshTokenTtl;
    }

    public void setRefreshTokenTtl(long refreshTokenTtl) {
        this.refreshTokenTtl = refreshTokenTtl;
    }

    public String getFrontendOrigin() {
        return frontendOrigin;
    }

    public void setFrontendOrigin(String frontendOrigin) {
        this.frontendOrigin = frontendOrigin;
    }

    /**
     * Origine PRINCIPALE du frontend, pour construire des liens absolus (e-mails
     * de reinitialisation, QR de connexion, logo). {@code frontendOrigin} peut
     * contenir plusieurs origines separees par des virgules (CORS) : on retient
     * la premiere, sans slash final.
     */
    public String getPrimaryFrontendOrigin() {
        String raw = frontendOrigin == null ? "" : frontendOrigin.trim();
        if (raw.isEmpty()) {
            return DEFAULT_FRONTEND_ORIGIN;
        }
        // Safer split: avoid regex backtracking vulnerability
        String[] parts = raw.split(",", -1); // limit not needed, but safe
        String first = parts[0].trim();
        if (first.isEmpty()) {
            first = DEFAULT_FRONTEND_ORIGIN;
        }
        // Remove trailing slash if present
        return first.endsWith("/") ? first.substring(0, first.length() - 1) : first;
    }

    /** Toutes les origines frontend autorisees (CORS, WebSocket), sans espaces ni vides. */
    public String[] getFrontendOrigins() {
        String raw = frontendOrigin == null ? "" : frontendOrigin;
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(o -> !o.isEmpty())
                .toArray(String[]::new);
    }

    public String getAuthMode() {
        String m = authMode == null ? AUTH_MODE_LOCAL : authMode.trim().toUpperCase();
        return switch (m) {
            case "LDAP", "LDAP_THEN_LOCAL", AUTH_MODE_LOCAL -> m;
            default -> AUTH_MODE_LOCAL;
        };
    }

    public void setAuthMode(String authMode) {
        this.authMode = authMode;
    }

    public boolean isSeedOnStart() {
        return seedOnStart;
    }

    public void setSeedOnStart(boolean seedOnStart) {
        this.seedOnStart = seedOnStart;
    }

    public String getSeedDemoPassword() {
        if (seedDemoPassword != null && seedDemoPassword.isBlank()) return null;
        return seedDemoPassword;
    }

    public void setSeedDemoPassword(String seedDemoPassword) {
        this.seedDemoPassword = seedDemoPassword;
    }

    public String getMfaDevCode() {
        if (mfaDevCode != null && mfaDevCode.isBlank()) return null;
        return mfaDevCode;
    }

    public void setMfaDevCode(String mfaDevCode) {
        this.mfaDevCode = mfaDevCode;
    }

    public String getAifBaseUrl() {
        return aifBaseUrl;
    }

    public void setAifBaseUrl(String aifBaseUrl) {
        this.aifBaseUrl = aifBaseUrl;
    }

    public String getAifLogin() {
        if (aifLogin != null && aifLogin.isBlank()) return null;
        return aifLogin;
    }

    public void setAifLogin(String aifLogin) {
        this.aifLogin = aifLogin;
    }

    public String getAifPassword() {
        if (aifPassword != null && aifPassword.isBlank()) return null;
        return aifPassword;
    }

    public void setAifPassword(String aifPassword) {
        this.aifPassword = aifPassword;
    }

    public boolean isAifTrustAllCerts() {
        return aifTrustAllCerts;
    }

    public void setAifTrustAllCerts(boolean aifTrustAllCerts) {
        this.aifTrustAllCerts = aifTrustAllCerts;
    }

    public String getMailFrom() {
        return mailFrom;
    }

    public void setMailFrom(String mailFrom) {
        this.mailFrom = mailFrom;
    }

    public String getMailFromName() {
        return mailFromName;
    }

    public void setMailFromName(String mailFromName) {
        this.mailFromName = mailFromName;
    }

    public String getAnthropicApiKey() {
        if (anthropicApiKey != null && anthropicApiKey.isBlank()) return null;
        return anthropicApiKey;
    }

    public void setAnthropicApiKey(String anthropicApiKey) {
        this.anthropicApiKey = anthropicApiKey;
    }

    public String getDeepseekApiKey() {
        if (deepseekApiKey != null && deepseekApiKey.isBlank()) return null;
        return deepseekApiKey;
    }

    public void setDeepseekApiKey(String deepseekApiKey) {
        this.deepseekApiKey = deepseekApiKey;
    }

    public String getSmtpHost() {
        return smtpHost;
    }

    public void setSmtpHost(String smtpHost) {
        this.smtpHost = smtpHost;
    }

    public int getSmtpPort() {
        return smtpPort;
    }

    public void setSmtpPort(int smtpPort) {
        this.smtpPort = smtpPort;
    }

    public String getSmtpUsername() {
        return smtpUsername;
    }

    public void setSmtpUsername(String smtpUsername) {
        this.smtpUsername = smtpUsername;
    }

    public String getSmtpPassword() {
        return smtpPassword;
    }

    public void setSmtpPassword(String smtpPassword) {
        this.smtpPassword = smtpPassword;
    }

    public boolean isSmtpAuth() {
        return smtpAuth;
    }

    public void setSmtpAuth(boolean smtpAuth) {
        this.smtpAuth = smtpAuth;
    }

    public boolean isSmtpStarttls() {
        return smtpStarttls;
    }

    public void setSmtpStarttls(boolean smtpStarttls) {
        this.smtpStarttls = smtpStarttls;
    }

    /** Vrai si un hote SMTP est fourni par l'environnement (override prioritaire). */
    public boolean hasSmtpEnvConfig() {
        return smtpHost != null && !smtpHost.isBlank();
    }
}