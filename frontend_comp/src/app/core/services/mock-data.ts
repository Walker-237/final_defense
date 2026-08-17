import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, catchError, forkJoin, map, of, switchMap, tap, throwError } from 'rxjs';
import {
  AuditEntry, ClientDossier,
  Emission, EmissionStatus, Notification, Order, OrderStatus, ORDER_STATUS_LABELS,
  PAYS_CEMAC, Position, User, Permission, UserRole, DEFAULT_ROLE_PERMISSIONS
} from '../models/models';
import { ApiService, CreateEmissionBody, DocumentItem } from './api';

/** Construit le contenu d'un e-mail de notification de changement de statut.
 *  Conforme aux libellés CSFT §M2-S01. */
function buildStatusEmail(o: Order, newStatus: OrderStatus, oldStatus: OrderStatus, motif?: string, volAlloue?: number, mntDebite?: number): { type: Notification['type']; sujet: string; corps: string } {
  const ref = o.reference;
  const em = o.emissionCode;
  const montantFmt = (n?: number) => (n ?? 0).toLocaleString('fr-FR') + ' FCFA';

  switch (newStatus) {
    case 'SOUMIS':
      return { type: 'INFO', sujet: `[Afriland First Bank] Ordre ${ref} — Soumission confirmée`,
        corps: `Bonjour ${o.clientNom},\n\nVotre ordre ${ref} portant sur l'émission ${em} (${o.volume} titres · ${montantFmt(o.montant)}) a été enregistré.\n\nVérification de la provision en cours via le core banking. Vous serez informé du résultat sous quelques minutes.\n\nAfriland First Bank — Spécialiste en Valeurs du Trésor` };
    case 'EN_VERIFICATION':
      return { type: 'INFO', sujet: `[Afriland First Bank] Ordre ${ref} — Vérification de fonds`,
        corps: `Bonjour ${o.clientNom},\n\nVotre ordre ${ref} (${em}) est en cours de vérification de provision sur votre compte espèces. Une fois la provision confirmée, l'ordre sera transmis au marché primaire.\n\nCordialement,\nAfriland First Bank` };
    case 'EN_ATTENTE_ADJUDICATION':
      return { type: 'INFO', sujet: `[Afriland First Bank] Ordre ${ref} — Transmis pour adjudication`,
        corps: `Bonjour ${o.clientNom},\n\nVotre ordre ${ref} a été soumis au marché primaire BEAC pour adjudication. Vous serez informé du résultat dès la publication des résultats.\n\nCordialement,\nAfriland First Bank` };
    case 'TOTALEMENT_RETENU':
      return { type: 'SUCCESS', sujet: `[Afriland First Bank] Ordre ${ref} — Totalement retenu ✓`,
        corps: `Bonjour ${o.clientNom},\n\nBonne nouvelle : votre ordre ${ref} sur l'émission ${em} a été intégralement adjugé.\n\n• Volume alloué : ${volAlloue ?? o.volume} titres\n• Montant débité : ${montantFmt(mntDebite ?? o.montant)}\n• Taux retenu : ${o.tauxSoumis} %\n\nVotre avis d'opération est disponible dans votre espace client.\n\nCordialement,\nAfriland First Bank` };
    case 'PARTIELLEMENT_RETENU':
      return { type: 'SUCCESS', sujet: `[Afriland First Bank] Ordre ${ref} — Partiellement retenu`,
        corps: `Bonjour ${o.clientNom},\n\nVotre ordre ${ref} sur l'émission ${em} a été partiellement adjugé :\n\n• Volume demandé : ${o.volume}\n• Volume alloué : ${volAlloue ?? 0} titres\n• Montant débité : ${montantFmt(mntDebite ?? 0)}\n• Provision résiduelle libérée sur votre compte espèces\n\nAvis d'opération disponible dans votre espace client.\n\nCordialement,\nAfriland First Bank` };
    case 'NON_RETENU':
      return { type: 'WARN', sujet: `[Afriland First Bank] Ordre ${ref} — Non retenu`,
        corps: `Bonjour ${o.clientNom},\n\nVotre ordre ${ref} sur l'émission ${em} n'a pas été retenu lors de la séance d'adjudication.\n\nLa provision réservée (${montantFmt(o.montant)}) a été intégralement libérée sur votre compte espèces.\n\nUn avis d'offre non adjugée a été émis et est disponible dans vos documents.\n\nCordialement,\nAfriland First Bank` };
    case 'ANNULE':
      return { type: 'INFO', sujet: `[Afriland First Bank] Ordre ${ref} — Annulé`,
        corps: `Bonjour ${o.clientNom},\n\nVotre ordre ${ref} a été annulé${motif ? ' (' + motif + ')' : ''}. La provision réservée (${montantFmt(o.montant)}) a été libérée sur votre compte espèces.\n\nCordialement,\nAfriland First Bank` };
    default:
      return { type: 'INFO', sujet: `[Afriland First Bank] Ordre ${ref} — Mise à jour`,
        corps: `Bonjour ${o.clientNom},\n\nLe statut de votre ordre ${ref} a évolué : ${ORDER_STATUS_LABELS[oldStatus]} → ${ORDER_STATUS_LABELS[newStatus]}.\n\nCordialement,\nAfriland First Bank` };
  }
}

/** L'IP d'une entrée d'audit est relevée PAR LE SERVEUR : le navigateur ne la
 *  connaît pas. L'entrée affichée localement, le temps que le journal réel soit
 *  rechargé, ne prétend donc pas la connaître plutôt que d'inventer une valeur. */
const IP_INCONNUE_COTE_CLIENT = '—';

/** Affiche la durée d'une émission selon sa nature : BTA → semaines, OTA → années. */
export function dureeAffichage(e: Pick<Emission, 'nature' | 'dureeJours'>): string {
  if (e.nature === 'BTA') {
    const sem = Math.round(e.dureeJours / 7);
    return `${sem} semaine${sem > 1 ? 's' : ''}`;
  }
  const an = Math.round(e.dureeJours / 365 * 10) / 10;
  const formatted = Number.isInteger(an) ? an.toString() : an.toString().replace('.', ',');
  return `${formatted} an${an > 1 ? 's' : ''}`;
}

@Injectable({ providedIn: 'root' })
export class MockData {
  /** État d'authentification simplifié — true quand l'utilisateur est connecté. */
  isAuthenticated = signal<boolean>(false);
  /** Utilisateur courant. NEUTRE/VIDE par défaut : tant que la session réelle
   *  n'est pas restaurée (notamment au rendu serveur SSR avant hydratation), on
   *  n'affiche AUCUNE identité ni donnée d'un compte existant. Évite le « flash »
   *  du compte d'une autre personne lors d'un rechargement de page. */
  currentUser = signal<User>(MockData.emptyUser());

