import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  Adresse, AuditEntry, ClientDossier, Contact, Emission, Notification, Order, Position,
  SousCompteTitres, UserRole,
} from '../models/models';

/** Enveloppe de réponse paginée renvoyée par le backend. */
export interface Page<T> {
  data: T[];
  page: number;
  size: number;
  total: number;
}

/** Compte utilisateur tel que renvoyé / créé par le backend. */
export interface UserAccount {
  id: string;
  nom: string;
  prenom?: string;
  email: string;
  role: UserRole;
  statut: string;
  compteTitres?: string;
  compteEspeces?: string;
}

/** Portefeuille d'un client tel que renvoyé par `GET /portfolio` — positions
 *  dérivées en base à partir des ordres adjugés. */
export interface PortfolioResult {
  clientId: string;
  positions: Position[];
  lignesActives: number;
  valeurTotale: number;
  soldeEspeces: number | null;
}

/** Ligne d'import de portefeuille (corps de `POST /portfolio/import`). */
export interface PortfolioImportRow {
  isin: string;
  designation: string;
  emetteur: string;
  paysCode: string;
  nature: string;
  dateEmission: string;
  dateEcheance: string;
  tauxNominal: number;
  clientNom: string;
  matriculeClient: string;
  numeroCompte: string;
  volume: number;
  montantAdjuge: number;
  emissionId?: string;
  clientId?: string;
}

/** Ligne d'identité de la base clients (clients_fb) pour le modèle d'import. */
export interface ClientFbLite {
  nom_prenom: string;
  matricule: string | null;
  compte_depot: string | null;
  numero_compte: string;
  compte_especes: string | null;
}

/** Résultat de l'import batch de positions de portefeuille. */
export interface PortfolioImportResult {
  imported: number;
  errors: Array<{ isin: string; clientNom: string; error: string }>;
}

/** Champs requis pour créer une fiche émission côté backend (`POST /emissions`). */
export interface CreateEmissionBody {
  code: string;
  isin: string;
  libelle: string;
  nature: string;
  paysCode: string;
  dateEmission: string;
  ouvertureSouscription: string;
  fermetureSouscription: string;
  dateEcheance: string;
  dateReglement: string;
  valeurNominaleUnitaire: number;
  montantGlobal: number;
  tauxNominal?: number;
  montantMinimum: number;
  frequenceCoupon?: string;
  modeAdjudication: string;
  description?: string;
  observation?: string;
}

/** Corps de création d'un dossier client (`POST /clients`). */
export interface CreateClientBody {
  type: 'PP' | 'PM';
  raisonSociale: string;
  rccm?: string;
  categorie?: string;
  categorieClient?: string;
  matricule?: string;
  dirigeant?: string;
  assujettiTaxes?: boolean;
  localisation?: string;
  telephone2?: string;
  typeCompte?: string;
  adresse?: Adresse;
  signataires: Contact[];
  sousComptes: Array<Omit<SousCompteTitres, 'id'>>;
  compteEspecesLie?: string;
  soldeEspecesInitial?: number;
}

/** Corps de mise à jour d'un client (`PATCH /clients/:id`) — champs partiels.
 *  `signataires`/`sousComptes` fournis remplacent intégralement la collection. */
export interface UpdateClientBody {
  raisonSociale?: string;
  rccm?: string;
  categorie?: string;
  categorieClient?: string;
  matricule?: string;
  dirigeant?: string;
  assujettiTaxes?: boolean;
  localisation?: string;
  telephone2?: string;
  typeCompte?: string;
  statut?: string;
  telephone?: string;
  email?: string;
  compteTitres?: string;
  compteEspecesLie?: string;
  adresse?: Adresse;
  signataires?: Contact[];
  sousComptes?: Array<Omit<SousCompteTitres, 'id'>>;
}

/** Livrable (document) — `contenu` n'est présent que sur le détail. */
/** Opération d'un compte joint en attente de la signature de l'utilisateur. */
export interface CoSignatureItem {
  orderId: string;
  reference: string;
  emissionCode: string;
  nature: string;
  volume: number;
  montant: number;
  tauxSoumis: number;
  expiresAt: string;
}

/**
 * Preuve apportée par un co-signataire qui VALIDE : signature manuscrite +
 * capture faciale. Le descripteur est calculé par le navigateur mais c'est le
 * serveur seul qui juge de la correspondance.
 */
