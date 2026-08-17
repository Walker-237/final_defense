// ============================================================================
// Modèles de données — conformes au CSFT AFB_DFT_PXXX_DGSTP_SPECS_V1.0_2026
// Section 6 — Modèle de données (entités principales)
// ============================================================================

// ──────────── Enums imposés par le CSFT ────────────

/** Spec §6.2 — statuts d'ordre conformes au CSFT (M2-S01). */
export type OrderStatus =
  | 'SOUMIS'
  | 'EN_VERIFICATION'
  | 'EN_ATTENTE_ADJUDICATION'
  | 'TOTALEMENT_RETENU'
  | 'PARTIELLEMENT_RETENU'
  | 'NON_RETENU'
  | 'ANNULE'
  | 'EN_ATTENTE_SIGNATURES';

/** Spec §6.1 — statuts d'émission conformes au CSFT (M1-F01..M1-F04). */
export type EmissionStatus = 'BROUILLON' | 'PUBLIE' | 'CLOTURE' | 'ARCHIVE';

export type TitleType = 'BTA' | 'OTA';

/** Spec §1.3 — acteurs du système : client investisseur (PP/PM), agent
 *  trésorerie, superviseur, administrateur. */
export type UserRole =
  | 'CLIENT_PP'
  | 'CLIENT_PM'
  | 'AGENT'
  | 'SUPERVISEUR'
  | 'ADMIN';

/** Spec §M6-S03 — permissions granulaires (RBAC). Une permission représente une capacité métier
 *  unitaire, indépendamment du rôle. Les rôles sont des assemblages par défaut de permissions ;
 *  les superviseurs/admins peuvent ajuster la matrice. */
export type Permission =
  | 'EMISSION_CREATE'
  | 'EMISSION_VALIDATE'
  | 'EMISSION_DELETE'
  | 'ORDER_VALIDATE'
  | 'ORDER_RESULT'
  | 'ORDER_RESULT_VALIDATE'
  | 'CLIENT_CREATE'
  | 'CLIENT_MANAGE'
  | 'USER_MANAGE'
  | 'AUDIT_READ'
  | 'REPORTING_READ'
  | 'CONFIG_MARCHE'
  | 'ACCOUNT_BALANCE_READ';

export const PERMISSION_LABELS: Record<Permission, string> = {
  EMISSION_CREATE: 'Créer une fiche émission',
  EMISSION_VALIDATE: 'Valider / rejeter une fiche émission',
  EMISSION_DELETE: 'Supprimer une fiche émission',
  ORDER_VALIDATE: 'Valider / transmettre un ordre',
  ORDER_RESULT: "Saisir le résultat d'adjudication",
  ORDER_RESULT_VALIDATE: "Valider le résultat d'adjudication",
  CLIENT_CREATE: 'Créer un compte client (PP/PM)',
  CLIENT_MANAGE: 'Modifier / suspendre un compte client',
  USER_MANAGE: 'Gérer les utilisateurs internes',
  AUDIT_READ: "Consulter le journal d'audit",
  REPORTING_READ: 'Consulter les rapports & KPIs',
  CONFIG_MARCHE: "Configurer l'affichage du marché primaire",
  ACCOUNT_BALANCE_READ: 'Consulter le solde d\'un compte',
};

export const ALL_PERMISSIONS: Permission[] = Object.keys(PERMISSION_LABELS) as Permission[];