  private static emptyUser(): User {
    return {
      id: '', nom: '', prenom: '', email: '', role: '' as UserRole,
      compteTitres: '', compteEspeces: '', solde: 0,
      categorie: 'NON_QUALIFIE', typeCompte: 'INDIVIDUEL',
      compte: {
        id: '', numero: '', typeCompte: 'INDIVIDUEL', statut: 'ACTIF',
        dateOuverture: '', categorie: 'NON_QUALIFIE', compteEspecesLie: '',
        soldeEspeces: 0, adresses: [], contacts: [], sousComptes: [],
      },
    };
  }

  /** Configuration de l'affichage du marché primaire public (côté BO).
   *  Le client ne voit que les émissions dont le statut est dans `statuses`
   *  ET dont `dateEmission` se situe (le cas échéant) entre `dateDu` et `dateAu`. */
  marcheConfig = signal<{ statuses: EmissionStatus[]; dateDu: string; dateAu: string }>({
    statuses: ['PUBLIE'],
    dateDu: '',
    dateAu: ''
  });

  marcheEmissions = computed(() => {
    const cfg = this.marcheConfig();
    const now = Date.now();
    return this.emissions().filter(e => {
      if (cfg.statuses.length && !cfg.statuses.includes(e.status)) return false;
      // Filet anti-« flash » : une fiche PUBLIE dont la clôture de souscription
      // est dépassée est considérée fermée et masquée immédiatement, sans
      // attendre que le backend la passe en CLOTURE (balayage périodique).
      if (e.status === 'PUBLIE' && this.souscriptionFermee(e, now)) return false;
      // NB : on NE filtre PLUS par la fenêtre date_du/date_au de la config marché.
      // Elle portait sur `dateEmission` (date d'émission/règlement), pas sur la
      // période de souscription, et masquait à tort des émissions ouvertes. Le
      // marché client affiche toutes les fiches PUBLIE encore ouvertes.
      return true;
    });
  });

  /** Vrai si la date limite de souscription de l'émission est dépassée.
   *  `fermetureSouscription` arrive au format « YYYY-MM-DD HH:mm » (ou une simple
   *  date) ; on la compare à l'instant courant. Une valeur absente/illisible est
   *  traitée comme « non fermée » (on n'occulte pas une fiche par défaut). */
  private souscriptionFermee(e: { fermetureSouscription?: string }, now: number): boolean {
    const f = e.fermetureSouscription;
    if (!f) return false;
    const t = Date.parse(f.replace(' ', 'T'));
    return !Number.isNaN(t) && t < now;
  }

  /** Recharge la configuration d'affichage du marché depuis la base (source de
   *  vérité — persistée via CONFIG_MARCHE). */
  refreshMarcheConfig(): void {
    if (!this.isBrowser) return;
    this.api.getMarcheConfig().pipe(catchError(() => of(null))).subscribe(cfg => {
      if (cfg) this.marcheConfig.set({
        statuses: cfg.statuses as EmissionStatus[],
        dateDu: cfg.dateDu ?? '',
        dateAu: cfg.dateAu ?? '',
      });
    });
  }

  updateMarcheConfig(patch: Partial<{ statuses: EmissionStatus[]; dateDu: string; dateAu: string }>) {
    // Mise à jour optimiste locale, puis persistance en base (source de vérité).
    const next = { ...this.marcheConfig(), ...patch };
    this.marcheConfig.set(next);
    this.api.updateMarcheConfig(next).pipe(catchError(() => of(null))).subscribe(saved => {
      if (saved) this.marcheConfig.set({
        statuses: saved.statuses as EmissionStatus[],
        dateDu: saved.dateDu ?? '',
        dateAu: saved.dateAu ?? '',
      });
    });
    this.logAudit('CONFIG_AFFICHAGE_MARCHE', '—');
  }

  // Toutes les données métier proviennent de la base (rechargées via refresh*).
  // Aucune donnée de démonstration en dur : évite d'afficher des données
  // périmées ou celles d'un autre compte avant le chargement réel.
  emissions = signal<Emission[]>([]);

  orders = signal<Order[]>([]);

  positions = signal<Position[]>([]);

  /** Livrables — alimentés depuis la base (`GET /documents`) via `refreshDocuments()`. */
  documents = signal<DocumentItem[]>([]);

  notifications = signal<Notification[]>([]);

  audit = signal<AuditEntry[]>([]);

