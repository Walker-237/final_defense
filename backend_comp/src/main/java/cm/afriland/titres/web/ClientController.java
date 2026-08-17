package cm.afriland.titres.web;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import cm.afriland.titres.audit.AuditService;
import cm.afriland.titres.dto.UserProfile;
import cm.afriland.titres.dto.UserRow;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.notif.CredentialDelivery;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;
import cm.afriland.titres.security.PasswordService;
import cm.afriland.titres.security.Permission;
import cm.afriland.titres.security.Tokens;
import cm.afriland.titres.support.PageResponse;
import cm.afriland.titres.support.Pagination;

/**
 * Module 10 — Administration : clients investisseurs (PP / PM).
 *
 * Le dossier client (profil, adresses, contacts, sous-comptes) est lu/ecrit
 * depuis PostgreSQL — aucune donnee n'est codee en dur.
 */
@RestController
@RequestMapping("/api/v1/clients")
public class ClientController {

    /** Tous les clients (CLIENT_PP/CLIENT_PM) sont inclus, qu'ils aient un
     *  dossier formalise (`client_profiles`) ou non — les comptes seeds et les
     *  comptes crees avant la formalisation du dossier doivent apparaitre dans
     *  le registre BO. Quand le profil manque, on synthetise des valeurs par
     *  defaut a partir du compte utilisateur (`raison_sociale` = nom prenom,
     *  type derive du role, statut ACTIF, date d'ouverture inconnue). */
    private static final String CLIENT_ROLES = "('CLIENT_PP','CLIENT_PM')";

    private static final String AND_USER_ID = " AND u.id = ?";
    private static final String CLIENT_INTROUVABLE = "Client introuvable.";
    private static final String ROLE_CLIENT_PM = "CLIENT_PM";
    private static final String CATEGORIE_QUALIFIE = "QUALIFIE";
    private static final String CATEGORIE_NON_QUALIFIE = "NON_QUALIFIE";
    private static final String STATUT_ACTIF = "ACTIF";
    private static final String STATUT_BLOQUE = "BLOQUE";
    private static final String STATUT_SUSPENDU = "SUSPENDU";
    private static final String STATUT_CLOTURE = "CLOTURE";
    private static final Set<String> STATUTS_VALIDES =
            Set.of(STATUT_ACTIF, STATUT_BLOQUE, STATUT_SUSPENDU, STATUT_CLOTURE);
    private static final String COL_USER_ID = "user_id";

    private static final String TYPE_TITULAIRE = "TITULAIRE";
    private static final String TYPE_CONSERVATION = "CONSERVATION";
    private static final String LIBELLE_CONSERVATION_DEFAUT = "Compte de conservation";
    private static final String TYPE_COMPTE_JOINT = "JOINT";
    private static final String TYPE_COMPTE_INDIVIS = "INDIVIS";
    private static final String PAYS_DEFAUT = "Cameroun";

    /** Generateur pseudo-aleatoire cryptographiquement sur, utilise pour la
     *  generation des numeros de compte (identifiants bancaires) afin d'eviter
     *  toute predictibilite (Sonar java:S2245). Instance unique partagee, sans
     *  etat sensible, reutilisation sure entre appels concurrents. */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private static final String PROFILE_SELECT = "SELECT u.id AS user_id, "
            + "COALESCE(cp.type_personne, CASE WHEN u.role = 'CLIENT_PM' THEN 'PM' ELSE 'PP' END) "
            + "  AS type_personne, "
            + "COALESCE(cp.raison_sociale, "
            + "  NULLIF(trim(coalesce(u.nom,'') || ' ' || coalesce(u.prenom,'')), ''), "
            + "  u.email) AS raison_sociale, "
            + "cp.rccm, "
            + "COALESCE(cp.compte_statut, u.statut, 'ACTIF') AS compte_statut, "
            + "cp.date_ouverture, cp.created_by, cp.created_at, "
            + "NULLIF(trim(coalesce(cb.nom,'') || ' ' || coalesce(cb.prenom,'')), '') AS created_by_nom, "
            + "u.compte_titres, u.compte_especes, u.solde, u.categorie, u.type_compte "
            + "FROM users u "
            + "LEFT JOIN client_profiles cp ON cp.user_id = u.id "
            + "LEFT JOIN users cb ON cb.id = cp.created_by "
            + "WHERE u.role IN " + CLIENT_ROLES;

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;
    private final PasswordService password;
    private final AuditService audit;
    private final CredentialDelivery credentials;
    private final cm.afriland.titres.security.SecretCipher cipher;

    public ClientController(JdbcTemplate jdbc, PasswordService password, AuditService audit,
                            CredentialDelivery credentials,
                            cm.afriland.titres.security.SecretCipher cipher) {
        this.jdbc = jdbc;
        this.namedJdbc = new NamedParameterJdbcTemplate(jdbc);
        this.password = password;
        this.audit = audit;
        this.credentials = credentials;
        this.cipher = cipher;
    }

