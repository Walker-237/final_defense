package cm.afriland.titres.liveness;

/**
 * Seuils de detection et bornes de rythme du defi de vivacite.
 *
 * <p><b>Ne jamais exposer ces valeurs au client</b> ni dans une reponse d'API —
 * ce sont les seules constantes qu'un attaquant chercherait a decouvrir pour
 * calibrer un flux truque. Elles vivent uniquement ici, cote serveur.</p>
 *
 * <p>Valeurs de depart, non mesurees sur trafic reel — a recaler une fois des
 * metriques de faux rejets/faux positifs disponibles (cf. audit des echecs).</p>
 */
final class LivenessThresholds {

    private LivenessThresholds() {
    }

    // ─────────────────────── Bornes de rythme (le "et le rythme" de la consigne) ───────────────────────

    /**
     * Delai minimal entre l'affichage d'une consigne et le franchissement du
     * seuil associe. En-dessous, la reaction precede plausiblement l'instant ou
     * l'utilisateur a pu lire la consigne — signe d'un flux preenregistre qui
     * "sait deja" ce qui va etre demande plutot que d'y reagir.
     */
    static final long DELAI_MIN_MS = 300;

    /**
     * Delai maximal tolere. Au-dela, on considere que l'action n'a pas ete
     * executee en reponse a la consigne (abandon, distraction, ou tentative de
     * contournement par pause prolongee).
     */
    static final long DELAI_MAX_MS = 8_000;

    /** Fenetre a l'interieur de laquelle les 2 cycles de BLINK_TWICE doivent survenir. */
    static final long FENETRE_DOUBLE_CLIGNEMENT_MS = 2_500;

    // ─────────────────────────────── Seuils de detection ───────────────────────────────

    /** Blendshape eyeBlink* au-dessus duquel l'œil est considere ferme (coherent avec face-scan.ts). */
    static final double SEUIL_YEUX_FERMES = 0.5;

    /** Lacet (yaw), en degres, au-dela duquel une rotation de tete est actee. */
    static final double SEUIL_YAW_DEG = 15.0;

    /** Tangage (pitch), en degres. */
    static final double SEUIL_PITCH_DEG = 10.0;

    /** Roulis (roll), en degres. */
    static final double SEUIL_ROLL_DEG = 12.0;

    /** Blendshape jawOpen au-dela duquel la bouche est consideree ouverte. */
    static final double SEUIL_BOUCHE_OUVERTE = 0.35;

    /** Moyenne mouthSmileLeft/Right au-dela de laquelle un sourire est acte. */
    static final double SEUIL_SOURIRE = 0.4;

    /** Pour SMILE : jawOpen doit rester SOUS ce seuil (bouche fermee), sinon confusion avec MOUTH_OPEN. */
    static final double SEUIL_BOUCHE_FERMEE_POUR_SOURIRE = 0.15;

    /** Moyenne des blendshapes de sourcils au-dela de laquelle un haussement est acte. */
    static final double SEUIL_SOURCILS = 0.3;

    /** Ratio de croissance de la surface du cadre facial (rapprochement) par rapport a la baseline de l'action. */
    static final double CROISSANCE_SURFACE_MIN = 1.15;

    // ─────────────────────────────── Continuite du visage ───────────────────────────────

    /** Deplacement normalise maximal du centre du cadre facial entre deux images consecutives. */
    static final double SAUT_POSITION_MAX = 0.12;

    /** Ratio maximal (grand/petit) de la surface du cadre facial entre deux images consecutives. */
    static final double SAUT_SURFACE_RATIO_MAX = 1.6;
}
