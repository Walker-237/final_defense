import { Component, computed, input } from '@angular/core';

/**
 * Graphiques SVG légers (sans dépendance externe, compatibles SSR).
 *
 * Trois composants autonomes — barres verticales, courbe et donut — alimentés
 * par des données réelles via `[data]`. Le rendu est en SVG `viewBox` pur :
 * responsive (largeur 100 %), imprimable et rendu côté serveur sans canvas.
 */

/** Un point de données générique pour les graphiques. */
export interface ChartDatum {
  label: string;
  value: number;
  /** Couleur optionnelle (donut/segment). */
  color?: string;
}

const AFB_RED = '#c8102e';

// ───────────────────────────── Barres ──────────────────────────────────────
@Component({
  selector: 'afb-bar-chart',
  template: `
    <svg viewBox="0 0 600 190" preserveAspectRatio="xMidYMid meet" class="w-full" role="img">
      @for (g of grid(); track g.y) {
        <line x1="44" [attr.y1]="g.y" x2="588" [attr.y2]="g.y" stroke="#e5e7eb" stroke-dasharray="3 3" />
        <text x="36" [attr.y]="g.y + 4" text-anchor="end" font-size="10" fill="#9ca3af">{{ g.label }}</text>
      }
      @for (b of bars(); track b.label) {
        <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="color()" rx="2">
          <title>{{ b.label }} : {{ b.value }}</title>
        </rect>
        <text [attr.x]="b.cx" y="182" text-anchor="middle" font-size="10" fill="#6b7280">{{ b.label }}</text>
      }
    </svg>
  `,
})
export class BarChart {
  data = input<ChartDatum[]>([]);
  color = input<string>(AFB_RED);

  private readonly top = 12;
  private readonly bottom = 165;

  private readonly max = computed(() => Math.max(1, ...this.data().map((d) => d.value)));

  bars = computed(() => {
    const d = this.data();
    if (!d.length) return [];
    const left = 52, right = 588;
    const slot = (right - left) / d.length;
    const bw = Math.min(48, slot * 0.6);
    const max = this.max();
    return d.map((p, i) => {
      const h = ((this.bottom - this.top) * p.value) / max;
      const cx = left + slot * i + slot / 2;
      return { label: p.label, value: p.value, w: bw, x: cx - bw / 2, cx, y: this.bottom - h, h };
    });
  });

  grid = computed(() => {
    const max = this.max();
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const val = (max / steps) * (steps - i);
      const y = this.top + ((this.bottom - this.top) / steps) * i;
      return { y, label: this.fmt(val) };
    });
  });

  private fmt(v: number): string {
    if (v >= 1000) return Math.round(v / 1000) + 'k';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
}

// ───────────────────────────── Courbe ──────────────────────────────────────
@Component({
  selector: 'afb-line-chart',
  template: `
    <svg viewBox="0 0 600 190" preserveAspectRatio="xMidYMid meet" class="w-full" role="img">
      @for (g of grid(); track g.y) {
        <line x1="44" [attr.y1]="g.y" x2="588" [attr.y2]="g.y" stroke="#e5e7eb" stroke-dasharray="3 3" />
        <text x="36" [attr.y]="g.y + 4" text-anchor="end" font-size="10" fill="#9ca3af">{{ g.label }}</text>
      }
      @if (points().length > 1) {
        <polyline [attr.points]="polyline()" fill="none" [attr.stroke]="color()" stroke-width="2.5"
                  stroke-linejoin="round" stroke-linecap="round" />
      }
      @for (p of points(); track p.label) {
        <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3.5" [attr.fill]="color()" stroke="white" stroke-width="1.5">
          <title>{{ p.label }} : {{ p.value }}</title>
        </circle>
        <text [attr.x]="p.x" y="182" text-anchor="middle" font-size="10" fill="#6b7280">{{ p.label }}</text>
      }
    </svg>
  `,
})
export class LineChart {
  data = input<ChartDatum[]>([]);
  color = input<string>(AFB_RED);