    // ─────────────────────────────── DTO ────────────────────────────────────

    record AdresseDto(String type, String residence, String rue, String codePostal,
                      String ville, String pays) {
    }

    record ContactDto(UUID id, String type, String nom, String prenom, String civilite,
                      String fonction, String telephonePortable, String telephoneDomicile,
                      String telephoneBureau, String email, String whatsapp, String pieceIdentite,
                      String numeroPiece, String dateValiditePiece, String lienParente) {
    }

    record SousCompteDto(UUID id, String numero, String libelle, String type, String statut,
                         LocalDate dateOuverture, int positionsCount, long valeurTotale,
                         String observations) {
    }

    record CompteDto(UUID id, String numero, String typeCompte, String statut, LocalDate dateOuverture,
                     String categorie, String compteEspecesLie, long soldeEspeces,
                     List<AdresseDto> adresses, List<ContactDto> contacts,
                     List<SousCompteDto> sousComptes) {
    }

    record ClientDossier(UUID id, String type, String raisonSociale, String rccm, UUID createdBy,
                         String createdByNom, OffsetDateTime createdAt, CompteDto compte) {
    }

    // --- Requete de creation ---

    record ReqAdresse(String type, String residence, String rue, String codePostal,
                      String ville, String pays) {
    }

    record ReqContact(String type, String nom, String prenom, String civilite, String fonction,
                      String telephonePortable, String telephoneDomicile, String telephoneBureau,
                      String email, String whatsapp, String pieceIdentite, String numeroPiece,
                      String dateValiditePiece, String lienParente) {
    }

    record ReqSousCompte(String numero, String libelle, String type, String statut,
                         String dateOuverture, Integer positionsCount, Long valeurTotale,
                         String observations) {
    }

    record CreateClientRequest(String type, String raisonSociale, String rccm, String categorie,
                               String typeCompte, ReqAdresse adresse, List<ReqContact> signataires,
                               List<ReqSousCompte> sousComptes, String compteEspecesLie,
                               Long soldeEspecesInitial) {
    }

    record UpdateClientRequest(String raisonSociale, String rccm, String categorie,
                               String typeCompte, String statut, String telephone,
                               String email, String compteTitres, String compteEspecesLie,
                               ReqAdresse adresse, List<ReqContact> signataires,
                               List<ReqSousCompte> sousComptes) {
    }

    // ───────────────────────────── Handlers ─────────────────────────────────

    /** {@code GET /clients} — liste des comptes investisseurs (CLIENT_MANAGE). */
    @GetMapping
    public PageResponse<UserProfile> listClients(AuthUser user,
                                                 @RequestParam(required = false) Integer page,
                                                 @RequestParam(required = false) Integer size) {
        user.require(Permission.CLIENT_MANAGE);
        Pagination pg = Pagination.of(page, size);

        List<UserProfile> data = jdbc.query(
                        "SELECT " + UserRow.COLUMNS + " FROM users WHERE role IN " + CLIENT_ROLES
                                + " ORDER BY nom, prenom LIMIT ? OFFSET ?",
                        UserRow.MAPPER, pg.limit(), pg.offset())
                .stream().map(UserRow::toProfile).toList();
        long total = jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE role IN " + CLIENT_ROLES, Long.class);
        return pg.build(data, total);
    }

    /** {@code GET /clients/dossiers} — registre des dossiers, pagine (CLIENT_MANAGE). */
    @GetMapping("/dossiers")
    public PageResponse<ClientDossier> listDossiers(AuthUser user,
                                                    @RequestParam(required = false) Integer page,
                                                    @RequestParam(required = false) Integer size) {
        user.require(Permission.CLIENT_MANAGE);
        Pagination pg = Pagination.of(page, size);

        long total = jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE role IN " + CLIENT_ROLES, Long.class);
        List<ClientDossier> data = loadDossiers(
                PROFILE_SELECT + " ORDER BY raison_sociale LIMIT ? OFFSET ?",
                pg.limit(), pg.offset());
        return pg.build(data, total);
    }

    /** {@code GET /clients/me} — dossier du client connecte (solde masque). */
    @GetMapping("/me")
    public ClientDossier myDossier(AuthUser user) {
        ClientDossier dossier = loadDossiers(PROFILE_SELECT + AND_USER_ID, user.id())
                .stream()
                .findFirst()
                .orElseThrow(() -> ApiException.notFound(CLIENT_INTROUVABLE));
        return scrubBalanceForClient(dossier, user);
    }

    /** {@code GET /clients/:id} — dossier d'un client donne (solde masque pour le client). */
    @GetMapping("/{id}")
    public ClientDossier getDossier(AuthUser user, @PathVariable UUID id) {
        boolean staff = !user.id().equals(id);
        if (staff) {
            user.require(Permission.CLIENT_MANAGE);
        }
        ClientDossier dossier = loadDossiers(PROFILE_SELECT + AND_USER_ID, id).stream()
                .findFirst()
                .orElseThrow(() -> ApiException.notFound(CLIENT_INTROUVABLE));
        return staff ? dossier : scrubBalanceForClient(dossier, user);
    }

