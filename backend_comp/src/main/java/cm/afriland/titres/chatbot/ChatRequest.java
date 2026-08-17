package cm.afriland.titres.chatbot;

import java.util.List;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Corps de {@code POST /chatbot/message}. L'historique est renvoye par le client
 *  a chaque appel (l'API est sans etat cote serveur, comme l'API Messages Claude). */
public record ChatRequest(
        @NotBlank @Size(max = 4000) String message,
        List<ChatMessage> history) {
}
