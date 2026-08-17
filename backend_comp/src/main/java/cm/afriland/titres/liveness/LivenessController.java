package cm.afriland.titres.liveness;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.ClientIp;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;

/**
 * Defi de vivacite a actions imprevisibles (remplace le controle "clignement
 * unique"). Cf. {@link LivenessChallengeService} pour la regle d'architecture
 * non negociable : le navigateur ne rend jamais de verdict.
 */
@RestController
@RequestMapping("/api/v1/liveness")
public class LivenessController {

    private final LivenessChallengeService service;

    public LivenessController(LivenessChallengeService service) {
        this.service = service;
    }

    record ChallengeRequest(
            @NotBlank @Pattern(regexp = "INSCRIPTION|ORDRE|CO_SIGNATURE") String contexteType,
            UUID contexteRef) {
    }

    record VerifyBody(
            @NotBlank String imageBase64,
            @NotEmpty List<LivenessChallengeService.ActionAffichee> actionsAffichees,
            @NotEmpty List<LivenessFrame> frames) {
    }

    record VerifyResponse(String statut) {
    }

    /** {@code POST /liveness/challenge} — tire une nouvelle sequence d'actions. */
    @PostMapping("/challenge")
    public LivenessChallengeService.ChallengeCree creer(AuthUser user, ClientIp ip,
                                                         @Valid @RequestBody ChallengeRequest req) {
        return service.creer(user.id(), req.contexteType(), req.contexteRef(), ip.value());
    }

    /** {@code POST /liveness/challenge/:id/verify} — REUSSI/ECHOUE uniquement, jamais le motif. */
    @PostMapping("/challenge/{id}/verify")
    public VerifyResponse verifier(AuthUser user, ClientIp ip, @PathVariable UUID id,
                                   @Valid @RequestBody VerifyBody body) {
        var req = new LivenessChallengeService.VerifyRequest(body.imageBase64(), body.actionsAffichees(),
                body.frames());
        return new VerifyResponse(service.verifier(user.id(), id, req, ip.value()));
    }

    /** {@code POST /liveness/challenge/:id/request-review} — repli accessibilite (revue humaine). */
    @PostMapping("/challenge/{id}/request-review")
    public Map<String, Object> demanderRevue(AuthUser user, ClientIp ip, @PathVariable UUID id) {
        service.demanderRevue(user.id(), id, ip.value());
        return Map.of("statut", "REVUE_DEMANDEE");
    }
}