/** Matrice par défaut rôle → permissions (modifiable via UI superviseur).
 *  CSFT §1.3 + §M6-S03 — principe du moindre privilège. */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  CLIENT_PP: [],
  CLIENT_PM: [],
  // AGENT — opérations courantes : saisit l'adjudication (ORDER_RESULT) mais ne
  // la valide pas ; pas de gestion des utilisateurs internes ni d'audit.
  AGENT: ['EMISSION_CREATE', 'ORDER_VALIDATE', 'ORDER_RESULT', 'CLIENT_CREATE', 'CLIENT_MANAGE', 'ACCOUNT_BALANCE_READ'],
  // SUPERVISEUR — validation : publie les émissions et valide l'adjudication.
  SUPERVISEUR: ['EMISSION_CREATE', 'EMISSION_VALIDATE', 'ORDER_VALIDATE', 'ORDER_RESULT_VALIDATE', 'CLIENT_CREATE', 'CLIENT_MANAGE', 'REPORTING_READ', 'CONFIG_MARCHE', 'ACCOUNT_BALANCE_READ'],
  // ADMIN — profils internes, audit, configuration ; AUCUNE adjudication.
  ADMIN: ['EMISSION_VALIDATE', 'EMISSION_DELETE', 'CLIENT_CREATE', 'CLIENT_MANAGE', 'USER_MANAGE', 'AUDIT_READ', 'REPORTING_READ', 'CONFIG_MARCHE', 'ACCOUNT_BALANCE_READ'],
};

export type TypeCompte = 'INDIVIDUEL' | 'JOINT' | 'INDIVIS' | 'DEMEMBRE' | 'MINEUR' | 'PROTEGE';
export type CategorieInvestisseur = 'QUALIFIE' | 'NON_QUALIFIE';

/**
 * Catégorie « client » (segment métier) — distincte de la catégorie investisseur
 * (QUALIFIE/NON_QUALIFIE). Liste FIGÉE des 12 valeurs présentes dans la BASE
 * CLIENTS de la banque. Toute évolution passe par une migration back + cette liste.
 */
export type CategorieClient =
  | 'Personnes physiques'
  | 'Personne morale'
  | 'Entreprises non financières'
  | 'Etablissements de microfinance'
  | 'Etablissements financiers'
  | 'Société de Gestion'
  | 'Société de Bourse'
  | 'Investisseurs institutionnels'
  | 'Assurance'
  | 'Administrations privées'
  | 'Administrations publiques'
  | 'Compte propre';

/** Ordre d'affichage dans les menus déroulants (par fréquence décroissante en base). */
export const CATEGORIES_CLIENT: CategorieClient[] = [
  'Personnes physiques',
  'Personne morale',
  'Entreprises non financières',
  'Etablissements de microfinance',
  'Etablissements financiers',
  'Société de Gestion',
  'Société de Bourse',
  'Investisseurs institutionnels',
  'Assurance',
  'Administrations privées',
  'Administrations publiques',
  'Compte propre',
];

/** Spec §3.1.3 — codes ISO 3 lettres des 6 États CEMAC. */
export type PaysCEMAC = 'CMR' | 'GAB' | 'CGO' | 'TCD' | 'RCA' | 'GNQ';
export const PAYS_CEMAC: Record<PaysCEMAC, string> = {
  CMR: 'Cameroun',
  GAB: 'Gabon',
  CGO: 'Congo',
  TCD: 'Tchad',
  RCA: 'République Centrafricaine',
  GNQ: 'Guinée Équatoriale',
};

/** Spec §3.1.3 — fréquence de coupon (obligatoire si OTA). */
export type FrequenceCoupon = 'ANNUEL' | 'SEMESTRIEL' | 'TRIMESTRIEL';

/** Spec §3.1.3 — mode d'adjudication. */
export type ModeAdjudication = 'PRIX' | 'TAUX';

/** Spec §3.2.5 — canal de notification. */
export type CanalNotification = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'IN_APP';

// ──────────── Adresses ────────────
export interface Adresse {
  type: 'FISCALE' | 'POSTALE' | 'DOMICILE' | 'SIEGE';
  residence?: string;
  rue: string;
  codePostal?: string;
  ville: string;
  pays: string;
  geoLocalisation?: string;
}