export interface CoSignaturePreuve {
  signatureData: string;
  imageBase64: string;
  livenessScore?: number;
  challengeType?: string;
  descriptor?: number[];
}

/** Une personne liée au compte-titres, vue back-office, pour un ordre donné. */
export interface OrderSignataire {
  userId: string;
  nom: string;
  email: string;
  role: 'EMETTEUR' | 'COSIGNATAIRE';
  /** `EMETTEUR` pour l'initiateur ; sinon l'état de sa demande de signature. */
  statut: 'EMETTEUR' | 'PENDING' | 'SIGNED' | 'REJECTED' | 'EXPIRED' | 'BYPASSED';
  decidedAt: string | null;
  expiresAt: string | null;
  signature: string | null;
  /** Photo prise à l'ouverture du compte (référence). */
  photoOuverture: string;
  /** Photo prise au moment de la soumission / validation. */
  photoSoumission: string;
  distance: number;
  matchStatus: 'CORRESPOND' | 'DIFFERENT' | 'NON_COMPARABLE';
  livenessScore: number;
  verificationStatus: string | null;
}

/** Vue « compte joint » d'un ordre côté back-office. */
export interface OrderSignaturesView {
  orderId: string;
  reference: string;
  status: string;
  joint: boolean;
  signaturesAttendues: number;
  signaturesObtenues: number;
  seuil: number;
  personnes: OrderSignataire[];
  bypassedAt: string | null;
  bypassMotif: string | null;
  bypassPar: string | null;
}

export interface DocumentItem {
  id: string;
  reference: string;
  type: string;
  titre: string;
  clientId: string;
  clientNom: string;
  uploadedBy: string;
  mimeType: string;
  taille?: string;
  telechargements: number;
  dateGeneration: string;
  contenu?: string;
}

/**
 * Convertit un horodatage ISO 8601 (`2026-05-11T08:00:00Z`) vers le format
 * d'affichage attendu par l'application (`2026-05-11 08:00`). Les dates simples
 * (`YYYY-MM-DD`) sont laissées intactes.
 */
function toDisplayDate(s: string | null | undefined): string {
  if (!s) return '';
  // Horodatage avec fuseau (Z ou ±HH:MM) : on le convertit en HEURE LOCALE pour
  // l'affichage (sinon une notif émise à 19:00 UTC s'affichait « 19:00 » alors
  // qu'il est 20:00 localement → faux « il y a 1 h » dès la création).
  if (/T\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
  return s.includes('T') ? s.replace('T', ' ').slice(0, 16) : s;
}

/**
 * Convertit une date/heure de formulaire (`2026-05-05T08:00` ou
 * `2026-05-05 08:00`) vers le format RFC 3339 attendu par le backend
 * (`2026-05-05T08:00:00Z`). Les dates simples (`YYYY-MM-DD`) sont conservées.
 */
function toRfc3339(s: string): string {
  if (!s) return s;
  let v = s.trim().replace(' ', 'T');
  if (!v.includes('T')) return v; // date simple, sans heure
  if (/T\d{2}:\d{2}$/.test(v)) v += ':00';
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(v)) v += 'Z';
  return v;
}

function mapDossier(d: ClientDossier): ClientDossier {
  return { ...d, createdAt: toDisplayDate(d.createdAt) };
}

function mapEmission(e: Emission): Emission {
  return {
    ...e,
    ouvertureSouscription: toDisplayDate(e.ouvertureSouscription),
    fermetureSouscription: toDisplayDate(e.fermetureSouscription),
    dateValidation: e.dateValidation ? toDisplayDate(e.dateValidation) : undefined,
    createdAt: e.createdAt ? toDisplayDate(e.createdAt) : undefined,
  };
}

function mapOrder(o: Order): Order {
  return {
    ...o,
    dateSoumission: toDisplayDate(o.dateSoumission),
    updatedAt: o.updatedAt ? toDisplayDate(o.updatedAt) : undefined,
  };
}

