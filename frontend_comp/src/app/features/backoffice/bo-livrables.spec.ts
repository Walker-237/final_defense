import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { BoLivrables } from './bo-livrables';
import { ApiService } from '../../core/services/api';
import { AuthService } from '../../core/services/auth-service';
import { ToastService } from '../../core/services/toast';

// ───────────────────────── Fabriques & doubles ──────────────────────────────

function makeClient(over: Partial<any> = {}): any {
  return { id: 'c-1', nom: 'ACME', prenom: '', email: 'acme@x.cm', role: 'CLIENT_PM', statut: 'ACTIF', ...over };
}

function makeDoc(over: Partial<any> = {}): any {
  return {
    id: 'd-1', reference: 'DOC-1', type: 'AVIS_OPERATION', titre: 'Avis', clientId: 'c-1',
    clientNom: 'ACME', uploadedBy: 'agent1', mimeType: 'application/pdf', taille: '1 Ko',
    telechargements: 0, dateGeneration: '2026-06-15', contenu: 'data:application/pdf;base64,AAAA',
    ...over,
  };
}

function makeApi(opts: { clients?: any; documents?: any } = {}) {
  return {
    listClients: vi.fn((): any => opts.clients ?? of([makeClient()])),
    listDocuments: vi.fn((): any => opts.documents ?? of([makeDoc()])),
    getDocument: vi.fn((): any => of(makeDoc())),
    uploadDocument: vi.fn((): any => of(makeDoc({ reference: 'DOC-9', clientNom: 'ACME' }))),
    generateSituationPortefeuille: vi.fn((): any => of(makeDoc({ reference: 'DOC-SIT', clientNom: 'ACME' }))),
    getClientPortfolio: vi.fn((): any => of({
      clientId: 'c-1', lignesActives: 1, valeurTotale: 100, soldeEspeces: null,
      positions: [{ emissionCode: 'BTA-CMR-26-01', isin: 'CM0000000001', nature: 'BTA' }],
    })),
    generateAttestationClient: vi.fn((): any => of(makeDoc({ reference: 'DOC-ATT', clientNom: 'ACME' }))),
  };
}

function makeAuth() {
  return { errorMessage: vi.fn(() => 'Erreur métier.') };
}

