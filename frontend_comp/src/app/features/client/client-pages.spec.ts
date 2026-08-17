import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, Type } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { of, throwError } from 'rxjs';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';

// `DecimalPipe` formate en fr-FR : la locale est enregistrée par app.config.ts,
// que le TestBed ne charge pas. Sans cela : NG0701 « Missing locale data ».
registerLocaleData(localeFr, 'fr-FR');
import {
  ClientDashboard, EmissionsList, EmissionDetail, OrderForm, OrdersList, OrderDetail,
} from './client-pages';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';
import { AuthService } from '../../core/services/auth-service';
import { PdfProgressService } from '../../core/services/pdf-progress';
import { Emission, Order, Position } from '../../core/models/models';

// ─── Fabriques d'entités ─────────────────────────────────────────────────────

function emission(over: Partial<Emission> = {}): Emission {
  return {
    id: 'em-1', code: 'BTA-CMR-26-01', isin: 'CM0000000001', libelle: 'BTA 26 SEMAINES',
    nature: 'BTA', paysCode: 'CMR', emetteur: 'Cameroun', dateEmission: '2026-01-01',
    fermetureSouscription: '2026-01-10 15:30', dateEcheance: '2026-07-01', dureeJours: 182,
    valeurNominaleUnitaire: 10000, montantGlobal: 5_000_000_000, tauxNominal: 5.8,
    montantMinimum: 100000, modeAdjudication: 'TAUX', status: 'PUBLIE',
    ouvertureSouscription: '2026-01-05 08:00', dateReglement: '2026-01-11', ...over,
  } as Emission;
}

function order(over: Partial<Order> = {}): Order {
  return {
    id: 'or-1', reference: 'ORD-2026-000001', emissionId: 'em-1', emissionCode: 'BTA-CMR-26-01',
    isin: 'CM0000000001', nature: 'BTA', emetteur: 'Cameroun', clientId: 'u1', clientNom: 'John Doe',
    compteEspeces: 'CE1', compteTitres: 'CT1', volume: 10, montant: 100000, tauxSoumis: 5.8,
    status: 'SOUMIS', dateSoumission: '2026-01-06 09:00', ...over,
  } as Order;
}

function position(over: Partial<Position> = {}): Position {
  return {
    isin: 'CM0000000001', emissionCode: 'BTA-CMR-26-01', nature: 'BTA', emetteur: 'Cameroun',
    volume: 10, valeurNominale: 10000, valeurTotale: 100000, dateEcheance: '2026-07-01', ...over,
  } as Position;
}

// ─── Doubles injectés ────────────────────────────────────────────────────────

let data: any, toast: any, auth: any, router: any, pdf: any, route: any;
let emissions: ReturnType<typeof signal<Emission[]>>;
let orders: ReturnType<typeof signal<Order[]>>;
let positions: ReturnType<typeof signal<Position[]>>;
let marcheEmissions: ReturnType<typeof signal<Emission[]>>;

function makeFakes() {
  emissions = signal<Emission[]>([]);
  orders = signal<Order[]>([]);
  positions = signal<Position[]>([]);
  marcheEmissions = signal<Emission[]>([]);

  data = {
    currentUser: signal<any>({
      id: 'u1', nom: 'Doe', prenom: 'John', email: 'j@d.cm',
      compteEspeces: 'CE1', compteTitres: 'CT1', telephone: '690000000', role: 'CLIENT_PP',
    }),
    isAuthenticated: signal(true),
    emissions,
    marcheEmissions,
    orders,
    positions,
    documents: signal<any[]>([]),
    notifications: signal<any[]>([]),
    hasPermission: vi.fn(() => false),
    refreshOrders: vi.fn(),
    refreshPositions: vi.fn(),
    refreshMyCompte: vi.fn(),
    getEmission: vi.fn((id: string) => emissions().find((e) => e.id === id)),
    getOrder: vi.fn((id: string) => orders().find((o) => o.id === id)),
    addOrder: vi.fn(() => of(order())),
    updateClientOrder: vi.fn(() => of(true)),
    cancelOrder: vi.fn(() => true),
    markAllNotificationsRead: vi.fn(),
    markNotificationRead: vi.fn(),
  };
  toast = { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  auth = {
    sendActionOtp: vi.fn(() => of({ challengeId: 'ch-1', expiresIn: 120 })),
    verifyActionOtp: vi.fn(() => of({})),
  };
  router = { navigate: vi.fn() };
  pdf = { start: vi.fn(), set: vi.fn(), done: vi.fn(), fail: vi.fn() };
  route = { snapshot: { params: {} as Record<string, string> } };
}

function configure() {
  makeFakes();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ClientDashboard, EmissionsList, EmissionDetail, OrderForm, OrdersList, OrderDetail],
    providers: [
      { provide: MockData, useValue: data },
      { provide: ToastService, useValue: toast },
      { provide: AuthService, useValue: auth },
      { provide: Router, useValue: router },
      { provide: ActivatedRoute, useValue: route },
      { provide: PdfProgressService, useValue: pdf },
    ],
  });
}

function create<T>(type: Type<T>): T {
  return TestBed.createComponent(type).componentInstance;
}

