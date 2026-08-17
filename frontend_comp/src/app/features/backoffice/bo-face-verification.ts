import {
  AfterViewInit, Component, ElementRef, OnDestroy, PLATFORM_ID,
  ViewChild, inject, signal,
} from '@angular/core';
import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ADMIN_REGISTRATIONS } from '../../core/services/api-endpoints';
import { ToastService } from '../../core/services/toast';

interface CaptureRow {
  dossier_id: string;
  type_personne: string;
  nom: string;
  prenom?: string;
  liveness_score: number;
  verification_status: 'EN_ATTENTE' | 'VALIDE' | 'REJETE';
}

/** Dossier complet vu par l'agent : identité, pièces déposées, compte espèces. */
interface DossierDetail {
  dossierId: string;
  statut: string;
  typePersonne: string;
  compteEspeces: string;
  /** Compte-titres déjà connu du référentiel (clients_fb.compte_depot) — pré-remplit l'attribution. */
  compteTitresBase?: string;
  email: string;
  nom: string;
  prenom: string;
  telephone: string;
  pieces: Array<{
    id: string; cote: string; document_type?: string;
    ocr_texte?: string; imageBase64: string;
    /** Analyse d'authenticite IA (indicative) — cf. addendum, jamais bloquante :
     *  la decision finale d'acceptation reste celle de l'agent. */
    authenticiteVerdict?: 'AUTHENTIQUE' | 'SUSPECT' | 'INDETERMINE';
    authenticiteScore?: number;
    authenticiteCommentaire?: string;
  }>;
}

interface FaceDetail {
  faceId: string;
  imageBase64: string;
  landmarksJson: string;
  livenessScore: number;
  challengeType: string;
  width: number;
  height: number;
  verificationStatus: string;
  /** Taux de fiabilité : confiance de l'IA que le selfie et la photo de la pièce
   *  déposée montrent la même personne. Indicatif — la décision finale reste
   *  celle de l'agent. Absent tant qu'aucune pièce RECTO n'a été déposée. */
  faceMatchVerdict?: 'CORRESPOND' | 'NE_CORRESPOND_PAS' | 'INDETERMINE';
  faceMatchScore?: number;
  faceMatchCommentaire?: string;
}

/**
 * Back-office — vérification faciale des dossiers d'inscription.
 *
 * <p>L'agent relit la capture : l'image reçoit les <b>468 marqueurs rouges</b>
 * en superposition, et une vue <b>3D</b> (nuage de points x,y,z en rotation)
 * confirme le relief du visage avant de valider ou rejeter l'identité.</p>
 */
