import { Order, OrderStatus, TitleType } from '../core/models/models';
import { ChartDatum } from './charts';

/**
 * Agrégations analytiques sur les ordres réels (aucune donnée fictive).
 *
 * Fonctions pures réutilisées par le tableau de bord et la page « Rapports et
 * analyses ». Toutes les valeurs (volumes, comptes, répartitions, tendances)
 * sont dérivées des `Order` chargés depuis le backend.
 */

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

const RED = '#c8102e';
const BLACK = '#111827';

/** Statuts considérés « en attente de traitement » (non finalisés). */
const PENDING: OrderStatus[] = [
  'SOUMIS', 'EN_VERIFICATION', 'EN_ATTENTE_ADJUDICATION', 'EN_ATTENTE_SIGNATURES',
];
/** Statuts « retenus » à l'adjudication (succès). */
const RETAINED: OrderStatus[] = ['TOTALEMENT_RETENU', 'PARTIELLEMENT_RETENU'];
/** Statuts ayant atteint l'adjudication (succès ou rejet). */
const ADJUDICATED: OrderStatus[] = [...RETAINED, 'NON_RETENU'];

/** Convertit « YYYY-MM-DD HH:mm » (ou date simple) en epoch ms, ou null. */
export function parseDate(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isNaN(t) ? null : t;
}

function dateOf(o: Order): Date | null {
  const t = parseDate(o.dateSoumission);
  return t === null ? null : new Date(t);
}

/** Variation en % entre deux valeurs (arrondie). 0 si la base est nulle. */
export function pctChange(current: number, previous: number): number {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/** Filtre les ordres dont la date de soumission tombe dans [from, to] (ms). */
export function ordersInRange(orders: Order[], from: number, to: number): Order[] {
  return orders.filter((o) => {
    const t = parseDate(o.dateSoumission);
    return t !== null && t >= from && t <= to;
  });
}

/** Volume total (somme des montants) des ordres fournis. */
export function volumeTotal(orders: Order[]): number {
  return orders.reduce((s, o) => s + (o.montant || 0), 0);
}

/** Nombre d'ordres en attente de traitement. */
export function pendingCount(orders: Order[]): number {
  return orders.filter((o) => PENDING.includes(o.status)).length;
}

/** Nombre de clients distincts ayant soumis au moins un ordre. */
export function activeClients(orders: Order[]): number {
  return new Set(orders.map((o) => o.clientId)).size;
}

/** Taux de réussite (% d'ordres retenus parmi ceux passés en adjudication). */
export function successRate(orders: Order[]): number {
  const adj = orders.filter((o) => ADJUDICATED.includes(o.status)).length;
  if (!adj) return 0;
  const ok = orders.filter((o) => RETAINED.includes(o.status)).length;
  return Math.round((ok / adj) * 1000) / 10;
}

/** Répartition (volume) BTA vs OTA, prête pour le donut. */
export function natureSplit(orders: Order[]): ChartDatum[] {
  const by: Record<TitleType, number> = { BTA: 0, OTA: 0 };
  for (const o of orders) by[o.nature] = (by[o.nature] || 0) + (o.montant || 0);
  return [
    { label: 'BTA', value: by.BTA, color: RED },
    { label: 'OTA', value: by.OTA, color: BLACK },
  ].filter((d) => d.value > 0);
}

/** Comptage des ordres par jour de la semaine en cours (Lun → Dim). */
export function ordersByWeekday(orders: Order[], now = new Date()): ChartDatum[] {
  // Début de semaine (lundi) à minuit.
  const monday = new Date(now);
  const dow = (monday.getDay() + 6) % 7; // 0 = lundi
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - dow);
  const counts = new Array(7).fill(0);
  for (const o of orders) {
    const d = dateOf(o);
    if (!d) continue;
    const diff = Math.floor((d.getTime() - monday.getTime()) / 86_400_000);
    if (diff >= 0 && diff < 7) counts[diff]++;
  }
  const labels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  return labels.map((label, i) => ({ label, value: counts[i] }));
}

interface MonthBucket { key: string; label: string; }

/** Génère les `n` derniers mois (clé AAAA-MM + libellé court FR). */
function lastMonths(n: number, now = new Date()): MonthBucket[] {
  const out: MonthBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: MONTHS_FR[d.getMonth()] });
  }
  return out;
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

/** Volume mensuel (en millions FCFA) sur les `n` derniers mois. */
export function volumeByMonth(orders: Order[], n: number, now = new Date()): ChartDatum[] {
  const buckets = lastMonths(n, now);
  const sums: Record<string, number> = {};
  for (const o of orders) {
    const d = dateOf(o);
    if (!d) continue;
    sums[monthKey(d)] = (sums[monthKey(d)] || 0) + (o.montant || 0);
  }
  return buckets.map((b) => ({ label: b.label, value: Math.round((sums[b.key] || 0) / 1_000_000) }));
}

/** Nombre d'ordres par mois sur les `n` derniers mois. */
export function countByMonth(orders: Order[], n: number, now = new Date()): ChartDatum[] {
  const buckets = lastMonths(n, now);
  const counts: Record<string, number> = {};
  for (const o of orders) {
    const d = dateOf(o);
    if (!d) continue;
    counts[monthKey(d)] = (counts[monthKey(d)] || 0) + 1;
  }
  return buckets.map((b) => ({ label: b.label, value: counts[b.key] || 0 }));
}

export interface ClientRank {
  nom: string;
  volume: number;
  orders: number;
}

/** Top `n` clients par volume soumis. */
export function topClients(orders: Order[], n: number): ClientRank[] {
  const map = new Map<string, ClientRank>();
  for (const o of orders) {
    const key = o.clientId || o.clientNom;
    const cur = map.get(key) ?? { nom: o.clientNom || '—', volume: 0, orders: 0 };
    cur.volume += o.montant || 0;
    cur.orders += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.volume - a.volume).slice(0, n);
}

/** Répartition (volume) par émetteur — utilisée comme « performance par produit ». */
export function emetteurSplit(orders: Order[]): ChartDatum[] {
  const map = new Map<string, number>();
  for (const o of orders) {
    const k = `${o.nature} · ${o.emetteur}`;
    map.set(k, (map.get(k) || 0) + (o.montant || 0));
  }
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}
