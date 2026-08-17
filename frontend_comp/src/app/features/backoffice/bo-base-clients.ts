import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ADMIN_CLIENTS_FB } from '../../core/services/api-endpoints';
import { ToastService } from '../../core/services/toast';
import { LigneBaseClients, ResultatAnalyse, analyser } from './base-clients-parser';
import { Paginator } from '../../shared/pagination';
import { ModalShell } from '../../shared/dialogs';
import { arrayToCsv, downloadBlob } from '../../shared/download';

/** Réponse paginée du serveur : la page demandée + le total, jamais tronqué en silence. */
interface PageClientsFb {
  data: ClientFbRow[];
  page: number;
  size: number;
  total: number;
}

interface ClientFbRow {
  id: string;
  nom_prenom: string;
  numero_compte: string;
  compte_especes: string;
  agence: string;
  matricule: string;
  categorie: string;
  compte_depot: string;
  assujetti_taxes: boolean | null;
  localisation: string;
  dirigeant: string;
  telephone1: string;
  telephone2: string;
  email: string;
}

/** Longueur EXACTE imposée au compte de dépôt (nomenclature bancaire). */
const LONGUEUR_COMPTE_DEPOT = 12;

/**
 * Back-office — référentiel « BASE CLIENTS ».
 *
 * <p>C'est ce référentiel qui permet, à l'inscription en ligne, de savoir si le
 * prospect est **déjà client** : son numéro de compte y est cherché. Un compte
 * connu reprend ses informations ; un compte inconnu déclenche l'orientation en
 * agence.</p>
 */