/**
 * Client HTTP typé du backend Axum.
 *
 * Ne couvre que les domaines réellement exposés par le backend (émissions,
 * ordres, audit). Les jetons d'authentification sont ajoutés automatiquement
 * par `authInterceptor` — ce service n'a pas à les gérer.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiBaseUrl;

  /** Liste des émissions (le backend filtre selon le rôle : public ⇒ PUBLIE seules). */
  listEmissions(): Observable<Emission[]> {
    return this.http
      .get<Page<Emission>>(`${this.api}/emissions?size=100`)
      .pipe(map((r) => r.data.map(mapEmission)));
  }

  /** Crée une fiche émission — persistée côté backend (statut BROUILLON). */
  createEmission(e: CreateEmissionBody): Observable<Emission> {
    const body = {
      ...e,
      ouvertureSouscription: toRfc3339(e.ouvertureSouscription),
      fermetureSouscription: toRfc3339(e.fermetureSouscription),
    };
    return this.http.post<Emission>(`${this.api}/emissions`, body).pipe(map(mapEmission));
  }

  /** Publie une fiche émission (BROUILLON → PUBLIE) — permission EMISSION_VALIDATE. */
  publishEmission(id: string): Observable<Emission> {
    return this.http
      .post<Emission>(`${this.api}/emissions/${id}/publish`, {})
      .pipe(map(mapEmission));
  }

  /** Publie en une fois toutes les fiches en brouillon (superviseur / admin). */
  publishAllEmissions(): Observable<{ published: number; codes: string[] }> {
    return this.http.post<{ published: number; codes: string[] }>(
      `${this.api}/emissions/publish-all`, {});
  }

  /** Modifie une fiche émission — persistée en base (CSFT §M1-F05 : une fiche
   *  publiée modifiée repasse en brouillon côté serveur). */
  updateEmission(id: string, e: CreateEmissionBody): Observable<Emission> {
    const body = {
      ...e,
      ouvertureSouscription: toRfc3339(e.ouvertureSouscription),
      fermetureSouscription: toRfc3339(e.fermetureSouscription),
    };
    return this.http.patch<Emission>(`${this.api}/emissions/${id}`, body).pipe(map(mapEmission));
  }

  /** Rejette une fiche émission en brouillon avec un motif (CSFT §M1-F02). */
  rejectEmission(id: string, motif: string): Observable<Emission> {
    return this.http
      .post<Emission>(`${this.api}/emissions/${id}/reject`, { motif })
      .pipe(map(mapEmission));
  }

  /** Clôture une émission publiée (PUBLIE → CLOTURE). */
  closeEmission(id: string): Observable<Emission> {
    return this.http.post<Emission>(`${this.api}/emissions/${id}/close`, {}).pipe(map(mapEmission));
  }

  /** Archive une émission clôturée (CLOTURE → ARCHIVE). */
  archiveEmission(id: string): Observable<Emission> {
    return this.http.post<Emission>(`${this.api}/emissions/${id}/archive`, {}).pipe(map(mapEmission));
  }

  /** Diffuse par e-mail le catalogue des émissions ouvertes (statut PUBLIE).
   *  Si `recipients` est vide, le digest est envoyé à tous les clients enregistrés. */
  broadcastEmissions(recipients: string[] = []): Observable<BroadcastResult> {
    return this.http.post<BroadcastResult>(`${this.api}/emissions/broadcast`, { recipients });
  }

  /** Liste des e-mails des clients enregistrés actifs — pour préremplir Outlook. */
  broadcastRecipients(): Observable<string[]> {
    return this.http
      .get<{ emails: string[] }>(`${this.api}/emissions/broadcast/recipients`)
      .pipe(map((r) => r.emails ?? []));
  }

  /** Portefeuille du client connecté — positions dérivées en base de ses ordres adjugés. */
  listPortfolio(): Observable<PortfolioResult> {
    return this.http.get<PortfolioResult>(`${this.api}/portfolio`);
  }

  /** Portefeuille d'un client donné (back-office, permission CLIENT_MANAGE) —
   *  sert à lister les titres possédés avant d'éditer une attestation. */
  getClientPortfolio(clientId: string): Observable<PortfolioResult> {
    return this.http.get<PortfolioResult>(`${this.api}/portfolio/${clientId}`);
  }

  /** Importe des positions de portefeuille en batch depuis un relevé Excel.
   *  Nécessite la permission CLIENT_MANAGE. Le backend crée les positions directement. */
  importPortfolioRows(rows: PortfolioImportRow[]): Observable<PortfolioImportResult> {
    return this.http.post<PortfolioImportResult>(`${this.api}/portfolio/import`, { rows });
  }

  /** Référentiel base clients complet (identité) — alimente le modèle d'import
   *  de portefeuille pré-rempli. Permission CLIENT_MANAGE. */
  getAllClientsFb(): Observable<ClientFbLite[]> {
    return this.http.get<ClientFbLite[]>(`${this.api}/admin/clients-fb/all`);
  }

  /** Registre des dossiers clients (permission CLIENT_MANAGE) — paginé côté backend. */
  listClientDossiers(): Observable<ClientDossier[]> {
    return this.http
      .get<Page<ClientDossier>>(`${this.api}/clients/dossiers?size=100`)
      .pipe(map((r) => r.data.map(mapDossier)));
  }

  /** Dossier complet du client connecté (compte-titres, adresses, contacts, sous-comptes). */
  getMyDossier(): Observable<ClientDossier> {
    return this.http.get<ClientDossier>(`${this.api}/clients/me`).pipe(map(mapDossier));
  }

  /** Crée un dossier client (compte de connexion + profil + adresses + contacts + sous-comptes). */
  createClient(body: CreateClientBody): Observable<ClientDossier> {
    return this.http.post<ClientDossier>(`${this.api}/clients`, body).pipe(map(mapDossier));
  }

  /** Met à jour l'identité, le contact principal et l'adresse d'un client (CLIENT_MANAGE). */
  updateClient(id: string, body: UpdateClientBody): Observable<ClientDossier> {
    return this.http.patch<ClientDossier>(`${this.api}/clients/${id}`, body).pipe(map(mapDossier));
  }

  /** Désactive (clôture) un client — réversible via une modification du statut (CLIENT_MANAGE). */
  deactivateClient(id: string): Observable<ClientDossier> {
    return this.http.delete<ClientDossier>(`${this.api}/clients/${id}`).pipe(map(mapDossier));
  }

  /** Matrice RBAC rôle → permissions (lecture — tout utilisateur authentifié). */
  listRolePermissions(): Observable<Record<string, string[]>> {
    return this.http.get<Record<string, string[]>>(`${this.api}/permissions`);
  }

  /** Octroie ou retire une permission à un rôle (permission USER_MANAGE). */
  setRolePermission(
    role: string,
    permission: string,
    granted: boolean,
  ): Observable<Record<string, string[]>> {
    return this.http.put<Record<string, string[]>>(`${this.api}/permissions`, {
      role,
      permission,
      granted,
    });
  }

  /** Liste des ordres (le backend cloisonne : un client ne reçoit que les siens). */
  listOrders(): Observable<Order[]> {
    return this.http
      .get<Page<Order>>(`${this.api}/orders?size=100`)
      .pipe(map((r) => r.data.map(mapOrder)));
  }

  /** Soumet un nouvel ordre de souscription (signature électronique incluse). */
  createOrder(body: {
    emissionId: string;
    volume: number;
    tauxSoumis: number;
    signatureData?: string;
  }): Observable<Order> {
    return this.http.post<Order>(`${this.api}/orders`, body).pipe(map(mapOrder));
  }

  /** Modifie le volume/taux d'un ordre SOUMIS (avant prise en charge par l'agent). */
  updateOrder(id: string, body: { volume: number; tauxSoumis: number; signatureData?: string }): Observable<Order> {
    return this.http.patch<Order>(`${this.api}/orders/${id}`, body).pipe(map(mapOrder));
  }

  /** Annule un ordre (statut SOUMIS). */
  cancelOrder(id: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/orders/${id}/cancel`, {}).pipe(map(mapOrder));
  }

  /** Compte joint — opérations en attente de MA signature. */
  listPendingCoSignatures(): Observable<CoSignatureItem[]> {
    return this.http.get<CoSignatureItem[]>(`${this.api}/orders/cosignatures/pending`);
  }

  /**
   * Compte joint — valide (approve=true) ou refuse (false) une opération.
   *
   * Valider exige la même preuve qu'à l'inscription : signature manuscrite ET
   * capture du visage (`preuve`). Refuser n'en exige aucune.
   */
  coSignOrder(id: string, approve: boolean, preuve?: CoSignaturePreuve): Observable<Order> {
    return this.http.post<Order>(`${this.api}/orders/${id}/cosign`,
      { approve, ...(preuve ?? {}) }).pipe(map(mapOrder));
  }

  /** Compte joint (back-office) — qui a validé, qui est en attente, avec les photos. */
  getOrderSignatures(id: string): Observable<OrderSignaturesView> {
    return this.http.get<OrderSignaturesView>(`${this.api}/admin/orders/${id}/signatures`);
  }

  /** Compte joint (back-office) — transmet l'ordre sans attendre tous les signataires. */
  forceValidateOrder(id: string, motif: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/orders/${id}/force-validate`, { motif })
      .pipe(map(mapOrder));
  }

  /** Valide un ordre (back-office) — SOUMIS/EN_VERIFICATION → EN_ATTENTE_ADJUDICATION. */
  validateOrder(id: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/orders/${id}/validate`, {}).pipe(map(mapOrder));
  }

  /** Rejette un ordre (back-office) avec un motif obligatoire (visible côté client). */
  rejectOrder(id: string, motif: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/orders/${id}/reject`, { motif }).pipe(map(mapOrder));
  }

  /** Change le statut d'un ordre — vérification, transmission, résultat d'adjudication
   *  ou changement libre (back-office). Persisté et notifié au client. */
  changeOrderStatus(
    id: string,
    body: {
      status: string;
      motif?: string;
      montantAdjuge?: number;
      volumeAlloue?: number;
      tauxAdjuge?: number;
      commentaire?: string;
    },
  ): Observable<Order> {
    return this.http.post<Order>(`${this.api}/orders/${id}/status`, body).pipe(map(mapOrder));
  }

  /** Valide le résultat d'adjudication proposé par l'agent (superviseur). */
  validateOrderResult(id: string): Observable<Order> {
    return this.http
      .post<Order>(`${this.api}/orders/${id}/validate-result`, {})
      .pipe(map(mapOrder));
  }

  /** Refuse le résultat d'adjudication proposé (superviseur) — repart vers l'agent. */
  rejectOrderResult(id: string, motif: string): Observable<Order> {
    return this.http
      .post<Order>(`${this.api}/orders/${id}/reject-result`, { motif })
      .pipe(map(mapOrder));
  }

  /** Liste les ordres dont l'adjudication est en attente de validation superviseur. */
  listOrdersPendingValidation(): Observable<Order[]> {
    return this.http
      .get<{ data: Order[] }>(`${this.api}/orders`, { params: { pendingValidation: 'true', size: '200' } })
      .pipe(map((r) => (r.data ?? []).map(mapOrder)));
  }

  /** Enregistre la note interne d'un ordre (back-office). */
  setOrderNotes(id: string, notes: string): Observable<Order> {
    return this.http.post<Order>(`${this.api}/orders/${id}/notes`, { notes }).pipe(map(mapOrder));
  }

  /** Valide ou rejette la signature électronique d'un ordre (back-office). */
  verifyOrderSignature(id: string, verified: boolean): Observable<Order> {
    return this.http
      .post<Order>(`${this.api}/orders/${id}/verify-signature`, { verified })
      .pipe(map(mapOrder));
  }

  /** Journal d'audit (nécessite la permission AUDIT_READ côté backend). */
  listAudit(): Observable<AuditEntry[]> {
    return this.http
      .get<Page<AuditEntry>>(`${this.api}/audit?size=100`)
      .pipe(map((r) => r.data.map((a) => ({ ...a, horodatage: toDisplayDate(a.horodatage) }))));
  }

  // ─────────────────────────── Comptes utilisateurs ──────────────────────────

  /** Liste des acteurs internes (permission USER_MANAGE). */
  listUsers(): Observable<UserAccount[]> {
    return this.http
      .get<Page<UserAccount>>(`${this.api}/users?size=100`)
      .pipe(map((r) => r.data));
  }

  /** Liste des comptes clients investisseurs (permission CLIENT_MANAGE). */
  listClients(): Observable<UserAccount[]> {
    return this.http
      .get<Page<UserAccount>>(`${this.api}/clients?size=100`)
      .pipe(map((r) => r.data));
  }

  /** Crée un compte utilisateur — persisté en base, mot de passe haché côté backend. */
  createUser(body: {
    email: string;
    password: string;
    role: UserRole;
    nom: string;
    prenom?: string;
    compteTitres?: string;
    compteEspeces?: string;
  }): Observable<UserAccount> {
    return this.http.post<UserAccount>(`${this.api}/users`, body);
  }

  // ────────────────────────────── Livrables ──────────────────────────────────

  /** Liste des livrables (client : les siens ; staff : tous). */
  listDocuments(): Observable<DocumentItem[]> {
    return this.http
      .get<Page<DocumentItem>>(`${this.api}/documents?size=100`)
      .pipe(map((r) => r.data.map((d) => ({ ...d, dateGeneration: toDisplayDate(d.dateGeneration) }))));
  }

  /** Téléverse un livrable et l'attribue à un client (permission DOCUMENT_UPLOAD). */
  uploadDocument(body: {
    clientId: string;
    type: string;
    titre: string;
    mimeType: string;
    taille?: string;
    contenu: string;
  }): Observable<DocumentItem> {
    return this.http.post<DocumentItem>(`${this.api}/documents`, body);
  }

  /** Détail d'un livrable avec son contenu (consultation / téléchargement). */
  getDocument(id: string): Observable<DocumentItem> {
    return this.http.get<DocumentItem>(`${this.api}/documents/${id}`);
  }

  /** Édite l'attestation de propriété du client connecté. Le PDF est produit par
   *  le serveur à partir des positions en base : aucun contenu n'est transmis. */
  generateAttestation(): Observable<DocumentItem> {
    return this.http.post<DocumentItem>(`${this.api}/documents/attestation-propriete`, {});
  }

  /** Édite l'attestation de propriété d'un client pour un titre précis (ISIN)
   *  qu'il possède et la lui transmet. Back-office (permission DOCUMENT_UPLOAD). */
  generateAttestationClient(body: { clientId: string; isin: string }): Observable<DocumentItem> {
    return this.http.post<DocumentItem>(`${this.api}/documents/attestation-propriete/client`, body);
  }

  /** Édite la « Situation de portefeuille titres » d'un client et la lui transmet.
   *  Le PDF est produit par le serveur à partir des positions en base. Réservé au
   *  back-office (permission DOCUMENT_UPLOAD). `periode` au format ISO (AAAA-MM-JJ). */
  generateSituationPortefeuille(body: {
    clientId: string;
    periode?: string;
    service?: string;
  }): Observable<DocumentItem> {
    return this.http.post<DocumentItem>(`${this.api}/documents/situation-portefeuille`, body);
  }

  /** Modifie un compte (réservé à l'administrateur côté backend). */
  updateUser(
    id: string,
    body: Partial<{
      nom: string;
      prenom: string;
      email: string;
      statut: string;
      compteTitres: string;
      compteEspeces: string;
    }>,
  ): Observable<UserAccount> {
    return this.http.patch<UserAccount>(`${this.api}/users/${id}`, body);
  }

  /** Réinitialise le mot de passe d'un compte (interne ou client) — ADMIN.
   *  Si `password` est fourni, ce mot de passe est appliqué ; sinon un mot de
   *  passe provisoire aléatoire est généré. À changer à la prochaine connexion. */
  resetUserPassword(id: string, password?: string): Observable<{ temporaryPassword: string }> {
    const body = password && password.trim() ? { password: password.trim() } : {};
    return this.http.post<{ temporaryPassword: string }>(
      `${this.api}/users/${id}/reset-password`, body);
  }

  /** Supprime un compte (interne ou client) — ADMIN. Échoue (409) si le compte
   *  porte des opérations liées : le suspendre alors plutôt que le supprimer. */
  deleteUser(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.api}/users/${id}`);
  }

  /** Mot de passe INITIAL d'un compte (back-office), tant qu'il n'a pas été
   *  changé. `password` est null si déjà changé / indisponible. */
  getInitialPassword(id: string): Observable<{ password: string | null; available: boolean }> {
    return this.http.get<{ password: string | null; available: boolean }>(
      `${this.api}/users/${id}/initial-password`);
  }

  // ──────────────────────────── Notifications ────────────────────────────────

  /** Notifications de l'utilisateur connecté (changements d'état d'ordre, etc.). */
  listNotifications(): Observable<Notification[]> {
    return this.http.get<Page<BackendNotification>>(`${this.api}/notifications?size=100`).pipe(
      map((r) =>
        r.data.map((n) => ({
          id: n.id,
          type: n.type as Notification['type'],
          titre: n.titre,
          message: n.message,
          date: toDisplayDate(n.createdAt),
          lu: n.lu,
          canal: ['IN_APP' as const],
        })),
      ),
    );
  }

  markNotificationRead(id: string): Observable<void> {
    return this.http.post<void>(`${this.api}/notifications/${id}/read`, {});
  }

  markAllNotificationsRead(): Observable<void> {
    return this.http.post<void>(`${this.api}/notifications/read-all`, {});
  }

  // ─────────────────────────── Assistant (chatbot) ───────────────────────────

  /** Envoie un message à l'assistant de la plateforme ; l'historique est renvoyé
   *  à chaque appel (le backend ne conserve pas d'état de conversation). */
  sendChatMessage(message: string, history: ChatMessage[]): Observable<string> {
    return this.http
      .post<{ reply: string }>(`${this.api}/chatbot/message`, { message, history })
      .pipe(map((r) => r.reply));
  }

  // ───────────────────────── Prévision de taux (IA) ──────────────────────────

  /** Historique comparable + estimation indicative de taux pour une émission. */
  getForecast(emissionId: string): Observable<ForecastResponse> {
    return this.http.get<ForecastResponse>(`${this.api}/forecast/${emissionId}`);
  }

  // ───────────────────── QR code · Lien de connexion ─────────────────────

  /** Génère le lien de connexion à la plateforme et son QR code (PNG en data URL).
   *  Réservé au back-office (AGENT, SUPERVISEUR, ADMIN). */
  getConnectionQr(): Observable<ConnectionQr> {
    return this.http.get<ConnectionQr>(`${this.api}/connection-qr`);
  }

  // ─────────────── Configuration · Affichage du marché primaire ───────────────

  /** Configuration d'affichage du marché courante (back-office). */
  getMarcheConfig(): Observable<MarcheConfig> {
    return this.http.get<MarcheConfig>(`${this.api}/admin/marche-config`);
  }

  /** Enregistre la configuration d'affichage du marché (permission CONFIG_MARCHE). */
  updateMarcheConfig(body: MarcheConfig): Observable<MarcheConfig> {
    return this.http.put<MarcheConfig>(`${this.api}/admin/marche-config`, body);
  }

  // ─────────────────── Administration · Messagerie (SMTP) ───────────────────

  /** Paramètres SMTP courants (sans mot de passe) — ADMIN uniquement. */
  getMailSettings(): Observable<MailSettings> {
    return this.http.get<MailSettings>(`${this.api}/admin/mail-settings`);
  }

  /** Enregistre les paramètres SMTP. `password` omis = inchangé. */
  updateMailSettings(body: MailSettingsUpdate): Observable<MailSettings> {
    return this.http.put<MailSettings>(`${this.api}/admin/mail-settings`, body);
  }

  /** Envoie un e-mail de test à l'adresse fournie. */
  testMailSettings(to: string): Observable<{ status: 'SENT' | 'SIMULATED' | 'FAILED' }> {
    return this.http.post<{ status: 'SENT' | 'SIMULATED' | 'FAILED' }>(
      `${this.api}/admin/mail-settings/test`, { to });
  }

  // ───────────────────── Administration · LDAP / Active Directory ───────────

  /** Paramètres LDAP courants (sans mot de passe de bind) — ADMIN uniquement. */
  getLdapSettings(): Observable<LdapSettings> {
    return this.http.get<LdapSettings>(`${this.api}/admin/ldap-settings`);
  }

  /** Enregistre les paramètres LDAP. `bindPassword` omis = inchangé. */
  updateLdapSettings(body: LdapSettingsUpdate): Observable<LdapSettings> {
    return this.http.put<LdapSettings>(`${this.api}/admin/ldap-settings`, body);
  }

  /** Teste la liaison à l'annuaire avec les paramètres enregistrés. */
  testLdapSettings(): Observable<{ ok: boolean; message: string }> {
    return this.http.post<{ ok: boolean; message: string }>(
      `${this.api}/admin/ldap-settings/test`, {});
  }

  // ───────────────────── Administration · Serveur OTP ──────────────────────

  /** Paramètres OTP courants (sans clé d'API SMS) — ADMIN uniquement. */
  getOtpSettings(): Observable<OtpSettings> {
    return this.http.get<OtpSettings>(`${this.api}/admin/otp-settings`);
  }

  /** Enregistre les paramètres OTP. `smsApiKey` omis = inchangé. */
  updateOtpSettings(body: OtpSettingsUpdate): Observable<OtpSettings> {
    return this.http.put<OtpSettings>(`${this.api}/admin/otp-settings`, body);
  }

  // ──────────────── Administration · Supervision des codes OTP ──────────────

  /**
   * Journal des codes OTP envoyés (back-office : agent / superviseur / admin).
   * Permet de relayer un code au client en cas de non-réception.
   */
  getOtpLog(q = '', activeOnly = false): Observable<Page<OtpLogEntry>> {
    const params: Record<string, string> = { size: '100' };
    if (q.trim()) params['q'] = q.trim();
    if (activeOnly) params['activeOnly'] = 'true';
    return this.http.get<Page<OtpLogEntry>>(`${this.api}/admin/otp-log`, { params });
  }
}

/** Une entrée du journal de supervision OTP. */
export interface OtpLogEntry {
  id: string;
  userId: string;
  utilisateurNom: string;
  email: string;
  role: UserRole;
  telephone?: string;
  code?: string;
  attempts: number;
  consumed: boolean;
  active: boolean;
  createdAt: string;
  expiresAt: string;
}

/** Paramètres de messagerie tels que renvoyés par le backend (sans mot de passe). */
export interface MailSettings {
  host: string;
  port: number;
  username: string;
  fromAddress: string;
  fromName: string;
  auth: boolean;
  starttls: boolean;
  enabled: boolean;
  logoUrl: string;
  signature: string;
  passwordSet: boolean;
  /** Vrai si la connexion SMTP est imposée par des variables d'environnement. */
  envManaged?: boolean;
}

/** Corps de mise à jour des paramètres. `password` absent = inchangé. */
export interface MailSettingsUpdate {
  host: string;
  port: number;
  username: string;
  password?: string;
  fromAddress: string;
  fromName: string;
  auth: boolean;
  starttls: boolean;
  enabled: boolean;
  logoUrl: string;
  signature: string;
}

/** Paramètres LDAP / Active Directory (sans mot de passe de bind). */
export interface LdapSettings {
  enabled: boolean;
  host: string;
  port: number;
  ssl: boolean;
  startTls: boolean;
  baseDn: string;
  bindDn: string;
  userSearchBase: string;
  userSearchFilter: string;
  bindPasswordSet: boolean;
}

/** Corps de mise à jour LDAP. `bindPassword` absent = inchangé. */
export interface LdapSettingsUpdate {
  enabled: boolean;
  host: string;
  port: number;
  ssl: boolean;
  startTls: boolean;
  baseDn: string;
  bindDn: string;
  bindPassword?: string;
  userSearchBase: string;
  userSearchFilter: string;
}

/** Paramètres du serveur OTP (sans clé d'API SMS). */
export interface OtpSettings {
  canal: 'EMAIL' | 'SMS' | 'EMAIL_SMS' | 'LOG';
  longueur: number;
  ttlSecondes: number;
  maxTentatives: number;
  smsApiUrl: string;
  smsExpediteur: string;
  smsApiKeySet: boolean;
}

/** Corps de mise à jour des paramètres OTP. `smsApiKey` absent = inchangé. */
export interface OtpSettingsUpdate {
  canal: 'EMAIL' | 'SMS' | 'EMAIL_SMS' | 'LOG';
  longueur: number;
  ttlSecondes: number;
  maxTentatives: number;
  smsApiUrl?: string;
  smsApiKey?: string;
  smsExpediteur?: string;
}

/** Lien de connexion à la plateforme et son QR code (PNG en data URL). */
export interface ConnectionQr {
  url: string;
  qrCodeDataUrl: string;
}

/** Configuration d'affichage du marché primaire (persistée en base). */
export interface MarcheConfig {
  statuses: string[];
  dateDu: string;
  dateAu: string;
}

/** Résultat de la diffusion d'un digest d'émissions par e-mail. */
export interface BroadcastResult {
  recipientsCount: number;
  emissionsCount: number;
  /** `SENT` = envoi SMTP réel · `SIMULATED` = SMTP non configuré (log) · `FAILED` */
  status: 'SENT' | 'SIMULATED' | 'FAILED';
}


/** Un tour de conversation avec l'assistant de la plateforme. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Un point de l'historique des émissions comparables (prévision de taux). */
export interface ForecastHistoricalPoint {
  code: string;
  dateEmission: string;
  tauxNominal: number;
}

/** Réponse de `GET /forecast/:emissionId` — historique + estimation indicative IA. */
export interface ForecastResponse {
  historique: ForecastHistoricalPoint[];
  projectionDisponible: boolean;
  message: string | null;
  tendance: 'HAUSSE' | 'BAISSE' | 'STABLE' | null;
  tauxProjete: number | null;
  fourchetteMin: number | null;
  fourchetteMax: number | null;
  commentaire: string | null;
}

/** Notification telle que renvoyée par le backend. */
interface BackendNotification {
  id: string;
  type: string;
  titre: string;
  message: string;
  reference?: string;
  lu: boolean;
  createdAt: string;
}
