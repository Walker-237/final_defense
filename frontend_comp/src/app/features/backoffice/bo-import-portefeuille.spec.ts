import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal, PLATFORM_ID } from '@angular/core';
import { of, throwError } from 'rxjs';

import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

import { BoImportPortefeuille, construireLignesModele } from './bo-import-portefeuille';
import { ApiService, ClientFbLite } from '../../core/services/api';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';

// L'aperçu formate volume et montant via `number:'1.0-0':'fr-FR'` : la locale est
// enregistrée par app.config.ts, que le TestBed ne charge pas (sinon NG0701).
registerLocaleData(localeFr, 'fr-FR');

// ── Faux moteur ExcelJS (module node → autorisé par vi.mock) ─────────────────
// Un holder mutable, injecté via vi.hoisted, permet de contrôler la feuille lue
// par `parseExcel` test par test.
const excelState = vi.hoisted(() => ({ sheet: null as any, throwOnLoad: false }));

vi.mock('exceljs', () => {
  class Workbook {
    xlsx = {
      load: vi.fn(async () => {
        if (excelState.throwOnLoad) throw new Error('corrompu');
      }),
    };
    get worksheets() {
      return excelState.sheet ? [excelState.sheet] : [];
    }
  }
  return { default: { Workbook } };
});

/** Construit une feuille factice à partir de lignes { colonne → valeur }. */
function makeSheet(rows: Array<Record<number, any>>) {
  return {
    eachRow(_opts: any, cb: (row: any) => void) {
      for (const cells of rows) {
        cb({
          eachCell(_o: any, cb2: (cell: any, col: number) => void) {
            for (const [col, v] of Object.entries(cells)) cb2({ value: v }, Number(col));
          },
        });
      }
    },
  };
}

const HEADER: Record<number, any> = {
  1: 'CODE ISIN', 2: 'DESIGNATION VALEUR', 3: 'EMETTEUR', 4: 'CATEGORIE VALEUR',
  5: 'DATE ECHEANCE', 6: 'DATE ANNIVERSAIRE', 7: 'TAUX FACIAL', 8: 'NOMS ET PRENOMS',
  9: 'MATRICULE CLIENT', 10: 'NUMERO DE COMPTE', 11: 'VOLUME SOUSCRIT', 12: 'ACHAT',
};

// ── Doubles de services ──────────────────────────────────────────────────────

function makeEmission(over: Partial<any> = {}): any {
  return { id: 'e-1', isin: 'CM1300001268', libelle: 'CM BTA', ...over };
}

function makeClientDossier(over: Partial<any> = {}): any {
  return {
    id: 'CLI-1', raisonSociale: 'ACME SA', rccm: 'MAT1',
    compte: { sousComptes: [{ numero: 'CT-001' }] },
    ...over,
  };
}

function makeMockData(opts: { emissions?: any[]; clients?: any[] } = {}) {
  return {
    emissions: signal<any[]>(opts.emissions ?? []),
    clientsRegistry: signal<any[]>(opts.clients ?? []),
    refreshClients: vi.fn(),
    refreshEmissions: vi.fn(),
  };
}

function makeApi() {
  return {
    createEmission: vi.fn((): any => of(makeEmission({ id: 'e-new' }))),
    importPortfolioRows: vi.fn((): any => of({ imported: 1, errors: [] })),
  };
}