    /**
     * Supprime la valeur du solde espece (cache base) avant de renvoyer le
     * dossier a un client. Source de verite : Amplitude/AIF, reserve au BO.
     */
    private static ClientDossier scrubBalanceForClient(ClientDossier dossier, AuthUser user) {
        if (!user.isClient() || dossier.compte() == null) return dossier;
        CompteDto c = dossier.compte();
        CompteDto scrubbed = new CompteDto(c.id(), c.numero(), c.typeCompte(), c.statut(),
                c.dateOuverture(), c.categorie(), c.compteEspecesLie(), 0L,
                c.adresses(), c.contacts(), c.sousComptes());
        return new ClientDossier(dossier.id(), dossier.type(), dossier.raisonSociale(),
                dossier.rccm(), dossier.createdBy(), dossier.createdByNom(),
                dossier.createdAt(), scrubbed);
    }

    /** {@code POST /clients} — onboarding d'un client investisseur (CLIENT_MANAGE). */
    @PostMapping
    @Transactional
    public ResponseEntity<ClientDossier> createClient(AuthUser creator, ClientIp ip,
                                                      @RequestBody CreateClientRequest req) {
        creator.require(Permission.CLIENT_MANAGE);

        String typePersonne = validateCreateRequest(req);
        String role = "PP".equals(typePersonne) ? "CLIENT_PP" : ROLE_CLIENT_PM;
        String categorie = CATEGORIE_QUALIFIE.equals(req.categorie()) ? CATEGORIE_QUALIFIE : CATEGORIE_NON_QUALIFIE;
        String typeCompte = (req.typeCompte() != null && !req.typeCompte().trim().isEmpty())
                ? req.typeCompte() : "INDIVIDUEL";

        ReqContact first = req.signataires().get(0);
        String email = normalizeAndCheckFirstSignataireEmail(first);
        boolean firstHasPhone = hasPhone(first);
        ApiException.ensure(firstHasPhone, "le numéro de téléphone du premier signataire est requis");
        validateSignatairesAndSousComptes(req);

        boolean isPm = "PM".equals(typePersonne);
        String nom = isPm ? req.raisonSociale().trim() : first.nom().trim();
        String prenom = null;
        if (!isPm) {
            prenom = first.prenom() == null ? null : first.prenom().trim();
        }
        String telephone = resolveTelephone(first, firstHasPhone);

        String compteTitres = generateUniqueAccount();
        String compteEspeces = (req.compteEspecesLie() != null && !req.compteEspecesLie().trim().isEmpty())
                ? req.compteEspecesLie().trim()
                : generateUniqueAccount(compteTitres);
        long solde = Math.max(0, req.soldeEspecesInitial() == null ? 0 : req.soldeEspecesInitial());

        String motDePasseInitial = Tokens.generatePassword();
        UUID userId = insertNewClient(req, typePersonne, role, categorie, typeCompte, email,
                nom, prenom, telephone, compteTitres, compteEspeces, solde, motDePasseInitial, creator.id());

        insertAdresse(userId, req.adresse(), isPm);
        insertSignataires(userId, req.signataires());
        insertSousComptes(userId, req.sousComptes());
        if (TYPE_COMPTE_JOINT.equals(typeCompte) || TYPE_COMPTE_INDIVIS.equals(typeCompte)) {
            createJointSignatories(req.signataires(), role, userId);
        }

        audit.log(creator.id().toString(), "CREATION_CLIENT_" + typePersonne,
                AuditService.SUCCES, email, ip.value());

        String nomComplet = prenom != null ? nom + " " + prenom : nom;
        credentials.sendInitialPassword(email, telephone, nomComplet, motDePasseInitial, true);

        ClientDossier dossier = loadDossiers(PROFILE_SELECT + AND_USER_ID, userId)
                .stream().findFirst()
                .orElseThrow(() -> new IllegalStateException("dossier introuvable après création"));
        return ResponseEntity.status(HttpStatus.CREATED).body(dossier);
    }

