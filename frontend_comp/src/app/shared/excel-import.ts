import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ToastService } from '../core/services/toast';
import { Emission, TitleType, EmissionStatus } from '../core/models/models';
import { ModalShell } from './dialogs';
import { downloadBlob } from './download';

type RawRow = Record<string, any>;
interface ParsedRow {
  idx: number;
  raw: RawRow;
  parsed: Partial<Emission> & { status: EmissionStatus };
  errors: string[];
  ok: boolean;
}

/** Fenêtre de recherche du taux dans DESIGNATION (« … OTA 4 ANS 6,20% … »).
 *  Borne l'entrée du motif : une cellule Excel peut faire 32 767 caractères. */
const DESIGNATION_SCAN_MAX = 200;

const EMETTEURS_OK = ['Cameroun','Gabon','Tchad','Congo','RCA','Guinée Équatoriale','Guinée Equatoriale'];
const EMETTEUR_NORM: Record<string,string> = {
  cameroun:'Cameroun', cmr:'Cameroun',
  gabon:'Gabon', gab:'Gabon',
  tchad:'Tchad', tcd:'Tchad',
  congo:'Congo', cog:'Congo', congobrazzaville:'Congo',
  rca:'RCA', centrafrique:'RCA', republiquecentrafricaine:'RCA',
  guineeequatoriale:'Guinée Équatoriale', guineeeq:'Guinée Équatoriale', gnq:'Guinée Équatoriale'
};

/** Template BEAC officiel — colonnes identiques au fichier CEMAC/BEAC */
const TEMPLATE_ROWS = [
  {
    'NATURE': 'BTA',
    'EMETTEUR': 'CAMEROUN',
    'DESIGNATION': 'CM1300001201 BTA 52 07 AVRIL 2027',
    "DATE D'ECHEANCE": '07/04/2027',
    'MATURITE': '52 SEMAINES',
    'VALEUR UNITAIRE': 1000000,
    "VOLUME D'EMISSION (en millions de fcfa)": 20000,
    'DATE LIMITE DE SOUSCRIPTION': '06/04/2026',
    'HEURE LIMITE DE SOUSCRIPTION': '9h00mn',
    'TAUX/PRIX': 'ADJ',
    'OBSERVATIONS': 'NOUVELLE EMISSION'
  },
  {
    'NATURE': 'OTA',
    'EMETTEUR': 'CONGO',
    'DESIGNATION': 'CG2K00000146 OTA 4 ANS 6,20% 31 AOUT 2027',
    "DATE D'ECHEANCE": '31/08/2027',
    'MATURITE': '1,39 AN',
    'VALEUR UNITAIRE': 10000,
    "VOLUME D'EMISSION (en millions de fcfa)": 15000,
    'DATE LIMITE DE SOUSCRIPTION': '07/04/2026',
    'HEURE LIMITE DE SOUSCRIPTION': '9h00mn',
    'TAUX/PRIX': 'ADJ',
    'OBSERVATIONS': 'ABONDEMENT'
  }
];

function normalizeKey(k: string): string {
  return String(k).toLowerCase().trim()
    .replaceAll(/[àâä]/g,'a').replaceAll(/[éèêë]/g,'e').replaceAll(/[îï]/g,'i').replaceAll(/[ôö]/g,'o').replaceAll(/[ùûü]/g,'u').replaceAll('ç','c')
    .replaceAll(/[\s\-_]+/g,'');
}

