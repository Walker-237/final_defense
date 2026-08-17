import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { BankSignaturesService } from '../../core/services/bank-signatures';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';
import { PdfProgressService } from '../../core/services/pdf-progress';
import { ApiService } from '../../core/services/api';
import {
  Emission, EmissionStatus, EMISSION_STATUS_LABELS,
  Order, OrderStatus, ORDER_STATUS_LABELS,
  DocumentType, DOCUMENT_TYPE_LABELS,
  PaysCEMAC, PAYS_CEMAC,
  Permission, PERMISSION_LABELS, ALL_PERMISSIONS, UserRole,
  CategorieClient, CATEGORIES_CLIENT
} from '../../core/models/models';
import { TwoSignDialog, ConfirmDialog, ModalShell } from '../../shared/dialogs';
import { SignatureViewer } from '../../shared/signature-pad';
import { arrayToCsv, downloadBlob, downloadClientOrderPdf, buildClientOrderFormHtml, printAvisOpere, downloadAvisOperePdf } from '../../shared/download';
import { ExcelImport } from '../../shared/excel-import';
import { Paginator, PaginatePipe } from '../../shared/pagination';
import { afficherCompte, classeEtatComptes } from '../../shared/etat-comptes';
import { BarChart, LineChart, DonutChart } from '../../shared/charts';
import { FaceVerifyPanel } from './face-verify-panel';
import { OrderFaceCompare } from './order-face-compare';
import { OrderJointSignatures } from './order-joint-signatures';
import {
  pendingCount, volumeTotal, activeClients, ordersByWeekday, natureSplit,
  volumeByMonth, countByMonth, pctChange, parseDate,
} from '../../shared/analytics';

/** CSFT §5.2 — classe CSS de badge pour un statut d'ordre. */
function orderBadgeClass(s: OrderStatus): string {
  return ({
    SOUMIS: 'badge-soumis',
    EN_VERIFICATION: 'badge-enverification',
    EN_ATTENTE_ADJUDICATION: 'badge-enattenteadj',
    TOTALEMENT_RETENU: 'badge-totalretenu',
    PARTIELLEMENT_RETENU: 'badge-partielretenu',
    NON_RETENU: 'badge-nonretenu',
    ANNULE: 'badge-annule',
    EN_ATTENTE_SIGNATURES: 'badge-enattenteadj',
  } as Record<OrderStatus, string>)[s];
}

function emissionBadgeClass(s: EmissionStatus): string {
  return ({
    BROUILLON: 'badge-brouillon',
    PUBLIE: 'badge-publie',
    CLOTURE: 'badge-cloture',
    ARCHIVE: 'badge-archive',
  } as Record<EmissionStatus, string>)[s];
}

/* ====================== TABLEAU DE BORD ====================== */
@Component({
  selector: 'afb-bo-dashboard',
  imports: [DecimalPipe, BarChart, LineChart, DonutChart],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Tableau de bord</h1>
          <p class="text-sm text-gray-500">Vue d'ensemble des opérations SVT</p>
        </div>
      </div>

      <!-- KPI — indicateurs réels dérivés des ordres collectés -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div class="kpi !p-3 !gap-0.5">
          <div class="flex items-start justify-between">
            <span class="kpi-label !text-[10px]">Ordres en attente</span>
            <span class="w-7 h-7 rounded-lg bg-afb-red-light text-afb-red flex items-center justify-center text-sm">⏱</span>
          </div>
          <span class="kpi-value !text-xl">{{ pending() }}</span>
          <span class="text-[11px] text-gray-400">à traiter</span>
        </div>
        <div class="kpi !p-3 !gap-0.5">
          <div class="flex items-start justify-between">
            <span class="kpi-label !text-[10px]">Ordres (ce mois)</span>
            <span class="w-7 h-7 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center text-sm">✓</span>
          </div>
          <span class="kpi-value !text-xl">{{ ordersThisMonth() }}</span>
          <span class="kpi-trend !text-[11px]" [class.!text-rose-600]="ordersTrend() < 0">{{ trendLabel(ordersTrend()) }} vs préc.</span>
        </div>
        <div class="kpi !p-3 !gap-0.5">
          <div class="flex items-start justify-between">
            <span class="kpi-label !text-[10px]">Volume (FCFA)</span>
            <span class="w-7 h-7 rounded-lg bg-gray-900 text-white flex items-center justify-center text-sm">📈</span>
          </div>
          <span class="kpi-value !text-xl">{{ fmtFcfa(volume()) }}</span>
          <span class="kpi-trend !text-[11px]" [class.!text-rose-600]="volumeTrend() < 0">{{ trendLabel(volumeTrend()) }} vs préc.</span>
        </div>
        <div class="kpi !p-3 !gap-0.5">
          <div class="flex items-start justify-between">
            <span class="kpi-label !text-[10px]">Clients actifs</span>
            <span class="w-7 h-7 rounded-lg bg-gray-100 text-gray-700 flex items-center justify-center text-sm">👥</span>
          </div>
          <span class="kpi-value !text-xl">{{ clients() }}</span>
          <span class="text-[11px] text-gray-400">avec un ordre</span>
        </div>
      </div>

      <!-- Graphiques compact 3 colonnes -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <div class="card lg:col-span-2">
          <div class="card-header !py-2.5"><h2 class="font-semibold text-sm">Ordres par jour</h2><span class="text-xs text-gray-400">semaine en cours</span></div>
          <div class="p-3"><afb-bar-chart [data]="byDay()" /></div>
        </div>
        <div class="card">
          <div class="card-header !py-2.5"><h2 class="font-semibold text-sm">Répartition BTA / OTA</h2></div>
          <div class="p-3">
            @if (byNature().length) { <afb-donut-chart [data]="byNature()" /> }
            @else { <p class="text-xs text-gray-400">Aucun ordre collecté.</p> }
          </div>
        </div>
      </div>

      <div class="card mb-4">
        <div class="card-header !py-2.5"><h2 class="font-semibold text-sm">Évolution du volume mensuel (M FCFA)</h2></div>
        <div class="p-3"><afb-line-chart [data]="byMonth()" /></div>
      </div>

      <!-- Ordres récents -->
      <div class="card">
        <div class="card-header"><h2 class="font-semibold">Ordres récents</h2></div>
        <div class="overflow-x-auto"><table class="table min-w-[680px] sm:min-w-full">
          <thead><tr><th>N° ordre</th><th>Client</th><th>Type</th><th>Montant</th><th>Statut</th><th>Date</th></tr></thead>
          <tbody>
            @for (o of recent(); track o.id) {
              <tr>
                <td class="font-mono text-xs font-semibold">{{ o.reference }}</td>
                <td>{{ o.clientNom }}</td>
                <td><span class="badge" [class]="o.nature === 'BTA' ? 'bg-afb-red-light text-afb-red' : 'bg-gray-900 text-white'">{{ o.nature }}</span></td>
                <td>{{ o.montant | number:'1.0-0':'fr-FR' }}</td>
                <td><span class="badge" [class]="ordClass(o.status)">{{ ordLabel(o.status) }}</span></td>
                <td class="text-xs text-gray-500">{{ shortDate(o.dateSoumission) }}</td>
              </tr>
            }
            @if (!recent().length) {
              <tr><td colspan="6" class="text-center text-gray-400 py-8">Aucun ordre collecté pour le moment.</td></tr>
            }
          </tbody>
        </table></div>
      </div>
    </div>
  `
})
export class BoDashboard {
  data = inject(MockData);

  constructor() {
    // Indicateurs à jour à l'ouverture du tableau de bord.
    this.data.refreshOrders();
    this.data.refreshEmissions();
  }

  private readonly orders = computed(() => this.data.orders());

  pending = computed(() => pendingCount(this.orders()));
  volume = computed(() => volumeTotal(this.orders()));
  clients = computed(() => activeClients(this.orders()));

  byDay = computed(() => ordersByWeekday(this.orders()));
  byNature = computed(() => natureSplit(this.orders()));
  byMonth = computed(() => volumeByMonth(this.orders(), 6));

  recent = computed(() =>
    [...this.orders()]
      .sort((a, b) => (parseDate(b.dateSoumission) ?? 0) - (parseDate(a.dateSoumission) ?? 0))
      .slice(0, 6));

  // Tendances réelles : mois courant vs mois précédent.
  ordersThisMonth = computed(() => countByMonth(this.orders(), 2)[1]?.value ?? 0);
  ordersTrend = computed(() => {
    const m = countByMonth(this.orders(), 2);
    return pctChange(m[1]?.value ?? 0, m[0]?.value ?? 0);
  });
  volumeTrend = computed(() => {
    const m = volumeByMonth(this.orders(), 2);
    return pctChange(m[1]?.value ?? 0, m[0]?.value ?? 0);
  });

  trendLabel(p: number): string { return (p >= 0 ? '↑ +' : '↓ ') + p + '%'; }

  fmtFcfa(v: number): string {
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1).replace('.', ',') + ' Md';
    if (v >= 1_000_000) return Math.round(v / 1_000_000) + ' M';
    if (v >= 1_000) return Math.round(v / 1_000) + ' k';
    return String(v);
  }
  shortDate(s: string): string { return (s || '').slice(0, 10).split('-').reverse().join('/'); }
  ordLabel(s: OrderStatus) { return ORDER_STATUS_LABELS[s]; }
  ordClass(s: OrderStatus) { return orderBadgeClass(s); }
}

/* ====================== ÉMISSIONS — CSFT §M1 ====================== */
@Component({
  selector: 'afb-bo-emissions',
  imports: [FormsModule, DecimalPipe, ConfirmDialog, ExcelImport, ModalShell, Paginator, PaginatePipe],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Gestion des émissions</h1>
          <p class="text-sm text-gray-500">Saisie · validation superviseur · publication · archivage automatique</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-outline" (click)="exportCsv()">⬇ Export CSV</button>
          <button class="btn btn-outline" (click)="importOpen.set(true)">📥 Importer Excel</button>
          <button class="btn btn-outline" (click)="openBroadcast()" title="Envoyer le catalogue des émissions ouvertes par e-mail">📧 Diffuser</button>
          @if (canPublish() && allDraftsCount() > 0) {
            <button class="btn btn-outline" (click)="publishAllDrafts()" [disabled]="publishingAll()"
                    title="Publier toutes les émissions en brouillon">
              📣 Publier tous les brouillons ({{ allDraftsCount() }})
            </button>
          }
          <button class="btn btn-primary" (click)="newEmission()">+ Nouvelle émission</button>
        </div>
      </div>

      <afb-excel-import [open]="importOpen()" (close$)="importOpen.set(false)" (imported)="onImported($event)" />

      <!-- Modal Diffusion par e-mail (CSFT §M2-S03 — information investisseurs) -->
      <afb-modal [open]="broadcastOpen()" size="lg" (cancel)="broadcastOpen.set(false)">
        <div class="p-4 sm:p-6">
          <div class="flex items-start justify-between mb-3">
            <div>
              <h2 class="text-lg sm:text-xl font-bold">Diffuser le catalogue par e-mail</h2>
              <p class="text-xs text-gray-500 mt-0.5">
                Envoie un récapitulatif des {{ openEmissionsCount() }} émission(s)
                ouverte(s) à la souscription (statut <b>Publiée</b>) — les brouillons
                ne sont jamais diffusés.
              </p>
            </div>
            <button class="btn btn-ghost text-xl shrink-0" (click)="broadcastOpen.set(false)">✕</button>
          </div>

          <div class="space-y-3">
            <label class="flex items-start gap-2 cursor-pointer p-3 rounded-lg border" [class.border-afb-red]="broadcastMode() === 'ALL'">
              <input type="radio" class="mt-1" name="bmode" value="ALL"
                     [checked]="broadcastMode() === 'ALL'" (change)="broadcastMode.set('ALL')">
              <div>
                <div class="font-semibold text-sm">Tous les clients enregistrés</div>
                <div class="text-xs text-gray-500">
                  E-mails actifs (CLIENT_PP &amp; CLIENT_PM) chargés depuis la base.
                </div>
              </div>
            </label>

            <label class="flex items-start gap-2 cursor-pointer p-3 rounded-lg border" [class.border-afb-red]="broadcastMode() === 'CUSTOM'">
              <input type="radio" class="mt-1" name="bmode" value="CUSTOM"
                     [checked]="broadcastMode() === 'CUSTOM'" (change)="broadcastMode.set('CUSTOM')">
              <div class="flex-1">
                <div class="font-semibold text-sm">Liste personnalisée</div>
                <div class="text-xs text-gray-500 mb-2">
                  Une adresse par ligne (ou séparées par virgule / point-virgule).
                </div>
                <textarea class="input font-mono text-xs" rows="5"
                          placeholder="alice&#64;example.com&#10;bob&#64;example.com"
                          [(ngModel)]="broadcastList" name="blist"
                          [disabled]="broadcastMode() !== 'CUSTOM'"></textarea>
              </div>
            </label>
          </div>

          <!-- Aperçu de l'e-mail (objet + corps texte tel qu'envoyé) -->
          @if (showPreview()) {
            <div class="mt-4 border rounded-lg overflow-hidden">
              <div class="bg-gray-50 px-3 py-2 border-b text-xs">
                <div><span class="text-gray-500">Objet :</span> <b>{{ mailSubject() }}</b></div>
                <div class="mt-0.5"><span class="text-gray-500">Cci :</span>
                  {{ previewRecipients().length }} destinataire(s)
                  @if (previewRecipients().length) { <span class="text-gray-400">· {{ previewRecipientsShort() }}</span> }
                </div>
              </div>
              <pre class="p-3 text-xs whitespace-pre-wrap max-h-72 overflow-auto bg-white font-sans">{{ mailBody() }}</pre>
            </div>
          }

          <div class="mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-2">
            <div class="text-xs text-gray-500 max-w-xs">
              Outlook s'ouvre avec les adresses en <b>Cci</b> (aucun client ne voit les autres).
              Les destinataires sont audités.
            </div>
            <div class="flex gap-2 flex-wrap">
              <button class="btn btn-outline" (click)="broadcastOpen.set(false)" [disabled]="broadcastBusy()">Annuler</button>
              <button class="btn btn-outline" (click)="togglePreview()" [disabled]="broadcastBusy() || openEmissionsCount() === 0">
                {{ broadcastBusy() ? '…' : (showPreview() ? 'Masquer l’aperçu' : '👁 Aperçu') }}
              </button>
              <button class="btn btn-primary" (click)="openInOutlook()" [disabled]="broadcastBusy() || openEmissionsCount() === 0">
                {{ broadcastBusy() ? 'Préparation…' : '📧 Ouvrir dans Outlook' }}
              </button>
            </div>
          </div>
        </div>
      </afb-modal>

      <!-- Configuration affichage marché primaire public -->
      <div class="card mb-6">
        <div class="card-header">
          <div>
            <h2 class="font-semibold">⚙️ Affichage du marché primaire (page publique)</h2>
            <p class="text-xs text-gray-500 mt-0.5">Sélectionnez les statuts et la plage de dates à afficher</p>
          </div>
          <span class="badge bg-blue-100 text-blue-700">{{ marchePreviewCount() }} émission(s) visible(s)</span>
        </div>
        <div class="card-body grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="lg:col-span-2">
            <label class="label">Statuts à afficher</label>
            <div class="flex flex-wrap gap-3 text-sm">
              @for (s of allStatuses; track s.value) {
                <label class="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" [checked]="isStatusSelected(s.value)" (change)="toggleStatus(s.value)">
                  <span>{{ s.label }}</span>
                </label>
              }
            </div>
          </div>
          <div>
            <label class="label">Date d'émission — Du</label>
            <input class="input" type="date" [ngModel]="marcheCfg().dateDu" (ngModelChange)="setDateDu($event)" name="mdu">
          </div>
          <div>
            <label class="label">Date d'émission — Au</label>
            <input class="input" type="date" [ngModel]="marcheCfg().dateAu" (ngModelChange)="setDateAu($event)" name="mau">
          </div>
          <div class="col-span-full flex flex-wrap items-center gap-2 border-t pt-3">
            <button class="btn btn-outline text-xs" (click)="resetMarcheConfig()">↺ Uniquement PUBLIE</button>
            <button class="btn btn-outline text-xs" (click)="selectAllStatuses()">Tout sélectionner</button>
            <span class="text-xs text-gray-500 ml-auto">
              Aperçu : <b>{{ marchePreviewCount() }}</b> / {{ data.emissions().length }} émission(s)
            </span>
          </div>
        </div>
      </div>

      @if (showForm()) {
        <div class="card mb-6">
          <div class="card-header">
            <h2 class="font-semibold">{{ editingId() ? 'Modifier' : 'Saisie nouvelle' }} émission (CSFT §3.1.3)</h2>
            <button class="btn btn-ghost text-xs" (click)="closeForm()">✕</button>
          </div>

          <!-- Bannière motif de rejet (CSFT §M1-F02) -->
          @if (editingId() && newE.rejectionMotif) {
            <div class="px-6 py-3 bg-red-50 border-b border-red-200 text-sm">
              <div class="flex items-start gap-2">
                <span class="text-xl">⚠️</span>
                <div class="flex-1">
                  <b class="text-red-800">Fiche rejetée par le superviseur</b>
                  <div class="text-xs text-red-700 mt-1">{{ newE.rejectedAt }} · {{ newE.rejectedBy }}</div>
                  <div class="text-sm text-red-900 mt-1"><b>Motif :</b> {{ newE.rejectionMotif }}</div>
                </div>
              </div>
            </div>
          }

          <!-- Avertissement re-validation (CSFT §M1-F05) -->
          @if (editingPublishedFiche()) {
            <div class="px-6 py-3 bg-amber-50 border-b border-amber-200 text-sm">
              <div class="flex items-start gap-2">
                <span class="text-xl">🔄</span>
                <div class="flex-1">
                  <b class="text-amber-900">Modification d'une fiche publiée</b>
                  <div class="text-xs text-amber-800 mt-1">CSFT §M1-F05 — toute modification après publication entraîne un retour en statut <b>Brouillon</b> et nécessite une nouvelle validation du superviseur.</div>
                </div>
              </div>
            </div>
          }

          <!-- Bandeau lecture seule (CSFT §M1-F04) -->
          @if (editingIsReadOnly()) {
            <div class="px-6 py-3 bg-gray-100 border-b border-gray-300 text-sm">
              <div class="flex items-start gap-2">
                <span class="text-xl">🔒</span>
                <div class="flex-1">
                  <b class="text-gray-800">Fiche en lecture seule</b>
                  <div class="text-xs text-gray-700 mt-1">CSFT §M1-F04 — l'émission est clôturée ou archivée. Aucune modification possible.</div>
                </div>
              </div>
            </div>
          }

          <fieldset [disabled]="editingIsReadOnly()" class="card-body grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 min-w-0 border-0 p-0 m-0">
            <div>
              <label class="label">Nature</label>
              <select class="select" [(ngModel)]="newE.nature" name="nature" (ngModelChange)="onNatureChange($event)">
                <option value="BTA">BTA — Bon du Trésor Assimilable</option>
                <option value="OTA">OTA — Obligation du Trésor Assimilable</option>
              </select>
            </div>
            <div>
              <label class="label">Émetteur (pays CEMAC)</label>
              <select class="select" [(ngModel)]="newE.paysCode" name="pc" (ngModelChange)="onPaysChange($event)">
                @for (p of paysList; track p.code) {
                  <option [value]="p.code">{{ p.name }}</option>
                }
              </select>
              <p class="hint">Préfixe ISIN appliqué automatiquement : <b class="font-mono">{{ isinPrefixForPays(newE.paysCode) }}</b></p>
            </div>
            <div><label class="label">Date d'échéance</label><input class="input" type="date" [(ngModel)]="newE.dateEcheance" name="dc"></div>
            <div class="sm:col-span-2 lg:col-span-3">
              <label class="label">Désignation <span class="text-afb-red">*</span></label>
              <input class="input font-mono" [(ngModel)]="newE.designation" name="des" maxlength="150"
                     placeholder="CM1300001268 BTA 52 19 MAI 2027">
              <p class="hint">L'ISIN est extrait du 1<sup>er</sup> mot — il doit comporter 12 caractères. ISIN détecté :
                <b [class.text-emerald-600]="isinValide()" [class.text-afb-red]="!isinValide()">{{ isinDetecte() || '—' }}</b></p>
            </div>
            <div>
              <label class="label">Maturité ({{ newE.nature === 'BTA' ? 'semaines' : 'années' }})</label>
              <input class="input" type="number" min="1" [(ngModel)]="newE.maturite" name="mat">
            </div>
            <div>
              <label class="label">Valeur unitaire (FCFA)</label>
              <input class="input bg-gray-100" type="number" [ngModel]="newE.valeurUnitaire" name="vu" readonly>
              <p class="hint">Valeur figée par nature : <b>OTA</b> = 10 000 · <b>BTA</b> = 1 000 000.</p>
            </div>
            <div><label class="label">Volume d'émission (millions FCFA)</label><input class="input" type="number" min="1" [(ngModel)]="newE.volumeMillions" name="vol"></div>
            <div><label class="label">Date limite de souscription</label><input class="input" type="date" [(ngModel)]="newE.dateLimite" name="dl"></div>
            <div><label class="label">Heure limite de souscription</label><input class="input" type="time" [(ngModel)]="newE.heureLimite" name="hl"></div>
            <div>
              <label class="label">Taux / Prix</label>
              <input class="input" [(ngModel)]="newE.tauxPrix" name="tp" placeholder="ADJ ou ex. 5,80">
              <p class="hint">« ADJ » = taux fixé par adjudication.</p>
            </div>
            <div class="sm:col-span-2 lg:col-span-3">
              <label class="label">Observations</label>
              <input class="input" [(ngModel)]="newE.observation" name="obs" placeholder="NOUVELLE EMISSION">
            </div>
          </fieldset>

          <!-- Boutons d'action — hors du fieldset pour rester cliquables en lecture seule -->
          <div class="px-6 pb-6 flex justify-end gap-2 border-t pt-4">
            <button type="button" class="btn btn-outline" (click)="closeForm()">{{ editingIsReadOnly() ? 'Fermer' : 'Annuler' }}</button>
            @if (!editingId()) {
              <button type="button" class="btn btn-outline" (click)="save('BROUILLON')">Enregistrer brouillon</button>
              <button type="button" class="btn btn-primary" (click)="save('PUBLIE')">Valider & Publier</button>
            } @else if (!editingIsReadOnly()) {
              <button type="button" class="btn btn-primary" (click)="saveEdit()">Enregistrer modifications</button>
            }
          </div>
        </div>
      }

      <!-- Filtres -->
      <div class="card mb-4">
        <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div class="lg:col-span-2">
            <label class="label">Recherche</label>
            <input class="input" placeholder="🔍 ISIN, code, libellé…" [ngModel]="fSearch()" (ngModelChange)="fSearch.set($event); page.set(1)" name="fes">
          </div>
          <div>
            <label class="label">Nature</label>
            <select class="select" [ngModel]="fNature()" (ngModelChange)="fNature.set($event); page.set(1)" name="fen">
              <option value="">Toutes</option>
              <option value="BTA">BTA</option>
              <option value="OTA">OTA</option>
            </select>
          </div>
          <div>
            <label class="label">Statut</label>
            <select class="select" [ngModel]="fStatus()" (ngModelChange)="fStatus.set($event); page.set(1)" name="fest">
              <option value="">Tous</option>
              @for (s of allStatuses; track s.value) {
                <option [value]="s.value">{{ s.label }}</option>
              }
            </select>
          </div>
          <div class="flex items-end gap-2">
            <select class="select flex-1" [ngModel]="fPays()" (ngModelChange)="fPays.set($event); page.set(1)" name="feem">
              <option value="">Tous pays CEMAC</option>
              @for (p of paysList; track p.code) {
                <option [value]="p.code">{{ p.code }} — {{ p.name }}</option>
              }
            </select>
            <button class="btn btn-outline whitespace-nowrap" (click)="resetFilters()">↺</button>
          </div>
        </div>
      </div>

      <!-- Barre d'actions en masse (CSFT §M1-F02 — bulk validation/rejet) -->
      @if (selectedDrafts().length > 0) {
        <div class="card mb-4 bg-afb-red-light border-afb-red/30">
          <div class="p-4 flex items-center justify-between flex-wrap gap-2">
            <div class="text-sm">
              <b>{{ selectedDrafts().length }} fiche{{ selectedDrafts().length>1?'s':'' }}</b> en BROUILLON sélectionnée{{ selectedDrafts().length>1?'s':'' }}
            </div>
            <div class="flex gap-2 flex-wrap">
              <button class="btn btn-ghost text-xs" (click)="clearSelection()">Désélectionner</button>
              <button class="btn btn-success text-xs" (click)="askBulkValidate()">✓ Valider en masse ({{ selectedDrafts().length }})</button>
              <button class="btn btn-danger text-xs" (click)="askBulkReject()">✕ Rejeter en masse</button>
            </div>
          </div>
        </div>
      }

      <div class="card overflow-hidden">
        <div class="overflow-x-auto"><table class="table min-w-[720px] sm:min-w-full">
          <thead><tr>
            <th class="w-8"><input type="checkbox" [checked]="allDraftsSelected()" (change)="toggleAllDrafts()" title="Tout sélectionner (BROUILLON)"></th>
            <th>Désignation</th><th>Nature</th><th>Émetteur</th><th>Échéance</th><th>Montant</th><th>Fenêtre</th><th>Statut</th><th>Actions</th>
          </tr></thead>
          <tbody>
            @for (e of (filtered() | paginate:page():10); track e.id) {
              <tr [class.bg-afb-red-light]="isSelected(e.id)">
                <td>
                  @if (e.status === 'BROUILLON') {
                    <input type="checkbox" [checked]="isSelected(e.id)" (change)="toggleSelect(e.id)">
                  }
                </td>
                <td><div class="font-mono text-xs font-semibold">{{ e.libelle }}</div></td>
                <td><span class="badge bg-blue-100 text-blue-700">{{ e.nature }}</span></td>
                <td>{{ e.emetteur }} ({{ e.paysCode }})</td>
                <td class="text-xs">{{ e.dateEcheance }}</td>
                <td>{{ e.montantGlobal | number:'1.0-0':'fr-FR' }}</td>
                <td class="text-[11px]">{{ e.ouvertureSouscription }}<br>→ {{ e.fermetureSouscription }}</td>
                <td><span class="badge" [class]="emClass(e.status)">{{ emLabel(e.status) }}</span></td>
                <td>
                  <div class="flex gap-2 flex-wrap">
                    @if (e.status !== 'ARCHIVE' && e.status !== 'CLOTURE') {
                      <button class="text-afb-red text-xs" (click)="edit(e.id)">Modifier</button>
                    } @else {
                      <button class="text-gray-500 text-xs" (click)="viewReadOnly(e.id)" title="Lecture seule">Consulter</button>
                    }
                    <button class="text-gray-600 text-xs" (click)="duplicate(e.id)">Dupliquer</button>
                    <button class="text-blue-600 text-xs" (click)="viewHistory(e.id)" title="Historique des modifications">Historique</button>
                    @if (e.status === 'BROUILLON') {
                      <button class="text-emerald-600 text-xs" (click)="publish(e.id)">Publier</button>
                      <button class="text-red-600 text-xs" (click)="askReject(e.id)">Rejeter</button>
                    }
                    @if (e.status === 'PUBLIE') { <button class="text-amber-600 text-xs" (click)="close(e.id)">Clôturer</button> }
                    @if (e.status === 'CLOTURE') { <button class="text-gray-600 text-xs" (click)="archive(e.id)">Archiver</button> }
                    <button class="text-red-600 text-xs" (click)="askDelete(e.id)">Supprimer</button>
                  </div>
                </td>
              </tr>
            }
            @if (!filtered().length) {
              <tr><td colspan="9" class="text-center py-12 text-gray-400 text-sm">Aucune émission ne correspond aux filtres</td></tr>
            }
          </tbody>
        </table></div>
        <afb-paginator [total]="filtered().length" [pageSize]="10" [(page)]="page" />
      </div>

      <afb-confirm-dialog [open]="confirmOpen()" title="Supprimer l'émission ?"
        message="Cette action est irréversible. Les ordres liés ne sont pas supprimés."
        confirmLabel="Supprimer" [danger]="true"
        (confirm)="doDelete()" (cancel)="confirmOpen.set(false)" />

      <!-- Modale Validation en masse -->
      <afb-confirm-dialog [open]="bulkValidateOpen()" title="Valider en masse ?"
        [message]="'Publier ' + selectedDrafts().length + ' fiche(s) sur le portail investisseur. Chaque fiche passera en statut PUBLIE.'"
        confirmLabel="Valider et publier"
        (confirm)="doBulkValidate()" (cancel)="bulkValidateOpen.set(false)" />

      <!-- Modale Rejet en masse avec motif commun -->
      <afb-modal [open]="bulkRejectOpen()" size="md" (cancel)="bulkRejectOpen.set(false)">
        <div class="p-4 sm:p-6 overflow-y-auto">
          <h2 class="text-base sm:text-lg font-bold">Rejet en masse ({{ selectedDrafts().length }} fiches)</h2>
          <p class="text-xs text-gray-500 mt-1">Un motif commun sera appliqué à toutes les fiches sélectionnées. Visible par l'agent à la ré-édition.</p>
          <div class="mt-4">
            <label class="label">Motif commun <span class="text-afb-red">*</span></label>
            <textarea class="textarea" rows="5" [(ngModel)]="bulkRejectMotif" name="bulkRejectMotif"
                      maxlength="1000"
                      placeholder="Ex : Documents manquants, taux nominal incohérent…"></textarea>
            <p class="hint">Action journalisée en audit log (résultat ECHEC pour chaque fiche).</p>
          </div>
          <div class="flex flex-col-reverse sm:flex-row gap-2 mt-5">
            <button class="btn btn-outline sm:flex-1" (click)="bulkRejectOpen.set(false)">Annuler</button>
            <button class="btn btn-danger sm:flex-1" [disabled]="!bulkRejectMotif.trim()" (click)="doBulkReject()">
              Confirmer le rejet
            </button>
          </div>
        </div>
      </afb-modal>

      <!-- Modale Rejet superviseur (CSFT §M1-F02) -->
      <afb-modal [open]="rejectOpen()" size="md" (cancel)="rejectOpen.set(false)">
        <div class="p-4 sm:p-6 overflow-y-auto">
          <h2 class="text-base sm:text-lg font-bold">Rejeter la fiche émission</h2>
          @if (rejectTarget(); as rt) {
            <p class="text-xs text-gray-500 mt-1">
              <b class="font-mono">{{ rt.code }}</b> · ISIN {{ rt.isin }} · statut <b>Brouillon</b>
            </p>
          }
          <div class="mt-4">
            <label class="label">Motif du rejet <span class="text-afb-red">*</span> (obligatoire, max 1000 caractères)</label>
            <textarea class="textarea" rows="5" [(ngModel)]="rejectMotif" name="rejectMotif"
                      maxlength="1000"
                      placeholder="Ex : Taux nominal incohérent, libellé incomplet, dates non concordantes…"></textarea>
            <p class="hint">Ce motif sera visible par l'agent à la prochaine ouverture de la fiche pour correction. Action journalisée en audit log (résultat = ECHEC).</p>
          </div>
          <div class="flex flex-col-reverse sm:flex-row gap-2 mt-5">
            <button class="btn btn-outline sm:flex-1" (click)="rejectOpen.set(false)">Annuler</button>
            <button class="btn btn-danger sm:flex-1" [disabled]="!canSubmitReject()" (click)="doReject()">
              Confirmer le rejet
            </button>
          </div>
        </div>
      </afb-modal>

      <!-- Modale Historique (CSFT §M1-F05) -->
      <afb-modal [open]="historyOpen()" size="2xl" (cancel)="historyOpen.set(false)">
        @if (historyTarget(); as ht) {
          <div class="p-4 sm:p-6 overflow-y-auto">
            <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
              <div>
                <div class="text-xs text-gray-500 uppercase">Historique des modifications</div>
                <h2 class="text-lg font-bold font-mono">{{ ht.libelle }}</h2>
                <p class="text-xs text-gray-500 mt-0.5">{{ ht.nature }} · {{ ht.emetteur }}</p>
              </div>
              <button class="btn btn-ghost text-xl" (click)="historyOpen.set(false)">✕</button>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border-t pt-3 mb-3">
              <div><div class="text-gray-500">Créée par</div><div class="font-semibold">{{ ht.createdByNom || ht.createdBy || '—' }}</div><div class="text-gray-500">{{ ht.createdAt || '—' }}</div></div>
              <div><div class="text-gray-500">Validée par</div><div class="font-semibold">{{ ht.validatedByNom || ht.validatedBy || '—' }}</div><div class="text-gray-500">{{ ht.dateValidation || '—' }}</div></div>
            </div>
            <div class="text-xs uppercase text-gray-500 font-semibold mb-2">Audit log (immuable)</div>
            @if (historyEntries().length) {
              <div class="space-y-2 text-xs max-h-72 overflow-auto border rounded p-2">
                @for (h of historyEntries(); track h.id) {
                  <div class="flex gap-2 border-l-2 pl-3"
                       [class.border-emerald-400]="h.resultat==='SUCCES'"
                       [class.border-red-400]="h.resultat==='ECHEC'">
                    <span class="font-mono text-gray-500 shrink-0">{{ h.horodatage }}</span>
                    <span class="font-semibold">{{ h.action }}</span>
                    <span class="text-gray-500">par {{ h.utilisateurNom || h.utilisateur }}</span>
                    <span class="font-mono text-gray-400 shrink-0">{{ h.ip }}</span>
                  </div>
                }
              </div>
            } @else {
              <div class="text-xs text-gray-400 italic">Aucun événement</div>
            }
          </div>
        }
      </afb-modal>
    </div>
  `
})
export class BoEmissions {
  data = inject(MockData);
  toast = inject(ToastService);
  private readonly api = inject(ApiService);
  constructor() { this.data.refreshEmissions(); }
  showForm = signal(false);
  editingId = signal<string | null>(null);
  /** Snapshot du statut au moment de l'ouverture de la fiche en édition (sert au M1-F04 / M1-F05). */
  editingOriginalStatus = signal<EmissionStatus | null>(null);
  editingPublishedFiche = computed(() => this.editingOriginalStatus() === 'PUBLIE');
  editingIsReadOnly = computed(() => {
    const s = this.editingOriginalStatus();
    return s === 'CLOTURE' || s === 'ARCHIVE';
  });
  confirmOpen = signal(false);
  importOpen = signal(false);
  page = signal(1);
  pendingDeleteId: string | null = null;

