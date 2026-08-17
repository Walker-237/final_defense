package cm.afriland.titres.chat;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.Rbac;

/**
 * Messagerie en direct client <-> back-office. Chaque client dispose d'un fil
 * de discussion persistant unique ; l'envoi/reception des messages passe par
 * le WebSocket ({@link ChatWebSocketHandler}), ces routes couvrent l'historique
 * et la liste cote back-office.
 */
@RestController
@RequestMapping("/api/v1/chat")
public class ChatController {

    private static final String MESSAGE = "message";

    private final JdbcTemplate jdbc;

    public ChatController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    record MessageView(UUID id, UUID senderId, String senderRole, String contenu, OffsetDateTime createdAt) {
    }

    record ConversationView(UUID id, UUID clientId, UUID agentId, String statut, int unread) {
    }

    record ConversationSummary(UUID id, UUID clientId, String clientNom, String clientPrenom,
                               UUID agentId, String agentNom, String statut,
                               String dernierMessage, OffsetDateTime updatedAt, int unread) {
    }

    private static final RowMapper<MessageView> MESSAGE_MAPPER = (rs, n) -> new MessageView(
            rs.getObject("id", UUID.class),
            rs.getObject("sender_id", UUID.class),
            rs.getString("sender_role"),
            rs.getString("contenu"),
            rs.getObject("created_at", OffsetDateTime.class));

    /** {@code GET /chat/conversation} — le fil du client connecte (cree au premier appel). */
    @GetMapping("/conversation")
    public ConversationView myConversation(AuthUser user) {
        if (!Rbac.isClient(user.role())) {
            throw ApiException.forbidden("Reserve aux clients.");
        }
        List<UUID> existing = jdbc.query(
                "SELECT id FROM chat_conversations WHERE client_id = ?",
                (rs, n) -> rs.getObject("id", UUID.class), user.id());
        UUID id;
        if (existing.isEmpty()) {
            id = UUID.randomUUID();
            jdbc.update("INSERT INTO chat_conversations (id, client_id) VALUES (?, ?)", id, user.id());
        } else {
            id = existing.get(0);
        }
        return conversationView(id);
    }

    /** {@code GET /chat/conversations} — liste des fils, cote back-office. */
    @GetMapping("/conversations")
    public List<ConversationSummary> listConversations(AuthUser user) {
        requireStaff(user);
        return jdbc.query("""
                SELECT c.id, c.client_id, cu.nom AS client_nom, cu.prenom AS client_prenom,
                       c.agent_id, au.nom AS agent_nom, c.statut, c.updated_at,
                       (SELECT contenu FROM chat_messages m WHERE m.conversation_id = c.id
                            ORDER BY m.created_at DESC LIMIT 1) AS dernier_message,
                       (SELECT count(*) FROM chat_messages m WHERE m.conversation_id = c.id
                            AND m.sender_id != ?
                            AND m.created_at > COALESCE(c.agent_dernier_lu, '-infinity'::timestamptz)) AS unread
                FROM chat_conversations c
                JOIN users cu ON cu.id = c.client_id
                LEFT JOIN users au ON au.id = c.agent_id
                ORDER BY c.updated_at DESC
                """,
                (rs, n) -> new ConversationSummary(
                        rs.getObject("id", UUID.class),
                        rs.getObject("client_id", UUID.class),
                        rs.getString("client_nom"),
                        rs.getString("client_prenom"),
                        rs.getObject("agent_id", UUID.class),
                        rs.getString("agent_nom"),
                        rs.getString("statut"),
                        rs.getString("dernier_message"),
                        rs.getObject("updated_at", OffsetDateTime.class),
                        rs.getInt("unread")),
                user.id());
    }

    /** {@code GET /chat/conversations/:id/messages} — historique complet du fil. */
    @GetMapping("/conversations/{id}/messages")
    public List<MessageView> messages(AuthUser user, @PathVariable UUID id) {
        authorize(user, id);
        return jdbc.query(
                "SELECT id, sender_id, sender_role, contenu, created_at FROM chat_messages "
                        + "WHERE conversation_id = ? ORDER BY created_at ASC",
                MESSAGE_MAPPER, id);
    }

    /** {@code POST /chat/conversations/:id/read} — marque le fil comme lu pour l'appelant. */
    @PostMapping("/conversations/{id}/read")
    public Map<String, Object> markRead(AuthUser user, @PathVariable UUID id) {
        authorize(user, id);
        OffsetDateTime now = OffsetDateTime.now();
        if (user.isStaff()) {
            jdbc.update("UPDATE chat_conversations SET agent_dernier_lu = ? WHERE id = ?", now, id);
        } else {
            jdbc.update("UPDATE chat_conversations SET client_dernier_lu = ? WHERE id = ?", now, id);
        }
        return Map.of(MESSAGE, "Fil marque comme lu.");
    }

    private ConversationView conversationView(UUID conversationId) {
        return jdbc.queryForObject(
                "SELECT id, client_id, agent_id, statut, "
                        + "(SELECT count(*) FROM chat_messages m WHERE m.conversation_id = c.id "
                        + " AND m.sender_role NOT IN ('CLIENT_PP','CLIENT_PM') "
                        + " AND m.created_at > COALESCE(c.client_dernier_lu, '-infinity'::timestamptz)) AS unread "
                        + "FROM chat_conversations c WHERE c.id = ?",
                (rs, n) -> new ConversationView(
                        rs.getObject("id", UUID.class),
                        rs.getObject("client_id", UUID.class),
                        rs.getObject("agent_id", UUID.class),
                        rs.getString("statut"),
                        rs.getInt("unread")),
                conversationId);
    }

    private void requireStaff(AuthUser user) {
        if (!user.isStaff()) {
            throw ApiException.forbidden("Reserve au back-office.");
        }
    }

    /** Autorise l'acces a un fil : le client proprietaire, ou tout membre du back-office. */
    private void authorize(AuthUser user, UUID conversationId) {
        if (user.isStaff()) {
            return;
        }
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM chat_conversations WHERE id = ? AND client_id = ?",
                Long.class, conversationId, user.id());
        if (count == null || count == 0) {
            throw ApiException.forbidden("Acces refuse a ce fil de discussion.");
        }
    }
}
