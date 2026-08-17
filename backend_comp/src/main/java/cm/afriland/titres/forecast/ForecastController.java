package cm.afriland.titres.forecast;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Prevision indicative de taux/prix pour une emission, fondee sur l'historique
 * des emissions comparables (meme nature, meme pays emetteur) et une synthese
 * generee par IA. Accessible sans authentification, comme le catalogue public
 * des emissions publiees.
 */
@RestController
@RequestMapping("/api/v1/forecast")
public class ForecastController {

    private final ForecastService service;

    public ForecastController(ForecastService service) {
        this.service = service;
    }

    /** {@code GET /forecast/:emissionId} — historique comparable + estimation IA. */
    @GetMapping("/{emissionId}")
    public ForecastResponse forecast(@PathVariable UUID emissionId) {
        return service.forecast(emissionId);
    }
}
