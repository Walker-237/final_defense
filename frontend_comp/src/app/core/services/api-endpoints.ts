/**
 * AFRILAND FIRST BANK — Plateforme Valeurs du Trésor CEMAC
 * Liste exhaustive des endpoints API REST à intégrer au backend
 *
 * Convention :
 *  - Base URL : /api/v1
 *  - Auth : Bearer token JWT (header Authorization)
 *  - Format : JSON (application/json)
 *  - Dates : ISO 8601 (YYYY-MM-DD / YYYY-MM-DDTHH:mm:ss)
 *  - Montants : entiers en FCFA (pas de centimes)
 *  - Pagination : ?page=1&size=20&sort=date,desc
 *  - Filtres : query params (?status=SOUMIS&emissionId=xxx)
 */

export const API_BASE = '/api/v1';

// ──────────────────────────────────────────────────────────
// MODULE 1 — AUTHENTIFICATION & COMPTES UTILISATEURS
// ──────────────────────────────────────────────────────────

export const AUTH = {
  /** POST /auth/login — Connexion (email + mot de passe) → JWT token + refresh token */
  LOGIN: `${API_BASE}/auth/login`,
  /** POST /auth/mfa/verify — Vérification OTP (code 6 chiffres) */
  MFA_VERIFY: `${API_BASE}/auth/mfa/verify`,
  /** POST /auth/mfa/resend — Renvoyer le code OTP */
  MFA_RESEND: `${API_BASE}/auth/mfa/resend`,
  /** POST /auth/register/pp — Inscription personne physique (formulaire Annexe 1) */
  REGISTER_PP: `${API_BASE}/auth/register/pp`,
  /** POST /auth/register/pm — Inscription personne morale */
  REGISTER_PM: `${API_BASE}/auth/register/pm`,
  /** POST /auth/forgot-password — Envoi lien de réinitialisation (TTL 1h) */
  FORGOT: `${API_BASE}/auth/forgot-password`,
  /** POST /auth/reset-password — Réinitialisation avec token */
  RESET: `${API_BASE}/auth/reset-password`,
  /** POST /auth/refresh — Renouveler le JWT via refresh token */
  REFRESH: `${API_BASE}/auth/refresh`,
  /** POST /auth/logout — Invalidation du token côté serveur */
  LOGOUT: `${API_BASE}/auth/logout`,
  /** GET /auth/me — Profil de l'utilisateur connecté */
  ME: `${API_BASE}/auth/me`,
};

// ──────────────────────────────────────────────────────────
// MODULE 2 — COMPTES-TITRES (Ouverture, gestion, clôture)
// ──────────────────────────────────────────────────────────

