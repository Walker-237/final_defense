package cm.afriland.titres.chatbot;

import java.util.List;

import cm.afriland.titres.security.AuthUser;

/** Un fournisseur de completion conversationnelle (Anthropic, DeepSeek, ...). */
interface ChatProvider {

    /**
     * Complete une conversation, avec appel d'outils (function-calling) si le
     * fournisseur et le modele le supportent — {@code user} sert a scoper
     * l'execution des outils portant sur des donnees de compte (jamais transmis
     * au modele lui-meme). Doit lancer {@link ChatProviderException} — jamais une
     * exception non controlee — en cas d'indisponibilite (cle absente, echec
     * reseau, erreur du service) afin que l'appelant puisse basculer sur un
     * fournisseur de repli.
     */
    String complete(String systemPrompt, List<ChatMessage> history, String userMessage, AuthUser user);
}