function render<T>(type: Type<T>) {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  return fixture;
}

/** Force un cycle de détection après mutation d'un champ non-signal (évite NG0100). */
function refresh(fixture: { componentRef: any; detectChanges: () => void }) {
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
}

const txt = (el: Element | null) => (el?.textContent ?? '').trim();

/**
 * Configuration dédiée au RENDU des templates : les composants utilisent
 * `RouterLink`, qui exige la vraie infrastructure de routage (`provideRouter`).
 * On lit les paramètres de route sur le vrai `ActivatedRoute` (snapshot mutable),
 * et on espionne `router.navigate` pour éviter toute navigation réelle.
 * Les tests unitaires « create » conservent, eux, les doubles de `configure()`.
 */
function configureRender() {
  makeFakes();
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ClientDashboard, EmissionsList, EmissionDetail, OrderForm, OrdersList, OrderDetail],
    providers: [
      { provide: MockData, useValue: data },
      { provide: ToastService, useValue: toast },
      { provide: AuthService, useValue: auth },
      { provide: PdfProgressService, useValue: pdf },
      provideRouter([]),
    ],
  });
  router = TestBed.inject(Router);
  route = TestBed.inject(ActivatedRoute);
  vi.spyOn(router, 'navigate').mockResolvedValue(true as any);
  vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true as any);
}

function setParams(p: Record<string, string>) {
  Object.assign(TestBed.inject(ActivatedRoute).snapshot.params, p);
}

/**
 * `OrderForm` projette un `afb-signature-field` : le pavé de signature appelle
 * `canvas.getContext('2d')` et `new ResizeObserver(...)` dans `ngAfterViewInit`.
 * jsdom n'implémente ni l'un ni l'autre. On remplace ces API navigateur —
 * `vi.mock` sur un import relatif est interdit par le système de test Angular.
 */
function stubApisNavigateur() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '',
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    clearRect: vi.fn(), drawImage: vi.fn(), putImageData: vi.fn(),
    getImageData: vi.fn(() => ({}) as ImageData),
  } as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAA');
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = vi.fn();
  });
}

beforeEach(() => {
  stubApisNavigateur();
  configure();
});

// ─── ClientDashboard ─────────────────────────────────────────────────────────

describe('ClientDashboard', () => {
  it('recharge ordres et positions au montage', () => {
    create(ClientDashboard);
    expect(data.refreshOrders).toHaveBeenCalled();
    expect(data.refreshPositions).toHaveBeenCalled();
  });

  it('ne retient que les émissions publiées et limite l’aperçu à 5', () => {
    emissions.set([
      ...Array.from({ length: 6 }, (_, i) => emission({ id: 'p' + i, status: 'PUBLIE' })),
      emission({ id: 'b', status: 'BROUILLON' }),
    ]);
    const c = create(ClientDashboard);
    expect(c.openEmissions()).toBe(6);
    expect(c.ouvertesPreview().length).toBe(5);
  });

  it('compte les ordres en cours et somme le portefeuille', () => {
    orders.set([
      order({ id: 'a', status: 'SOUMIS' }),
      order({ id: 'b', status: 'EN_VERIFICATION' }),
      order({ id: 'c', status: 'EN_ATTENTE_ADJUDICATION' }),
      order({ id: 'd', status: 'TOTALEMENT_RETENU' }),
    ]);
    positions.set([position({ valeurTotale: 100 }), position({ valeurTotale: 250 })]);
    const c = create(ClientDashboard);
    expect(c.pendingOrders()).toBe(3);
    expect(c.totalPortfolio()).toBe(350);
    expect(c.recentOrders().length).toBe(4);
  });

  it('limite l’activité récente à 6 ordres', () => {
    orders.set(Array.from({ length: 8 }, (_, i) => order({ id: 'o' + i })));
    const c = create(ClientDashboard);
    expect(c.recentOrders().length).toBe(6);
  });

  it('expose libellé et classe de badge d’un statut', () => {
    const c = create(ClientDashboard);
    expect(c.statusLabel('SOUMIS')).toBe('Soumis');
    expect(c.badgeClass('ANNULE')).toBe('badge-annule');
  });
});

// ─── EmissionsList ───────────────────────────────────────────────────────────