@Component({
  selector: 'afb-bo-base-clients',
  standalone: true,
  imports: [FormsModule, Paginator, ModalShell],
  template: `
    <div class="max-w-6xl">
      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Base clients</h1>
        <p class="text-sm text-gray-500">
          Référentiel des clients déjà connus de la banque. C'est lui qui est interrogé
          quand un prospect s'inscrit en ligne : compte connu → ses informations sont
          reprises ; compte inconnu → nouveau client, à orienter en agence.
        </p>
      </div>

      <!-- Import -->
      <div class="card mb-4">
        <div class="card-header"><h2 class="font-semibold text-sm">Importer le fichier</h2></div>
        <div class="card-body space-y-3">
          <input type="file" accept=".xlsx,.xlsm,.csv" class="input" (change)="onFile($event)">
          <p class="text-xs text-gray-500">
            Colonnes attendues : NOM ET PRENOM, NUMERO DE COMPTE, AGENCE, MATRICULE,
            CATEGORIE, COMPTE DEPOT, ASSUJETTI TAXES, LOCALISATION, DIRIGEANT,
            TELEPHONE (×2), EMAIL. Un ré-import met à jour les lignes existantes.
          </p>

          @if (analyse(); as a) {
            <div class="rounded-lg border p-3 text-sm space-y-2">
              <p><b>{{ a.lignes.length }}</b> ligne(s) prête(s) à importer.</p>
              @if (a.rejets.length) {
                <details>
                  <summary class="text-red-700 cursor-pointer">
                    {{ a.rejets.length }} ligne(s) écartée(s)
                  </summary>
                  <ul class="mt-1 text-xs text-gray-600 max-h-32 overflow-y-auto">
                    @for (r of a.rejets; track r.ligne) {
                      <li>Ligne {{ r.ligne }} — {{ r.motif }}</li>
                    }
                  </ul>
                  <button type="button" class="btn btn-ghost text-xs mt-2"
                          (click)="telechargerErreurs()">
                    ⬇ Télécharger les lignes en erreur (.csv)
                  </button>
                </details>
              }
              <button type="button" class="btn btn-primary text-sm"
                      [disabled]="busy() || !a.lignes.length" (click)="importer()">
                Importer {{ a.lignes.length }} ligne(s)
              </button>
            </div>
          }
        </div>
      </div>

      <!-- Consultation -->
      <div class="card">
        <div class="card-header flex items-center gap-2">
          <h2 class="font-semibold text-sm flex-1">
            Référentiel
            @if (total()) { <span class="text-xs font-normal text-gray-500">— {{ total() }} client(s)</span> }
          </h2>
          <input class="input text-sm max-w-xs" placeholder="Nom ou numéro de compte…"
                 [(ngModel)]="recherche" name="q" (keyup.enter)="rechercher()">
          <button type="button" class="btn btn-ghost text-sm" (click)="rechercher()">Rechercher</button>
        </div>
        <div class="overflow-x-auto">
          <table class="table text-sm">
            <thead>
              <tr>
                <th>Nom et prénom</th><th>Compte espèces</th><th>Catégorie</th>
                <th>Compte dépôt</th><th>Localisation</th><th>Téléphone</th><th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of clients(); track c.id) {
                <tr>
                  <td class="font-medium">{{ c.nom_prenom }}</td>
                  <td class="font-mono text-xs">{{ c.compte_especes }}</td>
                  <td class="text-xs">{{ c.categorie }}</td>
                  <td class="font-mono text-xs">{{ c.compte_depot || '—' }}</td>
                  <td class="text-xs">{{ c.localisation }}</td>
                  <td class="text-xs">{{ c.telephone1 }}</td>
                  <td class="text-right">
                    <button type="button" class="text-xs text-afb-red hover:underline"
                            (click)="ouvrirEdition(c)">✎ Modifier</button>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="text-center text-xs text-gray-400 py-6">
                  Aucun client dans le référentiel. Importez le fichier de la banque.
                </td></tr>
              }
            </tbody>
          </table>
        </div>
        <div class="p-3 border-t">
          <afb-paginator [total]="total()" [pageSize]="TAILLE_PAGE"
                         [(page)]="page" (pageChange)="charger()" />
        </div>
      </div>

      <!-- Édition d'une fiche existante (sans recréer) -->
      <afb-modal [open]="!!edition()" size="lg" (cancel)="fermerEdition()">
        @if (edition(); as e) {
          <div class="space-y-4">
            <h2 class="text-lg font-bold">Modifier la fiche client</h2>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="sm:col-span-2">
                <label class="label">Nom et prénom</label>
                <input class="input" [(ngModel)]="e.nom_prenom" name="e_nom" required>
              </div>
              <div>
                <label class="label">Numéro de compte (18 chiffres)</label>
                <input class="input font-mono" [(ngModel)]="e.numero_compte" name="e_num"
                       inputmode="numeric" maxlength="23">
              </div>
              <div>
                <label class="label">Compte de dépôt <span class="text-gray-400 font-normal">(12 caractères)</span></label>
                <input class="input font-mono uppercase" [(ngModel)]="e.compte_depot" name="e_dep"
                       maxlength="12" [class.border-afb-red]="depotInvalide()">
                @if (depotInvalide()) {
                  <p class="text-xs text-afb-red mt-1">Le compte de dépôt doit contenir exactement 12 caractères.</p>
                }
              </div>
              <div><label class="label">Catégorie</label><input class="input" [(ngModel)]="e.categorie" name="e_cat"></div>
              <div><label class="label">Matricule</label><input class="input" [(ngModel)]="e.matricule" name="e_mat"></div>
              <div><label class="label">Agence</label><input class="input font-mono" [(ngModel)]="e.agence" name="e_ag" maxlength="5"></div>
              <div><label class="label">Dirigeant</label><input class="input" [(ngModel)]="e.dirigeant" name="e_dir"></div>
              <div><label class="label">Localisation</label><input class="input" [(ngModel)]="e.localisation" name="e_loc"></div>
              <div><label class="label">Téléphone 1</label><input class="input" [(ngModel)]="e.telephone1" name="e_t1"></div>
              <div><label class="label">Téléphone 2</label><input class="input" [(ngModel)]="e.telephone2" name="e_t2"></div>
              <div class="sm:col-span-2"><label class="label">E-mail</label><input class="input" type="email" [(ngModel)]="e.email" name="e_em"></div>
              <label class="sm:col-span-2 flex items-center gap-2 text-sm">
                <input type="checkbox" [(ngModel)]="e.assujetti_taxes" name="e_tax"> Assujetti aux taxes
              </label>
            </div>
            <div class="flex justify-end gap-2 border-t pt-4">
              <button class="btn btn-outline" (click)="fermerEdition()" [disabled]="busy()">Annuler</button>
              <button class="btn btn-primary" [disabled]="busy() || depotInvalide() || !e.nom_prenom?.trim()"
                      (click)="enregistrer()">{{ busy() ? 'Enregistrement…' : 'Enregistrer' }}</button>
            </div>
          </div>
        }
      </afb-modal>
    </div>
  `,
})
export class BoBaseClients {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly analyse = signal<ResultatAnalyse | null>(null);
  readonly clients = signal<ClientFbRow[]>([]);
  readonly busy = signal(false);
  /** Nombre total de lignes correspondant à la recherche — pas seulement la page. */
  readonly total = signal(0);
  readonly page = signal(1);
  readonly TAILLE_PAGE = 25;
  recherche = '';

