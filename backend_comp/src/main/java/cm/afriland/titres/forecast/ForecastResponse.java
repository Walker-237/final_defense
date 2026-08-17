package cm.afriland.titres.forecast;

import java.time.LocalDate;
import java.util.List;

/** Un point de l'historique des emissions comparables (meme nature, meme pays). */
record HistoricalPoint(String code, LocalDate dateEmission, double tauxNominal) {
}

/**
 * Reponse de {@code GET /forecast/:emissionId}. {@code historique} est toujours
 * renvoye (peut etre vide) ; {@code projectionDisponible} indique si les champs
 * d'estimation IA sont renseignes (absents si trop peu d'historique, ou si
 * l'appel IA a echoue).
 */
record ForecastResponse(
        List<HistoricalPoint> historique,
        boolean projectionDisponible,
        String message,
        String tendance,
        Double tauxProjete,
        Double fourchetteMin,
        Double fourchetteMax,
        String commentaire) {

    static ForecastResponse indisponible(List<HistoricalPoint> historique, String message) {
        return new ForecastResponse(historique, false, message, null, null, null, null, null);
    }

    static ForecastResponse avecProjection(List<HistoricalPoint> historique, ForecastAi ai) {
        return new ForecastResponse(historique, true, null, ai.tendance(), ai.tauxProjete(),
                ai.fourchetteMin(), ai.fourchetteMax(), ai.commentaire());
    }
}