/** Mapping clés BEAC ET format interne */
const KEY_MAP: Record<string,string> = {
  // BEAC officiel
  nature:'nature', type:'nature',
  emetteur:'emetteur', etat:'emetteur', etatemetteur:'emetteur',
  designation:'designation', libelle:'designation',
  datedecheance:'dateEcheance', dateecheance:'dateEcheance', echeance:'dateEcheance',
  maturite:'maturite', duree:'maturite',
  valeurunitaire:'valeurNominaleUnitaire', nominalunitaire:'valeurNominaleUnitaire', nominal:'valeurNominaleUnitaire', valeurnominaleunitaire:'valeurNominaleUnitaire',
  volumedemission:'volumeMillions', volumedemissionenmillionsdefcfa:'volumeMillions', volume:'volumeMillions', volumeenmillionsdefcfa:'volumeMillions',
  datelimitedesouscription:'dateLimite', datelimite:'dateLimite',
  heurelimitedesouscription:'heureLimite', heurelimite:'heureLimite',
  tauxprix:'tauxPrix', taux:'tauxPrix', prix:'tauxPrix', tauxnominal:'tauxPrix',
  observations:'observations', obs:'observations',
  // Format interne direct (rétrocompat)
  code:'code', codeemission:'code',
  dateemission:'dateEmission', montantglobal:'montantGlobal', montant:'montantGlobal',
  ouverturesouscription:'ouvertureSouscription', ouverture:'ouvertureSouscription',
  fermeturesouscription:'fermetureSouscription', fermeture:'fermetureSouscription',
  datereglement:'dateReglement', reglement:'dateReglement',
  dureejours:'dureeJours',
  description:'description', notice:'description'
};

/**
 * Extrait la valeur brute d'une cellule ExcelJS en tenant compte de son type :
 *  2=Nombre  3=Texte  4=Date  5=Hyperlien  6=Formule  7=TextePartagé  8=TexteRiche  9=Booléen  10=Erreur
 * Renvoie toujours number | Date | string | null — jamais d'objet opaque.
 */
function extractCellValue(cell: any): number | Date | string | null {
  // Type 6 — Formule : utiliser le résultat calculé, pas la formule elle-même
  if (cell.type === 6) {
    const res = cell.value?.result ?? null;
    if (res == null) return null;
    if (res instanceof Date) return res;
    if (typeof res === 'number') return res;
    if (typeof res === 'boolean') return res ? 'VRAI' : 'FAUX';
    if (typeof res === 'object') {
      if ('richText' in res) return res.richText.map((r: any) => r.text ?? '').join('');
      if ('error' in res) return null;
    }
    return String(res);
  }
  // Type 8 — Texte riche : concaténer les fragments
  if (cell.type === 8) {
    return (cell.value?.richText ?? []).map((r: any) => r.text ?? '').join('');
  }
  // Type 5 — Hyperlien : prendre le texte affiché
  if (cell.type === 5) return cell.value?.text ?? cell.text ?? null;
  // Type 9 — Booléen
  if (cell.type === 9) return cell.value === true ? 'VRAI' : 'FAUX';
  // Type 10 — Erreur de cellule (#REF!, #N/A…)
  if (cell.type === 10) return null;
  // Types 2, 3, 4, 7 : valeur directe (number, string, Date)
  const v = cell.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number' || typeof v === 'string') return v;
  // Garde-fou pour tout autre objet inattendu
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r: any) => r.text ?? '').join('');
    if ('result' in v) return v.result ?? null;
    if ('text' in v) return String(v.text);
    if ('error' in v) return null;
  }
  return String(v);
}

/** Extrait le texte d'une cellule d'en-tête (toujours une string). */
function extractCellText(cell: any): string {
  const v = extractCellValue(cell);
  return v == null ? '' : String(v);
}

/** Extrait le code ISIN / identifiant depuis DESIGNATION : "CM1300001201 BTA 52 07 AVRIL 2027" → "CM1300001201" */
function extractCodeFromDesignation(designation: string): string {
  if (!designation) return '';
  const m = String(designation).trim().match(/^[A-Z0-9]+/i);
  return m ? m[0].toUpperCase() : '';
}

/** Convertit MATURITE texte → durée en jours : "52 SEMAINES" → 364, "2 ANS" → 730, "1,39 AN" → 507 */
function maturiteToJours(maturite: any): number {
  if (maturite == null) return Number.NaN;
  const s = String(maturite).toLowerCase().replace(',','.').trim();
  const n = Number.parseFloat(s);
  if (Number.isNaN(n)) return Number.NaN;
  if (/semaine/.test(s)) return Math.round(n * 7);
  if (/mois/.test(s)) return Math.round(n * 30);
  if (/an/.test(s)) return Math.round(n * 365);
  if (/jour/.test(s)) return Math.round(n);
  return Math.round(n);
}