  /** Fiche en cours d'édition (copie de travail ; null = modal fermé). */
  readonly edition = signal<ClientFbRow | null>(null);
  /** Le compte de dépôt, s'il est renseigné, doit contenir exactement 12 caractères. */
  readonly depotInvalide = computed(() => {
    const d = (this.edition()?.compte_depot ?? '').trim();
    return d.length > 0 && d.length !== LONGUEUR_COMPTE_DEPOT;
  });

  constructor() {
    this.charger();
  }

  /** Ouvre l'édition sur une COPIE (la ligne affichée n'est touchée qu'après succès). */
  ouvrirEdition(c: ClientFbRow): void {
    this.edition.set({ ...c });
  }

  fermerEdition(): void {
    this.edition.set(null);
  }

  /** Enregistre la fiche modifiée (sans la recréer). */
  enregistrer(): void {
    const e = this.edition();
    if (!e || this.busy() || this.depotInvalide() || !e.nom_prenom?.trim()) return;
    this.busy.set(true);
    this.http.put(ADMIN_CLIENTS_FB.UPDATE(e.id), {
      nomPrenom: e.nom_prenom,
      numeroCompte: e.numero_compte,
      agence: e.agence,
      matricule: e.matricule,
      categorie: e.categorie,
      compteDepot: (e.compte_depot ?? '').trim(),
      assujettiTaxes: e.assujetti_taxes ?? null,
      localisation: e.localisation,
      dirigeant: e.dirigeant,
      telephone1: e.telephone1,
      telephone2: e.telephone2,
      email: e.email,
    }).subscribe({
      next: () => {
        this.busy.set(false);
        this.edition.set(null);
        this.toast.success('Fiche mise à jour');
        this.charger();
      },
      error: (err) => {
        this.busy.set(false);
        this.toast.error('Modification impossible', err?.error?.message ?? '');
      },
    });
  }

  /**
   * Charge UNE page depuis le serveur.
   *
   * Le référentiel compte des milliers de lignes : on ne les rapatrie pas pour
   * n'en afficher que vingt-cinq. Le serveur renvoie la page demandée et le
   * total, qui alimente la pagination.
   */
  charger(): void {
    const q = this.recherche.trim();
    const params = new URLSearchParams({
      page: String(this.page()),
      size: String(this.TAILLE_PAGE),
    });
    if (q) params.set('q', q);

    this.http.get<PageClientsFb>(`${ADMIN_CLIENTS_FB.LIST}?${params}`).subscribe({
      next: (r) => {
        this.clients.set(r?.data ?? []);
        this.total.set(r?.total ?? 0);
      },
      error: () => this.toast.error('Chargement du référentiel impossible.'),
    });
  }

  /** Une nouvelle recherche repart de la première page. */
  rechercher(): void {
    this.page.set(1);
    this.charger();
  }

