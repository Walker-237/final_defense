import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Calcul de l'<b>empreinte faciale</b> (descripteur 128 dimensions) à partir
 * d'une image capturée.
 *
 * <p>MediaPipe FaceMesh donne la <i>géométrie</i> du visage (468 points), ce qui
 * permet le cadrage et la vivacité mais <b>pas</b> l'identification. La
 * comparaison 1:1 (« est-ce bien la même personne qu'à l'ouverture du compte ? »)
 * exige un modèle de <b>reconnaissance</b> : on utilise ici face-api.js, dont le
 * descripteur 128-d se compare par distance euclidienne (< 0,6 ⇒ même personne).</p>
 *
 * <p>Tout est exécuté <b>côté navigateur</b> ; les modèles sont des assets locaux
 * (aucun appel à un tiers). Le descripteur est envoyé au serveur, qui reste seul
 * juge de la correspondance.</p>
 */
@Injectable({ providedIn: 'root' })
export class FaceDescriptorService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** Modules et modèles chargés une seule fois. */
  private api: typeof import('@vladmandic/face-api') | null = null;
  private chargement: Promise<void> | null = null;

  /** Seuil standard de correspondance (face-api.js). */
  static readonly SEUIL_DISTANCE = 0.6;

  private async charger(): Promise<void> {
    if (this.api) return;
    this.chargement ??= (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/faceapi'),
        faceapi.nets.faceLandmark68Net.loadFromUri('/faceapi'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/faceapi'),
      ]);
      this.api = faceapi;
    })();
    await this.chargement;
  }

  /**
   * Empreinte 128-d de l'unique visage présent sur l'image, ou `null` si aucun
   * visage exploitable n'est trouvé (l'appelant décide alors quoi faire).
   */
  async computeDescriptor(imageDataUrl: string): Promise<number[] | null> {
    if (!this.isBrowser) return null;
    try {
      await this.charger();
      const faceapi = this.api!;
      const img = await this.chargerImage(imageDataUrl);
      const detection = await faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detection?.descriptor) return null;
      // Arrondi : allège la charge utile sans dégrader la distance.
      return Array.from(detection.descriptor, (v) => Math.round(v * 1e4) / 1e4);
    } catch (e) {
      console.error('[FaceDescriptor] échec du calcul de l’empreinte', e);
      return null;
    }
  }

  private chargerImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image illisible'));
      img.src = dataUrl;
    });
  }
}