// ──────────── Contacts ────────────
export interface Contact {
  id: string;
  type: 'TITULAIRE' | 'MANDATAIRE' | 'REPRESENTANT_LEGAL' | 'CONTACT_ORDRE' | 'URGENCE';
  nom: string;
  prenom?: string;
  civilite?: string;
  fonction?: string;
  telephonePortable?: string;
  telephoneDomicile?: string;
  telephoneBureau?: string;
  email?: string;
  whatsapp?: string;
  pieceIdentite?: string;
  numeroPiece?: string;
  dateValiditePiece?: string;
  lienParente?: string;
}

// ──────────── Sous-comptes titres ────────────
export interface SousCompteTitres {
  id: string;
  numero: string;
  libelle: string;
  type: 'CONSERVATION' | 'NANTISSEMENT' | 'GAGE' | 'SEQUESTRE' | 'TRANSIT';
  statut: 'ACTIF' | 'BLOQUE' | 'CLOTURE';
  dateOuverture: string;
  dateCloture?: string;
  positionsCount: number;
  valeurTotale: number;
  observations?: string;
}

// ──────────── Compte-titres complet ────────────
export interface CompteTitres {
  id: string;
  numero: string;
  typeCompte: TypeCompte;
  statut: 'ACTIF' | 'BLOQUE' | 'SUSPENDU' | 'CLOTURE';
  dateOuverture: string;
  dateCloture?: string;
  categorie: CategorieInvestisseur;
  compteEspecesLie: string;
  soldeEspeces: number;
  adresses: Adresse[];
  contacts: Contact[];
  sousComptes: SousCompteTitres[];
  coTitulaires?: CoTitulaire[];
  representantsLegaux?: RepresentantLegal[];
  specimenSignature?: string;
  specimenSignatureVerified?: boolean;
  restrictions?: {
    mineur?: { type: 'ADMINISTRATION_LEGALE' | 'TUTELLE' };
    majeurProtege?: { type: 'SAUVEGARDE' | 'HABILITATION_FAMILIALE' | 'CURATELLE' | 'TUTELLE' };
  };
}

/** Dossier client complet tel que renvoyé par le backend (`/clients/dossiers`,
 *  `/clients/me`, `/clients/:id`) — profil + compte-titres détaillé. */
export interface ClientDossier {
  id: string;
  type: 'PP' | 'PM';
  raisonSociale: string;
  rccm?: string;
  /** Catégorie métier (segment) issue de la base clients — distincte de compte.categorie. */
  categorieClient?: CategorieClient;
  /** Attributs alignés sur la base clients de la banque. */
  matricule?: string;
  dirigeant?: string;
  assujettiTaxes?: boolean;
  localisation?: string;
  telephone2?: string;
  createdBy?: string;
  createdByNom?: string;
  createdAt: string;
  compte: CompteTitres;
}

export interface CoTitulaire {
  contact: Contact;
  qualite: 'TITULAIRE_A' | 'TITULAIRE_B' | 'TITULAIRE_C' | 'TITULAIRE_D';
  role?: 'NUE_PROPRIETE' | 'USUFRUIT';
}

export interface RepresentantLegal {
  contact: Contact;
  fonction: string;
  nationalite: string;
  dateNaissance: string;
}

// ──────────── User (CSFT §1.3) ────────────
export interface User {
  id: string;
  nom: string;
  prenom?: string;
  email: string;
  role: UserRole;
  compteTitres?: string;
  compteEspeces?: string;
  solde?: number;
  categorie?: CategorieInvestisseur;
  typeCompte?: TypeCompte;
  compte?: CompteTitres;
  /** Téléphone (clients) — sert à l'affichage et au canal SMS. */
  telephone?: string;
  /** Vrai tant que l'utilisateur n'a pas changé son mot de passe initial. */
  mustChangePassword?: boolean;
  /**
   * Vrai si l'utilisateur participe à un compte-titres à plusieurs signataires :
   * titulaire d'un compte JOINT/INDIVIS, **ou** co-signataire rattaché à un tel
   * compte. Un co-signataire ne porte pas de `typeCompte` : c'est pourquoi ce
   * drapeau est calculé côté serveur et ne se déduit pas de `typeCompte`.
   */
  compteJoint?: boolean;
}

