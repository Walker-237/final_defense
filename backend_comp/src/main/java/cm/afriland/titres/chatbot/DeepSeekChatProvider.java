package cm.afriland.titres.chatbot;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.security.AuthUser;

/**
 * Fournisseur PAR DEFAUT de l'assistant conversationnel — API DeepSeek (compatible
 * OpenAI, y compris son "function calling"). Appel HTTP brut via {@link RestClient} :
 * aucune dependance supplementaire, {@code spring-boot-starter-web} la fournit deja.
 */
@Component
class DeepSeekChatProvider implements ChatProvider {

    private static final String ENDPOINT = "https://api.deepseek.com/chat/completions";
    private static final String MODEL = "deepseek-chat";
    private static final int MAX_HISTORY_TURNS = 12;
    private static final int MAX_MESSAGE_LENGTH = 4000;
    /** Nombre max d'allers-retours outil -> modele avant d'abandonner (evite une boucle infinie). */
    private static final int MAX_TOOL_ROUNDS = 4;

    private final AppProperties props;
    private final List<ChatTool> tools;
    private final ObjectMapper objectMapper;
    private final RestClient http = RestClient.create();

    DeepSeekChatProvider(AppProperties props, List<ChatTool> tools, ObjectMapper objectMapper) {
        this.props = props;
        this.tools = tools;
        this.objectMapper = objectMapper;
    }

    // ── Messages (requete ET reponse : le tour assistant avec tool_calls est rejoue tel quel) ──

    @JsonInclude(JsonInclude.Include.NON_NULL)
    @JsonIgnoreProperties(ignoreUnknown = true)
    record DsMessage(String role, String content, @JsonProperty("tool_calls") List<DsToolCall> toolCalls,
                      @JsonProperty("tool_call_id") String toolCallId) {
        static DsMessage of(String role, String content) {
            return new DsMessage(role, content, null, null);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DsToolCall(String id, String type, DsFunctionCall function) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DsFunctionCall(String name, String arguments) {
    }

    // ── Definition des outils (function calling, forme OpenAI) ──

    record DsFunctionDef(String name, String description, Map<String, Object> parameters) {
    }

    record DsToolDef(String type, DsFunctionDef function) {
        static DsToolDef function(DsFunctionDef fn) {
            return new DsToolDef("function", fn);
        }
    }

    record DsRequest(String model, List<DsMessage> messages, @JsonProperty("max_tokens") long maxTokens,
                      List<DsToolDef> tools) {
    }

    // ── Reponse ──

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DsChoice(DsMessage message) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record DsResponse(List<DsChoice> choices) {
    }

    @Override
    public String complete(String systemPrompt, List<ChatMessage> history, String userMessage, AuthUser user) {
        String apiKey = props.getDeepseekApiKey();
        if (apiKey == null) {
            throw new ChatProviderException("Cle API DeepSeek absente.");
        }

        List<DsMessage> messages = new ArrayList<>();
        messages.add(DsMessage.of("system", systemPrompt));
        int skip = Math.max(0, history.size() - MAX_HISTORY_TURNS);
        for (ChatMessage turn : history.subList(skip, history.size())) {
            messages.add(DsMessage.of("assistant".equals(turn.role()) ? "assistant" : "user", clip(turn.content())));
        }
        messages.add(DsMessage.of("user", clip(userMessage)));

        List<DsToolDef> toolDefs = tools.stream().map(DeepSeekChatProvider::toDeepSeekTool).toList();

        try {
            for (int round = 0; round < MAX_TOOL_ROUNDS; round++) {
                DsRequest body = new DsRequest(MODEL, messages, 1024L, toolDefs);

                DsResponse response = http.post()
                        .uri(ENDPOINT)
                        .header("Authorization", "Bearer " + apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(body)
                        .retrieve()
                        .body(DsResponse.class);

                if (response == null || response.choices() == null || response.choices().isEmpty()
                        || response.choices().get(0).message() == null) {
                    throw new ChatProviderException("Reponse DeepSeek vide.");
                }

                DsMessage msg = response.choices().get(0).message();
                List<DsToolCall> calls = msg.toolCalls();
                if (calls == null || calls.isEmpty()) {
                    if (msg.content() == null || msg.content().isBlank()) {
                        throw new ChatProviderException("Reponse DeepSeek vide.");
                    }
                    return msg.content();
                }

                // Rejoue le tour assistant (avec ses tool_calls) puis fournit les resultats.
                messages.add(new DsMessage("assistant", msg.content(), calls, null));
                for (DsToolCall call : calls) {
                    String result = executeTool(call.function().name(), call.function().arguments(), user);
                    messages.add(new DsMessage("tool", result, null, call.id()));
                }
            }
            throw new ChatProviderException("Trop d'appels d'outils enchaines.");
        } catch (ChatProviderException e) {
            throw e;
        } catch (RuntimeException e) {
            // N'importe quel echec de cet appel externe (reseau, statut HTTP, reponse
            // inattendue) doit rester recuperable : ChatbotService bascule alors sur
            // Anthropic plutot que de renvoyer une 500 a l'utilisateur.
            throw new ChatProviderException("Appel DeepSeek en echec : " + e.getMessage(), e);
        }
    }

    private static DsToolDef toDeepSeekTool(ChatTool tool) {
        Map<String, Object> properties = new LinkedHashMap<>(tool.parameters());
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        schema.put("required", tool.required());
        return DsToolDef.function(new DsFunctionDef(tool.name(), tool.description(), schema));
    }

    private String executeTool(String name, String argumentsJson, AuthUser user) {
        Map<String, Object> args;
        try {
            args = (argumentsJson == null || argumentsJson.isBlank())
                    ? Map.of()
                    : objectMapper.readValue(argumentsJson, new TypeReference<Map<String, Object>>() {
                    });
        } catch (Exception e) {
            args = Map.of();
        }
        for (ChatTool t : tools) {
            if (t.name().equals(name)) {
                try {
                    return t.execute(args, user);
                } catch (RuntimeException e) {
                    return "Erreur lors de l'execution de l'outil.";
                }
            }
        }
        return "Outil inconnu.";
    }

    private static String clip(String text) {
        String t = text == null ? "" : text;
        return t.length() > MAX_MESSAGE_LENGTH ? t.substring(0, MAX_MESSAGE_LENGTH) : t;
    }
}
