import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { MockData } from '../../core/services/mock-data';
import { ToastService } from '../../core/services/toast';
import { Order, ORDER_STATUS_LABELS } from '../../core/models/models';
import { BarChart, LineChart, DonutChart, ChartDatum } from '../../shared/charts';
import { arrayToCsv, downloadBlob } from '../../shared/download';
import {
  ordersInRange, volumeTotal, activeClients, successRate, volumeByMonth,
  countByMonth, emetteurSplit, topClients, pctChange, parseDate,
} from '../../shared/analytics';

/**
 * CSFT §M3 — Rapports et analyses (reporting réglementaire et performance).
 *
 * Tous les indicateurs et graphiques sont calculés en temps réel à partir des
 * ordres collectés (aucune donnée fictive). La période et le type de titre sont
 * filtrables ; un export CSV de la période est disponible.
 */
@Component({
  selector: 'afb-bo-rapports',
  imports: [FormsModule, DecimalPipe, BarChart, LineChart, DonutChart],
  template: `
    <div>
      <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Rapports et analyses</h1>
          <p class="text-sm text-gray-500">Reporting réglementaire et analyse de performance</p>
        </div>
        <button class="btn btn-primary" (click)="genReport()">📄 Générer un rapport</button>
      </div>

      <!-- Filtres -->
      <div class="card card-body mb-6">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Période</label>
            <select class="select" [(ngModel)]="period" name="periode">
              <option value="mois">Ce mois</option>
              <option value="3">3 derniers mois</option>
              <option value="6">6 derniers mois</option>
              <option value="12">12 derniers mois</option>
              <option value="custom">Plage personnalisée</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Type de rapport</label>
            <select class="select" [(ngModel)]="type" name="type">
              <option value="TOUS">Tous</option>
              <option value="BTA">BTA</option>
              <option value="OTA">OTA</option>
            </select>
          </div>
          @if (period() === 'custom') {
            <div class="flex gap-2">
              <div class="flex-1">
                <label class="block text-sm font-medium text-gray-700 mb-1">Du</label>
                <input class="input" type="date" [(ngModel)]="dateDu" name="du" />
              </div>
              <div class="flex-1">
                <label class="block text-sm font-medium text-gray-700 mb-1">Au</label>
                <input class="input" type="date" [(ngModel)]="dateAu" name="au" />
              </div>
            </div>
          } @else {
            <button class="btn btn-outline" (click)="period.set('custom')">📅 Plage personnalisée</button>
          }
        </div>
      </div>

      <!-- KPI -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div class="kpi !p-3 !gap-0.5">
          <span class="kpi-label !text-[10px]">Volume total</span>
          <span class="kpi-value !text-lg">{{ fmtFcfa(volume()) }} FCFA</span>
          <span class="kpi-trend !text-[11px]" [class.!text-rose-600]="volumeTrend() < 0">{{ trend(volumeTrend()) }} vs préc.</span>
        </div>
        <div class="kpi !p-3 !gap-0.5">
          <span class="kpi-label !text-[10px]">Nombre d'ordres</span>
          <span class="kpi-value !text-lg">{{ filtered().length }}</span>
          <span class="kpi-trend !text-[11px]" [class.!text-rose-600]="countTrend() < 0">{{ trend(countTrend()) }} vs préc.</span>
        </div>
        <div class="kpi !p-3 !gap-0.5">
          <span class="kpi-label !text-[10px]">Taux de réussite</span>
          <span class="kpi-value !text-lg">{{ rate() }}%</span>
          <span class="kpi-trend !text-[11px]" [class.!text-rose-600]="rateTrend() < 0">{{ trend(rateTrend()) }} vs préc.</span>
        </div>
        <div class="kpi !p-3 !gap-0.5">
          <span class="kpi-label !text-[10px]">Clients actifs</span>
          <span class="kpi-value !text-lg">{{ clients() }}</span>
          <span class="kpi-trend !text-[11px]" [class.!text-rose-600]="clientsTrend() < 0">{{ trend(clientsTrend()) }} vs préc.</span>
        </div>
      </div>

      <!-- Graphiques 2×2 compact -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        <div class="card">
          <div class="card-header !py-2.5"><h2 class="font-semibold text-sm">Évolution mensuelle (volume)</h2></div>
          <div class="p-3"><afb-line-chart [data]="lineData()" /></div>
        </div>
        <div class="card">
          <div class="card-header !py-2.5"><h2 class="font-semibold text-sm">Performance par produit</h2></div>
          <div class="p-3">
            @if (productData().length) { <afb-donut-chart [data]="productData()" /> }
            @else { <p class="text-xs text-gray-400">Aucun ordre sur la période.</p> }
          </div>
        </div>
        <div class="card">
          <div class="card-header !py-2.5"><h2 class="font-semibold text-sm">Volume par client</h2></div>
          <div class="p-3">
            @if (clientData().length) { <afb-donut-chart [data]="clientData()" /> }
            @else { <p class="text-xs text-gray-400">Aucun ordre sur la période.</p> }
          </div>
        </div>
        <div class="card">
          <div class="card-header !py-2.5"><h2 class="font-semibold text-sm">Nombre d'ordres par mois</h2></div>
          <div class="p-3"><afb-bar-chart [data]="barData()" /></div>
        </div>
      </div>

      <!-- Top clients -->
      <div class="card">
        <div class="card-header"><h2 class="font-semibold">Top 5 clients</h2></div>
        <div class="overflow-x-auto"><table class="table min-w-[640px] sm:min-w-full">
          <thead><tr><th>Rang</th><th>Client</th><th>Volume</th><th>Nombre d'ordres</th><th>Croissance</th></tr></thead>
          <tbody>
            @for (c of topRows(); track c.nom) {
              <tr>
                <td>
                  <span class="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
                        [class]="c.rang === 1 ? 'bg-afb-red text-white' : 'bg-gray-100 text-gray-600'">{{ c.rang }}</span>
                </td>
                <td class="font-medium">{{ c.nom }}</td>
                <td>{{ c.volume | number:'1.0-0':'fr-FR' }}</td>
                <td>{{ c.orders }}</td>
                <td [class]="c.croissance >= 0 ? 'text-emerald-600' : 'text-rose-600'">{{ trend(c.croissance) }}</td>
              </tr>
            }
            @if (!topRows().length) {
              <tr><td colspan="5" class="text-center text-gray-400 py-8">Aucun ordre sur la période sélectionnée.</td></tr>
            }
          </tbody>
        </table></div>
      </div>
    </div>
  `,
})
export class BoRapports {
  private readonly data = inject(MockData);
  private readonly toast = inject(ToastService);