  /** Client HTTP du backend — source de vérité des émissions, ordres et audit. */
  private readonly api = inject(ApiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  constructor() {
    // Hydratation depuis le backend (différée pour éviter une dépendance
    // circulaire avec l'intercepteur HTTP au moment de la construction).
    // NB : la clôture des fiches expirées est assurée côté backend (CSFT
    // §M1-F04, EmissionExpiryScheduler) et masquée côté client par le filtre
    // `souscriptionFermee` de `marcheEmissions` — plus de traitement local ici.
    queueMicrotask(() => this.refreshEmissions());
    queueMicrotask(() => this.refreshMarcheConfig());
  }

  /** Spec §M6-S03 — Matrice rôle → permissions (modifiable par USER_MANAGE).
   *  Initialisée à partir des valeurs par défaut, ajustable dans l'UI superviseur. */
  rolePermissions = signal<Record<UserRole, Permission[]>>({ ...DEFAULT_ROLE_PERMISSIONS });

  // ── Authentification ─────────────────────────────────────────────────────
  // L'authentification (connexion, MFA, jetons) est désormais entièrement
  // assurée par le backend via `AuthService`. Ce service ne conserve que les
  // signaux d'état `isAuthenticated` / `currentUser`, alimentés après une
  // connexion réussie, et reste la source des données métier de démonstration.

  /** Vérifie si l'utilisateur courant possède la permission demandée. */
  hasPermission(perm: Permission): boolean {
    const role = this.currentUser().role;
    return (this.rolePermissions()[role] ?? []).includes(perm);
  }

  /** Active/désactive une permission pour un rôle — persisté en base
   *  (`PUT /permissions`) ; la matrice rechargée est appliquée en retour. */
  toggleRolePermission(role: UserRole, perm: Permission): void {
    const granted = !(this.rolePermissions()[role] ?? []).includes(perm);
    this.api
      .setRolePermission(role, perm, granted)
      .pipe(catchError(() => of(null)))
      .subscribe((matrix) => {
        if (matrix) this.applyPermissionMatrix(matrix);
      });
  }

  /** Applique une matrice RBAC reçue du backend au signal `rolePermissions`. */
  private applyPermissionMatrix(matrix: Record<string, string[]>): void {
    this.rolePermissions.set(matrix as Record<UserRole, Permission[]>);
  }

  /** Remet la matrice aux valeurs par défaut du CSFT — journalisé. */
  resetRolePermissions(): void {
    this.rolePermissions.set({ ...DEFAULT_ROLE_PERMISSIONS });
    this.logAudit('REINIT_MATRICE_PERMISSIONS', '—');
  }

  getEmission(id: string) { return this.emissions().find(e => e.id === id); }
  getOrder(id: string) { return this.orders().find(o => o.id === id); }

  /** Recharge les émissions depuis le backend (source de vérité). Public. */
  refreshEmissions(): void {
    if (!this.isBrowser) return;
    this.api.listEmissions().pipe(catchError(() => of(null))).subscribe(list => {
      if (list) this.emissions.set(list);
    });
  }

  /** Recharge les ordres visibles par l'utilisateur courant (cloisonnés côté backend). */
  refreshOrders(): void {
    if (!this.isBrowser) return;
    this.api.listOrders().pipe(catchError(() => of(null))).subscribe(list => {
      if (list) this.orders.set(list);
    });
  }

  /** Recharge le journal d'audit (nécessite la permission AUDIT_READ). */
  refreshAudit(): void {
    if (!this.isBrowser) return;
    this.api.listAudit().pipe(catchError(() => of(null))).subscribe(list => {
      if (list) this.audit.set(list);
    });
  }

  /** Recharge le portefeuille du client connecté — positions calculées en base
   *  à partir de ses ordres adjugés (CSFT §M2-P01). */
  refreshPositions(): void {
    if (!this.isBrowser) return;
    this.api.listPortfolio().pipe(catchError(() => of(null))).subscribe(res => {
      if (res) {
        this.positions.set(res.positions);
        this.checkMaturitesAtteintes(res.positions);
      }
    });
  }

  /** Vérifie si des positions ont atteint leur échéance et envoie une notification
   *  au client. La déduplication par sessionStorage évite de notifier plusieurs
   *  fois par session pour la même émission. */
  private checkMaturitesAtteintes(positions: import('../models/models').Position[]): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const storageKey = 'afb_notified_maturites';
    let notified: string[] = [];
    try { notified = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]'); } catch { /* ignore */ }

    const fmt = (n: number) => (Number(n) || 0).toLocaleString('fr-FR');

    for (const pos of positions) {
      if (!pos.dateEcheance || notified.includes(pos.isin)) continue;
      const echeance = new Date(pos.dateEcheance);
      echeance.setHours(0, 0, 0, 0);
      if (echeance > today) continue;

      const msg =
        `${pos.emissionCode} (${pos.nature} — ${pos.emetteur}) est arrivé à échéance le ${pos.dateEcheance}. ` +
        `Votre position : ${fmt(pos.volume)} titre(s) · ` +
        `Valeur nominale totale : ${fmt(pos.valeurTotale)} FCFA · ` +
        `Taux nominal : ${pos.tauxNominal} %.`;

      this.pushNotification({
        type: 'INFO',
        titre: `Échéance atteinte — ${pos.emissionCode}`,
        message: msg,
        canal: ['IN_APP', 'EMAIL', 'SMS'],
      });

      notified.push(pos.isin);
    }

    try { sessionStorage.setItem(storageKey, JSON.stringify(notified)); } catch { /* ignore */ }
  }

  /** Recharge la liste des livrables depuis la base (CSFT §M4). */
  refreshDocuments(): void {
    if (!this.isBrowser) return;
    this.api.listDocuments().pipe(catchError(() => of(null))).subscribe(list => {
      if (list) this.documents.set(list);
    });
  }

  /** Recharge la matrice RBAC rôle → permissions depuis la base (CSFT §M6-S03).
   *  Sans intérêt (et source de 401 bruyants en console) pour un visiteur non
   *  authentifié — ex. sur l'inscription publique. */
  refreshPermissions(): void {
    if (!this.isBrowser || !this.isAuthenticated()) return;
    this.api.listRolePermissions().pipe(catchError(() => of(null))).subscribe(matrix => {
      if (matrix) this.applyPermissionMatrix(matrix);
    });
  }

  /** Recharge les notifications de l'utilisateur connecté. */
  refreshNotifications(): void {
    if (!this.isBrowser) return;
    this.api.listNotifications().pipe(catchError(() => of(null))).subscribe(list => {
      if (list) this.notifications.set(list);
    });
  }

  /** Marque une notification comme lue côté backend, puis resynchronise. */
  markNotificationRead(id: string): void {
    this.api.markNotificationRead(id).pipe(catchError(() => of(void 0))).subscribe(() => this.refreshNotifications());
  }

  /** Marque toutes les notifications comme lues côté backend, puis resynchronise. */
  markAllNotificationsRead(): void {
    this.api.markAllNotificationsRead().pipe(catchError(() => of(void 0))).subscribe(() => this.refreshNotifications());
  }

  private nextAuditId = 100;

  private logAudit(action: string, reference: string, resultat: 'SUCCES' | 'ECHEC' = 'SUCCES') {
    const id = 'a' + (++this.nextAuditId);
    const horodatage = new Date().toISOString().replace('T', ' ').slice(0, 19);
    this.audit.update(list => [{ id, horodatage, utilisateur: this.currentUser().id, action, resultat, reference, ip: IP_INCONNUE_COTE_CLIENT }, ...list]);
  }

  private pushNotification(n: Omit<Notification, 'id' | 'date' | 'lu'>) {
    const id = 'n' + Date.now();
    const date = new Date().toISOString().replace('T', ' ').slice(0, 16);
    this.notifications.update(list => [{ id, date, lu: false, ...n }, ...list]);
  }