export const COMPTES_TITRES = {
  /** POST /comptes-titres — Ouverture d'un compte-titres (Annexe 1 formulaire) */
  CREATE: `${API_BASE}/comptes-titres`,
  /** GET /comptes-titres/:id — Détail du compte-titres */
  GET: (id: string) => `${API_BASE}/comptes-titres/${id}`,
  /** PATCH /comptes-titres/:id — Mise à jour (adresse, coordonnées, catégorie) */
  UPDATE: (id: string) => `${API_BASE}/comptes-titres/${id}`,
  /** POST /comptes-titres/:id/close — Clôture du compte-titres */
  CLOSE: (id: string) => `${API_BASE}/comptes-titres/${id}/close`,
  /** POST /comptes-titres/:id/transfer — Transfert vers un autre teneur de compte */
  TRANSFER: (id: string) => `${API_BASE}/comptes-titres/${id}/transfer`,
  /** POST /comptes-titres/:id/mandataires — Ajouter un mandataire */
  ADD_MANDATAIRE: (id: string) => `${API_BASE}/comptes-titres/${id}/mandataires`,
  /** DELETE /comptes-titres/:id/mandataires/:mid — Révoquer un mandataire */
  REVOKE_MANDATAIRE: (id: string, mid: string) => `${API_BASE}/comptes-titres/${id}/mandataires/${mid}`,
  /** PATCH /comptes-titres/:id/categorie — Changement qualifié ↔ non qualifié */
  CHANGE_CATEGORIE: (id: string) => `${API_BASE}/comptes-titres/${id}/categorie`,
  /** POST /comptes-titres/:id/specimen-signature — Upload du spécimen de signature */
  UPLOAD_SPECIMEN: (id: string) => `${API_BASE}/comptes-titres/${id}/specimen-signature`,

  // ── Sous-comptes titres ──
  /** GET /comptes-titres/:id/sous-comptes — Liste des sous-comptes (Conservation, Nantissement, Gage, Séquestre, Transit) */
  LIST_SOUS_COMPTES: (id: string) => `${API_BASE}/comptes-titres/${id}/sous-comptes`,
  /** POST /comptes-titres/:id/sous-comptes — Créer un sous-compte titres */
  CREATE_SOUS_COMPTE: (id: string) => `${API_BASE}/comptes-titres/${id}/sous-comptes`,
  /** PATCH /comptes-titres/:id/sous-comptes/:scId — Modifier un sous-compte */
  UPDATE_SOUS_COMPTE: (id: string, scId: string) => `${API_BASE}/comptes-titres/${id}/sous-comptes/${scId}`,
  /** POST /comptes-titres/:id/sous-comptes/:scId/block — Bloquer un sous-compte */
  BLOCK_SOUS_COMPTE: (id: string, scId: string) => `${API_BASE}/comptes-titres/${id}/sous-comptes/${scId}/block`,
  /** POST /comptes-titres/:id/sous-comptes/:scId/close — Clôturer un sous-compte */
  CLOSE_SOUS_COMPTE: (id: string, scId: string) => `${API_BASE}/comptes-titres/${id}/sous-comptes/${scId}/close`,

  // ── Adresses ──
  /** GET /comptes-titres/:id/adresses — Liste des adresses (fiscale, postale, domicile, siège) */
  LIST_ADRESSES: (id: string) => `${API_BASE}/comptes-titres/${id}/adresses`,
  /** POST /comptes-titres/:id/adresses — Ajouter une adresse */
  ADD_ADRESSE: (id: string) => `${API_BASE}/comptes-titres/${id}/adresses`,
  /** PATCH /comptes-titres/:id/adresses/:type — Modifier une adresse par type */
  UPDATE_ADRESSE: (id: string, type: string) => `${API_BASE}/comptes-titres/${id}/adresses/${type}`,
  /** DELETE /comptes-titres/:id/adresses/:type — Supprimer une adresse (sauf fiscale obligatoire) */
  DELETE_ADRESSE: (id: string, type: string) => `${API_BASE}/comptes-titres/${id}/adresses/${type}`,

  // ── Contacts ──
  /** GET /comptes-titres/:id/contacts — Liste des contacts (titulaire, mandataire, représentant légal, contact ordre, urgence) */
  LIST_CONTACTS: (id: string) => `${API_BASE}/comptes-titres/${id}/contacts`,
  /** POST /comptes-titres/:id/contacts — Ajouter un contact */
  ADD_CONTACT: (id: string) => `${API_BASE}/comptes-titres/${id}/contacts`,
  /** PATCH /comptes-titres/:id/contacts/:cId — Modifier un contact */
  UPDATE_CONTACT: (id: string, cId: string) => `${API_BASE}/comptes-titres/${id}/contacts/${cId}`,
  /** DELETE /comptes-titres/:id/contacts/:cId — Retirer un contact */
  DELETE_CONTACT: (id: string, cId: string) => `${API_BASE}/comptes-titres/${id}/contacts/${cId}`,

  // ── Co-titulaires ──
  /** GET /comptes-titres/:id/co-titulaires — Liste des co-titulaires (joint, indivis, démembré) */
  LIST_CO_TITULAIRES: (id: string) => `${API_BASE}/comptes-titres/${id}/co-titulaires`,
  /** POST /comptes-titres/:id/co-titulaires — Ajouter un co-titulaire */
  ADD_CO_TITULAIRE: (id: string) => `${API_BASE}/comptes-titres/${id}/co-titulaires`,
  /** DELETE /comptes-titres/:id/co-titulaires/:ctId — Retirer un co-titulaire (désolidarisation) */
  REMOVE_CO_TITULAIRE: (id: string, ctId: string) => `${API_BASE}/comptes-titres/${id}/co-titulaires/${ctId}`,
};

// ──────────────────────────────────────────────────────────
// MODULE 3 — ÉMISSIONS DE TITRES PUBLICS
// ──────────────────────────────────────────────────────────