  // ── Diffusion par e-mail du catalogue PUBLIE (via Outlook) ───
  broadcastOpen = signal(false);
  broadcastBusy = signal(false);
  showPreview = signal(false);
  /** 'ALL' = tous les clients enregistrés · 'CUSTOM' = liste admin. */
  broadcastMode = signal<'ALL' | 'CUSTOM'>('ALL');
  broadcastList = '';
  /** Destinataires résolus (affichés dans l'aperçu / mis en Cci). */
  previewRecipients = signal<string[]>([]);

  openEmissionsList = computed(() => this.data.emissions().filter(e => e.status === 'PUBLIE'));
  openEmissionsCount = computed(() => this.openEmissionsList().length);

  /** Publication groupée — réservée aux profils habilités (superviseur / admin). */
  canPublish = computed(() => this.data.hasPermission('EMISSION_VALIDATE'));
  allDraftsCount = computed(() => this.data.emissions().filter(e => e.status === 'BROUILLON').length);
  publishingAll = signal(false);

  /** Publie en une fois toutes les fiches en brouillon (bouton superviseur / admin). */
  publishAllDrafts(): void {
    if (this.publishingAll()) return;
    this.publishingAll.set(true);
    this.data.publishAllEmissions().subscribe((n) => {
      this.publishingAll.set(false);
      if (n > 0) this.toast.success('Publication groupée', `${n} émission(s) publiée(s).`);
      else this.toast.error('Aucune publication', 'Aucune fiche en brouillon à publier.');
    });
  }

  /** Objet de l'e-mail. */
  mailSubject = computed(() => {
    const n = this.openEmissionsCount();
    return `Marché primaire CEMAC — ${n} émission(s) ouverte(s) à la souscription`;
  });

  /** Corps texte de l'e-mail (tel qu'inséré dans Outlook). */
  mailBody = computed(() => {
    const lines: string[] = [];
    lines.push('Marché primaire CEMAC — émissions ouvertes à la souscription');
    lines.push('');
    lines.push('Bonjour,');
    lines.push('');
    lines.push('Veuillez trouver ci-dessous les émissions actuellement ouvertes :');
    lines.push('');
    this.openEmissionsList().forEach((e, i) => {
      lines.push(`${i + 1}) ${e.libelle}`);
      lines.push(`   Nature : ${e.nature} · Émetteur : ${e.emetteur} (${e.paysCode}) · ISIN : ${e.isin}`);
      lines.push(`   Émission : ${e.dateEmission} · Échéance : ${e.dateEcheance} · Clôture souscription : ${e.fermetureSouscription}`);
      lines.push(`   Montant global : ${this.fmt(e.montantGlobal)} FCFA · Minimum : ${this.fmt(e.montantMinimum)} FCFA · Taux : ${e.tauxNominal} %`);
      lines.push('');
    });
    lines.push('Connectez-vous à votre espace investisseur pour souscrire.');
    lines.push('');
    lines.push('Afriland First Bank — Direction Finances et Trésorerie');
    return lines.join('\n');
  });

  previewRecipientsShort = computed(() => {
    const r = this.previewRecipients();
    return r.slice(0, 3).join(', ') + (r.length > 3 ? `, +${r.length - 3}` : '');
  });

  private fmt(v: number): string {
    return (v ?? 0).toLocaleString('fr-FR');
  }

  openBroadcast(): void {
    if (this.openEmissionsCount() === 0) {
      this.toast.error('Aucune émission ouverte',
        "Publiez au moins une émission avant de diffuser le catalogue.");
      return;
    }
    this.broadcastMode.set('ALL');
    this.broadcastList = '';
    this.showPreview.set(false);
    this.previewRecipients.set([]);
    this.broadcastOpen.set(true);
  }

  /** Résout la liste de destinataires selon le mode, puis exécute `then`. */
  private resolveRecipients(then: (recipients: string[]) => void): void {
    if (this.broadcastMode() === 'CUSTOM') {
      const list = this.parseEmailList(this.broadcastList);
      if (list.length === 0) {
        this.toast.error('Liste vide', "Renseignez au moins une adresse e-mail valide.");
        return;
      }
      then(list);
      return;
    }
    // Mode ALL : récupère les e-mails des clients enregistrés côté backend.
    this.broadcastBusy.set(true);
    this.api.broadcastRecipients().subscribe({
      next: (emails) => {
        this.broadcastBusy.set(false);
        if (!emails.length) {
          this.toast.error('Aucun client', "Aucun client enregistré actif à notifier.");
          return;
        }
        then(emails);
      },
      error: (err) => {
        this.broadcastBusy.set(false);
        this.toast.error('Erreur', 'Chargement des destinataires impossible.');
      },
    });
  }

  togglePreview(): void {
    if (this.showPreview()) { this.showPreview.set(false); return; }
    this.resolveRecipients((recipients) => {
      this.previewRecipients.set(recipients);
      this.showPreview.set(true);
    });
  }

  /** Ouvre Outlook (client mail par défaut) avec un brouillon prérempli. */
  openInOutlook(): void {
    this.resolveRecipients((recipients) => {
      this.previewRecipients.set(recipients);
      const bcc = recipients.join(';');
      const url = `mailto:?bcc=${encodeURIComponent(bcc)}`
        + `&subject=${encodeURIComponent(this.mailSubject())}`
        + `&body=${encodeURIComponent(this.mailBody())}`;
      // Ouvre le client mail par défaut (Outlook) avec la fenêtre de composition.
      window.location.href = url;
      this.toast.success('Outlook',
        `Brouillon ouvert avec ${recipients.length} destinataire(s) en Cci. Vérifiez puis envoyez.`);
    });
  }