  /** Soumission d'un ordre par le client — CSFT §M2-O01..M2-O04.
   *  L'ordre est persisté côté backend (système de référence) ; la provision
   *  est ensuite réservée côté Amplitude pour l'affichage du solde. Renvoie
   *  l'ordre créé, ou `null` en cas d'échec. */
  addOrder(input: { emissionId: string; volume: number; taux: number; compteEspeces: string; compteTitres?: string; signatureData?: string; formSnapshot?: import('../models/models').ClientOrderForm; }): Observable<Order | null> {
    const e = this.getEmission(input.emissionId);
    if (!e) return of(null);
    return this.api
      .createOrder({ emissionId: input.emissionId, volume: input.volume, tauxSoumis: input.taux, signatureData: input.signatureData })
      .pipe(
        map(order => {
          this.orders.update(list => [order, ...list.filter(o => o.id !== order.id)]);
          // Le backend a créé la notification « Ordre soumis » — on la récupère.
          this.refreshNotifications();
          return order;
        }),
        catchError((err) => {
          // Le backend renvoie un motif metier deja assaini (ex. « Un ordre a déjà
          // été soumis pour cette émission sur ce compte. ») — on le remonte tel quel.
          const motif = err?.error?.error?.message || "La soumission de l'ordre a échoué.";
          this.pushNotification({ type: 'ERROR', titre: 'Ordre rejeté', message: motif, canal: ['EMAIL'] });
          return throwError(() => new Error(motif));
        }),
      );
  }

  /** Annulation par le client (CSFT §M2-S01 statut ANNULE).
   *  Mise à jour optimiste locale puis persistance côté backend. */
  cancelOrder(id: string): boolean {
    const o = this.getOrder(id);
    if (!o || o.status !== 'SOUMIS') return false;
    if (o.printedBySvt) return false;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    this.orders.update(list => list.map(x => x.id === id ? { ...x, status: 'ANNULE' as const, updatedAt: now } : x));
    this.api.cancelOrder(id).pipe(catchError(() => of(null))).subscribe(() => {
      this.refreshOrders();
      this.refreshNotifications();
    });
    return true;
  }

  /** Modification d'un ordre SOUMIS par le client, persistée côté backend. */
  updateClientOrder(id: string, patch: { volume?: number; taux?: number; signatureData?: string; formSnapshot?: import('../models/models').ClientOrderForm }): Observable<boolean> {
    const o = this.getOrder(id);
    if (!o || o.printedBySvt || o.status !== 'SOUMIS') return of(false);
    const volume = patch.volume ?? o.volume;
    const taux = patch.taux ?? o.tauxSoumis;
    return this.api.updateOrder(id, { volume, tauxSoumis: taux, signatureData: patch.signatureData }).pipe(
      map(updated => {
        this.orders.update(list => list.map(x => x.id === id ? {
          ...updated,
          formSnapshot: patch.formSnapshot ?? x.formSnapshot,
        } : x));
        this.refreshNotifications();
        return true;
      }),
      catchError(() => of(false)),
    );
  }

  /** L'agent SVT prend en main l'ordre → verrouillage côté client + passage EN_ATTENTE_ADJUDICATION. */
  printAndLockOrder(id: string, agentId: string = 'SUP-005'): boolean {
    const o = this.getOrder(id);
    if (!o || o.printedBySvt) return false;
    if (o.status !== 'SOUMIS' && o.status !== 'EN_VERIFICATION') return false;
    const printedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
    this.orders.update(list => list.map(x => x.id === id ? {
      ...x,
      printedBySvt: true,
      printedAt, printedBy: agentId,
      status: 'EN_ATTENTE_ADJUDICATION' as const,
      updatedAt: printedAt,
    } : x));
    this.pushNotification({ type: 'INFO', titre: "Ordre transmis pour adjudication", message: `Votre ordre ${o.reference} a été soumis au marché primaire. Il n'est plus modifiable.`, canal: ['EMAIL', 'SMS'] });
    this.persistOrderStatus(id, { status: 'EN_ATTENTE_ADJUDICATION' });
    this.logAudit('IMPRESSION_LOCK_ORDRE', o.reference);
    return true;
  }

  /** CSFT §M3-F02 — passage de l'ordre en vérification de provision (statut → EN_VERIFICATION). */
  verifyProvision(id: string): boolean {
    const o = this.getOrder(id);
    if (!o || o.status !== 'SOUMIS') return false;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    this.orders.update(list => list.map(x => x.id === id ? { ...x, status: 'EN_VERIFICATION' as const, updatedAt: now } : x));
    this.persistOrderStatus(id, { status: 'EN_VERIFICATION' });
    this.logAudit('VERIFICATION_PROVISION', o.reference);
    return true;
  }

  /**
   * CSFT §M3-F03 — saisie du résultat d'adjudication.
   *
   * <p>Rend le verdict **du serveur**, pas un succès optimiste. L'ancienne
   * version mettait l'ordre à jour localement, annonçait « Résultat saisi »,
   * puis avalait l'erreur HTTP : un refus du serveur (403, statut incompatible)
   * passait inaperçu, et l'ordre revenait en attente d'adjudication au premier
   * rafraîchissement, sans que personne ne sache pourquoi.</p>
   */
  saisirResultat(id: string, resultat: 'TOTALEMENT_RETENU' | 'PARTIELLEMENT_RETENU' | 'NON_RETENU', input?: { montantPartiel?: number; tauxAdjuge?: number; commentaire?: string }): Observable<boolean> {
    const o = this.getOrder(id);
    if (!o) return of(false);
    if (resultat !== 'TOTALEMENT_RETENU' && !input?.commentaire?.trim()) return of(false);
    const e = this.getEmission(o.emissionId);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const patch: Partial<Order> = { status: resultat, updatedAt: now };
    let volumeAlloue = 0;
    let montantDebite = 0;
    let montantAdjuge = 0;
    if (resultat === 'TOTALEMENT_RETENU') {
      volumeAlloue = o.volume;
      montantDebite = o.montant;
      montantAdjuge = o.montant;
    } else if (resultat === 'PARTIELLEMENT_RETENU') {
      const mnt = Math.max(0, Math.min(o.montant, Math.round(input?.montantPartiel ?? 0)));
      montantDebite = mnt;
      montantAdjuge = mnt;
      volumeAlloue = e ? Math.floor(mnt / e.valeurNominaleUnitaire) : 0;
    }
    patch.volumeAlloue = volumeAlloue;
    patch.montantDebite = montantDebite;
    patch.montantAdjuge = montantAdjuge;
    patch.tauxAdjuge = input?.tauxAdjuge ?? o.tauxSoumis;
    if (input?.commentaire) patch.commentaireResultat = input.commentaire;

    // CSFT §M4 — le livrable (avis d'opéré / avis d'offre non adjugée) est
    // généré et TRANSMIS au backend par le composant BO (doSaisirResultat), afin
    // d'apparaître dans le menu « Documents » du client (persisté, pas un mock).

    // Le serveur décide. On n'écrit localement qu'une fois qu'il a accepté :
    // sinon l'écran afficherait un résultat que la banque n'a pas enregistré.
    return this.api.changeOrderStatus(id, {
      status: resultat,
      montantAdjuge,
      volumeAlloue,
      tauxAdjuge: input?.tauxAdjuge ?? o.tauxSoumis,
      commentaire: input?.commentaire,
    }).pipe(
      map(() => {
        this.orders.update(list => list.map(x => x.id === id ? { ...x, ...patch } : x));
        const mail = buildStatusEmail({ ...o, ...patch } as Order, resultat, o.status,
          input?.commentaire, volumeAlloue, montantDebite);
        this.pushNotification({ type: mail.type, titre: mail.sujet, message: mail.corps,
          canal: ['EMAIL', 'SMS', 'IN_APP'] });
        this.logAudit(`SAISIE_RESULTAT_${resultat}`, o.reference);
        this.refreshOrders();
        this.refreshNotifications();
        this.refreshAudit();
        return true;
      }),
      catchError(() => {
        // Refus du serveur : on réaligne l'écran sur la vérité, et on le dit.
        this.refreshOrders();
        return of(false);
      }),
    );
  }