describe('EmissionsList', () => {
  it('tauxOuPrix : ADJ quand taux nul, sinon taux avec unité selon le mode', () => {
    const c = create(EmissionsList);
    expect(c.tauxOuPrix({ tauxNominal: 0, modeAdjudication: 'TAUX' })).toBe('ADJ');
    expect(c.tauxOuPrix({ tauxNominal: 5.8, modeAdjudication: 'TAUX' })).toBe('5,8 %');
    expect(c.tauxOuPrix({ tauxNominal: 99, modeAdjudication: 'PRIX' })).toBe('99');
  });

  it('filtre par nature, pays et bornes de taux', () => {
    marcheEmissions.set([
      emission({ id: '1', nature: 'BTA', paysCode: 'CMR', tauxNominal: 5 }),
      emission({ id: '2', nature: 'OTA', paysCode: 'GAB', tauxNominal: 7 }),
      emission({ id: '3', nature: 'BTA', paysCode: 'CMR', tauxNominal: 9 }),
    ]);
    const c = create(EmissionsList);
    expect(c.filtered().length).toBe(3);
    c.filterNature.set('BTA');
    expect(c.filtered().map((e) => e.id)).toEqual(['1', '3']);
    c.filterNature.set('');
    c.filterPays.set('GAB');
    expect(c.filtered().map((e) => e.id)).toEqual(['2']);
    c.filterPays.set('');
    c.filterTauxMin.set(6);
    c.filterTauxMax.set(8);
    expect(c.filtered().map((e) => e.id)).toEqual(['2']);
  });

  it('maturité : semaines pour BTA, années pour OTA', () => {
    const c = create(EmissionsList);
    expect(c.maturite({ nature: 'BTA', dureeJours: 14 })).toBe('2 SEMAINES');
    expect(c.maturite({ nature: 'BTA', dureeJours: 7 })).toBe('1 SEMAINE');
    expect(c.maturite({ nature: 'OTA', dureeJours: 365 })).toBe('1 AN');
    expect(c.maturite({ nature: 'OTA', dureeJours: 730 })).toBe('2 ANS');
  });

  it('formatage des dates, heures et émetteur', () => {
    const c = create(EmissionsList);
    expect(c.formatDateFr('2026-01-10 15:30')).toBe('10/01/2026');
    expect(c.formatHeure('2026-01-10 15:30')).toBe('15h30mn');
    expect(c.formatHeure('2026-01-10')).toBe('—');
    expect(c.emetteurUpper('Guinée Équatoriale')).toBe('GUINEE EQUATORIALE');
    expect(c.volumeMillions({ montantGlobal: 5_000_000_000 })).toBe(5000);
  });

  it('formatDateLong et formatDateLongShort produisent les abréviations attendues', () => {
    const c = create(EmissionsList);
    expect(c.formatDateLong('2026-03-05')).toBe('05 MARS 2026');
    expect(c.formatDateLongShort('2026-01-10')).toBe('10 JANV 2026');
  });

  it('rowClick souscrit sur une ligne publiée, navigue vers le détail sinon', () => {
    const c = create(EmissionsList);
    c.rowClick({ id: 'em-1', status: 'PUBLIE' });
    expect(router.navigate).toHaveBeenCalledWith(['/client/orders/new', 'em-1']);
    router.navigate.mockClear();
    c.rowClick({ id: 'em-9', status: 'CLOTURE' });
    expect(router.navigate).toHaveBeenCalledWith(['/emissions', 'em-9']);
  });

  it('souscrire redirige vers le login avec returnUrl si non authentifié', () => {
    data.isAuthenticated.set(false);
    const c = create(EmissionsList);
    c.souscrire('em-1');
    expect(router.navigate).toHaveBeenCalledWith(
      ['/auth/login'], { queryParams: { returnUrl: '/client/orders/new/em-1' } });
  });

  it('semaineDebut/Fin dérivent la plage des émissions publiées', () => {
    marcheEmissions.set([
      emission({ status: 'PUBLIE', ouvertureSouscription: '2026-03-02 08:00', fermetureSouscription: '2026-03-06 15:00' }),
    ]);
    const c = create(EmissionsList);
    expect(c.semaineDebut()).toBe('02 MARS 2026');
    expect(c.semaineFin()).toBe('06 MARS 2026');
  });
});

// ─── EmissionDetail ──────────────────────────────────────────────────────────

describe('EmissionDetail', () => {
  it('résout l’émission depuis le paramètre de route', () => {
    emissions.set([emission({ id: 'em-1' })]);
    route.snapshot.params = { id: 'em-1' };
    const c = create(EmissionDetail);
    expect(c.emission()?.id).toBe('em-1');
  });

  it('maturité, dateLimite, heure, taux et volume', () => {
    const c = create(EmissionDetail);
    expect(c.maturite({ nature: 'BTA', dureeJours: 14 })).toBe('2 semaines');
    expect(c.maturite({ nature: 'OTA', dureeJours: 365 })).toBe('1 an');
    expect(c.dateLimite({ fermetureSouscription: '2026-01-10 15:30' })).toBe('2026-01-10');
    expect(c.heure({ fermetureSouscription: '2026-01-10 15:30' })).toBe('15h30mn');
    expect(c.heure({ fermetureSouscription: '2026-01-10' })).toBe('—');
    expect(c.tauxPrix({ tauxNominal: 0 })).toBe('ADJ');
    expect(c.tauxPrix({ tauxNominal: 5.8 })).toBe('5,8 %');
    expect(c.formatDateFr('2026-01-10')).toBe('10/01/2026');
    expect(c.emetteurUpper('cameroun')).toBe('CAMEROUN');
  });
});

// ─── OrderForm ───────────────────────────────────────────────────────────────