  private parseEmailList(raw: string): string[] {
    return (raw || '')
      .split(/[\s,;]+/)
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length >= 5 && s.includes('@') && !s.startsWith('@') && !s.endsWith('@'))
      .filter((v, i, arr) => arr.indexOf(v) === i);
  }

  // ── M1-F02 — Sélection multiple + Bulk validate/reject ─────
  selected = signal<string[]>([]);
  isSelected(id: string) { return this.selected().includes(id); }
  toggleSelect(id: string) {
    this.selected.update(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  clearSelection() { this.selected.set([]); }
  /** Ne retient dans la sélection que les fiches en BROUILLON (les autres ne sont pas éligibles). */
  selectedDrafts = computed(() =>
    this.selected().filter(id => this.data.getEmission(id)?.status === 'BROUILLON')
  );
  draftsFiltered = computed(() => this.filtered().filter(e => e.status === 'BROUILLON'));
  allDraftsSelected = computed(() => {
    const d = this.draftsFiltered();
    return d.length > 0 && d.every(e => this.selected().includes(e.id));
  });
  toggleAllDrafts() {
    if (this.allDraftsSelected()) this.selected.set([]);
    else this.selected.set(this.draftsFiltered().map(e => e.id));
  }

  bulkValidateOpen = signal(false);
  bulkRejectOpen = signal(false);
  bulkRejectMotif = '';
  askBulkValidate() {
    if (this.selectedDrafts().length === 0) return;
    this.bulkValidateOpen.set(true);
  }
  doBulkValidate() {
    const ids = this.selectedDrafts();
    const res = this.data.bulkValidateAndPublishEmissions(ids);
    this.toast.success('Validation en masse', `${res.ok} fiche(s) publiée(s)${res.ko ? ' · ' + res.ko + ' échec(s)' : ''}`);
    this.bulkValidateOpen.set(false);
    this.clearSelection();
  }
  askBulkReject() {
    if (this.selectedDrafts().length === 0) return;
    this.bulkRejectMotif = '';
    this.bulkRejectOpen.set(true);
  }
  doBulkReject() {
    const motif = this.bulkRejectMotif.trim();
    if (!motif) return;
    const ids = this.selectedDrafts();
    const res = this.data.bulkRejectEmissions(ids, motif);
    this.toast.info('Rejet en masse', `${res.ok} fiche(s) rejetée(s)${res.ko ? ' · ' + res.ko + ' échec(s)' : ''}`);
    this.bulkRejectOpen.set(false);
    this.clearSelection();
  }

  // ── M1-F02 — Rejet superviseur individuel ──────────────────
  rejectOpen = signal(false);
  rejectTarget = signal<Emission | undefined>(undefined);
  rejectMotif = '';
  canSubmitReject() { return this.rejectMotif.trim().length > 0; }
  askReject(id: string) {
    const e = this.data.getEmission(id);
    if (!e) return;
    this.rejectTarget.set(e);
    this.rejectMotif = '';
    this.rejectOpen.set(true);
  }
  doReject() {
    const e = this.rejectTarget();
    if (!e) return;
    const ok = this.data.rejectEmissionValidation(e.id, this.rejectMotif);
    if (ok) {
      this.toast.info('Fiche rejetée', `${e.code} — motif transmis à l'agent`);
      this.rejectOpen.set(false);
    } else {
      this.toast.error('Rejet impossible', 'Motif requis ou statut incompatible.');
    }
  }

  // ── M1-F05 — Historique des modifications ──────────────────
  historyOpen = signal(false);
  historyTarget = signal<Emission | undefined>(undefined);
  historyEntries = computed(() => {
    const h = this.historyTarget();
    return h ? this.data.getEmissionHistory(h.code) : [];
  });
  viewHistory(id: string) {
    const e = this.data.getEmission(id);
    if (!e) return;
    this.historyTarget.set(e);
    this.historyOpen.set(true);
  }
  viewReadOnly(id: string) {
    // Ouverture du form en lecture seule (statut CLOTURE / ARCHIVE)
    const e = this.data.getEmission(id);
    if (!e) return;
    this.newE = this.emissionToForm(e);
    this.editingId.set(id);
    this.editingOriginalStatus.set(e.status);
    this.showForm.set(true);
    this.toast.info('Lecture seule', 'Fiche clôturée/archivée — modification désactivée (CSFT §M1-F04).');
  }

  allStatuses: { value: EmissionStatus; label: string }[] = [
    { value: 'BROUILLON', label: 'Brouillon' },
    { value: 'PUBLIE', label: 'Publié' },
    { value: 'CLOTURE', label: 'Clôturé' },
    { value: 'ARCHIVE', label: 'Archivé' },
  ];
  paysList = (Object.keys(PAYS_CEMAC) as PaysCEMAC[]).map(code => ({ code, name: PAYS_CEMAC[code] }));

  /** Préfixe ISIN (2 lettres ISO-3166-1 alpha-2) par pays CEMAC. */
  readonly PAYS_ISIN_PREFIX: Record<PaysCEMAC, string> = {
    CMR: 'CM', GAB: 'GA', CGO: 'CG', TCD: 'TD', RCA: 'CF', GNQ: 'GQ',
  };
  /** Valeur nominale unitaire imposée par la nature du titre (FCFA). */
  readonly VALEUR_UNITAIRE: Record<'BTA' | 'OTA', number> = {
    BTA: 1_000_000,
    OTA: 10_000,
  };
  isinPrefixForPays(code: PaysCEMAC | string): string {
    return this.PAYS_ISIN_PREFIX[code as PaysCEMAC] ?? '';
  }
  /** Remplace les 2 premiers caractères du 1er mot de la désignation par le préfixe pays. */
  private applyPaysPrefixToDesignation(prefix: string) {
    const des = String(this.newE.designation || '');
    const parts = des.split(/(\s+)/); // conserve les espaces
    if (parts.length && parts[0]) {
      const first = parts[0];
      const rest = first.length >= 2 ? first.slice(2) : '';
      parts[0] = (prefix + rest).slice(0, 12);
    } else {
      parts[0] = prefix;
    }
    this.newE.designation = parts.join('');
  }
  onPaysChange(code: PaysCEMAC) {
    this.newE.paysCode = code;
    const prefix = this.isinPrefixForPays(code);
    if (prefix) this.applyPaysPrefixToDesignation(prefix);
  }
  onNatureChange(nature: 'BTA' | 'OTA') {
    this.newE.nature = nature;
    this.newE.valeurUnitaire = this.VALEUR_UNITAIRE[nature];
    this.applyNatureToDesignation(nature);
  }
  /** Met à jour le jeton de nature (BTA/OTA) dans le code/désignation,
   *  ex. « CM1300001268 BTA 52 … » → « CM1300001268 OTA 52 … ». */
  private applyNatureToDesignation(nature: 'BTA' | 'OTA') {
    const des = String(this.newE.designation || '');
    if (!des) return;
    if (/\b(BTA|OTA)\b/.test(des)) {
      this.newE.designation = des.replace(/\b(BTA|OTA)\b/, nature);
    }
  }

  marcheCfg = this.data.marcheConfig;
  marchePreviewCount = computed(() => this.data.marcheEmissions().length);
  isStatusSelected(s: EmissionStatus) { return this.marcheCfg().statuses.includes(s); }
  toggleStatus(s: EmissionStatus) {
    const cur = this.marcheCfg().statuses;
    const next = cur.includes(s) ? cur.filter(x => x !== s) : [...cur, s];
    this.data.updateMarcheConfig({ statuses: next });
  }
  selectAllStatuses() {
    this.data.updateMarcheConfig({ statuses: this.allStatuses.map(s => s.value) });
  }
  setDateDu(v: string) { this.data.updateMarcheConfig({ dateDu: v }); }
  setDateAu(v: string) { this.data.updateMarcheConfig({ dateAu: v }); }
  resetMarcheConfig() {
    this.data.updateMarcheConfig({ statuses: ['PUBLIE'], dateDu: '', dateAu: '' });
    this.toast.info('Configuration réinitialisée', 'Affichage public : émissions PUBLIE uniquement');
  }

  fSearch = signal('');
  fNature = signal('');
  fStatus = signal('');
  fPays = signal('');
  filtered = computed(() => {
    const q = this.fSearch().trim().toLowerCase();
    return this.data.emissions().filter(e =>
      (!q || e.code.toLowerCase().includes(q) || e.isin.toLowerCase().includes(q) || (e.libelle ?? '').toLowerCase().includes(q)) &&
      (!this.fNature() || e.nature === this.fNature()) &&
      (!this.fStatus() || e.status === this.fStatus()) &&
      (!this.fPays() || e.paysCode === this.fPays())
    );
  });
  resetFilters() { this.fSearch.set(''); this.fNature.set(''); this.fStatus.set(''); this.fPays.set(''); }
  onImported(list: Array<Partial<Emission> & { status: EmissionStatus }>) {
    // Chaque fiche importée est persistée côté backend (système de référence).
    for (const e of list) {
      this.data.createEmission(e, e.status === 'PUBLIE').subscribe();
    }
    this.toast.success(`${list.length} émission(s) importée(s)`, 'Enregistrées côté serveur.');
  }

  newE: any = this.blank();
  /** Modèle du formulaire — uniquement les 11 champs du tableau marché primaire.
   *  Les dates par défaut sont calculées dynamiquement dans le FUTUR : une date
   *  limite de souscription figée dans le passé rendrait l'émission « expirée »
   *  dès sa publication (clôturée automatiquement). */
  blank() {
    const isoInDays = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    };
    return {
      nature: 'BTA',
      paysCode: 'CMR' as PaysCEMAC,
      designation: 'CM1300001268 BTA 52 SEM',
      // Échéance ~52 semaines après la clôture de souscription.
      dateEcheance: isoInDays(7 + 52 * 7),
      maturite: 52,
      valeurUnitaire: this.VALEUR_UNITAIRE?.BTA ?? 1_000_000,
      volumeMillions: 20_000,
      // Clôture de souscription dans 7 jours (toujours dans le futur).
      dateLimite: isoInDays(7),
      heureLimite: '09:00',
      tauxPrix: 'ADJ',
      observation: 'NOUVELLE EMISSION',
    };
  }

  /** ISIN extrait du 1er mot de la désignation (12 caractères attendus). */
  isinDetecte(): string {
    return ((this.newE.designation || '').trim().split(/\s+/)[0] || '').toUpperCase().slice(0, 12);
  }
  isinValide(): boolean {
    return this.isinDetecte().length === 12;
  }

  /** Reconstruit l'objet Émission complet à partir des 11 champs visibles :
   *  ISIN dérivé de la désignation, dates dérivées de la maturité, montant
   *  minimum = valeur unitaire, statut/traçabilité gérés par le workflow. */
  buildEmissionPayload(): Partial<Emission> | null {
    const f = this.newE;
    const designation = (f.designation || '').trim();
    const isin = ((designation.split(/\s+/)[0]) || '').toUpperCase().slice(0, 12);
    if (isin.length !== 12) {
      this.toast.error('Désignation invalide',
        "Le 1er mot de la désignation doit être un ISIN de 12 caractères.");
      return null;
    }
    if (!f.dateEcheance || !f.dateLimite) {
      this.toast.error('Dates requises',
        "Renseignez la date d'échéance et la date limite de souscription.");
      return null;
    }
    const maturite = Math.max(1, Number(f.maturite) || 1);
    const dureeJours = f.nature === 'BTA' ? Math.round(maturite * 7) : Math.round(maturite * 365);
    const echeance = new Date(f.dateEcheance + 'T00:00:00');
    const emission = new Date(echeance);
    emission.setDate(emission.getDate() - dureeJours);
    const dateEmission = emission.toISOString().slice(0, 10);
    const ouv = new Date(f.dateLimite + 'T00:00:00');
    ouv.setDate(ouv.getDate() - 7);
    const ouverture = `${ouv.toISOString().slice(0, 10)}T08:00`;
    const fermeture = `${f.dateLimite}T${f.heureLimite || '09:00'}`;
    const tauxStr = String(f.tauxPrix ?? '').trim();
    const taux = /adj/i.test(tauxStr) ? 0 : (Number.parseFloat(tauxStr.replace(',', '.')) || 0);
    const valeurUnitaire = Math.max(1, Number(f.valeurUnitaire) || 1);
    return {
      // Le code de l'émission EST sa désignation (et non l'ISIN).
      code: designation,
      isin,
      libelle: designation,
      nature: f.nature,
      paysCode: f.paysCode,
      emetteur: PAYS_CEMAC[f.paysCode as PaysCEMAC],
      dateEmission,
      ouvertureSouscription: ouverture,
      fermetureSouscription: fermeture,
      dateEcheance: f.dateEcheance,
      dateReglement: dateEmission,
      dureeJours,
      valeurNominaleUnitaire: valeurUnitaire,
      montantGlobal: Math.max(1, Number(f.volumeMillions) || 1) * 1_000_000,
      tauxNominal: taux,
      montantMinimum: valeurUnitaire,
      frequenceCoupon: f.nature === 'OTA' ? 'ANNUEL' : undefined,
      modeAdjudication: f.nature === 'OTA' ? 'PRIX' : 'TAUX',
      observation: (f.observation || '').trim() || undefined,
    };
  }

  /** Reconstruit le modèle du formulaire (11 champs) depuis une émission existante. */
  emissionToForm(e: Emission): any {
    const ferm = e.fermetureSouscription || '';
    const sep = ferm.indexOf(' ') >= 0 ? ferm.indexOf(' ') : ferm.indexOf('T');
    return {
      nature: e.nature,
      paysCode: e.paysCode,
      designation: e.libelle,
      dateEcheance: (e.dateEcheance || '').slice(0, 10),
      maturite: e.nature === 'BTA'
        ? Math.round((e.dureeJours || 0) / 7)
        : Math.round((e.dureeJours || 0) / 365),
      valeurUnitaire: e.valeurNominaleUnitaire,
      volumeMillions: Math.round((e.montantGlobal || 0) / 1_000_000),
      dateLimite: ferm.slice(0, 10),
      heureLimite: sep >= 0 ? ferm.slice(sep + 1, sep + 6) : '09:00',
      tauxPrix: e.tauxNominal ? String(e.tauxNominal).replace('.', ',') : 'ADJ',
      observation: e.observation ?? '',
      rejectionMotif: e.rejectionMotif,
      rejectedAt: e.rejectedAt,
      rejectedBy: e.rejectedBy,
    };
  }

  newEmission() {
    this.newE = this.blank();
    this.editingId.set(null);
    this.editingOriginalStatus.set(null);
    this.showForm.set(true);
  }
  edit(id: string) {
    const e = this.data.getEmission(id);
    if (!e) return;
    // CSFT §M1-F04 — lecture seule pour CLOTURE / ARCHIVE
    if (e.status === 'CLOTURE' || e.status === 'ARCHIVE') {
      this.viewReadOnly(id);
      return;
    }
    this.newE = this.emissionToForm(e);
    this.editingId.set(id);
    this.editingOriginalStatus.set(e.status);
    this.showForm.set(true);
  }
  closeForm() {
    this.showForm.set(false);
    this.editingId.set(null);
    this.editingOriginalStatus.set(null);
  }
  save(status: 'BROUILLON' | 'PUBLIE') {
    const payload = this.buildEmissionPayload();
    if (!payload) return;
    const code = payload.code;
    this.data.createEmission(payload, status === 'PUBLIE').subscribe(em => {
      if (!em) {
        this.toast.error('Création refusée',
          `${code} — fiche rejetée par le serveur (ISIN en doublon ou champ invalide ?).`);
        return;
      }
      if (status === 'PUBLIE' && em.status !== 'PUBLIE') {
        this.toast.info('Brouillon enregistré',
          `${em.code} créé. La publication est réservée au superviseur / administrateur.`);
      } else {
        this.toast.success(em.status === 'PUBLIE' ? 'Émission publiée' : 'Brouillon enregistré', em.code);
      }
    });
    this.closeForm();
  }
  saveEdit() {
    const id = this.editingId();
    if (!id) return;
    const original = this.editingOriginalStatus();
    // CSFT §M1-F04 — interdiction d'éditer CLOTURE/ARCHIVE
    if (original === 'CLOTURE' || original === 'ARCHIVE') {
      this.toast.error('Modification refusée', 'Fiche en lecture seule (clôturée/archivée).');
      this.closeForm();
      return;
    }
    const payload = this.buildEmissionPayload();
    if (!payload) return;
    // CSFT §M1-F05 — toute modification d'une fiche PUBLIE la renvoie en BROUILLON
    // (appliqué côté serveur). La modification est persistée en base.
    const wasReverted = original === 'PUBLIE';
    this.data.editEmission(id, payload).subscribe(em => {
      if (!em) {
        this.toast.error('Modification refusée',
          `${payload.code} — rejetée par le serveur (ISIN en doublon ou champ invalide ?).`);
        return;
      }
      if (wasReverted) {
        this.toast.info('Modification enregistrée — re-validation requise',
          `${em.code} repasse en BROUILLON (CSFT §M1-F05).`);
      } else {
        this.toast.success('Émission modifiée', em.code);
      }
    });
    this.closeForm();
  }
  publish(id: string) { this.data.validateAndPublishEmission(id); this.toast.success('Émission publiée'); }
  close(id: string) {
    if (this.data.closeEmission(id)) this.toast.info('Émission clôturée');
    else this.toast.error('Clôture impossible', 'Seule une émission publiée peut être clôturée.');
  }
  archive(id: string) { this.data.archiveEmission(id); this.toast.info('Émission archivée'); }
  duplicate(id: string) {
    const e = this.data.getEmission(id);
    if (!e) return;
    // Ouvre le formulaire de création pré-rempli — l'utilisateur saisit une
    // nouvelle désignation (donc un ISIN distinct) puis enregistre.
    this.newE = this.emissionToForm(e);
    this.newE.designation = '';
    this.editingId.set(null);
    this.editingOriginalStatus.set(null);
    this.showForm.set(true);
    this.toast.info('Duplication', 'Saisissez une nouvelle désignation (ISIN distinct), puis enregistrez.');
  }
  askDelete(id: string) { this.pendingDeleteId = id; this.confirmOpen.set(true); }
  doDelete() {
    if (this.pendingDeleteId) {
      this.data.deleteEmission(this.pendingDeleteId);
      this.toast.info('Émission supprimée');
    }
    this.confirmOpen.set(false);
    this.pendingDeleteId = null;
  }
  exportCsv() {
    const csv = arrayToCsv(this.data.emissions().map(e => ({
      isin: e.isin, code: e.code, libelle: e.libelle, nature: e.nature, pays: e.paysCode, emetteur: e.emetteur,
      montant: e.montantGlobal, taux: e.tauxNominal, mode: e.modeAdjudication,
      echeance: e.dateEcheance, statut: e.status
    })));
    downloadBlob('emissions.csv', csv, 'text/csv');
    this.toast.success('Export CSV', `${this.data.emissions().length} émissions exportées.`);
  }
  emLabel(s: EmissionStatus) { return EMISSION_STATUS_LABELS[s]; }
  emClass(s: EmissionStatus) { return emissionBadgeClass(s); }
}

