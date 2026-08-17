/**
 * Extraction des angles de pose (lacet/tangage/roulis) depuis la matrice de
 * transformation faciale de MediaPipe FaceLandmarker.
 *
 * <p>`face-scan.ts` n'active pas `outputFacialTransformationMatrixes` (seuls
 * les blendshapes lui suffisent pour le défi BLINK). Le défi de vivacité à
 * actions imprévisibles a besoin des angles de tête (TURN_*, CHIN_*, TILT_*) :
 * cette option doit être activée dans le composant qui utilise ce module.</p>
 *
 * <p><b>Convention non vérifiée empiriquement</b> : MediaPipe documente la
 * matrice comme colonne-majeure (16 flottants), mais le signe exact de
 * chaque axe (quel signe correspond à "tête tournée à gauche" pour CET angle
 * de caméra/miroir) n'a pas pu être validé avec une caméra réelle dans cet
 * environnement. Les seuils de {@code LivenessThresholds} côté serveur sont
 * symétriques (±15°, ±10°, ±12°) : si les signes s'avèrent inversés à l'usage,
 * la correction se limite à inverser le signe retourné ici — aucun changement
 * serveur nécessaire. À vérifier avant mise en production.</p>
 */

export interface AnglesPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * @param data 16 flottants de la matrice 4x4 (colonne-majeure, comme fourni par
 *   `result.facialTransformationMatrixes[0].data`).
 * @returns angles en degrés, ou `null` si la matrice est absente/invalide.
 */
export function anglesDepuisMatrice(data: number[] | undefined | null): AnglesPose | null {
  if (!data || data.length < 16) return null;

  // Colonne-majeure : élément (ligne r, colonne c) = data[c*4 + r].
  const r00 = data[0], r10 = data[1], r20 = data[2];
  const r01 = data[4], r11 = data[5], r21 = data[6];
  const r02 = data[8], r12 = data[9], r22 = data[10];

  // Décomposition Tait-Bryan standard (ordre yaw-Y puis pitch-X puis roll-Z).
  const pitch = Math.asin(clamp(-r21, -1, 1));
  const yaw = Math.atan2(r20, r22);
  const roll = Math.atan2(r01, r11);

  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  return { yaw: toDeg(yaw), pitch: toDeg(pitch), roll: toDeg(roll) };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
