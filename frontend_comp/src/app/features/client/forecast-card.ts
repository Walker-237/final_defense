import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ApiService, ForecastResponse } from '../../core/services/api';

/** Point positionné dans le repère SVG du graphique. */
interface PlottedPoint {
  code: string;
  dateEmission: string;
  tauxNominal: number;
  x: number;
  y: number;
}

/**
 * Carte « Prévision indicative de taux » — historique des émissions comparables
 * (même nature, même pays émetteur) + estimation générée par IA pour la
 * prochaine émission. Les BTA/OTA étant attribués par adjudication, cette
 * estimation est une tendance, jamais un engagement chiffré garanti.
 */
@Component({
  selector: 'afb-forecast-card',
  imports: [DecimalPipe],
  template: `
    @if (data(); as d) {
      <div class="card p-5 mt-4">
        <div class="flex items-center justify-between gap-3 mb-1">
          <h2 class="font-bold text-sm flex items-center gap-1.5">📈 Prévision indicative de taux</h2>
          @if (d.projectionDisponible) {
            <span class="badge"
                  [class.bg-emerald-100]="d.tendance === 'HAUSSE'" [class.text-emerald-700]="d.tendance === 'HAUSSE'"
                  [class.bg-red-100]="d.tendance === 'BAISSE'" [class.text-red-700]="d.tendance === 'BAISSE'"
                  [class.bg-gray-100]="d.tendance === 'STABLE'" [class.text-gray-700]="d.tendance === 'STABLE'">
              {{ tendanceLabel(d.tendance) }}
            </span>
          }
        </div>
        <p class="text-[11px] text-gray-400 mb-3">
          @if (d.historique.length > 0) {
            Basé sur {{ d.historique.length }} émission(s) comparable(s) — estimation indicative, non contractuelle.
          } @else {
            Aucune émission comparable passée pour l'instant.
          }
        </p>

        @if (d.historique.length > 0) {
          <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" class="w-full h-36" role="img"
               aria-label="Évolution du taux sur les émissions comparables">
            @for (gy of gridLines(); track gy) {
              <line [attr.x1]="padL" [attr.x2]="W - padR" [attr.y1]="gy" [attr.y2]="gy" stroke="#e5e7eb" stroke-width="1" />
            }
            @if (d.projectionDisponible) {
              <line [attr.x1]="projectionPoint().x" [attr.x2]="projectionPoint().x"
                    [attr.y1]="rangeTop()" [attr.y2]="rangeBottom()"
                    stroke="#C81E3A" stroke-width="5" stroke-linecap="round" opacity="0.2" />
              <line [attr.x1]="lastPoint().x" [attr.y1]="lastPoint().y"
                    [attr.x2]="projectionPoint().x" [attr.y2]="projectionPoint().y"
                    stroke="#C81E3A" stroke-width="2" stroke-dasharray="4 3" stroke-linecap="round" />
            }
            <polyline [attr.points]="historicalPolyline()" fill="none" stroke="#475569"
                      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            @for (p of historicalPoints(); track p.code) {
              <circle [attr.cx]="p.x" [attr.cy]="p.y" r="4" fill="#475569">
                <title>{{ p.code }} — {{ p.dateEmission }} : {{ p.tauxNominal }} %</title>
              </circle>
            }
            @if (d.projectionDisponible) {
              <circle [attr.cx]="projectionPoint().x" [attr.cy]="projectionPoint().y" r="5" fill="#C81E3A">
                <title>Estimation — {{ d.tauxProjete }} % (fourchette {{ d.fourchetteMin }}–{{ d.fourchetteMax }} %)</title>
              </circle>
            }
          </svg>

          <div class="flex items-center gap-4 text-[11px] text-gray-500 mt-1">
            <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-slate-600 inline-block"></span>Historique</span>
            @if (d.projectionDisponible) {
              <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-afb-red inline-block"></span>Estimation</span>
            }
          </div>
        }

        @if (d.projectionDisponible) {
          <div class="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-3">
            <div class="text-sm font-semibold">
              {{ d.tauxProjete | number:'1.2-2':'fr-FR' }} %
              <span class="text-gray-400 font-normal text-xs">
                (fourchette {{ d.fourchetteMin | number:'1.2-2':'fr-FR' }} % – {{ d.fourchetteMax | number:'1.2-2':'fr-FR' }} %)
              </span>
            </div>
            <p class="text-xs text-gray-600 mt-1 leading-relaxed">{{ d.commentaire }}</p>
          </div>
        } @else if (d.message) {
          <p class="text-xs text-gray-400 mt-2">{{ d.message }}</p>
        }

        @if (d.historique.length > 0) {
          <details class="mt-2">
            <summary class="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600">
              Voir le détail des émissions comparables
            </summary>
            <table class="w-full text-xs mt-2">
              <thead>
                <tr class="text-gray-400 text-left">
                  <th class="font-normal pb-1">Émission</th>
                  <th class="font-normal pb-1">Date</th>
                  <th class="font-normal pb-1 text-right">Taux</th>
                </tr>
              </thead>
              <tbody>
                @for (p of d.historique; track p.code) {
                  <tr class="border-t border-gray-100">
                    <td class="py-1">{{ p.code }}</td>
                    <td class="py-1">{{ p.dateEmission }}</td>
                    <td class="py-1 text-right">{{ p.tauxNominal | number:'1.2-2':'fr-FR' }} %</td>
                  </tr>
                }
              </tbody>
            </table>
          </details>
        }
      </div>
    } @else if (erreur()) {
      <div class="card p-5 mt-4">
        <h2 class="font-bold text-sm flex items-center gap-1.5">📈 Prévision indicative de taux</h2>
        <p class="text-xs text-gray-400 mt-2">Estimation momentanément indisponible.</p>
      </div>
    }
  `,
})
export class ForecastCard {
  private readonly api = inject(ApiService);

