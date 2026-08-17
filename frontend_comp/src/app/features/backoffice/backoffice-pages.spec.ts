import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { of, throwError } from 'rxjs';

import { BoDashboard, BoEmissions, BoOrders, BoClients, BoAudit } from './backoffice-pages';
import { MockData } from '../../core/services/mock-data';
import { ApiService } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';
import { PdfProgressService } from '../../core/services/pdf-progress';

// Les gabarits inline utilisent `number:'1.0-0':'fr-FR'` : sans les données de
// locale, le rendu lève NG0701. On les enregistre une fois pour tout le fichier.
registerLocaleData(localeFr, 'fr-FR');

/** Force un cycle de détection après mutation d'un champ ordinaire (zoneless). */
function flush(fixture: ComponentFixture<unknown>) {
  fixture.componentRef.changeDetectorRef.markForCheck();
  fixture.detectChanges();
}

// Le système unit-test d'Angular interdit `vi.mock` sur les imports relatifs, mais
// autorise les modules node : on neutralise le moteur PDF (jsPDF + html2canvas)
// pour que `download.ts` s'exécute sans rasteriser réellement (impossible en jsdom).
const fakeCanvas = { width: 794, height: 1000, toDataURL: () => 'data:image/jpeg;base64,AAAA' };
vi.mock('html2canvas', () => ({ default: vi.fn(async () => fakeCanvas) }));
vi.mock('jspdf', () => ({
  default: class {
    internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } };
    addImage() {}
    addPage() {}
    save() {}
    output() { return 'data:application/pdf;base64,AAAA'; }
  },
}));
import html2canvas from 'html2canvas';
const h2c = html2canvas as unknown as Mock;

/** Noms de fichiers déclenchés en téléchargement (via `<a download>.click()`). */
let downloadClicks: string[] = [];

// ─────────────────────────── Fabriques de données ───────────────────────────

let orderSeq = 0;
function makeOrder(over: Partial<any> = {}): any {
  orderSeq++;
  return {
    id: 'o-' + orderSeq,
    reference: 'ORD-' + orderSeq,
    clientNom: 'ACME SA',
    clientId: 'CLI-1',
    emissionId: 'e-1',
    emissionCode: 'CM1300001268 BTA 52',
    isin: 'CM1300001268',
    nature: 'BTA',
    emetteur: 'Cameroun',
    status: 'SOUMIS',
    montant: 1_000_000,
    volume: 10,
    tauxSoumis: 5.8,
    canal: 'EN_LIGNE',
    dateSoumission: '2026-06-15 09:00',
    compteEspeces: '00012345',
    compteTitres: 'CT-001',
    notes: '',
    ...over,
  };
}

let emSeq = 0;
function makeEmission(over: Partial<any> = {}): any {
  emSeq++;
  return {
    id: 'e-' + emSeq,
    code: 'CM1300001268 BTA 52 ' + emSeq,
    isin: 'CM1300001268',
    libelle: 'CM1300001268 BTA 52 SEM',
    nature: 'BTA',
    paysCode: 'CMR',
    emetteur: 'Cameroun',
    status: 'BROUILLON',
    montantGlobal: 20_000_000_000,
    montantMinimum: 1_000_000,
    valeurNominaleUnitaire: 1_000_000,
    tauxNominal: 5.8,
    dateEmission: '2026-05-01',
    dateEcheance: '2027-05-19',
    dateReglement: '2026-05-01',
    ouvertureSouscription: '2026-05-05T08:00',
    fermetureSouscription: '2026-05-12T09:00',
    dureeJours: 364,
    modeAdjudication: 'TAUX',
    observation: 'NOUVELLE EMISSION',
    ...over,
  };
}

function makeClient(over: Partial<any> = {}): any {
  return {
    id: 'CLI-1',
    type: 'PP',
    raisonSociale: 'Jean Dupont',
    rccm: '',
    createdBy: 'agent1',
    createdByNom: 'Agent Un',
    createdAt: '2026-01-01',
    email: 'jean@d.cm',
    compte: {
      id: 'CLI-1',
      numero: 'CT-100',
      categorie: 'NON_QUALIFIE',
      statut: 'ACTIF',
      typeCompte: 'INDIVIDUEL',
      compteEspecesLie: '00012345',
      sousComptes: [],
      contacts: [{ id: 'c1', type: 'TITULAIRE', nom: 'Dupont', prenom: 'Jean', telephonePortable: '699', email: 'jean@d.cm' }],
      adresses: [{ type: 'DOMICILE', rue: 'Rue 1', ville: 'Yaoundé', pays: 'Cameroun', codePostal: 'BP1' }],
    },
    ...over,
  };
}

function makeAudit(over: Partial<any> = {}): any {
  return {
    id: 'a-1',
    horodatage: '2026-06-15 10:00',
    utilisateur: 'agent1',
    utilisateurNom: 'Agent Un',
    utilisateurRole: 'AGENT',
    action: 'VALIDATION_ORDRE',
    reference: 'ORD-1',
    ip: '10.0.0.1',
    resultat: 'SUCCES',
    ...over,
  };
}

// ───────────────────────── Doubles de services ─────────────────────────────

function makeMockData(opts: { permissions?: string[]; orders?: any[]; emissions?: any[]; clients?: any[]; audit?: any[] } = {}) {
  const orders = signal<any[]>(opts.orders ?? []);
  const emissions = signal<any[]>(opts.emissions ?? []);
  const clientsRegistry = signal<any[]>(opts.clients ?? []);
  const audit = signal<any[]>(opts.audit ?? []);
  const marcheConfig = signal<{ statuses: string[]; dateDu: string; dateAu: string }>({ statuses: ['PUBLIE'], dateDu: '', dateAu: '' });
  const marcheEmissions = signal<any[]>([]);
  const perms = opts.permissions ?? [];

  return {
    orders,
    emissions,
    clientsRegistry,
    audit,
    marcheConfig,
    marcheEmissions,

    refreshOrders: vi.fn(),
    refreshEmissions: vi.fn(),
    refreshClients: vi.fn(),
    refreshAudit: vi.fn(),

    hasPermission: vi.fn((p: string) => perms.includes(p)),
    getEmission: vi.fn((id: string) => emissions().find((e) => e.id === id)),
    getOrder: vi.fn((id: string) => orders().find((o) => o.id === id)),
    getEmissionHistory: vi.fn(() => [] as any[]),
    getOrderHistory: vi.fn(() => [] as any[]),

    publishAllEmissions: vi.fn(() => of(2)),
    bulkValidateAndPublishEmissions: vi.fn(() => ({ ok: 2, ko: 0 })),
    bulkRejectEmissions: vi.fn(() => ({ ok: 2, ko: 0 })),
    rejectEmissionValidation: vi.fn(() => true),
    validateAndPublishEmission: vi.fn(),
    closeEmission: vi.fn(() => true),
    archiveEmission: vi.fn(),
    deleteEmission: vi.fn(),
    createEmission: vi.fn((): any => of(makeEmission({ status: 'PUBLIE' }))),
    editEmission: vi.fn((): any => of(makeEmission({ status: 'PUBLIE' }))),
    updateMarcheConfig: vi.fn((partial: any) => marcheConfig.update((c) => ({ ...c, ...partial }))),

    validateOrder: vi.fn(() => of(true)),
    rejectOrder: vi.fn(() => of(true)),
    bulkValidateOrders: vi.fn(() => of({ ok: 1, ko: 0 })),
    bulkRejectOrders: vi.fn(() => of({ ok: 1, ko: 0 })),
    verifyProvision: vi.fn(() => true),
    changeOrderStatus: vi.fn(() => true),
    cancelOrder: vi.fn(() => true),
    transmitOrder: vi.fn(() => true),
    runAdjudication: vi.fn(),
    addOrderNote: vi.fn(),
    validateOrderResult: vi.fn(),
    rejectOrderResult: vi.fn(),
    saisirResultat: vi.fn(() => of(true)),
    verifyOrderSignature: vi.fn(),
    printAndLockOrder: vi.fn(() => true),

    createClientDossier: vi.fn((): any => of({ ok: true, client: { id: 'u-new', raisonSociale: 'ACME' } })),
  };
}

function makeApi() {
  return {
    // Compte joint : vue back-office des signataires (afb-order-joint-signatures).
    getOrderSignatures: vi.fn((): any => of({
      orderId: 'o-1', reference: 'ORD-1', status: 'SOUMIS', joint: false,
      signaturesAttendues: 0, signaturesObtenues: 0, seuil: 0.6, personnes: [],
      bypassedAt: null, bypassMotif: null, bypassPar: null,
    })),
    forceValidateOrder: vi.fn((): any => of(true)),

    broadcastRecipients: vi.fn((): any => of(['a@b.cm', 'c@d.cm'])),
    getInitialPassword: vi.fn((): any => of({ password: 'secret123', available: true })),
    updateClient: vi.fn((): any => of(makeClient({ raisonSociale: 'Modifié' }))),
    deactivateClient: vi.fn((): any => of(makeClient({ raisonSociale: 'Désactivé' }))),
  };
}

function makeToast() {
  return { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makePdf() {
  return { start: vi.fn(), set: vi.fn(), done: vi.fn(), fail: vi.fn() };
}

function setupBrowserStubs() {
  (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as any).revokeObjectURL = vi.fn();
  // Fenêtre factice : `window.open` renvoie un objet truthy → les impressions
  // (printOrder / printAvisOpere) réussissent. On surcharge ponctuellement pour
  // tester la branche « pop-up bloqué ».
  window.open = vi.fn(() => ({ addEventListener: vi.fn(), print: vi.fn(), document: {} })) as any;
  window.prompt = vi.fn(() => 'Motif test') as any;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    configurable: true,
  });
  // `decode()` n'est pas fiable en jsdom : on l'aplatit pour le rendu PDF.
  (HTMLImageElement.prototype as any).decode = () => Promise.resolve();
  // Capture les téléchargements déclenchés par `downloadBlob` (a.download + click()).
  downloadClicks = [];
  (HTMLAnchorElement.prototype as any).click = function (this: HTMLAnchorElement) {
    if (this.download) downloadClicks.push(this.download);
  };
}

// ═══════════════════════════════ BoDashboard ════════════════════════════════

