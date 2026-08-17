package cm.afriland.titres.registration;

import com.fasterxml.jackson.annotation.JsonPropertyDescription;

/** Sortie structuree demandee a Claude pour la comparaison selfie <-> piece d'identite. */
record FaceMatchAi(
        @JsonPropertyDescription("Verdict : CORRESPOND (meme personne, visages coherents), "
                + "NE_CORRESPOND_PAS (indices clairs de personnes differentes), ou INDETERMINE "
                + "(un des deux visages est trop peu visible/de trop mauvaise qualite pour se prononcer)")
        String verdict,

        @JsonPropertyDescription("Score de confiance dans le verdict, de 0 (aucune confiance) a 1 "
                + "(tres confiant)")
        double score,

        @JsonPropertyDescription("Commentaire en francais, 1 a 2 phrases, destine a l'agent back-office : "
                + "explique brievement ce qui a ete compare (traits du visage, morphologie) et pourquoi. "
                + "Ne conclut jamais avec une certitude absolue — reste factuel, la decision finale "
                + "revient a l'agent.")
        String commentaire) {
}