  async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.analyse.set(null);
    try {
      const [entetes, lignes] = await this.lire(file);
      const resultat = analyser(entetes, lignes);
      this.analyse.set(resultat);
      if (!resultat.lignes.length) {
        this.toast.error('Aucune ligne exploitable',
          'Vérifiez que la colonne « NUMERO DE COMPTE » est présente.');
      }
    } catch {
      this.toast.error('Lecture impossible', 'Utilisez un fichier .xlsx, .xlsm ou .csv.');
    }
  }

  /** Renvoie [en-têtes, lignes] — Excel via exceljs, CSV lu directement. */
  private async lire(file: File): Promise<[string[], unknown[][]]> {
    if (/\.csv$/i.test(file.name)) {
      const texte = await file.text();
      const lignes = texte.split(/\r?\n/).filter(l => l.trim()).map(l => decouperCsv(l));
      return [lignes[0] ?? [], lignes.slice(1)];
    }
    const buf = await file.arrayBuffer();
    const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error('feuille absente');

    const entetes: string[] = [];
    const lignes: unknown[][] = [];
    sheet.eachRow((row: any, num: number) => {
      const cellules: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
        cellules[col - 1] = cell.text ?? cell.value ?? '';
      });
      if (num === 1) entetes.push(...(cellules as string[]));
      else lignes.push(cellules);
    });
    return [entetes, lignes];
  }

  /**
   * Exporte les lignes écartées à l'analyse dans un CSV réutilisable : chaque
   * ligne conserve ses colonnes d'origine, précédées de son rang dans le fichier
   * et suivies du motif d'erreur — l'agent corrige puis ré-importe ce seul fichier.
   */
  telechargerErreurs(): void {
    const a = this.analyse();
    if (!a?.rejets.length) return;
    // BOM UTF-8 (﻿) : Excel affiche alors correctement les accents.
    const csv = '﻿' + construireCsvErreurs(a);
    downloadBlob(`lignes-en-erreur-${a.rejets.length}.csv`, csv, 'text/csv;charset=utf-8');
    this.toast.success('Export généré', `${a.rejets.length} ligne(s) en erreur.`);
  }

  importer(): void {
    const a = this.analyse();
    if (!a?.lignes.length || this.busy()) return;
    this.busy.set(true);
    this.http.post<{ importees: number; ignorees: number; doublons: number; depotsInvalides?: number }>(
      ADMIN_CLIENTS_FB.IMPORT, { lignes: a.lignes as LigneBaseClients[] }).subscribe({
        next: (r) => {
          // Doublon d'identité (même nom+prénom, catégorie, téléphone qu'un
          // AUTRE numéro de compte déjà en base) : ligne délibérément écartée,
          // distincte des lignes simplement mal formées (« ignorées »).
          const extras: string[] = [];
          if (r.ignorees) extras.push(`${r.ignorees} ignoré(s)`);
          if (r.doublons) extras.push(`${r.doublons} doublon(s) écarté(s)`);
          if (r.depotsInvalides) extras.push(`${r.depotsInvalides} dépôt(s) invalide(s)`);
          this.toast.success('Import terminé',
            `${r.importees} client(s) enregistré(s)${extras.length ? ', ' + extras.join(', ') : ''}.`);
          this.analyse.set(null);
          this.busy.set(false);
          // Le référentiel vient de changer de taille : la page courante peut ne
          // plus exister. On repart de la première.
          this.rechercher();
        },
        error: (e) => {
          this.toast.error('Import impossible', e?.error?.message ?? '');
          this.busy.set(false);
        },
      });
  }
}

/**
 * Construit le CSV des lignes écartées à l'analyse : rang dans le fichier,
 * colonnes d'origine (rendues uniques — le fichier porte deux colonnes
 * « TELEPHONE » qui s'écraseraient sinon), puis le motif d'erreur. L'agent
 * corrige ce fichier et le ré-importe. Fonction pure (testable sans DOM).
 */
export function construireCsvErreurs(a: ResultatAnalyse): string {
  const brutes = a.entetes.map((e, i) => (e && String(e).trim()) || `Colonne ${i + 1}`);
  const vues = new Set<string>();
  const entetesUniques = brutes.map(h => {
    let nom = h;
    let n = 2;
    while (vues.has(nom)) { nom = `${h} (${n++})`; }
    vues.add(nom);
    return nom;
  });
  const colonnes = ['Ligne', ...entetesUniques, "Motif d'erreur"];

  const rows = a.rejets.map(r => {
    const rec: Record<string, string> = { Ligne: String(r.ligne) };
    entetesUniques.forEach((col, i) => {
      const v = r.valeurs[i];
      rec[col] = v == null ? '' : String(v);
    });
    rec["Motif d'erreur"] = r.motif;
    return rec;
  });
  return arrayToCsv(rows, colonnes);
}

/** Découpe une ligne CSV en respectant les champs entre guillemets. */
export function decouperCsv(ligne: string): string[] {
  const champs: string[] = [];
  let courant = '';
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      // Deux guillemets consécutifs à l'intérieur d'un champ = un guillemet littéral.
      if (entreGuillemets && ligne[i + 1] === '"') { courant += '"'; i++; }
      else entreGuillemets = !entreGuillemets;
    } else if ((c === ',' || c === ';') && !entreGuillemets) {
      champs.push(courant.trim());
      courant = '';
    } else {
      courant += c;
    }
  }
  champs.push(courant.trim());
  return champs;
}
