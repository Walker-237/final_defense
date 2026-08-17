import { Component, inject, signal, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ApiService, CoSignatureItem, CoSignaturePreuve } from '../../core/services/api';
import { ToastService } from '../../core/services/toast';
import { Paginator, PaginatePipe } from '../../shared/pagination';
import { ModalShell } from '../../shared/dialogs';
import { SignatureField } from '../../shared/signature-pad';
import { FaceScanComponent, FaceCaptureResult } from '../registration/face-scan';

/**
 * Espace investisseur — Validations en attente (comptes-titres JOINTS).
 *
 * Un signataire d'un compte joint voit ici les opérations initiées par un autre
 * signataire qui requièrent SA validation. Sans réponse de tous les signataires
 * dans le délai imparti (5 min), l'opération est automatiquement rejetée côté
 * serveur.
 *
 * <p><b>Valider engage</b> : on exige la même preuve qu'à l'inscription — la
 * signature manuscrite ET la capture du visage (avec contrôle de vivacité). Le
 * serveur compare ce visage à celui enregistré à l'ouverture du compte. Refuser
 * n'exige rien : on ne demande pas de prouver son identité pour dire non, et
 * l'exiger retiendrait un refus faute de caméra.</p>
 */
@Component({
  selector: 'afb-cosignatures',
  imports: [Paginator, PaginatePipe, ModalShell, SignatureField, FaceScanComponent],
  template: `
    <div>
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold">Validations en attente</h1>
          <p class="text-sm text-gray-500">
            Opérations sur votre compte-titres joint nécessitant votre signature.
          </p>
        </div>
        <button class="btn btn-outline shrink-0" (click)="load()" [disabled]="loading()">
          {{ loading() ? 'Chargement…' : '↻ Rafraîchir' }}
        </button>
      </div>

      @if (loading()) {
        <div class="card p-8 text-center text-gray-400 text-sm">Chargement…</div>
      } @else if (!items().length) {
        <div class="card p-10 text-center text-gray-400 text-sm">
          Aucune opération en attente de votre validation.
        </div>
      } @else {
        <div class="space-y-4">
          @for (it of (items() | paginate:page():10); track it.orderId) {
            <div class="card p-4 sm:p-5">
              <div class="flex flex-wrap items-start justify-between gap-4">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-sm font-bold">{{ it.reference }}</span>
                    <span class="badge bg-amber-100 text-amber-700">{{ it.nature }}</span>
                  </div>
                  <div class="text-sm text-gray-700">Émission <b>{{ it.emissionCode }}</b></div>
                  <div class="text-sm text-gray-600">
                    Volume : <b>{{ it.volume.toLocaleString('fr-FR') }}</b> ·
                    Montant : <b>{{ it.montant.toLocaleString('fr-FR') }} FCFA</b> ·
                    Taux/Prix : <b>{{ it.tauxSoumis }}</b>
                  </div>
                  <div class="text-xs" [class.text-red-600]="remaining(it) <= 60"
                       [class.text-gray-500]="remaining(it) > 60">
                    @if (remaining(it) > 0) {
                      ⏳ Expire dans {{ countdown(it) }}
                    } @else {
                      Délai dépassé — actualisez la page.
                    }
                  </div>
                </div>
                <div class="flex gap-2 shrink-0">
                  <button class="btn btn-primary" [disabled]="busy() || remaining(it) <= 0"
                          (click)="ouvrirValidation(it)">✔ Valider</button>
                  <button class="btn btn-outline !text-afb-red !border-afb-red"
                          [disabled]="busy() || remaining(it) <= 0"
                          (click)="refuser(it.orderId)">✖ Refuser</button>
                </div>
              </div>
            </div>
          }
        </div>
        <afb-paginator [total]="items().length" [pageSize]="10" [(page)]="page" />
        <p class="text-[11px] text-gray-400 mt-4 leading-relaxed">
          • Chaque signataire valide avec ses identifiants personnels (traçabilité).<br/>
          • Valider requiert votre signature et une capture de votre visage.<br/>
          • L'opération n'est transmise qu'une fois validée par tous les signataires.<br/>
          • Sans validation de tous dans le délai, l'opération est automatiquement rejetée.
        </p>
      }

      <!-- Validation : mêmes preuves qu'à l'inscription (signature + visage). -->
      <afb-modal [open]="!!enCours()" size="lg" (cancel)="fermerValidation()">
        @if (enCours(); as it) {
          <div class="space-y-4">
            <div>
              <h2 class="text-lg font-bold">Valider l'opération {{ it.reference }}</h2>
              <p class="text-sm text-gray-500">
                {{ it.nature }} · {{ it.emissionCode }} ·
                {{ it.volume.toLocaleString('fr-FR') }} titres ·
                {{ it.montant.toLocaleString('fr-FR') }} FCFA
              </p>
            </div>

            <div>
              <label class="label">1. Votre visage</label>
              @if (face()) {
                <div class="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
                  <span class="text-lg">✓</span> Visage capturé.
                  <button type="button" class="ml-auto text-xs underline" (click)="reprendreFace()">Reprendre</button>
                </div>
              } @else if (scanActif()) {
                <div class="rounded-lg border border-gray-200 p-3">
                  <afb-face-scan (captured)="onFace($event)" />
                </div>
              } @else {
                <button type="button" class="btn btn-outline w-full" (click)="scanActif.set(true)">
                  📷 Activer la caméra
                </button>
                <p class="text-[11px] text-gray-400 mt-1">
                  Contrôle de présence réelle : une photo présentée à la caméra est refusée.
                </p>
              }
            </div>

            <div>
              <label class="label">2. Votre signature</label>
              <afb-signature-field
                [(signatureData)]="signature"
                [height]="120"
                label="Cliquez pour apposer votre signature"
                hint="Souris, doigt ou stylet"
                dialogTitle="Signature de validation"
                dialogMessage="Signez pour valider cette opération." />
            </div>

            @if (manquants().length) {
              <div class="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p class="text-xs font-semibold text-amber-800">Pour valider, il reste à :</p>
                <ul class="mt-1 space-y-0.5">
                  @for (m of manquants(); track m) {
                    <li class="text-xs text-amber-700">• {{ m }}</li>
                  }
                </ul>
              </div>
            }

            <div class="flex justify-end gap-2 pt-2 border-t">
              <button class="btn btn-outline" (click)="fermerValidation()" [disabled]="busy()">Annuler</button>
              <button class="btn btn-primary" [disabled]="busy() || manquants().length"
                      (click)="confirmerValidation()">
                {{ busy() ? 'Validation…' : '✔ Valider l’opération' }}
              </button>
            </div>
          </div>
        }
      </afb-modal>
    </div>
  `,
})
export class CoSignatures implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly platformId = inject(PLATFORM_ID);

  items = signal<CoSignatureItem[]>([]);
  page = signal(1);
  loading = signal(true);
  busy = signal(false);

  /** Opération dont la validation est en cours de saisie (null = dialogue fermé). */
  enCours = signal<CoSignatureItem | null>(null);
  scanActif = signal(false);
  face = signal<FaceCaptureResult | null>(null);
  signature = '';
  /** Horloge (s) pour le décompte en direct. */
  now = signal(Date.now());
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.load();
    if (isPlatformBrowser(this.platformId)) {
      this.ticker = setInterval(() => this.now.set(Date.now()), 1000);
    }
  }

  ngOnDestroy(): void {
    if (this.ticker) clearInterval(this.ticker);
  }

  load(): void {
    this.loading.set(true);
    this.api.listPendingCoSignatures().subscribe({
      next: (list) => { this.items.set(list ?? []); this.loading.set(false); },
      error: () => { this.items.set([]); this.loading.set(false); },
    });
  }

  /** Secondes restantes avant expiration. */
  remaining(it: CoSignatureItem): number {
    const exp = new Date(it.expiresAt).getTime();
    return Math.max(0, Math.floor((exp - this.now()) / 1000));
  }

  countdown(it: CoSignatureItem): string {
    const s = this.remaining(it);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  // ───────────────── Validation : signature + visage ─────────────────

  ouvrirValidation(it: CoSignatureItem): void {
    this.enCours.set(it);
    this.scanActif.set(false);
    this.face.set(null);
    this.signature = '';
  }

  fermerValidation(): void {
    this.enCours.set(null);
    this.scanActif.set(false);
    this.face.set(null);
    this.signature = '';
  }

  onFace(result: FaceCaptureResult): void {
    this.face.set(result);
    this.scanActif.set(false);
  }

  reprendreFace(): void {
    this.face.set(null);
    this.scanActif.set(true);
  }

  /** Ce qui manque encore pour pouvoir valider — dit explicitement, sinon le
   *  bouton désactivé donne l'impression de « ne rien faire ». */
  manquants(): string[] {
    const out: string[] = [];
    if (!this.face()) out.push('capturer votre visage');
    if (!this.signature) out.push('apposer votre signature');
    return out;
  }

  confirmerValidation(): void {
    const it = this.enCours();
    const f = this.face();
    if (!it || !f || !this.signature || this.busy()) return;
    const preuve: CoSignaturePreuve = {
      signatureData: this.signature,
      imageBase64: f.imageBase64,
      livenessScore: f.livenessScore,
      challengeType: f.challengeType,
      descriptor: f.descriptor ?? undefined,
    };
    this.envoyer(it.orderId, true, preuve);
  }

  /** Refus — n'exige aucune preuve (voir la note de classe). */
  refuser(orderId: string): void {
    this.envoyer(orderId, false);
  }

  private envoyer(orderId: string, approve: boolean, preuve?: CoSignaturePreuve): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.coSignOrder(orderId, approve, preuve).subscribe({
      next: () => {
        this.busy.set(false);
        this.fermerValidation();
        this.toast.success(approve ? 'Opération validée' : 'Opération refusée',
          approve ? 'Votre signature a été enregistrée.' : "L'opération a été rejetée.");
        this.load();
      },
      error: () => {
        this.busy.set(false);
        this.toast.error('Échec', 'Action impossible.');
        this.load();
      },
    });
  }
}