/** Résultat d'adjudication proposé par l'agent, en attente de validation superviseur. */
export interface OrderAdjudicationPending {
  resultatPropose?: OrderStatus;
  resultatProposeAt?: string;
  resultatValideAt?: string;
}

// ──────────── Entité EMISSION (CSFT §6.1) ────────────
export interface Emission {
  /** id_emission — clé primaire UUID. */
  id: string;
  /** Code interne de référence (ex: BTA-CMR-26-03). */
  code: string;
  /** isin — 12 caractères alphanumériques, unique (M1 §3.1.3). */
  isin: string;
  /** Libellé du titre (max 150 char). */
  libelle: string;
  /** nature : BTA | OTA. */
  nature: TitleType;
  /** Pays émetteur — code ISO 3 lettres (CMR, GAB, CGO, TCD, RCA, GNQ). */
  paysCode: PaysCEMAC;
  /** Libellé du pays émetteur — pour affichage (dérivé de paysCode). */
  emetteur: string;
  /** Date d'émission (JJ/MM/AAAA — ISO en stockage). */
  dateEmission: string;
  /** Date de clôture de souscription (>= date_emission). */
  fermetureSouscription: string;
  /** Date d'échéance / maturité (> date_emission). */
  dateEcheance: string;
  /** Durée en jours (calculée, conservée pour affichage). */
  dureeJours: number;
  /** Valeur nominale unitaire (FCFA). */
  valeurNominaleUnitaire: number;
  /** Montant total de l'émission (FCFA). */
  montantGlobal: number;
  /** Taux facial ou prix d'émission. */
  tauxNominal: number;
  /** Montant minimum de souscription (>= valeur_nominale_unitaire). */
  montantMinimum: number;
  /** Fréquence de coupon — obligatoire si OTA. */
  frequenceCoupon?: FrequenceCoupon;
  /** Mode d'adjudication : Prix | Taux. */
  modeAdjudication: ModeAdjudication;
  /** Description / conditions particulières (max 2000 char). */
  description?: string;
  /** Documents joints (prospectus PDF). */
  documents?: string[];
  /** Statut de la fiche émission. */
  status: EmissionStatus;
  /** Ouverture de la fenêtre de souscription. */
  ouvertureSouscription: string;
  /** Date de règlement. */
  dateReglement: string;
  /** Observation tableau marché primaire (NOUVELLE EMISSION, ABONDEMENT). */
  observation?: string;
  /** Agent créateur (created_by). */
  createdBy?: string;
  /** Nom lisible de l'agent créateur (« Nom Prénom »), résolu côté backend. */
  createdByNom?: string;
  /** Superviseur validateur (validated_by — obligatoire si statut = PUBLIE). */
  validatedBy?: string;
  /** Nom lisible du superviseur validateur (« Nom Prénom »), résolu côté backend. */
  validatedByNom?: string;
  /** Horodatage de validation. */
  dateValidation?: string;
  /** Horodatage de création — généré automatiquement. */
  createdAt?: string;
  /** CSFT §M1-F02 — Motif de rejet par le superviseur (visible par l'agent à la prochaine édition). */
  rejectionMotif?: string;
  /** Horodatage du rejet superviseur. */
  rejectedAt?: string;
  /** Identifiant du superviseur ayant rejeté. */
  rejectedBy?: string;
  /** CSFT §M1-F04 — Vrai quand la fiche a été clôturée/archivée automatiquement (lecture seule). */
  autoArchived?: boolean;
}

/** Snapshot exact du formulaire rempli par le client — utilisé pour reproduire l'ordre en PDF. */
export interface ClientOrderForm {
  date: string;
  client: string;
  intitule: string;
  telephone: string;
  contactNom: string;
  contactTel: string;
  contactMail: string;
  compte: string;
  /** Comptes espèces additionnels saisis par le client (référencés, non débités). */
  comptesAdditionnels?: string[];
  lignes: { volume: number; taux: number; montant: number; montantLettres: string }[];
  totalMontant: number;
  totalLettres: string;
  signatureData?: string;
}

