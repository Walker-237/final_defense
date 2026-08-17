import { Injectable, signal, Component, computed } from '@angular/core';

export type ToastType = 'success' | 'info' | 'warn' | 'error';
export interface Toast { id: number; type: ToastType; title: string; message?: string; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _list = signal<Toast[]>([]);
  list = computed(() => this._list());
  private nextId = 1;

  show(type: ToastType, title: string, message?: string) {
    const id = this.nextId++;
    this._list.update(l => [...l, { id, type, title, message }]);
    setTimeout(() => this.dismiss(id), 4500);
  }
  success(t: string, m?: string) { this.show('success', t, m); }
  info(t: string, m?: string) { this.show('info', t, m); }
  warn(t: string, m?: string) { this.show('warn', t, m); }
  error(t: string, m?: string) { this.show('error', t, m); }
  dismiss(id: number) { this._list.update(l => l.filter(t => t.id !== id)); }
}

@Component({
  selector: 'afb-toasts',
  template: `
    <div class="fixed top-4 right-4 z-[60] space-y-2.5 w-[22rem] max-w-[calc(100vw-2rem)]">
      @for (t of svc.list(); track t.id) {
        <div class="relative rounded-xl shadow-lg bg-white flex gap-3 p-3.5 pl-4 border-l-4 overflow-hidden
                    animate-[slideInRight_.25s_ease-out]"
             [class.border-l-emerald-500]="t.type==='success'"
             [class.border-l-blue-500]="t.type==='info'"
             [class.border-l-amber-500]="t.type==='warn'"
             [class.border-l-red-500]="t.type==='error'">
          <div class="shrink-0 w-8 h-8 rounded-full grid place-items-center text-base"
               [class.bg-emerald-50]="t.type==='success'"
               [class.bg-blue-50]="t.type==='info'"
               [class.bg-amber-50]="t.type==='warn'"
               [class.bg-red-50]="t.type==='error'">
            @switch (t.type) {
              @case ('success') { ✅ }
              @case ('info') { ℹ️ }
              @case ('warn') { ⚠️ }
              @case ('error') { ❌ }
            }
          </div>
          <div class="flex-1 min-w-0 pt-0.5">
            <div class="font-semibold text-sm text-gray-900 leading-snug">{{ t.title }}</div>
            @if (t.message) { <div class="text-xs text-gray-600 mt-0.5 leading-relaxed">{{ t.message }}</div> }
          </div>
          <button class="text-gray-300 hover:text-gray-600 text-sm leading-none self-start" (click)="svc.dismiss(t.id)" aria-label="Fermer">✕</button>
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes slideInRight { from { transform: translateX(110%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
  `]
})
export class ToastContainer {
  constructor(public svc: ToastService) {}
}
