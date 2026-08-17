package cm.afriland.titres.registration;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonPropertyDescription;

/** Sortie structuree demandee a Claude pour l'analyse d'authenticite d'une piece d'identite. */
record IdAuthenticityAi(
        @JsonPropertyDescription("Verdict : AUTHENTIQUE (aucun indice de falsification), SUSPECT "
                + "(indices concrets de falsification), ou INDETERMINE (image trop degradee/incomplete "
                + "pour se prononcer, ou aucun indice net dans un sens ou l'autre)")
        String verdict,

        @JsonPropertyDescription("Score de confiance dans le verdict, de 0 (aucune confiance) a 1 "
                + "(tres confiant)")
        double score,

        @JsonPropertyDescription("Commentaire en francais, 1 a 3 phrases, destine a l'agent back-office : "
                + "resume les indices observes (ou leur absence). Ne conclut jamais a une fraude certaine "
                + "— reste factuel et rappelle que la decision finale revient a l'agent.")
        String commentaire,

        @JsonPropertyDescription("Liste courte des indices concrets releves (ex. "
                + "'alignement du texte incoherent', 'photo semble incrustee', 'reflet d'ecran visible'). "
                + "Liste vide si aucun indice notable.")
        List<String> indices) {
}
