import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ExcelImport } from './excel-import';
import { ToastService } from '../core/services/toast';

// ─── Mock ExcelJS ─────────────────────────────────────────────────────────────
// Le composant charge ExcelJS via import dynamique. On l'intercepte pour injecter
// une feuille factice (h.sheet) construite à partir de cellules au format ExcelJS.
const h = vi.hoisted(() => ({ sheet: null as any, throwOnLoad: false }));

vi.mock('exceljs', () => {
  class Workbook {
    worksheets: any[] = [];
    xlsx = {
      load: async () => {
        if (h.throwOnLoad) throw new Error('corrompu');
        this.worksheets = h.sheet ? [h.sheet] : [];
      },
      writeBuffer: async () => new ArrayBuffer(8),
    };
    addWorksheet() {
      const ws: any = { columns: [], addRow: () => {} };
      return ws;
    }
  }
  return { default: { Workbook } };
});

// ─── Helpers de construction de cellules / feuilles ExcelJS ──────────────────

/** Emballe une valeur brute en cellule ExcelJS (les objets « {type} » passent tels quels). */
function toCell(v: any): any {
  if (v && typeof v === 'object' && 'type' in v) return v;
  if (v instanceof Date) return { type: 4, value: v };
  if (typeof v === 'number') return { type: 2, value: v };
  return { type: 3, value: String(v), text: String(v) };
}

/** Construit une feuille : 1re ligne = en-têtes, lignes suivantes = données. */
function sheetFrom(rows: Array<Record<number, any>>) {
  return {
    eachRow: (cb: any) => {
      rows.forEach((cells, i) => {
        const row = {
          eachCell: (_opts: any, cb2: any) => {
            for (const [col, cell] of Object.entries(cells)) cb2(cell, Number(col));
          },
        };
        cb(row, i + 1);
      });
    },
  };
}

function buildSheet(dataRows: Array<Record<string, any>>) {
  const headers = dataRows.length ? Object.keys(dataRows[0]) : [];
  const sheetRows: Array<Record<number, any>> = [];
  const headerRow: Record<number, any> = {};
  headers.forEach((hdr, i) => (headerRow[i + 1] = toCell(hdr)));
  sheetRows.push(headerRow);
  for (const r of dataRows) {
    const cells: Record<number, any> = {};
    headers.forEach((hdr, i) => {
      if (hdr in r) cells[i + 1] = toCell(r[hdr]);
    });
    sheetRows.push(cells);
  }
  return sheetFrom(sheetRows);
}

/** Fichier factice acceptable par parseFile (taille > 0, extension .xlsx). */
function file(opts: Partial<{ name: string; size: number; type: string }> = {}): File {
  return {
    name: opts.name ?? 'emissions.xlsx',
    size: opts.size ?? 2048,
    type: opts.type ?? '',
    arrayBuffer: async () => new ArrayBuffer(8),
  } as unknown as File;
}

// Ligne valide de référence — en-têtes choisis pour bien se mapper via KEY_MAP.
const VALID: Record<string, any> = {
  NATURE: 'BTA',
  EMETTEUR: 'CAMEROUN',
  DESIGNATION: 'CM1300001201 BTA 52 07 AVRIL 2027',
  ECHEANCE: '07/04/2027',
  MATURITE: '52 SEMAINES',
  'VALEUR UNITAIRE': 1000000,
  VOLUME: 20000,
  'DATE LIMITE DE SOUSCRIPTION': '06/04/2026',
  'HEURE LIMITE DE SOUSCRIPTION': '9h00mn',
  TAUX: 'ADJ',
  OBSERVATIONS: 'NOUVELLE EMISSION',
};