  period = signal<'mois' | '3' | '6' | '12' | 'custom'>('mois');
  type = signal<'TOUS' | 'BTA' | 'OTA'>('TOUS');
  dateDu = signal('');
  dateAu = signal('');

  constructor() {
    this.data.refreshOrders();
  }

  private readonly allOrders = computed(() => this.data.orders());

  /** Fenêtre temporelle [from, to] (ms) + nombre de mois pour les graphiques. */
  private readonly range = computed(() => {
    const now = new Date();
    const p = this.period();
    if (p === 'custom') {
      const from = parseDate(this.dateDu()) ?? new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const to = parseDate(this.dateAu() + ' 23:59') ?? now.getTime();
      const months = Math.min(12, Math.max(1, Math.round((to - from) / (30 * 86_400_000)) || 1));
      return { from: Math.min(from, to), to: Math.max(from, to), months };
    }
    if (p === 'mois') {
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: now.getTime(), months: 1 };
    }
    const n = Number(p);
    return { from: new Date(now.getFullYear(), now.getMonth() - (n - 1), 1).getTime(), to: now.getTime(), months: n };
  });

  private typeFilter(os: Order[]): Order[] {
    const t = this.type();
    return t === 'TOUS' ? os : os.filter((o) => o.nature === t);
  }

  filtered = computed(() => {
    const { from, to } = this.range();
    return this.typeFilter(ordersInRange(this.allOrders(), from, to));
  });

  /** Période précédente de même durée, pour les tendances. */
  private readonly prev = computed(() => {
    const { from, to } = this.range();
    const len = Math.max(1, to - from);
    return this.typeFilter(ordersInRange(this.allOrders(), from - len, from));
  });

  // KPI
  volume = computed(() => volumeTotal(this.filtered()));
  rate = computed(() => successRate(this.filtered()));
  clients = computed(() => activeClients(this.filtered()));

  volumeTrend = computed(() => pctChange(volumeTotal(this.filtered()), volumeTotal(this.prev())));
  countTrend = computed(() => pctChange(this.filtered().length, this.prev().length));
  rateTrend = computed(() => pctChange(successRate(this.filtered()), successRate(this.prev())));
  clientsTrend = computed(() => pctChange(this.clients(), activeClients(this.prev())));

  // Graphiques
  lineData = computed(() => volumeByMonth(this.filtered(), this.range().months));
  barData = computed(() => countByMonth(this.filtered(), this.range().months));
  productData = computed(() => emetteurSplit(this.filtered()));

  /** Concentration du volume par client (top 6 + « Autres »). */
  clientData = computed(() => {
    const tops = topClients(this.filtered(), 6);
    const total = volumeTotal(this.filtered());
    const sumTop = tops.reduce((s, c) => s + c.volume, 0);
    const data: ChartDatum[] = tops.map((c) => ({ label: c.nom, value: c.volume }));
    if (total - sumTop > 0) data.push({ label: 'Autres', value: total - sumTop, color: '#cbd5e1' });
    return data;
  });

  // Top clients avec croissance (volume période vs période précédente).
  topRows = computed(() => {
    const cur = topClients(this.filtered(), 5);
    const prevByNom = new Map<string, number>();
    for (const o of this.prev()) prevByNom.set(o.clientNom, (prevByNom.get(o.clientNom) || 0) + (o.montant || 0));
    return cur.map((c, i) => ({ ...c, rang: i + 1, croissance: pctChange(c.volume, prevByNom.get(c.nom) || 0) }));
  });

  trend(p: number): string { return (p >= 0 ? '+' : '') + p + '%'; }

  fmtFcfa(v: number): string {
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1).replace('.', ',') + ' Md';
    if (v >= 1_000_000) return Math.round(v / 1_000_000) + ' M';
    if (v >= 1_000) return Math.round(v / 1_000) + ' k';
    return String(v);
  }

  /** Export CSV de la période sélectionnée (compatible Excel FR — BOM + séparateur ;). */
  genReport(): void {
    const os = this.filtered();
    if (!os.length) {
      this.toast.warn('Aucune donnée', 'Aucun ordre sur la période sélectionnée.');
      return;
    }
    const rows = os.map((o) => ({
      'N° ordre': o.reference,
      Client: o.clientNom,
      Type: o.nature,
      Émetteur: o.emetteur,
      Montant: o.montant,
      Statut: ORDER_STATUS_LABELS[o.status],
      Date: o.dateSoumission,
    }));
    const csv = '﻿' + arrayToCsv(rows);
    const stamp = (this.range().to && new Date(this.range().to).toISOString().slice(0, 10)) || 'rapport';
    downloadBlob(`rapport-svt-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
    this.toast.success('Rapport généré', `${os.length} ordre(s) exporté(s).`);
  }
}