function makeToast() {
  return { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Ligne validée prête pour runImport. */
function validatedRow(over: Partial<any> = {}): any {
  return {
    isin: 'CM1300001268', designation: 'CM BTA', emetteur: 'Cameroun', paysCode: 'CMR',
    nature: 'BTA', dateEmission: '2026-05-01', dateEcheance: '2027-05-19', tauxNominal: 5.8,
    clientNom: 'ACME SA', matriculeClient: 'MAT1', numeroCompte: 'CT-001', volume: 10,
    montantAdjuge: 1_000_000, emissionExists: true, clientExists: true, emissionId: 'e-1',
    clientId: 'CLI-1', resolvedCompte: 'CT-001', ...over,
  };
}

describe('BoImportPortefeuille', () => {
  let cmp: BoImportPortefeuille;
  let data: ReturnType<typeof makeMockData>;
  let api: ReturnType<typeof makeApi>;
  let toast: ReturnType<typeof makeToast>;

  function build(opts: { emissions?: any[]; clients?: any[]; platform?: string } = {}) {
    TestBed.resetTestingModule();
    data = makeMockData(opts);
    api = makeApi();
    toast = makeToast();
    TestBed.configureTestingModule({
      imports: [BoImportPortefeuille],
      providers: [
        { provide: MockData, useValue: data },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: PLATFORM_ID, useValue: opts.platform ?? 'browser' },
      ],
    });
    cmp = TestBed.createComponent(BoImportPortefeuille).componentInstance;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    excelState.sheet = null;
    excelState.throwOnLoad = false;
    build();
  });

  it('rafraîchit les clients à l’initialisation', () => {
    cmp.ngOnInit();
    expect(data.refreshClients).toHaveBeenCalled();
  });

  // ── Signaux dérivés ──
  it('calcule les compteurs dérivés des lignes', () => {
    cmp.rows.set([
      validatedRow({ isin: 'A', emissionExists: true, clientExists: true }),
      validatedRow({ isin: 'B', emissionExists: false, clientExists: false }),
      validatedRow({ isin: 'C', error: 'ISIN manquant' }),
    ]);
    expect(cmp.validRows()).toHaveLength(2);
    expect(cmp.errorRows()).toHaveLength(1);
    expect(cmp.newEmissionsCount()).toBe(1);
    expect(cmp.clientsNotFoundCount()).toBe(1);
  });

  it('reset remet l’étape à upload et vide l’état', () => {
    cmp.rows.set([validatedRow()]);
    cmp.step.set('done');
    cmp.progress.set(80);
    cmp.fileName.set('x.xlsx');
    cmp.reset();
    expect(cmp.step()).toBe('upload');
    expect(cmp.rows()).toEqual([]);
    expect(cmp.progress()).toBe(0);
    expect(cmp.fileName()).toBe('');
  });

  // ── Handlers d’évènements ──
  it('onDragOver active le survol', () => {
    const ev = { preventDefault: vi.fn() } as any;
    cmp.onDragOver(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(cmp.isDragging()).toBe(true);
  });

  it('onDrop désactive le survol et charge le fichier déposé', () => {
    const spy = vi.spyOn(cmp, 'loadFile').mockResolvedValue(undefined as any);
    const file = new File(['x'], 'a.xlsx');
    cmp.onDrop({ preventDefault: vi.fn(), dataTransfer: { files: [file] } } as any);
    expect(cmp.isDragging()).toBe(false);
    expect(spy).toHaveBeenCalledWith(file);
  });

  it('onDrop sans fichier n’appelle pas loadFile', () => {
    const spy = vi.spyOn(cmp, 'loadFile').mockResolvedValue(undefined as any);
    cmp.onDrop({ preventDefault: vi.fn(), dataTransfer: { files: [] } } as any);
    expect(spy).not.toHaveBeenCalled();
  });

  it('onFileChange charge le fichier sélectionné', () => {
    const spy = vi.spyOn(cmp, 'loadFile').mockResolvedValue(undefined as any);
    const file = new File(['x'], 'a.xlsx');
    cmp.onFileChange({ target: { files: [file] } } as any);
    expect(spy).toHaveBeenCalledWith(file);
  });

  // ── normalizePays (méthode privée) ──
  it('normalizePays reconnaît codes valides et émetteurs', () => {
    const n = (code: string, em: string) => (cmp as any).normalizePays(code, em);
    expect(n('GAB', '')).toBe('GAB');
    expect(n('', 'République du Cameroun')).toBe('CMR');
    expect(n('', 'Gabon')).toBe('GAB');
    expect(n('', 'Congo Brazzaville')).toBe('CGO');
    expect(n('', 'Tchad')).toBe('TCD');
    expect(n('', 'Centrafrique')).toBe('RCA');
    expect(n('', 'Guinée Équatoriale')).toBe('GNQ');
    expect(n('', 'Inconnu')).toBe('CMR'); // défaut
  });

  // ── validateRows (méthode privée) ──
  it('validateRows marque les erreurs ISIN et volume', () => {
    const rows = (cmp as any).validateRows([
      { isin: '', volume: 10 },
      { isin: 'CM1300001268', volume: 0 },
    ]);
    expect(rows[0].error).toBe('ISIN manquant');
    expect(rows[1].error).toBe('Volume invalide');
  });

  it('validateRows apparie émission (ISIN) et client (compte)', () => {
    build({ emissions: [makeEmission()], clients: [makeClientDossier()] });
    const rows = (cmp as any).validateRows([{ isin: 'CM1300001268', volume: 10, numeroCompte: 'CT-001', matriculeClient: '', clientNom: '' }]);
    expect(rows[0].emissionExists).toBe(true);
    expect(rows[0].emissionId).toBe('e-1');
    expect(rows[0].clientExists).toBe(true);
    expect(rows[0].resolvedCompte).toBe('CT-001');
  });

  it('validateRows apparie le client par matricule (RCCM)', () => {
    build({ clients: [makeClientDossier({ compte: { sousComptes: [] }, rccm: 'MAT9' })] });
    const rows = (cmp as any).validateRows([{ isin: 'CM1300001268', volume: 5, numeroCompte: 'ZZZ', matriculeClient: 'MAT9', clientNom: '' }]);
    expect(rows[0].clientExists).toBe(true);
  });

  it('validateRows apparie le client par nom approché', () => {
    build({ clients: [makeClientDossier({ rccm: '', raisonSociale: 'SOCIETE GENERALE' })] });
    const rows = (cmp as any).validateRows([{ isin: 'CM1300001268', volume: 5, numeroCompte: '', matriculeClient: '', clientNom: 'Societe Generale' }]);
    expect(rows[0].clientExists).toBe(true);
  });

  it('validateRows laisse clientExists=false si aucun match', () => {
    build({ clients: [makeClientDossier({ rccm: '', raisonSociale: 'AUTRE' })] });
    const rows = (cmp as any).validateRows([{ isin: 'CM1300001268', volume: 5, numeroCompte: '', matriculeClient: '', clientNom: 'Personne' }]);
    expect(rows[0].clientExists).toBe(false);
  });

  // ── parseExcel (via loadFile) ──
  it('loadFile refuse un fichier trop volumineux', async () => {
    const big = new File(['x'], 'gros.xlsx');
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await cmp.loadFile(big);
    expect(toast.error).toHaveBeenCalledWith('Fichier trop volumineux', expect.any(String));
  });

  it('loadFile refuse un format non supporté', async () => {
    await cmp.loadFile(new File(['x'], 'note.txt'));
    expect(toast.error).toHaveBeenCalledWith('Format non supporté', expect.any(String));
  });

  it('loadFile parse un fichier valide et passe en prévisualisation', async () => {
    excelState.sheet = makeSheet([
      HEADER,
      {
        1: { result: 'CM1300001268' }, 2: { richText: [{ text: 'CM ' }, { text: 'BTA' }] },
        3: { text: 'Gabon' }, 4: 'BTA', 5: '2027-05-19', 6: 46000, 7: '5,80',
        8: 'ACME SA', 9: 'MAT1', 10: 'CT-001', 11: 10, 12: 1_000_000,
      },
      { 1: 'PAS_UN_ISIN', 11: 3 }, // ligne ignorée (ISIN invalide)
    ]);
    await cmp.loadFile(new File(['x'], 'releve.xlsx'));
    expect(cmp.step()).toBe('preview');
    expect(cmp.rows()).toHaveLength(1);
    const r = cmp.rows()[0];
    expect(r.isin).toBe('CM1300001268');
    expect(r.designation).toBe('CM BTA'); // richText concaténé
    expect(r.paysCode).toBe('GAB'); // déduit de l'émetteur "Gabon"
    expect(r.tauxNominal).toBeCloseTo(5.8);
    expect(r.volume).toBe(10);
    expect(toast.info).toHaveBeenCalledWith('Fichier analysé', expect.any(String));
  });

  it('loadFile signale un fichier sans donnée exploitable', async () => {
    excelState.sheet = makeSheet([HEADER]); // aucune ligne ISIN
    await cmp.loadFile(new File(['x'], 'vide.xlsx'));
    expect(toast.error).toHaveBeenCalledWith('Aucune donnée', expect.any(String));
  });

  it('loadFile gère un fichier illisible', async () => {
    excelState.throwOnLoad = true;
    await cmp.loadFile(new File(['x'], 'ko.xlsx'));
    expect(toast.error).toHaveBeenCalledWith('Erreur de lecture', expect.any(String));
  });

  it('loadFile ne fait rien hors navigateur (SSR)', async () => {
    build({ platform: 'server' });
    await cmp.loadFile(new File(['x'], 'a.xlsx'));
    expect(toast.error).not.toHaveBeenCalled();
    expect(cmp.step()).toBe('upload');
  });

  // ── runImport ──
  it('runImport ne fait rien sans ligne valide', async () => {
    cmp.rows.set([validatedRow({ error: 'ISIN manquant' })]);
    await cmp.runImport();
    expect(api.importPortfolioRows).not.toHaveBeenCalled();
  });

  it('runImport crée les émissions manquantes puis importe (succès)', async () => {
    cmp.rows.set([
      validatedRow({ isin: 'CM1300001268', emissionExists: true, emissionId: 'e-1' }),
      validatedRow({ isin: 'GA1300009999', emissionExists: false, emissionId: undefined }),
    ]);
    await cmp.runImport();
    expect(api.createEmission).toHaveBeenCalledTimes(1); // seule la ligne sans émission
    expect(api.importPortfolioRows).toHaveBeenCalled();
    expect(cmp.step()).toBe('done');
    expect(cmp.importResult()?.imported).toBe(1);
    expect(cmp.progress()).toBe(100);
    expect(data.refreshEmissions).toHaveBeenCalled();
  });

  it('runImport marque l’échec de création d’émission', async () => {
    api.createEmission.mockReturnValueOnce(throwError(() => new Error('boom')));
    cmp.rows.set([validatedRow({ isin: 'GA1300009999', emissionExists: false, emissionId: undefined })]);
    await cmp.runImport();
    // La ligne en échec est exclue du payload → import sans position
    expect(api.importPortfolioRows).toHaveBeenCalledWith([]);
    expect(cmp.rows()[0].error).toBe('Échec création émission');
  });

  it('runImport mappe les erreurs renvoyées par le backend', async () => {
    api.importPortfolioRows.mockReturnValueOnce(of({ imported: 0, errors: [{ isin: 'CM1300001268', clientNom: 'ACME', error: 'compte introuvable' }] }));
    cmp.rows.set([validatedRow()]);
    await cmp.runImport();
    expect(cmp.step()).toBe('done');
    expect(cmp.importResult()?.errors[0]).toContain('compte introuvable');
    expect(data.refreshEmissions).not.toHaveBeenCalled(); // imported === 0
  });

  it('runImport gère un endpoint 404', async () => {
    api.importPortfolioRows.mockReturnValueOnce(throwError(() => ({ status: 404 })));
    cmp.rows.set([validatedRow()]);
    await cmp.runImport();
    expect(toast.error).toHaveBeenCalledWith('Import échoué', expect.stringContaining('non implémenté'));
    expect(cmp.step()).toBe('preview');
    expect(cmp.progress()).toBe(0);
  });

  it('runImport gère une erreur serveur générique', async () => {
    api.importPortfolioRows.mockReturnValueOnce(throwError(() => ({ status: 500, error: { message: 'Boom serveur' } })));
    cmp.rows.set([validatedRow()]);
    await cmp.runImport();
    expect(toast.error).toHaveBeenCalledWith('Import échoué', 'Boom serveur');
    expect(cmp.step()).toBe('preview');
  });

  it('runImport ne fait rien hors navigateur (SSR)', async () => {
    build({ platform: 'server' });
    cmp.rows.set([validatedRow()]);
    await cmp.runImport();
    expect(api.importPortfolioRows).not.toHaveBeenCalled();
  });

  // ─── Rendu du gabarit ─────────────────────────────────────────────────────
  // Le gabarit est inline : ses branches comptent dans la couverture de lignes.

  describe('rendu', () => {
    let fixture: ReturnType<typeof TestBed.createComponent<BoImportPortefeuille>>;

    /** Monte ET rend le composant, là où build() n'instancie que la classe. */
    function render(opts: { emissions?: any[]; clients?: any[] } = {}) {
      TestBed.resetTestingModule();
      data = makeMockData(opts);
      api = makeApi();
      toast = makeToast();
      TestBed.configureTestingModule({
        imports: [BoImportPortefeuille],
        providers: [
          { provide: MockData, useValue: data },
          { provide: ApiService, useValue: api },
          { provide: ToastService, useValue: toast },
          { provide: PLATFORM_ID, useValue: 'browser' },
        ],
      });
      fixture = TestBed.createComponent(BoImportPortefeuille);
      cmp = fixture.componentInstance;
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    const btn = (el: HTMLElement, extrait: string) =>
      Array.from(el.querySelectorAll('button'))
        .find((b) => b.textContent?.includes(extrait)) as HTMLButtonElement;

    // ── Étape « upload » ────────────────────────────────────────────────────

    it('démarre sur l’étape de dépôt de fichier', () => {
      const el = render();
      expect(cmp.step()).toBe('upload');
      expect(btn(el, 'Sélectionner un fichier')).toBeDefined();
      expect(el.textContent).not.toContain('Lignes lues');
    });

    // ── Étape « preview » ───────────────────────────────────────────────────

    it('l’aperçu affiche les compteurs et le nom du fichier', () => {
      const el = render();
      cmp.fileName.set('portefeuille.xlsx');
      cmp.rows.set([validatedRow(), validatedRow({ isin: 'X2', error: 'ISIN invalide' })]);
      cmp.step.set('preview');
      fixture.detectChanges();

      expect(el.textContent).toContain('portefeuille.xlsx');
      expect(el.textContent).toContain('Lignes lues');
      expect(el.querySelectorAll('tbody tr')).toHaveLength(2);
    });

    it('l’aperçu signale les émissions à créer', () => {
      const el = render();
      cmp.rows.set([validatedRow({ emissionExists: false })]);
      cmp.step.set('preview');
      fixture.detectChanges();

      expect(el.textContent).toContain('émission(s) seront créées');
      expect(cmp.newEmissionsCount()).toBe(1);
    });

    it('l’aperçu n’affiche pas l’alerte quand toutes les émissions existent', () => {
      const el = render();
      cmp.rows.set([validatedRow({ emissionExists: true, clientExists: true })]);
      cmp.step.set('preview');
      fixture.detectChanges();

      expect(el.textContent).not.toContain('émission(s) seront créées');
    });

    it('l’aperçu signale les clients introuvables', () => {
      const el = render();
      cmp.rows.set([validatedRow({ clientExists: false })]);
      cmp.step.set('preview');
      fixture.detectChanges();

      expect(cmp.clientsNotFoundCount()).toBe(1);
      expect(el.querySelector('.bg-blue-50')).not.toBeNull();
    });

    it('une ligne en erreur affiche son motif et n’est pas importable', () => {
      const el = render();
      cmp.rows.set([validatedRow({ error: 'Compte introuvable' })]);
      cmp.step.set('preview');
      fixture.detectChanges();

      expect(el.textContent).toContain('Compte introuvable');
      expect(cmp.validRows()).toHaveLength(0);
      expect(btn(el, 'Importer').disabled).toBe(true);
    });

    it('le bouton d’import est actif dès qu’une ligne est valide', () => {
      const el = render();
      cmp.rows.set([validatedRow()]);
      cmp.step.set('preview');
      fixture.detectChanges();

      expect(btn(el, 'Importer').disabled).toBe(false);
    });

    it('« Changer de fichier » revient à l’étape de dépôt', () => {
      const el = render();
      cmp.rows.set([validatedRow()]);
      cmp.step.set('preview');
      fixture.detectChanges();

      btn(el, 'Changer de fichier').click();
      fixture.detectChanges();

      expect(cmp.step()).toBe('upload');
      expect(cmp.rows()).toEqual([]);
    });

    // ── Étape « importing » ─────────────────────────────────────────────────

    it('l’étape d’import affiche la progression et le message d’état', () => {
      const el = render();
      cmp.step.set('importing');
      cmp.statusMsg.set('Création des émissions…');
      cmp.progress.set(42);
      fixture.detectChanges();

      expect(el.textContent).toContain('Import en cours…');
      expect(el.textContent).toContain('Création des émissions…');
      expect(el.textContent).toContain('42%');
    });

    // ── Étape « done » ──────────────────────────────────────────────────────

    it('le bilan sans erreur affiche le nombre de positions importées', () => {
      const el = render();
      cmp.importResult.set({ imported: 7, errors: [] });
      cmp.step.set('done');
      fixture.detectChanges();

      expect(el.textContent).toContain('Import terminé');
      expect(el.textContent).toContain('7');
      expect(el.textContent).toContain('✅');
      expect(el.querySelector('.bg-red-50')).toBeNull();
    });

    it('le bilan avec erreurs les liste une à une', () => {
      const el = render();
      cmp.importResult.set({ imported: 2, errors: ['Ligne 3 : compte inconnu', 'Ligne 5 : ISIN inconnu'] });
      cmp.step.set('done');
      fixture.detectChanges();

      expect(el.textContent).toContain('⚠️');
      expect(el.textContent).toContain('erreur(s)');
      expect(el.textContent).toContain('Ligne 3 : compte inconnu');
      expect(el.textContent).toContain('Ligne 5 : ISIN inconnu');
      expect(el.querySelectorAll('.bg-red-50 div')).toHaveLength(2);
    });

    it('« Importer un autre fichier » réarme l’écran', () => {
      const el = render();
      cmp.importResult.set({ imported: 1, errors: [] });
      cmp.step.set('done');
      fixture.detectChanges();

      btn(el, 'Importer un autre fichier').click();
      fixture.detectChanges();

      expect(cmp.step()).toBe('upload');
      expect(cmp.importResult()).toBeNull();
    });

    // ── Glisser-déposer ─────────────────────────────────────────────────────

    it('le survol d’un fichier met la zone en surbrillance', () => {
      render();
      const ev = { preventDefault: vi.fn() } as unknown as DragEvent;
      cmp.onDragOver(ev);
      expect(ev.preventDefault).toHaveBeenCalled();
      expect(cmp.isDragging()).toBe(true);
    });
  });
});

describe('construireLignesModele', () => {
  it('pré-remplit identité client, colonnes titres absentes', () => {
    const clients: ClientFbLite[] = [
      { nom_prenom: 'MBALLA Jean', matricule: '5601009', compte_depot: 'CCEICMCXX000',
        numero_compte: '000905601009000048', compte_especes: '10005000905601009000048' },
    ];
    const rows = construireLignesModele(clients);
    expect(rows).toEqual([
      { 'NOMS ET PRENOMS': 'MBALLA Jean', 'MATRICULE CLIENT': '5601009', 'NUMERO DE COMPTE': 'CCEICMCXX000' },
    ]);
  });

  it('remplace les valeurs nulles par des chaînes vides', () => {
    const clients: ClientFbLite[] = [
      { nom_prenom: 'ACME', matricule: null, compte_depot: null,
        numero_compte: '000010000000000011', compte_especes: null },
    ];
    expect(construireLignesModele(clients)).toEqual([
      { 'NOMS ET PRENOMS': 'ACME', 'MATRICULE CLIENT': '', 'NUMERO DE COMPTE': '' },
    ]);
  });

  it('liste vide → aucune ligne', () => {
    expect(construireLignesModele([])).toEqual([]);
  });
});