describe('OrderForm', () => {
  function withEmission(over: Partial<Emission> = {}) {
    emissions.set([emission(over)]);
    route.snapshot.params = { emissionId: 'em-1' };
  }

  it('totalMontant et minOk reflètent volumes × nominal', () => {
    withEmission({ valeurNominaleUnitaire: 10000, montantMinimum: 100000 });
    const c = create(OrderForm);
    // lignes par défaut : volume 10 → 100 000
    expect(c.totalMontant()).toBe(100000);
    expect(c.minOk()).toBe(true);
    expect(c.totalAvecFrais()).toBe(100000 + 100);
  });

  it('canSubmit exige montant, minimum, signature et acceptation', () => {
    withEmission();
    const c = create(OrderForm);
    expect(c.canSubmit()).toBe(false);
    c.form.signatureData = 'sig';
    c.form.accepte = true;
    expect(c.canSubmit()).toBe(true);
  });

  it('askSubmit signale une émission introuvable', () => {
    route.snapshot.params = { emissionId: 'zzz' };
    const c = create(OrderForm);
    c.askSubmit();
    expect(toast.error).toHaveBeenCalledWith('Émission introuvable', expect.any(String));
  });

  it('askSubmit exige un volume', () => {
    withEmission();
    const c = create(OrderForm);
    c.lignes = [{ volume: 0, taux: 0 }];
    c.recalc();
    c.askSubmit();
    expect(toast.error).toHaveBeenCalledWith('Volume requis', expect.any(String));
  });

  it('askSubmit exige le montant minimum', () => {
    withEmission({ montantMinimum: 10_000_000 });
    const c = create(OrderForm);
    c.askSubmit();
    expect(toast.error).toHaveBeenCalledWith('Montant insuffisant', expect.any(String));
  });

  it('askSubmit exige une signature puis l’acceptation', () => {
    withEmission();
    const c = create(OrderForm);
    c.askSubmit();
    expect(toast.error).toHaveBeenCalledWith('Signature requise', expect.any(String));
    toast.error.mockClear();
    c.form.signatureData = 'sig';
    c.askSubmit();
    expect(toast.error).toHaveBeenCalledWith('Mentions à accepter', expect.any(String));
  });

  it('askSubmit demande confirmation quand un ordre actif existe déjà', () => {
    withEmission();
    orders.set([order({ id: 'x', emissionId: 'em-1', status: 'SOUMIS' })]);
    const c = create(OrderForm);
    c.form.signatureData = 'sig';
    c.form.accepte = true;
    c.askSubmit();
    expect(c.confirmExistingOpen()).toBe(true);
    expect(c.existingActiveOrders().length).toBe(1);
    expect(auth.sendActionOtp).not.toHaveBeenCalled();
  });

  it('askSubmit envoie l’OTP quand tout est valide', () => {
    withEmission();
    const c = create(OrderForm);
    c.form.signatureData = 'sig';
    c.form.accepte = true;
    c.askSubmit();
    expect(auth.sendActionOtp).toHaveBeenCalled();
    expect(c.otpOpen()).toBe(true);
    expect(c.otpChallengeId).toBe('ch-1');
  });

  it('onConfirmExisting ferme la confirmation et envoie l’OTP', () => {
    withEmission();
    const c = create(OrderForm);
    c.confirmExistingOpen.set(true);
    c.onConfirmExisting();
    expect(c.confirmExistingOpen()).toBe(false);
    expect(auth.sendActionOtp).toHaveBeenCalled();
  });

  it('sendOtp gère l’échec d’envoi', () => {
    withEmission();
    auth.sendActionOtp.mockReturnValueOnce(throwError(() => new Error('net')));
    const c = create(OrderForm);
    c.sendOtp();
    expect(toast.error).toHaveBeenCalledWith('Envoi OTP impossible', expect.any(String));
    expect(c.otpOpen()).toBe(false);
  });

  it('sendOtp est ignoré pendant un envoi en cours', () => {
    withEmission();
    const c = create(OrderForm);
    c.otpSending.set(true);
    c.sendOtp();
    expect(auth.sendActionOtp).not.toHaveBeenCalled();
  });

  it('onOtpConfirmed soumet à la validation du code, signale sinon', () => {
    withEmission();
    const c = create(OrderForm);
    const submit = vi.spyOn(c, 'submit').mockImplementation(() => {});
    c.onOtpConfirmed('123456');
    expect(submit).toHaveBeenCalled();
    auth.verifyActionOtp.mockReturnValueOnce(throwError(() => new Error('bad')));
    c.onOtpConfirmed('000000');
    expect(toast.error).toHaveBeenCalledWith('Code incorrect', expect.any(String));
  });

  it('confirmExistingMessage mentionne le nombre d’ordres et le titre', () => {
    withEmission({ code: 'BTA-X' });
    orders.set([
      order({ id: 'a', emissionId: 'em-1', status: 'SOUMIS' }),
      order({ id: 'b', emissionId: 'em-1', status: 'EN_VERIFICATION' }),
    ]);
    const c = create(OrderForm);
    const msg = c.confirmExistingMessage();
    expect(msg).toContain('2 ordres');
    expect(msg).toContain('BTA-X');
  });

  it('addLigne, addCompte et removeCompte modifient les collections', () => {
    withEmission();
    const c = create(OrderForm);
    const n = c.lignes.length;
    c.addLigne();
    expect(c.lignes.length).toBe(n + 1);
    c.addCompte();
    expect(c.comptesSecondaires.length).toBe(1);
    c.removeCompte(0);
    expect(c.comptesSecondaires.length).toBe(0);
  });

  it('enLettres convertit les montants en toutes lettres', () => {
    withEmission();
    const c = create(OrderForm);
    expect(c.enLettres(0)).toBe('');
    expect(c.enLettres(100000)).toBe('cent mille francs CFA');
    expect(c.enLettres(80)).toBe('quatre-vingts francs CFA');
    expect(c.enLettres(1_000_000)).toContain('un million');
  });

  it('buildSnapshot agrège lignes, total et comptes additionnels non vides', () => {
    withEmission({ valeurNominaleUnitaire: 10000 });
    const c = create(OrderForm);
    c.lignes = [{ volume: 3, taux: 5 }, { volume: 0, taux: 0 }];
    c.comptesSecondaires = ['  ', 'CE2'];
    const snap = c.buildSnapshot(10000);
    expect(snap.totalMontant).toBe(30000);
    expect(snap.lignes[0].montant).toBe(30000);
    expect(snap.comptesAdditionnels).toEqual(['CE2']);
  });

  it('submit crée l’ordre puis ouvre le contrôle facial (qui ne peut plus le bloquer)', () => {
    withEmission();
    data.addOrder.mockReturnValueOnce(of(order({ id: 'or-9', reference: 'ORD-9', montant: 100000 })));
    const c = create(OrderForm);
    c.submit();

    expect(data.addOrder).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Ordre soumis', expect.any(String));
    // L'ordre EST soumis : on demande ensuite la photo de contrôle.
    expect(c.faceCheckOpen()).toBe(true);
    expect(c.orderSoumisId()).toBe('or-9');
    // La navigation n'a lieu qu'après le contrôle (ou son abandon).
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('passer le contrôle facial laisse l’ordre soumis et navigue vers son détail', () => {
    withEmission();
    data.addOrder.mockReturnValueOnce(of(order({ id: 'or-9', reference: 'ORD-9', montant: 100000 })));
    const c = create(OrderForm);
    c.submit();

    c.passerControle();

    expect(c.faceCheckOpen()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/client/orders', 'or-9']);
  });

  it('submit remonte le motif de rejet du backend', () => {
    withEmission();
    data.addOrder.mockReturnValueOnce(throwError(() => new Error('Déjà soumis')));
    const c = create(OrderForm);
    c.submit();
    expect(toast.error).toHaveBeenCalledWith('Ordre rejeté', 'Déjà soumis');
  });

  it('submit d’un ordre en édition enregistre les modifications', () => {
    emissions.set([emission({ id: 'em-1' })]);
    orders.set([order({ id: 'or-1', emissionId: 'em-1', status: 'SOUMIS', printedBySvt: false })]);
    route.snapshot.params = { id: 'or-1' };
    const c = create(OrderForm);
    expect(c.editingOrderId()).toBe('or-1');
    c.submit();
    expect(data.updateClientOrder).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Ordre modifié', expect.any(String));
    expect(router.navigate).toHaveBeenCalledWith(['/client/orders', 'or-1']);
  });

  it('submit d’une modification refusée affiche une erreur', () => {
    emissions.set([emission({ id: 'em-1' })]);
    orders.set([order({ id: 'or-1', emissionId: 'em-1', status: 'SOUMIS' })]);
    route.snapshot.params = { id: 'or-1' };
    data.updateClientOrder.mockReturnValueOnce(of(false));
    const c = create(OrderForm);
    c.submit();
    expect(toast.error).toHaveBeenCalledWith('Modification refusée', expect.any(String));
  });

  it('un ordre non modifiable redirige vers son détail', async () => {
    orders.set([order({ id: 'or-5', status: 'TOTALEMENT_RETENU' })]);
    route.snapshot.params = { id: 'or-5' };
    const c = create(OrderForm);
    expect(c.editingOrderId()).toBeNull();
    await Promise.resolve();
    expect(router.navigate).toHaveBeenCalledWith(['/client/orders', 'or-5']);
  });
});

// ─── OrdersList ──────────────────────────────────────────────────────────────

describe('OrdersList', () => {
  it('recharge les ordres au montage', () => {
    create(OrdersList);
    expect(data.refreshOrders).toHaveBeenCalled();
  });

  it('filtre les ordres par statut', () => {
    orders.set([
      order({ id: 'a', status: 'SOUMIS' }),
      order({ id: 'b', status: 'ANNULE' }),
    ]);
    const c = create(OrdersList);
    expect(c.filtered().length).toBe(2);
    c.filterStatus.set('ANNULE');
    expect(c.filtered().map((o) => o.id)).toEqual(['b']);
  });

  it('expose libellé et classe de badge', () => {
    const c = create(OrdersList);
    expect(c.label('NON_RETENU')).toBe('Non retenu');
    expect(c.badgeClass('NON_RETENU')).toBe('badge-nonretenu');
  });
});

// ─── OrderDetail ─────────────────────────────────────────────────────────────

describe('OrderDetail', () => {
  function withOrder(over: Partial<Order> = {}) {
    orders.set([order(over)]);
    route.snapshot.params = { id: over.id ?? 'or-1' };
  }

  it('reached suit la progression du workflow', () => {
    withOrder({ status: 'EN_VERIFICATION' });
    const c = create(OrderDetail);
    expect(c.reached('SOUMIS')).toBe(true);
    expect(c.reached('EN_ATTENTE_ADJUDICATION')).toBe(false);
  });

  it('reached considère TOTALEMENT_RETENU atteint pour un résultat partiel/non retenu', () => {
    withOrder({ status: 'PARTIELLEMENT_RETENU' });
    const c = create(OrderDetail);
    expect(c.reached('TOTALEMENT_RETENU')).toBe(true);
  });

  it('canModify uniquement pour un ordre soumis non verrouillé', () => {
    const c = create(OrderDetail);
    expect(c.canModify({ status: 'SOUMIS' })).toBe(true);
    expect(c.canModify({ status: 'SOUMIS', printedBySvt: true })).toBe(false);
    expect(c.canModify({ status: 'EN_VERIFICATION' })).toBe(false);
  });

  it('askCancel envoie un OTP et ouvre le dialogue', () => {
    withOrder();
    const c = create(OrderDetail);
    c.askCancel();
    expect(auth.sendActionOtp).toHaveBeenCalled();
    expect(c.otpOpen()).toBe(true);
  });

  it('askCancel signale un échec d’envoi', () => {
    withOrder();
    auth.sendActionOtp.mockReturnValueOnce(throwError(() => new Error('net')));
    const c = create(OrderDetail);
    c.askCancel();
    expect(toast.error).toHaveBeenCalledWith('Envoi OTP impossible', expect.any(String));
  });

  it('otpConfirmed annule l’ordre après validation du code', () => {
    withOrder();
    const c = create(OrderDetail);
    c.otpConfirmed('123456');
    expect(data.cancelOrder).toHaveBeenCalledWith('or-1');
    expect(toast.info).toHaveBeenCalledWith('Ordre annulé', expect.any(String));
  });

  it('otpConfirmed signale un code invalide', () => {
    withOrder();
    auth.verifyActionOtp.mockReturnValueOnce(throwError(() => new Error('bad')));
    const c = create(OrderDetail);
    c.otpConfirmed('000000');
    expect(toast.error).toHaveBeenCalledWith('Code incorrect', expect.any(String));
  });

  it('otpConfirmed sans ordre ferme simplement le dialogue', () => {
    route.snapshot.params = { id: 'absent' };
    const c = create(OrderDetail);
    c.otpOpen.set(true);
    c.otpConfirmed('123456');
    expect(c.otpOpen()).toBe(false);
    expect(auth.verifyActionOtp).not.toHaveBeenCalled();
  });

  it('print appelle window.print', () => {
    const c = create(OrderDetail);
    const spy = vi.fn();
    (window as any).print = spy;
    c.print();
    expect(spy).toHaveBeenCalled();
  });

  it('downloadOrder ne fait rien sans ordre', async () => {
    route.snapshot.params = { id: 'absent' };
    const c = create(OrderDetail);
    await c.downloadOrder();
    expect(pdf.start).not.toHaveBeenCalled();
  });

  it('label et badgeClass', () => {
    const c = create(OrderDetail);
    expect(c.label('SOUMIS')).toBe('Soumis');
    expect(c.badgeClass('SOUMIS')).toBe('badge-soumis');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Tests de RENDU — pilotent les branches des templates inline (couverture)
// ═══════════════════════════════════════════════════════════════════════════

describe('ClientDashboard (rendu)', () => {
  it('affiche l’aperçu des émissions publiées, l’activité récente et les KPI', () => {
    configureRender();
    emissions.set([
      emission({ id: 'p1', nature: 'BTA', status: 'PUBLIE', libelle: 'BTA 26 SEM' }),
      emission({ id: 'p2', nature: 'OTA', status: 'PUBLIE', libelle: 'OTA 3 ANS' }),
      emission({ id: 'br', status: 'BROUILLON' }),
    ]);
    orders.set([
      order({ id: 'o1', status: 'SOUMIS' }),
      order({ id: 'o2', status: 'TOTALEMENT_RETENU' }),
    ]);
    positions.set([position({ valeurTotale: 100 }), position({ valeurTotale: 250 })]);

    const f = render(ClientDashboard);
    const el = f.nativeElement as HTMLElement;

    // Salutation avec prénom
    expect(el.querySelector('h1')?.textContent).toContain('John');

    // Aperçu : 2 émissions publiées → 2 liens « Souscrire »
    const souscrire = [...el.querySelectorAll('a')].filter((a) => txt(a) === 'Souscrire');
    expect(souscrire.length).toBe(2);
    expect(el.textContent).toContain('BTA 26 SEM');
    expect(el.textContent).toContain('OTA 3 ANS');

    // Badges nature : BTA bleu, OTA violet
    const natureBadges = [...el.querySelectorAll('.divide-y .badge')]
      .filter((b) => ['BTA', 'OTA'].includes(txt(b)));
    expect(natureBadges.some((b) => b.classList.contains('bg-blue-100'))).toBe(true);
    expect(natureBadges.some((b) => b.classList.contains('bg-purple-100'))).toBe(true);

    // Activité récente : 2 ordres
    const recent = el.querySelectorAll('.p-1 a.block');
    expect(recent.length).toBe(2);

    // KPI : 2 lignes actives, 1 ordre en cours (SOUMIS), 2 émissions publiées
    const kpis = el.querySelectorAll('.kpi-value');
    expect(txt(kpis[1])).toBe('1'); // pendingOrders
    expect(txt(kpis[2])).toBe('2'); // openEmissions
    expect(el.textContent).toContain('2 ligne(s) active(s)');
  });
});

describe('EmissionsList (rendu)', () => {
  it('rend le tableau du marché primaire avec émetteur en majuscules et « ADJ »', () => {
    configureRender();
    marcheEmissions.set([
      emission({ id: 'e1', nature: 'BTA', emetteur: 'Cameroun', tauxNominal: 5.8, status: 'PUBLIE' }),
      emission({ id: 'e2', nature: 'OTA', emetteur: 'Gabon', tauxNominal: 0, status: 'PUBLIE', ouvertureSouscription: '2026-03-02 08:00', fermetureSouscription: '2026-03-06 15:00' }),
    ]);
    const f = render(EmissionsList);
    const el = f.nativeElement as HTMLElement;

    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(el.textContent).toContain('CAMEROUN');
    expect(el.textContent).toContain('GABON');
    // taux 0 → « ADJ », taux 5.8 → « 5,8 % »
    expect(el.textContent).toContain('ADJ');
    expect(el.textContent).toContain('5,8 %');
    // Bandeau titre semaine
    expect(el.querySelector('.mp-title-bar')?.textContent).toContain('MARCHE PRIMAIRE SEMAINE DU');
  });

  it('affiche l’état vide quand aucun titre ne correspond aux filtres', () => {
    configureRender();
    marcheEmissions.set([emission({ id: 'e1', nature: 'BTA', status: 'PUBLIE' })]);
    const f = render(EmissionsList);
    f.componentInstance.filterNature.set('OTA');
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Aucune émission ne correspond aux filtres');
    expect(f.nativeElement.querySelectorAll('tbody tr').length).toBe(1); // ligne « aucun résultat »
  });

  it('bascule sur les logos/bannière de repli lorsque les images échouent', () => {
    configureRender();
    marcheEmissions.set([emission({ status: 'PUBLIE' })]);
    const f = render(EmissionsList);
    const c = f.componentInstance;
    c.bannerOk = false;
    c.logoOk = false;
    c.footerLogoOk = false;
    refresh(f);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('MARCHÉ PRIMAIRE DES VALEURS DU TRÉSOR');
    const fallbacks = el.querySelectorAll('.fallback');
    expect(fallbacks.length).toBeGreaterThanOrEqual(2); // logo entête + pied
  });
});

describe('EmissionDetail (rendu)', () => {
  it('affiche le détail et le bouton de souscription pour une émission publiée', () => {
    configureRender();
    emissions.set([emission({ id: 'em-1', emetteur: 'Cameroun', status: 'PUBLIE', tauxNominal: 5.8 })]);
    setParams({ id: 'em-1' });
    const f = render(EmissionDetail);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('CAMEROUN');
    expect(el.textContent).toContain('5,8 %');
    const btn = [...el.querySelectorAll('a')].find((a) => txt(a) === 'Souscrire à cette émission');
    expect(btn).toBeTruthy();
  });

  it('masque le bouton de souscription pour une émission non publiée', () => {
    configureRender();
    emissions.set([emission({ id: 'em-2', status: 'CLOTURE' })]);
    setParams({ id: 'em-2' });
    const f = render(EmissionDetail);
    const el = f.nativeElement as HTMLElement;
    const btn = [...el.querySelectorAll('a')].find((a) => txt(a) === 'Souscrire à cette émission');
    expect(btn).toBeUndefined();
    expect(el.textContent).toContain('CLOTURE');
  });

  it('n’affiche rien quand l’émission est introuvable', () => {
    configureRender();
    setParams({ id: 'absent' });
    const f = render(EmissionDetail);
    expect(f.nativeElement.querySelector('.card')).toBeNull();
  });
});

describe('OrderForm (rendu)', () => {
  it('rend le bon de souscription : lignes, ISIN en lecture seule et total', () => {
    configureRender();
    emissions.set([emission({ id: 'em-1', isin: 'CM0000000001', valeurNominaleUnitaire: 10000 })]);
    setParams({ emissionId: 'em-1' });
    const f = render(OrderForm);
    const el = f.nativeElement as HTMLElement;

    // ISIN pré-rempli en lecture seule
    const isin = [...el.querySelectorAll('input')].find((i) => (i as HTMLInputElement).value === 'CM0000000001');
    expect(isin).toBeTruthy();

    // 2 lignes par défaut dans le corps du tableau d'ordre
    const rows = el.querySelectorAll('table tbody tr');
    expect(rows.length).toBe(2);

    // Total = 10 × 10 000 = 100 000 (format fr-FR : espace insécable)
    expect(el.textContent).toMatch(/100\s?000/);

    // Ajout d'une ligne → 3 lignes
    f.componentInstance.addLigne();
    refresh(f);
    expect(el.querySelectorAll('table tbody tr').length).toBe(3);
  });

  it('affiche un compte additionnel après « Ajouter un compte espèces »', () => {
    configureRender();
    emissions.set([emission({ id: 'em-1' })]);
    setParams({ emissionId: 'em-1' });
    const f = render(OrderForm);
    f.componentInstance.addCompte();
    refresh(f);
    const extra = [...f.nativeElement.querySelectorAll('input')]
      .find((i: any) => i.placeholder === '037 XXXXX XXXXXXXXXXX');
    expect(extra).toBeTruthy();
  });

  it('affiche « KO » sur le contrôle du montant minimum quand le total est insuffisant', () => {
    configureRender();
    emissions.set([emission({ id: 'em-1', valeurNominaleUnitaire: 10000, montantMinimum: 10_000_000 })]);
    setParams({ emissionId: 'em-1' });
    const f = render(OrderForm);
    expect(f.nativeElement.textContent).toContain('KO');
  });
});

describe('OrdersList (rendu)', () => {
  it('rend une ligne par ordre avec le libellé de statut', () => {
    configureRender();
    orders.set([
      order({ id: 'a', reference: 'ORD-A', status: 'SOUMIS' }),
      order({ id: 'b', reference: 'ORD-B', status: 'ANNULE' }),
      order({ id: 'c', reference: 'ORD-C', status: 'TOTALEMENT_RETENU' }),
    ]);
    const f = render(OrdersList);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('tbody tr').length).toBe(3);
    expect(el.textContent).toContain('Soumis');
    expect(el.textContent).toContain('Annulé');
    expect(el.textContent).toContain('Totalement retenu');
  });

  it('filtre les lignes affichées selon le statut sélectionné', () => {
    configureRender();
    orders.set([
      order({ id: 'a', status: 'SOUMIS' }),
      order({ id: 'b', status: 'ANNULE' }),
    ]);
    const f = render(OrdersList);
    f.componentInstance.filterStatus.set('ANNULE');
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
  });
});

describe('OrderDetail (rendu)', () => {
  it('affiche le fil du workflow, la validation agent et l’état « en cours de traitement »', () => {
    configureRender();
    orders.set([order({
      id: 'or-1', status: 'EN_ATTENTE_ADJUDICATION',
      validatedByAgent: 'ag-1', validatedByAgentNom: 'Agent X', dateValidationAgent: '2026-01-07',
    })]);
    setParams({ id: 'or-1' });
    const f = render(OrderDetail);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Ordre ORD-2026-000001');
    expect(el.textContent).toContain('Validé et transmis pour adjudication');
    expect(el.textContent).toContain('Agent X');
    expect(el.textContent).toContain('validé et en cours de traitement');
    // Étapes atteintes (cercles verts)
    expect(el.querySelectorAll('.bg-emerald-600').length).toBeGreaterThan(0);
  });

  it('affiche le résultat d’adjudication, le commentaire agent et le renvoi vers les documents', () => {
    configureRender();
    orders.set([order({
      id: 'or-2', status: 'TOTALEMENT_RETENU',
      commentaireResultat: 'Bien reçu', volumeAlloue: 10, tauxAdjuge: 5.7, montantDebite: 100000,
    })]);
    setParams({ id: 'or-2' });
    const f = render(OrderDetail);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Résultat d\'adjudication');
    expect(el.textContent).toContain('Bien reçu');
    expect(el.textContent).toContain('Documents');
  });

  it('affiche le bloc de rejet avec motif pour un ordre annulé', () => {
    configureRender();
    orders.set([order({ id: 'or-3', status: 'ANNULE', motifAnnulation: 'Provision insuffisante' })]);
    setParams({ id: 'or-3' });
    const f = render(OrderDetail);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('rejeté par le back-office');
    expect(el.textContent).toContain('Provision insuffisante');
    expect(el.textContent).toContain('Ordre annulé / rejeté');
  });

  it('verrouille l’ordre pris en charge par le SVT et masque les actions', () => {
    configureRender();
    orders.set([order({ id: 'or-4', status: 'SOUMIS', printedBySvt: true, printedAt: '2026-01-08' })]);
    setParams({ id: 'or-4' });
    const f = render(OrderDetail);
    const el = f.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Ordre verrouillé');
    // canModify=false → pas de bouton d'annulation
    const cancel = [...el.querySelectorAll('button')].find((b) => txt(b) === '🗑 Annuler l\'ordre');
    expect(cancel).toBeUndefined();
  });

  it('propose modifier/annuler pour un ordre soumis non verrouillé', () => {
    configureRender();
    orders.set([order({ id: 'or-5', status: 'SOUMIS' })]);
    setParams({ id: 'or-5' });
    const f = render(OrderDetail);
    const el = f.nativeElement as HTMLElement;
    const modify = [...el.querySelectorAll('a')].find((a) => txt(a).includes('Modifier l\'ordre'));
    const cancel = [...el.querySelectorAll('button')].find((b) => txt(b).includes('Annuler l\'ordre'));
    expect(modify).toBeTruthy();
    expect(cancel).toBeTruthy();
  });
});