    @PatchMapping("/{id}")
    @Transactional
    public ClientDossier updateClient(AuthUser user, ClientIp ip, @PathVariable UUID id,
                                      @RequestBody UpdateClientRequest req) {
        user.require(Permission.CLIENT_MANAGE);

        String role = jdbc.query("SELECT role FROM users WHERE id = ? AND role IN " + CLIENT_ROLES,
                rs -> rs.next() ? rs.getString(1) : null, id);
        ApiException.ensure(role != null, CLIENT_INTROUVABLE);
        boolean pm = ROLE_CLIENT_PM.equals(role);

        String categorie = trimToNull(req.categorie());
        validateCategorie(categorie);
        String compteStatut = trimToNull(req.statut());
        validateCompteStatut(compteStatut);

        String raisonSociale = trimToNull(req.raisonSociale());
        String rccm = trimToNull(req.rccm());
        String typeCompte = trimToNull(req.typeCompte());
        checkAccountsFree(req, id);

        ClientUpdateFields f = resolveUpdateFields(req, id, pm, compteStatut, raisonSociale);
        validateSousComptes(req.sousComptes());

        applyClientUpdate(id, raisonSociale, rccm, compteStatut, categorie, typeCompte, f.telephone(),
                f.email(), f.usersStatut(), trimToNull(req.compteTitres()), trimToNull(req.compteEspecesLie()),
                f.nomEff(), f.prenomEff());

        persistRelatedEntities(id, pm, req.signataires(), req.sousComptes(), f.telephone(), f.email(),
                req.adresse());

        audit.log(user.id().toString(), "MODIFICATION_CLIENT", AuditService.SUCCES, id.toString(), ip.value());
        return loadDossiers(PROFILE_SELECT + AND_USER_ID, id).stream().findFirst()
                .orElseThrow(() -> new IllegalStateException("dossier introuvable après mise à jour"));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ClientDossier deactivateClient(AuthUser user, ClientIp ip, @PathVariable UUID id) {
        user.require(Permission.CLIENT_MANAGE);
        String role = jdbc.query("SELECT role FROM users WHERE id = ? AND role IN " + CLIENT_ROLES,
                rs -> rs.next() ? rs.getString(1) : null, id);
        ApiException.ensure(role != null, CLIENT_INTROUVABLE);

        ensureProfileRow(id);
        jdbc.update("UPDATE client_profiles SET compte_statut = 'CLOTURE' WHERE user_id = ?", id);
        jdbc.update("UPDATE users SET statut = 'SUSPENDU' WHERE id = ?", id);
        audit.log(user.id().toString(), "DESACTIVATION_CLIENT", AuditService.SUCCES, id.toString(), ip.value());
        return loadDossiers(PROFILE_SELECT + AND_USER_ID, id).stream().findFirst()
                .orElseThrow(() -> new IllegalStateException("dossier introuvable après désactivation"));
    }

    // ───────────────────────────── Helpers ──────────────────────────────────

    private record ClientUpdateFields(String usersStatut, String email, String telephone,
                                      String nomEff, String prenomEff) {}

    private ClientUpdateFields resolveUpdateFields(UpdateClientRequest req, UUID id, boolean pm,
                                                   String compteStatut, String raisonSociale) {
        String usersStatut = null;
        if (compteStatut != null) {
            usersStatut = STATUT_ACTIF.equals(compteStatut) ? STATUT_ACTIF : STATUT_SUSPENDU;
        }
        String email = normalizeNewEmail(req.email(), id);
        String telephone = trimToNull(req.telephone());
        String nomEff = pm ? raisonSociale : null;
        String prenomEff = null;

        SignataireOverride ov = resolveFirstSignataire(req.signataires(), pm, id, email, telephone);
        email = ov.email();
        telephone = ov.telephone();
        if (!pm && ov.nom() != null) {
            nomEff = ov.nom();
            prenomEff = ov.prenom();
        }
        return new ClientUpdateFields(usersStatut, email, telephone, nomEff, prenomEff);
    }

    @SuppressWarnings("java:S107")
    private void persistRelatedEntities(UUID id, boolean pm, List<ReqContact> sigs, List<ReqSousCompte> scs,
                                        String telephone, String email, ReqAdresse adresse) {
        if (sigs != null) {
            jdbc.update("DELETE FROM client_contacts WHERE user_id = ?", id);
            insertSignataires(id, sigs);
        } else if (telephone != null || email != null) {
            jdbc.update("UPDATE client_contacts SET telephone_portable = COALESCE(?, telephone_portable), "
                            + "email = COALESCE(?, email) WHERE user_id = ? AND ordre = 0",
                    telephone, email, id);
        }
        if (scs != null) {
            jdbc.update("DELETE FROM sous_comptes_titres WHERE user_id = ?", id);
            insertSousComptes(id, scs);
        }
        if (adresse != null && adresse.rue() != null && !adresse.rue().trim().isEmpty()) {
            insertOrUpdateAdresse(id, adresse, pm);
        }
    }

    private String validateCreateRequest(CreateClientRequest req) {
        String typePersonne = req.type() == null ? "" : req.type().trim().toUpperCase();
        ApiException.ensure("PP".equals(typePersonne) || "PM".equals(typePersonne),
                "type de client invalide (PP ou PM)");
        ApiException.ensure(req.raisonSociale() != null && !req.raisonSociale().trim().isEmpty(),
                "raison sociale requise");
        ApiException.ensure(req.signataires() != null && !req.signataires().isEmpty(),
                "au moins un signataire requis");
        ApiException.ensure(req.sousComptes() != null && !req.sousComptes().isEmpty(),
                "au moins un sous-compte titres requis");
        return typePersonne;
    }

    private String normalizeAndCheckFirstSignataireEmail(ReqContact first) {
        String email = (first.email() == null ? "" : first.email().trim().toLowerCase());
        ApiException.ensure(email.contains("@"),
                "Le premier signataire doit avoir un e-mail valide.");
        Long exists = jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE email = ?", Long.class, email);
        ApiException.ensure(exists == 0, "un compte existe déjà avec cet e-mail");
        ApiException.ensure(first.nom() != null && !first.nom().trim().isEmpty(),
                "le nom du premier signataire est requis");
        return email;
    }

    private static boolean hasPhone(ReqContact c) {
        return (c.telephonePortable() != null && !c.telephonePortable().trim().isEmpty())
                || (c.telephoneBureau() != null && !c.telephoneBureau().trim().isEmpty());
    }

    private static String resolveTelephone(ReqContact first, boolean firstHasPhone) {
        if (!firstHasPhone) {
            return null;
        }
        return (first.telephonePortable() != null && !first.telephonePortable().isBlank())
                ? first.telephonePortable().trim()
                : first.telephoneBureau().trim();
    }

    private void validateSignatairesAndSousComptes(CreateClientRequest req) {
        for (ReqContact c : req.signataires()) {
            ApiException.ensure(c.nom() != null && !c.nom().trim().isEmpty(),
                    "le nom de chaque signataire est requis");
        }
        for (ReqSousCompte s : req.sousComptes()) {
            ApiException.ensure(s.numero() != null && !s.numero().trim().isEmpty(),
                    "le numéro de chaque sous-compte titres est requis");
        }
    }

    @SuppressWarnings("java:S107")
    private UUID insertNewClient(CreateClientRequest req, String typePersonne, String role, String categorie,
                                 String typeCompte, String email, String nom, String prenom, String telephone,
                                 String compteTitres, String compteEspeces, long solde,
                                 String motDePasseInitial, UUID creatorId) {
        String passwordHash = password.hash(motDePasseInitial);
        UUID userId = jdbc.queryForObject(
                "INSERT INTO users (email, password_hash, role, nom, prenom, compte_titres, "
                        + "compte_especes, solde, categorie, type_compte, telephone, "
                        + "must_change_password, initial_password_enc) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?,?, TRUE, ?) RETURNING id",
                UUID.class, email, passwordHash, role, nom, prenom, compteTitres, compteEspeces,
                solde, categorie, typeCompte, telephone, cipher.encrypt(motDePasseInitial));

        jdbc.update("INSERT INTO client_profiles (user_id, type_personne, raison_sociale, rccm, "
                        + "compte_statut, created_by) VALUES (?,?,?,?, 'ACTIF', ?)",
                userId, typePersonne, req.raisonSociale().trim(),
                trimToNull(req.rccm()), creatorId);
        return userId;
    }

    private void validateCategorie(String categorie) {
        if (categorie != null) {
            ApiException.ensure(CATEGORIE_QUALIFIE.equals(categorie) || CATEGORIE_NON_QUALIFIE.equals(categorie),
                    "catégorie invalide (QUALIFIE ou NON_QUALIFIE)");
        }
    }

    private void validateCompteStatut(String compteStatut) {
        if (compteStatut != null) {
            ApiException.ensure(STATUTS_VALIDES.contains(compteStatut),
                    "statut invalide (ACTIF, BLOQUE, SUSPENDU ou CLOTURE)");
        }
    }

    private void checkAccountsFree(UpdateClientRequest req, UUID id) {
        String compteTitres = trimToNull(req.compteTitres());
        if (compteTitres != null) {
            ensureAccountFree(compteTitres, id, "ce numéro de compte-titres est déjà utilisé");
        }
        String compteEspeces = trimToNull(req.compteEspecesLie());
        if (compteEspeces != null) {
            ensureAccountFree(compteEspeces, id, "ce numéro de compte espèces est déjà utilisé");
        }
    }

    private record SignataireOverride(String email, String telephone, String nom, String prenom) {}

    private SignataireOverride resolveFirstSignataire(List<ReqContact> sigs, boolean pm, UUID id,
                                                      String currentEmail, String currentTelephone) {
        if (sigs == null) {
            return new SignataireOverride(currentEmail, currentTelephone, null, null);
        }
        ApiException.ensure(!sigs.isEmpty(), "au moins un signataire requis");
        for (ReqContact c : sigs) {
            ApiException.ensure(trimToNull(c.nom()) != null, "le nom de chaque signataire est requis");
        }
        ReqContact f = sigs.get(0);
        String fe = normalizeNewEmail(f.email(), id);
        String email = fe != null ? fe : currentEmail;
        String ft = trimToNull(f.telephonePortable());
        if (ft == null) ft = trimToNull(f.telephoneBureau());
        String telephone = ft != null ? ft : currentTelephone;
        if (pm) {
            return new SignataireOverride(email, telephone, null, null);
        }
        return new SignataireOverride(email, telephone, trimToNull(f.nom()), trimToNull(f.prenom()));
    }

    private void validateSousComptes(List<ReqSousCompte> scs) {
        if (scs != null) {
            ApiException.ensure(!scs.isEmpty(), "au moins un sous-compte titres requis");
            for (ReqSousCompte s : scs) {
                ApiException.ensure(trimToNull(s.numero()) != null,
                        "le numéro de chaque sous-compte titres est requis");
            }
        }
    }

    @SuppressWarnings("java:S107")
    private void applyClientUpdate(UUID id, String raisonSociale, String rccm, String compteStatut,
                                   String categorie, String typeCompte, String telephone, String email,
                                   String usersStatut, String compteTitres, String compteEspeces,
                                   String nomEff, String prenomEff) {
        jdbc.update("UPDATE client_profiles SET raison_sociale = COALESCE(?, raison_sociale), "
                        + "rccm = COALESCE(?, rccm), compte_statut = COALESCE(?, compte_statut) "
                        + "WHERE user_id = ?",
                raisonSociale, rccm, compteStatut, id);

        jdbc.update("UPDATE users SET categorie = COALESCE(?, categorie), "
                        + "type_compte = COALESCE(?, type_compte), telephone = COALESCE(?, telephone), "
                        + "email = COALESCE(?, email), statut = COALESCE(?, statut), "
                        + "compte_titres = COALESCE(?, compte_titres), "
                        + "compte_especes = COALESCE(?, compte_especes), "
                        + "nom = COALESCE(?, nom), prenom = COALESCE(?, prenom) "
                        + "WHERE id = ?",
                categorie, typeCompte, telephone, email, usersStatut, compteTitres, compteEspeces,
                nomEff, prenomEff, id);
    }

    private String normalizeNewEmail(String raw, UUID excludeId) {
        String e = raw == null ? null : raw.trim().toLowerCase();
        if (e == null || e.isEmpty()) return null;
        ApiException.ensure(e.contains("@"), "e-mail invalide");
        Long taken = jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE email = ? AND id <> ?", Long.class, e, excludeId);
        ApiException.ensure(taken != null && taken == 0, "un compte existe déjà avec cet e-mail");
        return e;
    }

    private void ensureAccountFree(String numero, UUID excludeId, String message) {
        Long taken = jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE (compte_titres = ? OR compte_especes = ?) AND id <> ?",
                Long.class, numero, numero, excludeId);
        ApiException.ensure(taken != null && taken == 0, message);
    }