  /** CSFT §M3 — Validation d'un ordre par l'agent BO, **persistée côté backend**
   *  (`POST /orders/:id/validate`) : SOUMIS/EN_VERIFICATION → EN_ATTENTE_ADJUDICATION.
   *  Le changement de statut et la notification deviennent visibles par le client. */
  validateOrder(id: string): Observable<boolean> {
    return this.api.validateOrder(id).pipe(
      map(updated => {
        this.orders.update(list => list.map(o => o.id === id ? updated : o));
        this.refreshOrders();
        this.refreshNotifications();
        this.refreshAudit();
        return true;
      }),
      catchError(() => of(false)),
    );
  }

  /** CSFT §M3 — Rejet d'un ordre par l'agent BO avec motif obligatoire, **persisté
   *  côté backend** (`POST /orders/:id/reject`) : → ANNULE. Visible par le client. */
  rejectOrder(id: string, motif: string): Observable<boolean> {
    const cleanMotif = (motif ?? '').trim().slice(0, 1000);
    if (!cleanMotif) return of(false);
    return this.api.rejectOrder(id, cleanMotif).pipe(
      map(updated => {
        this.orders.update(list => list.map(o => o.id === id ? updated : o));
        this.refreshOrders();
        this.refreshNotifications();
        this.refreshAudit();
        return true;
      }),
      catchError(() => of(false)),
    );
  }

  /** CSFT §M3 — Validation en masse d'ordres, persistée côté backend. */
  bulkValidateOrders(ids: string[]): Observable<{ ok: number; ko: number }> {
    if (!ids.length) return of({ ok: 0, ko: 0 });
    return forkJoin(
      ids.map(id => this.api.validateOrder(id).pipe(map(() => true), catchError(() => of(false)))),
    ).pipe(
      map(results => {
        this.refreshOrders();
        this.refreshNotifications();
        this.refreshAudit();
        return { ok: results.filter(Boolean).length, ko: results.filter(r => !r).length };
      }),
    );
  }

  /** CSFT §M3 — Rejet en masse avec motif commun, persisté côté backend. */
  bulkRejectOrders(ids: string[], motif: string): Observable<{ ok: number; ko: number }> {
    const cleanMotif = (motif ?? '').trim().slice(0, 1000);
    if (!ids.length || !cleanMotif) return of({ ok: 0, ko: ids.length });
    return forkJoin(
      ids.map(id =>
        this.api.rejectOrder(id, cleanMotif).pipe(map(() => true), catchError(() => of(false)))),
    ).pipe(
      map(results => {
        this.refreshOrders();
        this.refreshNotifications();
        this.refreshAudit();
        return { ok: results.filter(Boolean).length, ko: results.filter(r => !r).length };
      }),
    );
  }

  /** Transmission au marché primaire — équivalent à printAndLockOrder pour usage agent. */
  transmitOrder(id: string) {
    const o = this.getOrder(id);
    if (!o || (o.status !== 'EN_VERIFICATION' && o.status !== 'SOUMIS')) return false;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    this.orders.update(list => list.map(x => x.id === id ? { ...x, status: 'EN_ATTENTE_ADJUDICATION' as const, updatedAt: now } : x));
    this.pushNotification({ type: 'INFO', titre: 'Ordre transmis pour adjudication', message: `Ordre ${o.reference} transmis au marché primaire BEAC.`, canal: ['EMAIL'] });
    this.persistOrderStatus(id, { status: 'EN_ATTENTE_ADJUDICATION' });
    this.logAudit('TRANSMISSION_BEAC', o.reference);
    return true;
  }

  /** Persiste un changement de statut d'ordre côté backend (`POST /orders/:id/status`)
   *  puis resynchronise les ordres — le client voit le nouveau statut. */
  private persistOrderStatus(id: string, body: {
    status: string; motif?: string; montantAdjuge?: number;
    volumeAlloue?: number; tauxAdjuge?: number; commentaire?: string;
  }): void {
    this.api.changeOrderStatus(id, body).pipe(catchError(() => of(null))).subscribe(u => {
      if (u) { this.refreshOrders(); this.refreshNotifications(); this.refreshAudit(); }
    });
  }

  /** Le superviseur valide le résultat d'adjudication proposé par l'agent. */
  validateOrderResult(id: string) {
    this.api.validateOrderResult(id).pipe(catchError(() => of(null))).subscribe(u => {
      if (u) { this.refreshOrders(); this.refreshNotifications(); this.refreshAudit(); }
    });
  }

  /** Le superviseur refuse le résultat proposé — il repart vers l'agent. */
  rejectOrderResult(id: string, motif: string) {
    this.api.rejectOrderResult(id, motif).pipe(catchError(() => of(null))).subscribe(u => {
      if (u) { this.refreshOrders(); this.refreshNotifications(); this.refreshAudit(); }
    });
  }

  /** Enregistre une note interne sur un ordre, **persistée côté backend**. */
  addOrderNote(id: string, note: string) {
    this.orders.update(list => list.map(x => x.id === id ? { ...x, notes: note } : x));
    this.api.setOrderNotes(id, note).pipe(catchError(() => of(null))).subscribe(u => {
      if (u) this.refreshOrders();
    });
  }

  getOrderHistory(orderRef: string) {
    return this.audit().filter(a => a.reference === orderRef);
  }

