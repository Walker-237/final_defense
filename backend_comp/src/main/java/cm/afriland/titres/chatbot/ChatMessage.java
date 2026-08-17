package cm.afriland.titres.chatbot;

/** Un tour de conversation avec l'assistant ({@code role} = {@code user} ou {@code assistant}). */
public record ChatMessage(String role, String content) {
}
