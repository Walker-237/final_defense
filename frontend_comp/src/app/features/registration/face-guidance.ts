/**
 * Guidage de cadrage partagé entre {@link FaceScanComponent} (capture unique,
 * défi BLINK) et le nouveau défi de vivacité à actions imprévisibles
 * ({@code liveness-challenge.ts}).
 *
 * <p>Fonctions PURES, extraites telles quelles de `face-scan.ts` (mêmes seuils,
 * même comportement) : ce module ne fait AUCUNE validation de vivacité — il
 * aide seulement l'utilisateur à bien se cadrer devant la caméra. Le guidage
 * n'est pas la validation ; ni la position, ni l'éclairage ne conditionnent la
 * décision serveur, seulement le confort de capture.</p>
 */

/** Boîte englobante du visage, en coordonnées normalisées [0,1]. */
export interface Boite {
  minX: number; minY: number; maxX: number; maxY: number;
  cx: number; cy: number; w: number; h: number;
}

/** Demi-axes de l'ovale de visée (coordonnées normalisées, centre 0,5/0,5). */
export const OVALE_RX = 0.34;
export const OVALE_RY = 0.42;
/** Décentrage maximal toléré du visage par rapport au centre de l'ovale. */
export const CENTRAGE_MAX_X = 0.07;
export const CENTRAGE_MAX_Y = 0.09;
/** Marge minimale entre le visage et le bord du cadre (sinon : visage coupé). */
export const MARGE_BORD = 0.02;
/** Plage de luminosité acceptable du visage (0–255) : ni sous-exposé, ni brûlé. */
export const LUM_MIN = 60;
export const LUM_MAX = 215;

export function boiteEnglobante(marks: { x: number; y: number }[]): Boite {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of marks) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return {
    minX, minY, maxX, maxY,
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    h: maxY - minY, w: maxX - minX,
  };
}

/**
 * Vrai si le visage est ENTIÈREMENT dans le champ.
 *
 * <p>Les repères sont normalisés : au-delà de [0,1] le point est hors cadre.
 * On exige en plus une petite marge — un visage qui touche le bord est en
 * pratique déjà coupé (front ou menton tronqué).</p>
 */
export function visageEntier(b: Boite): boolean {
  return b.minX > MARGE_BORD && b.minY > MARGE_BORD && b.maxX < 1 - MARGE_BORD && b.maxY < 1 - MARGE_BORD;
}

/** Vrai si le CENTRE du visage coïncide (à la tolérance près) avec celui de l'ovale. */
export function centreDansOvale(b: Boite): boolean {
  return Math.abs(b.cx - 0.5) < CENTRAGE_MAX_X && Math.abs(b.cy - 0.5) < CENTRAGE_MAX_Y;
}

/**
 * Vrai si le visage est ENTIÈREMENT contenu dans l'ovale.
 *
 * <p>On teste les quatre coins de sa boîte englobante contre l'équation de
 * l'ellipse : un visage qui déborde du repère (trop grand, ou décalé sur un
 * côté) est refusé, même si son centre paraît bien placé.</p>
 */
export function contenuDansOvale(b: Boite): boolean {
  const dedans = (x: number, y: number) =>
    ((x - 0.5) / OVALE_RX) ** 2 + ((y - 0.5) / OVALE_RY) ** 2 <= 1;
  return dedans(b.minX, b.minY) && dedans(b.maxX, b.minY)
      && dedans(b.minX, b.maxY) && dedans(b.maxX, b.maxY);
}

/**
 * Luminosité moyenne du VISAGE (0–255), mesurée sur la zone du visage et non
 * sur l'arrière-plan : un contre-jour laisse le fond très clair alors que le
 * visage reste dans l'ombre. `-1` si la mesure est indisponible (vidéo pas
 * encore prête) — l'appelant ne doit pas accuser à tort l'utilisateur d'être
 * « dans le noir », il attend simplement la frame suivante.
 */
export function luminositeVisage(video: HTMLVideoElement, b: Boite, canvasReutilisable: HTMLCanvasElement): number {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return -1;

  const L = 64;
  canvasReutilisable.width = L;
  canvasReutilisable.height = L;
  const ctx = canvasReutilisable.getContext('2d', { willReadFrequently: true });
  if (!ctx) return -1;

  const sx = Math.max(0, b.minX * vw);
  const sy = Math.max(0, b.minY * vh);
  const sw = Math.max(1, Math.min(vw - sx, b.w * vw));
  const sh = Math.max(1, Math.min(vh - sy, b.h * vh));
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, L, L);

  const { data } = ctx.getImageData(0, 0, L, L);
  let somme = 0;
  for (let i = 0; i < data.length; i += 4) {
    somme += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return somme / (data.length / 4);
}