export const EMISSIONS = {
  /** GET /emissions — Liste des émissions (filtres: status, nature, emetteur, date) */
  LIST: `${API_BASE}/emissions`,
  /** GET /emissions/:id — Détail d'une émission */
  GET: (id: string) => `${API_BASE}/emissions/${id}`,
  /** POST /emissions — Créer une nouvelle émission (admin/superviseur) */
  CREATE: `${API_BASE}/emissions`,
  /** PATCH /emissions/:id — Modifier une émission (brouillon ou publiée) */
  UPDATE: (id: string) => `${API_BASE}/emissions/${id}`,
  /** DELETE /emissions/:id — Supprimer une émission */
  DELETE: (id: string) => `${API_BASE}/emissions/${id}`,
  /** POST /emissions/:id/publish — Publier (BROUILLON → OUVERTE) + notifications clients */
  PUBLISH: (id: string) => `${API_BASE}/emissions/${id}/publish`,
  /** POST /emissions/:id/close — Fermer la fenêtre de souscription */
  CLOSE: (id: string) => `${API_BASE}/emissions/${id}/close`,
  /** POST /emissions/import — Import en masse depuis Excel/CSV (format BEAC) */
  IMPORT: `${API_BASE}/emissions/import`,
  /** GET /emissions/export — Export CSV de toutes les émissions */
  EXPORT: `${API_BASE}/emissions/export`,
  /** POST /emissions/:id/documents — Upload document associé (prospectus PDF) */
  UPLOAD_DOC: (id: string) => `${API_BASE}/emissions/${id}/documents`,
};

// ──────────────────────────────────────────────────────────
// MODULE 4 — ORDRES DE SOUSCRIPTION
// ──────────────────────────────────────────────────────────

export const ORDERS = {
  /** GET /orders — Liste des ordres (filtres: status, emission, client, canal, date) */
  LIST: `${API_BASE}/orders`,
  /** GET /orders/:id — Détail d'un ordre avec historique audit */
  GET: (id: string) => `${API_BASE}/orders/${id}`,
  /** GET /orders/:id/history — Historique des événements de l'ordre */
  HISTORY: (id: string) => `${API_BASE}/orders/${id}/history`,
  /** POST /orders — Soumission d'un nouvel ordre (client) */
  CREATE: `${API_BASE}/orders`,
  /** POST /orders/:id/cancel — Annuler un ordre (statut SOUMIS/VALIDE) + libérer provision */
  CANCEL: (id: string) => `${API_BASE}/orders/${id}/cancel`,
  /** POST /orders/:id/validate — Valider un ordre (BO, double signature) */
  VALIDATE: (id: string) => `${API_BASE}/orders/${id}/validate`,
  /** POST /orders/:id/transmit — Transmettre à la BEAC */
  TRANSMIT: (id: string) => `${API_BASE}/orders/${id}/transmit`,
  /** POST /orders/:id/reject — Rejeter un ordre avec motif */
  REJECT: (id: string) => `${API_BASE}/orders/${id}/reject`,
  /** POST /orders/:id/change-status — Changement libre de statut (superviseur) */
  CHANGE_STATUS: (id: string) => `${API_BASE}/orders/${id}/change-status`,
  /** POST /orders/propose — Proposer un ordre à un client (agent guichet) */
  PROPOSE: `${API_BASE}/orders/propose`,
  /** POST /orders/:id/accept — Client accepte la proposition */
  ACCEPT: (id: string) => `${API_BASE}/orders/${id}/accept`,
  /** POST /orders/:id/decline — Client refuse la proposition */
  DECLINE: (id: string) => `${API_BASE}/orders/${id}/decline`,
  /** POST /orders/:id/resend — Relancer le client (rappel notification) */
  RESEND: (id: string) => `${API_BASE}/orders/${id}/resend`,
  /** PATCH /orders/:id/notes — Ajouter / modifier notes sur un ordre */
  NOTES: (id: string) => `${API_BASE}/orders/${id}/notes`,
  /** POST /orders/:id/modify-proposal — Modifier une proposition (volume, taux, notes) */
  MODIFY_PROPOSAL: (id: string) => `${API_BASE}/orders/${id}/modify-proposal`,
  /** GET /orders/:id/print — Générer le bon d'ordre imprimable (HTML ou PDF) */
  PRINT: (id: string) => `${API_BASE}/orders/${id}/print`,
  /** GET /orders/export — Export CSV des ordres filtrés */
  EXPORT: `${API_BASE}/orders/export`,
  /** POST /orders/batch/validate — Validation en masse (double signature) */
  BATCH_VALIDATE: `${API_BASE}/orders/batch/validate`,
  /** POST /orders/batch/transmit — Transmission BEAC en masse (double signature) */
  BATCH_TRANSMIT: `${API_BASE}/orders/batch/transmit`,
  /** POST /orders/batch/reject — Rejet en masse avec motif commun */
  BATCH_REJECT: `${API_BASE}/orders/batch/reject`,
};

