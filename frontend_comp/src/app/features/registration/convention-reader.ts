import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  ViewChild,
  signal,
} from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';

// Fait pointer pdf.js vers son worker. Le pattern `new URL(..., import.meta.url)`
// fonctionne tel quel avec le builder Angular (esbuild) — pas de copie manuelle
// d'asset nécessaire, à condition d'avoir `pdfjs-dist` en dépendance (voir notes
// d'installation en bas de fichier).
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

@Component({
  selector: 'afb-convention-reader',
  standalone: true,
  imports: [],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
         [class.hidden]="!open" (click)="onCancel()">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-3xl h-[90vh] flex flex-col"
           (click)="$event.stopPropagation()">

        <div class="flex items-center justify-between p-4 border-b shrink-0">
          <div>
            <h2 class="text-lg font-bold text-gray-900">Convention de compte-titres</h2>
            <p class="text-xs text-gray-500">Afriland First Bank — document original</p>
          </div>
          <button type="button" class="text-gray-400 hover:text-gray-600 text-xl leading-none"
                  (click)="onCancel()" aria-label="Fermer">✕</button>
        </div>

        <div #scrollBody class="flex-1 overflow-y-auto bg-gray-100 p-4" (scroll)="onScroll($event)">
          @if (loading()) {
            <div class="h-full flex flex-col items-center justify-center text-gray-400 text-sm gap-2">
              <span class="animate-pulse">Chargement du document…</span>
            </div>
          }
          @if (errorMsg()) {
            <div class="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <p class="text-sm text-red-600">{{ errorMsg() }}</p>
              <button type="button" class="btn btn-outline" (click)="loadPdf()">Réessayer</button>
            </div>
          }
          <!-- Les pages du PDF (canvas) sont injectées ici par pdf.js -->
          <div #pagesHost class="flex flex-col items-center gap-3"></div>
        </div>

        <div class="p-4 border-t bg-gray-50 rounded-b-xl shrink-0">
          @if (!canAccept() && !errorMsg()) {
            <p class="text-xs text-amber-700 text-center mb-2">
              ⬇ Faites défiler jusqu'à la fin du document pour pouvoir accepter.
            </p>
          }
          <div class="flex gap-2">
            <button type="button" class="btn btn-outline flex-1" (click)="onCancel()">Annuler</button>
            <button type="button" class="btn btn-primary flex-1" [disabled]="!canAccept()" (click)="onConfirm()">
              J'ai lu et j'accepte
            </button>
          </div>
        </div>

      </div>
    </div>
  `,
})
export class ConventionReaderDialog implements AfterViewInit, OnDestroy {
  /**
   * Chemin de l'asset PDF, servi depuis le dossier `public/` (voir angular.json,
   * dont l'unique entrée "assets" pointe vers "public" — pas "src/assets").
   * Le chemin DOIT être absolu (préfixé par "/") : une URL relative se résout
   * par rapport à la route courante (ex. /auth/register) et non à la racine du
   * site, ce qui renvoie index.html au lieu du PDF.
   */
  @Input() pdfUrl = '/documents/convention-compte-titres-afb.pdf';

  @ViewChild('scrollBody') private scrollBodyRef?: ElementRef<HTMLDivElement>;
  @ViewChild('pagesHost') private pagesHostRef?: ElementRef<HTMLDivElement>;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  readonly loading = signal(false);
  readonly errorMsg = signal('');
  readonly canAccept = signal(false);

  private viewReady = false;
  private pendingLoad = false;
  // NB: destroy() vit sur la tâche de chargement (PDFDocumentLoadingTask),
  // pas sur le PDFDocumentProxy résolu — d'où le fait qu'on garde la tâche.
  private currentLoadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
  private renderToken = 0; // évite qu'un chargement obsolète n'écrive dans le DOM après un nouveau

  private _open = false;
  @Input() set open(value: boolean) {
    this._open = value;
    if (value) {
      this.canAccept.set(false);
      if (this.viewReady) {
        this.loadPdf();
      } else {
        this.pendingLoad = true;
      }
    }
  }
  get open(): boolean {
    return this._open;
  }

  ngAfterViewInit() {
    this.viewReady = true;
    if (this.pendingLoad) {
      this.pendingLoad = false;
      this.loadPdf();
    }
  }

  ngOnDestroy() {
    this.currentLoadingTask?.destroy();
  }

  async loadPdf() {
    const token = ++this.renderToken;
    const host = this.pagesHostRef?.nativeElement;
    const scrollEl = this.scrollBodyRef?.nativeElement;
    if (!host || !scrollEl) return;

    this.loading.set(true);
    this.errorMsg.set('');
    this.canAccept.set(false);
    host.innerHTML = '';
    scrollEl.scrollTop = 0;

    try {
      this.currentLoadingTask?.destroy();
      const loadingTask = pdfjsLib.getDocument({ url: this.pdfUrl });
      this.currentLoadingTask = loadingTask;
      const doc = await loadingTask.promise;
      if (token !== this.renderToken) return; // un rechargement plus récent a pris le relais

      const containerWidth = scrollEl.clientWidth - 32; // marge du padding

      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        if (token !== this.renderToken) return;
        const page = await doc.getPage(pageNum);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = containerWidth > 0 ? containerWidth / unscaledViewport.width : 1;
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.className = 'bg-white shadow rounded';
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        if (token !== this.renderToken) return;
        host.appendChild(canvas);
      }

      this.loading.set(false);
      // Si tout le document tient déjà dans la fenêtre visible, on débloque directement.
      queueMicrotask(() => this.checkScroll());
    } catch (err) {
      if (token !== this.renderToken) return;
      console.error('Échec du chargement de la convention PDF', err);
      this.loading.set(false);
      this.errorMsg.set("Impossible de charger le document. Vérifiez votre connexion et réessayez.");
    }
  }

  onScroll(ev: Event) {
    this.checkScrollEl(ev.target as HTMLDivElement);
  }

  private checkScroll() {
    const el = this.scrollBodyRef?.nativeElement;
    if (el) this.checkScrollEl(el);
  }

  /** Débloque l'acceptation une fois qu'on approche du bas du document (marge de 24px). */
  private checkScrollEl(el: HTMLDivElement) {
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    if (atBottom) this.canAccept.set(true);
  }

  onCancel() {
    this.cancel.emit();
  }

  onConfirm() {
    if (!this.canAccept()) return;
    this.confirm.emit();
  }
}

/**
 * NOTES D'INSTALLATION
 * ---------------------
 * 1) npm install pdfjs-dist
 *
 * 2) Placez le fichier PDF réel de la convention (celui que vous avez fourni,
 *    ex. "convention_de_compte-titre_AFB_PP_nov_2023.pdf") dans :
 *      src/assets/documents/convention-compte-titres-afb.pdf
 *    ou passez un autre chemin via l'@Input `pdfUrl` :
 *      <afb-convention-reader [pdfUrl]="'assets/documents/mon-fichier.pdf'" ... />
 *
 * 3) Assurez-vous que angular.json inclut bien le dossier "assets" dans les
 *    "assets" du build (c'est la configuration par défaut d'un projet Angular).
 *
 * 4) Le `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` est
 *    résolu automatiquement par le builder esbuild d'Angular (v17+) : il copie
 *    le worker dans le bundle final sans configuration supplémentaire.
 */