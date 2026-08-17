import { Component, Input, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ORDER_FACE_CHECK } from '../../core/services/api-endpoints';
import { ToastService } from '../../core/services/toast';

interface OrderFaceCheck {
  orderId: string;
  photoOuverture: string;   // data URL — photo prise à l'ouverture du compte
  photoOrdre: string;       // data URL — photo prise au moment de l'ordre
  distance: number;         // -1 si incomparable
  seuil: number;
  matchStatus: 'CORRESPOND' | 'DIFFERENT' | 'NON_COMPARABLE';
  livenessScore: number;
  verificationStatus: 'EN_ATTENTE' | 'VALIDE' | 'REJETE';
  /** Taux de fiabilité : confiance de l'IA que les deux photos montrent la même
   *  personne. Absent si aucun visage de référence n'était disponible. */
  tauxFiabilite?: number;
  commentaire?: string;
}

/**
 * Back-office — comparaison des DEUX photos d'un ordre : celle de l'ouverture de
 * compte et celle prise au moment de l'ordre.
 *
 * <p>La comparaison automatique (distance calculée par le serveur) est un
 * <b>indice</b>, pas un verdict : l'agent tranche en regardant les deux visages
 * côte à côte. Un écart n'a jamais bloqué l'ordre — il l'a seulement signalé.</p>
 */
@Component({
  selector: 'afb-order-face-compare',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    @if (chargement()) {
      <p class="text-sm text-gray-400 text-center py-6">Chargement du contrôle facial…</p>
    } @else if (absent()) {
      <p class="text-sm text-amber-600 text-center py-6">
        ⚠️ Aucun contrôle facial pour cet ordre (le client a passé l'étape).
      </p>
    } @else if (check(); as c) {
      <div class="flex flex-col items-center gap-4">
        <!-- Les deux visages côte à côte -->
        <div class="grid grid-cols-2 gap-4">
          <figure class="text-center">
            <img [src]="c.photoOuverture" alt="Photo à l'ouverture du compte"
                 class="w-40 h-40 object-cover rounded-xl border-2 border-gray-200 bg-gray-100">
            <figcaption class="text-[11px] text-gray-500 mt-1">Ouverture du compte</figcaption>
          </figure>
          <figure class="text-center">
            <img [src]="c.photoOrdre" alt="Photo au moment de l'ordre"
                 class="w-40 h-40 object-cover rounded-xl border-2"
                 [class.border-emerald-400]="c.matchStatus === 'CORRESPOND'"
                 [class.border-red-400]="c.matchStatus === 'DIFFERENT'"
                 [class.border-amber-400]="c.matchStatus === 'NON_COMPARABLE'">
            <figcaption class="text-[11px] text-gray-500 mt-1">Au moment de l'ordre</figcaption>
          </figure>
        </div>

        <!-- Verdict automatique (indicatif) -->
        <div class="text-center">
          <span class="badge"
                [class.bg-emerald-100]="c.matchStatus === 'CORRESPOND'"
                [class.text-emerald-700]="c.matchStatus === 'CORRESPOND'"
                [class.bg-red-100]="c.matchStatus === 'DIFFERENT'"
                [class.text-red-700]="c.matchStatus === 'DIFFERENT'"
                [class.bg-amber-100]="c.matchStatus === 'NON_COMPARABLE'"
                [class.text-amber-700]="c.matchStatus === 'NON_COMPARABLE'">
            {{ verdict(c.matchStatus) }}
          </span>
          <p class="text-[11px] text-gray-500 mt-1">
            @if (c.tauxFiabilite != null) {
              Taux de fiabilité <b class="text-gray-700">{{ (c.tauxFiabilite * 100) | number:'1.0-0' }}%</b> ·
            }
            Vivacité {{ (c.livenessScore * 100) | number:'1.0-0' }}%
          </p>
          @if (c.commentaire) {
            <p class="text-[11px] text-gray-500 mt-0.5 max-w-xs mx-auto">{{ c.commentaire }}</p>
          }
          <p class="text-[11px] text-gray-400 mt-0.5">
            Comparaison automatique indicative — votre décision fait foi.
          </p>
        </div>

        <!-- Revue humaine -->
        @if (c.verificationStatus === 'EN_ATTENTE') {
          <div class="flex gap-2">
            <button type="button" class="btn btn-success text-xs" [disabled]="busy()" (click)="verifier('VALIDE')">✓ C'est bien le titulaire</button>
            <button type="button" class="btn btn-danger text-xs" [disabled]="busy()" (click)="verifier('REJETE')">✕ Ce n'est pas lui</button>
          </div>
        } @else {
          <span class="text-xs font-semibold"
                [class.text-emerald-600]="c.verificationStatus === 'VALIDE'"
                [class.text-afb-red]="c.verificationStatus === 'REJETE'">
            {{ c.verificationStatus === 'VALIDE' ? '✓ Identité validée par le back-office' : '✕ Identité rejetée par le back-office' }}
          </span>
        }
      </div>
    }
  `,
})
export class OrderFaceCompare {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  @Input() set orderId(id: string | null | undefined) {
    if (id) this.charger(id);
  }

  readonly check = signal<OrderFaceCheck | null>(null);
  readonly chargement = signal(false);
  readonly absent = signal(false);
  readonly busy = signal(false);
  private current = '';

  private charger(orderId: string): void {
    this.current = orderId;
    this.chargement.set(true);
    this.absent.set(false);
    this.http.get<OrderFaceCheck>(ORDER_FACE_CHECK.ADMIN_GET(orderId)).subscribe({
      next: (c) => { this.check.set(c); this.chargement.set(false); },
      error: () => { this.absent.set(true); this.check.set(null); this.chargement.set(false); },
    });
  }

  verdict(s: string): string {
    if (s === 'CORRESPOND') return '✓ Visage correspondant';
    if (s === 'DIFFERENT') return '⚠️ Visage différent — à vérifier';
    return '⚠️ Non comparable (pas d’empreinte de référence)';
  }

  verifier(status: 'VALIDE' | 'REJETE'): void {
    const c = this.check();
    if (!c || this.busy()) return;
    this.busy.set(true);
    this.http.post(ORDER_FACE_CHECK.ADMIN_VERIFY(this.current), { status }).subscribe({
      next: () => {
        this.toast.success(status === 'VALIDE' ? 'Identité validée' : 'Identité rejetée');
        this.check.set({ ...c, verificationStatus: status });
        this.busy.set(false);
      },
      error: () => { this.toast.error('Action impossible.'); this.busy.set(false); },
    });
  }
}