// ──────────────────────────────────────────────────────────
// MODULE 5 — ADJUDICATION (Résultats BEAC)
// ──────────────────────────────────────────────────────────

export const ADJUDICATION = {
  /** POST /adjudication/:emissionId/import — Import du fichier résultats BEAC (Excel/CSV/XML) */
  IMPORT: (emissionId: string) => `${API_BASE}/adjudication/${emissionId}/import`,
  /** GET /adjudication/:emissionId/preview — Preview des allocations avant exécution */
  PREVIEW: (emissionId: string) => `${API_BASE}/adjudication/${emissionId}/preview`,
  /** POST /adjudication/:emissionId/execute — Exécuter le règlement (double signature, irréversible) */
  EXECUTE: (emissionId: string) => `${API_BASE}/adjudication/${emissionId}/execute`,
  /** GET /adjudication/:emissionId/report — Rapport de synthèse (PDF/CSV) */
  REPORT: (emissionId: string) => `${API_BASE}/adjudication/${emissionId}/report`,
};

// ──────────────────────────────────────────────────────────
// MODULE 6 — LIVRABLES RÉGLEMENTAIRES (Documents)
// ──────────────────────────────────────────────────────────

export const DOCUMENTS = {
  /** GET /documents — Liste des documents (filtres: type, emission, client, date) */
  LIST: `${API_BASE}/documents`,
  /** GET /documents/:id — Détail du document */
  GET: (id: string) => `${API_BASE}/documents/${id}`,
  /** GET /documents/:id/download — Télécharger le PDF signé */
  DOWNLOAD: (id: string) => `${API_BASE}/documents/${id}/download`,
  /** GET /documents/:id/preview — Visualiser le document dans le navigateur */
  PREVIEW: (id: string) => `${API_BASE}/documents/${id}/preview`,
  /** POST /documents/generate — Générer un document à la demande */
  GENERATE: `${API_BASE}/documents/generate`,
  /** POST /documents/batch/releves — Générer les relevés mensuels en masse */
  BATCH_RELEVES: `${API_BASE}/documents/batch/releves`,
};

// ──────────────────────────────────────────────────────────
// MODULE 7 — PORTEFEUILLE & POSITIONS TITRES
// ──────────────────────────────────────────────────────────

export const PORTFOLIO = {
  /** GET /portfolio — Positions titres du client connecté */
  POSITIONS: `${API_BASE}/portfolio`,
  /** GET /portfolio/:clientId — Positions d'un client donné (BO) */
  CLIENT_POSITIONS: (clientId: string) => `${API_BASE}/portfolio/${clientId}`,
  /** GET /portfolio/transactions — Historique des transactions (coupons, remboursements) */
  TRANSACTIONS: `${API_BASE}/portfolio/transactions`,
  /** GET /portfolio/revenues — Récapitulatif des revenus (fiscal) */
  REVENUES: `${API_BASE}/portfolio/revenues`,
  /** GET /portfolio/aggregated — Positions agrégées tous clients (reporting BO) */
  AGGREGATED: `${API_BASE}/portfolio/aggregated`,
};

// ──────────────────────────────────────────────────────────
// MODULE 8 — NOTIFICATIONS & ALERTES MULTICANALES
// ──────────────────────────────────────────────────────────

export const NOTIFICATIONS = {
  /** GET /notifications — Liste des notifications de l'utilisateur connecté */
  LIST: `${API_BASE}/notifications`,
  /** GET /notifications/unread-count — Nombre de non-lues (badge header) */
  UNREAD_COUNT: `${API_BASE}/notifications/unread-count`,
  /** POST /notifications/:id/read — Marquer comme lue */
  MARK_READ: (id: string) => `${API_BASE}/notifications/${id}/read`,
  /** POST /notifications/read-all — Marquer toutes comme lues */
  MARK_ALL_READ: `${API_BASE}/notifications/read-all`,
  /** POST /notifications/send — Envoi manuel de notification (admin) */
  SEND: `${API_BASE}/notifications/send`,
};