    private void ensureProfileRow(UUID id) {
        jdbc.update("INSERT INTO client_profiles (user_id, type_personne, raison_sociale, compte_statut) "
                + "SELECT id, CASE WHEN role = 'CLIENT_PM' THEN 'PM' ELSE 'PP' END, "
                + "COALESCE(NULLIF(trim(coalesce(nom,'') || ' ' || coalesce(prenom,'')), ''), email), "
                + "'ACTIF' FROM users WHERE id = ? ON CONFLICT (user_id) DO NOTHING", id);
    }

    private String generateUniqueAccount(String... avoid) {
        Set<String> taboo = Set.of(avoid);
        for (int i = 0; i < 25; i++) {
            long n = SECURE_RANDOM.nextLong(100_000_000_000L);
            String candidate = String.format("037 10001 %011d", n);
            if (taboo.contains(candidate)) continue;
            Long exists = jdbc.queryForObject(
                    "SELECT count(*) FROM users WHERE compte_titres = ? OR compte_especes = ?",
                    Long.class, candidate, candidate);
            if (exists != null && exists == 0) {
                return candidate;
            }
        }
        throw new IllegalStateException("Impossible de générer un numéro de compte unique.");
    }

    private List<ClientDossier> loadDossiers(String profileSql, Object... profileArgs) {
        List<Object[]> rows = jdbc.query(profileSql, (rs, n) -> new Object[]{
                rs.getObject(COL_USER_ID, UUID.class),
                rs.getString("type_personne"),
                rs.getString("raison_sociale"),
                rs.getString("rccm"),
                rs.getObject("created_by", UUID.class),
                rs.getString("created_by_nom"),
                rs.getObject("created_at", OffsetDateTime.class),
                rs.getString("compte_titres"),
                rs.getString("type_compte"),
                rs.getString("compte_statut"),
                rs.getObject("date_ouverture", LocalDate.class),
                rs.getString("categorie"),
                rs.getString("compte_especes"),
                rs.getObject("solde", Long.class),
        }, profileArgs);

        if (rows.isEmpty()) {
            return List.of();
        }

        List<UUID> ids = rows.stream().map(r -> (UUID) r[0]).toList();
        Map<String, Object> params = Map.of("userIds", ids);

        Map<UUID, List<AdresseDto>> adresses = new HashMap<>();
        namedJdbc.query("""
                SELECT user_id, type, residence, rue, code_postal, ville, pays 
                FROM client_adresses 
                WHERE user_id IN (:userIds) 
                ORDER BY user_id, ordre
                """, new MapSqlParameterSource(params), (RowCallbackHandler) rs ->
                adresses.computeIfAbsent(rs.getObject(COL_USER_ID, UUID.class), k -> new ArrayList<>())
                        .add(new AdresseDto(rs.getString("type"), rs.getString("residence"),
                                rs.getString("rue"), rs.getString("code_postal"), rs.getString("ville"),
                                rs.getString("pays"))));

        Map<UUID, List<ContactDto>> contacts = new HashMap<>();
        namedJdbc.query("""
                SELECT id, user_id, type, nom, prenom, civilite, fonction, telephone_portable, 
                       telephone_domicile, telephone_bureau, email, whatsapp, piece_identite, 
                       numero_piece, date_validite_piece, lien_parente 
                FROM client_contacts 
                WHERE user_id IN (:userIds) 
                ORDER BY user_id, ordre
                """, new MapSqlParameterSource(params), (RowCallbackHandler) rs ->
                contacts.computeIfAbsent(rs.getObject(COL_USER_ID, UUID.class), k -> new ArrayList<>())
                        .add(new ContactDto(rs.getObject("id", UUID.class), rs.getString("type"),
                                rs.getString("nom"), rs.getString("prenom"), rs.getString("civilite"),
                                rs.getString("fonction"), rs.getString("telephone_portable"),
                                rs.getString("telephone_domicile"), rs.getString("telephone_bureau"),
                                rs.getString("email"), rs.getString("whatsapp"),
                                rs.getString("piece_identite"), rs.getString("numero_piece"),
                                rs.getString("date_validite_piece"), rs.getString("lien_parente"))));

        Map<UUID, List<SousCompteDto>> sousComptes = new HashMap<>();
        namedJdbc.query("""
                SELECT id, user_id, numero, libelle, type, statut, date_ouverture, 
                       positions_count, valeur_totale, observations 
                FROM sous_comptes_titres 
                WHERE user_id IN (:userIds) 
                ORDER BY user_id, ordre
                """, new MapSqlParameterSource(params), (RowCallbackHandler) rs ->
                sousComptes.computeIfAbsent(rs.getObject(COL_USER_ID, UUID.class), k -> new ArrayList<>())
                        .add(new SousCompteDto(rs.getObject("id", UUID.class), rs.getString("numero"),
                                rs.getString("libelle"), rs.getString("type"), rs.getString("statut"),
                                rs.getObject("date_ouverture", LocalDate.class),
                                rs.getInt("positions_count"), rs.getLong("valeur_totale"),
                                rs.getString("observations"))));

        List<ClientDossier> result = new ArrayList<>(rows.size());
        for (Object[] r : rows) {
            UUID uid = (UUID) r[0];
            String typeCompte = (String) r[8];
            String categorie = (String) r[11];
            Long solde = (Long) r[13];
            CompteDto compte = new CompteDto(
                    uid,
                    r[7] != null ? (String) r[7] : "",
                    typeCompte != null ? typeCompte : "INDIVIDUEL",
                    (String) r[9],
                    (LocalDate) r[10],
                    categorie != null ? categorie : CATEGORIE_NON_QUALIFIE,
                    r[12] != null ? (String) r[12] : "",
                    solde != null ? solde : 0L,
                    adresses.getOrDefault(uid, List.of()),
                    contacts.getOrDefault(uid, List.of()),
                    sousComptes.getOrDefault(uid, List.of()));
            result.add(new ClientDossier(uid, (String) r[1], (String) r[2], (String) r[3],
                    (UUID) r[4], (String) r[5], (OffsetDateTime) r[6], compte));
        }
        return result;
    }