describe('BoDashboard', () => {
  let cmp: BoDashboard;
  let data: ReturnType<typeof makeMockData>;

  function build(orders: any[]) {
    data = makeMockData({ orders });
    TestBed.configureTestingModule({
      imports: [BoDashboard],
      providers: [{ provide: MockData, useValue: data }],
    });
    cmp = TestBed.createComponent(BoDashboard).componentInstance;
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('recharge ordres et émissions à la construction', () => {
    build([]);
    expect(data.refreshOrders).toHaveBeenCalled();
    expect(data.refreshEmissions).toHaveBeenCalled();
  });

  it('calcule les KPI dérivés des ordres', () => {
    build([
      makeOrder({ status: 'SOUMIS', montant: 1_000_000, clientId: 'A' }),
      makeOrder({ status: 'TOTALEMENT_RETENU', montant: 2_000_000, clientId: 'B' }),
    ]);
    expect(cmp.pending()).toBe(1);
    expect(cmp.volume()).toBe(3_000_000);
    expect(cmp.clients()).toBe(2);
    expect(cmp.byNature().length).toBeGreaterThan(0);
    expect(cmp.byDay()).toHaveLength(7);
    expect(cmp.byMonth()).toHaveLength(6);
  });

  it('recent() trie par date décroissante et limite à 6', () => {
    const list = Array.from({ length: 8 }, (_, i) =>
      makeOrder({ id: 'r' + i, dateSoumission: `2026-06-${String(i + 1).padStart(2, '0')} 09:00` }));
    build(list);
    const recent = cmp.recent();
    expect(recent).toHaveLength(6);
    expect(recent[0].dateSoumission > recent[1].dateSoumission).toBe(true);
  });

  it('trendLabel formate hausse et baisse', () => {
    build([]);
    expect(cmp.trendLabel(5)).toBe('↑ +5%');
    expect(cmp.trendLabel(-3)).toBe('↓ -3%');
  });

  it('fmtFcfa couvre les quatre paliers', () => {
    build([]);
    expect(cmp.fmtFcfa(2_500_000_000)).toBe('2,5 Md');
    expect(cmp.fmtFcfa(3_000_000)).toBe('3 M');
    expect(cmp.fmtFcfa(4_000)).toBe('4 k');
    expect(cmp.fmtFcfa(500)).toBe('500');
  });

  it('shortDate reformate en JJ/MM/AAAA', () => {
    build([]);
    expect(cmp.shortDate('2026-06-15 09:00')).toBe('15/06/2026');
    expect(cmp.shortDate('')).toBe('');
  });

  it('ordLabel / ordClass renvoient libellé et classe de badge', () => {
    build([]);
    expect(cmp.ordLabel('SOUMIS')).toBe('Soumis');
    expect(cmp.ordClass('ANNULE')).toBe('badge-annule');
  });

  it('les tendances mensuelles sont calculées sans erreur', () => {
    build([makeOrder({ dateSoumission: '2026-06-15 09:00' })]);
    expect(typeof cmp.ordersThisMonth()).toBe('number');
    expect(typeof cmp.ordersTrend()).toBe('number');
    expect(typeof cmp.volumeTrend()).toBe('number');
  });
});

// ═══════════════════════════════ BoEmissions ════════════════════════════════

describe('BoEmissions', () => {
  let cmp: BoEmissions;
  let data: ReturnType<typeof makeMockData>;
  let api: ReturnType<typeof makeApi>;
  let toast: ReturnType<typeof makeToast>;

  function build(opts: { permissions?: string[]; emissions?: any[] } = {}) {
    TestBed.resetTestingModule(); // rejouable depuis un test (permissions variables)
    data = makeMockData(opts);
    api = makeApi();
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoEmissions],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    cmp = TestBed.createComponent(BoEmissions).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    setupBrowserStubs();
    build();
  });
  afterEach(() => vi.clearAllMocks());

  it('recharge les émissions à la construction', () => {
    expect(data.refreshEmissions).toHaveBeenCalled();
  });

  it('editingPublishedFiche / editingIsReadOnly suivent le statut original', () => {
    cmp.editingOriginalStatus.set('PUBLIE');
    expect(cmp.editingPublishedFiche()).toBe(true);
    expect(cmp.editingIsReadOnly()).toBe(false);
    cmp.editingOriginalStatus.set('CLOTURE');
    expect(cmp.editingIsReadOnly()).toBe(true);
    cmp.editingOriginalStatus.set('ARCHIVE');
    expect(cmp.editingIsReadOnly()).toBe(true);
  });

  it('publishAllDrafts publie et notifie (n > 0)', () => {
    data.publishAllEmissions.mockReturnValueOnce(of(3));
    cmp.publishAllDrafts();
    expect(cmp.publishingAll()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Publication groupée', '3 émission(s) publiée(s).');
  });

  it('publishAllDrafts signale l’absence de brouillon (n = 0)', () => {
    data.publishAllEmissions.mockReturnValueOnce(of(0));
    cmp.publishAllDrafts();
    expect(toast.error).toHaveBeenCalledWith('Aucune publication', 'Aucune fiche en brouillon à publier.');
  });

  it('publishAllDrafts est ignoré si déjà en cours', () => {
    cmp.publishingAll.set(true);
    cmp.publishAllDrafts();
    expect(data.publishAllEmissions).not.toHaveBeenCalled();
  });

  it('canPublish reflète la permission EMISSION_VALIDATE', () => {
    expect(cmp.canPublish()).toBe(false);
    build({ permissions: ['EMISSION_VALIDATE'] });
    expect(cmp.canPublish()).toBe(true);
  });

  it('mailSubject et mailBody reflètent les émissions publiées', () => {
    build({ emissions: [makeEmission({ status: 'PUBLIE' }), makeEmission({ status: 'BROUILLON' })] });
    expect(cmp.openEmissionsCount()).toBe(1);
    expect(cmp.mailSubject()).toContain('1 émission(s)');
    expect(cmp.mailBody()).toContain('Afriland First Bank');
    expect(cmp.mailBody()).toContain('CM1300001268');
  });

  it('previewRecipientsShort tronque au-delà de 3 destinataires', () => {
    cmp.previewRecipients.set(['a@x', 'b@x', 'c@x', 'd@x', 'e@x']);
    expect(cmp.previewRecipientsShort()).toBe('a@x, b@x, c@x, +2');
    cmp.previewRecipients.set(['a@x']);
    expect(cmp.previewRecipientsShort()).toBe('a@x');
  });

  it('openBroadcast refuse si aucune émission ouverte', () => {
    cmp.openBroadcast();
    expect(toast.error).toHaveBeenCalledWith('Aucune émission ouverte', expect.any(String));
    expect(cmp.broadcastOpen()).toBe(false);
  });

  it('openBroadcast initialise la modale si une émission est publiée', () => {
    build({ emissions: [makeEmission({ status: 'PUBLIE' })] });
    cmp.openBroadcast();
    expect(cmp.broadcastOpen()).toBe(true);
    expect(cmp.broadcastMode()).toBe('ALL');
    expect(cmp.showPreview()).toBe(false);
  });

  it('togglePreview (mode CUSTOM) résout la liste saisie', () => {
    build({ emissions: [makeEmission({ status: 'PUBLIE' })] });
    cmp.broadcastMode.set('CUSTOM');
    cmp.broadcastList = 'alice@example.com, bob@example.com';
    cmp.togglePreview();
    expect(cmp.showPreview()).toBe(true);
    expect(cmp.previewRecipients()).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('togglePreview (CUSTOM) erreur si aucune adresse valide', () => {
    cmp.broadcastMode.set('CUSTOM');
    cmp.broadcastList = 'pas-un-email';
    cmp.togglePreview();
    expect(cmp.showPreview()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Liste vide', expect.any(String));
  });

  it('togglePreview referme l’aperçu s’il est déjà ouvert', () => {
    cmp.showPreview.set(true);
    cmp.togglePreview();
    expect(cmp.showPreview()).toBe(false);
  });

  it('togglePreview (mode ALL) charge les destinataires backend', () => {
    cmp.broadcastMode.set('ALL');
    cmp.togglePreview();
    expect(api.broadcastRecipients).toHaveBeenCalled();
    expect(cmp.previewRecipients()).toEqual(['a@b.cm', 'c@d.cm']);
    expect(cmp.showPreview()).toBe(true);
  });

  it('togglePreview (ALL) signale l’absence de client', () => {
    api.broadcastRecipients.mockReturnValueOnce(of([]));
    cmp.broadcastMode.set('ALL');
    cmp.togglePreview();
    expect(toast.error).toHaveBeenCalledWith('Aucun client', expect.any(String));
    expect(cmp.broadcastBusy()).toBe(false);
  });

  it('togglePreview (ALL) gère une erreur réseau', () => {
    api.broadcastRecipients.mockReturnValueOnce(throwError(() => new Error('boom')));
    cmp.broadcastMode.set('ALL');
    cmp.togglePreview();
    expect(toast.error).toHaveBeenCalledWith('Erreur', expect.any(String));
    expect(cmp.broadcastBusy()).toBe(false);
  });

  it('openInOutlook construit un mailto et notifie', () => {
    cmp.broadcastMode.set('CUSTOM');
    cmp.broadcastList = 'alice@example.com';
    cmp.openInOutlook();
    expect(toast.success).toHaveBeenCalledWith('Outlook', expect.stringContaining('1 destinataire'));
  });

  it('parseEmailList dédoublonne, normalise et filtre', () => {
    const list = (cmp as any).parseEmailList('A@X.COM; a@x.com , bad, b@y.com\n@nope');
    expect(list).toEqual(['a@x.com', 'b@y.com']);
  });

  // ── Sélection multiple ──
  it('gère la sélection multiple des brouillons', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' }), makeEmission({ id: 'e-2', status: 'PUBLIE' })] });
    cmp.toggleSelect('e-1');
    cmp.toggleSelect('e-2');
    expect(cmp.isSelected('e-1')).toBe(true);
    expect(cmp.selectedDrafts()).toEqual(['e-1']); // seul le brouillon est éligible
    cmp.toggleSelect('e-1');
    expect(cmp.isSelected('e-1')).toBe(false);
    cmp.clearSelection();
    expect(cmp.selected()).toEqual([]);
  });

  it('toggleAllDrafts sélectionne / désélectionne les brouillons filtrés', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' }), makeEmission({ id: 'e-2', status: 'BROUILLON' })] });
    cmp.toggleAllDrafts();
    expect(cmp.allDraftsSelected()).toBe(true);
    expect(cmp.selected()).toHaveLength(2);
    cmp.toggleAllDrafts();
    expect(cmp.selected()).toEqual([]);
  });

  it('validation en masse : askBulkValidate + doBulkValidate', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' })] });
    cmp.toggleSelect('e-1');
    cmp.askBulkValidate();
    expect(cmp.bulkValidateOpen()).toBe(true);
    cmp.doBulkValidate();
    expect(data.bulkValidateAndPublishEmissions).toHaveBeenCalledWith(['e-1']);
    expect(cmp.bulkValidateOpen()).toBe(false);
    expect(cmp.selected()).toEqual([]);
  });

  it('askBulkValidate ne fait rien sans brouillon sélectionné', () => {
    cmp.askBulkValidate();
    expect(cmp.bulkValidateOpen()).toBe(false);
  });

  it('rejet en masse : askBulkReject + doBulkReject', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' })] });
    cmp.toggleSelect('e-1');
    cmp.askBulkReject();
    expect(cmp.bulkRejectOpen()).toBe(true);
    cmp.bulkRejectMotif = 'Documents manquants';
    cmp.doBulkReject();
    expect(data.bulkRejectEmissions).toHaveBeenCalledWith(['e-1'], 'Documents manquants');
    expect(cmp.bulkRejectOpen()).toBe(false);
  });

  it('doBulkReject est ignoré sans motif', () => {
    cmp.bulkRejectMotif = '   ';
    cmp.doBulkReject();
    expect(data.bulkRejectEmissions).not.toHaveBeenCalled();
  });

  // ── Rejet individuel ──
  it('askReject ouvre la modale avec la fiche ciblée', () => {
    build({ emissions: [makeEmission({ id: 'e-1' })] });
    cmp.askReject('e-1');
    expect(cmp.rejectOpen()).toBe(true);
    expect(cmp.rejectTarget()?.id).toBe('e-1');
  });

  it('askReject ignore un id inconnu', () => {
    cmp.askReject('zzz');
    expect(cmp.rejectOpen()).toBe(false);
  });

  it('doReject succès : notifie et ferme', () => {
    build({ emissions: [makeEmission({ id: 'e-1' })] });
    cmp.askReject('e-1');
    cmp.rejectMotif = 'Taux incohérent';
    cmp.doReject();
    expect(data.rejectEmissionValidation).toHaveBeenCalledWith('e-1', 'Taux incohérent');
    expect(cmp.rejectOpen()).toBe(false);
    expect(toast.info).toHaveBeenCalled();
  });

  it('doReject échec : garde la modale ouverte', () => {
    build({ emissions: [makeEmission({ id: 'e-1' })] });
    data.rejectEmissionValidation.mockReturnValueOnce(false);
    cmp.askReject('e-1');
    cmp.rejectMotif = 'x';
    cmp.doReject();
    expect(toast.error).toHaveBeenCalledWith('Rejet impossible', expect.any(String));
  });

  it('canSubmitReject exige un motif non vide', () => {
    cmp.rejectMotif = '';
    expect(cmp.canSubmitReject()).toBe(false);
    cmp.rejectMotif = 'motif';
    expect(cmp.canSubmitReject()).toBe(true);
  });

  it('viewHistory ouvre la modale historique', () => {
    build({ emissions: [makeEmission({ id: 'e-1', code: 'C1' })] });
    data.getEmissionHistory.mockReturnValueOnce([{ id: 'h1' }]);
    cmp.viewHistory('e-1');
    expect(cmp.historyOpen()).toBe(true);
    expect(cmp.historyEntries()).toHaveLength(1);
  });

  it('viewReadOnly ouvre le formulaire en lecture seule', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'CLOTURE' })] });
    cmp.viewReadOnly('e-1');
    expect(cmp.showForm()).toBe(true);
    expect(cmp.editingIsReadOnly()).toBe(true);
    expect(toast.info).toHaveBeenCalledWith('Lecture seule', expect.any(String));
  });

  // ── Préfixe ISIN / nature ──
  it('isinPrefixForPays renvoie le préfixe ISO ou vide', () => {
    expect(cmp.isinPrefixForPays('GAB')).toBe('GA');
    expect(cmp.isinPrefixForPays('XXX')).toBe('');
  });

  it('onPaysChange applique le préfixe pays sur la désignation', () => {
    cmp.newE.designation = 'CM1300001268 BTA 52';
    cmp.onPaysChange('GAB' as any);
    expect(cmp.newE.paysCode).toBe('GAB');
    expect(cmp.newE.designation.startsWith('GA')).toBe(true);
  });

  it('onNatureChange fixe la valeur unitaire et remplace le jeton', () => {
    cmp.newE.designation = 'CM1300001268 BTA 52';
    cmp.onNatureChange('OTA');
    expect(cmp.newE.valeurUnitaire).toBe(10_000);
    expect(cmp.newE.designation).toContain('OTA');
  });

  // ── Config marché ──
  it('toggleStatus ajoute puis retire un statut', () => {
    expect(cmp.isStatusSelected('BROUILLON')).toBe(false);
    cmp.toggleStatus('BROUILLON');
    expect(cmp.isStatusSelected('BROUILLON')).toBe(true);
    cmp.toggleStatus('BROUILLON');
    expect(cmp.isStatusSelected('BROUILLON')).toBe(false);
  });

  it('selectAllStatuses sélectionne tous les statuts', () => {
    cmp.selectAllStatuses();
    expect(data.updateMarcheConfig).toHaveBeenCalledWith({ statuses: ['BROUILLON', 'PUBLIE', 'CLOTURE', 'ARCHIVE'] });
  });

  it('setDateDu / setDateAu mettent à jour la config', () => {
    cmp.setDateDu('2026-01-01');
    cmp.setDateAu('2026-12-31');
    expect(cmp.marcheCfg().dateDu).toBe('2026-01-01');
    expect(cmp.marcheCfg().dateAu).toBe('2026-12-31');
  });

  it('resetMarcheConfig revient à PUBLIE uniquement', () => {
    cmp.resetMarcheConfig();
    expect(data.updateMarcheConfig).toHaveBeenCalledWith({ statuses: ['PUBLIE'], dateDu: '', dateAu: '' });
    expect(toast.info).toHaveBeenCalled();
  });

  // ── Filtres ──
  it('filtered applique recherche, nature, statut et pays', () => {
    build({
      emissions: [
        makeEmission({ id: 'e-1', isin: 'CM1111111111', nature: 'BTA', status: 'PUBLIE', paysCode: 'CMR', code: 'AAA', libelle: 'AAA' }),
        makeEmission({ id: 'e-2', isin: 'GA2222222222', nature: 'OTA', status: 'BROUILLON', paysCode: 'GAB', code: 'BBB', libelle: 'BBB' }),
      ],
    });
    cmp.fSearch.set('cm1111');
    expect(cmp.filtered().map((e) => e.id)).toEqual(['e-1']);
    cmp.fSearch.set('');
    cmp.fNature.set('OTA');
    expect(cmp.filtered().map((e) => e.id)).toEqual(['e-2']);
    cmp.fNature.set('');
    cmp.fStatus.set('PUBLIE');
    expect(cmp.filtered().map((e) => e.id)).toEqual(['e-1']);
    cmp.fStatus.set('');
    cmp.fPays.set('GAB');
    expect(cmp.filtered().map((e) => e.id)).toEqual(['e-2']);
    cmp.resetFilters();
    expect(cmp.filtered()).toHaveLength(2);
  });

  it('onImported crée chaque émission et notifie', () => {
    cmp.onImported([{ status: 'BROUILLON' } as any, { status: 'PUBLIE' } as any]);
    expect(data.createEmission).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('2 émission(s) importée(s)', expect.any(String));
  });

  // ── ISIN / payload ──
  it('isinDetecte / isinValide sur le 1er mot de la désignation', () => {
    cmp.newE.designation = 'CM1300001268 BTA';
    expect(cmp.isinDetecte()).toBe('CM1300001268');
    expect(cmp.isinValide()).toBe(true);
    cmp.newE.designation = 'COURT';
    expect(cmp.isinValide()).toBe(false);
  });

  it('buildEmissionPayload valide (BTA, taux ADJ)', () => {
    cmp.newE = cmp.blank();
    const p = cmp.buildEmissionPayload();
    expect(p).not.toBeNull();
    expect(p!.isin).toBe('CM1300001268');
    expect(p!.tauxNominal).toBe(0); // ADJ → 0
    expect(p!.modeAdjudication).toBe('TAUX');
  });

  it('buildEmissionPayload OTA calcule la durée en années et le taux numérique', () => {
    cmp.newE = cmp.blank();
    cmp.newE.nature = 'OTA';
    cmp.newE.maturite = 3;
    cmp.newE.tauxPrix = '5,80';
    const p = cmp.buildEmissionPayload();
    expect(p!.dureeJours).toBe(3 * 365);
    expect(p!.tauxNominal).toBe(5.8);
    expect(p!.frequenceCoupon).toBe('ANNUEL');
  });

  it('buildEmissionPayload refuse un ISIN de longueur ≠ 12', () => {
    cmp.newE = cmp.blank();
    cmp.newE.designation = 'COURT BTA';
    expect(cmp.buildEmissionPayload()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Désignation invalide', expect.any(String));
  });

  it('buildEmissionPayload refuse des dates manquantes', () => {
    cmp.newE = cmp.blank();
    cmp.newE.dateEcheance = '';
    expect(cmp.buildEmissionPayload()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Dates requises', expect.any(String));
  });

  it('emissionToForm reconstruit les 11 champs', () => {
    const e = makeEmission({ nature: 'BTA', dureeJours: 364, montantGlobal: 20_000_000_000, fermetureSouscription: '2026-05-12T10:30' });
    const f = cmp.emissionToForm(e);
    expect(f.maturite).toBe(52);
    expect(f.volumeMillions).toBe(20_000);
    expect(f.heureLimite).toBe('10:30');
  });

  it('newEmission / edit / closeForm pilotent le formulaire', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' })] });
    cmp.newEmission();
    expect(cmp.showForm()).toBe(true);
    expect(cmp.editingId()).toBeNull();
    cmp.edit('e-1');
    expect(cmp.editingId()).toBe('e-1');
    expect(cmp.editingOriginalStatus()).toBe('BROUILLON');
    cmp.closeForm();
    expect(cmp.showForm()).toBe(false);
  });

  it('edit d’une fiche clôturée bascule en lecture seule', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'CLOTURE' })] });
    cmp.edit('e-1');
    expect(cmp.editingIsReadOnly()).toBe(true);
  });

  it('save(BROUILLON) crée puis ferme le formulaire', () => {
    data.createEmission.mockReturnValueOnce(of(makeEmission({ status: 'BROUILLON', code: 'X' })));
    cmp.newE = cmp.blank();
    cmp.showForm.set(true);
    cmp.save('BROUILLON');
    expect(data.createEmission).toHaveBeenCalled();
    expect(cmp.showForm()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Brouillon enregistré', 'X');
  });

  it('save(PUBLIE) réussie publie', () => {
    data.createEmission.mockReturnValueOnce(of(makeEmission({ status: 'PUBLIE', code: 'Y' })));
    cmp.newE = cmp.blank();
    cmp.save('PUBLIE');
    expect(toast.success).toHaveBeenCalledWith('Émission publiée', 'Y');
  });

  it('save(PUBLIE) mais serveur garde BROUILLON → info', () => {
    data.createEmission.mockReturnValueOnce(of(makeEmission({ status: 'BROUILLON', code: 'Z' })));
    cmp.newE = cmp.blank();
    cmp.save('PUBLIE');
    expect(toast.info).toHaveBeenCalledWith('Brouillon enregistré', expect.stringContaining('Z'));
  });

  it('save avec réponse nulle → erreur', () => {
    data.createEmission.mockReturnValueOnce(of(null));
    cmp.newE = cmp.blank();
    cmp.save('BROUILLON');
    expect(toast.error).toHaveBeenCalledWith('Création refusée', expect.any(String));
  });

  it('save annulée si payload invalide', () => {
    cmp.newE = cmp.blank();
    cmp.newE.designation = 'COURT';
    cmp.save('BROUILLON');
    expect(data.createEmission).not.toHaveBeenCalled();
  });

  it('saveEdit renvoie une fiche PUBLIE en BROUILLON (re-validation)', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'PUBLIE' })] });
    data.editEmission.mockReturnValueOnce(of(makeEmission({ code: 'E', status: 'BROUILLON' })));
    cmp.edit('e-1');
    cmp.newE = cmp.blank();
    cmp.saveEdit();
    expect(data.editEmission).toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Modification enregistrée — re-validation requise', expect.any(String));
  });

  it('saveEdit d’un brouillon notifie une modification simple', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' })] });
    data.editEmission.mockReturnValueOnce(of(makeEmission({ code: 'E2', status: 'BROUILLON' })));
    cmp.edit('e-1');
    cmp.newE = cmp.blank();
    cmp.saveEdit();
    expect(toast.success).toHaveBeenCalledWith('Émission modifiée', 'E2');
  });

  it('saveEdit refuse une fiche en lecture seule', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'CLOTURE' })] });
    cmp.editingId.set('e-1');
    cmp.editingOriginalStatus.set('CLOTURE');
    cmp.saveEdit();
    expect(toast.error).toHaveBeenCalledWith('Modification refusée', expect.any(String));
    expect(data.editEmission).not.toHaveBeenCalled();
  });

  it('saveEdit sans id ne fait rien', () => {
    cmp.editingId.set(null);
    cmp.saveEdit();
    expect(data.editEmission).not.toHaveBeenCalled();
  });

  it('saveEdit avec réponse nulle → erreur', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' })] });
    data.editEmission.mockReturnValueOnce(of(null));
    cmp.edit('e-1');
    cmp.newE = cmp.blank();
    cmp.saveEdit();
    expect(toast.error).toHaveBeenCalledWith('Modification refusée', expect.any(String));
  });

  it('publish / archive délèguent à MockData', () => {
    cmp.publish('e-1');
    expect(data.validateAndPublishEmission).toHaveBeenCalledWith('e-1');
    cmp.archive('e-1');
    expect(data.archiveEmission).toHaveBeenCalledWith('e-1');
  });

  it('close notifie succès ou échec', () => {
    cmp.close('e-1');
    expect(toast.info).toHaveBeenCalledWith('Émission clôturée');
    data.closeEmission.mockReturnValueOnce(false);
    cmp.close('e-1');
    expect(toast.error).toHaveBeenCalledWith('Clôture impossible', expect.any(String));
  });

  it('duplicate pré-remplit le formulaire avec une désignation vide', () => {
    build({ emissions: [makeEmission({ id: 'e-1' })] });
    cmp.duplicate('e-1');
    expect(cmp.showForm()).toBe(true);
    expect(cmp.newE.designation).toBe('');
    expect(cmp.editingId()).toBeNull();
  });

  it('askDelete / doDelete suppriment via confirmation', () => {
    cmp.askDelete('e-1');
    expect(cmp.confirmOpen()).toBe(true);
    cmp.doDelete();
    expect(data.deleteEmission).toHaveBeenCalledWith('e-1');
    expect(cmp.confirmOpen()).toBe(false);
  });

  it('exportCsv télécharge et notifie', () => {
    build({ emissions: [makeEmission({ id: 'e-1' })] });
    cmp.exportCsv();
    expect(downloadClicks).toContain('emissions.csv');
    expect(toast.success).toHaveBeenCalledWith('Export CSV', expect.any(String));
  });

  it('emLabel / emClass renvoient libellé et classe', () => {
    expect(cmp.emLabel('PUBLIE')).toBe('Publié');
    expect(cmp.emClass('BROUILLON')).toBe('badge-brouillon');
  });
});

