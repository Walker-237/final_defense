import {
  AfterViewInit, Component, ElementRef, OnDestroy, PLATFORM_ID,
  ViewChild, computed, inject, output, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { FaceLandmarker as FaceLandmarkerType } from '@mediapipe/tasks-vision';
import { FaceDescriptorService } from './face-descriptor-service';
import {
  Boite, boiteEnglobante, centreDansOvale, contenuDansOvale,
  luminositeVisage, visageEntier, LUM_MAX, LUM_MIN, OVALE_RX, OVALE_RY,
} from './face-guidance';

/** Résultat émis à la capture — prêt pour `POST /registration/dossiers/{id}/face`. */
export interface FaceCaptureResult {
  imageBase64: string;      // data URL JPEG
  landmarksJson: string;    // JSON des 468 points 3D
  livenessScore: number;    // [0..1]
  livenessPassed: boolean;
  challengeType: 'BLINK';
  width: number;
  height: number;
  /** Empreinte faciale 128-d (comparaison 1:1). `null` si non calculable. */
  descriptor: number[] | null;
}

/** Étapes du parcours de capture (pilotent le guidage à l'écran). */
type Etape = 'chargement' | 'sans-visage' | 'centrer' | 'visage-coupe' | 'trop-sombre'
  | 'trop-clair' | 'cligner' | 'immobile' | 'capture' | 'erreur';

/**
 * Capture faciale avec contrôle de vivacité (MediaPipe FaceMesh, 468 points 3D).
 *
 * <p>Anti-photo : un <b>challenge actif</b> (clignement) est exigé — une photo
 * présentée à la caméra ne cligne pas, donc ne déclenche pas la capture. Une fois
 * le clignement détecté ET le visage centré/stable, la photo est prise
 * <b>automatiquement</b>. Les 468 repères sont dessinés en direct (marqueurs) et
 * transmis pour le rejeu/vérification 3D au back-office.</p>
 *
 * <p>Entièrement <b>côté navigateur</b> (getUserMedia + WASM) : le rendu serveur
 * (SSR) n'exécute rien et affiche un simple espace réservé.</p>
 */
@Component({
  selector: 'afb-face-scan',
  standalone: true,
  template: `
    <div class="flex flex-col items-center gap-3">
      <div class="relative w-[320px] h-[320px] max-w-full rounded-2xl overflow-hidden bg-gray-900 shadow-inner">
        <!-- Flux caméra (mise en miroir pour un ressenti naturel) -->
        <video #video class="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
               playsinline muted autoplay></video>
        <!-- Overlay : masque ovale + repères faciaux -->
        <canvas #overlay class="absolute inset-0 w-full h-full scale-x-[-1]" width="320" height="320"></canvas>

        @if (etape() === 'chargement') {
          <div class="absolute inset-0 grid place-items-center bg-black/50 text-white text-sm">
            <div class="flex flex-col items-center gap-2">
              <div class="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
              Initialisation de la caméra…
            </div>
          </div>
        }
        @if (etape() === 'capture') {
          <div class="absolute inset-0 grid place-items-center bg-emerald-600/30">
            <div class="text-white text-4xl">✓</div>
          </div>
        }
      </div>

      <!-- Consigne dynamique -->
      <div class="text-center min-h-[2.5rem]">
        <p class="text-sm font-semibold"
           [class.text-afb-red]="etape() === 'erreur'"
           [class.text-emerald-600]="etape() === 'capture'"
           [class.text-gray-700]="etape() !== 'erreur' && etape() !== 'capture'">
          {{ etape() === 'erreur' && erreurMsg() ? erreurMsg() : consigne() }}
        </p>
        @if (etape() !== 'capture' && etape() !== 'erreur' && etape() !== 'chargement') {
          <p class="text-xs text-gray-400 mt-0.5">Aucune image n'est envoyée tant que la vivacité n'est pas confirmée.</p>
        }
      </div>

      @if (etape() === 'capture' || etape() === 'erreur') {
        <button type="button" class="btn btn-outline text-sm" (click)="recommencer()">↺ Recommencer</button>
      }
    </div>
  `,
})
export class FaceScanComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('overlay') overlayRef!: ElementRef<HTMLCanvasElement>;

  /** Émis une fois la capture validée (vivacité confirmée). */
  readonly captured = output<FaceCaptureResult>();

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly descriptors = inject(FaceDescriptorService);

  readonly etape = signal<Etape>('chargement');
  readonly consigne = computed(() => CONSIGNES[this.etape()]);

  private landmarker: FaceLandmarkerType | null = null;
  private stream: MediaStream | null = null;
  private rafId = 0;
  private lastVideoTime = -1;

  // ── État du challenge de vivacité ──────────────────────────────────────────
  private yeuxFermes = false;          // état courant des paupières
  private clignementDetecte = false;   // un cycle fermé→ouvert observé
  private forceClignement = 0;         // profondeur max du clignement (score)
  private framesStables = 0;           // frames consécutives centré + immobile
  private dernierNez: { x: number; y: number } | null = null;

  private static readonly SEUIL_YEUX_FERMES = 0.5;   // blendshape eyeBlink
  private static readonly FRAMES_STABLES_REQUISES = 12;
  private static readonly SEUIL_IMMOBILITE = 0.015;  // variation normalisée du bout du nez

  // Seuils de cadrage (ovale, centrage, luminosité) : partagés avec le défi de
  // vivacité à actions imprévisibles — cf. face-guidance.ts. MÊMES valeurs que
  // celles dessinées à l'écran : le contrôle et le repère visuel doivent
  // désigner exactement la même zone.

  /** Canevas réutilisé pour la mesure de luminosité (évite une alloc par frame). */
  private canvasMesure?: HTMLCanvasElement;

  /** Détail de l'erreur affiché sous la consigne (permission, matériel, modèle…). */
  readonly erreurMsg = signal('');

  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowser) return;
    // 1) Caméra — messages précis selon la cause (permission, absence, contexte).
    try {
      await this.demarrerCamera();
    } catch (e) {
      this.erreurMsg.set(this.messageCamera(e));
      this.etape.set('erreur');
      return;
    }
    // 2) Modèle MediaPipe — indépendant de la caméra.
    try {
      await this.chargerModele();
    } catch (e) {
      console.error('[FaceScan] échec de chargement du modèle facial', e);
      this.erreurMsg.set('Moteur de reconnaissance faciale indisponible. Réessayez.');
      this.etape.set('erreur');
      return;
    }
    this.etape.set('sans-visage');
    this.boucle();
  }

  /** Traduit un échec getUserMedia en message actionnable. */
  private messageCamera(e: unknown): string {
    if (!this.isBrowser || !navigator.mediaDevices?.getUserMedia) {
      return 'Caméra inaccessible : ouvrez la page en HTTPS (ou http://localhost).';
    }
    const name = (e as { name?: string })?.name ?? '';
    console.error('[FaceScan] getUserMedia:', name, e);
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Autorisation caméra refusée. Autorisez la caméra dans votre navigateur puis réessayez.';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'Aucune caméra détectée sur cet appareil.';
      case 'NotReadableError':
        return 'La caméra est déjà utilisée par une autre application.';
      default:
        return 'Caméra indisponible. Vérifiez les autorisations ou réessayez.';
    }
  }

  ngOnDestroy(): void {
    this.arreter();
  }

  // ── Initialisation ─────────────────────────────────────────────────────────

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

  private async chargerModele(): Promise<void> {
    // Import dynamique : le WASM n'est jamais chargé côté serveur (SSR).
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks('/mediapipe/wasm');
    const options = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: '/mediapipe/models/face_landmarker.task', delegate },
      runningMode: 'VIDEO' as const,
      numFaces: 1,
      outputFaceBlendshapes: true,       // paupières (clignement)
      outputFacialTransformationMatrixes: false,
    });
    try {
      // GPU d'abord (plus fluide) ; repli CPU si WebGL/GPU indisponible.
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (e) {
      console.warn('[FaceScan] délégué GPU indisponible, repli sur CPU', e);
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  // ── Boucle de détection ──────────────────────────────────────────────────

  private boucle = (): void => {
    if (!this.landmarker) return;
    const video = this.videoRef.nativeElement;

    if (video.currentTime !== this.lastVideoTime && video.readyState >= 2) {
      this.lastVideoTime = video.currentTime;
      const res = this.landmarker.detectForVideo(video, performance.now());
      this.traiter(res);
    }
    if (this.etape() !== 'capture' && this.etape() !== 'erreur') {
      this.rafId = requestAnimationFrame(this.boucle);
    }
  };

  private traiter(res: {
    faceLandmarks: { x: number; y: number; z: number }[][];
    faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  }): void {
    const marks = res.faceLandmarks?.[0];
    if (!marks || marks.length === 0) {
      this.etape.set('sans-visage');
      this.dessiner(null);
      return;
    }

    this.dessiner(marks);

    // 1) Visage ENTIER : aucun repère ne doit sortir du cadre. Un visage coupé
    //    (front, menton ou joue hors champ) ne doit jamais être capturé.
    const boite = boiteEnglobante(marks);
    if (!visageEntier(boite)) {
      this.etape.set('visage-coupe');
      this.framesStables = 0;
      return;
    }

    // 2) Le visage doit être CENTRÉ dans l'ovale et entièrement CONTENU dedans.
    //    Sans cela, pas de capture : un visage décalé ou débordant du repère est
    //    refusé, même s'il est net et bien éclairé.
    const taille = boite.h > 0.35 && boite.h < 0.95;
    if (!taille || !centreDansOvale(boite) || !contenuDansOvale(boite)) {
      this.etape.set('centrer');
      this.framesStables = 0;
      return;
    }

    // 3) Luminosité : le visage doit être clairement visible (ni sous-exposé,
    //    ni brûlé par la lumière). Mesurée SUR LE VISAGE, pas sur l'arrière-plan.
    // -1 : mesure indisponible (vidéo pas encore prête) — on n'accuse pas à tort
    // l'utilisateur d'être « dans le noir », on attend simplement la frame suivante.
    const lum = luminositeVisage(this.videoRef.nativeElement, boite, this.canvasMesure ??= document.createElement('canvas'));
    if (lum < 0) {
      this.framesStables = 0;
      return;
    }
    if (lum < LUM_MIN) {
      this.etape.set('trop-sombre');
      this.framesStables = 0;
      return;
    }
    if (lum > LUM_MAX) {
      this.etape.set('trop-clair');
      this.framesStables = 0;
      return;
    }

    // 4) Challenge de vivacité : détection d'un clignement (fermé → ouvert).
    this.detecterClignement(res.faceBlendshapes?.[0]?.categories ?? []);
    if (!this.clignementDetecte) {
      this.etape.set('cligner');
      return;
    }

    // 3) Stabilité : le visage doit rester immobile quelques frames.
    const nez = marks[1]; // bout du nez
    if (this.dernierNez) {
      const d = Math.hypot(nez.x - this.dernierNez.x, nez.y - this.dernierNez.y);
      this.framesStables = d < FaceScanComponent.SEUIL_IMMOBILITE ? this.framesStables + 1 : 0;
    }
    this.dernierNez = { x: nez.x, y: nez.y };

    if (this.framesStables < FaceScanComponent.FRAMES_STABLES_REQUISES) {
      this.etape.set('immobile');
      return;
    }

    // 4) Conditions réunies → capture automatique.
    this.capturer(marks);
  }

  private detecterClignement(categories: { categoryName: string; score: number }[]): void {
    const gauche = categories.find(c => c.categoryName === 'eyeBlinkLeft')?.score ?? 0;
    const droite = categories.find(c => c.categoryName === 'eyeBlinkRight')?.score ?? 0;
    const score = Math.max(gauche, droite);
    const fermesMaintenant = score > FaceScanComponent.SEUIL_YEUX_FERMES;

    if (fermesMaintenant) {
      this.yeuxFermes = true;
      this.forceClignement = Math.max(this.forceClignement, score);
    } else if (this.yeuxFermes) {
      // Transition fermé → ouvert : un clignement complet a eu lieu.
      this.yeuxFermes = false;
      this.clignementDetecte = true;
    }
  }

  // ── Capture ─────────────────────────────────────────────────────────────

  private async capturer(marks: { x: number; y: number; z: number }[]): Promise<void> {
    cancelAnimationFrame(this.rafId);
    const video = this.videoRef.nativeElement;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, w, h);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.9);

    // Score de vivacité : base + profondeur du clignement (borné à 1).
    const livenessScore = Math.min(1, 0.6 + 0.4 * this.forceClignement);

    this.etape.set('capture');

    // Empreinte 128-d (comparaison 1:1 avec la photo d'ouverture de compte).
    // Le calcul est asynchrone : on n'empêche pas la capture s'il échoue.
    const descriptor = await this.descriptors.computeDescriptor(imageBase64);

    this.captured.emit({
      imageBase64,
      landmarksJson: JSON.stringify(marks.map(p => [round(p.x), round(p.y), round(p.z)])),
      livenessScore: round(livenessScore),
      livenessPassed: true,
      challengeType: 'BLINK',
      width: w,
      height: h,
      descriptor,
    });
  }

  recommencer(): void {
    this.clignementDetecte = false;
    this.yeuxFermes = false;
    this.forceClignement = 0;
    this.framesStables = 0;
    this.dernierNez = null;
    this.lastVideoTime = -1;
    if (this.landmarker && this.stream) {
      this.etape.set('sans-visage');
      this.boucle();
    } else {
      this.ngAfterViewInit();
    }
  }

  // ── Rendu de l'overlay (ovale + marqueurs) ────────────────────────────────

  private dessiner(marks: { x: number; y: number }[] | null): void {
    const canvas = this.overlayRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Masque sombre avec fenêtre ovale.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * OVALE_RX, H * OVALE_RY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Contour de l'ovale (vert quand on approche de la capture).
    const proche = this.etape() === 'immobile' || this.etape() === 'capture';
    ctx.strokeStyle = proche ? '#10b981' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, W * OVALE_RX, H * OVALE_RY, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Marqueurs faciaux (retour visuel immédiat).
    if (marks) {
      ctx.fillStyle = 'rgba(200,16,46,0.9)';
      for (let i = 0; i < marks.length; i += 3) { // 1 point sur 3 (lisibilité)
        ctx.beginPath();
        ctx.arc(marks[i].x * W, marks[i].y * H, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private arreter(): void {
    cancelAnimationFrame(this.rafId);
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.landmarker?.close();
    this.landmarker = null;
  }
}

const CONSIGNES: Record<Etape, string> = {
  'chargement': 'Préparation de la caméra…',
  'sans-visage': 'Placez votre visage dans l’ovale.',
  'centrer': 'Centrez votre visage dans l’ovale.',
  'visage-coupe': 'Votre visage est coupé : reculez pour qu’il soit entièrement visible.',
  'trop-sombre': 'Il fait trop sombre : placez-vous face à une source de lumière.',
  'trop-clair': 'Image surexposée : éloignez-vous de la lumière directe.',
  'cligner': 'Clignez des yeux pour confirmer que vous êtes bien présent.',
  'immobile': 'Parfait — ne bougez plus…',
  'capture': 'Visage capturé et vérifié ✓',
  'erreur': 'Caméra indisponible. Vérifiez les autorisations ou réessayez.',
};

/** Arrondi à 4 décimales (allège le JSON des repères). */
function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