    private void insertAdresse(UUID userId, ReqAdresse a, boolean isPm) {
        if (a == null || a.rue() == null || a.rue().trim().isEmpty()) return;
        String defaultKind = isPm ? "SIEGE" : "DOMICILE";
        jdbc.update("INSERT INTO client_adresses (user_id, type, residence, rue, code_postal, "
                        + "ville, pays, ordre) VALUES (?,?,?,?,?,?,?,0)",
                userId, a.type() != null ? a.type() : defaultKind, a.residence(),
                a.rue().trim(), a.codePostal(),
                a.ville() != null ? a.ville().trim() : "",
                a.pays() != null ? a.pays().trim() : PAYS_DEFAUT);
    }

    private void insertOrUpdateAdresse(UUID userId, ReqAdresse a, boolean isPm) {
        if (a == null || a.rue() == null || a.rue().trim().isEmpty()) return;
        String ville = a.ville() != null ? a.ville().trim() : "";
        String pays = a.pays() != null ? a.pays().trim() : PAYS_DEFAUT;
        String defaultKind = isPm ? "SIEGE" : "DOMICILE";
        String kind = a.type() != null ? a.type() : defaultKind;
        int updated = jdbc.update("UPDATE client_adresses SET type = ?, residence = ?, rue = ?, "
                        + "code_postal = ?, ville = ?, pays = ? WHERE user_id = ? AND ordre = 0",
                kind, a.residence(), a.rue().trim(), a.codePostal(), ville, pays, userId);
        if (updated == 0) {
            jdbc.update("INSERT INTO client_adresses (user_id, type, residence, rue, code_postal, "
                            + "ville, pays, ordre) VALUES (?,?,?,?,?,?,?,0)",
                    userId, kind, a.residence(), a.rue().trim(), a.codePostal(), ville, pays);
        }
    }

