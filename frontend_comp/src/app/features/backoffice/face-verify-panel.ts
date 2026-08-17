import {
  Component, ElementRef, Input, OnDestroy, PLATFORM_ID,
  ViewChild, inject, signal,
} from '@angular/core';
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ADMIN_REGISTRATIONS } from '../../core/services/api-endpoints';
import { ToastService } from '../../core/services/toast';

export interface FaceDetail {
  faceId: string;
  dossierId: string;
  imageBase64: string;
  landmarksJson: string;
  livenessScore: number;
  challengeType: string;
  verificationStatus: string;
}

/**
 * Panneau de vérification faciale réutilisable.
 *
 * <p>Affiche la photo capturée avec les <b>468 marqueurs rouges</b> superposés,
 * une vue <b>3D</b> (nuage de points en rotation, confirme le relief), et permet
 * de <b>valider / rejeter</b> l'identité. Utilisable soit par dossier
 * d'inscription (`[dossierId]`), soit directement depuis le <b>dossier du
 * client</b> (`[userId]`).</p>
 */
@Component({
  selector: 'afb-face-verify-panel',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    @if (chargement()) {
      <p class="text-sm text-gray-400 text-center py-6">Chargement de la capture…</p>
    } @else if (erreur()) {
      <p class="text-sm text-gray-400 text-center py-6">{{ erreur() }}</p>
    } @else if (face()) {
      <div class="flex flex-col items-center gap-3">
        <div class="relative rounded-xl overflow-hidden bg-gray-900" [style.width.px]="300" [style.height.px]="300">
          <canvas #canvas2d class="absolute inset-0 w-full h-full" [class.hidden]="mode3d()" width="300" height="300"></canvas>
          <canvas #canvas3d class="absolute inset-0 w-full h-full" [class.hidden]="!mode3d()" width="300" height="300"></canvas>
        </div>

        <div class="flex items-center gap-3 text-xs text-gray-500">
          <span>Vivacité <b>{{ (face()!.livenessScore * 100) | number:'1.0-0' }}%</b></span>
          <span>·</span>
          <span>Statut
            <b [class.text-emerald-600]="face()!.verificationStatus === 'VALIDE'"
               [class.text-afb-red]="face()!.verificationStatus === 'REJETE'">
              {{ statutLabel(face()!.verificationStatus) }}
            </b>
          </span>
          <button type="button" class="btn btn-ghost text-[11px] py-0.5 px-2" (click)="basculer3d()">
            {{ mode3d() ? '🖼 Image' : '🧊 3D' }}
          </button>
        </div>

        @if (actions) {
          <div class="flex gap-2">
            <button type="button" class="btn btn-success text-xs" [disabled]="busy()" (click)="verifier('VALIDE')">✓ Valider la photo</button>
            <button type="button" class="btn btn-danger text-xs" [disabled]="busy()" (click)="verifier('REJETE')">✕ Rejeter</button>
          </div>
        }
      </div>
    }
  `,
})
export class FaceVerifyPanel implements OnDestroy {
  @ViewChild('canvas2d') canvas2d?: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvas3d') canvas3d?: ElementRef<HTMLCanvasElement>;

  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Charger par dossier d'inscription. */
  @Input() set dossierId(id: string | null | undefined) {
    if (id) this.charger(ADMIN_REGISTRATIONS.FACE(id));
  }
  /** Ou charger par client (dossier client du back-office). */
  @Input() set userId(id: string | null | undefined) {
    if (id) this.charger(ADMIN_REGISTRATIONS.FACE_BY_USER(id));
  }
  /** Afficher les boutons valider / rejeter. */
  @Input() actions = true;

  readonly face = signal<FaceDetail | null>(null);
  readonly chargement = signal(false);
  readonly erreur = signal('');
  readonly mode3d = signal(false);
  readonly busy = signal(false);

  private landmarks: number[][] = [];
  private angle = 0;
  private rafId = 0;

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  private charger(url: string): void {
    if (!this.isBrowser) return;
    this.chargement.set(true);
    this.erreur.set('');
    this.http.get<FaceDetail>(url).subscribe({
      next: (f) => {
        this.face.set(f);
        try { this.landmarks = JSON.parse(f.landmarksJson) as number[][]; }
        catch { this.landmarks = []; }
        this.chargement.set(false);
        this.mode3d.set(false);
        setTimeout(() => this.dessiner2d(), 0);
      },
      error: () => {
        this.erreur.set('Aucune capture faciale pour ce client.');
        this.chargement.set(false);
      },
    });
  }

  verifier(status: 'VALIDE' | 'REJETE'): void {
    const f = this.face();
    if (!f || this.busy()) return;
    this.busy.set(true);
    this.http.post(ADMIN_REGISTRATIONS.VERIFY(f.dossierId), { status }).subscribe({
      next: () => {
        this.toast.success(status === 'VALIDE' ? 'Photo validée' : 'Photo rejetée');
        this.face.set({ ...f, verificationStatus: status });
        this.busy.set(false);
      },
      error: () => { this.toast.error('Action impossible.'); this.busy.set(false); },
    });
  }

  statutLabel(s: string): string {
    return s === 'VALIDE' ? 'Validée' : s === 'REJETE' ? 'Rejetée' : 'En attente';
  }

  basculer3d(): void {
    cancelAnimationFrame(this.rafId);
    this.mode3d.set(!this.mode3d());
    setTimeout(() => (this.mode3d() ? this.boucle3d() : this.dessiner2d()), 0);
  }

  // ── Photo + marqueurs rouges ───────────────────────────────────────────────

  private dessiner2d(): void {
    const canvas = this.canvas2d?.nativeElement;
    const f = this.face();
    if (!canvas || !f || !this.isBrowser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      ctx.fillStyle = 'rgba(220,20,40,0.9)';
      for (const p of this.landmarks) {
        ctx.beginPath();
        ctx.arc(p[0] * W, p[1] * H, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    img.src = f.imageBase64;
  }

  // ── Nuage de points 3D en rotation ────────────────────────────────────────

  private boucle3d = (): void => {
    const canvas = this.canvas3d?.nativeElement;
    if (!canvas || !this.mode3d()) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);

    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    for (const p of this.landmarks) {
      const x = p[0] - 0.5, y = p[1] - 0.5, z = p[2] ?? 0;
      const xr = x * cos - z * sin;
      const zr = x * sin + z * cos;
      const prof = Math.max(0.2, Math.min(1, 0.6 - zr * 2));
      ctx.fillStyle = `rgba(${Math.round(230 * prof)},30,50,0.95)`;
      ctx.beginPath();
      ctx.arc(W / 2 + xr * W * 0.8, H / 2 + y * H * 0.8, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    this.angle += 0.02;
    this.rafId = requestAnimationFrame(this.boucle3d);
  };
}