describe('ExcelImport', () => {
  let cmp: ExcelImport;
  let toast: { success: any; info: any; warn: any; error: any };

  beforeEach(() => {
    h.sheet = null;
    h.throwOnLoad = false;
    toast = { success: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    (globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:test');
    (globalThis.URL as any).revokeObjectURL = vi.fn();

    TestBed.configureTestingModule({
      imports: [ExcelImport],
      providers: [{ provide: ToastService, useValue: toast }],
    });
    cmp = TestBed.createComponent(ExcelImport).componentInstance;
  });

  async function analyse(dataRows: Array<Record<string, any>>) {
    h.sheet = buildSheet(dataRows);
    await cmp.parseFile(file());
    return cmp.rows();
  }
  async function analyseOne(overrides: Record<string, any> = {}) {
    const rows = await analyse([{ ...VALID, ...overrides }]);
    return rows[0];
  }

  // ═══════════════════ Analyse d'une ligne valide ═══════════════════

  describe('ligne BEAC valide', () => {
    it('analyse une ligne complète sans erreur', async () => {
      const r = await analyseOne();
      expect(r.ok).toBe(true);
      expect(r.errors).toEqual([]);
      expect(r.parsed.code).toBe('CM1300001201');
      expect(r.parsed.isin).toBe('CM1300001201');
      expect(r.parsed.libelle).toBe('BTA 52 07 AVRIL 2027');
      expect(r.parsed.nature).toBe('BTA');
      expect(r.parsed.emetteur).toBe('Cameroun');
      expect(r.parsed.dureeJours).toBe(364);
      expect(r.parsed.dateEcheance).toBe('2027-04-07');
      expect(r.parsed.valeurNominaleUnitaire).toBe(1000000);
      expect(r.parsed.montantGlobal).toBe(20000 * 1_000_000);
      expect(r.parsed.fermetureSouscription).toBe('2026-04-06 09:00');
      expect(r.parsed.status).toBe('BROUILLON');
    });

    it('calcule ouverture (−7 j) et date d\'émission (+1 j) par défaut', async () => {
      const r = await analyseOne();
      expect(r.parsed.ouvertureSouscription).toBe('2026-03-30 08:00');
      expect(r.parsed.dateEmission).toBe('2026-04-07');
      expect(r.parsed.dateReglement).toBe('2026-04-07');
    });

    it('notifie le résultat de l\'analyse', async () => {
      await analyseOne();
      expect(toast.info).toHaveBeenCalled();
      expect(cmp.okCount()).toBe(1);
      expect(cmp.errCount()).toBe(0);
    });
  });

  // ═══════════════════ Normalisation des en-têtes ═══════════════════

  describe('normalisation des en-têtes (normalizeKey + KEY_MAP)', () => {
    it('mappe des en-têtes accentués / espacés / alias', async () => {
      const r = await analyse([{
        Nature: 'BTA',
        'État émetteur': 'GABON',
        Libellé: 'GA0000000123 OTA',
        Échéance: '10/10/2027',
        Durée: '2 ANS',
        'Nominal unitaire': 50000,
        Volume: 5000,
        'Date limite': '01/10/2026',
        'Heure limite': '10:00',
        Taux: 'ADJ',
        Obs: 'TEST',
      }]);
      expect(r[0].parsed.emetteur).toBe('Gabon');
      expect(r[0].parsed.code).toBe('GA0000000123');
      expect(r[0].parsed.dureeJours).toBe(730);
      expect(r[0].parsed.valeurNominaleUnitaire).toBe(50000);
    });

    it('ignore les clés dangereuses (__proto__) et les colonnes vides', async () => {
      const r = await analyse([{ __proto__: 'x', '': 'y', ...VALID }]);
      expect(r[0].ok).toBe(true);
    });
  });

  // ═══════════════════ Extraction du code depuis DESIGNATION ═══════════════════

  describe('extractCodeFromDesignation', () => {
    it('extrait le code ISIN en tête de désignation', async () => {
      const r = await analyseOne({ DESIGNATION: 'CG2K00000146 OTA 4 ANS 31 AOUT 2027' });
      expect(r.parsed.code).toBe('CG2K00000146');
      expect(r.parsed.libelle).toBe('OTA 4 ANS 31 AOUT 2027');
    });

    it('utilise la colonne CODE si présente et conserve la désignation en libellé', async () => {
      const r = await analyseOne({ CODE: 'xy123', DESIGNATION: 'un libellé sans code' });
      expect(r.parsed.code).toBe('XY123');
      expect(r.parsed.libelle).toBe('un libellé sans code');
    });

    it('signale un code / désignation manquant', async () => {
      const r = await analyseOne({ DESIGNATION: '', CODE: '' });
      expect(r.ok).toBe(false);
      expect(r.errors).toContain('Code / désignation manquant');
    });
  });

  // ═══════════════════ MATURITE → jours ═══════════════════

  describe('maturiteToJours', () => {
    it('convertit semaines, ans, mois, jours et nombre nu', async () => {
      const rows = await analyse([
        { ...VALID, MATURITE: '52 SEMAINES' },
        { ...VALID, MATURITE: '2 ANS' },
        { ...VALID, MATURITE: '1,39 AN' },
        { ...VALID, MATURITE: '30 JOURS' },
        { ...VALID, MATURITE: '3 MOIS' },
        { ...VALID, MATURITE: '100' },
      ]);
      expect(rows.map(r => r.parsed.dureeJours)).toEqual([364, 730, 507, 30, 90, 100]);
    });

    it('accepte la durée en jours directe (DUREE JOURS) sans MATURITE', async () => {
      const row: Record<string, any> = { ...VALID, 'DUREE JOURS': 200 };
      delete row['MATURITE'];
      const r = (await analyse([row]))[0];
      expect(r.parsed.dureeJours).toBe(200);
    });

    it('signale une maturité invalide', async () => {
      const r = await analyseOne({ MATURITE: 'xyz' });
      expect(r.ok).toBe(false);
      expect(r.errors).toContain('Maturité / durée invalide');
    });
  });

  // ═══════════════════ HEURE LIMITE → HH:MM ═══════════════════

  describe('heureToHHMM', () => {
    it('convertit les formats textuels', async () => {
      const rows = await analyse([
        { ...VALID, 'HEURE LIMITE DE SOUSCRIPTION': '9h00mn' },
        { ...VALID, 'HEURE LIMITE DE SOUSCRIPTION': '09:00' },
        { ...VALID, 'HEURE LIMITE DE SOUSCRIPTION': '9h30' },
        { ...VALID, 'HEURE LIMITE DE SOUSCRIPTION': 'peu importe' },
      ]);
      expect(rows.map(r => r.parsed.fermetureSouscription)).toEqual([
        '2026-04-06 09:00',
        '2026-04-06 09:00',
        '2026-04-06 09:30',
        '2026-04-06 09:00',
      ]);
    });

    it('convertit un numéro de série Excel (fraction de jour)', async () => {
      const r = await analyseOne({ 'HEURE LIMITE DE SOUSCRIPTION': { type: 2, value: 0.5 } });
      expect(r.parsed.fermetureSouscription).toBe('2026-04-06 12:00');
    });

    it('applique 09:00 par défaut quand l\'heure est absente', async () => {
      const row: Record<string, any> = { ...VALID };
      delete row['HEURE LIMITE DE SOUSCRIPTION'];
      const r = (await analyse([row]))[0];
      expect(r.parsed.fermetureSouscription).toBe('2026-04-06 09:00');
    });
  });

  // ═══════════════════ Extraction du taux ═══════════════════

  describe('taux nominal', () => {
    it('extrait le taux depuis DESIGNATION (« 6,20% » → 6.2)', async () => {
      const r = await analyseOne({
        NATURE: 'OTA',
        EMETTEUR: 'CONGO',
        DESIGNATION: 'CG2K00000146 OTA 4 ANS 6,20% 31 AOUT 2027',
        TAUX: 'ADJ',
      });
      expect(r.parsed.tauxNominal).toBe(6.2);
    });

    it('lit le taux numérique de la colonne TAUX', async () => {
      const r = await analyseOne({ TAUX: '6,20' });
      expect(r.parsed.tauxNominal).toBe(6.2);
    });

    it('traite ADJ / PRIX comme taux non fixé (0)', async () => {
      const rows = await analyse([
        { ...VALID, TAUX: 'ADJ' },
        { ...VALID, TAUX: 'PRIX' },
      ]);
      expect(rows[0].parsed.tauxNominal).toBe(0);
      expect(rows[1].parsed.tauxNominal).toBe(0);
    });

    it('rejette un taux > 30 %', async () => {
      const r = await analyseOne({ TAUX: '35' });
      expect(r.ok).toBe(false);
      expect(r.errors).toContain('Taux nominal > 30 %');
    });
  });

  // ═══════════════════ Émetteur ═══════════════════

  describe('normalisation de l\'émetteur', () => {
    it('normalise les variantes reconnues', async () => {
      const rows = await analyse([
        { ...VALID, EMETTEUR: 'GABON' },
        { ...VALID, EMETTEUR: 'CMR' },
        { ...VALID, EMETTEUR: 'gnq' },
        { ...VALID, EMETTEUR: 'Congo-Brazzaville' },
        { ...VALID, EMETTEUR: 'Guinée Equatoriale' },
      ]);
      expect(rows.map(r => r.parsed.emetteur)).toEqual([
        'Gabon', 'Cameroun', 'Guinée Équatoriale', 'Congo', 'Guinée Équatoriale',
      ]);
    });

    it('rejette un émetteur non reconnu', async () => {
      const r = await analyseOne({ EMETTEUR: 'Mali' });
      expect(r.ok).toBe(false);
      expect(r.errors).toContain('État émetteur non reconnu: Mali');
    });
  });

  // ═══════════════════ Champs requis / erreurs ═══════════════════

  describe('validation des champs requis', () => {
    it('accumule toutes les erreurs pour une ligne vide', async () => {
      const r = (await analyse([{}]))[0];
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual(expect.arrayContaining([
        'Nature manquante',
        'Émetteur manquant',
        'Code / désignation manquant',
        'Date d\'échéance manquante',
        'Maturité / durée invalide',
        'Valeur unitaire < 10 000 FCFA',
        'Volume / montant d\'émission invalide',
        'Date limite de souscription manquante',
      ]));
    });

    it('rejette une nature invalide', async () => {
      const r = await analyseOne({ NATURE: 'XXX' });
      expect(r.errors).toContain('Nature invalide (BTA ou OTA): XXX');
    });

    it('rejette une valeur unitaire trop basse', async () => {
      const r = await analyseOne({ 'VALEUR UNITAIRE': 5000 });
      expect(r.errors).toContain('Valeur unitaire < 10 000 FCFA');
    });

    it('accepte un montant global direct et une valeur textuelle avec espaces', async () => {
      const row: Record<string, any> = { ...VALID, 'MONTANT GLOBAL': '15 000 000', 'VALEUR UNITAIRE': '1 000 000' };
      delete row['VOLUME'];
      const r = (await analyse([row]))[0];
      expect(r.parsed.montantGlobal).toBe(15_000_000);
      expect(r.parsed.valeurNominaleUnitaire).toBe(1_000_000);
    });

    it('prend en compte les colonnes de dates internes explicites', async () => {
      const row: Record<string, any> = {
        ...VALID,
        'OUVERTURE SOUSCRIPTION': '2026-04-01 08:00',
        'DATE EMISSION': '2026-05-02',
        'DATE REGLEMENT': '2026-05-03',
      };
      const r = (await analyse([row]))[0];
      expect(r.parsed.ouvertureSouscription).toBe('2026-04-01 08:00');
      expect(r.parsed.dateEmission).toBe('2026-05-02');
      expect(r.parsed.dateReglement).toBe('2026-05-03');
    });
  });

  // ═══════════════════ Types de cellules ExcelJS ═══════════════════

  describe('extractCellValue — branches par type de cellule', () => {
    it('type 2 (nombre) via formule et type 4 (date native)', async () => {
      const r = await analyseOne({
        'VALEUR UNITAIRE': { type: 6, value: { result: 250000 } },     // formule → nombre
        ECHEANCE: { type: 4, value: new Date('2030-01-15T00:00:00Z') }, // date native
      });
      expect(r.parsed.valeurNominaleUnitaire).toBe(250000);
      expect(r.parsed.dateEcheance).toBe('2030-01-15');
    });

    it('type 6 (formule) : chaîne, date, booléen, texte riche, erreur, null', async () => {
      const em = await analyseOne({ EMETTEUR: { type: 6, value: { result: 'GABON' } } });
      expect(em.parsed.emetteur).toBe('Gabon');

      const dt = await analyseOne({ ECHEANCE: { type: 6, value: { result: new Date('2031-03-04T00:00:00Z') } } });
      expect(dt.parsed.dateEcheance).toBe('2031-03-04');

      const bool = await analyseOne({ OBSERVATIONS: { type: 6, value: { result: true } } });
      expect(bool.parsed.observation).toBe('VRAI');

      const rich = await analyseOne({ OBSERVATIONS: { type: 6, value: { result: { richText: [{ text: 'ri' }, { text: 'ch' }] } } } });
      expect(rich.parsed.observation).toBe('RICH');

      const err = await analyseOne({ OBSERVATIONS: { type: 6, value: { result: { error: '#REF!' } } } });
      expect(err.parsed.observation).toBeUndefined();

      const nul = await analyseOne({ OBSERVATIONS: { type: 6, value: { result: null } } });
      expect(nul.parsed.observation).toBeUndefined();
    });

    it('type 8 (texte riche) concaténé', async () => {
      const r = await analyseOne({
        DESIGNATION: { type: 8, value: { richText: [{ text: 'CM1300001201 ' }, { text: 'BTA 52' }] } },
      });
      expect(r.parsed.code).toBe('CM1300001201');
      expect(r.parsed.libelle).toBe('BTA 52');
    });

    it('type 5 (hyperlien) : texte, repli sur cell.text, puis null', async () => {
      const a = await analyseOne({ OBSERVATIONS: { type: 5, value: { text: 'lien' } } });
      expect(a.parsed.observation).toBe('LIEN');

      const b = await analyseOne({ OBSERVATIONS: { type: 5, value: {}, text: 'repli' } });
      expect(b.parsed.observation).toBe('REPLI');

      const c = await analyseOne({ OBSERVATIONS: { type: 5, value: null } });
      expect(c.parsed.observation).toBeUndefined();
    });

    it('type 9 (booléen) → VRAI / FAUX', async () => {
      const vrai = await analyseOne({ OBSERVATIONS: { type: 9, value: true } });
      expect(vrai.parsed.observation).toBe('VRAI');
      const faux = await analyseOne({ OBSERVATIONS: { type: 9, value: false } });
      expect(faux.parsed.observation).toBe('FAUX');
    });

    it('type 10 (erreur) → null', async () => {
      const r = await analyseOne({ OBSERVATIONS: { type: 10, value: { error: '#N/A' } } });
      expect(r.parsed.observation).toBeUndefined();
    });

    it('garde-fou : valeur objet inattendue sur une cellule directe', async () => {
      const rich = await analyseOne({ OBSERVATIONS: { type: 3, value: { richText: [{ text: 'ab' }] } } });
      expect(rich.parsed.observation).toBe('AB');

      const res = await analyseOne({ OBSERVATIONS: { type: 3, value: { result: 42 } } });
      expect(res.parsed.observation).toBe('42');

      const txt = await analyseOne({ OBSERVATIONS: { type: 3, value: { text: 'tt' } } });
      expect(txt.parsed.observation).toBe('TT');

      const err = await analyseOne({ OBSERVATIONS: { type: 3, value: { error: 'e' } } });
      expect(err.parsed.observation).toBeUndefined();

      const unknown = await analyseOne({ OBSERVATIONS: { type: 3, value: { foo: 'bar' } } });
      expect(unknown.parsed.observation).toBe('[OBJECT OBJECT]');
    });

    it('convertit un numéro de série Excel en date (toDateStr)', async () => {
      const r = await analyseOne({ ECHEANCE: { type: 2, value: 46000 } });
      expect(r.parsed.dateEcheance).toBe('2025-12-09');
    });
  });

  // ═══════════════════ Bug connu (documenté) ═══════════════════

  describe('en-têtes officiels BEAC avec apostrophe / parenthèses', () => {
    it('BUG : « DATE D\'ECHEANCE » et « VOLUME D\'EMISSION (…) » ne sont pas mappés', async () => {
      // normalizeKey ne retire que [\s\-_] : l'apostrophe et les parenthèses subsistent,
      // donc ces en-têtes du modèle livré ne correspondent à aucune clé KEY_MAP.
      const r = (await analyse([{
        NATURE: 'BTA',
        EMETTEUR: 'CAMEROUN',
        DESIGNATION: 'CM1300001201 BTA 52',
        "DATE D'ECHEANCE": '07/04/2027',
        'MATURITE': '52 SEMAINES',
        'VALEUR UNITAIRE': 1000000,
        "VOLUME D'EMISSION (en millions de fcfa)": 20000,
        'DATE LIMITE DE SOUSCRIPTION': '06/04/2026',
        'HEURE LIMITE DE SOUSCRIPTION': '9h00mn',
        'TAUX/PRIX': 'ADJ',
        OBSERVATIONS: 'NOUVELLE EMISSION',
      }]))[0];
      expect(r.ok).toBe(false);
      expect(r.errors).toContain('Date d\'échéance manquante');
      expect(r.errors).toContain('Volume / montant d\'émission invalide');
    });
  });

  // ═══════════════════ parseFile — garde-fous ═══════════════════

  describe('parseFile — contrôles de fichier', () => {
    it('refuse un fichier trop volumineux', async () => {
      await cmp.parseFile(file({ size: 6 * 1024 * 1024 }));
      expect(toast.error).toHaveBeenCalledWith('Fichier trop volumineux', expect.any(String));
    });

    it('refuse un fichier vide', async () => {
      await cmp.parseFile(file({ size: 0 }));
      expect(toast.error).toHaveBeenCalledWith('Fichier vide', expect.any(String));
    });

    it('refuse une extension non supportée', async () => {
      await cmp.parseFile(file({ name: 'donnees.csv' }));
      expect(toast.error).toHaveBeenCalledWith('Format non supporté', expect.any(String));
    });

    it('refuse un type MIME inattendu', async () => {
      await cmp.parseFile(file({ type: 'application/x-msdownload' }));
      expect(toast.error).toHaveBeenCalledWith('Type MIME inattendu', expect.any(String));
    });

    it('signale l\'absence de feuille', async () => {
      h.sheet = null;
      await cmp.parseFile(file());
      expect(toast.error).toHaveBeenCalledWith('Fichier vide', 'Aucune feuille détectée.');
    });

    it('signale l\'absence de ligne de données', async () => {
      h.sheet = buildSheet([]); // en-têtes seuls, aucune donnée
      await cmp.parseFile(file());
      expect(toast.error).toHaveBeenCalledWith('Fichier vide', 'Aucune ligne trouvée.');
    });

    it('capture une erreur de lecture', async () => {
      h.throwOnLoad = true;
      await cmp.parseFile(file());
      expect(toast.error).toHaveBeenCalledWith('Erreur de lecture', expect.any(String));
    });
  });

  // ═══════════════════ Interactions & import ═══════════════════

  describe('interactions et import', () => {
    it('onFile déclenche l\'analyse', async () => {
      h.sheet = buildSheet([{ ...VALID }]);
      const ev = { target: { files: [file()] } } as unknown as Event;
      cmp.onFile(ev);
      for (let i = 0; i < 20 && cmp.rows().length === 0; i++) {
        await new Promise(res => setTimeout(res, 5));
      }
      expect(cmp.rows().length).toBe(1);
    });

    it('onDrop analyse le fichier déposé', async () => {
      h.sheet = buildSheet([{ ...VALID }]);
      const prevented = vi.fn();
      const ev = { preventDefault: prevented, dataTransfer: { files: [file()] } } as unknown as DragEvent;
      cmp.onDrop(ev);
      await Promise.resolve();
      expect(prevented).toHaveBeenCalled();
    });

    it('importAll émet les lignes valides et réinitialise', async () => {
      await analyse([{ ...VALID }, { ...VALID, NATURE: 'XXX' }]);
      const imported: any[] = [];
      const closed = vi.fn();
      cmp.imported.subscribe(v => imported.push(v));
      cmp.close$.subscribe(closed);

      cmp.importAll('PUBLIE');
      expect(imported[0].length).toBe(1);
      expect(imported[0][0].status).toBe('PUBLIE');
      expect(toast.success).toHaveBeenCalled();
      expect(cmp.rows()).toEqual([]);
      expect(closed).toHaveBeenCalled();
    });

    it('reset vide les lignes et le nom de fichier', async () => {
      await analyse([{ ...VALID }]);
      cmp.reset();
      expect(cmp.rows()).toEqual([]);
      expect(cmp.fileName()).toBe('');
    });
  });

  // ═══════════════════ Modèles téléchargeables ═══════════════════

  describe('modèles', () => {
    it('génère le modèle CSV', () => {
      cmp.downloadTemplateCsv();
      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith('Modèle CSV téléchargé');
    });

    it('génère le modèle Excel', async () => {
      await cmp.downloadTemplateXlsx();
      expect(toast.success).toHaveBeenCalledWith('Modèle Excel téléchargé');
    });
  });
});
