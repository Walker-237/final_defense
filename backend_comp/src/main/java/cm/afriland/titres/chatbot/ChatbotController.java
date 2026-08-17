package cm.afriland.titres.chatbot;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cm.afriland.titres.security.OptionalAuthUser;

/**
 * Assistant conversationnel de la plateforme — accessible aussi bien sur les
 * pages publiques (catalogue des emissions, connexion) qu'aux utilisateurs
 * connectes. Un visiteur non authentifie n'a simplement pas acces aux outils
 * portant sur ses propres donnees (ordres, portefeuille).
 */
@RestController
@RequestMapping("/api/v1/chatbot")
public class ChatbotController {

    private final ChatbotService service;

    public ChatbotController(ChatbotService service) {
        this.service = service;
    }

    record ChatResponse(String reply) {
    }

    /** {@code POST /chatbot/message} — envoie un message et recoit la reponse de l'assistant. */
    @PostMapping("/message")
    public ChatResponse message(OptionalAuthUser user, @Valid @RequestBody ChatRequest request) {
        return new ChatResponse(service.reply(request, user.get().orElse(null)));
    }
}
