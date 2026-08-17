import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChildren, QueryList, signal, model, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** Base modal wrapper — fully responsive */
@Component({
  selector: 'afb-modal',
  template: `
    @if (open) {
      <div class="fixed inset-0 z-50 bg-black/60 overflow-y-auto overscroll-contain" (click)="cancel.emit()">
        <div class="min-h-full flex items-start sm:items-center justify-center p-3 sm:p-4 md:p-6">
          <div
            class="card w-full flex flex-col max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-3rem)] overflow-hidden my-auto"
            [class.max-w-sm]="size==='sm'"
            [class.max-w-md]="size==='md'"
            [class.max-w-lg]="size==='lg'"
            [class.max-w-xl]="size==='xl'"
            [class.max-w-2xl]="size==='2xl'"
            [class.max-w-3xl]="size==='3xl'"
            [class.max-w-4xl]="size==='4xl'"
            [class.max-w-5xl]="size==='5xl'"
            [class.max-w-6xl]="size==='6xl'"
            (click)="$event.stopPropagation()">
            <ng-content />
          </div>
        </div>
      </div>
    }
  `
})
export class ModalShell {
  @Input() open = false;
  @Input() size: 'sm'|'md'|'lg'|'xl'|'2xl'|'3xl'|'4xl'|'5xl'|'6xl' = 'md';
  @Output() cancel = new EventEmitter<void>();
}

/** OTP dialog — 6 inputs with auto-advance, paste support, backspace */
@Component({
  selector: 'afb-otp-dialog',
  imports: [FormsModule, ModalShell],
  template: `
    <afb-modal [open]="open" size="md" (cancel)="doCancel()">
      <div class="p-5 sm:p-6 overflow-y-auto">
        <div class="w-14 h-14 rounded-full bg-afb-red-light text-afb-red grid place-items-center text-2xl mx-auto">🔐</div>
        <h2 class="text-lg sm:text-xl font-bold text-center mt-3">{{ title }}</h2>
        <p class="text-sm text-gray-500 text-center mt-1">{{ message || 'Saisissez le code OTP envoyé au +237 6XX XX XX 23 (valable 5 min).' }}</p>
        <div class="flex gap-1.5 sm:gap-2 justify-center mt-6" (paste)="onPaste($event)">
          @for (i of slots; track i; let idx = $index) {
            <input #slot class="w-10 h-12 sm:w-12 sm:h-14 text-center text-lg sm:text-xl font-bold input p-0"
                   maxlength="1" inputmode="numeric" pattern="[0-9]*"
                   [value]="digits[idx]"
                   (input)="onInput(idx, $event)"
                   (keydown)="onKey(idx, $event)">
          }
        </div>
        <div class="flex flex-col-reverse sm:flex-row gap-2 mt-6">
          <button class="btn btn-outline sm:flex-1" (click)="doCancel()">Annuler</button>
          <button class="btn btn-primary sm:flex-1" [disabled]="!complete()" (click)="doConfirm()">Valider</button>
        </div>
      </div>
    </afb-modal>
  `
})
export class OtpDialog {
  @Input() open = false;
  @Input() title = 'Authentification forte (OTP)';
  @Input() message = '';
  @Output() confirm = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();
  @ViewChildren('slot') slotsEl!: QueryList<ElementRef<HTMLInputElement>>;
  slots = [0,1,2,3,4,5];
  digits: string[] = ['','','','','',''];
  complete() { return this.digits.every(d => /\d/.test(d)); }

  onInput(idx: number, ev: Event) {
    const input = ev.target as HTMLInputElement;
    const v = input.value.replace(/\D/g,'').slice(0,1);
    this.digits[idx] = v;
    input.value = v;
    if (v && idx < 5) this.slotsEl.get(idx+1)?.nativeElement.focus();
  }
  onKey(idx: number, ev: KeyboardEvent) {
    if (ev.key === 'Backspace' && !this.digits[idx] && idx > 0) {
      this.slotsEl.get(idx-1)?.nativeElement.focus();
    }
    if (ev.key === 'ArrowLeft' && idx > 0) this.slotsEl.get(idx-1)?.nativeElement.focus();
    if (ev.key === 'ArrowRight' && idx < 5) this.slotsEl.get(idx+1)?.nativeElement.focus();
  }
  onPaste(ev: ClipboardEvent) {
    const data = ev.clipboardData?.getData('text')?.replace(/\D/g,'').slice(0,6) ?? '';
    if (!data) return;
    ev.preventDefault();
    for (let i=0; i<6; i++) {
      this.digits[i] = data[i] ?? '';
      const el = this.slotsEl.get(i)?.nativeElement;
      if (el) el.value = this.digits[i];
    }
    this.slotsEl.get(Math.min(data.length,5))?.nativeElement.focus();
  }
  autofill() {
    this.digits = ['1','2','3','4','5','6'];
    this.slotsEl.forEach((ref,i) => ref.nativeElement.value = this.digits[i]);
  }
  doConfirm() {
    if (!this.complete()) return;
    this.confirm.emit(this.digits.join(''));
    this.reset();
  }
  doCancel() { this.cancel.emit(); this.reset(); }
  reset() { this.digits = ['','','','','','']; this.slotsEl?.forEach(r => r.nativeElement.value = ''); }
}

