import {
  AfterViewInit, Component, ElementRef, OnDestroy, PLATFORM_ID,
  ViewChild, computed, inject, output, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { FaceLandmarker as FaceLandmarkerType } from '@mediapipe/tasks-vision';
import {
  boiteEnglobante, centreDansOvale, contenuDansOvale, luminositeVisage, visageEntier,
  LUM_MAX, LUM_MIN, OVALE_RX, OVALE_RY,
} from './face-guidance';
import { anglesDepuisMatrice } from './face-pose';
import {
  ActionAffichable, ActionAffichee, LivenessChallengeService as LivenessApi,
  LivenessContexte, LivenessFrame,
} from './liveness-challenge-service';

/** Durée d'affichage de chaque consigne avant de passer à la suivante (ms).
 *  Purement une cadence d'interface : ne code AUCUN seuil de détection — le
 *  serveur seul juge si l'action a été exécutée et dans quel délai. */
const DUREE_PAR_ACTION_MS = 4_500;

type Etape = 'chargement' | 'sans-visage' | 'centrer' | 'visage-coupe' | 'trop-sombre'
  | 'trop-clair' | 'action' | 'verification' | 'reussi' | 'echoue' | 'erreur';

/**
 * Défi de vivacité à actions imprévisibles (remplace le contrôle "clignement
 * unique", contournable par une vidéo préenregistrée).
 *
 * <p><b>Le navigateur ne rend jamais de verdict.</b> Ce composant capture des
 * mesures horodatées (angles de pose, blendshapes, cadre facial) et les
 * transmet au serveur en une seule soumission ; il n'évalue localement AUCUN
 * seuil de détection — ceux-ci n'existent que côté serveur
 * ({@code LivenessThresholds}, jamais exposés ici). L'avancement d'une
 * consigne à la suivante est une simple cadence d'interface (durée fixe), pas
 * une décision de réussite.</p>
 *
 * <p>Réutilise le guidage de cadrage de {@code face-scan.ts}
 * (ovale/centrage/luminosité, cf. {@code face-guidance.ts}) plutôt que d'en
 * réécrire un nouveau.</p>
 */
@Component({
  selector: 'afb-liveness-challenge',
  standalone: true,
  template: `
    <div class="flex flex-col items-center gap-3">
      <div class="relative w-[320px] h-[320px] max-w-full rounded-2xl overflow-hidden bg-gray-900 shadow-inner">
        <video #video class="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
               playsinline muted autoplay></video>
        <canvas #overlay class="absolute inset-0 w-full h-full scale-x-[-1]" width="320" height="320"></canvas>

        @if (etape() === 'chargement' || etape() === 'verification') {
          <div class="absolute inset-0 grid place-items-center bg-black/50 text-white text-sm">
            <div class="flex flex-col items-center gap-2">
              <div class="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
              {{ etape() === 'verification' ? 'Vérification en cours…' : 'Initialisation de la caméra…' }}
            </div>
          </div>
        }
        @if (etape() === 'reussi') {
          <div class="absolute inset-0 grid place-items-center bg-emerald-600/30">
            <div class="text-white text-4xl">✓</div>
          </div>
        }
      </div>

      <div class="text-center min-h-[3rem]">
        @if (etape() === 'action' && actionCourante(); as a) {
          <p class="text-sm font-semibold text-gray-700">{{ a.consigne }}</p>
          <p class="text-xs text-gray-400 mt-0.5">Étape {{ indexAction() + 1 }} / {{ actions().length }}</p>
        } @else {
          <p class="text-sm font-semibold"
             [class.text-afb-red]="etape() === 'erreur' || etape() === 'echoue'"
             [class.text-emerald-600]="etape() === 'reussi'"
             [class.text-gray-700]="!['erreur','echoue','reussi'].includes(etape())">
            {{ messageEtape() }}
          </p>
        }
      </div>

      @if (etape() === 'echoue') {
        <div class="flex flex-col items-center gap-2">
          <button type="button" class="btn btn-outline text-sm" (click)="recommencer()">↺ Réessayer</button>
          @if (echecsConsecutifs() >= 2) {
            <button type="button" class="btn btn-ghost text-xs text-gray-500" (click)="demanderRevue()">
              Une action vous est difficile à exécuter ? Demander une vérification par un agent
            </button>
          }
        </div>
      }
      @if (etape() === 'erreur') {
        <button type="button" class="btn btn-outline text-sm" (click)="recommencer()">↺ Recommencer</button>
      }
    </div>
  `,
})
export class LivenessChallengeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('overlay') overlayRef!: ElementRef<HTMLCanvasElement>;

  /** Contexte de l'opération — transmis tel quel au serveur, qui seul décide du tirage. */
  contexteType = signal<LivenessContexte>('INSCRIPTION');
  contexteRef = signal<string | undefined>(undefined);

  /** Émis avec le verdict du SERVEUR uniquement — jamais un calcul local. */
  readonly termine = output<{ reussi: boolean }>();

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly api = inject(LivenessApi);

  readonly etape = signal<Etape>('chargement');
  readonly actions = signal<ActionAffichable[]>([]);
  readonly indexAction = signal(0);
  readonly echecsConsecutifs = signal(0);
  readonly erreurMsg = signal('');

  readonly actionCourante = computed<ActionAffichable | null>(
    () => this.actions()[this.indexAction()] ?? null);

  private landmarker: FaceLandmarkerType | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private lastVideoTime = -1;
  private canvasMesure?: HTMLCanvasElement;

  // ── État du défi en cours ──────────────────────────────────────────────
  private challengeId: string | null = null;
  private debutMs = 0;
  private readonly affichages: ActionAffichee[] = [];
  private readonly frames: LivenessFrame[] = [];
  private avanceTimer?: ReturnType<typeof setTimeout>;
  private derniereImage: string | null = null;

  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowser) return;
    try {
      await this.demarrerCamera();
    } catch (e) {
      this.erreurMsg.set(this.messageCamera(e));
      this.etape.set('erreur');
      return;
    }
    try {
      await this.chargerModele();
    } catch (e) {
      console.error('[LivenessChallenge] échec de chargement du modèle facial', e);
      this.erreurMsg.set('Moteur de reconnaissance faciale indisponible. Réessayez.');
      this.etape.set('erreur');
      return;
    }
    await this.demarrerDefi();
  }

  ngOnDestroy(): void {
    this.arreter();
  }

  private async demarrerCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('getUserMedia indisponible', 'SecurityError');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    const video = this.videoRef.nativeElement;
    video.srcObject = this.stream;
    await video.play();
  }

  private messageCamera(e: unknown): string {
    if (!this.isBrowser || !navigator.mediaDevices?.getUserMedia) {
      return 'Caméra inaccessible : ouvrez la page en HTTPS (ou http://localhost).';
    }
    const name = (e as { name?: string })?.name ?? '';
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Autorisation caméra refusée. Autorisez la caméra puis réessayez.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'Aucune caméra détectée sur cet appareil.';
      case 'NotReadableError':
        return 'La caméra est déjà utilisée par une autre application.';
      default:
        return 'Caméra indisponible. Vérifiez les autorisations ou réessayez.';
    }
  }

  private async chargerModele(): Promise<void> {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,
      // Active (contrairement à face-scan.ts) : necessaire pour yaw/pitch/roll.
      outputFacialTransformationMatrixes: true,
    });
    try {
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (e) {
      console.warn('[LivenessChallenge] délégué GPU indisponible, repli sur CPU', e);
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  // ── Défi ────────────────────────────────────────────────────────────────

  private async demarrerDefi(): Promise<void> {
    this.affichages.length = 0;
    this.frames.length = 0;
    this.indexAction.set(0);
    this.etape.set('sans-visage');

    this.api.creerDefi(this.contexteType(), this.contexteRef()).subscribe({
      next: (ch) => {
        this.challengeId = ch.challengeId;
        this.actions.set(ch.actions);
        this.debutMs = performance.now();
        this.boucle();
      },
      error: (e) => {
        this.erreurMsg.set(e?.status === 429
          ? (e?.error?.message ?? 'Trop de tentatives récentes. Réessayez plus tard.')
          : 'Impossible de démarrer la vérification. Réessayez.');
        this.etape.set('erreur');
      },
    });
  }

  private afficherActionCourante(): void {
    const action = this.actionCourante();
    if (!action) {
      this.finaliser();
      return;
    }
    this.affichages.push({ actionCode: action.code, afficheeAtMs: this.tRelatif() });
    this.etape.set('action');
    clearTimeout(this.avanceTimer);
    this.avanceTimer = setTimeout(() => {
      this.indexAction.update((i) => i + 1);
      this.afficherActionCourante();
    }, DUREE_PAR_ACTION_MS);
  }

  private tRelatif(): number {
    return Math.round(performance.now() - this.debutMs);
  }

  // ── Boucle de détection : cadrage (guidage) + collecte de mesures ────────

  private boucle = (): void => {
    if (!this.landmarker) return;
    const video = this.videoRef.nativeElement;

    if (video.currentTime !== this.lastVideoTime && video.readyState >= 2) {
      this.lastVideoTime = video.currentTime;
      const res = this.landmarker.detectForVideo(video, performance.now());
      this.traiter(res);
    }
    if (this.etape() !== 'reussi' && this.etape() !== 'echoue' && this.etape() !== 'erreur'
        && this.etape() !== 'verification') {
      this.rafId = requestAnimationFrame(this.boucle);
    }
  };

  private traiter(res: {
    faceLandmarks: { x: number; y: number; z: number }[][];
    faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
    facialTransformationMatrixes?: { data: number[] }[];
  }): void {
    const marks = res.faceLandmarks?.[0];
    if (!marks || marks.length === 0) {
      this.dessiner(null);
      if (this.etape() !== 'action') this.etape.set('sans-visage');
      return;
    }
    this.dessiner(marks);

    const boite = boiteEnglobante(marks);

    // Le guidage de cadrage (identique à face-scan.ts) ne s'applique QU'AVANT le
    // début du défi : une fois les consignes lancées, on continue d'enregistrer
    // des mesures même si le cadrage se dégrade un instant — c'est au serveur
    // d'en tirer les conséquences (continuité), pas à l'interface de bloquer.
    if (this.etape() !== 'action') {
      if (!visageEntier(boite)) { this.etape.set('visage-coupe'); return; }
      const taille = boite.h > 0.35 && boite.h < 0.95;
      if (!taille || !centreDansOvale(boite) || !contenuDansOvale(boite)) { this.etape.set('centrer'); return; }
      const lum = luminositeVisage(this.videoRef.nativeElement, boite, this.canvasMesure ??= document.createElement('canvas'));
      if (lum < 0) return;
      if (lum < LUM_MIN) { this.etape.set('trop-sombre'); return; }
      if (lum > LUM_MAX) { this.etape.set('trop-clair'); return; }
      // Cadrage validé : lance la première consigne.
      this.afficherActionCourante();
      return;
    }

    // Défi en cours : on enregistre une mesure brute — AUCUNE comparaison à un
    // seuil ici, uniquement la capture des valeurs. Le serveur seul décide.
    this.enregistrerMesure(res, marks, boite);
    this.capturerImageSiRecente();
  }

  private enregistrerMesure(
    res: {
      faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
      facialTransformationMatrixes?: { data: number[] }[];
    },
    marks: { x: number; y: number; z: number }[],
    boite: ReturnType<typeof boiteEnglobante>,
  ): void {
    const cat = res.faceBlendshapes?.[0]?.categories ?? [];
    const score = (nom: string) => cat.find((c) => c.categoryName === nom)?.score ?? null;
    const angles = anglesDepuisMatrice(res.facialTransformationMatrixes?.[0]?.data);

    const smileL = score('mouthSmileLeft');
    const smileR = score('mouthSmileRight');
    const browOuterL = score('browOuterUpLeft');
    const browOuterR = score('browOuterUpRight');
    const browInner = score('browInnerUp');

    this.frames.push({
      tMs: this.tRelatif(),
      yaw: angles?.yaw ?? null, pitch: angles?.pitch ?? null, roll: angles?.roll ?? null,
      eyeCloseLeft: score('eyeBlinkLeft'), eyeCloseRight: score('eyeBlinkRight'),
      mouthOpen: score('jawOpen'),
      smileRatio: smileL != null && smileR != null ? (smileL + smileR) / 2 : null,
      browRatio: browOuterL != null && browOuterR != null && browInner != null
        ? (browOuterL + browOuterR + browInner) / 3 : null,
      faceBoxArea: boite.w * boite.h, faceBoxCx: boite.cx, faceBoxCy: boite.cy,
    });
  }

  /** Garde la dernière image du flux comme photo de comparaison finale (pas de seuil : juste "la plus récente"). */
  private capturerImageSiRecente(): void {
    const video = this.videoRef.nativeElement;
    const w = video.videoWidth || 640, h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    this.derniereImage = canvas.toDataURL('image/jpeg', 0.9);
  }

  // ── Finalisation : une seule soumission (mesures + image) ────────────────

  private finaliser(): void {
    clearTimeout(this.avanceTimer);
    cancelAnimationFrame(this.rafId);
    this.etape.set('verification');

    if (!this.challengeId || !this.derniereImage) {
      this.echouer();
      return;
    }
    this.api.verifier(this.challengeId, this.derniereImage, [...this.affichages], [...this.frames]).subscribe({
      next: (res) => {
        if (res.statut === 'REUSSI') {
          this.echecsConsecutifs.set(0);
          this.etape.set('reussi');
          this.termine.emit({ reussi: true });
        } else {
          this.echouer();
        }
      },
      error: () => this.echouer(),
    });
  }

  private echouer(): void {
    this.echecsConsecutifs.update((n) => n + 1);
    this.etape.set('echoue');
    this.termine.emit({ reussi: false });
  }

  recommencer(): void {
    this.arreterBoucleSeulement();
    if (this.landmarker && this.stream) {
      this.demarrerDefi();
    } else {
      this.ngAfterViewInit();
    }
  }

  demanderRevue(): void {
    if (!this.challengeId) return;
    this.api.demanderRevueHumaine(this.challengeId).subscribe();
  }

  messageEtape(): string {
    const messages: Record<Etape, string> = {
      'chargement': 'Préparation de la caméra…',
      'sans-visage': 'Placez votre visage dans l’ovale.',
      'centrer': 'Centrez votre visage dans l’ovale.',
      'visage-coupe': 'Votre visage est coupé : reculez pour qu’il soit entièrement visible.',
      'trop-sombre': 'Il fait trop sombre : placez-vous face à une source de lumière.',
      'trop-clair': 'Image surexposée : éloignez-vous de la lumière directe.',
      'action': '',
      'verification': 'Vérification en cours…',
      'reussi': 'Vérification réussie ✓',
      'echoue': 'La vérification a échoué. Réessayez.',
      'erreur': this.erreurMsg() || 'Caméra indisponible.',
    };
    return messages[this.etape()];
  }

  // ── Rendu de l'overlay (ovale + marqueurs) — identique à face-scan.ts ────

  private dessiner(marks: { x: number; y: number }[] | null): void {
    const canvas = this.overlayRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * OVALE_RX, H * OVALE_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = this.etape() === 'action' ? '#10b981' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * OVALE_RX, H * OVALE_RY, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (marks) {
      ctx.fillStyle = 'rgba(200,16,46,0.9)';
      for (let i = 0; i < marks.length; i += 3) {
        ctx.beginPath();
        ctx.arc(marks[i].x * W, marks[i].y * H, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private arreterBoucleSeulement(): void {
    cancelAnimationFrame(this.rafId);
    this.lastVideoTime = -1;
  }

  private arreter(): void {
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.avanceTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
  }
}
