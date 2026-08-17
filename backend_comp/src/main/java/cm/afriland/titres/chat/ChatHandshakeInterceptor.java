package cm.afriland.titres.chat;

import java.util.Map;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.MultiValueMap;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import cm.afriland.titres.security.AuthUser;
import cm.afriland.titres.security.JwtService;
import cm.afriland.titres.security.Rbac;

/**
 * Authentifie la connexion WebSocket au moment de la poignee de main (le
 * navigateur ne peut pas poser d'en-tete {@code Authorization} sur un
 * WebSocket : le jeton JWT est transmis en parametre de requete {@code token}).
 * Verifie egalement que l'utilisateur a le droit de rejoindre ce fil de
 * discussion avant d'accepter la connexion.
 */
@Component
public class ChatHandshakeInterceptor implements HandshakeInterceptor {

    private static final Logger log = LoggerFactory.getLogger(ChatHandshakeInterceptor.class);

    static final String ATTR_CONVERSATION_ID = "conversationId";
    static final String ATTR_USER_ID = "userId";
    static final String ATTR_USER_ROLE = "userRole";

    private final JwtService jwtService;
    private final JdbcTemplate jdbc;

    public ChatHandshakeInterceptor(JwtService jwtService, JdbcTemplate jdbc) {
        this.jwtService = jwtService;
        this.jdbc = jdbc;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        UUID conversationId = extractConversationId(request);
        if (conversationId == null) {
            return false;
        }

        MultiValueMap<String, String> params = UriComponentsBuilder.fromUri(request.getURI())
                .build().getQueryParams();
        String token = params.getFirst("token");
        if (token == null || token.isBlank()) {
            return false;
        }

        AuthUser user;
        try {
            user = jwtService.verify(token);
        } catch (RuntimeException e) {
            log.debug("Poignee de main WebSocket refusee : jeton invalide.");
            return false;
        }

        if (!authorized(user, conversationId)) {
            return false;
        }

        attributes.put(ATTR_CONVERSATION_ID, conversationId);
        attributes.put(ATTR_USER_ID, user.id());
        attributes.put(ATTR_USER_ROLE, user.role());
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // Rien a faire : l'etat de session est porte par les attributs de la poignee de main.
    }

    private boolean authorized(AuthUser user, UUID conversationId) {
        if (Rbac.isStaff(user.role())) {
            return true;
        }
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM chat_conversations WHERE id = ? AND client_id = ?",
                Long.class, conversationId, user.id());
        return count != null && count > 0;
    }

    /** Extrait le dernier segment de l'URL ({@code /ws/chat/{conversationId}}). */
    private UUID extractConversationId(ServerHttpRequest request) {
        String path = request.getURI().getPath();
        int lastSlash = path.lastIndexOf('/');
        if (lastSlash < 0 || lastSlash == path.length() - 1) {
            return null;
        }
        try {
            return UUID.fromString(path.substring(lastSlash + 1));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