/** Two-signature dialog — Supervisor + Middle Office Manager */
@Component({
  selector: 'afb-twosign-dialog',
  imports: [FormsModule, ModalShell],
  template: `
    <afb-modal [open]="open" size="lg" (cancel)="cancel.emit()">
      <div class="p-5 sm:p-6 overflow-y-auto">
        <h2 class="text-base sm:text-lg font-bold">Validation à double signature</h2>
        <p class="text-xs text-gray-500 mt-1">{{ message || 'Cette action requiert la signature du Superviseur et du Responsable Middle Office (irréversible).' }}</p>

        <div class="mt-5 space-y-4">
          <div class="border rounded-lg p-3 sm:p-4" [class.border-emerald-300]="sign1Ok()" [class.bg-emerald-50]="sign1Ok()">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="text-xs font-semibold text-gray-600 uppercase">Signature 1 · Superviseur MO</div>
              @if (sign1Ok()) { <span class="badge bg-emerald-100 text-emerald-700">✓ Signé</span> }
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <input class="input" placeholder="Identifiant" [(ngModel)]="sign1User" name="s1u">
              <input class="input" type="password" placeholder="Mot de passe" [(ngModel)]="sign1Pwd" name="s1p">
            </div>
          </div>
          <div class="border rounded-lg p-3 sm:p-4" [class.border-emerald-300]="sign2Ok()" [class.bg-emerald-50]="sign2Ok()">
            <div class="flex items-center justify-between flex-wrap gap-2">
              <div class="text-xs font-semibold text-gray-600 uppercase">Signature 2 · Responsable MO</div>
              @if (sign2Ok()) { <span class="badge bg-emerald-100 text-emerald-700">✓ Signé</span> }
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <input class="input" placeholder="Identifiant" [(ngModel)]="sign2User" name="s2u">
              <input class="input" type="password" placeholder="Mot de passe" [(ngModel)]="sign2Pwd" name="s2p">
            </div>
          </div>
          <div class="text-[11px] text-gray-500 italic">Les deux signataires doivent être distincts. Toutes les actions sont journalisées dans l'audit log immuable.</div>
        </div>

        <div class="flex flex-col-reverse sm:flex-row gap-2 mt-6">
          <button class="btn btn-outline sm:flex-1" (click)="cancel.emit()">Annuler</button>
          <button class="btn btn-success sm:flex-1" [disabled]="!canConfirm()" (click)="onConfirm()">✓ Signer et exécuter</button>
        </div>
      </div>
    </afb-modal>
  `
})
export class TwoSignDialog implements OnDestroy {
  @Input() open = false;
  @Input() message = '';
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
  sign1User = '';
  sign1Pwd = '';
  sign2User = '';
  sign2Pwd = '';
  /** Politique mot de passe : 8+ caractères, avec lettre et chiffre. */
  private readonly PWD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
  sign1Ok() { return !!this.sign1User && this.PWD_RE.test(this.sign1Pwd); }
  sign2Ok() { return !!this.sign2User && this.PWD_RE.test(this.sign2Pwd); }
  canConfirm() {
    return this.sign1Ok() && this.sign2Ok() && this.sign1User.trim() !== this.sign2User.trim();
  }
  onConfirm() {
    if (!this.canConfirm()) return;
    this.confirm.emit();
    this.clearSecrets();
  }
  /** Efface explicitement les credentials de la mémoire dès qu'ils ne sont plus utiles. */
  private clearSecrets() {
    this.sign1Pwd = '';
    this.sign2Pwd = '';
    this.sign1User = '';
    this.sign2User = '';
  }
  ngOnDestroy() { this.clearSecrets(); }
}

/** Simple confirm dialog */
@Component({
  selector: 'afb-confirm-dialog',
  imports: [ModalShell],
  template: `
    <afb-modal [open]="open" size="md" (cancel)="cancel.emit()">
      <div class="p-5 sm:p-6 overflow-y-auto">
        <h2 class="text-base sm:text-lg font-bold">{{ title }}</h2>
        <p class="text-sm text-gray-600 mt-2">{{ message }}</p>
        <div class="flex flex-col-reverse sm:flex-row gap-2 mt-6">
          <button class="btn btn-outline sm:flex-1" (click)="cancel.emit()">Annuler</button>
          <button class="btn sm:flex-1" [class.btn-danger]="danger" [class.btn-primary]="!danger" (click)="confirm.emit()">{{ confirmLabel }}</button>
        </div>
      </div>
    </afb-modal>
  `
})
export class ConfirmDialog {
  @Input() open = false;
  @Input() title = 'Confirmation';
  @Input() message = '';
  @Input() confirmLabel = 'Confirmer';
  @Input() danger = false;
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
}