// ═══════════════════════════════ BoOrders ══════════════════════════════════

describe('BoOrders', () => {
  let cmp: BoOrders;
  let data: ReturnType<typeof makeMockData>;
  let api: ReturnType<typeof makeApi>;
  let toast: ReturnType<typeof makeToast>;
  let pdf: ReturnType<typeof makePdf>;

  function build(opts: { permissions?: string[]; orders?: any[]; emissions?: any[] } = {}) {
    TestBed.resetTestingModule(); // rejouable depuis un test (permissions variables)
    data = makeMockData(opts);
    api = makeApi();
    toast = makeToast();
    pdf = makePdf();
    TestBed.configureTestingModule({
      imports: [BoOrders],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: PdfProgressService, useValue: pdf },
      ],
    });
    cmp = TestBed.createComponent(BoOrders).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    setupBrowserStubs();
    build();
  });
  afterEach(() => vi.clearAllMocks());

  it('recharge les ordres à la construction', () => {
    expect(data.refreshOrders).toHaveBeenCalled();
  });

  it('canValidateResult reflète la permission superviseur', () => {
    expect(cmp.canValidateResult()).toBe(false);
    build({ permissions: ['ORDER_RESULT_VALIDATE'] });
    expect(cmp.canValidateResult()).toBe(true);
  });

  it('validateResult / rejectResult délèguent et notifient', () => {
    const o = makeOrder({ id: 'o-1' });
    cmp.validateResult(o);
    expect(data.validateOrderResult).toHaveBeenCalledWith('o-1');
    cmp.rejectResult(o);
    expect(data.rejectOrderResult).toHaveBeenCalledWith('o-1', 'Motif test');
  });

  it('doAdjudication exige une émission filtrée', () => {
    cmp.doAdjudication();
    expect(data.runAdjudication).not.toHaveBeenCalled();
    cmp.filterEmission.set('e-1');
    cmp.doAdjudication();
    expect(data.runAdjudication).toHaveBeenCalledWith('e-1');
    expect(toast.success).toHaveBeenCalled();
  });

  it('saveNote ignore une note vide et enregistre une note valide', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.noteDraft = '   ';
    cmp.saveNote('o-1');
    expect(data.addOrderNote).not.toHaveBeenCalled();
    cmp.noteDraft = 'Note interne';
    cmp.saveNote('o-1');
    expect(data.addOrderNote).toHaveBeenCalledWith('o-1', 'Note interne');
    expect(cmp.noteDraft).toBe('');
  });

  it('reached suit la progression du stepper', () => {
    expect(cmp.reached({ status: 'EN_VERIFICATION' }, 'SOUMIS')).toBe(true);
    expect(cmp.reached({ status: 'SOUMIS' }, 'EN_ATTENTE_ADJUDICATION')).toBe(false);
    expect(cmp.reached({ status: 'NON_RETENU' }, 'TOTALEMENT_RETENU')).toBe(true);
    expect(cmp.reached(undefined, 'SOUMIS')).toBe(false);
  });

  it('canChangeStatus verrouille les statuts finaux', () => {
    expect(cmp.canChangeStatus({ status: 'SOUMIS' })).toBe(true);
    expect(cmp.canChangeStatus({ status: 'ANNULE' })).toBe(false);
    expect(cmp.canChangeStatus({ status: 'TOTALEMENT_RETENU' })).toBe(false);
  });

  it('toggleRowMenu ouvre, repositionne et referme', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    const ev = { currentTarget: { getBoundingClientRect: () => ({ right: 500, bottom: 100, top: 80, left: 300 }) } } as unknown as Event;
    cmp.toggleRowMenu('o-1', ev);
    expect(cmp.rowMenuId()).toBe('o-1');
    expect(cmp.rowMenuOrder()?.id).toBe('o-1');
    cmp.toggleRowMenu('o-1', ev); // même id → ferme
    expect(cmp.rowMenuId()).toBeNull();
    // repositionnement vers le haut + bornage gauche
    const ev2 = { currentTarget: { getBoundingClientRect: () => ({ right: 100, bottom: 700, top: 690, left: 20 }) } } as unknown as Event;
    cmp.toggleRowMenu('o-1', ev2);
    expect(cmp.rowMenuPos().x).toBe(8);
    expect(cmp.rowMenuPos().y).toBeLessThan(700);
  });

  it('filtered applique recherche, statut, émission et canal', () => {
    build({
      orders: [
        makeOrder({ id: 'o-1', reference: 'AAA', status: 'SOUMIS', emissionId: 'e-1', canal: 'GUICHET' }),
        makeOrder({ id: 'o-2', reference: 'BBB', status: 'ANNULE', emissionId: 'e-2', canal: 'EMAIL' }),
      ],
    });
    cmp.filterSearch.set('aaa');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['o-1']);
    cmp.filterSearch.set('');
    cmp.filterStatus.set('ANNULE');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['o-2']);
    cmp.filterStatus.set('');
    cmp.filterEmission.set('e-1');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['o-1']);
    cmp.filterEmission.set('');
    cmp.filterCanal.set('EMAIL');
    expect(cmp.filtered().map((o) => o.id)).toEqual(['o-2']);
    cmp.resetFilters();
    expect(cmp.filtered()).toHaveLength(2);
  });

  it('gère la sélection et son total', () => {
    build({ orders: [makeOrder({ id: 'o-1', montant: 100 }), makeOrder({ id: 'o-2', montant: 200 })] });
    cmp.toggleSelect('o-1');
    cmp.toggleSelect('o-2');
    expect(cmp.selectedTotal()).toBe(300);
    expect(cmp.allSelected()).toBe(true);
    cmp.toggleAll(); // tout sélectionné → vide
    expect(cmp.selected()).toEqual([]);
    cmp.toggleAll(); // vide → tout
    expect(cmp.selected()).toHaveLength(2);
    cmp.clearSelection();
    expect(cmp.selected()).toEqual([]);
  });

  it('compteurs de sélection par statut', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' }), makeOrder({ id: 'o-2', status: 'EN_VERIFICATION' }), makeOrder({ id: 'o-3', status: 'ANNULE' })] });
    cmp.selected.set(['o-1', 'o-2', 'o-3']);
    expect(cmp.countSelectedWithStatus('SOUMIS')).toBe(1);
    expect(cmp.countSelectedTransmitable()).toBe(2);
    expect(cmp.canBulkVerify()).toBe(true);
    expect(cmp.canBulkTransmit()).toBe(true);
    expect(cmp.canBulkCancel()).toBe(true);
    expect(cmp.canCancel('SOUMIS')).toBe(true);
    expect(cmp.canCancel('ANNULE')).toBe(false);
  });

  it('openDetail charge l’ordre', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.openDetail('o-1');
    expect(cmp.detailOpen()).toBe(true);
    expect(cmp.detailOrder()?.id).toBe('o-1');
  });

  it('askValidate succès et échec', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.askValidate('o-1');
    expect(data.validateOrder).toHaveBeenCalledWith('o-1');
    expect(toast.success).toHaveBeenCalled();
    data.validateOrder.mockReturnValueOnce(of(false));
    cmp.askValidate('o-1');
    expect(toast.error).toHaveBeenCalledWith('Validation impossible', expect.any(String));
  });

  it('askValidate ignore un id inconnu', () => {
    cmp.askValidate('zzz');
    expect(data.validateOrder).not.toHaveBeenCalled();
  });

  it('onRejectMotifPredefined pré-remplit le détail sauf « Autre »', () => {
    cmp.rejectOrderMotif = '';
    cmp.onRejectMotifPredefined('Provision insuffisante');
    expect(cmp.rejectOrderMotif).toBe('Provision insuffisante');
    cmp.rejectOrderMotif = '';
    cmp.onRejectMotifPredefined('Autre');
    expect(cmp.rejectOrderMotif).toBe('');
  });

  it('rejet d’ordre : askReject + doRejectOrder (motif prédéfini + détail)', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.askReject('o-1');
    expect(cmp.rejectOrderOpen()).toBe(true);
    cmp.rejectOrderMotifPredefined = 'Provision insuffisante';
    cmp.rejectOrderMotif = 'Solde 0';
    cmp.doRejectOrder();
    expect(data.rejectOrder).toHaveBeenCalledWith('o-1', 'Provision insuffisante — Solde 0');
    expect(cmp.rejectOrderOpen()).toBe(false);
  });

  it('doRejectOrder échec garde la modale', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    data.rejectOrder.mockReturnValueOnce(of(false));
    cmp.askReject('o-1');
    cmp.rejectOrderMotif = 'x';
    cmp.doRejectOrder();
    expect(toast.error).toHaveBeenCalledWith('Rejet impossible', expect.any(String));
  });

  it('canSubmitRejectOrder exige un motif', () => {
    cmp.rejectOrderMotif = '';
    expect(cmp.canSubmitRejectOrder()).toBe(false);
    cmp.rejectOrderMotif = 'motif';
    expect(cmp.canSubmitRejectOrder()).toBe(true);
  });

  it('validation en masse : askBulkValidate + doBulkValidate', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' })] });
    cmp.selected.set(['o-1']);
    expect(cmp.canBulkValidate()).toBe(true);
    cmp.askBulkValidate();
    expect(cmp.bulkValidateOpen()).toBe(true);
    cmp.doBulkValidate();
    expect(data.bulkValidateOrders).toHaveBeenCalledWith(['o-1']);
    expect(cmp.selected()).toEqual([]);
  });

  it('rejet en masse : askBulkReject + doBulkReject', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' })] });
    cmp.selected.set(['o-1']);
    cmp.askBulkReject();
    expect(cmp.bulkRejectOpen()).toBe(true);
    cmp.bulkRejectMotif = 'Fermeture BEAC';
    cmp.doBulkReject();
    expect(data.bulkRejectOrders).toHaveBeenCalledWith(['o-1'], 'Fermeture BEAC');
    expect(cmp.selected()).toEqual([]);
  });

  it('doBulkReject sans motif est ignoré', () => {
    cmp.bulkRejectMotif = '  ';
    cmp.doBulkReject();
    expect(data.bulkRejectOrders).not.toHaveBeenCalled();
  });

  it('verifyProvision succès et échec', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.verifyProvision('o-1');
    expect(toast.success).toHaveBeenCalledWith('Vérification lancée', expect.any(String));
    data.verifyProvision.mockReturnValueOnce(false);
    cmp.verifyProvision('o-1');
    expect(toast.error).toHaveBeenCalledWith('Vérification impossible', expect.any(String));
  });

  it('openChangeStatus ouvre pour un statut modifiable', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS', volume: 5 })] });
    cmp.openChangeStatus('o-1');
    expect(cmp.statusOpen()).toBe(true);
    expect(cmp.newVolume).toBe(5);
  });

  it('openChangeStatus refuse un statut verrouillé', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'ANNULE' })] });
    cmp.openChangeStatus('o-1');
    expect(cmp.statusOpen()).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Statut verrouillé', expect.any(String));
  });

  it('doChangeStatus applique un nouveau statut', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' })] });
    cmp.openChangeStatus('o-1');
    cmp.newStatus = 'EN_VERIFICATION';
    cmp.doChangeStatus();
    expect(data.changeOrderStatus).toHaveBeenCalled();
    expect(cmp.statusOpen()).toBe(false);
  });

  it('doChangeStatus échec notifie', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' })] });
    cmp.openChangeStatus('o-1');
    cmp.newStatus = 'EN_VERIFICATION';
    data.changeOrderStatus.mockReturnValueOnce(false);
    cmp.doChangeStatus();
    expect(toast.error).toHaveBeenCalledWith('Changement impossible', expect.any(String));
  });

  it('doChangeStatus sans statut ne fait rien', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' })] });
    cmp.statusOrder.set(makeOrder({ id: 'o-1', status: 'SOUMIS' }));
    cmp.newStatus = '';
    cmp.doChangeStatus();
    expect(data.changeOrderStatus).not.toHaveBeenCalled();
  });

  it('doTwoSign — BULK_VERIFY lance les vérifications', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' }), makeOrder({ id: 'o-2', status: 'SOUMIS' })] });
    cmp.selected.set(['o-1', 'o-2']);
    cmp.bulkVerify();
    expect(cmp.signOpen()).toBe(true);
    cmp.doTwoSign();
    expect(data.verifyProvision).toHaveBeenCalledTimes(2);
    expect(cmp.selected()).toEqual([]);
  });

  it('doTwoSign — BULK_TRANSMIT transmet les ordres', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'EN_VERIFICATION' })] });
    cmp.selected.set(['o-1']);
    cmp.bulkTransmit();
    cmp.doTwoSign();
    expect(data.transmitOrder).toHaveBeenCalledWith('o-1');
  });

  it('doTwoSign — CANCEL annule un ordre unique', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' })] });
    cmp.askCancel('o-1');
    expect(cmp.signOpen()).toBe(true);
    cmp.doTwoSign();
    expect(data.cancelOrder).toHaveBeenCalledWith('o-1');
  });

  it('doTwoSign — TRANSMIT transmet un ordre unique', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'EN_VERIFICATION' })] });
    cmp.askTransmit('o-1');
    cmp.doTwoSign();
    expect(data.transmitOrder).toHaveBeenCalledWith('o-1');
  });

  it('doBulkCancel annule la sélection', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' }), makeOrder({ id: 'o-2', status: 'SOUMIS' })] });
    cmp.selected.set(['o-1', 'o-2']);
    cmp.bulkCancel();
    expect(cmp.confirmBulk()).toBe(true);
    cmp.doBulkCancel();
    expect(data.cancelOrder).toHaveBeenCalledTimes(2);
    expect(cmp.confirmBulk()).toBe(false);
  });

  it('verifySignature / rejectSignature délèguent', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.verifySignature('o-1');
    expect(data.verifyOrderSignature).toHaveBeenCalledWith('o-1', true);
    cmp.rejectSignature('o-1');
    expect(data.verifyOrderSignature).toHaveBeenCalledWith('o-1', false);
  });

  it('printOrder signale un pop-up bloqué', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    window.open = vi.fn(() => null) as any; // pop-up refusé
    cmp.printOrder('o-1');
    expect(toast.error).toHaveBeenCalledWith('Pop-up bloqué', expect.any(String));
  });

  it('printOrder ouvre la fenêtre d’impression si le pop-up est autorisé', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.printOrder('o-1');
    expect(window.open).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('downloadOrder génère un .txt', () => {
    build({ orders: [makeOrder({ id: 'o-1', reference: 'ORD-X' })] });
    cmp.downloadOrder('o-1');
    expect(downloadClicks).toContain('ORD-X.txt');
    expect(toast.success).toHaveBeenCalled();
  });

  it('downloadOrderPdf succès puis échec', async () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    await cmp.downloadOrderPdf('o-1');
    expect(pdf.done).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('PDF téléchargé', expect.any(String));
    h2c.mockRejectedValueOnce(new Error('boom')); // le rendu PDF échoue
    await cmp.downloadOrderPdf('o-1');
    expect(pdf.fail).toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Échec PDF', expect.any(String));
  });

  it('generateAvis refuse un type autre que AVIS_OPERATION', async () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    await cmp.generateAvis('o-1', 'AVIS_OFFRE_NON_ADJUGEE' as any);
    expect(toast.info).toHaveBeenCalledWith('Document non disponible', expect.any(String));
    expect(pdf.start).not.toHaveBeenCalled(); // aucun rendu PDF déclenché
  });

  it('generateAvis(AVIS_OPERATION) télécharge le PDF', async () => {
    build({ orders: [makeOrder({ id: 'o-1' })], emissions: [makeEmission({ id: 'e-1' })] });
    await cmp.generateAvis('o-1', 'AVIS_OPERATION' as any);
    expect(pdf.start).toHaveBeenCalled();
    expect(pdf.done).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Avis d'opéré téléchargé", expect.any(String));
  });

  // printAvis est asynchrone : il attend les signatures des dirigeants avant de
  // rendre le document (elles doivent y figurer).
  it('printAvis ouvre l’avis / signale un pop-up bloqué', async () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    await cmp.printAvis('o-1');
    expect(window.open).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    window.open = vi.fn(() => null) as any;
    await cmp.printAvis('o-1');
    expect(toast.error).toHaveBeenCalledWith('Pop-up bloqué', expect.any(String));
  });

  it('downloadAndLock télécharge, verrouille et transmet', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.downloadAndLock('o-1');
    expect(data.printAndLockOrder).toHaveBeenCalledWith('o-1');
    expect(toast.success).toHaveBeenCalledWith('Ordre transmis & verrouillé', expect.any(String));
  });

  it('openSaisieResultat initialise le formulaire de résultat', () => {
    build({ orders: [makeOrder({ id: 'o-1', montant: 1000, tauxSoumis: 6 })] });
    cmp.openSaisieResultat('o-1');
    expect(cmp.resultatOpen()).toBe(true);
    expect(cmp.resultatMontant).toBe(500);
    expect(cmp.resultatTaux).toBe(6);
  });

  it('canSubmitResultat couvre chaque branche', () => {
    cmp.resultatChoix.set('');
    expect(cmp.canSubmitResultat()).toBe(false);
    cmp.resultatChoix.set('TOTALEMENT_RETENU');
    expect(cmp.canSubmitResultat()).toBe(true);
    cmp.resultatChoix.set('PARTIELLEMENT_RETENU');
    cmp.resultatCommentaire = '';
    expect(cmp.canSubmitResultat()).toBe(false);
    cmp.resultatCommentaire = 'motif';
    cmp.resultatMontant = 0;
    expect(cmp.canSubmitResultat()).toBe(false);
    cmp.resultatMontant = 100;
    expect(cmp.canSubmitResultat()).toBe(true);
    cmp.resultatChoix.set('NON_RETENU');
    cmp.resultatCommentaire = '';
    expect(cmp.canSubmitResultat()).toBe(false);
    cmp.resultatCommentaire = 'motif';
    expect(cmp.canSubmitResultat()).toBe(true);
  });

  it('setChoix met à jour le choix', () => {
    cmp.setChoix('NON_RETENU');
    expect(cmp.resultatChoix()).toBe('NON_RETENU');
  });

  it('doSaisirResultat (partiel) enregistre et génère un avis', async () => {
    build({ orders: [makeOrder({ id: 'o-1', montant: 1000 })], emissions: [makeEmission({ id: 'e-1' })] });
    cmp.openSaisieResultat('o-1');
    cmp.resultatChoix.set('PARTIELLEMENT_RETENU');
    cmp.resultatCommentaire = 'Enveloppe épuisée';
    cmp.resultatMontant = 400;
    cmp.doSaisirResultat();
    expect(data.saisirResultat).toHaveBeenCalled();
    expect(cmp.resultatOpen()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Résultat saisi', expect.any(String));
  });

  it('doSaisirResultat (non retenu) ne génère pas d’avis', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.openSaisieResultat('o-1');
    cmp.resultatChoix.set('NON_RETENU');
    cmp.resultatCommentaire = 'Taux hors plage';
    cmp.doSaisirResultat();
    expect(pdf.start).not.toHaveBeenCalled(); // pas de génération d'avis
  });

  /** Un refus du SERVEUR doit être dit — et la modale rester ouverte pour corriger. */
  it('doSaisirResultat : un refus du serveur est signalé, sans faux succès', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.openSaisieResultat('o-1');
    cmp.resultatChoix.set('TOTALEMENT_RETENU');
    data.saisirResultat.mockReturnValueOnce(of(false));
    cmp.doSaisirResultat();

    expect(toast.error).toHaveBeenCalledWith('Résultat non enregistré', expect.any(String));
    expect(toast.success).not.toHaveBeenCalled();
    expect(cmp.resultatOpen()).toBe(true);
  });

  it('exportCsv exporte les ordres filtrés', () => {
    build({ orders: [makeOrder({ id: 'o-1' })] });
    cmp.exportCsv();
    expect(downloadClicks).toContain('ordres-collectes.csv');
  });

  it('countByStatus / label / badgeClass', () => {
    build({ orders: [makeOrder({ status: 'SOUMIS' }), makeOrder({ status: 'SOUMIS' })] });
    expect(cmp.countByStatus('SOUMIS')).toBe(2);
    expect(cmp.label('SOUMIS')).toBe('Soumis');
    expect(cmp.badgeClass('SOUMIS')).toBe('badge-soumis');
  });
});

