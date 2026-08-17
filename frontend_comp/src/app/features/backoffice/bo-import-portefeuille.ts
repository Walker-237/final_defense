import { Component, OnInit, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { lastValueFrom } from 'rxjs';
import { ApiService, PortfolioImportRow, ClientFbLite } from '../../core/services/api';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';

// ── Types ───────────────────────────────────────────────────────────────────

interface RawPortfolioRow {
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
}

interface ValidatedRow extends RawPortfolioRow {
  emissionExists: boolean;
  emissionId?: string;
  clientExists: boolean;
  clientId?: string;
  resolvedCompte?: string;
  error?: string;
}

type ImportStep = 'upload' | 'preview' | 'importing' | 'done';

// ── Helpers Excel ────────────────────────────────────────────────────────────

function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569);
  const ms = Math.round((serial - Math.floor(serial)) * 86400 * 1000);
  return new Date(utcDays * 86400 * 1000 + ms);
}

function toDateStr(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = excelSerialToDate(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

function toNum(v: any): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  return Number(String(v).replace(/[\s ]/g, '').replace(',', '.')) || 0;
}

function resolveCell(v: any): any {
  if (!v || typeof v !== 'object') return v;
  if ('result' in v) return v.result;
  if ('text' in v) return v.text;
  if ('richText' in v) return (v.richText as any[]).map((r: any) => r.text).join('');
  return v;
}

function isIsinLike(v: any): boolean {
  return /^[A-Z]{2}[A-Z0-9]{8,10}$/.test(String(v ?? '').trim());
}

/**
 * Colonnes du modèle d'import de portefeuille — libellés reconnus par le parseur
 * (cf. `parseExcel`). Les colonnes d'identité client sont pré-remplies depuis la
 * base clients ; les colonnes titres restent à compléter par l'opérateur.
 */
const MODELE_COLONNES = [
  'CODE ISIN', 'DESIGNATION VALEUR', 'EMETTEUR', 'CATEGORIE VALEUR',
  'DATE ANNIVERSAIRE', 'DATE ECHEANCE', 'TAUX FACIAL',
  'NOMS ET PRENOMS', 'MATRICULE CLIENT', 'NUMERO DE COMPTE',
  'VOLUME SOUSCRIT', 'ACHAT',
] as const;

// ── Composant ────────────────────────────────────────────────────────────────

@Component({
  selector: 'afb-bo-import-portefeuille',
  imports: [DecimalPipe],
  template: `
  <div class="max-w-5xl mx-auto space-y-6">
    <!-- En-tête -->
    <div>
      <h1 class="text-xl font-bold text-gray-900">Import portefeuille</h1>
      <p class="text-sm text-gray-500 mt-0.5">Importez les positions depuis un relevé Excel (.xlsx) — situation de portefeuille.</p>
    </div>

    <!-- ─── Étape 1 : Upload ─── -->
    @if (step() === 'upload') {
      <div class="rounded-2xl border-2 border-dashed bg-white p-10 text-center transition-colors cursor-pointer"
           [class.border-afb-red]="isDragging()"
           [class.bg-red-50]="isDragging()"
           [class.border-gray-300]="!isDragging()"
           (dragover)="onDragOver($event)"
           (dragleave)="isDragging.set(false)"
           (drop)="onDrop($event)"
           (click)="fileInput.click()">
        <div class="text-5xl mb-3">📥</div>
        <h2 class="text-base font-bold text-gray-800 mb-1">Glissez-déposez votre fichier Excel ici</h2>
        <p class="text-sm text-gray-400 mb-5">ou cliquez pour sélectionner — format .xlsx · max 5 Mo</p>
        <input #fileInput type="file" accept=".xlsx,.xls" class="hidden" (change)="onFileChange($event)" />
        <div class="flex flex-wrap gap-2 justify-center">
          <button class="btn btn-primary" (click)="$event.stopPropagation(); fileInput.click()">📂 Sélectionner un fichier</button>
          <button class="btn btn-outline" [disabled]="downloadingModele()"
                  (click)="$event.stopPropagation(); telechargerModele()">
            {{ downloadingModele() ? '⏳ Génération…' : '⬇ Télécharger le modèle (pré-rempli base clients)' }}
          </button>
        </div>
        <div class="mt-6 p-4 bg-blue-50 rounded-xl text-left text-xs text-blue-900 max-w-xl mx-auto">
          <b>Colonnes attendues (dans n'importe quel ordre) :</b><br class="mb-1">
          CODE ISIN · DESIGNATION VALEUR · EMETTEUR · CATEGORIE VALEUR · DATE ECHEANCE ·
          DATE ANNIVERSAIRE · TAUX FACIAL · NOMS ET PRENOMS · MATRICULE CLIENT ·
          NUMERO DE COMPTE · VOLUME SOUSCRIT · ACHAT (ou MONTANT ADJUGE)
        </div>
      </div>
    }

    <!-- ─── Étape 2 : Prévisualisation ─── -->
    @if (step() === 'preview') {
      <!-- Statistiques -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div class="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <div class="text-2xl font-black text-gray-900">{{ rows().length }}</div>
          <div class="text-xs text-gray-500 mt-1">Lignes lues</div>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <div class="text-2xl font-black text-emerald-600">{{ validRows().length }}</div>
          <div class="text-xs text-gray-500 mt-1">Valides</div>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <div class="text-2xl font-black" [class.text-amber-600]="newEmissionsCount() > 0" [class.text-gray-300]="newEmissionsCount() === 0">{{ newEmissionsCount() }}</div>
          <div class="text-xs text-gray-500 mt-1">Émissions à créer</div>
        </div>
        <div class="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
          <div class="text-2xl font-black" [class.text-red-600]="errorRows().length > 0" [class.text-gray-300]="errorRows().length === 0">{{ errorRows().length }}</div>
          <div class="text-xs text-gray-500 mt-1">Erreurs</div>
        </div>
      </div>

      <!-- Nom du fichier + bouton reset -->
      <div class="flex items-center justify-between text-sm">
        <span class="text-gray-500">📄 <b class="text-gray-800">{{ fileName() }}</b></span>
        <button class="btn btn-ghost text-xs" (click)="reset()">↺ Changer de fichier</button>
      </div>

      <!-- Alertes -->
      @if (newEmissionsCount() > 0) {
        <div class="flex gap-2 items-start p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <span class="shrink-0">⚠️</span>
          <span><b>{{ newEmissionsCount() }} émission(s) seront créées</b> en statut Brouillon (ISIN non trouvés en base). Elles devront être publiées séparément.</span>
        </div>
      }
      @if (clientsNotFoundCount() > 0) {
        <div class="flex gap-2 items-start p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
          <span class="shrink-0">ℹ️</span>
          <span><b>{{ clientsNotFoundCount() }} client(s) introuvables en base.</b> Les positions seront créées avec le numéro de compte du fichier.</span>
        </div>
      }

      <!-- Tableau de prévisualisation -->
      <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div class="overflow-auto max-h-[55vh]">
          <table class="table text-xs min-w-[820px]">
            <thead class="sticky top-0 bg-gray-50 z-10">
              <tr>
                <th class="w-8">#</th>
                <th>ISIN</th>
                <th>Désignation</th>
                <th>Nat.</th>
                <th>Client</th>
                <th>Compte titres</th>
                <th class="text-right">Volume</th>
                <th class="text-right">Montant (FCFA)</th>
                <th class="w-24">Statut</th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.isin + row.clientNom; let i = $index) {
                <tr [class.bg-red-50]="row.error" [class.opacity-50]="row.error">
                  <td class="text-gray-400">{{ i + 1 }}</td>
                  <td class="font-mono font-semibold tracking-tight">{{ row.isin }}</td>
                  <td class="max-w-[160px] truncate" [title]="row.designation">{{ row.designation || '—' }}</td>
                  <td>
                    <span class="text-[11px] font-bold px-1.5 py-0.5 rounded"
                          [class.bg-blue-100]="row.nature === 'BTA'"
                          [class.text-blue-700]="row.nature === 'BTA'"
                          [class.bg-purple-100]="row.nature === 'OTA'"
                          [class.text-purple-700]="row.nature === 'OTA'">{{ row.nature }}</span>
                  </td>
                  <td class="max-w-[140px]">
                    <span class="truncate block" [title]="row.clientNom"
                          [class.text-emerald-700]="row.clientExists"
                          [class.font-medium]="row.clientExists"
                          [class.text-gray-500]="!row.clientExists">
                      {{ row.clientNom || '—' }}
                    </span>
                  </td>
                  <td class="font-mono text-[11px] text-gray-600">{{ row.resolvedCompte || row.numeroCompte || '—' }}</td>
                  <td class="text-right">{{ row.volume | number:'1.0-0':'fr-FR' }}</td>
                  <td class="text-right">{{ row.montantAdjuge | number:'1.0-0':'fr-FR' }}</td>
                  <td>
                    @if (row.error) {
                      <span class="text-[10px] text-red-700 font-medium" [title]="row.error">✕ {{ row.error }}</span>
                    } @else {
                      <div class="flex gap-1 flex-wrap">
                        <span class="text-[10px] font-medium px-1 py-0.5 rounded"
                              [class.bg-emerald-100]="row.emissionExists" [class.text-emerald-700]="row.emissionExists"
                              [class.bg-amber-100]="!row.emissionExists" [class.text-amber-700]="!row.emissionExists">
                          EM {{ row.emissionExists ? '✓' : '+' }}
                        </span>
                        <span class="text-[10px] font-medium px-1 py-0.5 rounded"
                              [class.bg-emerald-100]="row.clientExists" [class.text-emerald-700]="row.clientExists"
                              [class.bg-gray-100]="!row.clientExists" [class.text-gray-500]="!row.clientExists">
                          CL {{ row.clientExists ? '✓' : '?' }}
                        </span>
                      </div>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-between pt-2">
        <button class="btn btn-outline" (click)="reset()">Annuler</button>
        <button class="btn btn-primary" [disabled]="!validRows().length" (click)="runImport()">
          Importer {{ validRows().length }} position(s) →
        </button>
      </div>
    }

    <!-- ─── Étape 3 : Import en cours ─── -->
    @if (step() === 'importing') {
      <div class="rounded-2xl border border-gray-200 bg-white shadow-sm p-10 sm:p-14 text-center space-y-5">
        <div class="text-5xl">⏳</div>
        <h2 class="text-lg font-bold text-gray-800">Import en cours…</h2>
        <p class="text-sm text-gray-500">{{ statusMsg() }}</p>
        <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden mx-auto max-w-md">
          <div class="bg-afb-red h-3 rounded-full transition-all duration-500"
               [style.width.%]="progress()"></div>
        </div>
        <div class="text-sm font-semibold text-gray-600">{{ progress() }}%</div>
      </div>
    }

    <!-- ─── Étape 4 : Terminé ─── -->
    @if (step() === 'done') {
      <div class="rounded-2xl border border-gray-200 bg-white shadow-sm p-10 sm:p-14 text-center space-y-5">
        @if (importResult(); as res) {
          <div class="text-5xl">{{ res.errors.length ? '⚠️' : '✅' }}</div>
          <h2 class="text-lg font-bold text-gray-800">Import terminé</h2>
          <p class="text-base text-gray-700">
            <span class="font-black text-emerald-600">{{ res.imported }}</span> position(s) importée(s)
            @if (res.errors.length) {
              · <span class="font-black text-red-600">{{ res.errors.length }}</span> erreur(s)
            }
          </p>
          @if (res.errors.length) {
            <div class="text-left bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 space-y-1 max-w-lg mx-auto">
              @for (err of res.errors; track err) {
                <div>• {{ err }}</div>
              }
            </div>
          }
        }
        <button class="btn btn-primary mt-4" (click)="reset()">↺ Importer un autre fichier</button>
      </div>
    }
  </div>
  `
})
export class BoImportPortefeuille implements OnInit {
  private readonly api = inject(ApiService);
  private readonly data = inject(MockData);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  step = signal<ImportStep>('upload');
  rows = signal<ValidatedRow[]>([]);
  isDragging = signal(false);
  statusMsg = signal('');
  progress = signal(0);
  importResult = signal<{ imported: number; errors: string[] } | null>(null);
  fileName = signal('');
  downloadingModele = signal(false);

  validRows = computed(() => this.rows().filter(r => !r.error));
  errorRows = computed(() => this.rows().filter(r => !!r.error));
  newEmissionsCount = computed(() => this.validRows().filter(r => !r.emissionExists).length);
  clientsNotFoundCount = computed(() => this.validRows().filter(r => !r.clientExists).length);

  ngOnInit() {
    this.data.refreshClients();
  }

  onFileChange(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (file) this.loadFile(file);
  }
  onDragOver(ev: DragEvent) { ev.preventDefault(); this.isDragging.set(true); }
  onDrop(ev: DragEvent) {
    ev.preventDefault();
    this.isDragging.set(false);
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.loadFile(file);
  }

  async loadFile(file: File) {
    if (!this.isBrowser) return;
    if (file.size > 5 * 1024 * 1024) { this.toast.error('Fichier trop volumineux', 'Maximum 5 Mo.'); return; }
    if (!/\.(xlsx?|xlsm)$/i.test(file.name)) { this.toast.error('Format non supporté', 'Utilisez un fichier .xlsx.'); return; }
    this.fileName.set(file.name);
    try {
      const raws = await this.parseExcel(file);
      if (!raws.length) { this.toast.error('Aucune donnée', 'Aucune ligne de portefeuille détectée dans ce fichier.'); return; }
      this.rows.set(this.validateRows(raws));
      this.step.set('preview');
      this.toast.info('Fichier analysé', `${this.rows().length} ligne(s) · ${this.validRows().length} valide(s)`);
    } catch {
      this.toast.error('Erreur de lecture', 'Fichier illisible ou corrompu.');
    }
  }

  // ─── Parsing Excel ────────────────────────────────────────────────────────

  private async parseExcel(file: File): Promise<RawPortfolioRow[]> {
    const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new (ExcelJS as any).Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheet = wb.worksheets[0];
    if (!sheet) return [];

    // Collecter toutes les lignes brutes
    type RowCells = Record<number, any>;
    const rawRows: RowCells[] = [];
    sheet.eachRow({ includeEmpty: false }, (row: any) => {
      const cells: RowCells = {};
      row.eachCell({ includeEmpty: false }, (cell: any, col: number) => {
        const v = resolveCell(cell.value);
        if (v !== undefined && v !== null && v !== '') cells[col] = v;
      });
      rawRows.push(cells);
    });

    // Scanner les premières lignes pour construire le headerMap
    // (supporte les tableaux avec plusieurs lignes d'en-tête / cellules fusionnées)
    const hmap: Record<string, number> = {};
    let dataStart = -1;

    for (let i = 0; i < Math.min(rawRows.length, 25); i++) {
      if (Object.values(rawRows[i]).some(isIsinLike)) { dataStart = i; break; }
      for (const [col, v] of Object.entries(rawRows[i])) {
        const key = String(v ?? '').trim().toUpperCase();
        if (key && !(key in hmap)) hmap[key] = Number(col);
      }
    }
    if (dataStart === -1) return [];

    const get = (cells: RowCells, keys: string[]): any => {
      for (const k of keys) {
        const col = hmap[k];
        if (col !== undefined) { const v = cells[col]; if (v != null && v !== '') return v; }
      }
      return null;
    };

    const result: RawPortfolioRow[] = [];
    for (let i = dataStart; i < rawRows.length; i++) {
      const cells = rawRows[i];
      const isin = String(get(cells, ['CODE ISIN', 'ISIN', 'CODE TITRE', 'CODE ISIN ']) ?? '').trim();
      if (!isIsinLike(isin)) continue;

      const emetteur = String(get(cells, ['EMETTEUR', 'ETAT', 'ETAT EMETTEUR', 'PAYS EMETTEUR']) ?? '').trim();
      const paysRaw = String(get(cells, ['CODE PAYS', 'PAYS', 'CODE PAYS ']) ?? '').trim().toUpperCase();
      const nature = String(get(cells, ['CATEGORIE VALEUR', 'CATEGORIE', 'NATURE', 'TYPE VALEUR', 'NATURE VALEUR', 'TYPE']) ?? '').toUpperCase();

      result.push({
        isin,
        designation: String(get(cells, ['DESIGNATION VALEUR', 'DESIGNATION', 'LIBELLE', 'NOM VALEUR', 'VALEUR']) ?? '').trim(),
        emetteur,
        paysCode: this.normalizePays(paysRaw, emetteur),
        nature: nature.includes('OTA') ? 'OTA' : 'BTA',
        dateEmission: toDateStr(get(cells, ['DATE ANNIVERSAIRE', 'DATE EMISSION', 'DATE VALEUR', 'DATE REGLEMENT', 'DATE'])),
        dateEcheance: toDateStr(get(cells, ['DATE ECHEANCE', 'ECHEANCE', 'DATE MATURITE'])),
        tauxNominal: toNum(get(cells, ['TAUX FACIAL', 'TAUX NOMINAL', 'TAUX', 'RENDEMENT', 'COUPON'])),
        clientNom: String(get(cells, ['NOMS ET PRENOMS', 'NOM ET PRENOM', 'NOM', 'CLIENT', 'INVESTISSEUR', 'PORTEUR']) ?? '').trim(),
        matriculeClient: String(get(cells, ['MATRICULE CLIENT', 'MATRICULE', 'CODE CLIENT', 'ID CLIENT']) ?? '').trim(),
        numeroCompte: String(get(cells, ['NUMERO DE COMPTE', 'N° COMPTE', 'COMPTE TITRES', 'COMPTE TITRE', 'NO COMPTE', 'COMPTE']) ?? '').trim(),
        volume: toNum(get(cells, ['VOLUME SOUSCRIT', 'VOLUME', 'QUANTITE', 'NOMINAUX', 'TITRES', 'QTE'])),
        // ACHAT en priorité (sous-colonne de MONTANT ADJUGE dans certains formats BEAC)
        montantAdjuge: toNum(get(cells, ['ACHAT', 'MONTANT ADJUGE', 'MONTANT ACHETE', 'MONTANT SOUSCRIT', 'MONTANT', 'PRIX ACHAT'])),
      });
    }
    return result;
  }

  private normalizePays(code: string, emetteur: string): string {
    const valid = ['CMR', 'GAB', 'CGO', 'TCD', 'RCA', 'GNQ'];
    if (valid.includes(code)) return code;
    const em = (emetteur || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (em.includes('camer') || em.includes('cmr')) return 'CMR';
    if (em.includes('gabon') || em.includes('gab')) return 'GAB';
    if (em.includes('congo') || em.includes('brazza') || em.includes('cog')) return 'CGO';
    if (em.includes('tchad') || em.includes('tcd')) return 'TCD';
    if (em.includes('centr') || em.includes('rca')) return 'RCA';
    if (em.includes('guine') || em.includes('equat') || em.includes('gnq')) return 'GNQ';
    return 'CMR';
  }

  // ─── Validation (matching émission / client) ──────────────────────────────

  private validateRows(raws: RawPortfolioRow[]): ValidatedRow[] {
    const emissions = this.data.emissions();
    const clients = this.data.clientsRegistry();

    return raws.map(raw => {
      const row: ValidatedRow = { ...raw, emissionExists: false, clientExists: false };

      if (!raw.isin) { row.error = 'ISIN manquant'; return row; }
      if (!raw.volume || raw.volume <= 0) { row.error = 'Volume invalide'; return row; }

      // Recherche de l'émission par ISIN exact
      const em = emissions.find(e => e.isin === raw.isin);
      if (em) { row.emissionExists = true; row.emissionId = em.id; }

      // Recherche du client : numéro de compte > matricule > nom approché
      let client = clients.find(c =>
        c.compte?.sousComptes?.some(sc => sc.numero === raw.numeroCompte)
      );
      if (!client && raw.matriculeClient) {
        client = clients.find(c => c.rccm === raw.matriculeClient);
      }
      if (!client && raw.clientNom) {
        const nom = raw.clientNom.toLowerCase().trim();
        client = clients.find(c => {
          const rs = c.raisonSociale.toLowerCase().trim();
          if (rs === nom) return true;
          const l = Math.min(rs.length, nom.length);
          return l >= 6 && (rs.startsWith(nom.slice(0, l)) || nom.startsWith(rs.slice(0, l)));
        });
      }
      if (client) {
        row.clientExists = true;
        row.clientId = client.id;
        // Préférer le sous-compte matchant, sinon le premier
        const sc = client.compte?.sousComptes?.find(sc => sc.numero === raw.numeroCompte)
          ?? client.compte?.sousComptes?.[0];
        if (sc) row.resolvedCompte = sc.numero;
      }

      return row;
    });
  }

  // ─── Import ───────────────────────────────────────────────────────────────

  async runImport() {
    if (!this.isBrowser) return;
    const valid = this.validRows();
    if (!valid.length) return;

    this.step.set('importing');
    this.progress.set(0);

    // Étape 1 — Créer les émissions manquantes
    const toCreate = valid.filter(r => !r.emissionExists);
    const createdIds: Record<string, string> = {};
    let done = 0;

    for (const row of toCreate) {
      this.statusMsg.set(`Création émission ${row.isin}…`);
      try {
        const today = new Date().toISOString().slice(0, 10);
        const em = await lastValueFrom(this.api.createEmission({
          code: row.isin.slice(-6),
          isin: row.isin,
          libelle: row.designation || row.isin,
          nature: row.nature as 'BTA' | 'OTA',
          paysCode: row.paysCode as any,
          dateEmission: row.dateEmission || today,
          ouvertureSouscription: row.dateEmission || today,
          fermetureSouscription: row.dateEmission || today,
          dateEcheance: row.dateEcheance || '',
          dateReglement: row.dateEmission || today,
          valeurNominaleUnitaire: 1_000_000,
          montantGlobal: row.montantAdjuge || 1_000_000,
          tauxNominal: row.tauxNominal || 0,
          montantMinimum: 1_000_000,
          modeAdjudication: 'TAUX',
          observation: 'NOUVELLE EMISSION',
        }));
        createdIds[row.isin] = em.id;
        row.emissionId = em.id;
        row.emissionExists = true;
      } catch {
        row.error = 'Échec création émission';
      }
      this.progress.set(Math.round((++done / Math.max(toCreate.length, 1)) * 45));
    }

    // Étape 2 — Appeler POST /portfolio/import
    const payload: PortfolioImportRow[] = valid
      .filter(r => !r.error)
      .map(r => ({
        isin: r.isin,
        designation: r.designation,
        emetteur: r.emetteur,
        paysCode: r.paysCode,
        nature: r.nature,
        dateEmission: r.dateEmission,
        dateEcheance: r.dateEcheance,
        tauxNominal: r.tauxNominal,
        clientNom: r.clientNom,
        matriculeClient: r.matriculeClient,
        numeroCompte: r.resolvedCompte || r.numeroCompte,
        volume: r.volume,
        montantAdjuge: r.montantAdjuge,
        emissionId: r.emissionId || createdIds[r.isin],
        clientId: r.clientId,
      }));

    this.statusMsg.set(`Import de ${payload.length} position(s)…`);
    this.progress.set(50);

    try {
      const result = await lastValueFrom(this.api.importPortfolioRows(payload));
      this.importResult.set({
        imported: result.imported,
        errors: result.errors.map(e => `${e.clientNom} — ${e.isin}: ${e.error}`),
      });
      this.progress.set(100);
      this.step.set('done');
      if (result.imported > 0) this.data.refreshEmissions();
    } catch (err: any) {
      const status = err?.status;
      const msg = status === 404
        ? "Endpoint non implémenté côté serveur (POST /portfolio/import). Contactez l'équipe backend."
        : (err?.error?.message || err?.message || 'Erreur serveur.');
      this.toast.error('Import échoué', msg);
      this.step.set('preview');
      this.progress.set(0);
    }
  }

  /**
   * Génère et télécharge le modèle d'import de portefeuille au format .xlsx :
   * une ligne par client de la base clients (identité pré-remplie), colonnes
   * titres vides à compléter. Garantit la cohérence des NOMS / MATRICULE /
   * NUMERO DE COMPTE avec le référentiel.
   */
  async telechargerModele() {
    if (!this.isBrowser || this.downloadingModele()) return;
    this.downloadingModele.set(true);
    try {
      const clients = await lastValueFrom(this.api.getAllClientsFb());
      const lignes = construireLignesModele(clients);

      const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
      const wb = new (ExcelJS as any).Workbook();
      const ws = wb.addWorksheet('Portefeuille');
      ws.columns = MODELE_COLONNES.map(h => ({ header: h, key: h, width: Math.max(14, h.length + 2) }));
      ws.getRow(1).font = { bold: true };
      if (lignes.length) {
        lignes.forEach(l => ws.addRow(l));
      } else {
        ws.addRow({});   // base vide : au moins l'en-tête + une ligne à saisir
      }

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'modele-import-portefeuille.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.toast.success('Modèle téléchargé', `${lignes.length} client(s) pré-remplis.`);
    } catch {
      this.toast.error('Téléchargement impossible', 'Impossible de générer le modèle.');
    } finally {
      this.downloadingModele.set(false);
    }
  }

  reset() {
    this.step.set('upload');
    this.rows.set([]);
    this.progress.set(0);
    this.statusMsg.set('');
    this.importResult.set(null);
    this.fileName.set('');
  }
}

/**
 * Lignes du modèle d'import : identité pré-remplie depuis la base clients
 * (NOMS ET PRENOMS, MATRICULE CLIENT, NUMERO DE COMPTE = compte de dépôt / titres) ;
 * les colonnes titres restent vides. Fonction pure (testable sans DOM).
 */
export function construireLignesModele(clients: ClientFbLite[]): Array<Record<string, string>> {
  return clients.map(c => ({
    'NOMS ET PRENOMS': c.nom_prenom ?? '',
    'MATRICULE CLIENT': c.matricule ?? '',
    'NUMERO DE COMPTE': c.compte_depot ?? '',
  }));
}
