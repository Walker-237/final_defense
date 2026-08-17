package cm.afriland.titres.forecast;

import com.fasterxml.jackson.annotation.JsonPropertyDescription;

/** Sortie structuree demandee a Claude pour la prevision de taux/prix. */
record ForecastAi(
        @JsonPropertyDescription("Tendance generale observee sur l'historique fourni : HAUSSE, BAISSE ou STABLE")
        String tendance,

        @JsonPropertyDescription("Taux ou prix estime pour la prochaine emission comparable, en pourcentage "
                + "(ex. 3.45)")
        double tauxProjete,

        @JsonPropertyDescription("Borne basse de la fourchette d'estimation, en pourcentage")
        double fourchetteMin,

        @JsonPropertyDescription("Borne haute de la fourchette d'estimation, en pourcentage")
        double fourchetteMax,

        @JsonPropertyDescription("Commentaire explicatif en francais, 2 a 3 phrases, destine a un investisseur. "
                + "Doit mentionner explicitement qu'il s'agit d'une estimation indicative et non contractuelle, "
                + "les BTA/OTA etant attribues par adjudication et non par cotation de marche continue.")
        String commentaire) {
}