  /** Valide ou rejette la signature d'un ordre, **persisté côté backend**. */
  verifyOrderSignature(id: string, verified: boolean) {
    const o = this.getOrder(id);
    if (!o) return;
    this.orders.update(list => list.map(x => x.id === id ? { ...x, signatureVerified: verified } : x));
    this.api.verifyOrderSignature(id, verified).pipe(catchError(() => of(null))).subscribe(u => {
      if (u) { this.refreshOrders(); this.refreshNotifications(); this.refreshAudit(); }
    });
  }

  /** Changement direct de statut d'un ordre (superviseur MO) — envoie une notification riche au client. */
  changeOrderStatus(id: string, newStatus: OrderStatus, motif?: string, volumeAlloue?: number, montantDebite?: number): boolean {
    const o = this.getOrder(id);
    if (!o) return false;
    const oldStatus = o.status;
    if (oldStatus === newStatus) return false;

    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const patch: Partial<Order> = { status: newStatus, updatedAt: now };
    if (motif) patch.notes = motif;
    if (newStatus === 'TOTALEMENT_RETENU' || newStatus === 'PARTIELLEMENT_RETENU') {
      patch.volumeAlloue = volumeAlloue ?? o.volume;
      patch.montantDebite = montantDebite ?? (patch.volumeAlloue! * (this.getEmission(o.emissionId)?.valeurNominaleUnitaire ?? 0));
      patch.montantAdjuge = patch.montantDebite;
    } else if (newStatus === 'NON_RETENU' || newStatus === 'ANNULE') {
      patch.volumeAlloue = 0;
      patch.montantDebite = 0;
      patch.montantAdjuge = 0;
    }
    this.orders.update(list => list.map(x => x.id === id ? { ...x, ...patch } : x));

    const mail = buildStatusEmail(o, newStatus, oldStatus, motif, patch.volumeAlloue, patch.montantDebite);
    this.pushNotification({ type: mail.type, titre: mail.sujet, message: mail.corps, canal: ['EMAIL', 'SMS', 'IN_APP'] });
    this.persistOrderStatus(id, {
      status: newStatus,
      motif,
      montantAdjuge: patch.montantAdjuge,
      volumeAlloue: patch.volumeAlloue,
    });
    this.logAudit(`CHANGEMENT_STATUT_${newStatus}`, o.reference);
    return true;
  }

  // ──────────── Émissions — CSFT §M1 ────────────
  /** Construit le corps d'API d'une émission à partir d'un objet `Emission`
   *  partiel (champs dérivés du formulaire marché primaire). */
  private emissionBody(e: Partial<Emission>): CreateEmissionBody {
    return {
      code: e.code ?? '',
      isin: e.isin ?? '',
      libelle: e.libelle ?? '',
      nature: e.nature ?? 'BTA',
      paysCode: e.paysCode ?? 'CMR',
      dateEmission: e.dateEmission ?? '',
      ouvertureSouscription: e.ouvertureSouscription ?? '',
      fermetureSouscription: e.fermetureSouscription ?? '',
      dateEcheance: e.dateEcheance ?? '',
      dateReglement: e.dateReglement ?? '',
      valeurNominaleUnitaire: e.valeurNominaleUnitaire ?? 0,
      montantGlobal: e.montantGlobal ?? 0,
      tauxNominal: e.tauxNominal,
      montantMinimum: e.montantMinimum ?? 0,
      frequenceCoupon: e.frequenceCoupon,
      modeAdjudication: e.modeAdjudication ?? 'TAUX',
      description: e.description,
      observation: e.observation,
    };
  }

  /** Crée une fiche émission côté backend (système de référence) puis recharge
   *  la liste : la nouvelle émission apparaît donc immédiatement. Si `publish`
   *  est vrai, la fiche est aussitôt publiée (BROUILLON → PUBLIE) — ce qui exige
   *  la permission EMISSION_VALIDATE (sinon elle reste en brouillon).
   *  Renvoie l'émission créée/publiée, ou `null` en cas d'échec. */
  createEmission(e: Partial<Emission>, publish = false): Observable<Emission | null> {
    return this.api.createEmission(this.emissionBody(e)).pipe(
      switchMap(created =>
        publish
          ? this.api.publishEmission(created.id).pipe(catchError(() => of(created)))
          : of(created),
      ),
      map(em => {
        // Rechargement immédiat depuis le backend — l'émission apparaît aussitôt.
        this.refreshEmissions();
        this.refreshAudit();
        if (em.status === 'PUBLIE') {
          this.pushNotification({
            type: 'INFO', titre: 'Nouvelle émission publiée',
            message: `${em.code} — ${em.emetteur}. Fenêtre : jusqu'au ${em.fermetureSouscription}.`,
            canal: ['EMAIL', 'SMS', 'WHATSAPP'],
          });
        }
        return em;
      }),
      catchError(() => of(null)),
    );
  }

  /** Modifie une fiche émission côté backend puis recharge la liste. CSFT §M1-F05 :
   *  une fiche publiée modifiée repasse en brouillon (géré côté serveur).
   *  Renvoie l'émission mise à jour, ou `null` en cas d'échec. */
  editEmission(id: string, e: Partial<Emission>): Observable<Emission | null> {
    return this.api.updateEmission(id, this.emissionBody(e)).pipe(
      map(em => {
        this.refreshEmissions();
        this.refreshAudit();
        return em;
      }),
      catchError(() => of(null)),
    );
  }

  /** CSFT §M1-F02 — validation en masse par le superviseur de plusieurs fiches émission. */
  bulkValidateAndPublishEmissions(ids: string[], validatorId: string = 'SUP-005'): { ok: number; ko: number } {
    let ok = 0; let ko = 0;
    for (const id of ids) {
      if (this.validateAndPublishEmission(id, validatorId)) ok++; else ko++;
    }
    return { ok, ko };
  }

  /** CSFT §M1-F02 — rejet en masse par le superviseur avec motif commun. */
  bulkRejectEmissions(ids: string[], motif: string, supervisorId: string = 'SUP-005'): { ok: number; ko: number } {
    let ok = 0; let ko = 0;
    for (const id of ids) {
      if (this.rejectEmissionValidation(id, motif, supervisorId)) ok++; else ko++;
    }
    return { ok, ko };
  }

  /** Persiste une action sur émission côté backend puis resynchronise la liste. */
  private syncEmissionAfter(call: Observable<Emission>): void {
    call.pipe(catchError(() => of(null))).subscribe(u => {
      if (u) { this.refreshEmissions(); this.refreshAudit(); }
    });
  }

