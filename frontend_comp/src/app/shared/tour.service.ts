import { Injectable, signal } from '@angular/core';

export interface TourStep {
  /** Matches the [data-tour="..."] attribute on the target element. */
  target: string;
  title: string;
  body: string;
}

@Injectable({ providedIn: 'root' })
export class TourService {
  readonly steps = signal<TourStep[]>([]);
  readonly currentIndex = signal(0);
  readonly active = signal(false);

  start(steps: TourStep[]) {
    if (!steps.length) return;
    this.steps.set(steps);
    this.currentIndex.set(0);
    this.active.set(true);
  }

  next() {
    if (this.currentIndex() >= this.steps().length - 1) {
      this.end();
      return;
    }
    this.currentIndex.update(i => i + 1);
  }

  prev() {
    if (this.currentIndex() > 0) this.currentIndex.update(i => i - 1);
  }

  skip() { this.end(); }

  end() {
    this.active.set(false);
    this.currentIndex.set(0);
    this.steps.set([]);
  }
}