  private readonly top = 12;
  private readonly bottom = 165;

  private readonly max = computed(() => Math.max(1, ...this.data().map((d) => d.value)));

  points = computed(() => {
    const d = this.data();
    if (!d.length) return [];
    const left = 60, right = 580;
    const span = d.length > 1 ? (right - left) / (d.length - 1) : 0;
    const max = this.max();
    return d.map((p, i) => ({
      label: p.label,
      value: p.value,
      x: left + span * i,
      y: this.bottom - ((this.bottom - this.top) * p.value) / max,
    }));
  });

  polyline = computed(() => this.points().map((p) => `${p.x},${p.y}`).join(' '));

  grid = computed(() => {
    const max = this.max();
    const steps = 4;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const val = (max / steps) * (steps - i);
      const y = this.top + ((this.bottom - this.top) / steps) * i;
      return { y, label: this.fmt(val) };
    });
  });

  private fmt(v: number): string {
    if (v >= 1000) return Math.round(v / 1000) + 'k';
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
}

// ───────────────────────────── Donut ───────────────────────────────────────
@Component({
  selector: 'afb-donut-chart',
  template: `
    <div class="flex items-center gap-4">
      <svg viewBox="0 0 120 120" class="w-28 h-28 shrink-0" role="img">
        @if (slices().length) {
          @for (s of slices(); track s.label) {
            <path [attr.d]="s.path" [attr.fill]="s.color"><title>{{ s.label }} : {{ pct(s.value) }}%</title></path>
          }
          <circle cx="60" cy="60" r="32" fill="white" />
          <text x="60" y="57" text-anchor="middle" font-size="13" font-weight="700" fill="#111827">{{ total() }}</text>
          <text x="60" y="70" text-anchor="middle" font-size="8" fill="#9ca3af">total</text>
        } @else {
          <circle cx="60" cy="60" r="50" fill="#f3f4f6" />
        }
      </svg>
      <div class="flex-1 w-full space-y-1">
        @for (s of slices(); track s.label) {
          <div class="flex items-center gap-1.5 text-xs">
            <span class="w-2.5 h-2.5 rounded-sm shrink-0" [style.background-color]="s.color"></span>
            <span class="text-gray-600 truncate">{{ s.label }}</span>
            <span class="ml-auto font-semibold text-gray-900 shrink-0">{{ pct(s.value) }}%</span>
          </div>
        }
        @if (!slices().length) {
          <p class="text-xs text-gray-400">Aucune donnée à afficher.</p>
        }
      </div>
    </div>
  `,
})
export class DonutChart {
  data = input<ChartDatum[]>([]);

  /** Palette par défaut alignée sur la charte (rouge AFB, noir, gris…). */
  private readonly palette = [AFB_RED, '#111827', '#9a0c23', '#475569', '#e11d48', '#94a3b8', '#1f2937'];

  total = computed(() => this.data().reduce((s, d) => s + d.value, 0));

  slices = computed(() => {
    const d = this.data().filter((x) => x.value > 0);
    const total = d.reduce((s, x) => s + x.value, 0);
    if (!total) return [];
    let angle = -Math.PI / 2; // départ à midi
    return d.map((p, i) => {
      const frac = p.value / total;
      const start = angle;
      const end = angle + frac * 2 * Math.PI;
      angle = end;
      return { label: p.label, value: p.value, color: p.color ?? this.palette[i % this.palette.length], path: this.arc(start, end) };
    });
  });

  pct(v: number): number {
    const t = this.total();
    return t ? Math.round((v / t) * 100) : 0;
  }

  /** Construit le tracé d'une part de camembert (centre 60,60 ; rayon 50). */
  private arc(start: number, end: number): string {
    const r = 50, cx = 60, cy = 60;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    // Cas d'une part unique (cercle complet) : éviter un tracé dégénéré.
    if (end - start >= 2 * Math.PI - 1e-6) {
      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
    }
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
  }
}

/** Regroupe les trois graphiques pour un import unique. */
export const CHARTS = [BarChart, LineChart, DonutChart] as const;