    private void insertSignataires(UUID userId, List<ReqContact> signataires) {
        if (signataires == null) return;
        for (int i = 0; i < signataires.size(); i++) {
            ReqContact c = signataires.get(i);
            jdbc.update("INSERT INTO client_contacts (user_id, type, nom, prenom, civilite, fonction, "
                            + "telephone_portable, telephone_domicile, telephone_bureau, email, whatsapp, "
                            + "piece_identite, numero_piece, date_validite_piece, lien_parente, ordre) "
                            + "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    userId, c.type() != null ? c.type() : TYPE_TITULAIRE, c.nom().trim(),
                    trimToNull(c.prenom()), c.civilite(), c.fonction(), c.telephonePortable(),
                    c.telephoneDomicile(), c.telephoneBureau(), c.email(), c.whatsapp(),
                    c.pieceIdentite(), c.numeroPiece(), c.dateValiditePiece(), c.lienParente(), i);
        }
    }

    private void insertSousComptes(UUID userId, List<ReqSousCompte> sousComptes) {
        if (sousComptes == null) return;
        for (int i = 0; i < sousComptes.size(); i++) {
            insertSousCompte(userId, sousComptes.get(i), i);
        }
    }

    private void insertSousCompte(UUID userId, ReqSousCompte s, int ordre) {
        LocalDate dateOuv = parseDateOuverture(s.dateOuverture());
        String libelle = (s.libelle() != null && !s.libelle().trim().isEmpty())
                ? s.libelle().trim() : LIBELLE_CONSERVATION_DEFAUT;
        jdbc.update("INSERT INTO sous_comptes_titres (user_id, numero, libelle, type, statut, "
                        + "date_ouverture, positions_count, valeur_totale, observations, ordre) "
                        + "VALUES (?,?,?,?,?,?,?,?,?,?)",
                userId, s.numero().trim(), libelle,
                s.type() != null ? s.type() : TYPE_CONSERVATION,
                s.statut() != null ? s.statut() : STATUT_ACTIF, dateOuv,
                Math.max(0, s.positionsCount() == null ? 0 : s.positionsCount()),
                Math.max(0, s.valeurTotale() == null ? 0 : s.valeurTotale()),
                trimToNull(s.observations()), ordre);
    }