/* ====================== ORDRES — CSFT §M3 ====================== */
@Component({
  selector: 'afb-bo-orders',
  imports: [FormsModule, DecimalPipe, TwoSignDialog, ConfirmDialog, ModalShell, SignatureViewer, Paginator, PaginatePipe, OrderFaceCompare, OrderJointSignatures],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Traitement interne des ordres</h1>
          <p class="text-sm text-gray-500">Vérification provision (Core Banking) · transmission marché · saisie résultats</p>
        </div>
        <div class="flex gap-2">
          @if (filterEmission()) {
            <button class="btn btn-primary" (click)="adjudicationOpen.set(true)">⚖ Lancer l'adjudication</button>
          }
          <button class="btn btn-outline" (click)="exportCsv()">⬇ Export CSV</button>
        </div>
      </div>

      <!-- Filtres -->
      <div class="card mb-4">
        <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div class="lg:col-span-2">
            <label class="label">Recherche</label>
            <input class="input" placeholder="🔍 Référence, client, ISIN..." [ngModel]="filterSearch()" (ngModelChange)="filterSearch.set($event); page.set(1)" name="fs">
          </div>
          <div>
            <label class="label">Statut</label>
            <select class="select" [ngModel]="filterStatus()" (ngModelChange)="filterStatus.set($event); page.set(1)" name="fst">
              <option value="">Tous</option>
              @for (s of statusList; track s) {
                <option [value]="s">{{ label(s) }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Émission</label>
            <select class="select" [ngModel]="filterEmission()" (ngModelChange)="filterEmission.set($event); page.set(1)" name="fem">
              <option value="">Toutes</option>
              @for (e of data.emissions(); track e.id) {
                <option [value]="e.id">{{ e.code }}</option>
              }
            </select>
          </div>
          <div>
            <label class="label">Canal</label>
            <select class="select" [ngModel]="filterCanal()" (ngModelChange)="filterCanal.set($event); page.set(1)" name="fca">
              <option value="">Tous</option>
              <option value="EN_LIGNE">En ligne</option>
              <option value="GUICHET">Guichet</option>
              <option value="EMAIL">Email</option>
            </select>
          </div>
          <div class="flex items-end">
            <button class="btn btn-outline w-full" (click)="resetFilters()">Réinitialiser</button>
          </div>
        </div>
      </div>

      <!-- KPIs -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mb-4">
        <div class="kpi"><span class="kpi-label">Total filtré</span><span class="kpi-value">{{ filtered().length }}</span></div>
        <div class="kpi"><span class="kpi-label">Soumis</span><span class="kpi-value">{{ countByStatus('SOUMIS') }}</span></div>
        <div class="kpi"><span class="kpi-label">En vérif.</span><span class="kpi-value">{{ countByStatus('EN_VERIFICATION') }}</span></div>
        <div class="kpi"><span class="kpi-label">Attente adj.</span><span class="kpi-value">{{ countByStatus('EN_ATTENTE_ADJUDICATION') }}</span></div>
        <div class="kpi"><span class="kpi-label">Tot. retenu</span><span class="kpi-value">{{ countByStatus('TOTALEMENT_RETENU') }}</span></div>
        <div class="kpi"><span class="kpi-label">Non retenu</span><span class="kpi-value">{{ countByStatus('NON_RETENU') }}</span></div>
      </div>

      <!-- Actions en masse (CSFT §M3 — workflow superviseur/agent) -->
      @if (selected().length > 0) {
        <div class="card mb-4 bg-afb-red-light border-afb-red/30">
          <div class="p-4 flex items-center justify-between flex-wrap gap-2">
            <div class="text-sm">
              <b>{{ selected().length }} ordre{{ selected().length>1?'s':'' }} sélectionné{{ selected().length>1?'s':'' }}</b>
              <span class="text-gray-600 ml-2">· Total : {{ selectedTotal() | number:'1.0-0':'fr-FR' }} FCFA</span>
            </div>
            <div class="flex gap-2 flex-wrap">
              <button class="btn btn-ghost text-xs" (click)="clearSelection()">Désélectionner</button>
              <button class="btn btn-success text-xs" [disabled]="!canBulkValidate()" (click)="askBulkValidate()">✓ Valider en masse ({{ countSelectedValidatable() }})</button>
              <button class="btn btn-danger text-xs" [disabled]="!canBulkReject()" (click)="askBulkReject()">✕ Rejeter avec motif</button>
              <button class="btn btn-outline text-xs" [disabled]="!canBulkVerify()" (click)="bulkVerify()">🔍 Vérifier provision</button>
              <button class="btn btn-primary text-xs" [disabled]="!canBulkTransmit()" (click)="bulkTransmit()">→ Transmettre</button>
            </div>
          </div>
        </div>
      }

      <!-- Tableau -->
      <div class="card overflow-hidden">
        <div class="overflow-x-auto"><table class="table min-w-[720px] sm:min-w-full">
          <thead>
            <tr>
              <th class="w-8"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll()"></th>
              <th>Référence</th>
              <th>Client</th>
              <th>ISIN · Émission</th>
              <th>Volume</th>
              <th>Montant</th>
              <th>Taux</th>
              <th>Canal</th>
              <th>Date</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (o of (filtered() | paginate:page():25); track o.id) {
              <tr [class.bg-afb-red-light]="isSelected(o.id)">
                <td><input type="checkbox" [checked]="isSelected(o.id)" (change)="toggleSelect(o.id)"></td>
                <td class="font-mono text-xs">{{ o.reference }}</td>
                <td><div class="font-semibold text-sm">{{ o.clientNom }}</div><div class="text-xs text-gray-500">{{ o.clientId }}</div></td>
                <td>
                  <div class="font-mono text-xs">{{ o.isin }}</div>
                  <div class="text-xs text-gray-500">{{ o.emissionCode }}</div>
                </td>
                <td>{{ o.volume }}</td>
                <td>{{ o.montant | number:'1.0-0':'fr-FR' }}</td>
                <td>{{ o.tauxSoumis }} %</td>
                <td><span class="badge bg-gray-100 text-gray-700">{{ o.canal }}</span></td>
                <td class="text-[11px] text-gray-500">{{ o.dateSoumission }}</td>
                <td><span class="badge" [class]="badgeClass(o.status)">{{ label(o.status) }}</span></td>
                <td>
                  <button class="btn btn-outline text-xs py-1 px-2 whitespace-nowrap"
                          (click)="toggleRowMenu(o.id, $event)"
                          [attr.aria-expanded]="rowMenuId() === o.id"
                          [class.!border-afb-red]="rowMenuId() === o.id">
                    ⚙ Actions {{ rowMenuId() === o.id ? '▴' : '▾' }}
                  </button>
                </td>
              </tr>
            }
            @if (!filtered().length) {
              <tr><td colspan="11" class="text-center py-12 text-gray-400 text-sm">Aucun ordre ne correspond aux filtres</td></tr>
            }
          </tbody>
        </table></div>
        <afb-paginator [total]="filtered().length" [pageSize]="25" [(page)]="page" />
      </div>

      <!-- Menu d'actions contextuel par ligne (CSFT §M3 — ergonomie liste) -->
      @if (rowMenuOrder(); as o) {
        <div class="fixed inset-0 z-[59]" (click)="rowMenuId.set(null)"></div>
        <div class="fixed z-[60] w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-1 flex flex-col"
             [style.top.px]="rowMenuPos().y" [style.left.px]="rowMenuPos().x">
          <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
            {{ o.reference }}
          </div>
          <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                  (click)="rowMenuId.set(null); openDetail(o.id)">🔎 Voir le détail</button>
          @if (o.status === 'SOUMIS' || o.status === 'EN_VERIFICATION') {
            <button class="text-left px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    (click)="rowMenuId.set(null); askValidate(o.id)">✓ Valider l'ordre</button>
            <button class="text-left px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                    (click)="rowMenuId.set(null); askReject(o.id)">✕ Rejeter l'ordre</button>
          }
          @if (o.status === 'SOUMIS') {
            <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                    (click)="rowMenuId.set(null); verifyProvision(o.id)">🔍 Vérifier les fonds</button>
          }
          <div class="border-t my-1"></div>
          @if (canChangeStatus(o)) {
            <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                    (click)="rowMenuId.set(null); openChangeStatus(o.id)">🔄 Changer le statut</button>
          } @else {
            <div class="px-3 py-2 text-[11px] text-gray-400 italic">🔒 Ordre clôturé — statut verrouillé</div>
          }
        </div>
      }

      <!-- Détail — calqué sur la vue client (stepper + timeline + grille) -->
      <afb-modal [open]="detailOpen()" size="2xl" (cancel)="detailOpen.set(false)">
        @if (detailOrder(); as o) {
          <div class="p-4 sm:p-6 overflow-y-auto">
            <div class="flex items-start justify-between mb-4 gap-3 flex-wrap">
              <div class="min-w-0">
                <div class="text-xs text-gray-500 uppercase">Ordre {{ o.reference }}</div>
                <h2 class="text-lg sm:text-xl font-bold font-mono break-all">{{ o.reference }}</h2>
                <p class="text-xs sm:text-sm text-gray-500 mt-0.5">{{ o.emissionCode }} · ISIN {{ o.isin }} · {{ o.emetteur }} · {{ o.dateSoumission }}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="badge" [class]="badgeClass(o.status)">{{ label(o.status) }}</span>
                <button class="btn btn-ghost text-xl" (click)="detailOpen.set(false)">✕</button>
              </div>
            </div>

            <!-- Stepper workflow (identique au client) -->
            <div class="flex items-center justify-between mb-2">
              @for (s of steps; track s; let i = $index) {
                <div class="flex-1 flex items-center">
                  <div class="w-8 h-8 rounded-full grid place-items-center text-xs font-bold"
                       [class.bg-emerald-600]="reached(o, s)" [class.text-white]="reached(o, s)"
                       [class.bg-gray-200]="!reached(o, s)" [class.text-gray-500]="!reached(o, s)">{{ i + 1 }}</div>
                  @if (i < steps.length - 1) { <div class="flex-1 h-1" [class.bg-emerald-600]="reached(o, s)" [class.bg-gray-200]="!reached(o, s)"></div> }
                </div>
              }
            </div>
            <div class="flex justify-between text-xs text-gray-500 mb-6">
              <span>Soumis</span><span>Vérification</span><span>Attente adjud.</span><span>Résultat</span>
            </div>

            @if (canValidateResult() && o.resultatPropose && !o.resultatValideAt) {
              <div class="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
                <div class="font-semibold text-amber-800">Adjudication à valider</div>
                <p class="text-sm text-amber-700 mt-1">
                  L'agent a saisi le résultat « {{ label(o.resultatPropose) }} ». Validez-le pour
                  le rendre visible au client, ou refusez-le pour le renvoyer à l'agent.
                </p>
                <div class="flex flex-wrap gap-2 mt-3">
                  <button class="btn btn-primary" (click)="validateResult(o)">✓ Valider le résultat</button>
                  <button class="btn btn-outline" (click)="rejectResult(o)">✗ Refuser</button>
                </div>
              </div>
            }

            <!-- Suivi du workflow — acteurs et horodatages (identique au client) -->
            <div class="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div class="text-xs font-semibold uppercase text-gray-500 mb-3">Suivi du workflow</div>
              <ol class="space-y-3 text-sm">
                <li class="flex items-start gap-2">
                  <span class="text-emerald-600 mt-0.5">●</span>
                  <div>
                    <div class="font-medium">Ordre soumis</div>
                    <div class="text-xs text-gray-500">par {{ o.clientNom }} · {{ o.dateSoumission }}</div>
                  </div>
                </li>
                @if (o.validatedByAgent) {
                  <li class="flex items-start gap-2">
                    <span class="text-emerald-600 mt-0.5">●</span>
                    <div>
                      <div class="font-medium">Validé et transmis pour adjudication</div>
                      <div class="text-xs text-gray-500">par {{ o.validatedByAgentNom || o.validatedByAgent }} · {{ o.dateValidationAgent }}</div>
                    </div>
                  </li>
                }
                @if (o.resultatPropose && !o.resultatValideAt) {
                  <li class="flex items-start gap-2">
                    <span class="text-amber-500 mt-0.5">●</span>
                    <div>
                      <div class="font-medium">Résultat saisi par l'agent : {{ label(o.resultatPropose) }}</div>
                      <div class="text-xs text-gray-500">En attente de validation du superviseur — non visible par le client.</div>
                    </div>
                  </li>
                }
                @if (o.status === 'TOTALEMENT_RETENU' || o.status === 'PARTIELLEMENT_RETENU' || o.status === 'NON_RETENU') {
                  <li class="flex items-start gap-2">
                    <span class="text-emerald-600 mt-0.5">●</span>
                    <div>
                      <div class="font-medium">Résultat d'adjudication : {{ label(o.status) }}</div>
                      <div class="text-xs text-gray-500">{{ o.updatedAt || o.dateSoumission }}</div>
                    </div>
                  </li>
                }
                @if (o.status === 'ANNULE') {
                  <li class="flex items-start gap-2">
                    <span class="text-red-600 mt-0.5">●</span>
                    <div>
                      <div class="font-medium">Ordre annulé / rejeté</div>
                      <div class="text-xs text-gray-500">{{ o.updatedAt || o.dateSoumission }}</div>
                    </div>
                  </li>
                }
                <li class="flex items-start gap-2 text-gray-400">
                  <span class="mt-0.5">○</span>
                  <div class="font-medium">Statut courant : {{ label(o.status) }}</div>
                </li>
              </ol>
            </div>

            <!-- Grille des informations — identique à la vue client -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Client</div><div class="font-semibold">{{ o.clientNom }}</div><div class="text-xs text-gray-500">{{ o.clientId }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Émission · ISIN</div><div class="font-semibold font-mono">{{ o.emissionCode }} · {{ o.isin }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Nature / Émetteur</div><div class="font-semibold">{{ o.nature }} · {{ o.emetteur }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Compte espèces</div><div class="font-mono">{{ o.compteEspeces }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Compte titres</div>
                <div class="font-mono px-2 py-0.5 rounded inline-block"
                     [class]="classeComptesOrdre(o)">{{ afficherCompte(o.compteTitres) }}</div>
                @if (!o.compteTitres) {
                  <div class="text-[11px] text-red-700 mt-1">
                    Compte-titres à attribuer — l’ordre a été soumis avant son ouverture.
                  </div>
                }
              </div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Canal · IP</div><div class="font-semibold">{{ o.canal }} · <span class="font-mono text-xs">{{ o.ipSoumission || '—' }}</span></div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Volume demandé</div><div class="font-semibold">{{ o.volume }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Volume alloué</div><div class="font-semibold">{{ o.volumeAlloue ?? '—' }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Montant offert</div><div class="font-semibold">{{ o.montant | number:'1.0-0':'fr-FR' }} FCFA</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Montant adjugé / débité</div><div class="font-semibold">{{ (o.montantDebite ?? 0) | number:'1.0-0':'fr-FR' }} FCFA</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Taux soumis / adjugé</div><div class="font-semibold">{{ o.tauxSoumis }} % {{ o.tauxAdjuge ? '/ ' + o.tauxAdjuge + ' %' : '' }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Dernière mise à jour</div><div class="font-semibold">{{ o.updatedAt || '—' }}</div></div>
            </div>

            <!-- Bannières de statut — même ordre que la vue client -->
            @if (o.printedBySvt) {
              <div class="mt-4 p-3 rounded-lg border border-gray-300 bg-gray-50 text-sm text-gray-700">
                🔒 <b>Ordre verrouillé</b> — pris en charge par {{ o.printedBy || 'agent SVT' }} le {{ o.printedAt }}. Plus aucune modification possible.
              </div>
            }
            @if (o.commentaireResultat) {
              <div class="mt-4 p-3 rounded-lg border border-afb-red/30 bg-afb-red-light text-sm">
                <b>Commentaire de l'agent SVT :</b> {{ o.commentaireResultat }}
              </div>
            }
            @if (o.motifAnnulation) {
              <div class="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm">
                <div class="flex items-start gap-2">
                  <span class="text-xl">⚠️</span>
                  <div class="flex-1">
                    <b class="text-red-800">Motif de rejet (visible client) :</b>
                    <div class="text-sm text-red-900 mt-1">{{ o.motifAnnulation }}</div>
                    <div class="text-[11px] text-red-700 mt-1">Rejeté par {{ o.rejectedByAgent }} · {{ o.dateRejetAgent }}</div>
                  </div>
                </div>
              </div>
            }
            @if (o.validatedByAgent && o.status === 'EN_ATTENTE_ADJUDICATION') {
              <div class="mt-4 p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm">
                <b class="text-emerald-800">✓ Ordre validé par le back-office</b>
                <div class="text-xs text-emerald-700 mt-1">Validé par {{ o.validatedByAgentNom || o.validatedByAgent }} et transmis au marché primaire le {{ o.dateValidationAgent }}. Résultat dès la séance d'adjudication.</div>
              </div>
            }

            <!-- ───── Sections spécifiques back-office ───── -->
            @if (o.signatureData) {
              <div class="mt-6 border-t pt-4">
                <h3 class="text-xs uppercase text-gray-500 font-semibold mb-2">Signature électronique du client</h3>
                <afb-signature-viewer
                  [signatureData]="o.signatureData"
                  [verified]="o.signatureVerified ?? false"
                  [date]="o.signatureDate"
                  [showActions]="true"
                  (verify)="verifySignature(o.id)"
                  (reject)="rejectSignature(o.id)" />
              </div>
            }

            @if (o.notes) {
              <div class="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs">
                <b class="text-amber-900">Notes back-office :</b>
                <div class="mt-1 text-amber-800">{{ o.notes }}</div>
              </div>
            }

            <!-- Contrôle facial : photo de l'ouverture de compte vs photo de l'ordre -->
            <div class="mt-5 border-t pt-4">
              <div class="text-xs uppercase text-gray-500 font-semibold mb-2">Contrôle facial de l'ordre</div>
              <afb-order-face-compare [orderId]="o.id" />
            </div>

            <!-- Compte joint : qui a validé, qui est en attente, photos par personne -->
            <div class="mt-5 border-t pt-4">
              <div class="text-xs uppercase text-gray-500 font-semibold mb-2">Signataires du compte</div>
              <afb-order-joint-signatures [orderId]="o.id" (changed)="data.refreshOrders()" />
            </div>

            <div class="mt-5 border-t pt-4">
              <div class="text-xs uppercase text-gray-500 font-semibold mb-2">Historique audit (immuable)</div>
              @if (detailHistory().length) {
                <div class="space-y-2 text-xs max-h-40 overflow-auto">
                  @for (h of detailHistory(); track h.id) {
                    <div class="flex gap-2 border-l-2 pl-3"
                         [class.border-emerald-400]="h.resultat==='SUCCES'"
                         [class.border-red-400]="h.resultat==='ECHEC'">
                      <span class="font-mono text-gray-500">{{ h.horodatage }}</span>
                      <span class="font-semibold">{{ h.action }}</span>
                      <span class="text-gray-500">par {{ h.utilisateurNom || h.utilisateur }}</span>
                    </div>
                  }
                </div>
              } @else {
                <div class="text-xs text-gray-400 italic">Aucun événement</div>
              }
            </div>

            <div class="mt-5 pt-4 border-t flex flex-wrap items-center gap-2">
              <button class="btn btn-outline text-xs" (click)="downloadOrder(o.id)">⬇ Télécharger (.txt)</button>
              <button class="btn btn-outline text-xs" (click)="downloadOrderPdf(o.id)">📄 PDF formulaire client</button>

              <!-- Menu contextuel : traitement de l'ordre -->
              <div class="relative">
                <button class="btn btn-primary text-xs" (click)="actionsOpen.set(!actionsOpen())"
                        [attr.aria-expanded]="actionsOpen()">
                  ⚙ Traiter l'ordre {{ actionsOpen() ? '▴' : '▾' }}
                </button>
                @if (actionsOpen()) {
                  <!-- Capteur de clic extérieur : referme le menu -->
                  <div class="fixed inset-0 z-[55]" (click)="actionsOpen.set(false)"></div>
                  <div class="absolute right-0 mt-1 z-[56] w-72 bg-white rounded-lg shadow-xl border border-gray-200 py-1 flex flex-col">
                    <div class="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                      Actions disponibles
                    </div>
                    @if (o.status === 'SOUMIS' || o.status === 'EN_VERIFICATION') {
                      <button class="text-left px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                              (click)="actionsOpen.set(false); askValidate(o.id)">✓ Valider l'ordre</button>
                      <button class="text-left px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                              (click)="actionsOpen.set(false); askReject(o.id)">✕ Rejeter l'ordre</button>
                    }
                    @if (o.status === 'SOUMIS') {
                      <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                              (click)="actionsOpen.set(false); verifyProvision(o.id)">🔍 Vérifier la provision</button>
                    }
                    @if (!o.printedBySvt && (o.status === 'SOUMIS' || o.status === 'EN_VERIFICATION')) {
                      <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                              (click)="actionsOpen.set(false); downloadAndLock(o.id)">🖨 Télécharger &amp; Transmettre (verrouille)</button>
                    }
                    @if (o.status === 'EN_ATTENTE_ADJUDICATION') {
                      <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                              (click)="actionsOpen.set(false); openSaisieResultat(o.id)">📋 Saisir résultat d'adjudication</button>
                    }
                    @if (o.status === 'TOTALEMENT_RETENU' || o.status === 'PARTIELLEMENT_RETENU') {
                      <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                              (click)="actionsOpen.set(false); generateAvis(o.id, 'AVIS_OPERATION')">📄 Générer l'avis d'opéré</button>
                      <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                              (click)="actionsOpen.set(false); printAvis(o.id)">🖨 Imprimer l'avis d'opéré</button>
                    }
                    <div class="border-t my-1"></div>
                    @if (canChangeStatus(o)) {
                      <button class="text-left px-3 py-2 text-xs hover:bg-gray-50"
                              (click)="actionsOpen.set(false); openChangeStatus(o.id)">🔄 Changer le statut manuellement</button>
                    } @else {
                      <div class="px-3 py-2 text-[11px] text-gray-400 italic">🔒 Ordre clôturé — statut verrouillé</div>
                    }
                  </div>
                }
              </div>
            </div>

            <div class="mt-4 pt-4 border-t">
              <label class="label">Note interne (back-office)</label>
              @if (o.notes) {
                <div class="mb-2 p-2 rounded bg-gray-50 border border-gray-200 text-xs text-gray-700">
                  <b>Note actuelle :</b> {{ o.notes }}
                </div>
              }
              <textarea class="textarea" rows="2" [(ngModel)]="noteDraft" name="ond"
                        placeholder="Note visible uniquement en back-office…"></textarea>
              <div class="flex justify-end mt-2">
                <button class="btn btn-outline text-xs" (click)="saveNote(o.id)">💾 Enregistrer la note</button>
              </div>
            </div>
          </div>
        }
      </afb-modal>

      <!-- Changement de statut -->
      <afb-modal [open]="statusOpen()" size="md" (cancel)="statusOpen.set(false)">
        <div class="p-4 sm:p-6 overflow-y-auto">
          <h2 class="text-base sm:text-lg font-bold">Modifier le statut de l'ordre</h2>
          @if (statusOrder(); as so) {
            <p class="text-xs text-gray-500 mt-1">
              <b class="font-mono">{{ so.reference }}</b> · {{ so.clientNom }} · statut actuel :
              <span class="badge" [class]="badgeClass(so.status)">{{ label(so.status) }}</span>
            </p>
          }
          <div class="mt-4 space-y-3">
            <div>
              <label class="label">Nouveau statut</label>
              <select class="select" [(ngModel)]="newStatus" name="ns">
                <option value="">— Sélectionner —</option>
                @for (s of statusList; track s) {
                  <option [value]="s">{{ label(s) }}</option>
                }
              </select>
            </div>
            @if (newStatus === 'PARTIELLEMENT_RETENU') {
              <div>
                <label class="label">Volume alloué</label>
                <input class="input" type="number" min="0" [(ngModel)]="newVolume" name="nv">
              </div>
            }
            <div>
              <label class="label">Motif / Commentaire</label>
              <textarea class="textarea" rows="3" [(ngModel)]="newMotif" name="nm"
                        placeholder="Ex : Ajustement suite résultat adjudication BEAC du 15/04/2026"></textarea>
            </div>
            <div class="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
              <b>📧 Notification automatique</b>
              <div class="mt-1">Un e-mail + SMS sera envoyé au client. Action journalisée dans l'audit log immuable.</div>
            </div>
          </div>
          <div class="flex flex-col-reverse sm:flex-row gap-2 mt-5">
            <button class="btn btn-outline sm:flex-1" (click)="statusOpen.set(false)">Annuler</button>
            <button class="btn btn-primary sm:flex-1" [disabled]="!newStatus" (click)="doChangeStatus()">
              Confirmer & notifier le client
            </button>
          </div>
        </div>
      </afb-modal>

      <!-- Saisie résultats d'adjudication (CSFT §M3-F03) -->
      <afb-modal [open]="resultatOpen()" size="md" (cancel)="resultatOpen.set(false)">
        <div class="p-4 sm:p-6 overflow-y-auto">
          <h2 class="text-base sm:text-lg font-bold">Saisie du résultat d'adjudication</h2>
          @if (resultatOrder(); as ro) {
            <p class="text-xs text-gray-500 mt-1">
              <b class="font-mono">{{ ro.reference }}</b> · {{ ro.clientNom }}<br>
              Montant offert : <b>{{ ro.montant | number:'1.0-0':'fr-FR' }} FCFA</b> · Volume : {{ ro.volume }}
            </p>
          }
          <div class="mt-4 grid grid-cols-3 gap-2">
            <button type="button" class="btn text-xs"
                    [class.btn-primary]="resultatChoix() === 'TOTALEMENT_RETENU'" [class.btn-outline]="resultatChoix() !== 'TOTALEMENT_RETENU'"
                    (click)="setChoix('TOTALEMENT_RETENU')">✓ Tot. retenu</button>
            <button type="button" class="btn text-xs"
                    [class.btn-primary]="resultatChoix() === 'PARTIELLEMENT_RETENU'" [class.btn-outline]="resultatChoix() !== 'PARTIELLEMENT_RETENU'"
                    (click)="setChoix('PARTIELLEMENT_RETENU')">⚠ Part. retenu</button>
            <button type="button" class="btn text-xs"
                    [class.btn-primary]="resultatChoix() === 'NON_RETENU'" [class.btn-outline]="resultatChoix() !== 'NON_RETENU'"
                    (click)="setChoix('NON_RETENU')">✕ Non retenu</button>
          </div>

          @if (resultatChoix() === 'PARTIELLEMENT_RETENU') {
            <div class="mt-4">
              <label class="label">Montant adjugé (FCFA) <span class="text-afb-red">*</span></label>
              <input class="input" type="number" min="1" [max]="resultatOrder()?.montant ?? 0" [(ngModel)]="resultatMontant" name="rmnt">
            </div>
          }

          @if (resultatChoix() && resultatChoix() !== 'TOTALEMENT_RETENU') {
            <div class="mt-3">
              <label class="label">Commentaire / motif <span class="text-afb-red">*</span></label>
              <textarea class="textarea" rows="3" [(ngModel)]="resultatCommentaire" name="rcm"
                        placeholder="Précisez la cause (taux hors plage, enveloppe épuisée, etc.)"></textarea>
            </div>
          }

          @if (resultatChoix()) {
            <div class="mt-3">
              <label class="label">Taux adjugé</label>
              <input class="input" type="number" step="0.001" [(ngModel)]="resultatTaux" name="rtx">
            </div>
          }

          @if (resultatChoix()) {
            <div class="mt-4 p-3 rounded-lg bg-gray-50 border text-xs text-gray-700">
              <b>📧 Livrable auto-généré</b> — avis d'opéré généré au format <code>[TYPE]-[ISIN]-[DATE]-[CLIENT]-[SEQ]</code> et notifié au client (e-mail + SMS).
            </div>
          }

          <div class="flex flex-col-reverse sm:flex-row gap-2 mt-5">
            <button class="btn btn-outline sm:flex-1" (click)="resultatOpen.set(false)">Annuler</button>
            <button class="btn btn-primary sm:flex-1" [disabled]="!canSubmitResultat()" (click)="doSaisirResultat()">
              Confirmer & notifier
            </button>
          </div>
        </div>
      </afb-modal>

      <!-- Modale Rejet d'ordre avec motif (CSFT §M3) — visible côté client -->
      <afb-modal [open]="rejectOrderOpen()" size="md" (cancel)="rejectOrderOpen.set(false)">
        <div class="p-4 sm:p-6 overflow-y-auto">
          <h2 class="text-base sm:text-lg font-bold">Rejeter l'ordre</h2>
          @if (rejectOrderTarget(); as ro) {
            <p class="text-xs text-gray-500 mt-1">
              <b class="font-mono">{{ ro.reference }}</b> · {{ ro.clientNom }} · {{ ro.montant | number:'1.0-0':'fr-FR' }} FCFA
            </p>
          }
          <div class="mt-4">
            <label class="label">Motif du rejet <span class="text-afb-red">*</span></label>
            <select class="select" [(ngModel)]="rejectOrderMotifPredefined" name="rom" (ngModelChange)="onRejectMotifPredefined($event)">
              <option value="">— Sélectionner un motif type —</option>
              <option>Provision insuffisante</option>
              <option>Alerte LCB-FT</option>
              <option>Hors fenêtre de souscription</option>
              <option>Mentions obligatoires manquantes</option>
              <option>Volume non conforme</option>
              <option>Taux hors limite</option>
              <option>Compte suspendu</option>
              <option>Autre</option>
            </select>
            <label class="label mt-3">Précisions <span class="text-afb-red">*</span> (visibles par le client)</label>
            <textarea class="textarea" rows="4" [(ngModel)]="rejectOrderMotif" name="romdetail"
                      maxlength="1000"
                      placeholder="Détails complémentaires…"></textarea>
            <p class="hint">Le client recevra un e-mail/SMS avec ce motif. La provision sera libérée. Action journalisée en audit log (ECHEC).</p>
          </div>
          <div class="flex flex-col-reverse sm:flex-row gap-2 mt-5">
            <button class="btn btn-outline sm:flex-1" (click)="rejectOrderOpen.set(false)">Annuler</button>
            <button class="btn btn-danger sm:flex-1" [disabled]="!canSubmitRejectOrder()" (click)="doRejectOrder()">
              Confirmer le rejet
            </button>
          </div>
        </div>
      </afb-modal>

      <!-- Modale Validation en masse -->
      <afb-confirm-dialog [open]="bulkValidateOpen()" title="Valider en masse ?"
        [message]="'Valider ' + countSelectedValidatable() + ' ordre(s). Les ordres passent en attente d\\'adjudication BEAC.'"
        confirmLabel="Valider"
        (confirm)="doBulkValidate()" (cancel)="bulkValidateOpen.set(false)" />

      <!-- Modale Rejet en masse avec motif commun -->
      <afb-modal [open]="bulkRejectOpen()" size="md" (cancel)="bulkRejectOpen.set(false)">
        <div class="p-4 sm:p-6 overflow-y-auto">
          <h2 class="text-base sm:text-lg font-bold">Rejet en masse ({{ countSelectedRejectable() }} ordres)</h2>
          <p class="text-xs text-gray-500 mt-1">Un motif commun sera appliqué et chaque client recevra une notification individuelle.</p>
          <div class="mt-4">
            <label class="label">Motif commun <span class="text-afb-red">*</span></label>
            <textarea class="textarea" rows="5" [(ngModel)]="bulkRejectMotif" name="bulkRejectMotif"
                      maxlength="1000"
                      placeholder="Ex : Fermeture anticipée de l'émission par la BEAC"></textarea>
            <p class="hint">Les provisions seront libérées. Action journalisée en ECHEC pour chaque ordre.</p>
          </div>
          <div class="flex flex-col-reverse sm:flex-row gap-2 mt-5">
            <button class="btn btn-outline sm:flex-1" (click)="bulkRejectOpen.set(false)">Annuler</button>
            <button class="btn btn-danger sm:flex-1" [disabled]="!bulkRejectMotif.trim()" (click)="doBulkReject()">
              Confirmer le rejet
            </button>
          </div>
        </div>
      </afb-modal>

      <afb-twosign-dialog [open]="signOpen()" [message]="signMessage()"
        (confirm)="doTwoSign()" (cancel)="signOpen.set(false)" />
      <afb-confirm-dialog [open]="confirmBulk()" title="Annuler les ordres sélectionnés ?"
        [message]="'Annuler ' + selected().length + ' ordre(s). Les provisions seront libérées.'"
        confirmLabel="Annuler" [danger]="true"
        (confirm)="doBulkCancel()" (cancel)="confirmBulk.set(false)" />

      <afb-confirm-dialog [open]="adjudicationOpen()" title="Lancer l'adjudication de l'émission ?"
        message="Tous les ordres en cours de cette émission seront adjugés (totalement / partiellement / non retenus) selon le taux marginal, l'émission sera clôturée et les clients notifiés. Action persistée."
        confirmLabel="Lancer l'adjudication"
        (confirm)="doAdjudication()" (cancel)="adjudicationOpen.set(false)" />
    </div>
  `
})
export class BoOrders {
  data = inject(MockData);
  toast = inject(ToastService);

  readonly afficherCompte = afficherCompte;

  /** Rouge tant que l'ordre porte un compte-titres vide (client pas encore doté). */
  classeComptesOrdre(o: { compteTitres?: string; compteEspeces?: string }): string {
    return classeEtatComptes(o.compteTitres, o.compteEspeces);
  }
  api = inject(ApiService);
  private readonly pdfProgress = inject(PdfProgressService);
  /** Signatures des dirigeants apposées sur les documents générés. */
  private readonly bankSignatures = inject(BankSignaturesService);
  /** Recharge les ordres depuis la BD à l'ouverture du back-office. */
  constructor() { this.data.refreshOrders(); }

  /** Seul le superviseur (ORDER_RESULT_VALIDATE) valide l'adjudication saisie. */
  canValidateResult = computed(() => this.data.hasPermission('ORDER_RESULT_VALIDATE'));

  /** Valide le résultat d'adjudication proposé par l'agent. */
  validateResult(o: Order): void {
    this.data.validateOrderResult(o.id);
    this.toast.success('Adjudication validée', `Le résultat de ${o.reference} est désormais visible par le client.`);
  }

  /** Refuse le résultat proposé — il repart vers l'agent pour correction. */
  rejectResult(o: Order): void {
    const motif = (typeof window !== 'undefined'
      ? window.prompt('Motif du refus (renvoyé à l\'agent) :', 'Correction demandée')
      : 'Correction demandée') || 'Correction demandée';
    this.data.rejectOrderResult(o.id, motif);
    this.toast.success('Résultat refusé', `${o.reference} renvoyé à l'agent pour correction.`);
  }

  adjudicationOpen = signal(false);
  /** Lance l'adjudication de l'émission sélectionnée dans le filtre. */
  doAdjudication() {
    this.adjudicationOpen.set(false);
    const emission = this.filterEmission();
    if (!emission) return;
    this.data.runAdjudication(emission);
    this.toast.success('Adjudication exécutée', 'Résultats enregistrés, émission clôturée, clients notifiés.');
  }

  /** Brouillon de note interne saisie dans le détail d'un ordre. */
  noteDraft = '';
  /** Enregistre la note interne d'un ordre (persistée côté backend). */
  saveNote(id: string) {
    const n = this.noteDraft.trim();
    if (!n) return;
    this.data.addOrderNote(id, n);
    this.noteDraft = '';
    this.detailOrder.set(this.data.getOrder(id));
    this.toast.success('Note enregistrée');
  }

  statusList: OrderStatus[] = ['SOUMIS', 'EN_VERIFICATION', 'EN_ATTENTE_ADJUDICATION', 'TOTALEMENT_RETENU', 'PARTIELLEMENT_RETENU', 'NON_RETENU', 'ANNULE'];

  /** Stepper du détail d'ordre — calqué sur la vue client. */
  readonly steps: OrderStatus[] = ['SOUMIS', 'EN_VERIFICATION', 'EN_ATTENTE_ADJUDICATION', 'TOTALEMENT_RETENU'];
  reached(o: { status: OrderStatus } | undefined | null, s: OrderStatus): boolean {
    const cur = o?.status;
    if (!cur) return false;
    if ((cur === 'PARTIELLEMENT_RETENU' || cur === 'NON_RETENU') && s === 'TOTALEMENT_RETENU') return true;
    return this.steps.indexOf(cur) >= this.steps.indexOf(s);
  }

  /** Statuts « clôturés » : l'ordre a atteint un état final, son statut ne peut plus être modifié. */
  readonly LOCKED_STATUSES: OrderStatus[] = ['ANNULE', 'TOTALEMENT_RETENU', 'PARTIELLEMENT_RETENU', 'NON_RETENU'];
  canChangeStatus(o: { status: OrderStatus }): boolean {
    return !this.LOCKED_STATUSES.includes(o.status);
  }

  /** Menu d'actions contextuel par ligne de la liste des ordres collectés. */
  rowMenuId = signal<string | null>(null);
  rowMenuPos = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  rowMenuOrder = computed(() => {
    const id = this.rowMenuId();
    return id ? this.data.orders().find(o => o.id === id) : undefined;
  });
  toggleRowMenu(id: string, ev: Event) {
    if (this.rowMenuId() === id) { this.rowMenuId.set(null); return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const menuW = 224, menuH = 240;
    let x = r.right - menuW;
    if (x < 8) x = 8;
    let y = r.bottom + 4;
    if (y + menuH > window.innerHeight) y = Math.max(8, r.top - menuH - 4);
    this.rowMenuPos.set({ x, y });
    this.rowMenuId.set(id);
  }

  // Filtres en SIGNALS : indispensables pour que `filtered` (computed) se
  // recalcule a la saisie/selection. En champs ordinaires, le computed ne
  // dependait d'aucun signal de filtre et ne se mettait a jour qu'apres une
  // autre action modifiant data.orders() (effet « il faut recharger »).
  filterSearch = signal('');
  filterStatus = signal('');
  filterEmission = signal('');
  filterCanal = signal('');

  selected = signal<string[]>([]);
  page = signal(1);

  signOpen = signal(false);
  signAction: 'CANCEL' | 'TRANSMIT' | 'BULK_VERIFY' | 'BULK_TRANSMIT' | null = null;
  signTargetId: string | null = null;
  signMessage = signal('');
  confirmBulk = signal(false);

  detailOpen = signal(false);
  actionsOpen = signal(false);
  detailOrder = signal<import('../../core/models/models').Order | undefined>(undefined);
  detailHistory = computed(() => {
    const o = this.detailOrder();
    return o ? this.data.getOrderHistory(o.reference) : [];
  });

  statusOpen = signal(false);
  statusOrder = signal<import('../../core/models/models').Order | undefined>(undefined);
  newStatus: OrderStatus | '' = '';
  newMotif = '';
  newVolume = 0;

  filtered = computed(() => {
    const q = this.filterSearch().trim().toLowerCase();
    const status = this.filterStatus();
    const emission = this.filterEmission();
    const canal = this.filterCanal();
    return this.data.orders().filter(o =>
      (!q || o.reference.toLowerCase().includes(q) || o.clientNom.toLowerCase().includes(q) || o.clientId.toLowerCase().includes(q) || o.emissionCode.toLowerCase().includes(q) || o.isin.toLowerCase().includes(q)) &&
      (!status || o.status === status) &&
      (!emission || o.emissionId === emission) &&
      (!canal || o.canal === canal)
    );
  });

  resetFilters() {
    this.filterSearch.set('');
    this.filterStatus.set('');
    this.filterEmission.set('');
    this.filterCanal.set('');
    this.page.set(1);
  }

  // Sélection
  isSelected(id: string) { return this.selected().includes(id); }
  toggleSelect(id: string) {
    this.selected.update(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  }
  allSelected() {
    const f = this.filtered();
    return f.length > 0 && f.every(o => this.selected().includes(o.id));
  }
  toggleAll() {
    if (this.allSelected()) this.selected.set([]);
    else this.selected.set(this.filtered().map(o => o.id));
  }
  clearSelection() { this.selected.set([]); }
  selectedTotal() {
    return this.selected().reduce((s, id) => s + (this.data.getOrder(id)?.montant ?? 0), 0);
  }
  countSelectedWithStatus(s: OrderStatus) {
    return this.selected().filter(id => this.data.getOrder(id)?.status === s).length;
  }
  countSelectedTransmitable() {
    return this.selected().filter(id => {
      const st = this.data.getOrder(id)?.status;
      return st === 'EN_VERIFICATION' || st === 'SOUMIS';
    }).length;
  }
  canBulkVerify() { return this.countSelectedWithStatus('SOUMIS') > 0; }
  canBulkTransmit() { return this.countSelectedTransmitable() > 0; }
  canBulkCancel() {
    return this.selected().some(id => {
      const st = this.data.getOrder(id)?.status;
      return st === 'SOUMIS' || st === 'EN_VERIFICATION';
    });
  }
  canCancel(s: OrderStatus) { return s === 'SOUMIS' || s === 'EN_VERIFICATION'; }

  openDetail(id: string) {
    this.detailOrder.set(this.data.getOrder(id));
    this.actionsOpen.set(false);
    this.detailOpen.set(true);
  }

  // ── Validation / Rejet individuel (CSFT §M3) ─────────────
  rejectOrderOpen = signal(false);
  rejectOrderTarget = signal<import('../../core/models/models').Order | undefined>(undefined);
  rejectOrderMotifPredefined = '';
  rejectOrderMotif = '';
  canSubmitRejectOrder() { return this.rejectOrderMotif.trim().length > 0; }
  onRejectMotifPredefined(v: string) {
    if (v && v !== 'Autre' && !this.rejectOrderMotif) this.rejectOrderMotif = v;
  }
  askValidate(id: string) {
    const o = this.data.getOrder(id);
    if (!o) return;
    this.data.validateOrder(id).subscribe(ok => {
      if (ok) {
        this.detailOrder.set(this.data.getOrder(id));
        this.toast.success('Ordre validé', `${o.reference} → En attente d'adjudication. Client notifié.`);
      } else {
        this.toast.error('Validation impossible', 'Statut non éligible ou erreur serveur.');
      }
    });
  }
  askReject(id: string) {
    const o = this.data.getOrder(id);
    if (!o) return;
    this.rejectOrderTarget.set(o);
    this.rejectOrderMotifPredefined = '';
    this.rejectOrderMotif = '';
    this.rejectOrderOpen.set(true);
  }
  doRejectOrder() {
    const o = this.rejectOrderTarget();
    if (!o) return;
    const finalMotif = this.rejectOrderMotifPredefined && this.rejectOrderMotifPredefined !== 'Autre'
      ? `${this.rejectOrderMotifPredefined} — ${this.rejectOrderMotif}`
      : this.rejectOrderMotif;
    this.data.rejectOrder(o.id, finalMotif).subscribe(ok => {
      if (ok) {
        this.toast.info('Ordre rejeté', `${o.reference} · client notifié avec motif`);
        this.detailOrder.set(this.data.getOrder(o.id));
        this.rejectOrderOpen.set(false);
      } else {
        this.toast.error('Rejet impossible', 'Motif manquant ou statut non éligible.');
      }
    });
  }

  // ── Validation / Rejet en masse ──────────────────────────
  bulkValidateOpen = signal(false);
  bulkRejectOpen = signal(false);
  bulkRejectMotif = '';
  countSelectedValidatable() {
    return this.selected().filter(id => {
      const st = this.data.getOrder(id)?.status;
      return st === 'SOUMIS' || st === 'EN_VERIFICATION';
    }).length;
  }
  countSelectedRejectable() { return this.countSelectedValidatable(); }
  canBulkValidate() { return this.countSelectedValidatable() > 0; }
  canBulkReject() { return this.countSelectedRejectable() > 0; }
  askBulkValidate() {
    if (!this.canBulkValidate()) return;
    this.bulkValidateOpen.set(true);
  }
  doBulkValidate() {
    const ids = this.selected().filter(id => {
      const st = this.data.getOrder(id)?.status;
      return st === 'SOUMIS' || st === 'EN_VERIFICATION';
    });
    this.data.bulkValidateOrders(ids).subscribe(res => {
      this.toast.success('Validation en masse', `${res.ok} ordre(s) validé(s)${res.ko ? ' · ' + res.ko + ' échec(s)' : ''}`);
    });
    this.bulkValidateOpen.set(false);
    this.clearSelection();
  }
  askBulkReject() {
    if (!this.canBulkReject()) return;
    this.bulkRejectMotif = '';
    this.bulkRejectOpen.set(true);
  }
  doBulkReject() {
    const motif = this.bulkRejectMotif.trim();
    if (!motif) return;
    const ids = this.selected().filter(id => {
      const st = this.data.getOrder(id)?.status;
      return st === 'SOUMIS' || st === 'EN_VERIFICATION';
    });
    this.data.bulkRejectOrders(ids, motif).subscribe(res => {
      this.toast.info('Rejet en masse', `${res.ok} ordre(s) rejeté(s)${res.ko ? ' · ' + res.ko + ' échec(s)' : ''}`);
    });
    this.bulkRejectOpen.set(false);
    this.clearSelection();
  }

  // Vérification de provision (CSFT §M3-F02)
  verifyProvision(id: string) {
    if (this.data.verifyProvision(id)) {
      this.detailOrder.set(this.data.getOrder(id));
      this.toast.success('Vérification lancée', 'Statut → En vérification');
    } else {
      this.toast.error('Vérification impossible', 'Statut non éligible.');
    }
  }

  // Changement de statut
  openChangeStatus(id: string) {
    const o = this.data.getOrder(id);
    if (!o) return;
    if (!this.canChangeStatus(o)) {
      this.toast.error('Statut verrouillé',
        `L'ordre ${o.reference} est clôturé (${this.label(o.status)}). Son statut ne peut plus être modifié.`);
      return;
    }
    this.statusOrder.set(o);
    this.newStatus = '';
    this.newMotif = '';
    this.newVolume = o.volume;
    this.statusOpen.set(true);
  }
  doChangeStatus() {
    const o = this.statusOrder();
    if (!o || !this.newStatus) return;
    if (!this.canChangeStatus(o)) {
      this.toast.error('Statut verrouillé', `L'ordre ${o.reference} est clôturé.`);
      this.statusOpen.set(false);
      return;
    }
    const ok = this.data.changeOrderStatus(o.id, this.newStatus as OrderStatus, this.newMotif || undefined, this.newStatus === 'PARTIELLEMENT_RETENU' ? this.newVolume : undefined);
    if (ok) {
      this.toast.success('Statut mis à jour', `${o.reference} → ${this.label(this.newStatus as OrderStatus)}`);
      this.statusOpen.set(false);
      this.detailOpen.set(false);
    } else {
      this.toast.error('Changement impossible', 'Statut identique ou ordre introuvable.');
    }
  }

  // Double signature
  askCancel(id: string) {
    this.signAction = 'CANCEL';
    this.signTargetId = id;
    this.signMessage.set('Annulation d\'ordre. La provision sera libérée. Double signature obligatoire.');
    this.signOpen.set(true);
  }
  askTransmit(id: string) {
    this.signAction = 'TRANSMIT';
    this.signTargetId = id;
    this.signMessage.set('Transmission de l\'ordre au marché primaire BEAC. Action irréversible.');
    this.signOpen.set(true);
  }
  doTwoSign() {
    this.signOpen.set(false);
    if (this.signAction === 'BULK_VERIFY') {
      const ids = this.selected().filter(id => this.data.getOrder(id)?.status === 'SOUMIS');
      for (const id of ids) this.data.verifyProvision(id);
      this.toast.success(`${ids.length} vérification(s) lancée(s)`);
      this.clearSelection();
    } else if (this.signAction === 'BULK_TRANSMIT') {
      const ids = this.selected().filter(id => {
        const st = this.data.getOrder(id)?.status;
        return st === 'EN_VERIFICATION' || st === 'SOUMIS';
      });
      for (const id of ids) this.data.transmitOrder(id);
      this.toast.success(`${ids.length} ordre(s) transmis au marché`);
      this.clearSelection();
    } else if (this.signTargetId) {
      const o = this.data.getOrder(this.signTargetId);
      if (this.signAction === 'CANCEL') {
        if (this.data.cancelOrder(this.signTargetId)) this.toast.info('Ordre annulé', `${o?.reference} · provision libérée`);
      } else if (this.signAction === 'TRANSMIT') {
        if (this.data.transmitOrder(this.signTargetId)) this.toast.success('Ordre transmis au marché', `${o?.reference}`);
      }
    }
    this.signTargetId = null;
    this.signAction = null;
  }

  // Bulk
  bulkVerify() {
    this.signAction = 'BULK_VERIFY';
    this.signMessage.set(`Lancer la vérification de provision pour ${this.countSelectedWithStatus('SOUMIS')} ordre(s).`);
    this.signOpen.set(true);
  }
  bulkTransmit() {
    this.signAction = 'BULK_TRANSMIT';
    this.signMessage.set(`Transmettre ${this.countSelectedTransmitable()} ordre(s) au marché primaire. Double signature obligatoire.`);
    this.signOpen.set(true);
  }
  bulkCancel() { this.confirmBulk.set(true); }
  doBulkCancel() {
    let n = 0;
    for (const id of this.selected()) {
      if (this.data.cancelOrder(id)) n++;
    }
    this.toast.info(`${n} ordre(s) annulé(s)`);
    this.clearSelection();
    this.confirmBulk.set(false);
  }

  // Signature
  verifySignature(id: string) {
    this.data.verifyOrderSignature(id, true);
    this.detailOrder.set(this.data.getOrder(id));
    this.toast.success('Signature validée');
  }
  rejectSignature(id: string) {
    this.data.verifyOrderSignature(id, false);
    this.detailOrder.set(this.data.getOrder(id));
    this.toast.error('Signature rejetée', 'Le client sera notifié.');
  }

  // Impression / téléchargement
  printOrder(id: string) {
    const o = this.data.getOrder(id);
    if (!o || typeof window === 'undefined') return;
    const html = buildClientOrderFormHtml(o);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      URL.revokeObjectURL(url);
      this.toast.error('Pop-up bloqué', 'Autorisez les fenêtres pour imprimer.');
      return;
    }
    try { w.addEventListener('load', () => { try { w.print(); } catch { /* ignore */ } }); } catch { /* ignore */ }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  async downloadOrderPdf(id: string) {
    const o = this.data.getOrder(id);
    if (!o) return;
    this.pdfProgress.start();
    try {
      await downloadClientOrderPdf(o, (p, l) => this.pdfProgress.set(p, l));
      this.pdfProgress.done();
      this.toast.success('PDF téléchargé', `${o.reference}.pdf`);
    } catch {
      this.pdfProgress.fail();
      this.toast.error('Échec PDF', 'Impossible de générer le PDF.');
    }
  }
  downloadOrder(id: string) {
    const o = this.data.getOrder(id);
    if (!o) return;
    const content = `AFRILAND FIRST BANK — BON D'ORDRE\n${'-'.repeat(50)}\nRéférence : ${o.reference}\nClient : ${o.clientNom} (${o.clientId})\nISIN : ${o.isin}\nÉmission : ${o.emissionCode} · ${o.nature} · ${o.emetteur}\nVolume : ${o.volume}\nMontant : ${o.montant.toLocaleString('fr-FR')} FCFA\nTaux : ${o.tauxSoumis} %\nCompte espèces : ${o.compteEspeces}\nCompte titres : ${o.compteTitres}\nStatut : ${ORDER_STATUS_LABELS[o.status]}\nDate : ${o.dateSoumission}\n${o.notes ? '\nNotes : ' + o.notes : ''}`;
    downloadBlob(`${o.reference}.txt`, content);
    this.toast.success("Bon d'ordre téléchargé", o.reference);
  }
  /** Génère l'avis d'opéré et le télécharge directement chez l'agent (PDF local). */
  async generateAvis(id: string, type: DocumentType) {
    const o = this.data.getOrder(id);
    if (!o) return;
    if (type !== 'AVIS_OPERATION') {
      this.toast.info('Document non disponible', "L'avis d'offre non adjugée n'est plus téléversable ni généré depuis la plateforme.");
      return;
    }
    const em = this.data.getEmission(o.emissionId);
    // Signatures des dirigeants habilites (Administration > Signatures). Une
    // panne de chargement ne bloque pas : le document est simplement genere
    // sans la signature de la banque.
    const signataires = await firstValueFrom(this.bankSignatures.get());
    this.pdfProgress.start();
    try {
      await downloadAvisOperePdf(o, em, { signataires }, (p, l) => this.pdfProgress.set(p, l));
      this.pdfProgress.done();
      this.toast.success('Avis d\'opéré téléchargé', `AVIS-OPERE-${o.reference}.pdf`);
    } catch {
      this.pdfProgress.fail();
      this.toast.error('Échec', 'Impossible de générer l\'avis d\'opéré.');
    }
  }

  /** Ouvre l'avis d'opéré dans un nouvel onglet et lance l'impression directe. */
  async printAvis(id: string) {
    const o = this.data.getOrder(id);
    if (!o) return;
    const em = this.data.getEmission(o.emissionId);
    // Meme document que le PDF : il doit porter les memes signatures.
    const signataires = await firstValueFrom(this.bankSignatures.get());
    if (!printAvisOpere(o, em, { signataires })) {
      this.toast.error('Pop-up bloqué', 'Autorisez les fenêtres pour imprimer.');
    }
  }

  /** Téléchargement + impression → verrouille l'ordre côté client et le transmet. */
  downloadAndLock(id: string) {
    this.downloadOrder(id);
    this.printOrder(id);
    if (this.data.printAndLockOrder(id)) {
      this.detailOrder.set(this.data.getOrder(id));
      this.toast.success('Ordre transmis & verrouillé', 'En attente d\'adjudication.');
    }
  }

  // Saisie résultat d'adjudication (CSFT §M3-F03)
  resultatOpen = signal(false);
  resultatOrder = signal<import('../../core/models/models').Order | undefined>(undefined);
  resultatChoix = signal<'TOTALEMENT_RETENU' | 'PARTIELLEMENT_RETENU' | 'NON_RETENU' | ''>('');
  resultatMontant = 0;
  resultatCommentaire = '';
  resultatTaux = 0;
  openSaisieResultat(id: string) {
    const o = this.data.getOrder(id);
    if (!o) return;
    this.resultatOrder.set(o);
    this.resultatChoix.set('');
    this.resultatMontant = Math.round(o.montant / 2);
    this.resultatCommentaire = '';
    this.resultatTaux = o.tauxSoumis;
    this.resultatOpen.set(true);
  }
  setChoix(c: 'TOTALEMENT_RETENU' | 'PARTIELLEMENT_RETENU' | 'NON_RETENU') { this.resultatChoix.set(c); }
  canSubmitResultat(): boolean {
    const c = this.resultatChoix();
    if (!c) return false;
    if (c === 'TOTALEMENT_RETENU') return true;
    if (!this.resultatCommentaire.trim()) return false;
    if (c === 'PARTIELLEMENT_RETENU') return this.resultatMontant > 0;
    return true;
  }
  /**
   * Applique le résultat d'adjudication — et n'annonce le succès que si le
   * SERVEUR l'a enregistré.
   *
   * Auparavant, un refus du serveur était avalé : l'écran félicitait l'agent
   * pendant que l'ordre restait en attente d'adjudication.
   */
  doSaisirResultat() {
    const o = this.resultatOrder();
    const c = this.resultatChoix();
    if (!o || !c) return;
    this.data.saisirResultat(o.id, c, {
      montantPartiel: c === 'PARTIELLEMENT_RETENU' ? this.resultatMontant : undefined,
      tauxAdjuge: this.resultatTaux || undefined,
      commentaire: c !== 'TOTALEMENT_RETENU' ? this.resultatCommentaire : undefined
    }).subscribe(ok => {
      if (!ok) {
        this.toast.error('Résultat non enregistré',
          'La banque a refusé l’opération. Vérifiez que l’ordre est bien transmis à '
          + 'l’adjudication, et que le montant et le commentaire sont renseignés.');
        return;
      }
      this.resultatOpen.set(false);
      this.detailOrder.set(this.data.getOrder(o.id));
      this.toast.success('Résultat saisi', `${o.reference} : ${this.label(c as OrderStatus)}`);
      // Génération + transmission AUTOMATIQUE uniquement pour les offres retenues.
      // Les avis d'offre non adjugée ne sont plus uploadés/générés.
      if (c !== 'NON_RETENU') void this.generateAvis(o.id, 'AVIS_OPERATION');
    });
  }

  exportCsv() {
    const rows = this.filtered();
    const csv = arrayToCsv(rows.map(o => ({
      ref: o.reference, client: o.clientNom, clientId: o.clientId, isin: o.isin, emission: o.emissionCode,
      nature: o.nature, emetteur: o.emetteur, volume: o.volume, montant: o.montant,
      taux: o.tauxSoumis, canal: o.canal, statut: o.status, date: o.dateSoumission, notes: o.notes ?? ''
    })));
    downloadBlob('ordres-collectes.csv', csv, 'text/csv');
    this.toast.success('Export CSV', `${rows.length} ordres exportés.`);
  }

  countByStatus(s: OrderStatus) { return this.data.orders().filter(o => o.status === s).length; }
  label(s: OrderStatus) { return ORDER_STATUS_LABELS[s]; }
  badgeClass(s: OrderStatus) { return orderBadgeClass(s); }
}

/* ====================== CLIENTS — CSFT §M3 ====================== */
@Component({
  selector: 'afb-bo-clients',
  imports: [FormsModule, DecimalPipe, ModalShell, Paginator, PaginatePipe, ConfirmDialog, FaceVerifyPanel],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Clients investisseurs</h1>
          <p class="text-sm text-gray-500">CSFT §3.2 — Onboarding · PP (mono-signataire) ou PM (multi-signataires + sous-comptes)</p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <button class="btn btn-outline text-xs">⬇ Export</button>
          <button class="btn btn-primary text-xs" (click)="openCreate()">+ Nouveau client</button>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div class="kpi"><span class="kpi-label">Clients</span><span class="kpi-value">{{ data.clientsRegistry().length }}</span></div>
        <div class="kpi"><span class="kpi-label">Personnes morales</span><span class="kpi-value">{{ countPm() }}</span></div>
      </div>

      <div class="card mb-4">
        <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div class="lg:col-span-2">
            <label class="label">Recherche</label>
            <input class="input" placeholder="🔍 ID, raison sociale, compte…" [ngModel]="fSearch()" (ngModelChange)="fSearch.set($event); page.set(1)" name="cls">
          </div>
          <div>
            <label class="label">Type</label>
            <select class="select" [ngModel]="fType()" (ngModelChange)="fType.set($event); page.set(1)" name="clt">
              <option value="">Tous</option>
              <option value="PP">PP — Personne physique</option>
              <option value="PM">PM — Personne morale</option>
            </select>
          </div>
          <div>
            <label class="label">Catégorie</label>
            <select class="select" [ngModel]="fCat()" (ngModelChange)="fCat.set($event); page.set(1)" name="clc">
              <option value="">Toutes</option>
              <option value="QUALIFIE">Qualifié</option>
              <option value="NON_QUALIFIE">Non qualifié</option>
            </select>
          </div>
          <div class="flex items-end gap-2">
            <select class="select flex-1" [ngModel]="fStatut()" (ngModelChange)="fStatut.set($event); page.set(1)" name="cls2">
              <option value="">Tous statuts</option>
              <option value="ACTIF">Actif</option>
              <option value="BLOQUE">Bloqué</option>
              <option value="SUSPENDU">Suspendu</option>
              <option value="CLOTURE">Clôturé</option>
            </select>
            <button class="btn btn-outline whitespace-nowrap" (click)="resetFilters()">↺</button>
          </div>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto"><table class="table min-w-[720px] sm:min-w-full">
          <thead><tr><th>ID</th><th>Raison sociale / Nom</th><th>Type</th><th>Catégorie</th><th>Compte-titres</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            @for (c of (filtered() | paginate:page():10); track c.id) {
              <tr>
                <td class="font-mono text-xs">{{ c.id }}</td>
                <td>
                  <div class="font-semibold text-sm">{{ c.raisonSociale }}</div>
                  @if (c.rccm) { <div class="text-[11px] text-gray-500">RCCM {{ c.rccm }}</div> }
                </td>
                <td><span class="badge" [class.bg-blue-100]="c.type==='PP'" [class.text-blue-700]="c.type==='PP'" [class.bg-purple-100]="c.type==='PM'" [class.text-purple-700]="c.type==='PM'">{{ c.type }}</span></td>
                <td class="text-xs">{{ c.compte.categorie === 'QUALIFIE' ? 'Qualifié' : 'Non qualifié' }}</td>
                <td>
                  <span class="font-mono text-xs px-2 py-0.5 rounded"
                        [class]="classeComptes(c)"
                        [title]="c.compte.compteEspecesLie
                          ? 'Compte espèces : ' + c.compte.compteEspecesLie
                          : 'Compte espèces non renseigné'">
                    {{ afficherCompte(c.compte.numero) }}
                  </span>
                </td>
                <td>
                  <span class="badge"
                        [class.badge-publie]="c.compte.statut==='ACTIF'"
                        [class.badge-cloture]="c.compte.statut!=='ACTIF'">{{ c.compte.statut }}</span>
                </td>
                <td><button class="text-afb-red text-xs" (click)="open(c)">Dossier</button></td>
              </tr>
            }
            @if (!filtered().length) {
              <tr><td colspan="7" class="text-center py-12 text-gray-400 text-sm">Aucun client ne correspond aux filtres</td></tr>
            }
          </tbody>
        </table></div>
        <afb-paginator [total]="filtered().length" [pageSize]="10" [(page)]="page" />
      </div>

      <!-- Dossier client ─────────────────────────────────────── -->
      <afb-modal [open]="show()" size="4xl" (cancel)="show.set(false)">
        @if (sel(); as c) {
          <div class="p-4 sm:p-6 overflow-y-auto">
            <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <div class="text-xs text-gray-500">Dossier client</div>
                <h2 class="text-lg font-bold">{{ c.raisonSociale }}</h2>
                <p class="text-sm text-gray-500">{{ c.id }} · {{ c.type === 'PP' ? 'Personne physique' : 'Personne morale' }} · {{ c.compte.categorie }}</p>
                @if (c.categorieClient) { <p class="text-xs text-gray-500">Catégorie client : {{ c.categorieClient }}</p> }
                @if (c.matricule || c.dirigeant || c.localisation) {
                  <p class="text-[11px] text-gray-400">
                    @if (c.matricule) { <span>Mat. {{ c.matricule }}</span> }
                    @if (c.dirigeant) { <span> · Dirigeant : {{ c.dirigeant }}</span> }
                    @if (c.localisation) { <span> · {{ c.localisation }}</span> }
                  </p>
                }
                @if (c.rccm) { <p class="text-xs text-gray-500">RCCM {{ c.rccm }}</p> }
                <p class="text-[11px] text-gray-400 mt-1">Créé par {{ c.createdByNom || c.createdBy || '—' }} le {{ c.createdAt }}</p>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button class="btn btn-outline text-xs" (click)="openEdit(c)" title="Modifier les informations du client">✏️ Modifier</button>
                <button class="btn btn-outline text-xs" (click)="viewInitialPassword(c)" title="Voir le mot de passe initial (tant qu'il n'a pas été changé)">🔑 Mot de passe initial</button>
                @if (c.compte.statut !== 'CLOTURE') {
                  <button class="btn btn-outline text-xs text-red-600 border-red-200 hover:bg-red-50" (click)="askDeactivate(c)" title="Désactiver (clôturer) le client — réversible">🚫 Désactiver</button>
                }
                <button class="btn btn-ghost text-xl" (click)="show.set(false)">✕</button>
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div class="card p-4"><div class="text-[11px] uppercase text-gray-500">Compte-titres</div><div class="font-mono text-sm">{{ c.compte.numero }}</div><div class="text-xs text-gray-500">{{ c.compte.typeCompte }} · {{ c.compte.statut }}</div></div>
              <div class="card p-4">
                <div class="text-[11px] uppercase text-gray-500">Compte espèces lié</div>
                <div class="font-mono text-sm">{{ c.compte.compteEspecesLie }}</div>
              </div>
              <div class="card p-4"><div class="text-[11px] uppercase text-gray-500">Sous-comptes / Signataires</div><div class="font-bold text-lg">{{ c.compte.sousComptes?.length ?? 0 }} / {{ c.compte.contacts?.length ?? 0 }}</div></div>
            </div>

            <!-- Vérification faciale (capture réalisée à l'inscription en ligne) -->
            <div class="card mb-4">
              <div class="card-header"><h3 class="font-semibold text-sm">Vérification faciale (KYC)</h3></div>
              <div class="p-4">
                <afb-face-verify-panel [userId]="c.id" [actions]="true" />
              </div>
            </div>

            <!-- Sous-comptes -->
            <div class="card mb-4">
              <div class="card-header"><h3 class="font-semibold text-sm">Sous-comptes titres</h3></div>
              <div class="overflow-x-auto"><table class="table min-w-[600px] text-xs">
                <thead><tr><th>Numéro</th><th>Libellé</th><th>Type</th><th>Statut</th><th>Positions</th><th>Valeur</th></tr></thead>
                <tbody>
                  @for (s of (c.compte.sousComptes ?? []); track s.id) {
                    <tr>
                      <td class="font-mono">{{ s.numero }}</td>
                      <td class="font-semibold">{{ s.libelle }}</td>
                      <td><span class="badge bg-purple-100 text-purple-700">{{ s.type }}</span></td>
                      <td><span class="badge" [class.badge-publie]="s.statut==='ACTIF'" [class.badge-cloture]="s.statut!=='ACTIF'">{{ s.statut }}</span></td>
                      <td>{{ s.positionsCount }}</td>
                      <td>{{ s.valeurTotale | number:'1.0-0':'fr-FR' }}</td>
                    </tr>
                  }
                </tbody>
              </table></div>
            </div>

            <!-- Signataires / Contacts -->
            <div class="card mb-4">
              <div class="card-header"><h3 class="font-semibold text-sm">Signataires & contacts ({{ c.compte.contacts?.length ?? 0 }})</h3></div>
              <div class="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                @for (co of (c.compte.contacts ?? []); track co.id) {
                  <div class="border rounded-lg p-3 text-sm">
                    <span class="badge text-[10px] mb-1"
                          [class.bg-blue-100]="co.type==='TITULAIRE'" [class.text-blue-700]="co.type==='TITULAIRE'"
                          [class.bg-emerald-100]="co.type==='REPRESENTANT_LEGAL'" [class.text-emerald-700]="co.type==='REPRESENTANT_LEGAL'"
                          [class.bg-amber-100]="co.type==='CONTACT_ORDRE'" [class.text-amber-700]="co.type==='CONTACT_ORDRE'"
                          [class.bg-red-100]="co.type==='URGENCE'" [class.text-red-700]="co.type==='URGENCE'">{{ co.type.replace('_',' ') }}</span>
                    <div class="font-semibold">{{ co.civilite || '' }} {{ co.prenom }} {{ co.nom }}</div>
                    @if (co.fonction) { <div class="text-xs text-gray-500">{{ co.fonction }}</div> }
                    @if (co.telephonePortable) { <div class="text-xs">📱 {{ co.telephonePortable }}</div> }
                    @if (co.email) { <div class="text-xs">📧 {{ co.email }}</div> }
                  </div>
                }
              </div>
            </div>

            <!-- Adresses -->
            <div class="card">
              <div class="card-header"><h3 class="font-semibold text-sm">Adresses</h3></div>
              <div class="p-4 space-y-2 text-sm">
                @for (a of (c.compte.adresses ?? []); track a.type) {
                  <div class="border-b pb-2 last:border-0">
                    <span class="badge bg-blue-100 text-blue-700 text-[10px] mb-1">{{ a.type }}</span>
                    <div>{{ a.rue }} · {{ a.ville }} · {{ a.pays }}</div>
                  </div>
                }
              </div>
            </div>
          </div>
        }
      </afb-modal>

      <!-- Modal Création client (PP / PM) ─────────────────────── -->
      <afb-modal [open]="createOpen()" size="4xl" (cancel)="createOpen.set(false)">
        <div class="p-4 sm:p-6 overflow-y-auto">
          <div class="flex items-start justify-between mb-4">
            <div>
              <h2 class="text-lg sm:text-xl font-bold">Création d'un nouveau client</h2>
              <p class="text-xs text-gray-500 mt-0.5">CSFT §3.2 — KYC + ouverture de compte-titres</p>
            </div>
            <button class="btn btn-ghost text-xl shrink-0" (click)="createOpen.set(false)">✕</button>
          </div>

          <!-- Toggle PP / PM -->
          <div class="grid grid-cols-2 gap-2 mb-5">
            <button type="button" class="btn" [class.btn-primary]="newType()==='PP'" [class.btn-outline]="newType()!=='PP'" (click)="setType('PP')">
              👤 Personne Physique
              <span class="text-[11px] block opacity-75">1 signataire · 1 sous-compte</span>
            </button>
            <button type="button" class="btn" [class.btn-primary]="newType()==='PM'" [class.btn-outline]="newType()!=='PM'" (click)="setType('PM')">
              🏢 Personne Morale
              <span class="text-[11px] block opacity-75">1-4 signataires · N sous-comptes</span>
            </button>
          </div>

          <!-- Identité -->
          <div class="card mb-4">
            <div class="card-header"><h3 class="font-semibold text-sm">{{ newType()==='PP' ? 'Identité' : 'Raison sociale & immatriculation' }}</h3></div>
            <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div class="sm:col-span-2"><label class="label">{{ newType()==='PP' ? 'Nom et prénoms' : 'Raison sociale' }} *</label><input class="input" [(ngModel)]="newClient.raisonSociale" name="raison" maxlength="200" required></div>
              @if (newType()==='PM') {
                <div><label class="label">N° RCCM</label><input class="input font-mono" [(ngModel)]="newClient.rccm" name="rccm" maxlength="50" placeholder="RC/DLA/2025/B/XXXXX"></div>
                <div><label class="label">Forme juridique</label><select class="select" [(ngModel)]="newClient.formeJuridique" name="fj">
                  <option>SA</option><option>SARL</option><option>SAS</option><option>SCS</option><option>SCA</option><option>GIE</option><option>Autre</option>
                </select></div>
              }
              <div>
                <label class="label">Catégorie investisseur *</label>
                <select class="select" [(ngModel)]="newClient.categorie" name="cat">
                  <option value="NON_QUALIFIE">Non qualifié</option>
                  <option value="QUALIFIE">Qualifié</option>
                </select>
              </div>
              <div>
                <label class="label">Catégorie client *</label>
                <select class="select" [(ngModel)]="newClient.categorieClient" name="catcli">
                  @for (cc of categoriesClient; track cc) { <option [value]="cc">{{ cc }}</option> }
                </select>
              </div>
              <div>
                <label class="label">Type de compte-titres</label>
                <select class="select" [(ngModel)]="newClient.typeCompte" name="tc">
                  <option value="INDIVIDUEL">Individuel</option>
                  @if (newType()==='PM') {
                    <option value="JOINT">Joint</option>
                  } @else {
                    <option value="JOINT">Joint</option>
                    <option value="INDIVIS">Indivis</option>
                    <option value="DEMEMBRE">Démembré</option>
                    <option value="MINEUR">Mineur</option>
                    <option value="PROTEGE">Majeur protégé</option>
                  }
                </select>
              </div>
              <div><label class="label">Compte espèces (optionnel)</label><input class="input font-mono" [(ngModel)]="newClient.compteEspecesLie" name="ces" placeholder="Auto-généré si vide"></div>
              <div><label class="label">Solde initial (FCFA)</label><input class="input" type="number" [(ngModel)]="newClient.soldeEspecesInitial" name="solde" min="0"></div>
              <div><label class="label">Matricule</label><input class="input" [(ngModel)]="newClient.matricule" name="matr" maxlength="50"></div>
              <div><label class="label">Dirigeant</label><input class="input" [(ngModel)]="newClient.dirigeant" name="dir" maxlength="200"></div>
              <div><label class="label">Localisation</label><input class="input" [(ngModel)]="newClient.localisation" name="loc" maxlength="200"></div>
              <div><label class="label">Téléphone 2</label><input class="input" [(ngModel)]="newClient.telephone2" name="tel2" maxlength="30"></div>
              <div class="flex items-center gap-2 pt-6"><input type="checkbox" id="ncAssuj" [(ngModel)]="newClient.assujettiTaxes" name="assuj"><label for="ncAssuj" class="label mb-0">Assujetti aux taxes</label></div>
            </div>
          </div>

          <!-- Adresse -->
          <div class="card mb-4">
            <div class="card-header"><h3 class="font-semibold text-sm">{{ newType()==='PP' ? 'Adresse de domicile / fiscale' : 'Siège social' }}</h3></div>
            <div class="card-body grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label class="label">Type</label><select class="select" [(ngModel)]="newClient.adresse.type" name="atype">
                <option value="DOMICILE">Domicile</option>
                <option value="FISCALE">Fiscale</option>
                <option value="POSTALE">Postale</option>
                <option value="SIEGE">Siège</option>
              </select></div>
              <div><label class="label">Code postal / BP</label><input class="input" [(ngModel)]="newClient.adresse.codePostal" name="acp"></div>
              <div class="sm:col-span-2"><label class="label">Rue / Avenue</label><input class="input" [(ngModel)]="newClient.adresse.rue" name="arue"></div>
              <div><label class="label">Ville</label><input class="input" [(ngModel)]="newClient.adresse.ville" name="aville"></div>
              <div><label class="label">Pays</label><input class="input" [(ngModel)]="newClient.adresse.pays" name="apays"></div>
            </div>
          </div>

          <!-- Signataires -->
          <div class="card mb-4">
            <div class="card-header">
              <h3 class="font-semibold text-sm">
                {{ (newType()==='PM' || newClient.typeCompte==='JOINT') ? 'Signataires autorisés (1 à 4)' : 'Signataire unique' }}
              </h3>
              @if ((newType()==='PM' || newClient.typeCompte==='JOINT') && newClient.signataires.length < 4) {
                <button type="button" class="btn btn-outline text-xs" (click)="addSignataire()">+ Ajouter</button>
              }
            </div>
            <div class="card-body space-y-3">
              @if (newClient.typeCompte==='JOINT') {
                <p class="text-[11px] text-blue-700 bg-blue-50 rounded px-3 py-2">
                  Compte joint : chaque signataire disposant d'un e-mail recevra <b>ses propres identifiants</b>
                  et devra valider toute opération sur le compte (double signature).
                </p>
              }
              @for (s of newClient.signataires; track $index; let i = $index) {
                <div class="border rounded-lg p-3">
                  <div class="flex items-center justify-between mb-2">
                    <span class="badge bg-blue-100 text-blue-700 text-[10px]">
                      {{ (newType()==='PM' || newClient.typeCompte==='JOINT') ? 'TITULAIRE ' + (['A','B','C','D'][i] || (i+1)) : 'TITULAIRE' }}
                    </span>
                    @if ((newType()==='PM' || newClient.typeCompte==='JOINT') && newClient.signataires.length > 1) {
                      <button type="button" class="text-red-600 text-xs" (click)="removeSignataire(i)">Retirer</button>
                    }
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div><label class="label">Civilité</label><select class="select" [(ngModel)]="s.civilite" name="sciv{{i}}">
                      <option>Monsieur</option><option>Madame</option><option>Mademoiselle</option>
                    </select></div>
                    <div><label class="label">Fonction</label><input class="input" [(ngModel)]="s.fonction" name="sfn{{i}}" placeholder="Ex : DG, Trésorier"></div>
                    <div><label class="label">Nom *</label><input class="input" [(ngModel)]="s.nom" name="snom{{i}}" required></div>
                    <div><label class="label">Prénom</label><input class="input" [(ngModel)]="s.prenom" name="spr{{i}}"></div>
                    <div><label class="label">Téléphone portable *</label><input class="input" [(ngModel)]="s.telephonePortable" name="stel{{i}}" required></div>
                    <div><label class="label">E-mail *</label><input class="input" type="email" [(ngModel)]="s.email" name="sem{{i}}" required></div>
                    <div><label class="label">Pièce d'identité</label><select class="select" [(ngModel)]="s.pieceIdentite" name="spi{{i}}">
                      <option>CNI</option><option>Passeport</option><option>Carte de séjour</option>
                    </select></div>
                    <div><label class="label">N° pièce</label><input class="input font-mono" [(ngModel)]="s.numeroPiece" name="snp{{i}}"></div>
                  </div>
                </div>
              }
            </div>
          </div>

          <!-- Sous-comptes -->
          <div class="card mb-4">
            <div class="card-header">
              <h3 class="font-semibold text-sm">
                {{ newType()==='PP' ? 'Sous-compte titres unique' : 'Sous-comptes titres' }}
              </h3>
              @if (newType()==='PM') {
                <button type="button" class="btn btn-outline text-xs" (click)="addSousCompte()">+ Ajouter</button>
              }
            </div>
            <div class="card-body space-y-3">
              @for (sc of newClient.sousComptes; track $index; let i = $index) {
                <div class="border rounded-lg p-3">
                  <div class="flex items-center justify-between mb-2">
                    <span class="badge bg-purple-100 text-purple-700 text-[10px]">Sous-compte #{{ i+1 }}</span>
                    @if (newType()==='PM' && newClient.sousComptes.length > 1) {
                      <button type="button" class="text-red-600 text-xs" (click)="removeSousCompte(i)">Retirer</button>
                    }
                  </div>
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                    <div><label class="label">Numéro *</label><input class="input font-mono" [(ngModel)]="sc.numero" name="scnum{{i}}" required></div>
                    <div class="sm:col-span-2"><label class="label">Libellé</label><input class="input" [(ngModel)]="sc.libelle" name="sclib{{i}}"></div>
                    <div><label class="label">Type</label><select class="select" [(ngModel)]="sc.type" name="sctype{{i}}">
                      <option value="CONSERVATION">Conservation</option>
                      <option value="NANTISSEMENT">Nantissement</option>
                      <option value="GAGE">Gage</option>
                      <option value="SEQUESTRE">Séquestre</option>
                      <option value="TRANSIT">Transit</option>
                    </select></div>
                    <div><label class="label">Statut</label><select class="select" [(ngModel)]="sc.statut" name="scs{{i}}">
                      <option value="ACTIF">Actif</option>
                      <option value="BLOQUE">Bloqué</option>
                      <option value="CLOTURE">Clôturé</option>
                    </select></div>
                    <div><label class="label">Date ouverture</label><input class="input" type="date" [(ngModel)]="sc.dateOuverture" name="scd{{i}}"></div>
                    @if (sc.type === 'NANTISSEMENT' || sc.type === 'GAGE') {
                      <div class="sm:col-span-3"><label class="label">Observations</label><input class="input" [(ngModel)]="sc.observations" name="sco{{i}}" placeholder="Bénéficiaire, dossier crédit…"></div>
                    }
                  </div>
                </div>
              }
            </div>
          </div>

          @if (createError()) {
            <div class="mb-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">
              ⚠️ {{ createError() }}
            </div>
          }

          <div class="flex flex-col-reverse sm:flex-row gap-2 mt-4 pt-4 border-t">
            <button class="btn btn-outline sm:flex-1" (click)="createOpen.set(false)">Annuler</button>
            <button class="btn btn-primary sm:flex-1" (click)="doCreate()">Créer le client</button>
          </div>
        </div>
      </afb-modal>

      <!-- Identifiants initiaux du client (à communiquer) -->
      @if (initialCreds()) {
        <div class="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" (click)="initialCreds.set(null)">
          <div class="card w-full max-w-md" (click)="$event.stopPropagation()">
            <div class="card-header"><h2 class="font-semibold">Identifiants de connexion du client</h2></div>
            <div class="card-body space-y-3 text-sm">
              <p class="text-gray-600">Communiquez ces identifiants au client. Il devra changer le mot de passe à sa première connexion.</p>
              @if (initialCreds()!.email) {
                <div>
                  <label class="label">Identifiant (e-mail)</label>
                  <input class="input font-mono" [value]="initialCreds()!.email" readonly (focus)="$any($event.target).select()">
                </div>
              }
              <div>
                <label class="label">Mot de passe initial</label>
                <div class="flex gap-2">
                  <input class="input flex-1 font-mono" [value]="initialCreds()!.password" readonly (focus)="$any($event.target).select()">
                  <button class="btn btn-outline whitespace-nowrap" (click)="copyInitialPassword()">Copier</button>
                </div>
              </div>
              <p class="text-[11px] text-gray-500">Ce mot de passe reste consultable depuis le dossier du client tant qu'il ne l'a pas changé.</p>
            </div>
            <div class="card-body flex justify-end border-t">
              <button class="btn btn-primary" (click)="initialCreds.set(null)">Fermer</button>
            </div>
          </div>
        </div>
      }

      <!-- Modifier client ─────────────────────────────────────── -->
      <afb-modal [open]="editOpen()" size="2xl" (cancel)="editOpen.set(false)">
        <div class="p-4 sm:p-6 overflow-y-auto">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div>
              <div class="text-xs text-gray-500">Modifier le client</div>
              <h2 class="text-lg font-bold">{{ editType() === 'PM' ? 'Personne morale' : 'Personne physique' }}</h2>
            </div>
            <button class="btn btn-ghost text-xl" (click)="editOpen.set(false)">✕</button>
          </div>
          @if (editError()) { <div class="mb-3 text-sm text-red-600 bg-red-50 rounded-lg p-2">{{ editError() }}</div> }
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="sm:col-span-2">
              <label class="label">{{ editType()==='PM' ? 'Raison sociale' : 'Nom et prénom' }} *</label>
              <input class="input" [(ngModel)]="editClient.raisonSociale" name="eRs" required>
            </div>
            @if (editType()==='PM') {
              <div class="sm:col-span-2">
                <label class="label">RCCM</label>
                <input class="input font-mono" [(ngModel)]="editClient.rccm" name="eRccm">
              </div>
            }
            <div>
              <label class="label">Catégorie investisseur</label>
              <select class="select" [(ngModel)]="editClient.categorie" name="eCat">
                <option value="NON_QUALIFIE">Non qualifié</option>
                <option value="QUALIFIE">Qualifié</option>
              </select>
            </div>
            <div>
              <label class="label">Catégorie client</label>
              <select class="select" [(ngModel)]="editClient.categorieClient" name="eCatCli">
                @for (cc of categoriesClient; track cc) { <option [value]="cc">{{ cc }}</option> }
              </select>
            </div>
            <div><label class="label">Matricule</label><input class="input" [(ngModel)]="editClient.matricule" name="eMatr" maxlength="50"></div>
            <div><label class="label">Dirigeant</label><input class="input" [(ngModel)]="editClient.dirigeant" name="eDir" maxlength="200"></div>
            <div><label class="label">Localisation</label><input class="input" [(ngModel)]="editClient.localisation" name="eLoc" maxlength="200"></div>
            <div><label class="label">Téléphone 2</label><input class="input" [(ngModel)]="editClient.telephone2" name="eTel2" maxlength="30"></div>
            <div class="flex items-center gap-2 pt-6"><input type="checkbox" id="eAssuj" [(ngModel)]="editClient.assujettiTaxes" name="eAssuj"><label for="eAssuj" class="label mb-0">Assujetti aux taxes</label></div>
            <div>
              <label class="label">Statut</label>
              <select class="select" [(ngModel)]="editClient.statut" name="eSt">
                <option value="ACTIF">Actif</option>
                <option value="BLOQUE">Bloqué</option>
                <option value="SUSPENDU">Suspendu</option>
                <option value="CLOTURE">Clôturé</option>
              </select>
            </div>
            <!-- Contact principal -->
            <div class="sm:col-span-2 border-t pt-3 mt-1"><div class="text-xs font-semibold text-gray-500 uppercase">Contact principal</div></div>
            <div>
              <label class="label">Nom *</label>
              <input class="input" [(ngModel)]="editClient.nom" name="eNom" required>
            </div>
            <div>
              <label class="label">Prénom</label>
              <input class="input" [(ngModel)]="editClient.prenom" name="ePrenom">
            </div>
            <div>
              <label class="label">Téléphone</label>
              <input class="input" [(ngModel)]="editClient.telephonePortable" name="eTel">
            </div>
            <div>
              <label class="label">E-mail</label>
              <input class="input" type="email" [(ngModel)]="editClient.email" name="eMail">
            </div>
            <!-- Adresse -->
            <div class="sm:col-span-2 border-t pt-3 mt-1"><div class="text-xs font-semibold text-gray-500 uppercase">Adresse</div></div>
            <div class="sm:col-span-2">
              <label class="label">Rue</label>
              <input class="input" [(ngModel)]="editClient.adresse.rue" name="eRue">
            </div>
            <div>
              <label class="label">Ville</label>
              <input class="input" [(ngModel)]="editClient.adresse.ville" name="eVille">
            </div>
            <div>
              <label class="label">Code postal</label>
              <input class="input" [(ngModel)]="editClient.adresse.codePostal" name="eCp">
            </div>
            <div class="sm:col-span-2">
              <label class="label">Pays</label>
              <input class="input" [(ngModel)]="editClient.adresse.pays" name="ePays">
            </div>
          </div>
          <div class="flex flex-col-reverse sm:flex-row gap-2 mt-6">
            <button class="btn btn-outline sm:flex-1" (click)="editOpen.set(false)">Annuler</button>
            <button class="btn btn-primary sm:flex-1" (click)="doEdit()">Enregistrer</button>
          </div>
        </div>
      </afb-modal>

      <!-- Confirmation de désactivation -->
      <afb-confirm-dialog [open]="confirmOpen()" [danger]="true"
        title="Désactiver ce client ?"
        message="Le compte sera clôturé et l'accès suspendu. L'historique (ordres, positions, documents) est conservé. L'opération est réversible : repassez le statut à « Actif » pour le réactiver."
        confirmLabel="Désactiver"
        (confirm)="doDeactivate()" (cancel)="confirmOpen.set(false)" />
    </div>
  `
})
export class BoClients {
  data = inject(MockData);
  toast = inject(ToastService);

  /** Un numéro manquant s'affiche « Non renseigné » plutôt que vide. */
  readonly afficherCompte = afficherCompte;

  /**
   * Vert quand compte-titres ET compte espèces sont renseignés, rouge sinon.
   * Un client auto-inscrit arrive avec son seul compte espèces : il apparaît
   * donc en rouge tant qu'un agent ne lui a pas attribué de compte-titres.
   */
  classeComptes(c: { compte: { numero?: string; compteEspecesLie?: string } }): string {
    return classeEtatComptes(c.compte.numero, c.compte.compteEspecesLie);
  }
  private readonly api = inject(ApiService);
  /** Recharge le registre des dossiers clients depuis la base. */
  constructor() { this.data.refreshClients(); }
  show = signal(false);
  sel = signal<any>(null);
  page = signal(1);
  fSearch = signal('');
  fType = signal('');
  fCat = signal('');
  fStatut = signal('');

  countPm = computed(() => this.data.clientsRegistry().filter(c => c.type === 'PM').length);
  filtered = computed(() => {
    const q = this.fSearch().trim().toLowerCase();
    return this.data.clientsRegistry().filter(c =>
      (!q || c.id.toLowerCase().includes(q) || c.raisonSociale.toLowerCase().includes(q) || c.compte.numero.toLowerCase().includes(q)) &&
      (!this.fType() || c.type === this.fType()) &&
      (!this.fCat() || c.compte.categorie === this.fCat()) &&
      (!this.fStatut() || c.compte.statut === this.fStatut())
    );
  });
  resetFilters() { this.fSearch.set(''); this.fType.set(''); this.fCat.set(''); this.fStatut.set(''); }

  /** Ouvre le dossier d'un client. */
  open(c: any) {
    this.sel.set(c);
    this.show.set(true);
  }

  // ── Création client ─────────────────────────────────────
  createOpen = signal(false);
  createError = signal('');
  /** Catégories client (segment métier) proposées dans les menus — liste figée. */
  readonly categoriesClient: CategorieClient[] = CATEGORIES_CLIENT;
  newType = signal<'PP' | 'PM'>('PP');
  newClient: any = this.blankClient('PP');

  blankClient(type: 'PP' | 'PM'): any {
    return {
      raisonSociale: '',
      rccm: type === 'PM' ? '' : undefined,
      formeJuridique: type === 'PM' ? 'SA' : undefined,
      categorie: 'NON_QUALIFIE',
      // Catégorie métier : défaut selon le type de personne (PP/PM).
      categorieClient: type === 'PM' ? 'Personne morale' : 'Personnes physiques',
      matricule: '',
      // Formule d'adresse portée sur les documents : défaut PP=Monsieur, PM=Directeur.
      dirigeant: type === 'PM' ? 'Directeur' : 'Monsieur',
      assujettiTaxes: false,
      localisation: '',
      telephone2: '',
      typeCompte: 'INDIVIDUEL',
      compteEspecesLie: '',
      soldeEspecesInitial: 0,
      adresse: { type: type === 'PM' ? 'SIEGE' : 'DOMICILE', rue: '', codePostal: '', ville: '', pays: 'Cameroun' },
      signataires: [{ type: 'TITULAIRE', civilite: 'Monsieur', nom: '', prenom: '', fonction: '', telephonePortable: '', email: '', pieceIdentite: 'CNI', numeroPiece: '' }],
      sousComptes: [{ numero: '', libelle: 'Conservation principale', type: 'CONSERVATION', statut: 'ACTIF', dateOuverture: new Date().toISOString().slice(0, 10), positionsCount: 0, valeurTotale: 0, observations: '' }],
    };
  }
  openCreate() {
    this.newType.set('PP');
    this.newClient = this.blankClient('PP');
    this.createError.set('');
    this.createOpen.set(true);
  }
  setType(t: 'PP' | 'PM') {
    this.newType.set(t);
    this.newClient = this.blankClient(t);
    this.createError.set('');
  }
  addSignataire() {
    if (this.newClient.signataires.length >= 4) return;
    this.newClient.signataires.push({ type: 'TITULAIRE', civilite: 'Monsieur', nom: '', prenom: '', fonction: '', telephonePortable: '', email: '', pieceIdentite: 'CNI', numeroPiece: '' });
  }
  removeSignataire(i: number) {
    if (this.newClient.signataires.length <= 1) return;
    this.newClient.signataires.splice(i, 1);
  }
  addSousCompte() {
    this.newClient.sousComptes.push({ numero: '', libelle: '', type: 'CONSERVATION', statut: 'ACTIF', dateOuverture: new Date().toISOString().slice(0, 10), positionsCount: 0, valeurTotale: 0, observations: '' });
  }
  removeSousCompte(i: number) {
    if (this.newClient.sousComptes.length <= 1) return;
    this.newClient.sousComptes.splice(i, 1);
  }
  doCreate() {
    this.createError.set('');
    // Validation client-side — seuls le nom, le téléphone, l'e-mail (identifiant
    // de connexion) et le numéro de sous-compte sont obligatoires. Le reste est
    // facultatif.
    const first = this.newClient.signataires[0] ?? {};
    if (!this.newClient.raisonSociale?.trim()) {
      this.createError.set(this.newType() === 'PM' ? 'La raison sociale est obligatoire.' : 'Le nom est obligatoire.');
      return;
    }
    if (!first.nom?.trim()) { this.createError.set('Le nom du 1er signataire est obligatoire.'); return; }
    if (!first.telephonePortable?.trim()) { this.createError.set('Le numéro de téléphone du 1er signataire est obligatoire.'); return; }
    const loginEmail = (first.email ?? '').trim();
    if (!loginEmail.includes('@')) { this.createError.set("L'e-mail du 1er signataire (identifiant de connexion) est obligatoire."); return; }
    if (!this.newClient.sousComptes?.length || !this.newClient.sousComptes.every((sc: any) => sc.numero?.trim())) {
      this.createError.set('Chaque sous-compte titres doit avoir un numéro.');
      return;
    }
    this.data.createClientDossier({
      type: this.newType(),
      raisonSociale: this.newClient.raisonSociale,
      rccm: this.newClient.rccm,
      categorie: this.newClient.categorie,
      categorieClient: this.newClient.categorieClient,
      matricule: this.newClient.matricule?.trim() || undefined,
      dirigeant: this.newClient.dirigeant?.trim() || undefined,
      assujettiTaxes: this.newClient.assujettiTaxes,
      localisation: this.newClient.localisation?.trim() || undefined,
      telephone2: this.newClient.telephone2?.trim() || undefined,
      typeCompte: this.newClient.typeCompte,
      adresse: this.newClient.adresse,
      signataires: this.newClient.signataires.map((s: any) => ({
        id: '',
        type: 'TITULAIRE',
        nom: (s.nom ?? '').trim(),
        prenom: (s.prenom ?? '').trim() || undefined,
        civilite: s.civilite,
        fonction: s.fonction,
        telephonePortable: s.telephonePortable,
        email: s.email,
        pieceIdentite: s.pieceIdentite,
        numeroPiece: s.numeroPiece,
      })),
      sousComptes: this.newClient.sousComptes,
      compteEspecesLie: this.newClient.compteEspecesLie,
      soldeEspecesInitial: Number(this.newClient.soldeEspecesInitial) || 0,
    }).subscribe((res) => {
      if (!res.ok || !res.client) {
        this.createError.set(res.error || 'Création impossible.');
        return;
      }
      this.createOpen.set(false);
      // Récupère le VRAI mot de passe initial (chiffré côté serveur) pour le
      // communiquer au client. Affiché tant qu'il n'a pas été changé.
      const uid = (res.client as any).id;
      this.api.getInitialPassword(uid).subscribe({
        next: (r) => this.initialCreds.set({ email: loginEmail, password: r.password ?? '(indisponible)' }),
        error: () => this.toast.success('Client créé',
          `${res.client?.raisonSociale} — connexion : ${loginEmail}. Mot de passe envoyé par e-mail/SMS.`),
      });
    });
  }

  /** Identifiants à afficher après création (ou consultation) d'un client. */
  initialCreds = signal<{ email: string; password: string } | null>(null);

  /** Consulte le mot de passe initial d'un client existant (tant qu'inchangé). */
  viewInitialPassword(c: { compte?: { id?: string }; id?: string; raisonSociale?: string }) {
    const uid = (c as any).id ?? c.compte?.id;
    if (!uid) return;
    this.api.getInitialPassword(uid).subscribe({
      next: (r) => {
        if (r.available && r.password) {
          this.initialCreds.set({ email: (c as any).email ?? '', password: r.password });
        } else {
          this.toast.info('Indisponible', 'Le mot de passe initial a déjà été changé par le client.');
        }
      },
      error: () => this.toast.error('Erreur', 'Consultation impossible.'),
    });
  }

  copyInitialPassword() {
    const p = this.initialCreds()?.password;
    if (!p) return;
    navigator.clipboard.writeText(p).then(
      () => this.toast.success('Copié', 'Mot de passe copié.'),
      () => this.toast.error('Erreur', 'Copie impossible.'),
    );
  }

  // ── Modification client ──────────────────────────────────
  editOpen = signal(false);
  editError = signal('');
  editId = signal('');
  editType = signal<'PP' | 'PM'>('PP');
  editClient: any = { adresse: {} };

  /** Préremplit le formulaire d'édition à partir du dossier (infos de base). */
  openEdit(c: any) {
    const contact = c?.compte?.contacts?.[0] ?? {};
    const adr = c?.compte?.adresses?.[0] ?? {};
    this.editId.set(c.id);
    this.editType.set(c.type === 'PM' ? 'PM' : 'PP');
    this.editClient = {
      raisonSociale: c.raisonSociale ?? '',
      rccm: c.rccm ?? '',
      categorie: c.compte?.categorie ?? 'NON_QUALIFIE',
      categorieClient: c.categorieClient ?? (c.type === 'PM' ? 'Personne morale' : 'Personnes physiques'),
      matricule: c.matricule ?? '',
      dirigeant: c.dirigeant ?? (c.type === 'PM' ? 'Directeur' : 'Monsieur'),
      assujettiTaxes: c.assujettiTaxes ?? false,
      localisation: c.localisation ?? '',
      telephone2: c.telephone2 ?? '',
      statut: c.compte?.statut ?? 'ACTIF',
      nom: contact.nom ?? '',
      prenom: contact.prenom ?? '',
      telephonePortable: contact.telephonePortable ?? '',
      email: contact.email ?? '',
      adresse: {
        rue: adr.rue ?? '',
        codePostal: adr.codePostal ?? '',
        ville: adr.ville ?? '',
        pays: adr.pays ?? 'Cameroun',
      },
    };
    this.editError.set('');
    this.editOpen.set(true);
  }

  doEdit() {
    this.editError.set('');
    const e = this.editClient;
    if (!e.raisonSociale?.trim()) {
      this.editError.set(this.editType() === 'PM' ? 'La raison sociale est obligatoire.' : 'Le nom est obligatoire.');
      return;
    }
    if (!e.nom?.trim()) { this.editError.set('Le nom du contact est obligatoire.'); return; }
    const email = (e.email ?? '').trim();
    if (email && !email.includes('@')) { this.editError.set("L'e-mail est invalide."); return; }
    const body = {
      raisonSociale: e.raisonSociale.trim(),
      rccm: e.rccm?.trim() || undefined,
      categorie: e.categorie,
      categorieClient: e.categorieClient || undefined,
      matricule: e.matricule?.trim() || undefined,
      dirigeant: e.dirigeant?.trim() || undefined,
      assujettiTaxes: e.assujettiTaxes,
      localisation: e.localisation?.trim() || undefined,
      telephone2: e.telephone2?.trim() || undefined,
      statut: e.statut,
      nom: e.nom.trim(),
      prenom: e.prenom?.trim() || undefined,
      telephonePortable: e.telephonePortable?.trim() || undefined,
      email: email || undefined,
      adresse: e.adresse?.rue?.trim() ? e.adresse : undefined,
    };
    this.api.updateClient(this.editId(), body).subscribe({
      next: (d) => {
        this.editOpen.set(false);
        this.data.refreshClients();
        if (this.sel()?.id === d.id) this.sel.set(d);
        this.toast.success('Client modifié', d.raisonSociale);
      },
      error: (err) => this.editError.set(err?.error?.message || err?.error?.error || 'Modification impossible.'),
    });
  }

  // ── Désactivation (réversible) ───────────────────────────
  confirmOpen = signal(false);
  private readonly confirmTarget = signal<any>(null);

  askDeactivate(c: any) {
    this.confirmTarget.set(c);
    this.confirmOpen.set(true);
  }

  doDeactivate() {
    const c = this.confirmTarget();
    if (!c) { this.confirmOpen.set(false); return; }
    this.api.deactivateClient(c.id).subscribe({
      next: (d) => {
        this.confirmOpen.set(false);
        this.show.set(false);
        this.data.refreshClients();
        this.toast.success('Client désactivé', `${d.raisonSociale} — compte clôturé (réversible).`);
      },
      error: (err) => {
        this.confirmOpen.set(false);
        this.toast.error('Échec', err?.error?.message || err?.error?.error || 'Désactivation impossible.');
      },
    });
  }
}

/* ====================== AUDIT — CSFT §M6-S04 ====================== */
interface AuditAnchorInfo {
  network: string;
  anchoredAt: string;
  entryCount: number;
  txHash: string;
}

interface AuditIntegrityStatus {
  intacte: boolean;
  entreesVerifiees: number;
  sequenceRupture: number;
  tipActuel: string;
  dernierAncrage: AuditAnchorInfo | null;
  entreesNonAncrees: number;
}

@Component({
  selector: 'afb-bo-audit',
  imports: [FormsModule, Paginator, PaginatePipe],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Journal d'audit (immuable)</h1>
          <p class="text-sm text-gray-500">CSFT §M6-S04 — Conservation minimum 7 ans · Logs non modifiables</p>
        </div>
        <button class="btn btn-outline" (click)="exportCsv()">⬇ Exporter CSV</button>
      </div>

      @if (integrite(); as i) {
        <div class="card mb-4 p-4">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div class="flex items-center gap-2">
              @if (i.intacte) {
                <span class="badge bg-emerald-100 text-emerald-700 text-xs">✓ Chaîne intacte</span>
              } @else {
                <span class="badge bg-red-100 text-red-700 text-xs">⚠ Rupture détectée (entrée n°{{ i.sequenceRupture }})</span>
              }
              <span class="text-xs text-gray-500">{{ i.entreesVerifiees }} entrée(s) vérifiée(s) par recalcul du chaînage de hash</span>
            </div>
          </div>
          <p class="text-[11px] text-gray-400 mt-1 font-mono break-all">tip : {{ i.tipActuel }}</p>
          @if (i.dernierAncrage; as d) {
            <p class="text-[11px] text-gray-500 mt-2">
              Dernier ancrage on-chain ({{ d.network }}) : {{ d.anchoredAt }} — {{ d.entryCount }} entrée(s),
              @if (i.entreesNonAncrees > 0) {
                <span class="text-amber-600">{{ i.entreesNonAncrees }} entrée(s) depuis, pas encore ancrée(s)</span>
              } @else {
                <span class="text-emerald-600">à jour</span>
              }
              <br>
              <span class="font-mono break-all">tx : {{ d.txHash }}</span>
              @if (d.network === 'sepolia') {
                · <a class="text-afb-red underline" [href]="'https://sepolia.etherscan.io/tx/' + d.txHash" target="_blank" rel="noopener">voir sur Etherscan</a>
              }
            </p>
          } @else {
            <p class="text-[11px] text-amber-600 mt-2">Aucun ancrage on-chain pour l'instant — exécutez le script Hardhat (dossier blockchain/).</p>
          }
        </div>
      }

      <div class="card mb-4">
        <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div class="lg:col-span-2">
            <label class="label">Recherche</label>
            <input class="input" placeholder="🔍 Utilisateur, action, référence…" [ngModel]="fSearch()" (ngModelChange)="fSearch.set($event); page.set(1)" name="audq">
          </div>
          <div>
            <label class="label">Résultat</label>
            <select class="select" [ngModel]="fRes()" (ngModelChange)="fRes.set($event); page.set(1)" name="audr">
              <option value="">Tous</option>
              <option value="SUCCES">Succès</option>
              <option value="ECHEC">Échec</option>
            </select>
          </div>
          <div>
            <label class="label">Date du</label>
            <input class="input" type="date" [ngModel]="fDateDu()" (ngModelChange)="fDateDu.set($event); page.set(1)" name="audu">
          </div>
          <div>
            <label class="label">Date au</label>
            <input class="input" type="date" [ngModel]="fDateAu()" (ngModelChange)="fDateAu.set($event); page.set(1)" name="auau">
          </div>
        </div>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto"><table class="table min-w-[720px] sm:min-w-full">
          <thead><tr><th>Horodatage</th><th>Utilisateur</th><th>Action</th><th>Référence</th><th>IP</th><th>Résultat</th></tr></thead>
          <tbody>
            @for (a of (filtered() | paginate:page():25); track a.id) {
              <tr>
                <td class="font-mono text-xs">{{ a.horodatage }}</td>
                <td class="text-xs">
                  <div class="font-medium">{{ a.utilisateurNom || a.utilisateur }}</div>
                  @if (a.utilisateurNom) {
                    <div class="text-[10px] text-gray-400">{{ a.utilisateurRole }} · {{ a.utilisateur }}</div>
                  }
                </td>
                <td class="text-sm">{{ a.action }}</td>
                <td class="font-mono text-xs">{{ a.reference }}</td>
                <td class="font-mono text-xs">{{ a.ip }}</td>
                <td>
                  @if (a.resultat === 'SUCCES') { <span class="badge bg-emerald-100 text-emerald-700">✓ {{ a.resultat }}</span> }
                  @else { <span class="badge bg-red-100 text-red-700">✕ {{ a.resultat }}</span> }
                </td>
              </tr>
            }
            @if (!filtered().length) {
              <tr><td colspan="6" class="text-center py-12 text-gray-400 text-sm">Aucun événement ne correspond aux filtres</td></tr>
            }
          </tbody>
        </table></div>
        <afb-paginator [total]="filtered().length" [pageSize]="25" [(page)]="page" />
      </div>
    </div>
  `
})
export class BoAudit {
  data = inject(MockData);
  toast = inject(ToastService);
  private readonly http = inject(HttpClient);
  page = signal(1);
  readonly integrite = signal<AuditIntegrityStatus | null>(null);

  constructor() {
    this.data.refreshAudit();
    this.http.get<AuditIntegrityStatus>('/api/v1/audit/integrity').subscribe({
      next: (i) => this.integrite.set(i),
      error: () => this.integrite.set(null),
    });
  }
  fSearch = signal('');
  fRes = signal('');
  fDateDu = signal('');
  fDateAu = signal('');
  filtered = computed(() => {
    const q = this.fSearch().trim().toLowerCase();
    return this.data.audit().filter(a =>
      (!q || a.utilisateur.toLowerCase().includes(q) || (a.utilisateurNom ?? '').toLowerCase().includes(q) || a.action.toLowerCase().includes(q) || a.reference.toLowerCase().includes(q)) &&
      (!this.fRes() || a.resultat === this.fRes()) &&
      (!this.fDateDu() || a.horodatage.slice(0, 10) >= this.fDateDu()) &&
      (!this.fDateAu() || a.horodatage.slice(0, 10) <= this.fDateAu())
    );
  });
  exportCsv() {
    const csv = arrayToCsv(this.filtered().map(a => ({
      horodatage: a.horodatage, utilisateur: a.utilisateurNom || a.utilisateur,
      identifiant: a.utilisateur, action: a.action,
      reference: a.reference, ip: a.ip, resultat: a.resultat
    })));
    downloadBlob('audit-log.csv', csv, 'text/csv');
    this.toast.success('Audit exporté', `${this.filtered().length} entrée(s)`);
  }
}
