package cm.afriland.titres.chatbot;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.AuthUser;

/**
 * Un outil (function-calling) que l'assistant peut invoquer pour obtenir des
 * donnees reelles de la plateforme, plutot que de decliner ou d'inventer.
 *
 * <p><b>Regle absolue</b> : aucun outil portant sur des donnees de compte (ordres,
 * portefeuille...) ne doit exposer de parametre permettant de designer un autre
 * utilisateur que l'appelant. Ces outils portent toujours sur {@code user.id()},
 * jamais sur un identifiant fourni par le modele — l'absence meme du parametre
 * est ce qui garantit le cloisonnement, pas une verification a l'execution.</p>
 */
interface ChatTool {

    String name();

    String description();

    /** Schema JSON (forme "properties" d'un schema JSON standard) : nom -> {type, description}. */
    Map<String, Map<String, String>> parameters();

    List<String> required();

    /**
     * Execute l'outil. Ne doit jamais lancer d'exception pour un refus ou une
     * absence de resultat : renvoyer un message textuel explicatif que le
     * modele relaiera tel quel a l'utilisateur.
     */
    String execute(Map<String, Object> args, AuthUser user);

    static String toJson(ObjectMapper mapper, Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            return "Erreur interne lors de la mise en forme des donnees.";
        }
    }
}