function makeToast() {
  return { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function setupBrowserStubs() {
  (URL as any).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as any).revokeObjectURL = vi.fn();
  window.open = vi.fn(() => ({ addEventListener: vi.fn(), print: vi.fn(), document: {} })) as any;
}

/** Attend qu'une condition devienne vraie (FileReader / clipboard asynchrones). */
async function until(pred: () => boolean, ms = 1000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('BoLivrables', () => {
  let cmp: BoLivrables;
  let api: ReturnType<typeof makeApi>;
  let auth: ReturnType<typeof makeAuth>;
  let toast: ReturnType<typeof makeToast>;

  function build(apiOpts: { clients?: any; documents?: any } = {}) {
    TestBed.resetTestingModule();
    api = makeApi(apiOpts);
    auth = makeAuth();
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoLivrables],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ToastService, useValue: toast },
      ],
    });
    cmp = TestBed.createComponent(BoLivrables).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    setupBrowserStubs();
    build();
  });

  it('charge clients et documents à la construction', () => {
    build({ clients: of([makeClient(), makeClient({ id: 'c-2' })]), documents: of([makeDoc()]) });
    expect(cmp.clients()).toHaveLength(2);
    expect(cmp.documents()).toHaveLength(1);
  });

  it('gère les erreurs de chargement (documents vidés)', () => {
    build({ clients: throwError(() => new Error('x')), documents: throwError(() => new Error('y')) });
    expect(cmp.documents()).toEqual([]);
  });

  it('typeLabel renvoie le libellé ou le code brut', () => {
    expect(cmp.typeLabel('AVIS_OPERATION')).toBe("Avis d'opération");
    expect(cmp.typeLabel('INCONNU')).toBe('INCONNU');
  });

  it('humanSize couvre octets, kilo-octets et méga-octets', () => {
    expect((cmp as any).humanSize(500)).toBe('500 o');
    expect((cmp as any).humanSize(2048)).toBe('2 Ko');
    expect((cmp as any).humanSize(1_572_864)).toBe('1.5 Mo');
  });

  // ── onFile ──
  it('onFile ignore l’absence de fichier', () => {
    const ev = { target: { files: [] } } as unknown as Event;
    cmp.onFile(ev);
    expect(cmp.errorMsg()).toBe('');
  });

  it('onFile refuse un fichier trop volumineux', () => {
    const big = new File(['x'], 'gros.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 16 * 1024 * 1024 });
    const input = { files: [big], value: 'gros.pdf' };
    cmp.onFile({ target: input } as unknown as Event);
    expect(cmp.errorMsg()).toContain('trop volumineux');
    expect(input.value).toBe('');
  });

  it('onFile refuse un type MIME non autorisé', () => {
    const file = new File(['x'], 'evil.exe', { type: 'application/x-msdownload' });
    const input = { files: [file], value: 'evil.exe' };
    cmp.onFile({ target: input } as unknown as Event);
    expect(cmp.errorMsg()).toContain('non autorisé');
    expect(input.value).toBe('');
  });

  it('onFile lit un fichier valide et pré-remplit le formulaire', async () => {
    const file = new File(['hello'], 'releve.pdf', { type: 'application/pdf' });
    const input = { files: [file], value: 'releve.pdf' };
    cmp.onFile({ target: input } as unknown as Event);
    await until(() => cmp.form.contenu !== '');
    expect(cmp.form.fileName).toBe('releve.pdf');
    expect(cmp.form.titre).toBe('releve.pdf'); // titre par défaut = nom du fichier
    expect(cmp.form.mimeType).toBe('application/pdf');
    expect(cmp.form.contenu.startsWith('data:')).toBe(true);
  });

  // ── upload : validation ──
  it('upload exige un client destinataire', () => {
    cmp.upload();
    expect(cmp.errorMsg()).toContain('client destinataire');
    expect(api.uploadDocument).not.toHaveBeenCalled();
  });

  it('upload exige un fichier', () => {
    cmp.form.clientId = 'c-1';
    cmp.upload();
    expect(cmp.errorMsg()).toContain('Sélectionnez un fichier');
  });

  it('upload exige un intitulé', () => {
    cmp.form.clientId = 'c-1';
    cmp.form.contenu = 'data:application/pdf;base64,AAAA';
    cmp.form.titre = '   ';
    cmp.upload();
    expect(cmp.errorMsg()).toContain('intitulé');
  });

  it('upload réussi notifie, réinitialise et recharge', () => {
    cmp.form = { clientId: 'c-1', type: 'AVIS_OPERATION', titre: 'Mon avis', fileName: 'a.pdf', mimeType: 'application/pdf', taille: '1 Ko', contenu: 'data:application/pdf;base64,AAAA' };
    cmp.upload();
    expect(api.uploadDocument).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Livrable transmis', expect.stringContaining('DOC-9'));
    expect(cmp.form.clientId).toBe('');
    expect(cmp.saving()).toBe(false);
  });

  it('upload en échec affiche le message d’erreur', () => {
    api.uploadDocument.mockReturnValueOnce(throwError(() => new Error('boom')));
    cmp.form = { clientId: 'c-1', type: 'AVIS_OPERATION', titre: 'X', fileName: '', mimeType: '', taille: '', contenu: 'data:application/pdf;base64,AAAA' };
    cmp.upload();
    expect(cmp.saving()).toBe(false);
    expect(cmp.errorMsg()).toBe('Erreur métier.');
    expect(auth.errorMessage).toHaveBeenCalled();
  });

  it('upload utilise un mimeType par défaut si absent', () => {
    cmp.form = { clientId: 'c-1', type: 'AUTRE', titre: 'X', fileName: '', mimeType: '', taille: '', contenu: 'data:application/pdf;base64,AAAA' };
    cmp.upload();
    expect(api.uploadDocument).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'application/pdf' }));
  });

  // ── situation de portefeuille ──
  it('genererSituation exige un client', () => {
    cmp.situForm = { clientId: '', periode: '', service: 'TRESORERIE' };
    cmp.genererSituation();
    expect(cmp.situError()).toContain('client');
    expect(api.generateSituationPortefeuille).not.toHaveBeenCalled();
  });

  it('genererSituation transmet le relevé et l’ouvre', () => {
    cmp.situForm = { clientId: 'c-1', periode: '2026-06-16', service: 'TRESORERIE' };
    cmp.genererSituation();
    expect(api.generateSituationPortefeuille).toHaveBeenCalledWith({
      clientId: 'c-1', periode: '2026-06-16', service: 'TRESORERIE',
    });
    expect(toast.success).toHaveBeenCalledWith('Situation transmise', expect.stringContaining('DOC-SIT'));
    expect(cmp.situForm.clientId).toBe('');
    expect(api.getDocument).toHaveBeenCalled(); // aperçu immédiat
  });

  it('genererSituation omet période et service vides', () => {
    cmp.situForm = { clientId: 'c-1', periode: '', service: '' };
    cmp.genererSituation();
    expect(api.generateSituationPortefeuille).toHaveBeenCalledWith({
      clientId: 'c-1', periode: undefined, service: undefined,
    });
  });

  it('genererSituation en échec affiche le message', () => {
    api.generateSituationPortefeuille.mockReturnValueOnce(throwError(() => new Error('boom')));
    cmp.situForm = { clientId: 'c-1', periode: '', service: '' };
    cmp.genererSituation();
    expect(cmp.situError()).toBeTruthy();
    expect(cmp.generatingSitu()).toBe(false);
  });

  // ── attestation de propriété par titre ──
  it('onAttClient charge les titres du client sélectionné', () => {
    cmp.onAttClient('c-1');
    expect(api.getClientPortfolio).toHaveBeenCalledWith('c-1');
    expect(cmp.attPositions().length).toBe(1);
    expect(cmp.attPositions()[0].isin).toBe('CM0000000001');
  });

  it('onAttClient vide la sélection quand aucun client', () => {
    cmp.attForm.isin = 'X';
    cmp.onAttClient('');
    expect(cmp.attForm.isin).toBe('');
    expect(api.getClientPortfolio).not.toHaveBeenCalled();
  });

  it('genererAttestation exige un client et un titre', () => {
    cmp.attForm = { clientId: 'c-1', isin: '' };
    cmp.genererAttestation();
    expect(api.generateAttestationClient).not.toHaveBeenCalled();
    expect(cmp.attError()).toBeTruthy();
  });

  it('genererAttestation transmet le relevé et l’ouvre', () => {
    cmp.attForm = { clientId: 'c-1', isin: 'CM0000000001' };
    cmp.genererAttestation();
    expect(api.generateAttestationClient).toHaveBeenCalledWith({ clientId: 'c-1', isin: 'CM0000000001' });
    expect(toast.success).toHaveBeenCalledWith('Attestation transmise', expect.stringContaining('DOC-ATT'));
    expect(cmp.attForm.clientId).toBe('');
    expect(api.getDocument).toHaveBeenCalled(); // aperçu immédiat
  });

  it('genererAttestation en échec affiche le message', () => {
    api.generateAttestationClient.mockReturnValueOnce(throwError(() => new Error('boom')));
    cmp.attForm = { clientId: 'c-1', isin: 'CM0000000001' };
    cmp.genererAttestation();
    expect(cmp.attError()).toBeTruthy();
    expect(cmp.generatingAtt()).toBe(false);
  });

  // ── open ──
  it('open (view) ouvre un document consultable puis recharge', async () => {
    api.getDocument.mockReturnValueOnce(of(makeDoc()));
    cmp.open('d-1', 'view');
    await until(() => (window.open as any).mock.calls.length > 0);
    expect(window.open).toHaveBeenCalled();
    expect(api.listDocuments).toHaveBeenCalledTimes(2); // constructeur + rechargement
  });

  it('open (download) notifie le téléchargement', async () => {
    api.getDocument.mockReturnValueOnce(of(makeDoc()));
    cmp.open('d-1', 'download');
    await until(() => toast.success.mock.calls.length > 0);
    expect(toast.success).toHaveBeenCalledWith('Téléchargement', 'DOC-1');
  });

  it('open signale un document sans contenu', () => {
    api.getDocument.mockReturnValueOnce(of(makeDoc({ contenu: '' })));
    cmp.open('d-1', 'view');
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Document indisponible.');
  });

  it('open signale une erreur de récupération', () => {
    api.getDocument.mockReturnValueOnce(throwError(() => new Error('x')));
    cmp.open('d-1', 'view');
    expect(toast.error).toHaveBeenCalledWith('Erreur', 'Document indisponible.');
  });

  it('open capture un contenu illisible (base64 invalide)', async () => {
    api.getDocument.mockReturnValueOnce(of(makeDoc({ contenu: 'data:application/pdf;base64,@@@@' })));
    cmp.open('d-1', 'download');
    await until(() => toast.error.mock.calls.some((c: any[]) => c[1] === "Impossible d'ouvrir le document."));
    expect(toast.error).toHaveBeenCalledWith('Erreur', "Impossible d'ouvrir le document.");
  });
});
