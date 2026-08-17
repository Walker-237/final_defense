package cm.afriland.titres.chat;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.security.Rbac;

/**
 * Canal WebSocket de la messagerie en direct : un fil de discussion par
 * client, plusieurs sessions possibles (le client + un ou plusieurs membres
 * du back-office). Chaque message recu est persiste puis rediffuse a toutes
 * les sessions ouvertes sur ce fil.
 */
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(ChatWebSocketHandler.class);
    private static final int MAX_MESSAGE_LENGTH = 4000;
    /** Limite d'envoi en attente avant fermeture d'une session lente (30 s / 512 Ko). */
    private static final int SEND_TIME_LIMIT_MS = 30_000;
    private static final int BUFFER_SIZE_LIMIT_BYTES = 512 * 1024;

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    /** Sessions actives par fil de discussion, indexees par identifiant de session. */
    private final Map<UUID, Map<String, WebSocketSession>> sessionsByConversation = new ConcurrentHashMap<>();

    public ChatWebSocketHandler(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        UUID conversationId = conversationId(session);
        WebSocketSession concurrentSafe =
                new ConcurrentWebSocketSessionDecorator(session, SEND_TIME_LIMIT_MS, BUFFER_SIZE_LIMIT_BYTES);
        sessionsByConversation
                .computeIfAbsent(conversationId, k -> new ConcurrentHashMap<>())
                .put(session.getId(), concurrentSafe);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage textMessage) throws IOException {
        UUID conversationId = conversationId(session);
        UUID senderId = (UUID) session.getAttributes().get(ChatHandshakeInterceptor.ATTR_USER_ID);
        String senderRole = (String) session.getAttributes().get(ChatHandshakeInterceptor.ATTR_USER_ROLE);

        String contenu = extractContenu(textMessage.getPayload());
        if (contenu == null || contenu.isBlank()) {
            return;
        }
        if (contenu.length() > MAX_MESSAGE_LENGTH) {
            contenu = contenu.substring(0, MAX_MESSAGE_LENGTH);
        }

        UUID messageId = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now();
        jdbc.update("INSERT INTO chat_messages (id, conversation_id, sender_id, sender_role, contenu, created_at) "
                        + "VALUES (?,?,?,?,?,?)",
                messageId, conversationId, senderId, senderRole, contenu, now);

        if (Rbac.isStaff(senderRole)) {
            jdbc.update("UPDATE chat_conversations SET agent_id = COALESCE(agent_id, ?), "
                    + "agent_dernier_lu = ?, updated_at = ? WHERE id = ?", senderId, now, now, conversationId);
        } else {
            jdbc.update("UPDATE chat_conversations SET client_dernier_lu = ?, updated_at = ? WHERE id = ?",
                    now, now, conversationId);
        }

        Map<String, Object> payload = Map.of(
                "id", messageId.toString(),
                "conversationId", conversationId.toString(),
                "senderId", senderId.toString(),
                "senderRole", senderRole,
                "contenu", contenu,
                "createdAt", now.toString());
        broadcast(conversationId, mapper.writeValueAsString(payload));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Map<String, WebSocketSession> sessions = sessionsByConversation.get(conversationId(session));
        if (sessions != null) {
            sessions.remove(session.getId());
        }
    }

    @SuppressWarnings("unchecked")
    private String extractContenu(String rawPayload) throws IOException {
        Map<String, Object> payload = mapper.readValue(rawPayload, Map.class);
        Object contenu = payload.get("contenu");
        return contenu == null ? null : contenu.toString();
    }

    private void broadcast(UUID conversationId, String json) {
        Map<String, WebSocketSession> sessions = sessionsByConversation.get(conversationId);
        if (sessions == null) {
            return;
        }
        TextMessage message = new TextMessage(json);
        for (WebSocketSession session : List.copyOf(sessions.values())) {
            try {
                if (session.isOpen()) {
                    session.sendMessage(message);
                }
            } catch (IOException e) {
                log.warn("Echec d'envoi WebSocket (fil {}) : {}", conversationId, e.getMessage());
            }
        }
    }

    private UUID conversationId(WebSocketSession session) {
        return (UUID) session.getAttributes().get(ChatHandshakeInterceptor.ATTR_CONVERSATION_ID);
    }
}
