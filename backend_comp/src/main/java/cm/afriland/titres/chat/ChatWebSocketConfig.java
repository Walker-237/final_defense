package cm.afriland.titres.chat;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

import cm.afriland.titres.config.AppProperties;

/**
 * Expose le canal WebSocket de la messagerie en direct sur
 * {@code /ws/chat/{conversationId}}. L'authentification se fait a la poignee
 * de main ({@link ChatHandshakeInterceptor}), pas via Spring Security (ce
 * backend n'en utilise pas — cf. {@code CurrentUserArgumentResolver}).
 */
@Configuration
@EnableWebSocket
public class ChatWebSocketConfig implements WebSocketConfigurer {

    private final ChatWebSocketHandler handler;
    private final ChatHandshakeInterceptor interceptor;
    private final AppProperties props;

    public ChatWebSocketConfig(ChatWebSocketHandler handler, ChatHandshakeInterceptor interceptor,
                               AppProperties props) {
        this.handler = handler;
        this.interceptor = interceptor;
        this.props = props;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/chat/{conversationId}")
                .addInterceptors(interceptor)
                .setAllowedOrigins(props.getFrontendOrigins());
    }
}