  emissionId = input.required<string>();

  readonly W = 400;
  readonly H = 140;
  readonly padL = 8;
  readonly padR = 8;
  private readonly padT = 10;
  private readonly padB = 10;

  data = signal<ForecastResponse | null>(null);
  erreur = signal(false);

  constructor() {
    effect(() => {
      const id = this.emissionId();
      if (!id) return;
      this.erreur.set(false);
      this.api.getForecast(id).subscribe({
        next: (d) => this.data.set(d),
        // Echec reseau/serveur : distinct de l'absence de comparables (message
        // du backend, cf. `d.message`) — sans ceci la carte disparaissait
        // silencieusement, indiscernable d'une fonctionnalite inexistante.
        error: () => { this.data.set(null); this.erreur.set(true); },
      });
    });
  }

  tendanceLabel(t: string | null): string {
    return t === 'HAUSSE' ? '↗ En hausse' : t === 'BAISSE' ? '↘ En baisse' : '→ Stable';
  }

  private minMax = computed(() => {
    const d = this.data();
    if (!d) return { min: 0, max: 1 };
    const values = d.historique.map((p) => p.tauxNominal);
    if (d.projectionDisponible) {
      values.push(d.fourchetteMin!, d.fourchetteMax!, d.tauxProjete!);
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max((max - min) * 0.15, 0.1);
    return { min: min - pad, max: max + pad };
  });

  private xFor(index: number, total: number): number {
    const usableW = this.W - this.padL - this.padR;
    if (total <= 0) return this.padL + usableW / 2;
    return this.padL + (usableW * index) / total;
  }

  private yFor(value: number): number {
    const { min, max } = this.minMax();
    const usableH = this.H - this.padT - this.padB;
    const ratio = max === min ? 0.5 : (value - min) / (max - min);
    return this.H - this.padB - ratio * usableH;
  }

  private totalSteps(): number {
    const d = this.data();
    if (!d) return 1;
    return d.historique.length - 1 + (d.projectionDisponible ? 1 : 0);
  }

  historicalPoints = computed<PlottedPoint[]>(() => {
    const d = this.data();
    if (!d) return [];
    const total = this.totalSteps();
    return d.historique.map((p, i) => ({ ...p, x: this.xFor(i, total), y: this.yFor(p.tauxNominal) }));
  });

  historicalPolyline = computed(() => this.historicalPoints().map((p) => `${p.x},${p.y}`).join(' '));

  lastPoint = computed(() => {
    const pts = this.historicalPoints();
    return pts[pts.length - 1] ?? { x: this.padL, y: this.H / 2 };
  });

  projectionPoint = computed(() => {
    const d = this.data();
    if (!d || !d.projectionDisponible) return { x: 0, y: 0 };
    const total = this.totalSteps();
    return { x: this.xFor(total, total), y: this.yFor(d.tauxProjete!) };
  });

  rangeTop = computed(() => {
    const d = this.data();
    return d?.projectionDisponible ? this.yFor(d.fourchetteMax!) : 0;
  });

  rangeBottom = computed(() => {
    const d = this.data();
    return d?.projectionDisponible ? this.yFor(d.fourchetteMin!) : 0;
  });

  gridLines = computed(() => {
    const usableH = this.H - this.padT - this.padB;
    return [0.25, 0.5, 0.75].map((f) => this.padT + f * usableH);
  });
}