@Component({
  selector: 'afb-bo-face-verification',
  standalone: true,
  imports: [DecimalPipe, FormsModule],
  template: `
    <div class="max-w-5xl">
      <div class="mb-6">
        <h1 class="text-xl sm:text-2xl font-bold">Vérification faciale des inscriptions</h1>
        <p class="text-sm text-gray-500">Contrôle des captures faciales avant validation d'un dossier d'ouverture.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-[20rem_1fr] gap-4">
        <!-- File des captures -->
        <div class="card overflow-hidden">
          <div class="card-header"><h2 class="font-semibold text-sm">File d'attente</h2></div>
          <div class="divide-y max-h-[28rem] overflow-y-auto">
            @for (c of captures(); track c.dossier_id) {
              <button type="button" class="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center gap-2"
                      [class.bg-afb-red-light]="selected()?.faceId && current === c.dossier_id"
                      (click)="ouvrir(c.dossier_id)">
                <span class="flex-1 min-w-0">
                  <span class="block text-sm font-medium truncate">{{ c.nom }} {{ c.prenom }}</span>
                  <span class="block text-[11px] text-gray-400">vivacité {{ (c.liveness_score * 100) | number:'1.0-0' }}%</span>
                </span>
                <span class="badge text-[10px]"
                      [class.bg-amber-100]="c.verification_status === 'EN_ATTENTE'"
                      [class.text-amber-700]="c.verification_status === 'EN_ATTENTE'"
                      [class.bg-emerald-100]="c.verification_status === 'VALIDE'"
                      [class.text-emerald-700]="c.verification_status === 'VALIDE'"
                      [class.bg-red-100]="c.verification_status === 'REJETE'"
                      [class.text-red-700]="c.verification_status === 'REJETE'">
                  {{ statutLabel(c.verification_status) }}
                </span>
              </button>
            } @empty {
              <p class="px-3 py-6 text-center text-xs text-gray-400">Aucune capture à vérifier.</p>
            }
          </div>
        </div>

        <!-- Visionneuse -->
        <div class="card">
          <div class="card-header flex items-center justify-between">
            <h2 class="font-semibold text-sm">Capture</h2>
            @if (selected()) {
              <button type="button" class="btn btn-ghost text-xs" (click)="basculer3d()">
                {{ mode3d() ? '🖼 Vue image' : '🧊 Vue 3D' }}
              </button>
            }
          </div>
          <div class="card-body">
            @if (!selected()) {
              <p class="text-sm text-gray-400 text-center py-16">Sélectionnez une capture dans la file.</p>
            } @else {
              <div class="flex flex-col items-center gap-4">
                <div class="relative rounded-xl overflow-hidden bg-gray-900" [style.width.px]="360" [style.height.px]="360">
                  <canvas #canvas2d class="absolute inset-0 w-full h-full" [class.hidden]="mode3d()" width="360" height="360"></canvas>
                  <canvas #canvas3d class="absolute inset-0 w-full h-full" [class.hidden]="!mode3d()" width="360" height="360"></canvas>
                </div>
                <div class="text-xs text-gray-500 flex gap-4">
                  <span>Vivacité : <b>{{ (selected()!.livenessScore * 100) | number:'1.0-0' }}%</b></span>
                  <span>Challenge : <b>{{ selected()!.challengeType }}</b></span>
                  <span>Statut : <b>{{ statutLabel(selected()!.verificationStatus) }}</b></span>
                </div>
                @if (selected()!.faceMatchVerdict) {
                  <div class="flex items-center gap-2 text-xs" [title]="selected()!.faceMatchCommentaire || ''">
                    <span class="badge text-[10px]"
                          [class.bg-emerald-100]="selected()!.faceMatchVerdict === 'CORRESPOND'"
                          [class.text-emerald-700]="selected()!.faceMatchVerdict === 'CORRESPOND'"
                          [class.bg-red-100]="selected()!.faceMatchVerdict === 'NE_CORRESPOND_PAS'"
                          [class.text-red-700]="selected()!.faceMatchVerdict === 'NE_CORRESPOND_PAS'"
                          [class.bg-gray-100]="selected()!.faceMatchVerdict === 'INDETERMINE'"
                          [class.text-gray-600]="selected()!.faceMatchVerdict === 'INDETERMINE'">
                      {{ faceMatchLabel(selected()!.faceMatchVerdict) }}
                    </span>
                    @if (selected()!.faceMatchScore != null) {
                      <span class="text-gray-500">
                        Taux de fiabilité (selfie ↔ pièce) :
                        <b class="text-gray-700">{{ (selected()!.faceMatchScore! * 100) | number:'1.0-0' }}%</b>
                      </span>
                    }
                  </div>
                } @else {
                  <p class="text-[11px] text-gray-400">
                    Taux de fiabilité indisponible — en attente du dépôt de la pièce d'identité (recto).
                  </p>
                }
                <div class="flex gap-2">
                  <button type="button" class="btn btn-success text-sm" [disabled]="busy()" (click)="verifier('VALIDE')">✓ Valider l'identité</button>
                  <button type="button" class="btn btn-danger text-sm" [disabled]="busy()" (click)="verifier('REJETE')">✕ Rejeter</button>
                </div>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Dossier : pièces d'identité, compte-titres à attribuer, décision -->
      @if (dossier(); as d) {
        <div class="card mt-4">
          <div class="card-header flex items-center justify-between">
            <h2 class="font-semibold text-sm">Dossier d'ouverture — {{ d.nom }} {{ d.prenom }}</h2>
            <span class="badge text-[10px]"
                  [class.bg-amber-100]="d.statut === 'EN_ATTENTE_VERIFICATION'"
                  [class.text-amber-700]="d.statut === 'EN_ATTENTE_VERIFICATION'"
                  [class.bg-emerald-100]="d.statut === 'VALIDE'"
                  [class.text-emerald-700]="d.statut === 'VALIDE'"
                  [class.bg-red-100]="d.statut === 'REJETE'"
                  [class.text-red-700]="d.statut === 'REJETE'">{{ d.statut }}</span>
          </div>
          <div class="card-body space-y-4">
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div><div class="text-gray-500">E-mail</div><div class="font-medium break-all">{{ d.email }}</div></div>
              <div><div class="text-gray-500">Téléphone</div><div class="font-medium">{{ d.telephone || '—' }}</div></div>
              <div><div class="text-gray-500">Type</div><div class="font-medium">{{ d.typePersonne }}</div></div>
              <div><div class="text-gray-500">Compte espèces</div><div class="font-mono">{{ d.compteEspeces }}</div></div>
            </div>

            <div>
              <h3 class="text-xs font-semibold text-gray-600 mb-2">Pièce d'identité</h3>
              @if (d.pieces.length) {
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  @for (p of d.pieces; track p.id) {
                    <figure class="border rounded-lg overflow-hidden">
                      <img [src]="p.imageBase64" [alt]="'Pièce ' + p.cote" class="w-full object-contain bg-gray-900 max-h-56">
                      <figcaption class="px-2 py-1.5 text-[11px] text-gray-500 flex justify-between">
                        <span>{{ p.cote }}</span>
                        <span>{{ p.document_type || 'Type non reconnu' }}</span>
                      </figcaption>
                      @if (p.authenticiteVerdict) {
                        <div class="px-2 pb-2 flex items-center gap-2 flex-wrap" [title]="p.authenticiteCommentaire || ''">
                          <span class="badge text-[10px]"
                                [class.bg-emerald-100]="p.authenticiteVerdict === 'AUTHENTIQUE'"
                                [class.text-emerald-700]="p.authenticiteVerdict === 'AUTHENTIQUE'"
                                [class.bg-red-100]="p.authenticiteVerdict === 'SUSPECT'"
                                [class.text-red-700]="p.authenticiteVerdict === 'SUSPECT'"
                                [class.bg-gray-100]="p.authenticiteVerdict === 'INDETERMINE'"
                                [class.text-gray-600]="p.authenticiteVerdict === 'INDETERMINE'">
                            {{ authenticiteLabel(p.authenticiteVerdict) }}
                          </span>
                          @if (p.authenticiteScore != null) {
                            <span class="text-[10px] text-gray-500">
                              Confiance (document) : <b class="text-gray-700">{{ (p.authenticiteScore * 100) | number:'1.0-0' }}%</b>
                            </span>
                          }
                        </div>
                        @if (p.authenticiteCommentaire) {
                          <p class="px-2 pb-2 text-[10px] text-gray-400 leading-snug">{{ p.authenticiteCommentaire }}</p>
                        }
                      }
                    </figure>
                  }
                </div>
              } @else {
                <p class="text-xs text-gray-400">Aucune pièce déposée.</p>
              }
            </div>

            @if (d.statut === 'EN_ATTENTE_VERIFICATION') {
              <div class="border-t pt-4 space-y-3">
                <div>
                  <label class="label" for="ct">Compte-titres à attribuer</label>
                  <input id="ct" class="input font-mono" [(ngModel)]="compteTitres" name="ct"
                         placeholder="037 10001 00000000000">
                  @if (d.compteTitresBase) {
                    <p class="text-[11px] text-emerald-700 mt-1">
                      ✓ Compte-titres repris de la base clients : <b class="font-mono">{{ d.compteTitresBase }}</b>
                    </p>
                  }
                  <p class="text-[11px] text-gray-500 mt-1">
                    Facultatif : vous pouvez valider sans, le client apparaîtra alors
                    <b class="text-red-700">en rouge</b> tant que le compte n'est pas renseigné.
                  </p>
                </div>
                <div>
                  <label class="label" for="motif">Motif (en cas de rejet)</label>
                  <input id="motif" class="input" [(ngModel)]="motif" name="motif"
                         placeholder="Pièce d'identité illisible…">
                </div>
                <div class="flex gap-2">
                  <button type="button" class="btn btn-primary text-sm" [disabled]="busy()"
                          (click)="approuver()">✓ Valider le dossier</button>
                  <button type="button" class="btn btn-danger text-sm" [disabled]="busy()"
                          (click)="rejeter()">✕ Rejeter le dossier</button>
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class BoFaceVerification implements AfterViewInit, OnDestroy {
  @ViewChild('canvas2d') canvas2d?: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvas3d') canvas3d?: ElementRef<HTMLCanvasElement>;

  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly captures = signal<CaptureRow[]>([]);
  readonly selected = signal<FaceDetail | null>(null);
  readonly dossier = signal<DossierDetail | null>(null);
  /** Saisi par l'agent — le client, lui, ne renseigne que son compte espèces. */
  compteTitres = '';
  motif = '';
  readonly mode3d = signal(false);
  readonly busy = signal(false);
  current = '';

  private landmarks: number[][] = [];
  private angle = 0;
  private rafId = 0;

  ngAfterViewInit(): void {
    if (this.isBrowser) this.charger();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  private charger(): void {
    this.http.get<CaptureRow[]>(ADMIN_REGISTRATIONS.LIST).subscribe({
      next: (rows) => this.captures.set(rows ?? []),
      error: () => this.toast.error('Chargement de la file impossible.'),
    });
  }

  ouvrir(dossierId: string): void {
    this.current = dossierId;
    this.compteTitres = '';
    this.motif = '';
    this.chargerDossier(dossierId);
    this.http.get<FaceDetail>(ADMIN_REGISTRATIONS.FACE(dossierId)).subscribe({
      next: (f) => {
        this.selected.set(f);
        try { this.landmarks = JSON.parse(f.landmarksJson) as number[][]; }
        catch { this.landmarks = []; }
        cancelAnimationFrame(this.rafId);
        this.mode3d.set(false);
        // Le canvas n'est monté qu'après mise à jour de la vue (zoneless).
        setTimeout(() => this.dessiner2d(), 0);
      },
      error: () => this.toast.error('Capture introuvable.'),
    });
  }

  verifier(status: 'VALIDE' | 'REJETE'): void {
    const f = this.selected();
    if (!f || this.busy()) return;
    this.busy.set(true);
    this.http.post(ADMIN_REGISTRATIONS.VERIFY(this.current), { status }).subscribe({
      next: () => {
        this.toast.success(status === 'VALIDE' ? 'Identité validée' : 'Capture rejetée');
        this.selected.set({ ...f, verificationStatus: status });
        this.captures.update(list => list.map(c =>
          c.dossier_id === this.current ? { ...c, verification_status: status } : c));
        this.busy.set(false);
      },
      error: () => { this.toast.error('Action impossible.'); this.busy.set(false); },
    });
  }

  statutLabel(s: string): string {
    return s === 'VALIDE' ? 'Validée' : s === 'REJETE' ? 'Rejetée' : 'En attente';
  }

  /** Libellé du verdict d'authenticité IA — indicatif, jamais une conclusion finale. */
  authenticiteLabel(v?: string): string {
    return v === 'AUTHENTIQUE' ? '✓ Authentique (IA)'
      : v === 'SUSPECT' ? '⚠ Suspect (IA)'
      : 'Indéterminé (IA)';
  }

  /** Libellé du verdict de correspondance faciale (selfie ↔ pièce) — indicatif. */
  faceMatchLabel(v?: string): string {
    return v === 'CORRESPOND' ? '✓ Correspond (IA)'
      : v === 'NE_CORRESPOND_PAS' ? '⚠ Ne correspond pas (IA)'
      : 'Indéterminé (IA)';
  }

  // ── Dossier d'ouverture : pièces, décision, attribution du compte-titres ────

  private chargerDossier(dossierId: string): void {
    this.dossier.set(null);
    this.http.get<DossierDetail>(ADMIN_REGISTRATIONS.DOSSIER(dossierId)).subscribe({
      next: (d) => {
        this.dossier.set(d);
        // Pré-remplit le compte-titres à attribuer avec celui déjà connu en base
        // (référentiel clients_fb), sans écraser une saisie manuelle de l'agent.
        if (d.compteTitresBase && !this.compteTitres.trim()) {
          this.compteTitres = d.compteTitresBase;
        }
      },
      error: () => this.dossier.set(null),   // pas de dossier lié : on n'alarme pas l'agent
    });
  }

  /**
   * Valide le dossier : le prospect devient client. Le compte-titres saisi ici
   * lui est attribué ; laissé vide, il reste à compléter (client en rouge) sans
   * pour autant l'empêcher de passer des ordres.
   */
  approuver(): void {
    const d = this.dossier();
    if (!d || this.busy()) return;
    this.busy.set(true);
    const corps = this.compteTitres.trim() ? { compteTitres: this.compteTitres.trim() } : {};
    this.http.post<{ statut: string }>(ADMIN_REGISTRATIONS.APPROVE(d.dossierId), corps).subscribe({
      next: () => {
        this.toast.success('Dossier validé', this.compteTitres.trim()
          ? 'Le compte-titres a été attribué au client.'
          : 'Compte-titres à renseigner : le client apparaît en rouge dans la liste.');
        this.dossier.set({ ...d, statut: 'VALIDE' });
        this.busy.set(false);
      },
      error: (e) => {
        this.toast.error('Validation impossible', e?.error?.message ?? '');
        this.busy.set(false);
      },
    });
  }

  rejeter(): void {
    const d = this.dossier();
    if (!d || this.busy()) return;
    if (!this.motif.trim()) {
      this.toast.error('Motif requis', 'Indiquez pourquoi le dossier est rejeté.');
      return;
    }
    this.busy.set(true);
    this.http.post(ADMIN_REGISTRATIONS.REJECT(d.dossierId), { motif: this.motif.trim() }).subscribe({
      next: () => {
        this.toast.success('Dossier rejeté');
        this.dossier.set({ ...d, statut: 'REJETE' });
        this.busy.set(false);
      },
      error: (e) => {
        this.toast.error('Rejet impossible', e?.error?.message ?? '');
        this.busy.set(false);
      },
    });
  }

  // ── Rendu image + marqueurs rouges ─────────────────────────────────────────

  private dessiner2d(): void {
    const canvas = this.canvas2d?.nativeElement;
    const f = this.selected();
    if (!canvas || !f || !this.isBrowser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      // 468 marqueurs rouges superposés.
      ctx.fillStyle = 'rgba(220,20,40,0.9)';
      for (const p of this.landmarks) {
        ctx.beginPath();
        ctx.arc(p[0] * W, p[1] * H, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    img.src = f.imageBase64;
  }

  // ── Rendu 3D (nuage de points en rotation) ────────────────────────────────

  private boucle3d = (): void => {
    const canvas = this.canvas3d?.nativeElement;
    if (!canvas || !this.mode3d()) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);

    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    for (const p of this.landmarks) {
      // Centrer, tourner autour de l'axe Y, projeter (orthographique).
      const x = p[0] - 0.5, y = p[1] - 0.5, z = (p[2] ?? 0);
      const xr = x * cos - z * sin;
      const zr = x * sin + z * cos;
      const sx = W / 2 + xr * W * 0.8;
      const sy = H / 2 + y * H * 0.8;
      const prof = Math.max(0.2, Math.min(1, 0.6 - zr * 2)); // teinte selon la profondeur
      ctx.fillStyle = `rgba(${Math.round(230 * prof)},30,50,0.95)`;
      ctx.beginPath();
      ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    this.angle += 0.02;
    this.rafId = requestAnimationFrame(this.boucle3d);
  };

  /** Bascule image ⇄ 3D et (dé)marre la rotation du nuage de points. */
  basculer3d(): void {
    cancelAnimationFrame(this.rafId);
    this.mode3d.set(!this.mode3d());
    if (this.mode3d() && this.isBrowser) {
      setTimeout(() => this.boucle3d(), 0);
    } else {
      setTimeout(() => this.dessiner2d(), 0);
    }
  }
}