// ═══════════════════════════════ BoClients ══════════════════════════════════

describe('BoClients', () => {
  let cmp: BoClients;
  let data: ReturnType<typeof makeMockData>;
  let api: ReturnType<typeof makeApi>;
  let toast: ReturnType<typeof makeToast>;

  function build(clients: any[] = []) {
    TestBed.resetTestingModule(); // rejouable depuis un test
    data = makeMockData({ clients });
    api = makeApi();
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoClients],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    cmp = TestBed.createComponent(BoClients).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    setupBrowserStubs();
    build();
  });
  afterEach(() => vi.clearAllMocks());

  it('recharge les clients à la construction', () => {
    expect(data.refreshClients).toHaveBeenCalled();
  });

  it('countPm compte les personnes morales', () => {
    build([makeClient({ id: 'A', type: 'PM' }), makeClient({ id: 'B', type: 'PP' })]);
    expect(cmp.countPm()).toBe(1);
  });

  it('filtered applique recherche, type, catégorie et statut', () => {
    build([
      makeClient({ id: 'CLI-1', type: 'PP', raisonSociale: 'Alpha', compte: { numero: 'CT-1', categorie: 'QUALIFIE', statut: 'ACTIF', compteEspecesLie: '1' } }),
      makeClient({ id: 'CLI-2', type: 'PM', raisonSociale: 'Beta', compte: { numero: 'CT-2', categorie: 'NON_QUALIFIE', statut: 'BLOQUE', compteEspecesLie: '2' } }),
    ]);
    cmp.fSearch.set('alpha');
    expect(cmp.filtered().map((c) => c.id)).toEqual(['CLI-1']);
    cmp.fSearch.set('');
    cmp.fType.set('PM');
    expect(cmp.filtered().map((c) => c.id)).toEqual(['CLI-2']);
    cmp.fType.set('');
    cmp.fCat.set('QUALIFIE');
    expect(cmp.filtered().map((c) => c.id)).toEqual(['CLI-1']);
    cmp.fCat.set('');
    cmp.fStatut.set('BLOQUE');
    expect(cmp.filtered().map((c) => c.id)).toEqual(['CLI-2']);
    cmp.resetFilters();
    expect(cmp.filtered()).toHaveLength(2);
  });

  it('open sélectionne le dossier', () => {
    const c = makeClient();
    cmp.open(c);
    expect(cmp.show()).toBe(true);
    expect(cmp.sel()).toBe(c);
  });

  it('blankClient diffère selon PP / PM', () => {
    const pp = cmp.blankClient('PP');
    expect(pp.rccm).toBeUndefined();
    expect(pp.adresse.type).toBe('DOMICILE');
    const pm = cmp.blankClient('PM');
    expect(pm.rccm).toBe('');
    expect(pm.adresse.type).toBe('SIEGE');
  });

  it('openCreate / setType réinitialisent le formulaire', () => {
    cmp.openCreate();
    expect(cmp.createOpen()).toBe(true);
    expect(cmp.newType()).toBe('PP');
    cmp.setType('PM');
    expect(cmp.newType()).toBe('PM');
    expect(cmp.newClient.rccm).toBe('');
  });

  it('addSignataire / removeSignataire respectent les bornes', () => {
    cmp.setType('PM');
    cmp.addSignataire();
    cmp.addSignataire();
    cmp.addSignataire();
    expect(cmp.newClient.signataires).toHaveLength(4);
    cmp.addSignataire(); // plafonné à 4
    expect(cmp.newClient.signataires).toHaveLength(4);
    cmp.removeSignataire(1);
    expect(cmp.newClient.signataires).toHaveLength(3);
  });

  it('removeSignataire ne descend pas sous 1', () => {
    cmp.openCreate();
    cmp.removeSignataire(0);
    expect(cmp.newClient.signataires).toHaveLength(1);
  });

  it('addSousCompte / removeSousCompte', () => {
    cmp.setType('PM');
    cmp.addSousCompte();
    expect(cmp.newClient.sousComptes).toHaveLength(2);
    cmp.removeSousCompte(1);
    expect(cmp.newClient.sousComptes).toHaveLength(1);
    cmp.removeSousCompte(0); // ne descend pas sous 1
    expect(cmp.newClient.sousComptes).toHaveLength(1);
  });

  it('doCreate — erreurs de validation successives', () => {
    cmp.openCreate();
    cmp.newClient.raisonSociale = '';
    cmp.doCreate();
    expect(cmp.createError()).toContain('obligatoire');

    cmp.newClient.raisonSociale = 'Client';
    cmp.newClient.signataires[0].nom = '';
    cmp.doCreate();
    expect(cmp.createError()).toContain('nom du 1er signataire');

    cmp.newClient.signataires[0].nom = 'Dupont';
    cmp.newClient.signataires[0].telephonePortable = '';
    cmp.doCreate();
    expect(cmp.createError()).toContain('téléphone');

    cmp.newClient.signataires[0].telephonePortable = '699';
    cmp.newClient.signataires[0].email = 'invalide';
    cmp.doCreate();
    expect(cmp.createError()).toContain('e-mail');

    cmp.newClient.signataires[0].email = 'jean@d.cm';
    cmp.newClient.sousComptes[0].numero = '';
    cmp.doCreate();
    expect(cmp.createError()).toContain('sous-compte');
    expect(data.createClientDossier).not.toHaveBeenCalled();
  });

  it('doCreate — succès affiche les identifiants initiaux', () => {
    cmp.openCreate();
    cmp.newClient.raisonSociale = 'Client';
    cmp.newClient.signataires[0].nom = 'Dupont';
    cmp.newClient.signataires[0].telephonePortable = '699';
    cmp.newClient.signataires[0].email = 'jean@d.cm';
    cmp.newClient.sousComptes[0].numero = 'SC-1';
    cmp.doCreate();
    expect(data.createClientDossier).toHaveBeenCalled();
    expect(cmp.createOpen()).toBe(false);
    expect(cmp.initialCreds()).toEqual({ email: 'jean@d.cm', password: 'secret123' });
  });

  it('doCreate — succès mais mot de passe indisponible → toast', () => {
    api.getInitialPassword.mockReturnValueOnce(throwError(() => new Error('x')));
    cmp.openCreate();
    cmp.newClient.raisonSociale = 'Client';
    cmp.newClient.signataires[0].nom = 'Dupont';
    cmp.newClient.signataires[0].telephonePortable = '699';
    cmp.newClient.signataires[0].email = 'jean@d.cm';
    cmp.newClient.sousComptes[0].numero = 'SC-1';
    cmp.doCreate();
    expect(toast.success).toHaveBeenCalledWith('Client créé', expect.any(String));
  });

  it('doCreate — refus serveur affiche l’erreur', () => {
    data.createClientDossier.mockReturnValueOnce(of({ ok: false, client: null, error: 'ISIN doublon' }));
    cmp.openCreate();
    cmp.newClient.raisonSociale = 'Client';
    cmp.newClient.signataires[0].nom = 'Dupont';
    cmp.newClient.signataires[0].telephonePortable = '699';
    cmp.newClient.signataires[0].email = 'jean@d.cm';
    cmp.newClient.sousComptes[0].numero = 'SC-1';
    cmp.doCreate();
    expect(cmp.createError()).toBe('ISIN doublon');
  });

  it('viewInitialPassword — disponible / indisponible / erreur / sans uid', () => {
    cmp.viewInitialPassword({ id: 'u-1', email: 'x@y.cm' } as any);
    expect(cmp.initialCreds()).toEqual({ email: 'x@y.cm', password: 'secret123' });

    api.getInitialPassword.mockReturnValueOnce(of({ password: null, available: false }));
    cmp.viewInitialPassword({ id: 'u-1' });
    expect(toast.info).toHaveBeenCalledWith('Indisponible', expect.any(String));

    api.getInitialPassword.mockReturnValueOnce(throwError(() => new Error('x')));
    cmp.viewInitialPassword({ id: 'u-1' });
    expect(toast.error).toHaveBeenCalledWith('Erreur', expect.any(String));

    api.getInitialPassword.mockClear();
    cmp.viewInitialPassword({});
    expect(api.getInitialPassword).not.toHaveBeenCalled();
  });

  it('copyInitialPassword copie ou ignore', () => {
    cmp.initialCreds.set({ email: 'x', password: 'pw' });
    cmp.copyInitialPassword();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('pw');
    cmp.initialCreds.set(null);
    (navigator.clipboard.writeText as any).mockClear();
    cmp.copyInitialPassword();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it('openEdit préremplit le formulaire d’édition', () => {
    const c = makeClient({ id: 'CLI-9', type: 'PM', raisonSociale: 'Beta SARL', rccm: 'RC-1' });
    cmp.openEdit(c);
    expect(cmp.editOpen()).toBe(true);
    expect(cmp.editType()).toBe('PM');
    expect(cmp.editClient.raisonSociale).toBe('Beta SARL');
    expect(cmp.editClient.nom).toBe('Dupont');
  });

  it('doEdit — validations puis succès', () => {
    const c = makeClient({ id: 'CLI-9' });
    cmp.openEdit(c);

    cmp.editClient.raisonSociale = '';
    cmp.doEdit();
    expect(cmp.editError()).toContain('obligatoire');

    cmp.editClient.raisonSociale = 'Nom';
    cmp.editClient.nom = '';
    cmp.doEdit();
    expect(cmp.editError()).toContain('contact');

    cmp.editClient.nom = 'Dupont';
    cmp.editClient.email = 'invalide';
    cmp.doEdit();
    expect(cmp.editError()).toContain('e-mail');

    cmp.editClient.email = 'jean@d.cm';
    cmp.doEdit();
    expect(api.updateClient).toHaveBeenCalled();
    expect(cmp.editOpen()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Client modifié', expect.any(String));
  });

  it('doEdit — erreur serveur affiche le message', () => {
    const c = makeClient({ id: 'CLI-9' });
    cmp.openEdit(c);
    api.updateClient.mockReturnValueOnce(throwError(() => ({ error: { message: 'Conflit' } })));
    cmp.doEdit();
    expect(cmp.editError()).toBe('Conflit');
  });

  it('askDeactivate / doDeactivate — succès', () => {
    const c = makeClient({ id: 'CLI-9' });
    cmp.askDeactivate(c);
    expect(cmp.confirmOpen()).toBe(true);
    cmp.doDeactivate();
    expect(api.deactivateClient).toHaveBeenCalledWith('CLI-9');
    expect(cmp.confirmOpen()).toBe(false);
    expect(toast.success).toHaveBeenCalledWith('Client désactivé', expect.any(String));
  });

  it('doDeactivate — sans cible ferme simplement', () => {
    cmp.doDeactivate();
    expect(cmp.confirmOpen()).toBe(false);
    expect(api.deactivateClient).not.toHaveBeenCalled();
  });

  it('doDeactivate — erreur serveur notifie', () => {
    const c = makeClient({ id: 'CLI-9' });
    cmp.askDeactivate(c);
    api.deactivateClient.mockReturnValueOnce(throwError(() => ({ error: { error: 'Impossible' } })));
    cmp.doDeactivate();
    expect(toast.error).toHaveBeenCalledWith('Échec', 'Impossible');
  });
});

// ═══════════════════════════════ BoAudit ════════════════════════════════════

describe('BoAudit', () => {
  let cmp: BoAudit;
  let data: ReturnType<typeof makeMockData>;
  let toast: ReturnType<typeof makeToast>;

  function build(audit: any[] = []) {
    TestBed.resetTestingModule(); // rejouable depuis un test
    data = makeMockData({ audit });
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoAudit],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ToastService, useValue: toast },
      ],
    });
    cmp = TestBed.createComponent(BoAudit).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    setupBrowserStubs();
    build();
  });
  afterEach(() => vi.clearAllMocks());

  it('recharge l’audit à la construction', () => {
    expect(data.refreshAudit).toHaveBeenCalled();
  });

  it('filtered applique recherche, résultat et plage de dates', () => {
    build([
      makeAudit({ id: 'a1', utilisateur: 'alice', action: 'LOGIN', resultat: 'SUCCES', horodatage: '2026-06-01 10:00', reference: 'R1' }),
      makeAudit({ id: 'a2', utilisateur: 'bob', action: 'REJET', resultat: 'ECHEC', horodatage: '2026-06-20 10:00', reference: 'R2' }),
    ]);
    cmp.fSearch.set('alice');
    expect(cmp.filtered().map((a) => a.id)).toEqual(['a1']);
    cmp.fSearch.set('');
    cmp.fRes.set('ECHEC');
    expect(cmp.filtered().map((a) => a.id)).toEqual(['a2']);
    cmp.fRes.set('');
    cmp.fDateDu.set('2026-06-10');
    expect(cmp.filtered().map((a) => a.id)).toEqual(['a2']);
    cmp.fDateDu.set('');
    cmp.fDateAu.set('2026-06-10');
    expect(cmp.filtered().map((a) => a.id)).toEqual(['a1']);
  });

  it('exportCsv télécharge et notifie', () => {
    build([makeAudit({ id: 'a1' })]);
    cmp.exportCsv();
    expect(downloadClicks).toContain('audit-log.csv');
    expect(toast.success).toHaveBeenCalledWith('Audit exporté', expect.any(String));
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  RENDU DES GABARITS INLINE — on instancie réellement les composants et on
//  pilote chaque branche @if / @else / @for des `template:` afin de couvrir les
//  lignes de gabarit (comptées dans le fichier source). Les assertions portent
//  sur le DOM réellement produit (nombre de lignes, textes, boutons, modales).
// ════════════════════════════════════════════════════════════════════════════

// ─────────────────────────── BoDashboard (rendu) ────────────────────────────

describe('BoDashboard (rendu)', () => {
  let fixture: ComponentFixture<BoDashboard>;
  let cmp: BoDashboard;
  let data: ReturnType<typeof makeMockData>;
  let el: HTMLElement;

  function build(orders: any[]) {
    TestBed.resetTestingModule();
    data = makeMockData({ orders });
    TestBed.configureTestingModule({
      imports: [BoDashboard],
      providers: [{ provide: MockData, useValue: data }],
    });
    fixture = TestBed.createComponent(BoDashboard);
    cmp = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => vi.clearAllMocks());

  it('sans ordre : affiche le message vide et le donut « aucune donnée »', () => {
    build([]);
    fixture.detectChanges();
    // Une ligne de tableau, message d'absence d'ordre.
    const rows = el.querySelectorAll('.card table tbody tr');
    expect(rows).toHaveLength(1);
    expect(el.textContent).toContain('Aucun ordre collecté pour le moment.');
    // Branche @else du donut (byNature vide).
    expect(el.textContent).toContain('Aucun ordre collecté.');
    expect(el.querySelector('afb-donut-chart')).toBeNull();
    // KPI clients = 0.
    expect(el.querySelector('.kpi-value')?.textContent?.trim()).toBe('0');
  });

  it('avec ordres : liste triée, badges nature et donut BTA/OTA', () => {
    build([
      makeOrder({ id: 'd1', nature: 'BTA', status: 'SOUMIS', clientNom: 'ACME', montant: 1_000_000, dateSoumission: '2026-06-15 09:00' }),
      makeOrder({ id: 'd2', nature: 'OTA', status: 'ANNULE', clientNom: 'BETA', montant: 2_000_000, dateSoumission: '2026-06-16 09:00' }),
    ]);
    fixture.detectChanges();
    const rows = el.querySelectorAll('.card table tbody tr');
    expect(rows).toHaveLength(2); // pas de ligne « vide »
    // Le donut s'affiche (byNature non vide).
    expect(el.querySelector('afb-donut-chart')).not.toBeNull();
    // Badges de nature BTA et OTA présents.
    const natureBadges = Array.from(el.querySelectorAll('.badge')).map(b => b.textContent?.trim());
    expect(natureBadges).toContain('BTA');
    expect(natureBadges).toContain('OTA');
    // Montant formaté fr-FR (espace insécable comme séparateur de milliers).
    expect(el.textContent).toMatch(/1[\s  ]000[\s  ]000/);
  });
});

// ─────────────────────────── BoEmissions (rendu) ────────────────────────────

describe('BoEmissions (rendu)', () => {
  let fixture: ComponentFixture<BoEmissions>;
  let cmp: BoEmissions;
  let data: ReturnType<typeof makeMockData>;
  let api: ReturnType<typeof makeApi>;
  let toast: ReturnType<typeof makeToast>;
  let el: HTMLElement;

  function build(opts: { permissions?: string[]; emissions?: any[] } = {}) {
    TestBed.resetTestingModule();
    data = makeMockData(opts);
    api = makeApi();
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoEmissions],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    fixture = TestBed.createComponent(BoEmissions);
    cmp = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => { TestBed.resetTestingModule(); setupBrowserStubs(); });
  afterEach(() => vi.clearAllMocks());

  function btnByText(txt: string): HTMLButtonElement | undefined {
    return Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === txt) as HTMLButtonElement | undefined;
  }

  it('liste vide : message d’absence et checkboxes de config présentes', () => {
    build();
    fixture.detectChanges();
    expect(el.textContent).toContain('Aucune émission ne correspond aux filtres');
    // 4 statuts cochables dans la config marché.
    const boxes = el.querySelectorAll('.card-body input[type="checkbox"]');
    expect(boxes.length).toBe(4);
  });

  it('une ligne par statut : actions conditionnelles Modifier/Consulter/Publier/Clôturer/Archiver', () => {
    build({
      emissions: [
        makeEmission({ id: 'e-1', status: 'BROUILLON', libelle: 'BR', code: 'BR' }),
        makeEmission({ id: 'e-2', status: 'PUBLIE', libelle: 'PU', code: 'PU' }),
        makeEmission({ id: 'e-3', status: 'CLOTURE', libelle: 'CL', code: 'CL' }),
        makeEmission({ id: 'e-4', status: 'ARCHIVE', libelle: 'AR', code: 'AR' }),
      ],
    });
    fixture.detectChanges();
    const rows = el.querySelectorAll('.card table tbody tr');
    expect(rows).toHaveLength(4);
    const txt = el.textContent ?? '';
    expect(txt).toContain('Modifier');   // BROUILLON/PUBLIE
    expect(txt).toContain('Consulter');  // CLOTURE/ARCHIVE
    expect(txt).toContain('Publier');    // BROUILLON
    expect(txt).toContain('Rejeter');    // BROUILLON
    expect(txt).toContain('Clôturer');   // PUBLIE
    expect(txt).toContain('Archiver');   // CLOTURE
    // Seul le BROUILLON expose une checkbox de sélection en ligne.
    const rowChecks = el.querySelectorAll('.card table tbody input[type="checkbox"]');
    expect(rowChecks).toHaveLength(1);
    // Badges de statut traduits.
    expect(txt).toContain('Brouillon');
    expect(txt).toContain('Publié');
  });

  it('bouton « Publier tous les brouillons » visible avec permission + brouillons', () => {
    build({ permissions: ['EMISSION_VALIDATE'], emissions: [makeEmission({ status: 'BROUILLON' })] });
    fixture.detectChanges();
    expect(el.textContent).toContain('Publier tous les brouillons (1)');
  });

  it('barre d’actions en masse affichée quand un brouillon est sélectionné', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' })] });
    cmp.toggleSelect('e-1');
    fixture.detectChanges();
    expect(el.textContent).toContain('en BROUILLON sélectionnée');
    expect(btnByText('✕ Rejeter en masse')).toBeTruthy();
  });

  it('formulaire nouvelle émission : titre « Saisie » et boutons de création', () => {
    build();
    cmp.newEmission();
    fixture.detectChanges();
    expect(el.textContent).toContain('Saisie nouvelle émission');
    expect(btnByText('Enregistrer brouillon')).toBeTruthy();
    expect(btnByText('Valider & Publier')).toBeTruthy();
  });

  it('formulaire édition d’une fiche publiée : bandeau re-validation + bouton modifications', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'PUBLIE' })] });
    cmp.edit('e-1');
    fixture.detectChanges();
    expect(el.textContent).toContain("Modification d'une fiche publiée");
    expect(btnByText('Enregistrer modifications')).toBeTruthy();
  });

  it('formulaire lecture seule (CLOTURE) : bandeau verrou + bouton Fermer', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'CLOTURE' })] });
    cmp.viewReadOnly('e-1');
    fixture.detectChanges();
    expect(el.textContent).toContain('Fiche en lecture seule');
    expect(btnByText('Fermer')).toBeTruthy();
    // Aucun bouton d'enregistrement en lecture seule.
    expect(btnByText('Enregistrer modifications')).toBeUndefined();
  });

  it('bannière de motif de rejet affichée en édition', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' })] });
    cmp.edit('e-1');
    cmp.newE.rejectionMotif = 'Taux incohérent';
    cmp.newE.rejectedAt = '2026-06-01';
    cmp.newE.rejectedBy = 'superviseur';
    flush(fixture);
    expect(el.textContent).toContain('Fiche rejetée par le superviseur');
    expect(el.textContent).toContain('Taux incohérent');
  });

  it('modale de diffusion : aperçu avec objet, destinataires et corps', () => {
    build({ emissions: [makeEmission({ status: 'PUBLIE', isin: 'CM1300001268' })] });
    cmp.openBroadcast();
    cmp.previewRecipients.set(['a@x.cm', 'b@x.cm', 'c@x.cm', 'd@x.cm']);
    cmp.showPreview.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain('Diffuser le catalogue par e-mail');
    expect(el.textContent).toContain('Marché primaire CEMAC');
    expect(el.textContent).toContain('4 destinataire(s)');
    expect(el.textContent).toContain('a@x.cm, b@x.cm, c@x.cm, +1');
  });

  it('modale de rejet superviseur : cible et bouton désactivé sans motif', () => {
    build({ emissions: [makeEmission({ id: 'e-1', code: 'CODE-X', isin: 'CM1300001268' })] });
    cmp.askReject('e-1');
    fixture.detectChanges();
    expect(el.textContent).toContain('Rejeter la fiche émission');
    expect(el.textContent).toContain('CODE-X');
    const confirmBtn = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Confirmer le rejet') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
  });

  it('modale historique : entrées listées puis état vide', () => {
    build({ emissions: [makeEmission({ id: 'e-1', libelle: 'HIST', code: 'HIST' })] });
    data.getEmissionHistory.mockReturnValue([
      { id: 'h1', horodatage: '2026-06-01 10:00', action: 'CREATION', utilisateur: 'agent1', utilisateurNom: 'Agent Un', ip: '10.0.0.1', resultat: 'SUCCES' },
      { id: 'h2', horodatage: '2026-06-02 10:00', action: 'REJET', utilisateur: 'sup', ip: '10.0.0.2', resultat: 'ECHEC' },
    ] as any);
    cmp.viewHistory('e-1');
    fixture.detectChanges();
    expect(el.textContent).toContain('Historique des modifications');
    expect(el.textContent).toContain('CREATION');
    expect(el.textContent).toContain('REJET');
  });

  it('modale historique : état vide (branche @else)', () => {
    build({ emissions: [makeEmission({ id: 'e-1', libelle: 'HIST', code: 'HIST' })] });
    data.getEmissionHistory.mockReturnValue([] as any);
    cmp.viewHistory('e-1');
    fixture.detectChanges();
    expect(el.textContent).toContain('Historique des modifications');
    expect(el.textContent).toContain('Aucun événement');
  });

  it('modales de confirmation/rejet en masse rendues à l’ouverture', () => {
    build({ emissions: [makeEmission({ id: 'e-1', status: 'BROUILLON' })] });
    cmp.confirmOpen.set(true);
    cmp.bulkRejectOpen.set(true);
    fixture.detectChanges();
    expect(el.textContent).toContain("Supprimer l'émission ?");
    expect(el.textContent).toContain('Rejet en masse');
  });
});

