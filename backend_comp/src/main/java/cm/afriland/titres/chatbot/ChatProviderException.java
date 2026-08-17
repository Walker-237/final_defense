package cm.afriland.titres.chatbot;

/**
 * Erreur d'un {@link ChatProvider} — cle absente, appel reseau en echec, reponse
 * vide... Jamais exposee telle quelle au client : {@link ChatbotService} bascule
 * sur le fournisseur de repli, ou renvoie une erreur generique si aucun ne repond.
 */
class ChatProviderException extends RuntimeException {

    ChatProviderException(String message) {
        super(message);
    }

    ChatProviderException(String message, Throwable cause) {
        super(message, cause);
    }
}