// ──────────── Entité ORDRE_SOUSCRIPTION (CSFT §6.2) ────────────
export interface Order {
  /** id_ordre — UUID. */
  id: string;
  /** Numéro d'ordre format ORD-[YYYY]-[NNNNNN] (M2-O03). */
  reference: string;
  emissionId: string;
  emissionCode: string;
  /** ISIN copié au moment de la souscription. */
  isin: string;
  nature: TitleType;
  emetteur: string;
  clientId: string;
  clientNom: string;
  /** Formule d'adresse portée sur les documents générés (défaut PP=Monsieur, PM=Directeur). */
  dirigeant?: string;
  /** Type du client (PP/PM) — sert de repli pour la formule d'adresse. */
  typePersonne?: 'PP' | 'PM';
  /** Numéro de compte espèces à débiter. */
  compteEspeces: string;
  /** Numéro de compte titres à créditer (M2-O05). */
  compteTitres: string;
  /** Nombre de titres demandés (entier > 0). */
  volume: number;
  /** Montant total offert = nb_titres × valeur_nominale. */
  montant: number;
  /** Taux ou prix proposé. */
  tauxSoumis: number;
  /** Statut de l'ordre (CSFT §6.2). */
  status: OrderStatus;
  /** Horodatage soumission — immuable. */
  dateSoumission: string;
  /** Horodatage dernière mise à jour — mis à jour à chaque changement de statut. */
  updatedAt?: string;
  /** Montant adjugé (post-adjudication, >= 0). */
  montantAdjuge?: number;
  /** Taux adjugé. */
  tauxAdjuge?: number;
  /** Volume alloué (calculé à partir du montant adjugé). */
  volumeAlloue?: number;
  /** Montant effectivement débité du compte espèces (net). */
  montantDebite?: number;
  /** Commentaire/motif obligatoire de l'agent pour PARTIELLEMENT_RETENU ou NON_RETENU. */
  commentaireResultat?: string;
  /** Motif obligatoire de l'agent lors d'un rejet d'ordre (ANNULE) — visible côté client. */
  motifAnnulation?: string;
  /** Résultat d'adjudication proposé par l'agent, en attente de validation superviseur. */
  resultatPropose?: OrderStatus;
  /** Horodatage de la proposition de résultat. */
  resultatProposeAt?: string;
  /** Horodatage de la validation du résultat par le superviseur. */
  resultatValideAt?: string;
  /** Identifiant de l'agent ayant validé l'ordre (passage à EN_ATTENTE_ADJUDICATION). */
  validatedByAgent?: string;
  /** Nom lisible de l'agent validateur (« Nom Prénom »), résolu côté backend. */
  validatedByAgentNom?: string;
  /** Horodatage de validation par l'agent. */
  dateValidationAgent?: string;
  /** Identifiant de l'agent ayant rejeté l'ordre. */
  rejectedByAgent?: string;
  /** Horodatage du rejet par l'agent. */
  dateRejetAgent?: string;
  /** Canal de soumission. */
  canal: 'EN_LIGNE' | 'GUICHET' | 'EMAIL';
  notes?: string;
  /** Hash SHA-256 de l'OTP de signature électronique (M2-O02). */
  otpCodeHash?: string;
  /** Données de signature (image base64). */
  signatureData?: string;
  /** Vérification de la signature par le BO. */
  signatureVerified?: boolean;
  signatureDate?: string;
  /** IP utilisateur à la soumission (audit §6.2). */
  ipSoumission?: string;
  /** Verrou : passe à true quand l'agent télécharge/imprime → ordre non modifiable côté client. */
  printedBySvt?: boolean;
  printedAt?: string;
  printedBy?: string;
  /** Snapshot exact du formulaire pour reproduction PDF fidèle. */
  formSnapshot?: ClientOrderForm;
}