// ──────────────────────────────────────────────────────────
// MODULE 9 — INTÉGRATIONS SYSTÈMES EXISTANTS
// ──────────────────────────────────────────────────────────

export const CORE_BANKING = {
  /** GET /integrations/corebanking/account/:numero — Vérifier existence + statut du compte espèce */
  VERIFY_ACCOUNT: (numero: string) => `${API_BASE}/integrations/corebanking/account/${numero}`,
  /** GET /integrations/corebanking/balance/:numero — Consulter le solde disponible temps réel */
  BALANCE: (numero: string) => `${API_BASE}/integrations/corebanking/balance/${numero}`,
  /** POST /integrations/corebanking/reserve — Réserver (bloquer) une provision sur le compte */
  RESERVE: `${API_BASE}/integrations/corebanking/reserve`,
  /** POST /integrations/corebanking/release — Libérer une provision bloquée */
  RELEASE: `${API_BASE}/integrations/corebanking/release`,
  /** POST /integrations/corebanking/debit — Débiter le compte espèce (après adjudication) */
  DEBIT: `${API_BASE}/integrations/corebanking/debit`,
  /** GET /integrations/corebanking/history/:numero — Relevé du compte (provenance des fonds) */
  HISTORY: (numero: string) => `${API_BASE}/integrations/corebanking/history/${numero}`,
};

export const INTRA = {
  /** POST /integrations/intra/inscribe — Inscrire des titres en compte-titres après adjudication */
  INSCRIBE: `${API_BASE}/integrations/intra/inscribe`,
  /** GET /integrations/intra/positions/:compteTitres — Consulter positions depuis INTRA */
  POSITIONS: (compteTitres: string) => `${API_BASE}/integrations/intra/positions/${compteTitres}`,
  /** POST /integrations/intra/transfer — Instruction de transfert de titres */
  TRANSFER: `${API_BASE}/integrations/intra/transfer`,
  /** GET /integrations/intra/sync — Dernier état de synchronisation INTRA */
  SYNC_STATUS: `${API_BASE}/integrations/intra/sync`,
};

export const DEPOX = {
  /** POST /integrations/depox/deposit — Dépôt des titres auprès du dépositaire central BEAC */
  DEPOSIT: `${API_BASE}/integrations/depox/deposit`,
  /** GET /integrations/depox/positions — Consultation des positions au dépositaire central */
  POSITIONS: `${API_BASE}/integrations/depox/positions`,
  /** GET /integrations/depox/reconciliation — Réconciliation quotidienne INTRA vs DEPOX */
  RECONCILIATION: `${API_BASE}/integrations/depox/reconciliation`,
};

export const BEAC = {
  /** POST /integrations/beac/transmit — Transmettre les ordres agrégés pour adjudication */
  TRANSMIT: `${API_BASE}/integrations/beac/transmit`,
  /** GET /integrations/beac/results/:emissionId — Récupérer les résultats d'adjudication */
  RESULTS: (emissionId: string) => `${API_BASE}/integrations/beac/results/${emissionId}`,
  /** GET /integrations/beac/emissions — Récupérer la liste officielle des émissions BEAC */
  EMISSIONS: `${API_BASE}/integrations/beac/emissions`,
};

export const MESSAGING = {
  /** POST /integrations/email/send — Envoi e-mail transactionnel (SMTP) */
  SEND_EMAIL: `${API_BASE}/integrations/email/send`,
  /** POST /integrations/sms/send — Envoi SMS (passerelle MTN/Orange) */
  SEND_SMS: `${API_BASE}/integrations/sms/send`,
  /** POST /integrations/whatsapp/send — Envoi WhatsApp Business API */
  SEND_WHATSAPP: `${API_BASE}/integrations/whatsapp/send`,
};

// ──────────────────────────────────────────────────────────
// MODULE 10 — ADMINISTRATION, SÉCURITÉ, CONFORMITÉ
// ──────────────────────────────────────────────────────────