/** Convertit "9h00mn" / "09:00" / "9h30" → "09:00" */
function heureToHHMM(v: any): string {
  if (v == null || v === '') return '09:00';
  if (typeof v === 'number') {
    // Excel time serial (fraction of day)
    const totalMin = Math.round(v * 24 * 60);
    const h = Math.floor(totalMin / 60), mn = totalMin % 60;
    return `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}`;
  }
  const s = String(v).toLowerCase().replace(/\s/g,'');
  const m = s.match(/(\d{1,2})[h:](\d{0,2})/);
  if (m) return `${m[1].padStart(2,'0')}:${(m[2] || '00').padStart(2,'0')}`;
  return '09:00';
}

/** Ajoute n jours à une date YYYY-MM-DD */
function addDays(dateStr: string, days: number): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}

function mapRow(raw: RawRow): RawRow {
  const out: RawRow = {};
  for (const [k,v] of Object.entries(raw)) {
    const nk = normalizeKey(k);
    const mapped = KEY_MAP[nk] ?? nk;
    out[mapped] = v;
  }
  return out;
}

/** Convertit un n° de série Excel (jours depuis 1899-12-30) en Date UTC. */
function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial - 25569);
  const utcSeconds = utcDays * 86400;
  const fractional = serial - Math.floor(serial);
  const ms = Math.round(fractional * 86400 * 1000);
  return new Date(utcSeconds * 1000 + ms);
}

function toDateStr(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0,10);
  if (typeof v === 'number') {
    const d = excelSerialToDate(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0,10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return s.slice(0,10);
}

function toDateTimeStr(v: any): string {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0,16).replace('T',' ');
  if (typeof v === 'number') {
    const d = excelSerialToDate(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0,16).replace('T',' ');
  }
  return String(v).trim().replace('T',' ').slice(0,16);
}

function toNumber(v: any): number {
  if (v == null || v === '') return Number.NaN;
  if (typeof v === 'number') return v;
  return Number(String(v).replaceAll(/\s/g,'').replace(',','.'));
}

