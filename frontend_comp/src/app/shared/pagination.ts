import { Component, Pipe, PipeTransform, computed, input, model } from '@angular/core';

/** Pure pipe — slices an array for the current page.
 *  Returns the full array if total ≤ pageSize, so pagination is opt-in by length. */
@Pipe({ name: 'paginate', standalone: true, pure: true })
export class PaginatePipe implements PipeTransform {
  transform(items: any, page: number, pageSize: number = 25): any[] {
    if (!items) return [];
    if (items.length <= pageSize) return items;
    const p = Math.max(1, Math.min(page || 1, Math.ceil(items.length / pageSize)));
    const start = (p - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }
}

/** Pagination controls bar — auto-hidden when total ≤ pageSize.
 *  Use [(page)] to bind the current page signal. */
@Component({
  selector: 'afb-paginator',
  standalone: true,
  template: `
    @if (total() > pageSize()) {
      <div class="flex flex-col sm:flex-row items-center justify-between gap-2 px-3 py-2 border-t bg-gray-50 text-xs">
        <div class="text-gray-600">
          Affichage de <b>{{ from() }}</b> à <b>{{ to() }}</b> sur <b>{{ total() }}</b>
        </div>
        <div class="flex items-center gap-1 flex-wrap justify-center">
          <button type="button" class="btn btn-ghost py-1 px-2" (click)="go(1)" [disabled]="page() === 1" title="Première page">«</button>
          <button type="button" class="btn btn-ghost py-1 px-2" (click)="go(page()-1)" [disabled]="page() === 1">‹ Précédent</button>
          @for (p of pages(); track $index) {
            @if (p === '…') {
              <span class="px-1 text-gray-400">…</span>
            } @else {
              <button type="button" class="btn py-1 px-2.5"
                      [class.btn-primary]="p === page()" [class.btn-ghost]="p !== page()"
                      (click)="go(+p)">{{ p }}</button>
            }
          }
          <button type="button" class="btn btn-ghost py-1 px-2" (click)="go(page()+1)" [disabled]="page() === lastPage()">Suivant ›</button>
          <button type="button" class="btn btn-ghost py-1 px-2" (click)="go(lastPage())" [disabled]="page() === lastPage()" title="Dernière page">»</button>
        </div>
      </div>
    }
  `
})
export class Paginator {
  total = input(0);
  pageSize = input(25);
  page = model(1);

  lastPage = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  from = computed(() => (this.page() - 1) * this.pageSize() + 1);
  to = computed(() => Math.min(this.page() * this.pageSize(), this.total()));

  pages = computed<(number | string)[]>(() => {
    const last = this.lastPage();
    const cur = this.page();
    const out: (number | string)[] = [];
    if (last <= 7) {
      for (let i = 1; i <= last; i++) out.push(i);
      return out;
    }
    out.push(1);
    if (cur > 3) out.push('…');
    for (let i = Math.max(2, cur - 1); i <= Math.min(last - 1, cur + 1); i++) out.push(i);
    if (cur < last - 2) out.push('…');
    out.push(last);
    return out;
  });

  go(p: number) {
    const last = this.lastPage();
    this.page.set(Math.max(1, Math.min(last, p)));
  }
}
