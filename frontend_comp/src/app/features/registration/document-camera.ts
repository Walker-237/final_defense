import {
  AfterViewInit, Component, ElementRef, OnDestroy, PLATFORM_ID,
  ViewChild, computed, inject, input, output, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Prise de vue d'un document (pièce d'identité) par la caméra.
 *
 * <p>Alternative à l'import de fichier : l'utilisateur cadre sa pièce dans le
 * repère et déclenche la capture. On demande la caméra <b>arrière</b> quand elle
 * existe (bien plus nette pour un document) et la <b>plus haute résolution
 * disponible</b> — l'analyse qui suit exige une image nette et lisible.</p>
 *
 * <p>Entièrement côté navigateur ; le rendu serveur (SSR) n'exécute rien.</p>
 */
@Component({
  selector: 'afb-document-camera',
  standalone: true,
  template: `
    <div class="flex flex-col items-center gap-2">
      <div class="relative w-full rounded-lg overflow-hidden bg-gray-900">
        <video #video class="w-full block max-h-[300px] object-contain" playsinline muted autoplay></video>

        <!-- Repère de cadrage : proportions d'une carte d'identité (ISO ID-1). -->
        @if (!erreur()) {
          <div class="absolute inset-0 pointer-events-none grid place-items-center">
            <div class="border-2 border-white/80 rounded-md" style="width:80%;aspect-ratio:1.586/1"></div>
          </div>
        }

        @if (erreur()) {
          <div class="absolute inset-0 grid place-items-center bg-black/70 p-4">
            <p class="text-white text-xs text-center">{{ erreur() }}</p>
          </div>
        }
      </div>

      <p class="text-[11px] text-gray-500 text-center">
        Cadrez la pièce dans le repère, bien à plat et sans reflet, puis capturez.
      </p>

      <div class="flex gap-2">
        <button type="button" class="btn btn-primary text-xs" [disabled]="!prete()" (click)="capturer()">
          📸 Capturer
        </button>
        <button type="button" class="btn btn-outline text-xs" (click)="annuler.emit()">Annuler</button>
      </div>
    </div>
  `,
})
export class DocumentCameraComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoRef!: ElementRef<HTMLVideoElement>;

  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Image capturée (data URL JPEG), analysée ensuite par l'appelant. */
  readonly captured = output<string>();
  readonly annuler = output<void>();

  readonly erreur = signal('');
  readonly prete = signal(false);

  private stream: MediaStream | null = null;

  async ngAfterViewInit(): Promise<void> {
    if (!this.isBrowser) return;
    try {
      await this.demarrer();
      this.prete.set(true);
    } catch (e) {
      this.erreur.set(this.messageErreur(e));
    }
  }

  ngOnDestroy(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
  }

  private async demarrer(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException('getUserMedia indisponible', 'SecurityError');
    }
    // Caméra arrière si disponible (« environment ») : bien plus nette pour un
    // document. Sur un poste fixe, le navigateur retombe sur la webcam frontale.
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    const video = this.videoRef.nativeElement;
    video.srcObject = this.stream;
    await video.play();
  }

  /** Capture la frame courante à la résolution native du flux. */
  capturer(): void {
    const video = this.videoRef.nativeElement;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    // Qualité élevée : l'OCR doit pouvoir lire les mentions de la pièce.
    this.captured.emit(canvas.toDataURL('image/jpeg', 0.95));
  }

  private messageErreur(e: unknown): string {
    const name = (e as { name?: string })?.name ?? '';
    console.error('[DocumentCamera] getUserMedia:', name, e);
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Autorisation caméra refusée. Autorisez la caméra, ou importez un fichier à la place.';
      case 'NotFoundError':
        return 'Aucune caméra détectée. Importez un fichier à la place.';
      case 'NotReadableError':
        return 'La caméra est déjà utilisée par une autre application. '
          + 'Fermez-la, ou importez un fichier à la place.';
      default:
        return 'Caméra indisponible. Importez un fichier à la place.';
    }
  }
}
