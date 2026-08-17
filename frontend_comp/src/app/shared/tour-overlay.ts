import { Component, inject, signal, effect, OnDestroy } from '@angular/core';
import { TourService } from './tour.service';

@Component({
  selector: 'afb-tour-overlay',
  standalone: true,
  template: `
    @if (tour.active() && currentStep()) {
      <div class="tour-highlight"
           [style.top.px]="box().top" [style.left.px]="box().left"
           [style.width.px]="box().width" [style.height.px]="box().height"></div>

      <div class="tour-tip" [style.top.px]="tipPos().top" [style.left.px]="tipPos().left">
        <div class="flex items-center gap-2">
          <span class="tour-badge">{{ tour.currentIndex() + 1 }}</span>
          <span class="font-bold text-sm text-gray-900">{{ currentStep()!.title }}</span>
        </div>
        <p class="text-xs text-gray-600 mt-2 leading-relaxed">{{ currentStep()!.body }}</p>
        <div class="flex items-center justify-between mt-3">
          <div class="flex gap-1">
            @for (s of tour.steps(); track $index) {
              <span class="tour-dot" [class.tour-dot-active]="$index === tour.currentIndex()"></span>
            }
          </div>
          <div class="flex gap-2">
            @if (tour.currentIndex() > 0) {
              <button type="button" class="btn btn-outline tour-btn-sm" (click)="tour.prev()">Précédent</button>
            } @else {
              <button type="button" class="tour-skip" (click)="tour.skip()">Passer</button>
            }
            <button type="button" class="btn btn-primary tour-btn-sm" (click)="tour.next()">
              {{ tour.currentIndex() === tour.steps().length - 1 ? 'Terminer' : 'Suivant' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .tour-highlight {
      position: fixed; z-index: 60; border-radius: 12px; pointer-events: none;
      box-shadow: 0 0 0 4px rgba(200,16,46,.18), 0 0 0 9999px rgba(17,24,39,.55);
      transition: top .25s ease, left .25s ease, width .25s ease, height .25s ease;
    }
    .tour-tip {
      position: fixed; z-index: 70; width: 280px;
      background: #fff; border-radius: 12px; padding: 16px;
      box-shadow: 0 12px 32px rgba(17,24,39,.28);
      border-top: 3px solid #C8102E;
      transition: top .25s ease, left .25s ease;
    }
    .tour-badge {
      display:inline-flex; align-items:center; justify-content:center;
      width:22px; height:22px; border-radius:999px;
      background:#FDECEE; color:#C8102E; font-size:11.5px; font-weight:800;
    }
    .tour-dot { width:6px; height:6px; border-radius:999px; background:#E5E7EB; display:inline-block; }
    .tour-dot-active { background:#C8102E; width:16px; border-radius:4px; }
    .tour-btn-sm { padding: 6px 12px; font-size: 12px; }
    .tour-skip { font-size: 12px; color: #9CA3AF; background: none; border: none; padding: 6px 8px; cursor: pointer; }
  `]
})
export class TourOverlay implements OnDestroy {
  readonly tour = inject(TourService);
  private resizeHandler = () => this.recompute();

  readonly box = signal({ top: 0, left: 0, width: 0, height: 0 });
  readonly tipPos = signal({ top: 0, left: 0 });

  currentStep() {
    return this.tour.steps()[this.tour.currentIndex()] ?? null;
  }

  constructor() {
    effect(() => {
      this.tour.active(); this.tour.currentIndex(); // track deps
      queueMicrotask(() => this.recompute());
    });
    window.addEventListener('resize', this.resizeHandler);
  }

  ngOnDestroy() {
    window.removeEventListener('resize', this.resizeHandler);
  }

  private recompute() {
    const step = this.currentStep();
    if (!step) return;
    const target = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
    if (!target) return;

    target.scrollIntoView({ block: 'center', behavior: 'smooth' });

    // Wait for the scroll to settle before measuring the real position.
    setTimeout(() => {
      const r = target.getBoundingClientRect();
      this.box.set({ top: r.top - 6, left: r.left - 6, width: r.width + 12, height: r.height + 12 });

      const tipWidth = 280;
      let left = r.right + 16;
      let top = r.top;
      if (left + tipWidth > window.innerWidth - 16) {
        left = Math.max(16, r.left);
        top = r.bottom + 12;
      }
      if (top + 160 > window.innerHeight) {
        top = Math.max(16, window.innerHeight - 180);
      }
      this.tipPos.set({ top, left });
    }, 200);
  }
}