export interface Position {
  emissionCode: string;
  isin: string;
  nature: TitleType;
  emetteur: string;
  dateEmission: string;
  dateEcheance: string;
  volume: number;
  valeurNominale: number;
  valeurTotale: number;
  tauxNominal: number;
  sousCompteId?: string;
  prochainFlux?: { date: string; montant: number; type: string };
}

/** Spec §M4-F01 — 5 types de documents gérés. */
export type DocumentType =
  | 'AVIS_OPERATION'
  | 'AVIS_OFFRE_NON_ADJUGEE'
  | 'SITUATION_TITRES'
  | 'TABLEAU_AMORTISSEMENT'
  | 'ATTESTATION_PROPRIETE';

export interface Document {
  id: string;
  /** Format imposé M4-F03 : [TYPE]-[ISIN]-[DATE]-[CLIENT_ID]-[SEQ]. */
  reference: string;
  type: DocumentType;
  isin?: string;
  emissionCode?: string;
  clientId?: string;
  dateGeneration: string;
  taille: string;
  /** Signature électronique apposée (M4-F02). */
  signed?: boolean;
  /** Journal téléchargements (M2-P04) — date/heure/IP. */
  telechargements?: Array<{ date: string; ip: string; userAgent?: string }>;
}

export interface Notification {
  id: string;
  type: 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR';
  titre: string;
  message: string;
  date: string;
  lu: boolean;
  canal: CanalNotification[];
}

export interface AuditEntry {
  id: string;
  horodatage: string;
  /** Identifiant brut de l'acteur (UUID le plus souvent). */
  utilisateur: string;
  /** Nom lisible de l'acteur (« Nom Prénom »), résolu côté backend. */
  utilisateurNom?: string;
  /** Rôle de l'acteur (CLIENT_PP, AGENT, SUPERVISEUR…). */
  utilisateurRole?: string;
  action: string;
  resultat: 'SUCCES' | 'ECHEC';
  reference: string;
  ip: string;
}

// ──────────── Helpers de présentation ────────────

/** Libellés UI conformes au CSFT §M2-S01. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  SOUMIS: 'Soumis',
  EN_VERIFICATION: 'En vérification',
  EN_ATTENTE_ADJUDICATION: "En attente d'adjudication",
  TOTALEMENT_RETENU: 'Totalement retenu',
  PARTIELLEMENT_RETENU: 'Partiellement retenu',
  NON_RETENU: 'Non retenu',
  ANNULE: 'Annulé',
  EN_ATTENTE_SIGNATURES: 'En attente de signatures',
};

/** Libellés UI des statuts d'émission (§M1). */
export const EMISSION_STATUS_LABELS: Record<EmissionStatus, string> = {
  BROUILLON: 'Brouillon',
  PUBLIE: 'Publié',
  CLOTURE: 'Clôturé',
  ARCHIVE: 'Archivé',
};

/** Libellés UI des types de documents (§M4-F01). */
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  AVIS_OPERATION: "Avis d'opération",
  AVIS_OFFRE_NON_ADJUGEE: "Avis d'offre non adjugée",
  SITUATION_TITRES: 'Situation de titres',
  TABLEAU_AMORTISSEMENT: "Tableau d'amortissement",
  ATTESTATION_PROPRIETE: 'Attestation de propriété',
};

/** Préfixes pour la génération de référence (M4-F03). */
export const DOCUMENT_TYPE_PREFIX: Record<DocumentType, string> = {
  AVIS_OPERATION: 'AOP',
  AVIS_OFFRE_NON_ADJUGEE: 'AON',
  SITUATION_TITRES: 'SDT',
  TABLEAU_AMORTISSEMENT: 'TDA',
  ATTESTATION_PROPRIETE: 'ATP',
};