// ──────────────────────────── BoOrders (rendu) ──────────────────────────────

describe('BoOrders (rendu)', () => {
  let fixture: ComponentFixture<BoOrders>;
  let cmp: BoOrders;
  let data: ReturnType<typeof makeMockData>;
  let api: ReturnType<typeof makeApi>;
  let toast: ReturnType<typeof makeToast>;
  let pdf: ReturnType<typeof makePdf>;
  let el: HTMLElement;

  function build(opts: { permissions?: string[]; orders?: any[]; emissions?: any[] } = {}) {
    TestBed.resetTestingModule();
    data = makeMockData(opts);
    api = makeApi();
    toast = makeToast();
    pdf = makePdf();
    TestBed.configureTestingModule({
      imports: [BoOrders],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: PdfProgressService, useValue: pdf },
      ],
    });
    fixture = TestBed.createComponent(BoOrders);
    cmp = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => { TestBed.resetTestingModule(); setupBrowserStubs(); });
  afterEach(() => vi.clearAllMocks());

  /** Ordre riche couvrant un maximum de branches de la modale de détail. */
  function fullOrder(over: any = {}) {
    return makeOrder({
      id: 'o-1', status: 'SOUMIS',
      signatureData: 'data:image/png;base64,AAAA', signatureVerified: false, signatureDate: '2026-06-15',
      notes: 'Note interne', validatedByAgent: 'agent1', validatedByAgentNom: 'Agent Un',
      dateValidationAgent: '2026-06-16', ipSoumission: '10.0.0.1', volumeAlloue: 5, montantDebite: 500,
      tauxAdjuge: 6.1, updatedAt: '2026-06-17',
      ...over,
    });
  }

  it('liste vide : message d’absence de ligne', () => {
    build();
    fixture.detectChanges();
    expect(el.textContent).toContain('Aucun ordre ne correspond aux filtres');
  });

  it('liste peuplée + KPIs + bouton adjudication conditionnel', () => {
    build({
      orders: [makeOrder({ id: 'o-1', status: 'SOUMIS', reference: 'REF-1' }), makeOrder({ id: 'o-2', status: 'ANNULE', reference: 'REF-2' })],
      emissions: [makeEmission({ id: 'e-1' })],
    });
    cmp.filterEmission.set('e-1'); // active le bouton d'adjudication
    fixture.detectChanges();
    const rows = el.querySelectorAll('.card table tbody tr');
    expect(rows).toHaveLength(2);
    expect(el.textContent).toContain("Lancer l'adjudication");
    // KPI « Total filtré » reflète les 2 ordres.
    expect(el.querySelector('.kpi .kpi-value')?.textContent?.trim()).toBe('2');
  });

  it('barre d’actions en masse avec total et boutons désactivés', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS', montant: 100 })] });
    cmp.selected.set(['o-1']);
    fixture.detectChanges();
    expect(el.textContent).toContain('ordre sélectionné');
    const transmit = Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes('Transmettre')) as HTMLButtonElement;
    expect(transmit).toBeTruthy();
    expect(transmit.disabled).toBe(false); // SOUMIS est transmissible
  });

  it('menu contextuel de ligne : actions selon statut modifiable', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS', reference: 'REF-M' })] });
    cmp.rowMenuId.set('o-1');
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain('Voir le détail');
    expect(txt).toContain("Valider l'ordre");
    expect(txt).toContain('Vérifier les fonds');
    expect(txt).toContain('Changer le statut');
  });

  it('menu contextuel : statut verrouillé (branche @else)', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'ANNULE' })] });
    cmp.rowMenuId.set('o-1');
    fixture.detectChanges();
    expect(el.textContent).toContain('statut verrouillé');
  });

  it('modale détail (SOUMIS) : stepper, signature, notes, menu actions, historique', () => {
    build({ orders: [fullOrder({ resultatPropose: 'TOTALEMENT_RETENU' })], permissions: ['ORDER_RESULT_VALIDATE'] });
    data.getOrderHistory.mockReturnValue([
      { id: 'h1', horodatage: '2026-06-15 09:00', action: 'SOUMISSION', utilisateur: 'client', resultat: 'SUCCES' },
    ] as any);
    cmp.openDetail('o-1');
    cmp.actionsOpen.set(true);
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain('Suivi du workflow');
    // Superviseur : bloc de validation de l'adjudication proposée.
    expect(txt).toContain('Adjudication à valider');
    expect(txt).toContain('Résultat saisi par');
    expect(el.querySelector('afb-signature-viewer')).not.toBeNull();
    expect(txt).toContain('Notes back-office');
    expect(txt).toContain('SOUMISSION'); // historique non vide
    // Menu actions ouvert : validation + verrouillage disponibles.
    expect(txt).toContain("Valider l'ordre");
    expect(txt).toContain('Télécharger & Transmettre');
  });

  it('modale détail (EN_ATTENTE_ADJUDICATION) : bannière back-office + saisie résultat', () => {
    build({ orders: [fullOrder({ status: 'EN_ATTENTE_ADJUDICATION' })] });
    cmp.openDetail('o-1');
    cmp.actionsOpen.set(true);
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain('Ordre validé par le back-office');
    expect(txt).toContain("Saisir résultat d'adjudication");
    // Historique vide → branche @else.
    expect(txt).toContain('Aucun événement');
  });

  it('modale détail (TOTALEMENT_RETENU) : bannières verrou/commentaire + avis + statut verrouillé', () => {
    build({ orders: [fullOrder({ status: 'TOTALEMENT_RETENU', printedBySvt: true, printedBy: 'Agent SVT', printedAt: '2026-06-18', commentaireResultat: 'Adjugé au taux marginal' })] });
    cmp.openDetail('o-1');
    cmp.actionsOpen.set(true);
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain('Ordre verrouillé');
    expect(txt).toContain("Commentaire de l'agent SVT");
    expect(txt).toContain("Générer l'avis d'opéré");
    expect(txt).toContain('statut verrouillé'); // canChangeStatus=false → @else
  });

  it('modale détail (ANNULE) : motif de rejet visible', () => {
    build({ orders: [fullOrder({ status: 'ANNULE', motifAnnulation: 'Provision insuffisante', rejectedByAgent: 'agent1', dateRejetAgent: '2026-06-16' })] });
    cmp.openDetail('o-1');
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain('Ordre annulé / rejeté');
    expect(txt).toContain('Motif de rejet');
    expect(txt).toContain('Provision insuffisante');
  });

  it('modale de changement de statut : champ volume pour PARTIELLEMENT_RETENU', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS', reference: 'REF-S' })] });
    cmp.openChangeStatus('o-1');
    cmp.newStatus = 'PARTIELLEMENT_RETENU';
    flush(fixture);
    expect(el.textContent).toContain("Modifier le statut de l'ordre");
    expect(el.textContent).toContain('Volume alloué');
  });

  it('modale de saisie résultat : montant + commentaire + taux (partiel)', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'EN_ATTENTE_ADJUDICATION', montant: 1000 })] });
    cmp.openSaisieResultat('o-1');
    cmp.resultatChoix.set('PARTIELLEMENT_RETENU');
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain("Saisie du résultat d'adjudication");
    expect(txt).toContain('Montant adjugé');
    expect(txt).toContain('Commentaire / motif');
    expect(txt).toContain('Taux adjugé');
    expect(txt).toContain('Livrable auto-généré');
  });

  it('modale de rejet d’ordre : cible et sélection de motif', () => {
    build({ orders: [makeOrder({ id: 'o-1', reference: 'REF-R', clientNom: 'ACME', montant: 5000 })] });
    cmp.askReject('o-1');
    fixture.detectChanges();
    expect(el.textContent).toContain("Rejeter l'ordre");
    expect(el.textContent).toContain('REF-R');
    // Le select de motifs prédéfinis est rendu.
    expect(el.querySelector('select[name="rom"]')).not.toBeNull();
  });

  it('modales en masse / double-signature / annulation / adjudication rendues', () => {
    build({ orders: [makeOrder({ id: 'o-1', status: 'SOUMIS' })] });
    cmp.selected.set(['o-1']);
    cmp.bulkRejectOpen.set(true);
    cmp.signOpen.set(true);
    cmp.signMessage.set('Double signature');
    cmp.confirmBulk.set(true);
    cmp.adjudicationOpen.set(true);
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain('Rejet en masse');
    expect(txt).toContain('Validation à double signature');
    expect(txt).toContain('Annuler les ordres sélectionnés ?');
    expect(txt).toContain("Lancer l'adjudication de l'émission ?");
  });
});

