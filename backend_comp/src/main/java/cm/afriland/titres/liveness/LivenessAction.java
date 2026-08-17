package cm.afriland.titres.liveness;

/**
 * Catalogue des 12 actions du defi de vivacite. Chaque action appartient a une
 * {@link Family} ; deux actions de la meme famille ne peuvent jamais coexister
 * dans un meme defi (cf. {@link LivenessChallengeService#tirerActions}) — elles
 * se mesurent sur le meme signal et se confondraient (MOUTH_OPEN/SMILE) ou
 * produiraient un mouvement ambigu enchainees (TURN_LEFT/TURN_RIGHT).
 */
public enum LivenessAction {
    BLINK_BOTH(Family.EYES, "Clignez des deux yeux"),
    BLINK_TWICE(Family.EYES, "Clignez deux fois de suite"),
    TURN_LEFT(Family.YAW, "Tournez la tête vers la gauche"),
    TURN_RIGHT(Family.YAW, "Tournez la tête vers la droite"),
    CHIN_UP(Family.PITCH, "Levez légèrement le menton"),
    CHIN_DOWN(Family.PITCH, "Baissez légèrement le menton"),
    TILT_LEFT(Family.ROLL, "Penchez la tête vers l'épaule gauche"),
    TILT_RIGHT(Family.ROLL, "Penchez la tête vers l'épaule droite"),
    MOUTH_OPEN(Family.MOUTH, "Ouvrez la bouche"),
    SMILE(Family.MOUTH, "Souriez, bouche fermée"),
    BROWS_UP(Family.BROWS, "Haussez les sourcils"),
    LEAN_IN(Family.DISTANCE, "Rapprochez votre visage de la caméra");

    public enum Family { EYES, YAW, PITCH, ROLL, MOUTH, BROWS, DISTANCE }

    private final Family family;
    private final String consigne;

    LivenessAction(Family family, String consigne) {
        this.family = family;
        this.consigne = consigne;
    }

    public Family family() {
        return family;
    }

    /** Consigne affichable a l'utilisateur — jamais le seuil de detection associe. */
    public String consigne() {
        return consigne;
    }
}