    private static LocalDate parseDateOuverture(String raw) {
        if (raw == null) {
            return LocalDate.now();
        }
        try {
            return LocalDate.parse(raw);
        } catch (RuntimeException e) {
            return LocalDate.now();
        }
    }

    private void createJointSignatories(List<ReqContact> signataires, String role, UUID userId) {
        for (int i = 1; i < signataires.size(); i++) {
            ReqContact cs = signataires.get(i);
            String csEmail = cs.email() == null ? "" : cs.email().trim().toLowerCase();
            if (isEligibleForJointLogin(csEmail)) {
                createJointSignatoryLogin(cs, csEmail, role, userId);
            }
        }
    }

    private boolean isEligibleForJointLogin(String csEmail) {
        if (!csEmail.contains("@")) {
            return false;
        }
        Long taken = jdbc.queryForObject("SELECT count(*) FROM users WHERE email = ?", Long.class, csEmail);
        return taken == null || taken == 0;
    }

    private void createJointSignatoryLogin(ReqContact cs, String csEmail, String role, UUID userId) {
        String csPwd = Tokens.generatePassword();
        String csTel;
        if (cs.telephonePortable() != null && !cs.telephonePortable().isBlank()) {
            csTel = cs.telephonePortable().trim();
        } else {
            csTel = cs.telephoneBureau() != null ? cs.telephoneBureau().trim() : null;
        }
        String csNom = cs.nom().trim();
        String csPrenom = cs.prenom() == null ? null : cs.prenom().trim();
        jdbc.update("INSERT INTO users (email, password_hash, role, nom, prenom, telephone, "
                        + "account_holder_id, must_change_password, initial_password_enc) "
                        + "VALUES (?,?,?,?,?,?,?, TRUE, ?)",
                csEmail, password.hash(csPwd), role, csNom, csPrenom, csTel, userId,
                cipher.encrypt(csPwd));
        String csNomComplet = csPrenom != null ? csNom + " " + csPrenom : csNom;
        credentials.sendInitialPassword(csEmail, csTel, csNomComplet, csPwd, true);
    }

    private static String trimToNull(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t;
    }
}