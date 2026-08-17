import { Injectable, signal, computed, Component } from '@angular/core';

/**
 * Indicateur de progression pour la génération d'un PDF (avis d'opéré, ordre).
 *
 * La génération est faite côté navigateur (html2canvas + jsPDF) et peut durer
 * quelques secondes : cet overlay montre l'évolution par étapes (préparation,
 * rendu, encodage, finalisation) avec une barre de progression. La progression
 * est jalonnée (les bibliothèques sous-jacentes n'exposent pas de % réel), mais
 * suffit à donner un retour visuel clair à l'utilisateur.
 */
@Injectable({ providedIn: 'root' })
export class PdfProgressService {
  private readonly _active = signal(false);
  private readonly _percent = signal(0);
  private readonly _label = signal('');

  active = computed(() => this._active());
  percent = computed(() => this._percent());
  label = computed(() => this._label());

  /** Affiche l'overlay et initialise la progression. */
  start(label = 'Préparation…'): void {
    this._label.set(label);
    this._percent.set(5);
    this._active.set(true);
  }

  /** Met à jour la progression (bornée à [0,100]) et, si fourni, le libellé d'étape. */
  set(percent: number, label?: string): void {
    this._percent.set(Math.max(0, Math.min(100, Math.round(percent))));
    if (label) this._label.set(label);
  }

  /** Termine : barre à 100 % puis masque l'overlay après une brève pause. */
  done(): void {
    this._percent.set(100);
    this._label.set('Terminé');
    setTimeout(() => this._active.set(false), 350);
  }

  /** Masque immédiatement (en cas d'échec). */
  fail(): void {
    this._active.set(false);
  }
}

@Component({
  selector: 'afb-pdf-progress',
  template: `
    @if (svc.active()) {
      <div class="fixed inset-0 z-[70] grid place-items-center bg-black/40" role="status" aria-live="polite">
        <div class="bg-white rounded-2xl shadow-xl p-6 w-[20rem] max-w-[calc(100vw-2rem)]">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-8 h-8 rounded-full border-2 border-gray-200 border-t-gray-800 animate-spin"></div>
            <div class="font-semibold text-sm text-gray-900">Génération du PDF</div>
          </div>
          <div class="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div class="h-full bg-gray-800 rounded-full transition-[width] duration-200 ease-out"
                 [style.width.%]="svc.percent()"></div>
          </div>
          <div class="flex justify-between text-xs text-gray-500 mt-2">
            <span>{{ svc.label() }}</span><span>{{ svc.percent() }}%</span>
          </div>
        </div>
      </div>
    }
  `,
})
export class PdfProgressOverlay {
  constructor(public svc: PdfProgressService) {}
}