  /** CSFT §M1-F02 — validation par le superviseur. Passage BROUILLON → PUBLIE,
   *  persisté côté backend (`POST /emissions/:id/publish`). */
  validateAndPublishEmission(id: string, validatorId: string = 'SUP-005'): boolean {
    const e = this.getEmission(id);
    if (!e || e.status !== 'BROUILLON') return false;
    const dateValidation = new Date().toISOString().replace('T', ' ').slice(0, 16);
    this.emissions.update(list => list.map(x => x.id === id ? { ...x, status: 'PUBLIE' as const, validatedBy: validatorId, dateValidation } : x));
    this.pushNotification({ type: 'INFO', titre: 'Nouvelle émission publiée', message: `${e.code} — ${e.emetteur}. Fenêtre : jusqu'au ${e.fermetureSouscription}.`, canal: ['EMAIL', 'SMS', 'WHATSAPP'] });
    this.syncEmissionAfter(this.api.publishEmission(id));
    this.logAudit('VALIDATION_PUBLICATION_EMISSION', e.code);
    return true;
  }

  /** CSFT §M1-F02 — rejet d'une fiche émission par le superviseur.
   *  Motif obligatoire — stocké sur la fiche pour visibilité agent à la ré-édition.
   *  La fiche reste en BROUILLON ; l'événement est journalisé en ECHEC dans l'audit. */
  rejectEmissionValidation(id: string, motif: string, supervisorId: string = 'SUP-005'): boolean {
    const cleanMotif = (motif ?? '').trim().slice(0, 1000);
    if (!cleanMotif) return false;
    const e = this.getEmission(id);
    if (!e || e.status !== 'BROUILLON') return false;
    const rejectedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
    this.emissions.update(list => list.map(x => x.id === id ? {
      ...x,
      rejectionMotif: cleanMotif,
      rejectedAt,
      rejectedBy: supervisorId,
      validatedBy: undefined,
      dateValidation: undefined,
    } : x));
    this.syncEmissionAfter(this.api.rejectEmission(id, cleanMotif));
    this.logAudit('REFUS_VALIDATION_EMISSION', e.code, 'ECHEC');
    return true;
  }

  /** Publie en une fois toutes les fiches en brouillon (bouton superviseur / admin). */
  publishAllEmissions(): Observable<number> {
    return this.api.publishAllEmissions().pipe(
      tap(r => {
        if (r.published > 0) {
          this.refreshEmissions();
          this.refreshAudit();
          this.logAudit('PUBLICATION_GROUPEE_EMISSIONS', r.published + ' fiche(s)');
        }
      }),
      map(r => r.published),
      catchError(() => of(0)),
    );
  }

  /** CSFT §M1-F06 — duplication d'une fiche émission. */
  duplicateEmission(id: string): Emission | null {
    const e = this.getEmission(id);
    if (!e) return null;
    const id2 = 'em' + Date.now();
    const cloned: Emission = { ...e, id: id2, code: e.code + '-COPY', isin: e.isin + '0', status: 'BROUILLON', validatedBy: undefined, dateValidation: undefined };
    this.emissions.update(list => [cloned, ...list]);
    this.logAudit('DUPLICATION_EMISSION', cloned.code);
    return cloned;
  }

  /** CSFT §M1-F04 — archivage manuel CLOTURE → ARCHIVE, persisté côté backend. */
  archiveEmission(id: string): boolean {
    const e = this.getEmission(id);
    if (!e || e.status !== 'CLOTURE') return false;
    this.emissions.update(list => list.map(x => x.id === id ? { ...x, status: 'ARCHIVE' as const } : x));
    this.syncEmissionAfter(this.api.archiveEmission(id));
    this.logAudit('ARCHIVAGE_EMISSION', e.code);
    return true;
  }

  /** Clôture d'une émission (PUBLIE → CLOTURE), persistée côté backend. */
  closeEmission(id: string): boolean {
    const e = this.getEmission(id);
    if (!e || e.status !== 'PUBLIE') return false;
    this.emissions.update(list => list.map(x => x.id === id ? { ...x, status: 'CLOTURE' as const } : x));
    this.syncEmissionAfter(this.api.closeEmission(id));
    this.logAudit('CLOTURE_EMISSION', e.code);
    return true;
  }

  /** CSFT §M1-F05 — historique des modifications d'une émission (filtré sur le code émission). */
  getEmissionHistory(emissionCode: string) {
    return this.audit().filter(a => a.reference === emissionCode);
  }

  /** Exécution d'adjudication (BO) — simule la séance, applique les résultats et
   *  pousse les débits/libérations vers Amplitude AIF en batch. */
  runAdjudication(emissionId: string) {
    const e = this.getEmission(emissionId);
    if (!e) return;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    // Ordres éligibles à l'adjudication, relevés avant la mise à jour.
    const adjugeIds = this.orders()
      .filter(o => o.emissionId === emissionId &&
        (o.status === 'SOUMIS' || o.status === 'EN_VERIFICATION' || o.status === 'EN_ATTENTE_ADJUDICATION'))
      .map(o => o.id);
    this.orders.update(list => list.map(o => {
      if (o.emissionId !== emissionId) return o;
      if (o.status !== 'SOUMIS' && o.status !== 'EN_VERIFICATION' && o.status !== 'EN_ATTENTE_ADJUDICATION') return o;
      const marginal = e.tauxNominal;
      if (o.tauxSoumis < marginal) return { ...o, status: 'TOTALEMENT_RETENU' as const, volumeAlloue: o.volume, montantDebite: o.montant, montantAdjuge: o.montant, tauxAdjuge: o.tauxSoumis, updatedAt: now };
      if (Math.abs(o.tauxSoumis - marginal) < 0.01) {
        const alloc = Math.floor(o.volume * 0.6);
        const mnt = alloc * e.valeurNominaleUnitaire;
        return { ...o, status: 'PARTIELLEMENT_RETENU' as const, volumeAlloue: alloc, montantDebite: mnt, montantAdjuge: mnt, tauxAdjuge: o.tauxSoumis, updatedAt: now };
      }
      return { ...o, status: 'NON_RETENU' as const, volumeAlloue: 0, montantDebite: 0, montantAdjuge: 0, updatedAt: now };
    }));
    this.emissions.update(list => list.map(x => x.id === emissionId ? { ...x, status: 'CLOTURE' as const } : x));
    // Persistance backend : résultat de chaque ordre adjugé + clôture de l'émission.
    for (const id of adjugeIds) {
      const adj = this.getOrder(id);
      if (adj) this.persistOrderStatus(id, {
        status: adj.status,
        montantAdjuge: adj.montantAdjuge,
        volumeAlloue: adj.volumeAlloue,
        tauxAdjuge: adj.tauxAdjuge,
      });
    }
    this.syncEmissionAfter(this.api.closeEmission(emissionId));
    // Après persistance des résultats, on resynchronise les notifications et documents
    // depuis la base (le backend crée les livrables et notifications pour chaque ordre).
    this.refreshNotifications();
    this.refreshDocuments();
    this.logAudit('ADJUDICATION_EXECUTEE', e.code);
  }