function validateRow(raw: RawRow, idx: number): ParsedRow {
  const m = mapRow(raw);
  const errors: string[] = [];

  // Nature
  const nature = String(m['nature'] ?? '').toUpperCase().trim();
  if (!nature) errors.push('Nature manquante');
  else if (nature !== 'BTA' && nature !== 'OTA') errors.push(`Nature invalide (BTA ou OTA): ${nature}`);

  // Émetteur (normalisation CAMEROUN → Cameroun)
  const emRaw = String(m['emetteur'] ?? '').trim();
  let emetteur = '';
  if (!emRaw) errors.push('Émetteur manquant');
  else {
    const key = emRaw.toLowerCase().replace(/[\s\-']/g,'').replace(/[àâä]/g,'a').replace(/[éèêë]/g,'e').replace(/[îï]/g,'i').replace(/[ôö]/g,'o').replace(/[ùûü]/g,'u');
    emetteur = EMETTEUR_NORM[key] ?? (EMETTEURS_OK.find(e => e.toLowerCase() === emRaw.toLowerCase()) ?? emRaw);
    if (!EMETTEURS_OK.includes(emetteur)) errors.push(`État émetteur non reconnu: ${emRaw}`);
  }

  // Code ISIN + libellé depuis DESIGNATION : "CM1300001201 BTA 52 07 AVRIL 2027"
  const designation = String(m['designation'] ?? '').trim();
  const isin = (m['code'] ? String(m['code']) : extractCodeFromDesignation(designation)).trim().toUpperCase();
  const code = isin;
  // Libellé = tout ce qui suit le code dans DESIGNATION (ex: "BTA 52 07 AVRIL 2027")
  const libelle = designation.startsWith(isin)
    ? designation.slice(isin.length).trim()
    : designation;
  if (!code) errors.push('Code / désignation manquant');

  // Échéance
  const dateEcheance = toDateStr(m['dateEcheance']);
  if (!dateEcheance) errors.push('Date d\'échéance manquante');

  // Maturité → jours (ou dureeJours direct)
  let dureeJours = 0;
  if (m['maturite'] != null && m['maturite'] !== '') dureeJours = maturiteToJours(m['maturite']);
  else if (m['dureeJours'] != null) dureeJours = toNumber(m['dureeJours']);
  if (Number.isNaN(dureeJours) || dureeJours <= 0) errors.push('Maturité / durée invalide');

  // Valeur unitaire
  const vnu = toNumber(m['valeurNominaleUnitaire']);
  if (Number.isNaN(vnu) || vnu < 10000) errors.push('Valeur unitaire < 10 000 FCFA');

  // Volume BEAC en millions → montantGlobal en FCFA
  let montantGlobal = Number.NaN;
  if (m['volumeMillions'] != null && m['volumeMillions'] !== '') {
    montantGlobal = toNumber(m['volumeMillions']) * 1_000_000;
  } else if (m['montantGlobal'] != null) {
    montantGlobal = toNumber(m['montantGlobal']);
  }
  if (Number.isNaN(montantGlobal) || montantGlobal <= 0) errors.push('Volume / montant d\'émission invalide');

  // Date limite + heure limite → fermetureSouscription
  const dateLimite = toDateStr(m['dateLimite']) || toDateStr(m['fermetureSouscription']);
  const heureLimite = heureToHHMM(m['heureLimite']);
  let fermetureSouscription = '';
  if (dateLimite) fermetureSouscription = `${dateLimite} ${heureLimite}`;
  else if (m['fermetureSouscription']) fermetureSouscription = toDateTimeStr(m['fermetureSouscription']);
  if (!fermetureSouscription) errors.push('Date limite de souscription manquante');

  // Ouverture : 7 jours avant la fermeture (ou explicit)
  const defaultOuverture = dateLimite ? `${addDays(dateLimite, -7)} 08:00` : '';
  const ouvertureSouscription = m['ouvertureSouscription']
    ? toDateTimeStr(m['ouvertureSouscription'])
    : defaultOuverture;

  // Date d'émission = date limite + 1j (règlement J+1 BEAC) — à ajuster
  const defaultDateEmission = dateLimite ? addDays(dateLimite, 1) : '';
  const dateEmission = m['dateEmission'] ? toDateStr(m['dateEmission']) : defaultDateEmission;
  const dateReglement = m['dateReglement'] ? toDateStr(m['dateReglement']) : dateEmission;

  // Taux : "ADJ" = adjudication (0 = variable) ; sinon valeur numérique. Si OTA, tenter d'extraire depuis DESIGNATION "6,20%"
  let tauxNominal = 0;
  const tauxPrix = String(m['tauxPrix'] ?? '').toUpperCase().trim();
  if (tauxPrix && tauxPrix !== 'ADJ' && tauxPrix !== 'PRIX') {
    const n = toNumber(tauxPrix);
    if (!Number.isNaN(n)) tauxNominal = n;
  }
  if (!tauxNominal && designation) {
    // Quantificateurs disjoints : la partie décimale exige son séparateur, donc
    // aucun retour arrière super-linéaire sur une longue suite de chiffres.
    // La désignation est en outre bornée : une cellule Excel peut contenir
    // 32 767 caractères, ce qui rendrait la recherche non ancrée quadratique.
    const tm = designation.slice(0, DESIGNATION_SCAN_MAX).match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (tm) tauxNominal = Number(tm[1].replace(',','.'));
  }
  if (tauxNominal > 30) errors.push('Taux nominal > 30 %');

  const observations = m['observations'] ? String(m['observations']).trim().toUpperCase() : '';
  const observation = observations || undefined;
  const description = [designation, observations].filter(Boolean).join(' · ') || undefined;

  const parsed: Partial<Emission> & { status: EmissionStatus } = {
    code,
    isin: code,
    libelle: libelle || designation,
    nature: nature as TitleType,
    emetteur,
    dateEmission,
    dateEcheance,
    dureeJours,
    tauxNominal,
    valeurNominaleUnitaire: vnu,
    montantGlobal,
    ouvertureSouscription,
    fermetureSouscription,
    dateReglement,
    observation,
    description,
    status: 'BROUILLON'
  };
  return { idx, raw: m, parsed, errors, ok: errors.length === 0 };
}

@Component({
  selector: 'afb-excel-import',
  imports: [DecimalPipe, ModalShell],
  template: `
    <afb-modal [open]="open" size="6xl" (cancel)="close()">
      <div class="p-4 sm:p-6 overflow-y-auto">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h2 class="text-lg sm:text-xl font-bold">Import des émissions depuis Excel / CSV</h2>
            <p class="text-xs sm:text-sm text-gray-500 mt-1">Chargez un fichier contenant les ordres d'émission transmis par les États de la CEMAC (BTA, OTA). Formats : <b>.xlsx, .xls, .csv</b>.</p>
          </div>
          <button class="btn btn-ghost text-xl shrink-0" (click)="close()">✕</button>
        </div>

        @if (!rows().length) {
          <div class="mt-5 sm:mt-6">
            <div class="border-2 border-dashed border-gray-300 rounded-lg p-6 sm:p-10 text-center"
                 (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
              <div class="text-4xl sm:text-5xl">📥</div>
              <div class="font-medium mt-3 text-sm sm:text-base">Glissez-déposez votre fichier ici</div>
              <div class="text-xs text-gray-500 mt-1">ou</div>
              <input #fileInput type="file" accept=".xlsx,.xls,.csv" class="hidden" (change)="onFile($event)">
              <button class="btn btn-primary mt-3" (click)="fileInput.click()">📂 Sélectionner un fichier</button>
              <div class="text-[11px] text-gray-400 mt-3">Taille max : 5 Mo</div>
            </div>

            <div class="mt-5 sm:mt-6 bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 text-sm text-blue-900">
              <div class="font-semibold">Format officiel BEAC / CEMAC — colonnes attendues :</div>
              <div class="font-mono text-[10px] sm:text-[11px] mt-2 leading-relaxed break-words">
                NATURE · EMETTEUR · DESIGNATION · DATE D'ECHEANCE · MATURITE · VALEUR UNITAIRE · VOLUME D'EMISSION (en millions de fcfa) · DATE LIMITE DE SOUSCRIPTION · HEURE LIMITE DE SOUSCRIPTION · TAUX/PRIX · OBSERVATIONS
              </div>
              <div class="text-[11px] mt-2 italic">
                Le code est extrait automatiquement depuis DESIGNATION. Volume × 1 000 000 (millions). Maturité « 52 SEMAINES », « 2 ANS », « 1,39 AN » convertie en jours.
              </div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button class="btn btn-outline text-xs" (click)="downloadTemplateXlsx()">⬇ Modèle Excel (BEAC)</button>
                <button class="btn btn-outline text-xs" (click)="downloadTemplateCsv()">⬇ Modèle CSV</button>
              </div>
            </div>
          </div>
        } @else {
          <div class="mt-5">
            <div class="flex items-start sm:items-center justify-between mb-3 gap-3 flex-wrap">
              <div class="text-xs sm:text-sm min-w-0">
                <b class="break-all">{{ fileName() }}</b> — {{ rows().length }} ligne(s) ·
                <span class="text-emerald-600 font-semibold">{{ okCount() }} valide(s)</span> ·
                <span class="text-red-600 font-semibold">{{ errCount() }} erreur(s)</span>
              </div>
              <button class="btn btn-outline text-xs shrink-0" (click)="reset()">↺ Changer de fichier</button>
            </div>

            <div class="border rounded-lg overflow-auto max-h-[50vh] sm:max-h-96">
              <table class="table text-xs min-w-[820px]">
                <thead class="sticky top-0 bg-gray-50 z-10">
                  <tr>
                    <th class="w-10">#</th>
                    <th>Code</th>
                    <th>Nat.</th>
                    <th>Émetteur</th>
                    <th>Émission</th>
                    <th>Échéance</th>
                    <th>Durée</th>
                    <th>Taux</th>
                    <th>Nominal</th>
                    <th>Montant</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows(); track r.idx) {
                    <tr [class.bg-red-50]="!r.ok" [class.bg-emerald-50]="r.ok">
                      <td>{{ r.idx + 1 }}</td>
                      <td class="font-mono font-semibold">{{ r.parsed.code }}</td>
                      <td>{{ r.parsed.nature }}</td>
                      <td>{{ r.parsed.emetteur }}</td>
                      <td>{{ r.parsed.dateEmission }}</td>
                      <td>{{ r.parsed.dateEcheance }}</td>
                      <td>{{ r.parsed.dureeJours }} j</td>
                      <td>{{ r.parsed.tauxNominal }} %</td>
                      <td class="text-right">{{ r.parsed.valeurNominaleUnitaire | number:'1.0-0':'fr-FR' }}</td>
                      <td class="text-right">{{ r.parsed.montantGlobal | number:'1.0-0':'fr-FR' }}</td>
                      <td>
                        @if (r.ok) { <span class="badge bg-emerald-100 text-emerald-700">✓ OK</span> }
                        @else { <span class="badge bg-red-100 text-red-700" [title]="r.errors.join(' · ')">✕ {{ r.errors.length }} err.</span> }
                      </td>
                    </tr>
                    @if (!r.ok) {
                      <tr class="bg-red-50">
                        <td colspan="11" class="text-[11px] text-red-700 pl-4 sm:pl-12">
                          @for (e of r.errors; track e) { <span class="mr-2">• {{ e }}</span> }
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>

            <div class="mt-4 p-3 sm:p-4 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <b>⚠️ Rappel :</b> seules les lignes valides seront importées. Les émissions sont créées en statut <b>Brouillon</b> puis publiables individuellement.
            </div>

            <div class="flex flex-col sm:flex-row sm:justify-between gap-2 mt-4 pt-4 border-t">
              <button class="btn btn-outline" (click)="close()">Annuler</button>
              <div class="flex flex-col sm:flex-row gap-2">
                <button class="btn btn-outline" [disabled]="!okCount()" (click)="importAll('BROUILLON')">
                  Importer en brouillon ({{ okCount() }})
                </button>
                <button class="btn btn-primary" [disabled]="!okCount()" (click)="importAll('PUBLIE')">
                  Importer et publier ({{ okCount() }})
                </button>
              </div>
            </div>
          </div>
        }
      </div>
    </afb-modal>
  `
})
export class ExcelImport {
  @Input() open = false;
  @Output() close$ = new EventEmitter<void>();
  @Output() imported = new EventEmitter<Array<Partial<Emission> & { status: EmissionStatus }>>();
  toast = inject(ToastService);
  rows = signal<ParsedRow[]>([]);
  fileName = signal('');

  okCount() { return this.rows().filter(r => r.ok).length; }
  errCount() { return this.rows().filter(r => !r.ok).length; }

  onDrop(ev: DragEvent) {
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file) this.parseFile(file);
  }
  onFile(ev: Event) {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (file) this.parseFile(file);
  }

  async parseFile(file: File) {
    // Limites strictes pour réduire la surface d'attaque (DoS, ReDoS, prototype pollution)
    if (file.size > 5 * 1024 * 1024) { this.toast.error('Fichier trop volumineux', 'Maximum 5 Mo.'); return; }
    if (file.size === 0) { this.toast.error('Fichier vide', 'Le fichier sélectionné est vide.'); return; }
    const allowedExt = /\.(xlsx|xlsm)$/i;
    if (!allowedExt.test(file.name)) { this.toast.error('Format non supporté', 'Utilisez un fichier .xlsx ou .xlsm.'); return; }
    const allowedMime = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel.sheet.macroEnabled.12',''];
    if (file.type && !allowedMime.includes(file.type)) {
      this.toast.error('Type MIME inattendu', 'Seuls les fichiers Excel sont acceptés.');
      return;
    }
    this.fileName.set(file.name);
    try {
      const buf = await file.arrayBuffer();
      // Import dynamique → exclu du bundle initial et permet de capturer une éventuelle erreur de chargement
      const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
      const wb = new (ExcelJS as any).Workbook();
      await wb.xlsx.load(buf);
      const sheet = wb.worksheets[0];
      if (!sheet) { this.toast.error('Fichier vide', 'Aucune feuille détectée.'); return; }
      const headers: string[] = [];
      const raws: RawRow[] = [];
      const MAX_ROWS = 5000;
      sheet.eachRow((row: any, rowNum: number) => {
        if (rowNum === 1) {
          row.eachCell({ includeEmpty: false }, (cell: any, col: number) => {
            headers[col] = extractCellText(cell);
          });
          return;
        }
        if (rowNum - 1 > MAX_ROWS) return;
        // Object.create(null) → pas de prototype : protection contre la prototype pollution
        const obj: RawRow = Object.create(null) as RawRow;
        row.eachCell({ includeEmpty: false }, (cell: any, col: number) => {
          const key = headers[col];
          if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') return;
          obj[key] = extractCellValue(cell);
        });
        raws.push(obj);
      });
      if (!raws.length) { this.toast.error('Fichier vide', 'Aucune ligne trouvée.'); return; }
      const parsed = raws.map((r, i) => validateRow(r, i));
      this.rows.set(parsed);
      this.toast.info('Fichier analysé', `${parsed.length} ligne(s) · ${parsed.filter(x=>x.ok).length} valide(s).`);
    } catch (e: any) {
      // N'expose pas les détails de l'exception au-delà du nécessaire
      this.toast.error('Erreur de lecture', 'Fichier illisible ou corrompu.');
    }
  }

  importAll(status: 'BROUILLON' | 'PUBLIE') {
    const valid = this.rows().filter(r => r.ok).map(r => ({ ...r.parsed, status }));
    this.imported.emit(valid);
    this.toast.success(`${valid.length} émission(s) importée(s)`, status === 'PUBLIE' ? 'Publiées immédiatement.' : 'Enregistrées en brouillon.');
    this.reset();
    this.close();
  }

  reset() { this.rows.set([]); this.fileName.set(''); }
  close() { this.reset(); this.close$.emit(); }

  downloadTemplateCsv() {
    const headers = Object.keys(TEMPLATE_ROWS[0]);
    const esc = (v: any) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s; };
    const lines = [
      headers.map(esc).join(';'),
      ...TEMPLATE_ROWS.map(r => headers.map(h => esc((r as any)[h] ?? '')).join(';'))
    ];
    downloadBlob('modele-emissions-BEAC.csv', lines.join('\n'), 'text/csv;charset=utf-8');
    this.toast.success('Modèle CSV téléchargé');
  }

  async downloadTemplateXlsx() {
    if (typeof document === 'undefined') return;
    const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new (ExcelJS as any).Workbook();
    const ws = wb.addWorksheet('Emissions BEAC');
    const headers = Object.keys(TEMPLATE_ROWS[0]);
    ws.columns = headers.map((h, i) => ({
      header: h, key: h,
      width: [8, 12, 40, 16, 14, 16, 30, 24, 24, 12, 20][i] ?? 16
    }));
    for (const r of TEMPLATE_ROWS) ws.addRow(r);
    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.rel = 'noopener noreferrer';
    a.href = url; a.download = 'modele-emissions-BEAC.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.toast.success('Modèle Excel téléchargé');
  }
}