// ──────────────────────────── BoClients (rendu) ─────────────────────────────

describe('BoClients (rendu)', () => {
  let fixture: ComponentFixture<BoClients>;
  let cmp: BoClients;
  let data: ReturnType<typeof makeMockData>;
  let api: ReturnType<typeof makeApi>;
  let toast: ReturnType<typeof makeToast>;
  let el: HTMLElement;

  function build(clients: any[] = []) {
    TestBed.resetTestingModule();
    data = makeMockData({ clients });
    api = makeApi();
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoClients],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    fixture = TestBed.createComponent(BoClients);
    cmp = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => { TestBed.resetTestingModule(); setupBrowserStubs(); });
  afterEach(() => vi.clearAllMocks());

  /** Client PM riche : sous-comptes, contacts variés et adresses. */
  function richClient() {
    return makeClient({
      id: 'CLI-9', type: 'PM', raisonSociale: 'Beta SARL', rccm: 'RC-1',
      compte: {
        id: 'CLI-9', numero: 'CT-900', categorie: 'QUALIFIE', statut: 'ACTIF', typeCompte: 'JOINT',
        compteEspecesLie: '00099999',
        sousComptes: [{ id: 'sc1', numero: 'SC-1', libelle: 'Conservation', type: 'CONSERVATION', statut: 'ACTIF', positionsCount: 3, valeurTotale: 1_500_000 }],
        contacts: [
          { id: 'c1', type: 'TITULAIRE', civilite: 'Monsieur', nom: 'Dupont', prenom: 'Jean', fonction: 'DG', telephonePortable: '699', email: 'jean@d.cm' },
          { id: 'c2', type: 'REPRESENTANT_LEGAL', nom: 'Martin', prenom: 'Paul' },
          { id: 'c3', type: 'CONTACT_ORDRE', nom: 'Sy', prenom: 'Ama' },
          { id: 'c4', type: 'URGENCE', nom: 'Ba', prenom: 'Ali' },
        ],
        adresses: [{ type: 'SIEGE', rue: 'Rue 1', ville: 'Douala', pays: 'Cameroun', codePostal: 'BP1' }],
      },
    });
  }

  it('liste vide : message d’absence', () => {
    build();
    fixture.detectChanges();
    expect(el.textContent).toContain('Aucun client ne correspond aux filtres');
  });

  it('liste peuplée : lignes PP/PM, RCCM, catégorie, statut', () => {
    build([
      makeClient({ id: 'CLI-1', type: 'PP', raisonSociale: 'Alpha' }),
      makeClient({ id: 'CLI-2', type: 'PM', raisonSociale: 'Beta', rccm: 'RC-2', compte: { numero: 'CT-2', categorie: 'QUALIFIE', statut: 'BLOQUE', compteEspecesLie: '2', sousComptes: [], contacts: [], adresses: [] } }),
    ]);
    fixture.detectChanges();
    const rows = el.querySelectorAll('.card table tbody tr');
    expect(rows).toHaveLength(2);
    const txt = el.textContent ?? '';
    expect(txt).toContain('RCCM RC-2');
    expect(txt).toContain('Qualifié');
    expect(txt).toContain('BLOQUE');
    // KPI personnes morales = 1.
    expect(cmp.countPm()).toBe(1);
  });

  it('dossier client : sous-comptes, contacts variés, adresses', () => {
    build([richClient()]);
    cmp.open(cmp.data.clientsRegistry()[0]);
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain('Dossier client');
    expect(txt).toContain('SC-1');                  // sous-compte
    expect(txt).toContain('REPRESENTANT LEGAL');    // type de contact (underscore remplacé)
    expect(txt).toContain('URGENCE');
    expect(txt).toContain('Douala');                // adresse
    // Client actif → bouton Désactiver visible.
    expect(Array.from(el.querySelectorAll('button')).some(b => b.textContent?.includes('Désactiver'))).toBe(true);
  });

  it('modale de création : bascule PM affiche RCCM, forme juridique et sous-compte gagé', () => {
    build();
    cmp.openCreate();
    cmp.setType('PM');
    cmp.newClient.typeCompte = 'JOINT';
    cmp.newClient.sousComptes[0].type = 'NANTISSEMENT';
    cmp.createError.set('Le nom est obligatoire.');
    flush(fixture);
    const txt = el.textContent ?? '';
    expect(txt).toContain("Création d'un nouveau client");
    expect(txt).toContain('N° RCCM');
    expect(txt).toContain('Signataires autorisés');   // PM/JOINT
    expect(txt).toContain('Observations');            // NANTISSEMENT → champ observations
    expect(txt).toContain('Le nom est obligatoire.'); // bandeau d'erreur
  });

  it('overlay des identifiants initiaux affiché', () => {
    build();
    cmp.initialCreds.set({ email: 'jean@d.cm', password: 'secret123' });
    fixture.detectChanges();
    const txt = el.textContent ?? '';
    expect(txt).toContain('Identifiants de connexion du client');
    expect((el.querySelector('input[readonly]') as HTMLInputElement)?.value).toBe('jean@d.cm');
  });

  it('modale d’édition : préremplissage PM et bandeau d’erreur', () => {
    build([richClient()]);
    cmp.openEdit(cmp.data.clientsRegistry()[0]);
    cmp.editError.set('La raison sociale est obligatoire.');
    flush(fixture);
    const txt = el.textContent ?? '';
    expect(txt).toContain('Modifier le client');
    expect(txt).toContain('Personne morale');
    expect(txt).toContain('RCCM');
    expect(txt).toContain('La raison sociale est obligatoire.');
  });
});

