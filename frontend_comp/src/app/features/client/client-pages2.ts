import { Component, OnDestroy, computed, inject, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, NgClass } from '@angular/common';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';
import { OtpDialog } from '../../shared/dialogs';
import { Paginator, PaginatePipe } from '../../shared/pagination';
import { DocumentType, DOCUMENT_TYPE_LABELS, Notification } from '../../core/models/models';
import { relativeTime } from '../../shared/time';

@Component({
  selector: 'afb-portfolio',
  imports: [DecimalPipe, OtpDialog, Paginator, PaginatePipe],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Mon portefeuille</h1>
          <p class="text-sm text-gray-500">Vos positions en titres</p>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <div class="kpi"><span class="kpi-label">Valeur totale portefeuille</span><span class="kpi-value">{{ total() | number:'1.0-0':'fr-FR' }} FCFA</span></div>
        <div class="kpi"><span class="kpi-label">Lignes actives</span><span class="kpi-value">{{ data.positions().length }}</span></div>
        <div class="kpi"><span class="kpi-label">Prochain flux</span><span class="kpi-value">{{ prochain() | number:'1.0-0':'fr-FR' }} FCFA</span><span class="text-xs text-gray-400">Coupon / remboursement à venir</span></div>
      </div>

      <div class="card overflow-hidden">
        <div class="overflow-x-auto"><table class="table min-w-[720px] sm:min-w-full">
          <thead>
            <tr>
              <th>ISIN · Émission</th><th>Nature</th><th>Émetteur</th><th>Volume</th><th>Valeur nominale</th><th>Valeur totale</th><th>Échéance</th><th>Prochain flux</th>
            </tr>
          </thead>
          <tbody>
            @for (p of (data.positions() | paginate:positionsPage():25); track (p.isin + '|' + (p.sousCompteId ?? $index))) {
              <tr>
                <td>
                  <div class="font-mono text-xs">{{ p.isin }}</div>
                  <div class="font-semibold text-xs text-gray-600">{{ p.emissionCode }}</div>
                </td>
                <td><span class="badge" [class.bg-blue-100]="p.nature==='BTA'" [class.text-blue-700]="p.nature==='BTA'" [class.bg-purple-100]="p.nature==='OTA'" [class.text-purple-700]="p.nature==='OTA'">{{ p.nature }}</span></td>
                <td>{{ p.emetteur }}</td>
                <td>{{ p.volume }}</td>
                <td>{{ p.valeurNominale | number:'1.0-0':'fr-FR' }}</td>
                <td class="font-semibold">{{ p.valeurTotale | number:'1.0-0':'fr-FR' }}</td>
                <td class="text-xs">{{ p.dateEcheance }}</td>
                <td class="text-xs">
                  <div class="font-medium">{{ p.prochainFlux?.montant | number:'1.0-0':'fr-FR' }} FCFA</div>
                  <div class="text-gray-500">{{ p.prochainFlux?.type }} · {{ p.prochainFlux?.date }}</div>
                </td>
              </tr>
            }
          </tbody>
        </table></div>
        <afb-paginator [total]="data.positions().length" [pageSize]="25" [(page)]="positionsPage" />
      </div>
    </div>
  `
})
export class Portfolio {
  data = inject(MockData);
  toast = inject(ToastService);
  /** Recharge les positions depuis la BD à l'ouverture — montants par client. */
  constructor() { this.data.refreshPositions(); }
  otpOpen = signal(false);
  generating = signal(false);
  positionsPage = signal(1);
  total = computed(() => this.data.positions().reduce((s, p) => s + p.valeurTotale, 0));
  prochain = computed(() => this.data.positions().reduce((s, p) => s + (p.prochainFlux?.montant ?? 0), 0));
  askGenerate() { this.otpOpen.set(true); }
  doGenerate() {
    this.otpOpen.set(false);
    if (this.generating()) return;
    this.generating.set(true);
    // Le PDF est édité par le serveur depuis les positions en base : rien n'est
    // fabriqué ici, et le livrable retourné est celui réellement enregistré.
    this.data.generateAttestation().subscribe({
      next: d => {
        this.generating.set(false);
        this.toast.success('Attestation générée', `${d.reference} est disponible dans « Mes documents ».`);
      },
      error: (e: unknown) => {
        this.generating.set(false);
        const msg = (e as { error?: { message?: string } })?.error?.message
          ?? "L'attestation n'a pas pu être éditée. Réessayez.";
        this.toast.error('Génération impossible', msg);
      },
    });
  }
}

@Component({
  selector: 'afb-notifications',
  imports: [NgClass],
  template: `
    <div class="max-w-3xl mx-auto">
      <!-- En-tête -->
      <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold mb-1">Notifications</h1>
          <p class="text-sm text-gray-500">Suivi de vos ordres et alertes du marché</p>
        </div>
        <button class="btn btn-outline text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                [disabled]="unread() === 0" (click)="markAllRead()">✓ Tout marquer comme lu</button>
      </div>

      <!-- Filtres -->
      <div class="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 mb-5 text-sm">
        <button class="px-3 py-1.5 rounded-md transition"
                [class.bg-white]="filter()==='all'" [class.shadow-sm]="filter()==='all'"
                [class.font-semibold]="filter()==='all'" [class.text-gray-500]="filter()!=='all'"
                (click)="setFilter('all')">Toutes ({{ data.notifications().length }})</button>
        <button class="px-3 py-1.5 rounded-md transition flex items-center gap-1.5"
                [class.bg-white]="filter()==='unread'" [class.shadow-sm]="filter()==='unread'"
                [class.font-semibold]="filter()==='unread'" [class.text-gray-500]="filter()!=='unread'"
                (click)="setFilter('unread')">
          Non lues
          @if (unread() > 0) { <span class="bg-afb-red text-white text-[10px] rounded-full px-1.5 leading-5">{{ unread() }}</span> }
        </button>
      </div>

      <!-- Liste -->
      <div class="space-y-2.5">
        @for (n of pageItems(); track n.id) {
          <div class="group relative flex gap-3 rounded-xl bg-white shadow-sm p-3.5 transition hover:shadow-md border-l-4"
               [ngClass]="accentClass(n.type)" (click)="onItemClick(n)">
            @if (!n.lu) { <span class="absolute right-3.5 top-3.5 w-2 h-2 rounded-full bg-afb-red"></span> }
            <div class="shrink-0 w-9 h-9 rounded-full grid place-items-center text-base" [ngClass]="iconWrapClass(n.type)">{{ icon(n.type) }}</div>
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline justify-between gap-2">
                <div class="text-[15px] text-gray-900 truncate pr-4" [class.font-bold]="!n.lu" [class.font-semibold]="n.lu">{{ n.titre }}</div>
                <div class="text-[11px] text-gray-400 shrink-0 whitespace-nowrap" [title]="n.date">{{ rel(n.date) }}</div>
              </div>
              <p class="text-sm text-gray-600 mt-0.5 whitespace-pre-wrap leading-relaxed">{{ n.message }}</p>
              <div class="flex items-center gap-1.5 mt-2">
                @for (c of n.canal; track c) {
                  <span class="text-[10px] uppercase tracking-wide text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{{ canalLabel(c) }}</span>
                }
                <span class="flex-1"></span>
                @if (!n.lu) {
                  <button class="text-[11px] text-afb-red font-medium opacity-0 group-hover:opacity-100 transition"
                          (click)="markRead(n, $event)">Marquer comme lu</button>
                }
              </div>
            </div>
          </div>
        }

        @if (!pageItems().length) {
          <div class="rounded-xl border border-dashed border-gray-200 p-12 text-center text-gray-400">
            <div class="text-4xl mb-2">{{ filter()==='unread' ? '✅' : '📭' }}</div>
            <div class="text-sm">{{ filter()==='unread' ? 'Aucune notification non lue' : 'Aucune notification pour le moment' }}</div>
          </div>
        }
      </div>

      @if (totalPages() > 1) {
        <div class="flex items-center justify-center gap-2 mt-5 text-sm">
          <button class="btn btn-outline" [disabled]="page() === 1" (click)="page.set(page() - 1)">‹ Précédent</button>
          <span class="px-2 text-gray-500">Page {{ page() }} / {{ totalPages() }}</span>
          <button class="btn btn-outline" [disabled]="page() === totalPages()" (click)="page.set(page() + 1)">Suivant ›</button>
        </div>
      }
    </div>
  `
})
export class Notifications {
  data = inject(MockData);
  page = signal(1);
  filter = signal<'all' | 'unread'>('all');
  private readonly PAGE_SIZE = 10;

  unread = computed(() => this.data.notifications().filter(n => !n.lu).length);
  filtered = computed(() => {
    const f = this.filter();
    return this.data.notifications().filter(n => f === 'all' || !n.lu);
  });
  totalPages = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.PAGE_SIZE)));
  pageItems = computed(() => {
    const start = (Math.min(this.page(), this.totalPages()) - 1) * this.PAGE_SIZE;
    return this.filtered().slice(start, start + this.PAGE_SIZE);
  });

  setFilter(f: 'all' | 'unread') { this.filter.set(f); this.page.set(1); }
  rel(d: string) { return relativeTime(d); }
  markAllRead() { this.data.markAllNotificationsRead(); }
  markRead(n: Notification, ev?: Event) { ev?.stopPropagation(); if (!n.lu) this.data.markNotificationRead(n.id); }
  onItemClick(n: Notification) { if (!n.lu) this.data.markNotificationRead(n.id); }

  icon(t: Notification['type']) {
    return ({ INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌' } as Record<string, string>)[t] ?? '🔔';
  }
  accentClass(t: Notification['type']) {
    return ({ INFO: 'border-l-red-500', SUCCESS: 'border-l-emerald-500', WARN: 'border-l-amber-500', ERROR: 'border-l-red-500' } as Record<string, string>)[t] ?? 'border-l-gray-300';
  }
  iconWrapClass(t: Notification['type']) {
    return ({ INFO: 'bg-red-50', SUCCESS: 'bg-emerald-50', WARN: 'bg-amber-50', ERROR: 'bg-red-50' } as Record<string, string>)[t] ?? 'bg-gray-100';
  }
  canalLabel(c: string) {
    return ({ EMAIL: 'E-mail', SMS: 'SMS', WHATSAPP: 'WhatsApp', IN_APP: 'In-app' } as Record<string, string>)[c] ?? c;
  }
}

@Component({
  selector: 'afb-profile',
  imports: [FormsModule, DecimalPipe, Paginator, PaginatePipe],
  template: `
    <div>
      <h1 class="text-xl sm:text-2xl font-bold mb-1">Mon compte</h1>
      <p class="text-sm text-gray-500 mb-3">Identité · Adresses · Sous-comptes titres · Contacts (CSFT §M6)</p>

      <div class="mb-6 p-3 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-900 flex items-start gap-2">
        <span class="text-lg shrink-0">🔒</span>
        <span>Profil en <b>consultation seule</b>. Toute modification de vos informations doit être demandée à votre teneur de compte — seul un administrateur est habilité à les mettre à jour.</span>
      </div>

      <div class="flex gap-1 overflow-x-auto border-b mb-6 no-scrollbar">
        @for (t of tabs; track t.id) {
          <button class="px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition"
                  [class.border-afb-red]="tab()===t.id" [class.text-afb-red]="tab()===t.id" [class.font-semibold]="tab()===t.id"
                  [class.border-transparent]="tab()!==t.id" [class.text-gray-500]="tab()!==t.id"
                  (click)="tab.set(t.id)">{{ t.icon }} {{ t.label }}</button>
        }
      </div>

      @if (tab() === 'identity') {
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div class="lg:col-span-2 card">
            <div class="card-header"><h2 class="font-semibold">Identité du titulaire</h2></div>
            <div class="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div><label class="label">Civilité</label><input class="input bg-gray-50" [value]="ct().contacts[0]?.civilite ?? ''" readonly></div>
              <div><label class="label">Nationalité</label><input class="input bg-gray-50" value="Camerounaise" readonly></div>
              <div><label class="label">Nom</label><input class="input bg-gray-50" [value]="user().nom" readonly></div>
              <div><label class="label">Prénom</label><input class="input bg-gray-50" [value]="user().prenom ?? ''" readonly></div>
              <div><label class="label">E-mail</label><input class="input bg-gray-50" [value]="user().email" readonly></div>
              <div><label class="label">Téléphone portable</label><input class="input bg-gray-50" [value]="ct().contacts[0]?.telephonePortable ?? ''" readonly></div>
              <div><label class="label">Téléphone domicile</label><input class="input bg-gray-50" [value]="ct().contacts[0]?.telephoneDomicile ?? ''" readonly></div>
              <div><label class="label">WhatsApp</label><input class="input bg-gray-50" [value]="ct().contacts[0]?.whatsapp ?? ''" readonly></div>
              <div><label class="label">Pièce d'identité</label><input class="input bg-gray-50" [value]="ct().contacts[0]?.pieceIdentite + ' N° ' + ct().contacts[0]?.numeroPiece" readonly></div>
              <div><label class="label">Validité pièce</label><input class="input bg-gray-50" [value]="ct().contacts[0]?.dateValiditePiece ?? ''" readonly></div>
            </div>
          </div>
          <div class="space-y-4">
            <div class="card p-5">
              <div class="text-xs uppercase text-gray-500 mb-1">Compte-titres</div>
              <div class="font-mono text-sm">{{ ct().numero }}</div>
              <div class="text-xs text-gray-500 mt-1">{{ ct().typeCompte }} · {{ ct().statut }}</div>
              <div class="text-xs text-gray-500">Ouvert le {{ ct().dateOuverture }}</div>
            </div>
            <div class="card p-5">
              <div class="text-xs uppercase text-gray-500 mb-1">Compte espèces lié</div>
              <div class="font-mono text-sm">{{ ct().compteEspecesLie }}</div>
              <div class="text-[11px] text-gray-400 mt-1">
                Le solde n'est pas visible ici ; pour toute information sur votre
                provision, contactez votre teneur de compte.
              </div>
            </div>
            <div class="card p-5">
              <div class="text-xs uppercase text-gray-500 mb-1">Catégorie investisseur</div>
              <div class="font-semibold">{{ ct().categorie === 'QUALIFIE' ? 'Investisseur qualifié' : 'Investisseur non qualifié' }}</div>
            </div>
          </div>
        </div>
      }

      @if (tab() === 'addresses') {
        <div class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
            <h2 class="text-lg font-semibold">Adresses</h2>
          </div>
          @for (a of ct().adresses; track a.type) {
            <div class="card p-4 sm:p-5">
              <div class="flex items-start justify-between gap-3 flex-wrap">
                <div class="flex-1 min-w-0">
                  <span class="badge bg-blue-100 text-blue-700 mb-2">{{ a.type }}</span>
                  @if (a.residence) { <div class="text-sm">{{ a.residence }}</div> }
                  <div class="text-sm font-medium">{{ a.rue }}</div>
                  <div class="text-sm text-gray-600">{{ a.codePostal }} {{ a.ville }} · {{ a.pays }}</div>
                </div>
              </div>
            </div>
          }
        </div>
      }

      @if (tab() === 'subaccounts') {
        <div>
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 class="text-lg font-semibold">Sous-comptes titres</h2>
              <p class="text-sm text-gray-500">Conservation · Nantissement · Gage · Séquestre · Transit</p>
            </div>
            <button class="btn btn-outline text-xs">📄 Demander un nouveau sous-compte</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            @for (sc of ct().sousComptes; track sc.id) {
              <div class="card p-4 sm:p-5" [class.border-emerald-300]="sc.statut==='ACTIF'" [class.border-gray-300]="sc.statut!=='ACTIF'">
                <div class="flex items-center justify-between mb-2">
                  <span class="badge" [class.bg-emerald-100]="sc.statut==='ACTIF'" [class.text-emerald-700]="sc.statut==='ACTIF'" [class.bg-gray-100]="sc.statut!=='ACTIF'" [class.text-gray-600]="sc.statut!=='ACTIF'">{{ sc.statut }}</span>
                  <span class="badge bg-purple-100 text-purple-700 text-[10px]">{{ sc.type }}</span>
                </div>
                <div class="font-mono text-xs text-gray-600 truncate">{{ sc.numero }}</div>
                <div class="font-semibold text-sm mt-1">{{ sc.libelle }}</div>
                <div class="grid grid-cols-2 gap-2 mt-3 text-xs">
                  <div><div class="text-gray-500">Positions</div><div class="font-bold">{{ sc.positionsCount }}</div></div>
                  <div><div class="text-gray-500">Valeur</div><div class="font-bold">{{ sc.valeurTotale | number:'1.0-0':'fr-FR' }}</div></div>
                </div>
                <div class="text-[11px] text-gray-400 mt-2">Ouvert le {{ sc.dateOuverture }}</div>
                @if (sc.observations) {
                  <div class="mt-2 p-2 bg-amber-50 rounded text-[11px] text-amber-800">{{ sc.observations }}</div>
                }
              </div>
            }
          </div>

          <div class="card overflow-hidden">
            <div class="card-header"><h3 class="font-semibold text-sm">Synthèse tous sous-comptes</h3></div>
            <div class="overflow-x-auto"><table class="table min-w-[720px] sm:min-w-full">
              <thead>
                <tr><th>Numéro</th><th>Libellé</th><th>Type</th><th>Positions</th><th>Valeur</th><th>Statut</th><th>Ouverture</th></tr>
              </thead>
              <tbody>
                @for (sc of (ct().sousComptes | paginate:scPage():25); track sc.id) {
                  <tr>
                    <td class="font-mono text-xs">{{ sc.numero }}</td>
                    <td class="font-semibold text-sm">{{ sc.libelle }}</td>
                    <td><span class="badge bg-purple-100 text-purple-700">{{ sc.type }}</span></td>
                    <td>{{ sc.positionsCount }}</td>
                    <td>{{ sc.valeurTotale | number:'1.0-0':'fr-FR' }} FCFA</td>
                    <td><span class="badge" [class.badge-publie]="sc.statut==='ACTIF'" [class.badge-closed]="sc.statut!=='ACTIF'">{{ sc.statut }}</span></td>
                    <td class="text-xs">{{ sc.dateOuverture }}</td>
                  </tr>
                }
              </tbody>
            </table></div>
            <afb-paginator [total]="ct().sousComptes.length" [pageSize]="25" [(page)]="scPage" />
          </div>
        </div>
      }

      @if (tab() === 'contacts') {
        <div>
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 class="text-lg font-semibold">Contacts liés au compte</h2>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            @for (c of ct().contacts; track c.id) {
              <div class="card p-4 sm:p-5">
                <div class="mb-3">
                  <span class="badge mb-1"
                    [class.bg-blue-100]="c.type==='TITULAIRE'" [class.text-blue-700]="c.type==='TITULAIRE'"
                    [class.bg-amber-100]="c.type==='CONTACT_ORDRE'" [class.text-amber-700]="c.type==='CONTACT_ORDRE'"
                    [class.bg-red-100]="c.type==='URGENCE'" [class.text-red-700]="c.type==='URGENCE'"
                    [class.bg-emerald-100]="c.type==='REPRESENTANT_LEGAL'" [class.text-emerald-700]="c.type==='REPRESENTANT_LEGAL'">
                    {{ c.type.replace('_',' ') }}
                  </span>
                  <div class="font-semibold">{{ c.civilite ? c.civilite + ' ' : '' }}{{ c.prenom }} {{ c.nom }}</div>
                  @if (c.fonction) { <div class="text-xs text-gray-500">{{ c.fonction }}</div> }
                  @if (c.lienParente) { <div class="text-xs text-gray-500">{{ c.lienParente }}</div> }
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
                  @if (c.telephonePortable) { <div>📱 {{ c.telephonePortable }}</div> }
                  @if (c.telephoneDomicile) { <div>🏠 {{ c.telephoneDomicile }}</div> }
                  @if (c.telephoneBureau) { <div>🏢 {{ c.telephoneBureau }}</div> }
                  @if (c.email) { <div>📧 {{ c.email }}</div> }
                  @if (c.whatsapp) { <div>💬 {{ c.whatsapp }}</div> }
                  @if (c.pieceIdentite) { <div>🪪 {{ c.pieceIdentite }} N° {{ c.numeroPiece }} (exp. {{ c.dateValiditePiece }})</div> }
                </div>
              </div>
            }
          </div>
        </div>
      }

      @if (tab() === 'prefs') {
        <div class="max-w-2xl space-y-6">
          <div class="card">
            <div class="card-header"><h2 class="font-semibold">Canaux de notification</h2></div>
            <div class="p-4 sm:p-6 space-y-3 text-sm">
              <label class="flex items-center justify-between gap-4"><span>📧 E-mail (CSFT M2-S03 obligatoire)</span><input type="checkbox" checked disabled></label>
              <label class="flex items-center justify-between gap-4"><span>📱 SMS (alertes statut d'ordre, OTP)</span><input type="checkbox" checked></label>
              <label class="flex items-center justify-between gap-4"><span>💬 WhatsApp Business (opt-in explicite)</span><input type="checkbox"></label>
              <label class="flex items-center justify-between gap-4"><span>🔔 Notifications in-app</span><input type="checkbox" checked></label>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h2 class="font-semibold">Documents</h2></div>
            <div class="p-4 sm:p-6 space-y-3 text-sm">
              <label class="flex items-center justify-between gap-4"><span>Situation de titres mensuelle par e-mail</span><input type="checkbox" checked></label>
              <label class="flex items-center justify-between gap-4"><span>Tableaux d'amortissement OTA</span><input type="checkbox" checked></label>
              <label class="flex items-center justify-between gap-4"><span>Avis d'opération automatique après adjudication</span><input type="checkbox" checked></label>
            </div>
          </div>
        </div>
      }

      @if (tab() === 'security') {
        <div class="max-w-2xl space-y-6">
          <div class="card">
            <div class="card-header"><h2 class="font-semibold">Mot de passe</h2></div>
            <div class="p-4 sm:p-6 space-y-3">
              <div><label class="label">Ancien mot de passe</label><input class="input" type="password" autocomplete="current-password" [(ngModel)]="oldPwd" name="oldPwd" maxlength="128"></div>
              <div>
                <label class="label">Nouveau mot de passe</label>
                <input class="input" type="password" autocomplete="new-password" [(ngModel)]="newPwd" name="newPwd" minlength="8" maxlength="128">
                <p class="hint">CSFT §M2-A02 : 8 caractères min. · majuscule · chiffre · caractère spécial</p>
                @if (newPwd && !pwdStrong()) { <p class="text-xs text-red-600 mt-1">Force insuffisante</p> }
              </div>
              <div>
                <label class="label">Confirmation</label>
                <input class="input" type="password" autocomplete="new-password" [(ngModel)]="confirmPwd" name="confPwd" maxlength="128">
                @if (confirmPwd && newPwd !== confirmPwd) { <p class="text-xs text-red-600 mt-1">Les mots de passe ne correspondent pas</p> }
              </div>
              <p class="text-xs text-gray-500">⚠️ Réinitialisation possible uniquement en agence (CSFT §M2-A02).</p>
              <button class="btn btn-primary text-xs" [disabled]="!canChangePwd()" (click)="changePwd()">Modifier le mot de passe</button>
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h2 class="font-semibold">Authentification multi-facteur (MFA)</h2></div>
            <div class="p-4 sm:p-6 text-sm space-y-3">
              <div class="flex items-center justify-between gap-4">
                <span>OTP par SMS au <b class="font-mono">{{ ct().contacts[0]?.telephonePortable }}</b></span>
                <span class="badge bg-emerald-100 text-emerald-700">✓ Activé</span>
              </div>
              <div class="flex items-center justify-between gap-4">
                <span>OTP par e-mail</span>
                <span class="badge bg-gray-100 text-gray-600">Désactivé</span>
              </div>
              <p class="text-xs text-gray-500">CSFT §M6-S01 — MFA obligatoire (validité OTP : 5 minutes).</p>
              <button class="btn btn-outline text-xs">Configurer les méthodes MFA</button>
            </div>
          </div>
          <div class="card p-5">
            <div class="text-xs uppercase text-gray-500 mb-2">Sessions récentes</div>
            <div class="text-sm space-y-2">
              <div class="flex items-center justify-between"><span>Yaoundé · Chrome 126 · Linux</span><span class="text-xs text-gray-500">17/04/2026 09:08</span></div>
              <div class="flex items-center justify-between"><span>Douala · Mobile Safari · iPhone</span><span class="text-xs text-gray-500">16/04/2026 14:35</span></div>
            </div>
            <p class="text-xs text-gray-500 mt-2">CSFT §M2-A03 — déconnexion automatique après 15 min d'inactivité.</p>
          </div>
        </div>
      }
    </div>
  `
})
export class Profile implements OnDestroy {
  data = inject(MockData);
  toast = inject(ToastService);
  user = this.data.currentUser;
  /** Recharge le compte-titres détaillé du client connecté depuis la base. */
  constructor() { this.data.refreshMyCompte(); }
  ct = computed(() => this.user().compte!);
  tab = signal<string>('identity');
  scPage = signal(1);
  tabs = [
    { id: 'identity', icon: '👤', label: 'Identité' },
    { id: 'addresses', icon: '📍', label: 'Adresses' },
    { id: 'subaccounts', icon: '📂', label: 'Sous-comptes' },
    { id: 'contacts', icon: '📇', label: 'Contacts' }
  ];

  oldPwd = '';
  newPwd = '';
  confirmPwd = '';
  /** CSFT §M2-A02 : min 8 chars, majuscule + chiffre + caractère spécial. */
  private readonly STRONG_PWD = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/;
  pwdStrong() { return this.STRONG_PWD.test(this.newPwd); }
  canChangePwd() {
    return !!this.oldPwd && this.pwdStrong() && this.newPwd === this.confirmPwd && this.oldPwd !== this.newPwd;
  }
  changePwd() {
    if (!this.canChangePwd()) return;
    this.toast.success('Mot de passe modifié', 'Pensez à vous reconnecter sur vos autres appareils.');
    this.clearSecrets();
  }
  private clearSecrets() { this.oldPwd = ''; this.newPwd = ''; this.confirmPwd = ''; }
  ngOnDestroy() { this.clearSecrets(); }
}