export const USERS = {
  /** GET /users — Liste des utilisateurs internes (RBAC) */
  LIST: `${API_BASE}/users`,
  /** POST /users — Créer un utilisateur (admin) */
  CREATE: `${API_BASE}/users`,
  /** PATCH /users/:id — Modifier utilisateur (rôle, direction, statut) */
  UPDATE: (id: string) => `${API_BASE}/users/${id}`,
  /** DELETE /users/:id — Supprimer un utilisateur */
  DELETE: (id: string) => `${API_BASE}/users/${id}`,
  /** POST /users/:id/suspend — Suspendre un utilisateur */
  SUSPEND: (id: string) => `${API_BASE}/users/${id}/suspend`,
  /** POST /users/:id/activate — Réactiver un utilisateur suspendu */
  ACTIVATE: (id: string) => `${API_BASE}/users/${id}/activate`,
};

export const CLIENTS = {
  /** GET /clients — Liste des clients investisseurs (PP + PM) */
  LIST: `${API_BASE}/clients`,
  /** GET /clients/:id — Dossier client complet (KYC, positions, ordres, documents) */
  GET: (id: string) => `${API_BASE}/clients/${id}`,
  /** PATCH /clients/:id — Mise à jour données client */
  UPDATE: (id: string) => `${API_BASE}/clients/${id}`,
  /** POST /clients/:id/verify-kyc — Valider la conformité KYC */
  VERIFY_KYC: (id: string) => `${API_BASE}/clients/${id}/verify-kyc`,
  /** POST /clients/:id/lcb-ft — Déclencher vérification LCB-FT */
  LCB_FT: (id: string) => `${API_BASE}/clients/${id}/lcb-ft`,
};

export const AUDIT = {
  /** GET /audit — Journal d'audit immuable (filtres: utilisateur, action, date, référence) */
  LIST: `${API_BASE}/audit`,
  /** GET /audit/export — Export CSV de l'audit log */
  EXPORT: `${API_BASE}/audit/export`,
  /** GET /audit/by-reference/:ref — Historique d'un objet par sa référence */
  BY_REFERENCE: (ref: string) => `${API_BASE}/audit/by-reference/${ref}`,
};

export const RECLAMATIONS = {
  /** GET /reclamations — Liste des réclamations du client */
  LIST: `${API_BASE}/reclamations`,
  /** POST /reclamations — Soumettre une réclamation (Art. 11.2) */
  CREATE: `${API_BASE}/reclamations`,
  /** GET /reclamations/:id — Détail d'une réclamation */
  GET: (id: string) => `${API_BASE}/reclamations/${id}`,
  /** PATCH /reclamations/:id — Mettre à jour statut (BO: En traitement / Résolue) */
  UPDATE: (id: string) => `${API_BASE}/reclamations/${id}`,
};

export const REPORTING = {
  /** GET /reporting/svt — Rapport SVT pour la BEAC (mensuel) */
  SVT: `${API_BASE}/reporting/svt`,
  /** GET /reporting/dashboard — KPIs tableau de bord back-office */
  DASHBOARD: `${API_BASE}/reporting/dashboard`,
  /** GET /reporting/statistics — Statistiques de marché */
  STATISTICS: `${API_BASE}/reporting/statistics`,
};

// ──────────────────────────────────────────────────────────
// UPLOAD / FICHIERS
// ──────────────────────────────────────────────────────────

export const FILES = {
  /** POST /files/upload — Upload générique (pièces d'identité, spécimen signature, justificatifs) */
  UPLOAD: `${API_BASE}/files/upload`,
  /** GET /files/:id — Télécharger un fichier uploadé */
  GET: (id: string) => `${API_BASE}/files/${id}`,
};

// ──────────────────────────────────────────────────────────
// AUTO-INSCRIPTION — ouverture de compte-titres en ligne (Annexe 1)
// ──────────────────────────────────────────────────────────

export const REGISTRATION = {
  /** POST /registration/register — Crée le compte + un dossier BROUILLON, ouvre une session */
  REGISTER: `${API_BASE}/registration/register`,
  /** GET /registration/dossiers/:id — État courant du dossier (reprise du wizard) */
  DOSSIER: (id: string) => `${API_BASE}/registration/dossiers/${id}`,
  /** POST /registration/dossiers/:id/face — Dépose la capture faciale (vivacité re-contrôlée serveur) */
  FACE: (id: string) => `${API_BASE}/registration/dossiers/${id}/face`,
  /** POST /registration/dossiers/:id/piece-identite — CNI / carte de séjour / passeport (+ texte OCR) */
  PIECE_IDENTITE: (id: string) => `${API_BASE}/registration/dossiers/${id}/piece-identite`,
  /** POST /registration/dossiers/:id/submit — Soumet le dossier au back-office (BROUILLON → EN_ATTENTE) */
  SUBMIT: (id: string) => `${API_BASE}/registration/dossiers/${id}/submit`,
  /** GET /registration/convention?langue=FR — Convention courante (HTML + version) */
  CONVENTION: `${API_BASE}/registration/convention`,
};