// ───────────────────────────── BoAudit (rendu) ──────────────────────────────

describe('BoAudit (rendu)', () => {
  let fixture: ComponentFixture<BoAudit>;
  let cmp: BoAudit;
  let data: ReturnType<typeof makeMockData>;
  let toast: ReturnType<typeof makeToast>;
  let el: HTMLElement;

  function build(audit: any[] = []) {
    TestBed.resetTestingModule();
    data = makeMockData({ audit });
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoAudit],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ToastService, useValue: toast },
      ],
    });
    fixture = TestBed.createComponent(BoAudit);
    cmp = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => { TestBed.resetTestingModule(); setupBrowserStubs(); });
  afterEach(() => vi.clearAllMocks());

  it('liste vide : message d’absence', () => {
    build();
    fixture.detectChanges();
    expect(el.textContent).toContain('Aucun événement ne correspond aux filtres');
  });

  it('liste peuplée : badges Succès/Échec et ligne de rôle', () => {
    build([
      makeAudit({ id: 'a1', utilisateur: 'alice', utilisateurNom: 'Alice A', utilisateurRole: 'AGENT', action: 'LOGIN', resultat: 'SUCCES' }),
      makeAudit({ id: 'a2', utilisateur: 'bob', utilisateurNom: '', action: 'REJET', resultat: 'ECHEC' }),
    ]);
    fixture.detectChanges();
    const rows = el.querySelectorAll('.card table tbody tr');
    expect(rows).toHaveLength(2);
    const txt = el.textContent ?? '';
    expect(txt).toContain('✓ SUCCES');
    expect(txt).toContain('✕ ECHEC');
    // La ligne secondaire (rôle · identifiant) n'apparaît que si utilisateurNom est présent.
    expect(txt).toContain('AGENT · alice');
  });
});
