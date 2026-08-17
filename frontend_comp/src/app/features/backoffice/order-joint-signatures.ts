import { Component, Input, inject, signal, computed, output } from '@angular/core';
import { DecimalPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, OrderSignataire, OrderSignaturesView } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';

/**
 * Back-office — vue « compte joint » d'un ordre : <b>toutes</b> les personnes
 * liées au compte-titres, qui a validé et qui est encore en attente.
 *
 * <p>Pour chacune, ses deux photos côte à côte — celle prise à l'<b>ouverture</b>
 * du compte et celle prise au <b>moment de sa validation</b> — plus sa signature
 * et la distance calculée par le serveur. La comparaison automatique est un
 * <b>indice</b>, jamais un verdict : l'agent tranche en regardant les visages.</p>
 *
 * <p>L'agent peut <b>transmettre l'ordre sans attendre</b> tous les signataires
 * (validation forcée, motif obligatoire) — prévu pour un signataire injoignable
 * alors que la fenêtre de souscription se ferme, ou un accord recueilli hors
 * ligne. Un refus explicite, lui, ne se contourne pas : l'ordre est déjà annulé.</p>
 */
@Component({
  selector: 'afb-order-joint-signatures',
  standalone: true,
  imports: [DecimalPipe, DatePipe, FormsModule],
  template: `
    @if (chargement()) {
      <p class="text-sm text-gray-400 text-center py-6">Chargement des signataires…</p>
    } @else if (vue(); as v) {
      @if (!v.joint) {
        <p class="text-sm text-gray-400 text-center py-6">
          Compte individuel — un seul titulaire, pas de cosignature.
        </p>
      } @else {
        <div class="space-y-4">
          <!-- Avancement des validations -->
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="font-bold text-sm">Compte joint — validations</h3>
              <p class="text-xs text-gray-500">
                {{ v.signaturesObtenues }} / {{ v.signaturesAttendues }} signature(s) obtenue(s)
                @if (enAttente() > 0) { · <b class="text-amber-700">{{ enAttente() }} en attente</b> }
              </p>
            </div>
            @if (v.status === 'EN_ATTENTE_SIGNATURES') {
              <button type="button" class="btn btn-outline text-xs shrink-0"
                      (click)="ouvrirForce()" [disabled]="busy()">
                ⚡ Valider sans attendre
              </button>
            }
          </div>

          @if (v.bypassedAt) {
            <div class="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
              ⚡ Ordre transmis par <b>{{ v.bypassPar }}</b> le
              {{ v.bypassedAt | date:'dd/MM/yyyy HH:mm' }} sans attendre tous les signataires.<br>
              Motif : {{ v.bypassMotif }}
            </div>
          }

          <!-- Une ligne par personne liée au compte -->
          <div class="space-y-3">
            @for (p of v.personnes; track p.userId) {
              <div class="rounded-lg border p-3"
                   [class.border-emerald-200]="p.statut === 'SIGNED'"
                   [class.bg-emerald-50/40]="p.statut === 'SIGNED'"
                   [class.border-amber-200]="p.statut === 'PENDING'"
                   [class.bg-amber-50/40]="p.statut === 'PENDING'"
                   [class.border-red-200]="p.statut === 'REJECTED'">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                      <span class="font-semibold text-sm">{{ p.nom }}</span>
                      <span class="badge bg-gray-100 text-gray-600 text-[10px]">{{ p.role }}</span>
                      <span class="badge text-[10px]" [class]="badge(p.statut)">{{ libelle(p.statut) }}</span>
                    </div>
                    <p class="text-[11px] text-gray-500 truncate">{{ p.email }}</p>
                    <p class="text-[11px] text-gray-400">
                      @if (p.decidedAt) {
                        Décidé le {{ p.decidedAt | date:'dd/MM/yyyy HH:mm' }}
                      } @else if (p.statut === 'PENDING' && p.expiresAt) {
                        Expire le {{ p.expiresAt | date:'dd/MM/yyyy HH:mm' }}
                      }
                    </p>
                  </div>

                  <!-- Les deux photos de CETTE personne, côte à côte -->
                  <div class="flex items-start gap-3 shrink-0">
                    <figure class="text-center">
                      @if (p.photoOuverture) {
                        <img [src]="p.photoOuverture" [alt]="'Photo à l’ouverture — ' + p.nom"
                             class="w-20 h-20 object-cover rounded-lg border-2 border-gray-200 bg-gray-100">
                      } @else {
                        <div class="w-20 h-20 rounded-lg border-2 border-dashed border-gray-200
                                    bg-gray-50 flex items-center justify-center text-[10px] text-gray-400">
                          aucune
                        </div>
                      }
                      <figcaption class="text-[10px] text-gray-500 mt-0.5">Ouverture</figcaption>
                    </figure>
                    <figure class="text-center">
                      @if (p.photoSoumission) {
                        <img [src]="p.photoSoumission" [alt]="'Photo à la soumission — ' + p.nom"
                             class="w-20 h-20 object-cover rounded-lg border-2"
                             [class.border-emerald-400]="p.matchStatus === 'CORRESPOND'"
                             [class.border-red-400]="p.matchStatus === 'DIFFERENT'"
                             [class.border-amber-400]="p.matchStatus === 'NON_COMPARABLE'">
                      } @else {
                        <div class="w-20 h-20 rounded-lg border-2 border-dashed border-gray-200
                                    bg-gray-50 flex items-center justify-center text-[10px] text-gray-400">
                          en attente
                        </div>
                      }
                      <figcaption class="text-[10px] text-gray-500 mt-0.5">Soumission</figcaption>
                    </figure>
                    @if (p.signature) {
                      <figure class="text-center">
                        <img [src]="p.signature" [alt]="'Signature — ' + p.nom"
                             class="w-24 h-20 object-contain rounded-lg border bg-white">
                        <figcaption class="text-[10px] text-gray-500 mt-0.5">Signature</figcaption>
                      </figure>
                    }
                  </div>
                </div>

                @if (p.photoSoumission) {
                  <p class="text-[11px] mt-2"
                     [class.text-emerald-700]="p.matchStatus === 'CORRESPOND'"
                     [class.text-red-600]="p.matchStatus === 'DIFFERENT'"
                     [class.text-amber-700]="p.matchStatus === 'NON_COMPARABLE'">
                    {{ verdict(p.matchStatus) }}
                    @if (p.distance >= 0) {
                      · distance {{ p.distance | number:'1.3-3' }} (seuil {{ v.seuil }})
                    }
                    · vivacité {{ (p.livenessScore * 100) | number:'1.0-0' }}%
                  </p>
                }
              </div>
            }
          </div>
          <p class="text-[11px] text-gray-400">
            Comparaison automatique indicative — votre décision fait foi.
          </p>
        </div>
      }
    }

    <!-- Validation forcée : motif obligatoire (trace de qui a tranché, et pourquoi). -->
    @if (forceOuvert()) {
      <div class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
        <p class="text-xs text-amber-900">
          L'ordre sera <b>transmis immédiatement</b>. Les signataires encore en attente ne
          pourront plus se prononcer et tous seront notifiés.
        </p>
        <textarea class="input text-xs" rows="2" [(ngModel)]="motif" name="motifForce"
                  placeholder="Motif (obligatoire) — ex. accord recueilli en agence, clôture imminente"></textarea>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn btn-outline text-xs" (click)="forceOuvert.set(false)"
                  [disabled]="busy()">Annuler</button>
          <button type="button" class="btn btn-danger text-xs"
                  [disabled]="busy() || motif.trim().length < 3" (click)="forcer()">
            {{ busy() ? 'Validation…' : 'Confirmer la transmission' }}
          </button>
        </div>
      </div>
    }
  `,
})
export class OrderJointSignatures {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  @Input() set orderId(id: string | null | undefined) {
    if (id) this.charger(id);
  }

