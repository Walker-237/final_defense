package cm.afriland.titres.liveness;

/**
 * Une mesure horodatee transmise par le client pendant l'execution du defi.
 *
 * <p>Toutes les valeurs sont des <b>mesures brutes</b>, jamais un verdict — le
 * client ne sait pas ce qui constitue un seuil "reussi" (regle d'architecture
 * non negociable). {@code eyeCloseLeft}/{@code eyeCloseRight} reprennent les
 * blendshapes MediaPipe {@code eyeBlinkLeft}/{@code eyeBlinkRight} deja
 * utilisees par la capture existante (face-scan.ts) — plus proche 1 = plus
 * ferme, l'inverse d'un ratio EAR classique ou plus ferme = plus proche 0 ;
 * la nomenclature "eyeClose" evite la confusion (cf. recapitulatif).</p>
 *
 * @param tMs instant relatif au debut du defi (ms, horloge client)
 * @param yaw lacet en degres (facialTransformationMatrixes), ou {@code null} si indisponible
 * @param pitch tangage en degres, ou {@code null}
 * @param roll roulis en degres, ou {@code null}
 * @param eyeCloseLeft blendshape eyeBlinkLeft [0..1], 1 = ferme
 * @param eyeCloseRight blendshape eyeBlinkRight [0..1], 1 = ferme
 * @param mouthOpen blendshape jawOpen [0..1] (equivalent MAR)
 * @param smileRatio moyenne mouthSmileLeft/mouthSmileRight [0..1]
 * @param browRatio moyenne browOuterUpLeft/browOuterUpRight/browInnerUp [0..1]
 * @param faceBoxArea largeur x hauteur de la boite englobante du visage, normalisee [0..1]
 * @param faceBoxCx centre X de la boite englobante, normalise [0..1]
 * @param faceBoxCy centre Y de la boite englobante, normalise [0..1]
 */
record LivenessFrame(
        long tMs,
        Double yaw, Double pitch, Double roll,
        Double eyeCloseLeft, Double eyeCloseRight,
        Double mouthOpen,
        Double smileRatio,
        Double browRatio,
        Double faceBoxArea, Double faceBoxCx, Double faceBoxCy) {
}