  updateEmission(id: string, patch: Partial<Emission>) {
    const before = this.getEmission(id);
    this.emissions.update(list => list.map(e => e.id === id ? { ...e, ...patch } : e));
    // CSFT §M1-F05 — log par code émission pour que l'historique de la fiche affiche l'événement
    if (before) {
      const action = patch.status === 'BROUILLON' && before.status === 'PUBLIE'
        ? 'MAJ_EMISSION_RETOUR_BROUILLON'
        : 'MAJ_EMISSION';
      this.logAudit(action, before.code);
    }
  }
  deleteEmission(id: string) {
    const e = this.getEmission(id);
    this.emissions.update(list => list.filter(x => x.id !== id));
    this.logAudit('SUPPRESSION_EMISSION', e?.code ?? id);
  }

  /** CSFT §3.2 — Registre des dossiers clients, alimenté depuis la base de
   *  données (tables `client_profiles`, `client_adresses`, `client_contacts`,
   *  `sous_comptes_titres`). Hydraté par `refreshClients()`. */
  clientsRegistry = signal<ClientDossier[]>([]);

  /** Recharge le registre des dossiers clients depuis la base (CLIENT_MANAGE). */
  refreshClients(): void {
    if (!this.isBrowser) return;
    this.api.listClientDossiers().pipe(catchError(() => of(null))).subscribe(list => {
      if (list) this.clientsRegistry.set(list);
    });
  }

  /** Recharge le dossier (compte-titres détaillé) du client connecté depuis la
   *  base, et le rattache à `currentUser().compte`. */
  refreshMyCompte(): void {
    if (!this.isBrowser) return;
    this.api.getMyDossier().pipe(catchError(() => of(null))).subscribe(dossier => {
      if (dossier) this.currentUser.update(u => ({ ...u, compte: dossier.compte }));
    });
  }

  /** Création d'un client par un agent back-office — persistée en base
   *  (compte de connexion + profil + adresse + signataires + sous-comptes).
   *  - PP : 1 signataire, 1 sous-compte. PM : 1 à 4 signataires, ≥ 1 sous-compte.
   *  Renvoie le dossier créé, ou un message d'erreur. */
  createClientDossier(input: {
    type: 'PP' | 'PM';
    raisonSociale: string;
    rccm?: string;
    categorie: import('../models/models').CategorieInvestisseur;
    categorieClient?: import('../models/models').CategorieClient;
    matricule?: string;
    dirigeant?: string;
    assujettiTaxes?: boolean;
    localisation?: string;
    telephone2?: string;
    typeCompte: import('../models/models').TypeCompte;
    adresse: import('../models/models').Adresse;
    signataires: import('../models/models').Contact[];
    sousComptes: Array<Omit<import('../models/models').SousCompteTitres, 'id'>>;
    compteEspecesLie?: string;
    soldeEspecesInitial?: number;
  }): Observable<{ ok: boolean; client?: ClientDossier; error?: string }> {
    // ── Validations métier (CSFT §3.2) avant l'appel serveur ──
    if (!input.raisonSociale?.trim()) return of({ ok: false, error: 'Raison sociale requise.' });
    if (!input.signataires?.length) return of({ ok: false, error: 'Au moins un signataire requis.' });
    if (input.type === 'PP' && input.signataires.length !== 1) {
      return of({ ok: false, error: 'Personne Physique : un seul signataire autorisé.' });
    }
    if (input.type === 'PM' && (input.signataires.length < 1 || input.signataires.length > 4)) {
      return of({ ok: false, error: 'Personne Morale : 1 à 4 signataires.' });
    }
    if (input.type === 'PP' && (input.sousComptes?.length ?? 0) !== 1) {
      return of({ ok: false, error: 'Personne Physique : un seul sous-compte titres.' });
    }
    if (input.type === 'PM' && (input.sousComptes?.length ?? 0) < 1) {
      return of({ ok: false, error: 'Personne Morale : au moins un sous-compte titres.' });
    }
    const numeros = (input.sousComptes ?? []).map(s => s.numero);
    if (new Set(numeros).size !== numeros.length) {
      return of({ ok: false, error: 'Numéros de sous-comptes non uniques.' });
    }

    return this.api.createClient({
      type: input.type,
      raisonSociale: input.raisonSociale.trim().slice(0, 200),
      rccm: input.rccm?.trim().slice(0, 50),
      categorie: input.categorie,
      categorieClient: input.categorieClient,
      matricule: input.matricule,
      dirigeant: input.dirigeant,
      assujettiTaxes: input.assujettiTaxes,
      localisation: input.localisation,
      telephone2: input.telephone2,
      typeCompte: input.typeCompte,
      adresse: input.adresse,
      signataires: input.signataires,
      sousComptes: input.sousComptes,
      compteEspecesLie: input.compteEspecesLie,
      soldeEspecesInitial: input.soldeEspecesInitial,
    }).pipe(
      map(dossier => {
        // Rechargement immédiat — le nouveau client apparaît aussitôt dans le registre.
        this.refreshClients();
        this.refreshAudit();
        return { ok: true, client: dossier };
      }),
      catchError((err) => of({
        ok: false,
        error: 'Création impossible. Vérifiez les informations saisies (e-mail éventuellement déjà utilisé).',
      })),
    );
  }

  /** CSFT §M4-F02 — édite l'attestation de propriété du client connecté.
   *
   *  Le PDF est produit par le serveur à partir des positions en base, puis
   *  persisté : le navigateur n'envoie aucun contenu et ne fabrique aucune
   *  référence. Le livrable retourné est celui réellement enregistré en base. */
  generateAttestation(): Observable<DocumentItem> {
    return this.api.generateAttestation().pipe(
      tap(d => {
        this.documents.update(list => [d, ...list]);
        this.logAudit('GENERATION_LIVRABLE', d.reference);
      }),
    );
  }

  /** CSFT §M2-P04 — journalise le téléchargement d'un document. */
  logDocumentDownload(id: string) {
    this.documents.update(list =>
      list.map(d => d.id === id ? { ...d, telechargements: d.telechargements + 1 } : d));
    const doc = this.documents().find(d => d.id === id);
    if (doc) this.logAudit('TELECHARGEMENT_DOCUMENT', doc.reference);
  }
}