  /** Émis après une validation forcée — le parent rafraîchit l'ordre. */
  readonly changed = output<void>();

  readonly vue = signal<OrderSignaturesView | null>(null);
  readonly chargement = signal(false);
  readonly busy = signal(false);
  readonly forceOuvert = signal(false);
  motif = '';
  private current = '';

  readonly enAttente = computed(
    () => this.vue()?.personnes.filter((p) => p.statut === 'PENDING').length ?? 0);

  private charger(orderId: string): void {
    this.current = orderId;
    this.chargement.set(true);
    this.api.getOrderSignatures(orderId).subscribe({
      next: (v) => { this.vue.set(v); this.chargement.set(false); },
      error: () => { this.vue.set(null); this.chargement.set(false); },
    });
  }

  ouvrirForce(): void {
    this.motif = '';
    this.forceOuvert.set(true);
  }

  forcer(): void {
    if (this.busy() || this.motif.trim().length < 3) return;
    this.busy.set(true);
    this.api.forceValidateOrder(this.current, this.motif.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.forceOuvert.set(false);
        this.toast.success('Ordre transmis', 'Les signataires ont été notifiés.');
        this.charger(this.current);
        this.changed.emit();
      },
      error: () => { this.busy.set(false); this.toast.error('Action impossible.'); },
    });
  }

  libelle(s: OrderSignataire['statut']): string {
    const table: Record<string, string> = {
      EMETTEUR: 'a initié l’ordre',
      SIGNED: '✓ a validé',
      PENDING: '⏳ en attente',
      REJECTED: '✕ a refusé',
      EXPIRED: 'délai dépassé',
      BYPASSED: '⚡ passé outre',
    };
    return table[s] ?? s;
  }

  badge(s: OrderSignataire['statut']): string {
    const table: Record<string, string> = {
      EMETTEUR: 'bg-blue-100 text-blue-700',
      SIGNED: 'bg-emerald-100 text-emerald-700',
      PENDING: 'bg-amber-100 text-amber-700',
      REJECTED: 'bg-red-100 text-red-700',
      EXPIRED: 'bg-gray-200 text-gray-600',
      BYPASSED: 'bg-purple-100 text-purple-700',
    };
    return table[s] ?? 'bg-gray-100 text-gray-600';
  }

  verdict(s: string): string {
    if (s === 'CORRESPOND') return '✓ Visage correspondant';
    if (s === 'DIFFERENT') return '⚠️ Visage différent — à vérifier';
    return '⚠️ Non comparable (pas d’empreinte de référence)';
  }
}