/** Signatures des dirigeants — apposées sur les documents générés (avis d'opéré…). */
export const SIGNATURES_DIRIGEANTS = {
  /** GET /signatures-dirigeants — Signatures ACTIVES (lues par les documents) */
  ACTIVES: `${API_BASE}/signatures-dirigeants`,
  /** GET /admin/signatures-dirigeants — Toutes (espace d'administration) */
  LIST: `${API_BASE}/admin/signatures-dirigeants`,
  /** POST /admin/signatures-dirigeants — Ajouter une signature */
  CREATE: `${API_BASE}/admin/signatures-dirigeants`,
  /** PATCH /admin/signatures-dirigeants/:id — Modifier */
  UPDATE: (id: string) => `${API_BASE}/admin/signatures-dirigeants/${id}`,
  /** DELETE /admin/signatures-dirigeants/:id — Supprimer */
  DELETE: (id: string) => `${API_BASE}/admin/signatures-dirigeants/${id}`,
};

/** Contrôle facial rattaché à un ordre (déclenché APRÈS soumission, non bloquant). */
export const ORDER_FACE_CHECK = {
  /** POST /orders/:id/face-check — Photo du jour ; le SERVEUR compare à l'ouverture de compte */
  CHECK: (orderId: string) => `${API_BASE}/orders/${orderId}/face-check`,
  /** GET /admin/orders/:id/face-check — Les 2 photos côte à côte + distance (back-office) */
  ADMIN_GET: (orderId: string) => `${API_BASE}/admin/orders/${orderId}/face-check`,
  /** POST /admin/orders/:id/face-check/verify — Revue humaine : valider / rejeter */
  ADMIN_VERIFY: (orderId: string) => `${API_BASE}/admin/orders/${orderId}/face-check/verify`,
};

/** Back-office — vérification des dossiers d'inscription (capture faciale). */
export const ADMIN_REGISTRATIONS = {
  /** GET /admin/registrations?status=… — File des captures à vérifier */
  LIST: `${API_BASE}/admin/registrations`,
  /** GET /admin/registrations/:id/face — Image + repères 468 pts (rejeu marqueurs + 3D) */
  FACE: (id: string) => `${API_BASE}/admin/registrations/${id}/face`,
  /** GET /admin/registrations/by-user/:userId/face — Capture faciale depuis le dossier CLIENT */
  FACE_BY_USER: (userId: string) => `${API_BASE}/admin/registrations/by-user/${userId}/face`,
  /** POST /admin/registrations/:id/face/verify — Valider / rejeter la capture */
  VERIFY: (id: string) => `${API_BASE}/admin/registrations/${id}/face/verify`,
  /** GET /admin/registrations/:id/dossier — Dossier complet (identité, pièces, visage) */
  DOSSIER: (id: string) => `${API_BASE}/admin/registrations/${id}/dossier`,
  /** POST /admin/registrations/:id/approve — Valide le dossier ET ouvre le compte-titres */
  APPROVE: (id: string) => `${API_BASE}/admin/registrations/${id}/approve`,
  /** POST /admin/registrations/:id/reject — Rejette le dossier (motif obligatoire) */
  REJECT: (id: string) => `${API_BASE}/admin/registrations/${id}/reject`,
};

/** Référentiel « BASE CLIENTS » — clients déjà connus de la banque (back-office). */
export const ADMIN_CLIENTS_FB = {
  /** GET /admin/clients-fb?q=… — consultation / recherche */
  LIST: `${API_BASE}/admin/clients-fb`,
  /** POST /admin/clients-fb/import — import du fichier Excel/CSV (idempotent) */
  IMPORT: `${API_BASE}/admin/clients-fb/import`,
  /** GET /admin/clients-fb/all — référentiel complet (identité) pour le modèle d'import portefeuille */
  ALL: `${API_BASE}/admin/clients-fb/all`,
  /** PUT /admin/clients-fb/:id — édition d'une fiche existante (back-office) */
  UPDATE: (id: string) => `${API_BASE}/admin/clients-fb/${id}`,
};
