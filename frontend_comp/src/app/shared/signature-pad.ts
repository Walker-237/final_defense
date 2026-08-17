import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild, signal, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ModalShell } from './dialogs';

@Component({
  selector: 'afb-signature-pad',
  template: `
    <div class="space-y-3">
      <div class="border-2 rounded-lg overflow-hidden bg-white relative" [class.border-afb-red]="!hasSignature()" [class.border-emerald-400]="hasSignature()" [style.height.px]="height">
        <canvas #canvas class="w-full h-full cursor-crosshair touch-none"
                (mousedown)="startDraw($event)"
                (mousemove)="draw($event)"
                (mouseup)="endDraw()"
                (mouseleave)="endDraw()"
                (touchstart)="startDrawTouch($event)"
                (touchmove)="drawTouch($event)"
                (touchend)="endDraw()">
        </canvas>
        @if (!hasSignature()) {
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span class="text-gray-300 text-sm">Signez ici ✍️</span>
          </div>
        }
      </div>
      <div class="flex flex-wrap gap-2 items-center justify-between">
        <div class="flex gap-2">
          <button type="button" class="btn btn-ghost text-xs" (click)="clear()">🗑 Effacer</button>
          <button type="button" class="btn btn-ghost text-xs" (click)="undo()" [disabled]="!canUndo()">↩ Annuler</button>
        </div>
        <div class="flex gap-2 items-center">
          <div class="flex gap-1">
            @for (c of colors; track c) {
              <button type="button" class="w-6 h-6 rounded-full border-2 transition"
                      [style.background]="c"
                      [class.border-gray-900]="penColor === c" [class.scale-110]="penColor === c"
                      [class.border-transparent]="penColor !== c"
                      (click)="penColor = c"></button>
            }
          </div>
          <select class="select w-auto text-xs py-1" [(ngModel)]="penWidth" (ngModelChange)="updatePen()">
            <option [ngValue]="1">Fine</option>
            <option [ngValue]="2">Normal</option>
            <option [ngValue]="3">Épaisse</option>
          </select>
        </div>
      </div>
      @if (hasSignature()) {
        <div class="text-xs text-emerald-600 font-medium">✓ Signature capturée · {{ strokeCount() }} trait{{ strokeCount()>1?'s':'' }}</div>
      }
    </div>
  `,
  imports: [FormsModule],
})
export class SignaturePadComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;
  @Input() height = 180;
  @Input() penColorInit = '#000000';
  @Output() signed = new EventEmitter<string>();
  @Output() cleared = new EventEmitter<void>();

  hasSignature = signal(false);
  strokeCount = signal(0);
  canUndo = signal(false);

  private ctx!: CanvasRenderingContext2D;
  private drawing = false;
  private strokes: ImageData[] = [];
  penColor = '#000000';
  penWidth = 2;
  colors = ['#000000', '#1e40af', '#c8102e'];
  private resizeObs?: ResizeObserver;

  ngAfterViewInit() {
    this.penColor = this.penColorInit;
    const canvas = this.canvasRef.nativeElement;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement!);
  }

  ngOnDestroy() { this.resizeObs?.disconnect(); }

  private resize() {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
    const saved = this.hasSignature() ? canvas.toDataURL() : null;
    canvas.width = rect.width;
    canvas.height = this.height;
    this.updatePen();
    if (saved && this.hasSignature()) {
      const img = new Image();
      img.onload = () => this.ctx.drawImage(img, 0, 0);
      img.src = saved;
    }
  }

  updatePen() {
    if (!this.ctx) return;
    this.ctx.strokeStyle = this.penColor;
    this.ctx.lineWidth = this.penWidth;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  private getPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  private getTouchPos(e: TouchEvent): { x: number; y: number } {
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();
    const t = e.touches[0];
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  }

  startDraw(e: MouseEvent) {
    this.saveState();
    this.drawing = true;
    this.updatePen();
    const p = this.getPos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
  }
  draw(e: MouseEvent) {
    if (!this.drawing) return;
    const p = this.getPos(e);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
  }
  startDrawTouch(e: TouchEvent) {
    e.preventDefault();
    this.saveState();
    this.drawing = true;
    this.updatePen();
    const p = this.getTouchPos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
  }
  drawTouch(e: TouchEvent) {
    e.preventDefault();
    if (!this.drawing) return;
    const p = this.getTouchPos(e);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
  }
  endDraw() {
    if (!this.drawing) return;
    this.drawing = false;
    this.hasSignature.set(true);
    this.strokeCount.update(n => n + 1);
    this.emitData();
  }

  private saveState() {
    const canvas = this.canvasRef.nativeElement;
    this.strokes.push(this.ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (this.strokes.length > 30) this.strokes.shift();
    this.canUndo.set(true);
  }

  undo() {
    if (!this.strokes.length) return;
    const state = this.strokes.pop()!;
    this.ctx.putImageData(state, 0, 0);
    this.canUndo.set(this.strokes.length > 0);
    if (!this.strokes.length) { this.hasSignature.set(false); this.strokeCount.set(0); this.cleared.emit(); }
    else this.emitData();
  }

  clear() {
    const canvas = this.canvasRef.nativeElement;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.strokes = [];
    this.hasSignature.set(false);
    this.strokeCount.set(0);
    this.canUndo.set(false);
    this.cleared.emit();
  }

  private emitData() {
    this.signed.emit(this.canvasRef.nativeElement.toDataURL('image/png'));
  }

  getDataURL(): string {
    return this.canvasRef.nativeElement.toDataURL('image/png');
  }
}

/** Modal dialog wrapping the signature pad — opens on demand */
@Component({
  selector: 'afb-signature-dialog',
  imports: [ModalShell, SignaturePadComponent],
  template: `
    <afb-modal [open]="open" size="lg" (cancel)="cancel.emit()">
      <div class="p-4 sm:p-6 overflow-y-auto">
        <h2 class="text-base sm:text-lg font-bold">{{ title }}</h2>
        <p class="text-xs text-gray-500 mt-1">{{ message }}</p>
        <div class="mt-4">
          <afb-signature-pad [height]="200" (signed)="onSigned($event)" (cleared)="signatureData = ''" />
        </div>
        <div class="flex flex-col-reverse sm:flex-row gap-2 mt-5">
          <button class="btn btn-outline sm:flex-1" (click)="cancel.emit()">Annuler</button>
          <button class="btn btn-primary sm:flex-1" [disabled]="!signatureData" (click)="confirm.emit(signatureData)">
            ✓ Valider la signature
          </button>
        </div>
      </div>
    </afb-modal>
  `
})
export class SignatureDialog {
  @Input() open = false;
  @Input() title = 'Signature manuscrite';
  @Input() message = 'Signez dans le cadre ci-dessous avec votre doigt ou votre souris.';
  @Output() confirm = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();
  signatureData = '';
  onSigned(data: string) { this.signatureData = data; }
}

/** Click-to-sign field — shows a placeholder, opens SignatureDialog on click,
 *  then displays the captured signature with options to modify or clear. */
@Component({
  selector: 'afb-signature-field',
  imports: [SignatureDialog],
  template: `
    @if (!signatureData) {
      <button type="button"
              class="w-full border-2 border-dashed border-gray-300 hover:border-afb-red hover:bg-afb-red-light/30 rounded-lg p-6 text-center transition group"
              [style.height.px]="height"
              (click)="openDialog()">
        <div class="text-3xl mb-1 group-hover:scale-110 transition">✍️</div>
        <div class="text-sm font-semibold text-gray-700">{{ label }}</div>
        <div class="text-[11px] text-gray-500 mt-0.5">{{ hint }}</div>
      </button>
    } @else {
      <div class="border-2 border-emerald-400 rounded-lg overflow-hidden bg-white p-2 relative">
        <img [src]="signatureData" alt="Signature" class="w-full" [style.maxHeight.px]="height" style="object-fit: contain;">
        <div class="absolute top-2 right-2 flex gap-1">
          <button type="button" class="btn btn-ghost text-[11px] py-1 px-2 bg-white/90 backdrop-blur"
                  (click)="openDialog()" [title]="'Modifier la signature'">✏️ Modifier</button>
          <button type="button" class="btn btn-ghost text-[11px] py-1 px-2 bg-white/90 backdrop-blur text-afb-red"
                  (click)="clear()" [title]="'Effacer la signature'">🗑</button>
        </div>
        <div class="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
          <span>✓ Signature capturée</span>
        </div>
      </div>
    }

    <afb-signature-dialog [open]="dialogOpen()" [title]="dialogTitle" [message]="dialogMessage"
      (confirm)="onConfirm($event)" (cancel)="dialogOpen.set(false)" />
  `
})
export class SignatureField {
  @Input() signatureData = '';
  @Input() height = 160;
  @Input() label = 'Cliquez ici pour signer';
  @Input() hint = 'Souris, doigt ou stylet — votre signature sera capturée numériquement.';
  @Input() dialogTitle = 'Signature manuscrite';
  @Input() dialogMessage = 'Signez dans le cadre ci-dessous avec votre doigt ou votre souris.';
  @Output() signatureDataChange = new EventEmitter<string>();
  @Output() signed = new EventEmitter<string>();
  @Output() cleared = new EventEmitter<void>();

  dialogOpen = signal(false);

  openDialog() { this.dialogOpen.set(true); }
  onConfirm(data: string) {
    this.signatureData = data;
    this.dialogOpen.set(false);
    this.signatureDataChange.emit(data);
    this.signed.emit(data);
  }
  clear() {
    this.signatureData = '';
    this.signatureDataChange.emit('');
    this.cleared.emit();
  }
}

/** Viewer for a captured signature (back-office verification) */
@Component({
  selector: 'afb-signature-viewer',
  template: `
    <div class="space-y-2">
      @if (signatureData) {
        <div class="border-2 rounded-lg overflow-hidden bg-white p-2" [class.border-emerald-400]="verified" [class.border-gray-300]="!verified">
          <img [src]="signatureData" alt="Signature" class="w-full" style="max-height: 160px; object-fit: contain;">
        </div>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            @if (verified) {
              <span class="badge bg-emerald-100 text-emerald-700">✓ Signature vérifiée</span>
            } @else {
              <span class="badge bg-amber-100 text-amber-700">⏳ En attente de vérification</span>
            }
            @if (date) { <span class="text-gray-500 ml-2">{{ date }}</span> }
          </div>
          <div class="flex gap-2">
            @if (!verified && showActions) {
              <button class="btn btn-success text-xs" (click)="verify.emit()">✓ Valider la signature</button>
              <button class="btn btn-danger text-xs" (click)="reject.emit()">✕ Rejeter</button>
            }
            <button class="btn btn-ghost text-xs" (click)="openFull()">🔍 Agrandir</button>
          </div>
        </div>
      } @else {
        <div class="border-2 border-dashed rounded-lg p-6 text-center text-gray-400 text-sm">
          Aucune signature capturée
        </div>
      }
    </div>
  `
})
export class SignatureViewer {
  @Input() signatureData: string = '';
  @Input() verified = false;
  @Input() date?: string;
  @Input() showActions = false;
  @Output() verify = new EventEmitter<void>();
  @Output() reject = new EventEmitter<void>();

  openFull() {
    if (!this.signatureData || typeof window === 'undefined') return;
    // Whitelist data URI image — refuse tout ce qui n'est pas un base64 d'image valide.
    if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(this.signatureData)) return;
    if (this.signatureData.length > 2_000_000) return;
    // Construction sûre via DOM puis Blob URL ; aucune interpolation HTML, aucun document.write.
    const doc = document.implementation.createHTMLDocument('Signature');
    const style = doc.createElement('style');
    style.textContent = 'body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f9fafb}img{max-width:90%;max-height:90%;border:2px solid #e5e7eb;border-radius:8px;background:white;padding:16px}';
    doc.head.appendChild(style);
    const meta = doc.createElement('meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy');
    meta.setAttribute('content', "default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    doc.head.appendChild(meta);
    const img = doc.createElement('img');
    img.src = this.signatureData;
    img.alt = 'signature';
    doc.body.appendChild(img);
    const html = '<!doctype html>' + doc.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank', 'noopener,noreferrer,width=600,height=400');
    if (!w) URL.revokeObjectURL(url);
    else setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
