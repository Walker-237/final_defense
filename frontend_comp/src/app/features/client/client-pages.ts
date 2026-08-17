import { Component, computed, inject, model, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MockData, dureeAffichage } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';
import { PdfProgressService } from '../../core/services/pdf-progress';
import { AuthService } from '../../core/services/auth-service';
import { Order, OrderStatus, ORDER_STATUS_LABELS, PAYS_CEMAC, PaysCEMAC } from '../../core/models/models';
import { OtpDialog, ConfirmDialog, ModalShell } from '../../shared/dialogs';
import { FaceScanComponent, FaceCaptureResult } from '../registration/face-scan';
import { FaceCheckService } from '../registration/face-check-service';
import { downloadClientOrderPdf } from '../../shared/download';
import { SignatureField } from '../../shared/signature-pad';
import { Paginator, PaginatePipe } from '../../shared/pagination';
import { ForecastCard } from './forecast-card';

/** Classe CSS de badge pour un statut d'ordre — alignée sur CSFT §5.2. */
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

@Component({
  selector: 'afb-client-dashboard',
  imports: [RouterLink, DecimalPipe],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h1 class="text-lg sm:text-xl font-bold text-gray-900">Bonjour, {{ user().prenom }} 👋</h1>
          <p class="text-gray-500 text-xs">Bienvenue sur votre espace investisseur Afriland First Bond</p>
        </div>
        <a routerLink="/client/emissions" class="btn btn-primary text-sm py-2">+ Nouvelle souscription</a>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="kpi !p-3 !gap-0.5">
          <span class="kpi-label !text-[10px]">Valeur portefeuille</span>
          <span class="kpi-value !text-base">{{ totalPortfolio() | number:'1.0-0':'fr-FR' }} FCFA</span>
          <span class="kpi-trend !text-[11px]">{{ data.positions().length }} ligne(s) active(s)</span>
        </div>
        <div class="kpi !p-3 !gap-0.5">
          <span class="kpi-label !text-[10px]">Ordres en cours</span>
          <span class="kpi-value !text-base">{{ pendingOrders() }}</span>
          <span class="text-[11px] text-gray-400">Soumis · Vérification</span>
        </div>
        <div class="kpi !p-3 !gap-0.5">
          <span class="kpi-label !text-[10px]">Émissions publiées</span>
          <span class="kpi-value !text-base">{{ openEmissions() }}</span>
          <span class="text-[11px] text-afb-red">À la souscription</span>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div class="card col-span-2">
          <div class="card-header !py-2.5">
            <h2 class="font-semibold text-sm">Opportunités d'émissions</h2>
            <a routerLink="/client/emissions" class="text-xs text-afb-red">Tout voir →</a>
          </div>
          <div class="divide-y divide-gray-100">
            @for (e of ouvertesPreview(); track e.id) {
              <div class="px-4 py-2.5 flex items-center justify-between hover:bg-gray-50 transition">
                <div>
                  <div class="flex items-center gap-1.5">
                    <span class="font-mono text-xs font-bold">{{ e.libelle }}</span>
                    <span class="badge text-[10px]" [class.bg-blue-100]="e.nature==='BTA'" [class.text-blue-700]="e.nature==='BTA'" [class.bg-purple-100]="e.nature==='OTA'" [class.text-purple-700]="e.nature==='OTA'">{{ e.nature }}</span>
                    <span class="badge badge-publie text-[10px]">Publié</span>
                  </div>
                  <div class="text-xs text-gray-600 mt-0.5">{{ e.emetteur }} · {{ e.dureeJours }} j · {{ e.tauxNominal }}%</div>
                  <div class="text-[10px] text-gray-400">Clôture : {{ e.fermetureSouscription }}</div>
                </div>
                <a [routerLink]="['/client/emissions', e.id]" class="btn btn-primary text-xs py-1.5 px-3">Souscrire</a>
              </div>
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header !py-2.5">
            <h2 class="font-semibold text-sm">Activité récente</h2>
            <a routerLink="/client/orders" class="text-xs text-afb-red">Tout voir →</a>
          </div>
          <div class="p-1">
            @for (o of recentOrders(); track o.id) {
              <a [routerLink]="['/client/orders', o.id]" class="block px-3 py-2 rounded-lg hover:bg-gray-50">
                <div class="flex items-center justify-between">
                  <span class="text-[10px] font-mono text-gray-500">{{ o.reference }}</span>
                  <span class="badge text-[10px]" [class]="badgeClass(o.status)">{{ statusLabel(o.status) }}</span>
                </div>
                <div class="text-xs mt-0.5 font-medium">{{ o.emissionCode }}</div>
                <div class="text-[10px] text-gray-500">{{ o.montant | number:'1.0-0':'fr-FR' }} FCFA · {{ o.dateSoumission }}</div>
              </a>
            }
          </div>
        </div>
      </div>
    </div>
  `
})
export class ClientDashboard {
  data = inject(MockData);
  user = this.data.currentUser;
  /** Recharge ordres et positions depuis la BD au chargement du dashboard. */
  constructor() {
    this.data.refreshOrders();
    this.data.refreshPositions();
  }
  ouvertes = computed(() => this.data.emissions().filter(e => e.status === 'PUBLIE'));
  /** Aperçus du tableau de bord (listes complètes paginées sur leurs pages dédiées). */
  ouvertesPreview = computed(() => this.ouvertes().slice(0, 5));
  recentOrders = computed(() => this.data.orders().slice(0, 6));
  openEmissions = computed(() => this.ouvertes().length);
  pendingOrders = computed(() => this.data.orders().filter(o =>
    o.status === 'SOUMIS' || o.status === 'EN_VERIFICATION' || o.status === 'EN_ATTENTE_ADJUDICATION'
  ).length);
  totalPortfolio = computed(() => this.data.positions().reduce((s, p) => s + p.valeurTotale, 0));
  statusLabel(s: OrderStatus) { return ORDER_STATUS_LABELS[s]; }
  badgeClass(s: OrderStatus) { return orderBadgeClass(s); }
}

@Component({
  selector: 'afb-emissions-list',
  imports: [DecimalPipe, FormsModule, Paginator, PaginatePipe],
  styles: [`
    .mp-banner {
      position: relative; overflow: hidden; background:#0a1530;
    }
    .mp-banner img.mp-banner-img {
      width:100%; height:100%; object-fit:cover; display:block;
    }
    .mp-banner-logo {
      position:absolute; top:10px; left:14px; z-index:2;
      background:white; padding:6px 10px; border-radius:4px;
      box-shadow:0 1px 3px rgba(0,0,0,0.2);
      display:inline-flex; align-items:center; gap:8px;
    }
    .mp-banner-logo img { height:28px; display:block; }
    .mp-banner-logo .fallback {
      display:inline-flex; align-items:center; gap:6px;
      font-weight:700; color:#c8102e; font-size:13px;
    }
    .mp-banner-logo .fallback .c-mark {
      width:18px; height:18px; border-radius:50%; border:2.5px solid #c8102e;
      display:inline-block; position:relative;
    }
    .mp-banner-logo .fallback .c-mark::after {
      content:""; position:absolute; right:-3px; top:50%; transform:translateY(-50%);
      width:8px; height:8px; background:white;
    }
    .mp-title-bar {
      background:#c8102e; color:white; text-align:center;
      font-weight:bold; letter-spacing:0.5px; padding:14px 8px; font-size:18px;
    }
    .mp-table { width:100%; border-collapse:collapse; background:white; }
    .mp-table th, .mp-table td {
      border:1px solid #111; padding:10px 8px; font-size:12px;
      text-align:center; vertical-align:middle;
    }
    .mp-table th { background:#f3f4f6; font-weight:bold; text-transform:uppercase; line-height:1.25; }
    .mp-table td.designation { text-align:left; white-space:nowrap; }
    .mp-table td.heure { color:#c8102e; font-weight:600; }
    .mp-table tr.clickable { cursor:pointer; }
    .mp-table tr.clickable:hover { background:#fff5f6; }
    .mp-footer { display:grid; grid-template-columns: minmax(160px, 1fr) 2fr; gap:24px; padding:18px 8px 0; }
    .mp-footer-logo { display:flex; align-items:flex-start; justify-content:flex-start; padding-top:8px; }
    .mp-footer-logo img { max-height:80px; max-width:240px; display:block; }
    .mp-footer-logo .fallback {
      display:inline-flex; align-items:center; gap:10px;
      font-weight:700; color:#c8102e; font-size:18px;
    }
    .mp-footer-logo .fallback .c-mark {
      width:28px; height:28px; border-radius:50%; border:4px solid #c8102e;
      display:inline-block; position:relative;
    }
    .mp-footer-logo .fallback .c-mark::after {
      content:""; position:absolute; right:-4px; top:50%; transform:translateY(-50%);
      width:12px; height:12px; background:white;
    }
    .mp-section-title { color:#c8102e; font-weight:700; margin-bottom:4px; }
    .mp-notes p { margin:6px 0; font-size:13px; line-height:1.5; color:#1f2937; }
    .mp-notes b { font-weight:700; }
  `],
  template: `
    <div class="space-y-0 print-area">
      <!-- Bannière supérieure : déposez votre fichier image dans frontend/public/marche-primaire-banner.jpg pour remplacer le fond CSS -->
      <div class="mp-banner" style="height:180px">
        <img class="mp-banner-img" src="/marche-primaire-banner.jpg" alt="Marché primaire — Afriland First Bond"
             (error)="bannerOk = false" [hidden]="!bannerOk">
        @if (!bannerOk) {
          <!-- Fond dégradé financier avec courbe de marché SVG -->
          <div style="position:absolute;inset:0;background:linear-gradient(120deg,#0a1530 0%,#0d2060 40%,#1a3a70 60%,#0f2850 80%,#0a1530 100%)"></div>
          <!-- Grille de fond subtile -->
          <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.04) 1px,transparent 1px);background-size:40px 40px"></div>
          <!-- Courbe de marché SVG décorative -->
          <svg style="position:absolute;bottom:0;left:0;right:0;opacity:0.25" viewBox="0 0 900 100" preserveAspectRatio="none" height="100%">
            <polyline points="0,80 60,60 120,70 180,40 240,55 300,30 360,50 420,20 480,35 540,15 600,40 660,25 720,50 780,20 840,45 900,30" fill="none" stroke="#c8102e" stroke-width="3"/>
            <polyline points="0,90 80,75 160,80 220,65 300,70 380,50 440,65 520,45 580,60 640,35 720,55 800,40 900,55" fill="none" stroke="#4a90d9" stroke-width="2.5"/>
          </svg>
          <!-- Points de données décoration -->
          <div style="position:absolute;top:20px;right:180px;color:rgba(255,255,255,0.15);font-size:11px;font-family:monospace;line-height:1.8;text-align:right">
            5.75% &nbsp;▲<br>4.25% &nbsp;▲<br>6.10% &nbsp;▼<br>3.80% &nbsp;▲
          </div>
          <!-- Texte bannière centré -->
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 200px 0 160px">
            <div style="color:white;font-size:22px;font-weight:800;letter-spacing:1px;text-shadow:0 2px 8px rgba(0,0,0,0.5)">MARCHÉ PRIMAIRE DES VALEURS DU TRÉSOR</div>
            <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:6px;letter-spacing:0.5px">Obligations du Trésor Assimilables · Bons du Trésor Assimilables · Zone CEMAC</div>
            <div style="margin-top:14px;display:flex;gap:24px">
              <span style="background:rgba(200,16,46,0.85);color:white;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700">OTA</span>
              <span style="background:rgba(30,64,175,0.85);color:white;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:700">BTA</span>
              <span style="background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.9);padding:4px 14px;border-radius:20px;font-size:11px;border:1px solid rgba(255,255,255,0.3)">BEAC</span>
            </div>
          </div>
        }
        <div class="mp-banner-logo">
          <img src="/Logo_Afriland.png" alt="Afriland First Bond"
               (error)="logoOk = false" [hidden]="!logoOk">
          @if (!logoOk) {
            <span class="fallback"><span class="c-mark"></span>Afriland First Bond</span>
          }
        </div>
      </div>

      <!-- Bandeau rouge titre -->
      <div class="mp-title-bar">
        MARCHE PRIMAIRE SEMAINE DU {{ semaineDebut() }} AU {{ semaineFin() }}
      </div>

      <!-- Filtres CSFT §M2-C02 — pays / nature / taux / maturité / montant -->
      <div class="flex flex-wrap items-center gap-2 px-3 py-3 bg-gray-50 border-x border-gray-300 no-print">
        <select class="select w-auto" [(ngModel)]="filterNature" name="fn">
          <option value="">Toutes natures</option><option value="BTA">BTA</option><option value="OTA">OTA</option>
        </select>
        <select class="select w-auto" [(ngModel)]="filterPays" name="fp">
          <option value="">Tous pays CEMAC</option>
          @for (p of paysList; track p.code) {
            <option [value]="p.code">{{ p.code }} — {{ p.name }}</option>
          }
        </select>
        <input class="input w-28" placeholder="Taux min %" type="number" step="0.01" [(ngModel)]="filterTauxMin" name="ftmin">
        <input class="input w-28" placeholder="Taux max %" type="number" step="0.01" [(ngModel)]="filterTauxMax" name="ftmax">
        <div class="text-xs text-gray-500 ml-auto">Cliquez sur une ligne publiée pour souscrire</div>
      </div>

      <!-- Tableau marché primaire -->
      <div class="overflow-x-auto border-x border-b border-black">
        <table class="mp-table min-w-[1100px]">
          <thead>
            <tr>
              <th>NATURE</th>
              <th>EMETTEUR</th>
              <th>DESIGNATION</th>
              <th>DATE D'ECHEANCE</th>
              <th>MATURITE</th>
              <th>VALEUR UNITAIRE</th>
              <th>VOLUME D'EMISSION<br/>(en millions de fcfa)</th>
              <th>DATE LIMITE DE<br/>SOUSCRIPTION</th>
              <th>HEURE LIMITE DE<br/>SOUSCRIPTION</th>
              <th>TAUX/PRIX</th>
              <th>OBSERVATIONS</th>
            </tr>
          </thead>
          <tbody>
            @for (e of (filtered() | paginate:page():25); track e.id) {
              <tr [class.clickable]="e.status === 'PUBLIE'" (click)="rowClick(e)">
                <td>{{ e.nature }}</td>
                <td>{{ emetteurUpper(e.emetteur) }}</td>
                <td class="designation">{{ e.libelle }}</td>
                <td>{{ formatDateFr(e.dateEcheance) }}</td>
                <td>{{ maturite(e) }}</td>
                <td>{{ e.valeurNominaleUnitaire | number:'1.0-0':'fr-FR' }}</td>
                <td>{{ volumeMillions(e) | number:'1.0-0':'fr-FR' }}</td>
                <td>{{ formatDateFr(e.fermetureSouscription) }}</td>
                <td class="heure">{{ formatHeure(e.fermetureSouscription) }}</td>
                <td>{{ tauxOuPrix(e) }}</td>
                <td>{{ e.observation || 'NOUVELLE EMISSION' }}</td>
              </tr>
            }
            @if (!filtered().length) {
              <tr><td colspan="11" class="text-gray-400 py-8" style="text-align:center">Aucune émission ne correspond aux filtres</td></tr>
            }
          </tbody>
        </table>
      </div>
      <afb-paginator [total]="filtered().length" [pageSize]="25" [(page)]="page" />

      <!-- Pied : logo + Remarques + Facteurs de risques -->
      <div class="mp-footer">
        <div class="mp-footer-logo">
          <img src="/Logo_Afriland.png" alt="Afriland First Bond"
               (error)="footerLogoOk = false" [hidden]="!footerLogoOk">
          @if (!footerLogoOk) {
            <span class="fallback"><span class="c-mark"></span>Afriland First Bond</span>
          }
        </div>
        <div class="mp-notes">
          <div class="mp-section-title">REMARQUES</div>
          <p><b>Les intérêts sur les BTA sont précomptés</b><br>
            <b>Les transactions sur les OTA se font au pied du coupon</b> (C'est à dire que l'acheteur doit payer les intérêts courus au vendeur)</p>

          <div class="mp-section-title mt-3">FACTEURS DE RISQUES</div>
          <p><b>Risque de marché</b> : la cession par un investisseur d'une OTA avant l'échéance pourrait entraîner un gain ou une perte en capital en cas de fluctuation du cours du titre consécutif aux risques sur ledit titre ; en cas de cession d'un BTA avant l'échéance, l'Investisseur pourrait payer au nouvel acquéreur un taux d'intérêt supérieur au taux initial.</p>
          <p><b>Risque de liquidité</b> : éventualité pour un investisseur désirant céder le titre avant l'échéance, de ne pouvoir vendre ses OTA ou BTA, faute d'acheteurs sur le marché; toutefois , les SVT ont l'obligation d'acheter les titres aux conditions qu'ils offrent sur le marché.</p>
          <p><b>Risque de contrepartie</b> : correspond au risque encouru par l'investisseur dans l'éventualité où l'Emetteur manque à ses engagements de règlement d'échéances de capital ou d'intérêts; toutefois certains émetteurs atténuent ce risque sur certaines valeurs du trésor par le mécanisme du compte séquestre.</p>
        </div>
      </div>
    </div>
  `
})
export class EmissionsList {
  data = inject(MockData);
  router = inject(Router);
  page = signal(1);
  filterNature = model('');
  filterPays = model('');
  filterTauxMin = model<number | null>(null);
  filterTauxMax = model<number | null>(null);
  paysList = (Object.keys(PAYS_CEMAC) as PaysCEMAC[]).map(code => ({ code, name: PAYS_CEMAC[code] }));

  /** Indicateurs de présence des images — basculés à `false` au premier `error` de chargement. */
  bannerOk = true;
  logoOk = true;
  footerLogoOk = true;

  /** Cellule « TAUX/PRIX » du marché primaire — affiche « ADJ » quand le titre est fixé par adjudication
   *  (tauxNominal = 0), sinon le taux nominal saisi en %. */
  tauxOuPrix(e: { tauxNominal: number; modeAdjudication: 'TAUX' | 'PRIX' }): string {
    if (!e.tauxNominal || e.tauxNominal === 0) return 'ADJ';
    const unit = e.modeAdjudication === 'PRIX' ? '' : ' %';
    return e.tauxNominal.toString().replace('.', ',') + unit;
  }

  filtered = computed(() => this.data.marcheEmissions().filter(e => {
    if (this.filterNature() && e.nature !== this.filterNature()) return false;
    if (this.filterPays() && e.paysCode !== this.filterPays()) return false;
    const tmin = this.filterTauxMin(); if (tmin != null && e.tauxNominal < tmin) return false;
    const tmax = this.filterTauxMax(); if (tmax != null && e.tauxNominal > tmax) return false;
    return true;
  }));

  /** Plage de la semaine en cours basée sur les ouvertures de souscription des émissions publiées. */
  private readonly weekRange = computed(() => {
    const open = this.data.marcheEmissions().filter(e => e.status === 'PUBLIE');
    const dates = open.map(e => (e.ouvertureSouscription || '').slice(0, 10)).filter(Boolean);
    const closes = open.map(e => (e.fermetureSouscription || '').slice(0, 10)).filter(Boolean);
    if (!dates.length) {
      const today = new Date();
      const end = new Date(today); end.setDate(today.getDate() + 6);
      return { start: this.toIso(today), end: this.toIso(end) };
    }
    return {
      start: dates.reduce((a, b) => (a < b ? a : b), dates[0]),
      end: closes.length ? closes.reduce((a, b) => (a > b ? a : b), closes[0]) : dates.reduce((a, b) => (a > b ? a : b), dates[0])
    };
  });
  semaineDebut = computed(() => this.formatDateLong(this.weekRange().start));
  semaineFin = computed(() => this.formatDateLong(this.weekRange().end));

  duree(e: { nature: 'BTA' | 'OTA'; dureeJours: number }) { return dureeAffichage(e); }

  emetteurUpper(s: string) {
    return (s || '').toUpperCase()
      .replace('GUINÉE ÉQUATORIALE', 'GUINEE EQUATORIALE')
      .replace('É', 'E').replace('È', 'E').replace('À', 'A');
  }

  designation(e: { id: string; code: string; isin: string; nature: 'BTA' | 'OTA'; dureeJours: number; dateEcheance: string; tauxNominal: number }) {
    const dur = e.nature === 'BTA' ? Math.round(e.dureeJours / 7).toString() :
      (Math.round(e.dureeJours / 365) + ' ANS ' + e.tauxNominal.toString().replace('.', ',') + '%');
    const dateShort = this.formatDateLongShort(e.dateEcheance);
    return `${e.isin} ${e.nature} ${dur} ${dateShort}`;
  }

  maturite(e: { nature: 'BTA' | 'OTA'; dureeJours: number }) {
    if (e.nature === 'BTA') {
      const sem = Math.round(e.dureeJours / 7);
      return `${sem} SEMAINE${sem > 1 ? 'S' : ''}`;
    }
    const an = Math.round(e.dureeJours / 365 * 100) / 100;
    if (Number.isInteger(an)) return `${an} AN${an > 1 ? 'S' : ''}`;
    return `${an.toString().replace('.', ',')} AN${an > 1 ? 'S' : ''}`;
  }

  volumeMillions(e: { montantGlobal: number }) { return Math.round(e.montantGlobal / 1_000_000); }

  formatDateFr(s: string) {
    const d = (s || '').slice(0, 10);
    const [y, m, day] = d.split('-');
    return y && m && day ? `${day}/${m}/${y}` : s;
  }

  formatHeure(s: string) {
    const idx = (s || '').indexOf(' ');
    if (idx < 0) return '—';
    const time = s.slice(idx + 1);
    const [h, m] = time.split(':');
    return `${h}h${m || '00'}mn`;
  }

  formatDateLongShort(s: string) {
    // Abréviations de mois alignées sur le format du bulletin marché primaire BEAC.
    const months = ['JANV', 'FEVR', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUIL', 'AOUT', 'SEPT', 'OCTO', 'NOVE', 'DECE'];
    const d = (s || '').slice(0, 10);
    const [y, m, day] = d.split('-');
    const mi = Number.parseInt(m || '0', 10) - 1;
    return y && day && months[mi] ? `${day} ${months[mi]} ${y}` : s;
  }

  formatDateLong(s: string) {
    const months = ['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'];
    const d = (s || '').slice(0, 10);
    const [y, m, day] = d.split('-');
    const mi = Number.parseInt(m || '0', 10) - 1;
    return y && day && months[mi] ? `${day} ${months[mi]} ${y}` : s;
  }

  private toIso(d: Date) { return d.toISOString().slice(0, 10); }

  rowClick(e: { id: string; status: string }) {
    if (e.status === 'PUBLIE') this.souscrire(e.id);
    else this.router.navigate(['/emissions', e.id]);
  }

  souscrire(id: string) {
    if (this.data.isAuthenticated()) {
      this.router.navigate(['/client/orders/new', id]);
    } else {
      this.router.navigate(['/auth/login'], { queryParams: { returnUrl: `/client/orders/new/${id}` } });
    }
  }
}

@Component({
  selector: 'afb-emission-detail',
  imports: [RouterLink, DecimalPipe, ForecastCard],
  template: `
    @if (emission(); as e) {
      <div class="max-w-4xl">
        <a routerLink="/client/emissions" class="text-sm text-gray-500 hover:text-afb-red">← Retour aux émissions</a>
        <div class="card mt-3">
          <div class="p-6 border-b">
            <div class="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="badge"
                        [class.bg-blue-100]="e.nature==='BTA'" [class.text-blue-700]="e.nature==='BTA'"
                        [class.bg-purple-100]="e.nature==='OTA'" [class.text-purple-700]="e.nature==='OTA'">{{ e.nature }}</span>
                  <span class="badge badge-publie">{{ e.status }}</span>
                </div>
                <h1 class="text-xl font-bold font-mono mt-2">{{ e.libelle }}</h1>
              </div>
              @if (e.status === 'PUBLIE') {
                <a [routerLink]="['/client/orders/new', e.id]" class="btn btn-primary">Souscrire à cette émission</a>
              }
            </div>
          </div>
          <div class="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div><div class="text-[11px] text-gray-500 uppercase">Nature</div><div class="font-semibold">{{ e.nature }}</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Émetteur</div><div class="font-semibold">{{ emetteurUpper(e.emetteur) }}</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Désignation</div><div class="font-semibold font-mono text-sm">{{ e.libelle }}</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Date d'échéance</div><div class="font-semibold">{{ formatDateFr(e.dateEcheance) }}</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Maturité</div><div class="font-semibold">{{ maturite(e) }}</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Valeur unitaire</div><div class="font-semibold">{{ e.valeurNominaleUnitaire | number:'1.0-0':'fr-FR' }} FCFA</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Volume d'émission</div><div class="font-semibold">{{ volumeMillions(e) | number:'1.0-0':'fr-FR' }} millions FCFA</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Date limite de souscription</div><div class="font-semibold">{{ formatDateFr(dateLimite(e)) }}</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Heure limite de souscription</div><div class="font-semibold text-afb-red">{{ heure(e) }}</div></div>
            <div><div class="text-[11px] text-gray-500 uppercase">Taux / Prix</div><div class="font-semibold">{{ tauxPrix(e) }}</div></div>
            <div class="sm:col-span-2 lg:col-span-3"><div class="text-[11px] text-gray-500 uppercase">Observations</div><div class="font-semibold">{{ e.observation || '—' }}</div></div>
          </div>
        </div>
        <afb-forecast-card [emissionId]="e.id" />
      </div>
    }
  `
})
export class EmissionDetail {
  data = inject(MockData);
  route = inject(ActivatedRoute);
  emission = computed(() => this.data.getEmission(this.route.snapshot.params['id']));

  emetteurUpper(s: string) { return (s || '').toUpperCase(); }
  formatDateFr(s: string) {
    const [y, m, day] = (s || '').slice(0, 10).split('-');
    return y && m && day ? `${day}/${m}/${y}` : (s || '—');
  }
  maturite(e: { nature: 'BTA' | 'OTA'; dureeJours: number }) {
    if (e.nature === 'BTA') {
      const sem = Math.round(e.dureeJours / 7);
      return `${sem} semaine${sem > 1 ? 's' : ''}`;
    }
    const an = Math.round(e.dureeJours / 365);
    return `${an} an${an > 1 ? 's' : ''}`;
  }
  volumeMillions(e: { montantGlobal: number }) { return Math.round(e.montantGlobal / 1_000_000); }
  dateLimite(e: { fermetureSouscription: string }) { return (e.fermetureSouscription || '').slice(0, 10); }
  heure(e: { fermetureSouscription: string }) {
    const s = e.fermetureSouscription || '';
    const sep = s.indexOf(' ') >= 0 ? s.indexOf(' ') : s.indexOf('T');
    if (sep < 0) return '—';
    const [h, m] = s.slice(sep + 1).split(':');
    return h ? `${h}h${m || '00'}mn` : '—';
  }
  tauxPrix(e: { tauxNominal: number }) {
    return !e.tauxNominal ? 'ADJ' : e.tauxNominal.toString().replace('.', ',') + ' %';
  }
}

@Component({
  selector: 'afb-order-form',
  imports: [FormsModule, RouterLink, DecimalPipe, OtpDialog, ConfirmDialog, SignatureField,
            ModalShell, FaceScanComponent],
  template: `
    @if (emission(); as e) {
      <div class="max-w-4xl">
        <a routerLink="/client/emissions" class="text-sm text-gray-500">← Retour aux émissions</a>

        <div class="card mt-3 p-4 sm:p-8 md:p-10 overflow-x-auto" style="font-family: 'Times New Roman', serif;">
          <div class="text-right text-sm">Yaoundé, le <input class="border-b border-gray-400 outline-none w-32" type="date" [(ngModel)]="form.date" name="date"></div>
          <h2 class="text-center text-lg font-bold mt-6">Afriland First Bond</h2>

          <div class="mt-8 space-y-3 text-sm">
            <div class="flex items-baseline"><b class="w-28">Objet :</b><span>Achat de Valeurs Trésor</span></div>
          </div>

          <p class="mt-6 text-sm">Nous vous remettons ci-après, notre ordre pour l'achat des valeurs du Trésor détaillées ci-dessous :</p>

          <ul class="mt-3 ml-6 text-sm space-y-1">
            <li>- ISIN : <input class="border-b border-gray-400 outline-none w-64 font-mono" [value]="e.isin" readonly></li>
            <li>- Code émission : <input class="border-b border-gray-400 outline-none w-64 font-mono" [value]="e.code" readonly></li>
            <li>- Nature (OTA ou BTA) : <input class="border-b border-gray-400 outline-none w-32" [value]="e.nature" readonly></li>
            <li>- Emetteur : <input class="border-b border-gray-400 outline-none w-64" [value]="e.emetteur + ' (' + e.paysCode + ')'" readonly></li>
          </ul>

          <table class="w-full border border-black mt-6 text-sm">
            <thead>
              <tr class="bg-gray-50">
                <th class="border border-black px-3 py-2">Volume demandé</th>
                <th class="border border-black px-3 py-2">Montant demandé</th>
                <th class="border border-black px-3 py-2">Montant en lettres (FCFA)</th>
                <th class="border border-black px-3 py-2">Prix/Taux</th>
              </tr>
            </thead>
            <tbody>
              @for (l of lignes; track $index; let i = $index) {
                <tr>
                  <td class="border border-black p-0">
                    <input class="w-full px-2 py-2 outline-none" type="number" min="0" [(ngModel)]="l.volume" name="vol{{i}}" (ngModelChange)="recalc()">
                  </td>
                  <td class="border border-black p-0">
                    <input class="w-full px-2 py-2 outline-none text-right font-mono" [value]="(l.volume * e.valeurNominaleUnitaire) | number:'1.0-0':'fr-FR'" readonly>
                  </td>
                  <td class="border border-black p-0">
                    <input class="w-full px-2 py-2 outline-none italic text-xs" [value]="enLettres(l.volume * e.valeurNominaleUnitaire)" readonly>
                  </td>
                  <td class="border border-black p-0">
                    <input class="w-full px-2 py-2 outline-none text-right" type="number" step="0.01" [(ngModel)]="l.taux" name="tx{{i}}">
                  </td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr class="bg-gray-50">
                <td class="border border-black px-3 py-2 font-bold text-right" colspan="1">Total</td>
                <td class="border border-black px-3 py-2 text-right font-mono font-bold">{{ totalMontant() | number:'1.0-0':'fr-FR' }}</td>
                <td class="border border-black px-3 py-2 italic text-xs">{{ enLettres(totalMontant()) }}</td>
                <td class="border border-black px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>

          <p class="mt-6 text-sm">Pour la réalisation dudit ordre, nous vous autorisons à débiter notre compte dans vos livres :</p>

          <ul class="mt-3 ml-6 text-sm space-y-2">
            <li class="flex items-baseline gap-2">• <b class="w-32">Numéro de compte :</b><input class="flex-1 border-b border-gray-400 outline-none font-mono" [(ngModel)]="form.compte" name="compte"></li>
            @for (cpt of comptesSecondaires; track $index; let i = $index) {
              <li class="flex items-baseline gap-2">
                • <b class="w-32">Compte additionnel :</b>
                <input class="flex-1 border-b border-gray-400 outline-none font-mono"
                       [(ngModel)]="comptesSecondaires[i]" name="compteSec{{i}}" placeholder="037 XXXXX XXXXXXXXXXX">
                <button type="button" class="text-red-600 text-xs no-print" (click)="removeCompte(i)" title="Retirer">✕</button>
              </li>
            }
            <li class="no-print">
              <button type="button" class="btn btn-outline btn-xs" (click)="addCompte()">+ Ajouter un compte espèces</button>
              <span class="text-[11px] text-gray-500 ml-2">Le 1<sup>er</sup> compte est celui débité ; les autres sont enregistrés à titre de référence.</span>
            </li>
            <li class="flex items-baseline gap-2">• <b class="w-32">Intitulé :</b><input class="flex-1 border-b border-gray-400 outline-none" [(ngModel)]="form.intitule" name="intitule"></li>
            <li class="flex items-baseline gap-2">• <b class="w-32">Téléphone :</b><input class="flex-1 border-b border-gray-400 outline-none" [(ngModel)]="form.telephone" name="telephone"></li>
          </ul>

          <div class="mt-5 space-y-2 text-sm">
            <div class="flex items-baseline gap-2">Personne(s) à Contacter : <input class="flex-1 border-b border-gray-400 outline-none" [(ngModel)]="form.contactNom" name="contactNom"></div>
            <div class="flex items-baseline gap-2">Téléphone : <input class="flex-1 border-b border-gray-400 outline-none" [(ngModel)]="form.contactTel" name="contactTel"></div>
            <div class="flex items-baseline gap-2">Adresse mail : <input class="flex-1 border-b border-gray-400 outline-none" type="email" [(ngModel)]="form.contactMail" name="contactMail"></div>
          </div>

          <p class="mt-8 text-sm">Veuillez agréer, Monsieur le Directeur Général, l'assurance de notre considération distinguée.</p>

          <div class="mt-8 text-center">
            <div class="font-bold text-sm">Signature(s) autorisée(s)</div>
            <div class="mt-2 h-16 border-b-2 border-dashed border-gray-400 max-w-xs mx-auto grid place-items-center text-xs text-gray-400 italic">
              Signature électronique (MFA · OTP 5 min)
            </div>
          </div>
        </div>

        <div class="card mt-4 p-4 sm:p-5 text-sm">
          <div class="text-[11px] text-gray-500 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>• Contrôle de fenêtre de souscription : <b class="text-emerald-600">OK</b> (ferme le {{ e.fermetureSouscription }})</div>
            <div>• Contrôle montant minimum ({{ e.montantMinimum | number:'1.0-0':'fr-FR' }} FCFA) : <b [class.text-emerald-600]="totalMontant() >= e.montantMinimum" [class.text-red-600]="totalMontant() < e.montantMinimum">{{ totalMontant() >= e.montantMinimum ? 'OK' : 'KO' }}</b></div>
            <div>• Contrôle cohérence volume/nominal : <b class="text-emerald-600">OK</b></div>
            <div>• Contrôle doublon : <b class="text-emerald-600">OK</b></div>
          </div>
          <label class="flex items-start gap-2 mt-4 pt-4 border-t text-xs text-gray-700">
            <input type="checkbox" class="mt-0.5" [(ngModel)]="form.accepte" name="accepte">
            J'accepte les mentions obligatoires et je confirme être le donneur d'ordre. Conforme aux directives BEAC et instructions COBAC.
          </label>
        </div>

        <div class="card mt-4 p-4 sm:p-5">
          <h3 class="text-sm font-semibold mb-1">Signature(s) autorisée(s)</h3>
          <p class="text-xs text-gray-500 mb-3">Tout ordre signé ne peut être annulé une fois exécuté. La signature est envoyée au back-office pour vérification.</p>
          <afb-signature-field
            [(signatureData)]="form.signatureData"
            [height]="160"
            label="Cliquez pour signer cet ordre"
            hint="Souris, doigt ou stylet — la signature sera transmise au back-office."
            dialogTitle="Signature de l'ordre"
            dialogMessage="Apposez votre signature pour valider l'ordre. Cette action est irréversible une fois soumise." />
        </div>

        <div class="flex flex-col sm:flex-row sm:justify-between gap-2 mt-4">
          <a routerLink="/client/emissions" class="btn btn-outline">Annuler</a>
          <div class="flex flex-col sm:flex-row gap-2">
            <button class="btn btn-outline" (click)="addLigne()">+ Ajouter une ligne</button>
            <button class="btn btn-primary" (click)="askSubmit()">Soumettre l'ordre (MFA · OTP) →</button>
          </div>
        </div>
      </div>
    }

    <afb-otp-dialog [open]="otpOpen()" title="Confirmation de l'ordre — OTP (5 min)"
      message="Un code de vérification vous a été envoyé par e-mail. Saisissez-le pour confirmer l'ordre (validité 5 min). La provision sera réservée immédiatement."
      (confirm)="onOtpConfirmed($event)" (cancel)="otpOpen.set(false)" />

    <afb-confirm-dialog [open]="confirmExistingOpen()"
      title="Ordre déjà soumis sur ce titre"
      [message]="confirmExistingMessage()"
      confirmLabel="Soumettre quand même"
      (confirm)="onConfirmExisting()" (cancel)="confirmExistingOpen.set(false)" />

    <!-- Contrôle facial APRÈS soumission : l'ordre est déjà enregistré, ce
         contrôle ne peut donc jamais l'empêcher. Il est comparé côté serveur à
         la photo prise à l'ouverture du compte, pour la revue du back-office. -->
    <afb-modal [open]="faceCheckOpen()" size="md" (cancel)="passerControle()">
      <div class="p-5 sm:p-6">
        <h2 class="text-lg font-bold text-center">Contrôle de sécurité</h2>
        <p class="text-sm text-gray-500 text-center mt-1">
          Votre ordre <b>a bien été soumis</b>. Prenez une photo pour confirmer que
          c'est bien vous — elle sera comparée à celle de l'ouverture de votre compte.
        </p>
        <div class="mt-4">
          <afb-face-scan (captured)="onFaceCheck($event)" />
        </div>
        <button type="button" class="btn btn-ghost w-full mt-3 text-xs" (click)="passerControle()">
          Passer cette étape (l'ordre reste soumis)
        </button>
      </div>
    </afb-modal>
  `
})
export class OrderForm {
  otpOpen = signal(false);
  confirmExistingOpen = signal(false);

  /** Contrôle facial post-soumission (l'ordre est déjà enregistré). */
  private readonly faceCheck = inject(FaceCheckService);
  readonly faceCheckOpen = signal(false);
  readonly orderSoumisId = signal<string | null>(null);
  /** Ordres encore actifs déjà soumis par le client SUR CE MÊME TITRE. */
  existingActiveOrders = computed(() => {
    const emId = this.emission()?.id;
    if (!emId) return [];
    return this.data.orders().filter(o =>
      o.emissionId === emId &&
      (o.status === 'SOUMIS' || o.status === 'EN_VERIFICATION'
        || o.status === 'EN_ATTENTE_ADJUDICATION' || o.status === 'EN_ATTENTE_SIGNATURES')
    );
  });
  confirmExistingMessage = computed(() => {
    const n = this.existingActiveOrders().length;
    const titre = this.emission()?.code || this.emission()?.libelle || 'ce titre';
    return `Vous avez déjà soumis ${n} ordre${n > 1 ? 's' : ''} en cours sur le titre « ${titre} ». `
      + `Êtes-vous sûr de vouloir soumettre un nouvel ordre pour le même titre ?`;
  });
  onConfirmExisting() {
    this.confirmExistingOpen.set(false);
    this.sendOtp();
  }
  /** Ouvre le dialogue OTP si l'ordre est complet ; sinon explique ce qui manque. */
  askSubmit() {
    const e = this.emission();
    if (!e) { this.toast.error('Émission introuvable', 'Rechargez la page du marché primaire.'); return; }
    if (this.totalMontant() <= 0) {
      this.toast.error('Volume requis', 'Saisissez un volume sur au moins une ligne.');
      return;
    }
    if (!this.minOk()) {
      this.toast.error('Montant insuffisant',
        `Le total doit atteindre le minimum de souscription (${e.montantMinimum.toLocaleString('fr-FR')} FCFA).`);
      return;
    }
    if (!this.form.signatureData) {
      this.toast.error('Signature requise', "Apposez votre signature avant de soumettre l'ordre.");
      return;
    }
    if (!this.form.accepte) {
      this.toast.error('Mentions à accepter', "Cochez la case d'acceptation des mentions obligatoires.");
      return;
    }
    // Si le client a déjà des souscriptions actives, demander confirmation avant OTP.
    if (!this.editingOrderId() && this.existingActiveOrders().length > 0) {
      this.confirmExistingOpen.set(true);
      return;
    }
    this.sendOtp();
  }
  data = inject(MockData);
  auth = inject(AuthService);
  route = inject(ActivatedRoute);
  router = inject(Router);
  toast = inject(ToastService);
  /** Défi OTP courant (envoyé avant la confirmation d'ordre). */
  otpChallengeId = '';
  otpSending = signal(false);

  /** Envoie un OTP réel par e-mail puis ouvre le dialogue de saisie. */
  sendOtp() {
    if (this.otpSending()) return;
    this.otpSending.set(true);
    this.auth.sendActionOtp().subscribe({
      next: (r) => {
        this.otpSending.set(false);
        this.otpChallengeId = r.challengeId;
        this.otpOpen.set(true);
      },
      error: () => {
        this.otpSending.set(false);
        this.toast.error('Envoi OTP impossible', 'Le code de vérification n\'a pas pu être envoyé. Réessayez.');
      },
    });
  }

  /** Vérifie le code OTP saisi ; en cas de succès, soumet/modifie l'ordre. */
  onOtpConfirmed(code: string) {
    this.auth.verifyActionOtp(this.otpChallengeId, code).subscribe({
      next: () => this.submit(),
      error: () => this.toast.error('Code incorrect', 'Le code OTP est invalide ou expiré.'),
    });
  }
  user = this.data.currentUser;
  editingOrderId = signal<string | null>(null);
  emission = computed(() => {
    const editId = this.editingOrderId();
    if (editId) {
      const o = this.data.getOrder(editId);
      return o ? this.data.getEmission(o.emissionId) : undefined;
    }
    return this.data.getEmission(this.route.snapshot.params['emissionId']);
  });

  lignes: { volume: number; taux: number }[] = [
    { volume: 10, taux: 5.80 },
    { volume: 0, taux: 0 }
  ];

  /** Comptes espèces additionnels (le 1er est `form.compte`, débité). */
  comptesSecondaires: string[] = [];
  addCompte() { this.comptesSecondaires.push(''); }
  removeCompte(i: number) { this.comptesSecondaires.splice(i, 1); }

  form: any = {
    date: new Date().toISOString().slice(0, 10),
    client: '',
    compte: '',
    intitule: '',
    telephone: '',
    contactNom: '',
    contactTel: '',
    contactMail: '',
    accepte: false,
    signatureData: ''
  };

  constructor() {
    const editId = this.route.snapshot.params['id'];
    if (editId) {
      const existing = this.data.getOrder(editId);
      if (existing && !existing.printedBySvt && existing.status === 'SOUMIS') {
        this.editingOrderId.set(editId);
        this.lignes = [{ volume: existing.volume, taux: existing.tauxSoumis }];
        this.form.signatureData = existing.signatureData ?? '';
        this.form.accepte = true;
      } else if (existing) {
        queueMicrotask(() => this.router.navigate(['/client/orders', editId]));
      }
    }
    queueMicrotask(() => {
      const u = this.user();
      this.form.client = `${u.prenom ?? ''} ${u.nom}`.trim();
      this.form.compte = u.compteEspeces ?? '';
      this.form.intitule = this.form.client;
      // Numero de telephone REEL du client (enregistre a la creation du compte) ;
      // laisse vide s'il n'en a pas. Ne plus utiliser de valeur factice.
      this.form.telephone = u.telephone ?? '';
      this.form.contactNom = this.form.client;
      this.form.contactTel = u.telephone ?? '';
      this.form.contactMail = u.email;
    });
  }

  _tick = signal(0);
  recalc() { this._tick.update(v => v + 1); }
  addLigne() { this.lignes.push({ volume: 0, taux: 0 }); this.recalc(); }

  totalMontant = computed(() => {
    this._tick();
    const nominal = this.emission()?.valeurNominaleUnitaire ?? 0;
    return this.lignes.reduce((s, l) => s + (Number(l.volume) || 0) * nominal, 0);
  });
  totalAvecFrais = computed(() => this.totalMontant() + Math.round(this.totalMontant() * 0.001));
  minOk = computed(() => this.totalMontant() >= (this.emission()?.montantMinimum ?? 0));
  /** Méthode (et non `computed`) : `form.accepte` / `form.signatureData` ne sont
   *  pas des signaux ; un `computed` resterait mémoïsé et n'enregistrerait jamais
   *  la case cochée ou la signature. Évaluée à chaque cycle de détection.
   *
   *  La vérification de provision n'est plus côté client : elle est faite par
   *  le back-office via Amplitude/AIF au moment de la validation de l'ordre. */
  canSubmit(): boolean {
    return this.form.accepte && this.totalMontant() > 0 && this.minOk() && !!this.form.signatureData;
  }

  enLettres(montant: number): string {
    if (!montant) return '';
    const units = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
    const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
    const below1000 = (n: number): string => {
      if (n === 0) return '';
      if (n < 17) return units[n];
      if (n < 20) return 'dix-' + units[n - 10];
      if (n < 100) {
        const t = Math.floor(n / 10), u = n % 10;
        if (t === 7 || t === 9) return tens[t] + '-' + units[10 + u];
        return tens[t] + (u ? '-' + units[u] : (t === 8 ? 's' : ''));
      }
      const c = Math.floor(n / 100), r = n % 100;
      return (c === 1 ? 'cent' : units[c] + ' cent' + (r === 0 ? 's' : '')) + (r ? ' ' + below1000(r) : '');
    };
    const convert = (n: number): string => {
      if (n === 0) return 'zéro';
      const mil = Math.floor(n / 1_000_000_000);
      const rest1 = n % 1_000_000_000;
      const m = Math.floor(rest1 / 1_000_000);
      const rest2 = rest1 % 1_000_000;
      const k = Math.floor(rest2 / 1000);
      const u = rest2 % 1000;
      let out = '';
      if (mil) out += (mil === 1 ? 'un' : below1000(mil)) + ' milliard' + (mil > 1 ? 's' : '') + ' ';
      if (m) out += (m === 1 ? 'un' : below1000(m)) + ' million' + (m > 1 ? 's' : '') + ' ';
      if (k) out += (k === 1 ? 'mille' : below1000(k) + ' mille') + ' ';
      if (u) out += below1000(u);
      return out.trim();
    };
    return convert(Math.floor(montant)) + ' francs CFA';
  }

  buildSnapshot(nominal: number): import('../../core/models/models').ClientOrderForm {
    const lignes = this.lignes.map(l => {
      const montant = (Number(l.volume) || 0) * nominal;
      return { volume: Number(l.volume) || 0, taux: Number(l.taux) || 0, montant, montantLettres: this.enLettres(montant) };
    });
    const totalMontant = lignes.reduce((s, l) => s + l.montant, 0);
    return {
      date: this.form.date,
      client: this.form.client,
      intitule: this.form.intitule,
      telephone: this.form.telephone,
      contactNom: this.form.contactNom,
      contactTel: this.form.contactTel,
      contactMail: this.form.contactMail,
      compte: this.form.compte,
      comptesAdditionnels: this.comptesSecondaires
        .map(c => (c || '').trim())
        .filter(c => c.length > 0),
      lignes,
      totalMontant,
      totalLettres: this.enLettres(totalMontant),
      signatureData: this.form.signatureData
    };
  }

  submit() {
    this.otpOpen.set(false);
    const e = this.emission();
    if (!e) return;
    const total = this.lignes.reduce((s, l) => s + (Number(l.volume) || 0), 0);
    const avgTaux = this.lignes.filter(l => l.volume > 0).reduce((s, l, _, a) => s + l.taux / a.length, 0);

    const snapshot = this.buildSnapshot(e.valeurNominaleUnitaire);

    const editId = this.editingOrderId();
    if (editId) {
      this.data.updateClientOrder(editId, { volume: total, taux: Math.round(avgTaux * 100) / 100, signatureData: this.form.signatureData, formSnapshot: snapshot })
        .subscribe(ok => {
          if (ok) {
            this.toast.success('Ordre modifié', 'Vos modifications ont été enregistrées.');
            this.router.navigate(['/client/orders', editId]);
          } else {
            this.toast.error('Modification refusée', 'Ordre verrouillé ou non modifiable.');
          }
        });
      return;
    }

    this.data.addOrder({ emissionId: e.id, volume: total, taux: Math.round(avgTaux * 100) / 100, compteEspeces: this.form.compte, signatureData: this.form.signatureData, formSnapshot: snapshot })
      .subscribe({
        next: order => {
          if (order) {
            this.toast.success('Ordre soumis', `${order.reference} · ${order.montant.toLocaleString('fr-FR')} FCFA`);
            // L'ordre EST soumis. On demande ensuite la photo de contrôle : elle ne
            // peut donc rien remettre en cause, seulement alimenter la revue du BO.
            this.orderSoumisId.set(order.id);
            this.faceCheckOpen.set(true);
          }
        },
        // Affiche le motif renvoyé par le backend (ex. ordre déjà soumis sur cette émission).
        error: (err) => this.toast.error('Ordre rejeté', err?.message || "La soumission de l'ordre a échoué."),
      });
  }

  // ─── Contrôle facial post-soumission (jamais bloquant) ────────────────────

  /** Photo prise : envoyée au serveur, qui seul juge de la correspondance. */
  onFaceCheck(face: FaceCaptureResult) {
    const orderId = this.orderSoumisId();
    this.faceCheckOpen.set(false);
    if (!orderId) return;

    this.faceCheck.checkOrder(orderId, face).subscribe(res => {
      // Un visage différent ne refuse PAS l'ordre : il est signalé au back-office.
      if (res && res.matchStatus === 'DIFFERENT') {
        this.toast.warn('Contrôle facial à vérifier',
          "Votre visage ne correspond pas à celui de l'ouverture de compte. Votre ordre reste soumis et sera vérifié par la banque.");
      } else if (res?.matched) {
        this.toast.success('Identité confirmée');
      }
      this.allerAuDetail(orderId);
    });
  }

  /** L'utilisateur passe le contrôle : l'ordre reste soumis (le BO le verra sans photo). */
  passerControle() {
    const orderId = this.orderSoumisId();
    this.faceCheckOpen.set(false);
    if (orderId) this.allerAuDetail(orderId);
  }

  private allerAuDetail(orderId: string) {
    this.orderSoumisId.set(null);
    this.router.navigate(['/client/orders', orderId]);
  }
}

@Component({
  selector: 'afb-orders-list',
  imports: [RouterLink, DecimalPipe, Paginator, PaginatePipe, FormsModule],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Mes ordres</h1>
        <div class="flex gap-2">
          <select class="select w-auto" [ngModel]="filterStatus()" (ngModelChange)="filterStatus.set($event); page.set(1)" name="fs">
            <option value="">Tous les statuts</option>
            @for (s of statusList; track s) {
              <option [value]="s">{{ label(s) }}</option>
            }
          </select>
          <button class="btn btn-outline">⬇ Exporter</button>
        </div>
      </div>
      <div class="card overflow-hidden">
        <div class="overflow-x-auto"><table class="table min-w-[720px] sm:min-w-full">
          <thead>
            <tr>
              <th>Référence</th><th>Émission · ISIN</th><th>Volume</th><th>Montant</th><th>Taux</th><th>Date</th><th>Canal</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            @for (o of (filtered() | paginate:page():25); track o.id) {
              <tr>
                <td class="font-mono text-xs">{{ o.reference }}</td>
                <td><div class="font-semibold">{{ o.emissionCode }}</div><div class="text-xs font-mono text-gray-500">{{ o.isin }}</div></td>
                <td>{{ o.volume }}</td>
                <td>{{ o.montant | number:'1.0-0':'fr-FR' }} FCFA</td>
                <td>{{ o.tauxSoumis }} %</td>
                <td class="text-xs">{{ o.dateSoumission }}</td>
                <td><span class="badge bg-gray-100 text-gray-700">{{ o.canal }}</span></td>
                <td><span class="badge" [class]="badgeClass(o.status)">{{ label(o.status) }}</span></td>
                <td class="whitespace-nowrap">
                  <a [routerLink]="['/client/orders', o.id]" class="text-afb-red text-sm">Détails</a>
                </td>
              </tr>
            }
          </tbody>
        </table></div>
        <afb-paginator [total]="filtered().length" [pageSize]="25" [(page)]="page" />
      </div>
    </div>
  `
})
export class OrdersList {
  data = inject(MockData);
  /** Recharge les ordres depuis la BD à l'ouverture — statuts à jour. */
  constructor() { this.data.refreshOrders(); }
  page = signal(1);
  filterStatus = model<OrderStatus | ''>('');
  statusList: OrderStatus[] = ['SOUMIS', 'EN_VERIFICATION', 'EN_ATTENTE_ADJUDICATION', 'TOTALEMENT_RETENU', 'PARTIELLEMENT_RETENU', 'NON_RETENU', 'ANNULE'];
  filtered = computed(() => {
    const fs = this.filterStatus();
    return this.data.orders().filter(o => !fs || o.status === fs);
  });
  label(s: OrderStatus) { return ORDER_STATUS_LABELS[s]; }
  badgeClass(s: OrderStatus) { return orderBadgeClass(s); }
}

@Component({
  selector: 'afb-order-detail',
  imports: [RouterLink, DecimalPipe, OtpDialog],
  template: `
    @if (order(); as o) {
      <div class="max-w-4xl">
        <a routerLink="/client/orders" class="text-sm text-gray-500 no-print">← Mes ordres</a>
        <div class="card mt-3 print-area">
          <div class="card-header no-print">
            <div>
              <h1 class="text-xl font-bold">Ordre {{ o.reference }}</h1>
              <p class="text-sm text-gray-500">{{ o.emissionCode }} · ISIN {{ o.isin }} · {{ o.dateSoumission }}</p>
            </div>
            <span class="badge" [class]="badgeClass(o.status)">{{ label(o.status) }}</span>
          </div>

          <div class="p-6">
            <div class="flex items-center justify-between mb-2 no-print">
              @for (s of steps; track s; let i = $index) {
                <div class="flex-1 flex items-center">
                  <div class="w-8 h-8 rounded-full grid place-items-center text-xs font-bold"
                       [class.bg-emerald-600]="reached(s)" [class.text-white]="reached(s)"
                       [class.bg-gray-200]="!reached(s)" [class.text-gray-500]="!reached(s)">{{ i + 1 }}</div>
                  @if (i < steps.length - 1) { <div class="flex-1 h-1" [class.bg-emerald-600]="reached(s)" [class.bg-gray-200]="!reached(s)"></div> }
                </div>
              }
            </div>
            <div class="flex justify-between text-xs text-gray-500 mb-6 no-print">
              <span>Soumis</span><span>Vérification</span><span>Attente adjud.</span><span>Résultat</span>
            </div>

            <!-- Suivi du workflow — acteurs et horodatages (CSFT §M2-S01) -->
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

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Client</div><div class="font-semibold">{{ o.clientNom }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Émission · ISIN</div><div class="font-semibold font-mono">{{ o.emissionCode }} · {{ o.isin }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Nature / Émetteur</div><div class="font-semibold">{{ o.nature }} · {{ o.emetteur }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Compte espèces</div><div class="font-mono">{{ o.compteEspeces }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Compte titres</div><div class="font-mono">{{ o.compteTitres }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Canal</div><div class="font-semibold">{{ o.canal }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Volume demandé</div><div class="font-semibold">{{ o.volume }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Volume alloué</div><div class="font-semibold">{{ o.volumeAlloue ?? '—' }}</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Montant offert</div><div class="font-semibold">{{ o.montant | number:'1.0-0':'fr-FR' }} FCFA</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Montant adjugé / débité</div><div class="font-semibold">{{ (o.montantDebite ?? 0) | number:'1.0-0':'fr-FR' }} FCFA</div></div>
              <div class="border-t pt-3"><div class="text-xs text-gray-500">Taux soumis / adjugé</div><div class="font-semibold">{{ o.tauxSoumis }} % {{ o.tauxAdjuge ? '/ ' + o.tauxAdjuge + ' %' : '' }}</div></div>
            </div>

            @if (o.printedBySvt) {
              <div class="mt-4 p-3 rounded-lg border border-gray-300 bg-gray-50 text-sm text-gray-700 no-print">
                🔒 <b>Ordre verrouillé</b> — pris en charge par l'agent SVT le {{ o.printedAt }}. Plus aucune modification possible.
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
                    <b class="text-red-800">Votre ordre a été rejeté par le back-office.</b>
                    <div class="text-sm text-red-900 mt-1"><b>Motif :</b> {{ o.motifAnnulation }}</div>
                    <div class="text-[11px] text-red-700 mt-1">Provision libérée sur votre compte espèces. Pour toute clarification, contactez votre conseiller.</div>
                  </div>
                </div>
              </div>
            }
            @if (o.status === 'EN_ATTENTE_ADJUDICATION') {
              <div class="mt-4 p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm">
                <b class="text-emerald-800">✓ Votre ordre est validé et en cours de traitement.</b>
              </div>
            }

            <div class="mt-6 flex flex-wrap gap-2 no-print">
              @if (canModify(o)) {
                <a [routerLink]="['/client/orders', o.id, 'edit']" class="btn btn-outline">✏️ Modifier l'ordre</a>
                <button class="btn btn-danger" (click)="askCancel()">🗑 Annuler l'ordre</button>
              }
            </div>
            @if (o.status === 'TOTALEMENT_RETENU' || o.status === 'PARTIELLEMENT_RETENU' || o.status === 'NON_RETENU') {
              <div class="mt-3 text-xs text-gray-500 no-print">
                📄 Vos documents (avis d'opéré, etc.) sont disponibles dans le menu <a routerLink="/client/documents" class="text-afb-red font-medium">Documents</a>.
              </div>
            }
          </div>
        </div>
      </div>

      <afb-otp-dialog [open]="otpOpen()" title="Annulation d'ordre — OTP (5 min)"
        message="Confirmez l'annulation par code OTP. Validité : 5 minutes. La provision réservée sera libérée."
        (confirm)="otpConfirmed($event)" (cancel)="otpOpen.set(false)" />
    }
  `
})
export class OrderDetail {
  data = inject(MockData);
  auth = inject(AuthService);
  route = inject(ActivatedRoute);
  toast = inject(ToastService);
  private readonly pdfProgress = inject(PdfProgressService);
  router = inject(Router);
  /** Recharge les ordres depuis la BD — le statut affiché reflète l'état courant. */
  constructor() { this.data.refreshOrders(); }
  order = computed(() => this.data.getOrder(this.route.snapshot.params['id']));
  steps: OrderStatus[] = ['SOUMIS', 'EN_VERIFICATION', 'EN_ATTENTE_ADJUDICATION', 'TOTALEMENT_RETENU'];
  otpOpen = signal(false);
  otpChallengeId = '';
  otpSending = signal(false);

  reached(s: OrderStatus) {
    const cur = this.order()?.status;
    if (!cur) return false;
    if ((cur === 'PARTIELLEMENT_RETENU' || cur === 'NON_RETENU') && s === 'TOTALEMENT_RETENU') return true;
    return this.steps.indexOf(cur as OrderStatus) >= this.steps.indexOf(s);
  }
  canModify(o: { status: OrderStatus; printedBySvt?: boolean }) {
    return !o.printedBySvt && o.status === 'SOUMIS';
  }
  label(s: OrderStatus) { return ORDER_STATUS_LABELS[s]; }
  badgeClass(s: OrderStatus) { return orderBadgeClass(s); }

  /** Envoie un OTP réel par e-mail puis ouvre le dialogue de saisie. */
  askCancel() {
    if (this.otpSending()) return;
    this.otpSending.set(true);
    this.auth.sendActionOtp().subscribe({
      next: (r) => {
        this.otpSending.set(false);
        this.otpChallengeId = r.challengeId;
        this.otpOpen.set(true);
      },
      error: () => {
        this.otpSending.set(false);
        this.toast.error('Envoi OTP impossible', 'Le code de vérification n\'a pas pu être envoyé. Réessayez.');
      },
    });
  }
  otpConfirmed(code: string) {
    const o = this.order();
    if (!o) { this.otpOpen.set(false); return; }
    // Vérifie le code OTP côté serveur avant d'annuler l'ordre.
    this.auth.verifyActionOtp(this.otpChallengeId, code).subscribe({
      next: () => {
        this.otpOpen.set(false);
        if (this.data.cancelOrder(o.id)) {
          this.toast.info('Ordre annulé', 'Provision libérée.');
        }
      },
      error: () => this.toast.error('Code incorrect', 'Le code OTP est invalide ou expiré.'),
    });
  }
  print() { if (typeof window !== 'undefined') window.print(); }
  async downloadOrder() {
    const o = this.order();
    if (!o) return;
    this.pdfProgress.start();
    try {
      await downloadClientOrderPdf(o, (p, l) => this.pdfProgress.set(p, l));
      this.pdfProgress.done();
      this.toast.success('Téléchargement', `Ordre ${o.reference}.pdf téléchargé.`);
    } catch {
      this.pdfProgress.fail();
      this.toast.error('Échec PDF', "Impossible de générer le PDF de l'ordre.");
    }
  }
}

