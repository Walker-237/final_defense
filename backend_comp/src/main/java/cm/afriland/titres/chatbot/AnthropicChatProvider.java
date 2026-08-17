package cm.afriland.titres.chatbot;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.ContentBlock;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.MessageParam;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.ToolResultBlockParam;
import com.anthropic.models.messages.ToolUnion;
import com.anthropic.models.messages.ToolUseBlock;

import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.security.AuthUser;

/** Fournisseur de repli — API Claude (Anthropic), avec appel d'outils (function-calling). */
@Component
class AnthropicChatProvider implements ChatProvider {

    /** Bornes anti-abus : evite qu'une conversation trop longue ne fasse exploser le cout. */
    private static final int MAX_HISTORY_TURNS = 12;
    private static final int MAX_MESSAGE_LENGTH = 4000;
    /** Nombre max d'allers-retours outil -> modele avant d'abandonner (evite une boucle infinie). */
    private static final int MAX_TOOL_ROUNDS = 4;

    private final AppProperties props;
    private final List<ChatTool> tools;
    private volatile AnthropicClient client;

    AnthropicChatProvider(AppProperties props, List<ChatTool> tools) {
        this.props = props;
        this.tools = tools;
    }

    @Override
    public String complete(String systemPrompt, List<ChatMessage> history, String userMessage, AuthUser user) {
        AnthropicClient anthropic = client();

        List<MessageParam> messages = new ArrayList<>();
        int skip = Math.max(0, history.size() - MAX_HISTORY_TURNS);
        for (ChatMessage turn : history.subList(skip, history.size())) {
            messages.add(toMessageParam(turn));
        }
        messages.add(toMessageParam(new ChatMessage("user", userMessage)));

        List<ToolUnion> toolUnions = tools.stream().map(AnthropicChatProvider::toAnthropicTool).toList();

        try {
            for (int round = 0; round < MAX_TOOL_ROUNDS; round++) {
                MessageCreateParams params = MessageCreateParams.builder()
                        .model("claude-opus-5")
                        .maxTokens(1024L)
                        .system(systemPrompt)
                        .outputConfig(OutputConfig.builder().effort(OutputConfig.Effort.LOW).build())
                        .tools(toolUnions)
                        .messages(messages)
                        .build();

                Message response = anthropic.messages().create(params);

                List<ToolUseBlock> toolUses = response.content().stream()
                        .flatMap(b -> b.toolUse().stream())
                        .toList();

                if (toolUses.isEmpty()) {
                    String text = response.content().stream()
                            .flatMap(block -> block.text().stream())
                            .map(t -> t.text())
                            .reduce("", (a, b) -> a.isEmpty() ? b : a + "\n" + b);
                    if (text.isBlank()) {
                        throw new ChatProviderException("Reponse Anthropic vide.");
                    }
                    return text;
                }

                // Rejoue le tour assistant (texte eventuel + tool_use) puis fournit les resultats.
                List<ContentBlockParam> assistantBlocks = response.content().stream()
                        .map(ContentBlock::toParam)
                        .toList();
                messages.add(MessageParam.builder().role(MessageParam.Role.ASSISTANT)
                        .contentOfBlockParams(assistantBlocks).build());

                List<ContentBlockParam> toolResults = new ArrayList<>();
                for (ToolUseBlock use : toolUses) {
                    String result = executeTool(use.name(), use._input(), user);
                    toolResults.add(ContentBlockParam.ofToolResult(
                            ToolResultBlockParam.builder().toolUseId(use.id()).content(result).build()));
                }
                messages.add(MessageParam.builder().role(MessageParam.Role.USER)
                        .contentOfBlockParams(toolResults).build());
            }
            throw new ChatProviderException("Trop d'appels d'outils enchaines.");
        } catch (ChatProviderException e) {
            throw e;
        } catch (RuntimeException e) {
            // Toute panne de cet appel externe doit rester recuperable par l'appelant
            // (ChatbotService renvoie alors une erreur generique) plutot que de
            // remonter telle quelle en 500.
            throw new ChatProviderException("Appel Anthropic en echec : " + e.getMessage(), e);
        }
    }

    private static ToolUnion toAnthropicTool(ChatTool tool) {
        Tool.InputSchema.Properties.Builder propsBuilder = Tool.InputSchema.Properties.builder();
        for (Map.Entry<String, Map<String, String>> entry : tool.parameters().entrySet()) {
            propsBuilder.putAdditionalProperty(entry.getKey(), JsonValue.from(entry.getValue()));
        }
        Tool.InputSchema schema = Tool.InputSchema.builder()
                .type(JsonValue.from("object"))
                .properties(propsBuilder.build())
                .required(tool.required())
                .build();
        return ToolUnion.ofTool(Tool.builder()
                .name(tool.name())
                .description(tool.description())
                .inputSchema(schema)
                .build());
    }

    @SuppressWarnings("unchecked")
    private String executeTool(String name, JsonValue input, AuthUser user) {
        Map<String, Object> args = input == null ? Map.of() : input.convert(Map.class);
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

    private MessageParam toMessageParam(ChatMessage m) {
        String text = m.content() == null ? "" : m.content();
        if (text.length() > MAX_MESSAGE_LENGTH) {
            text = text.substring(0, MAX_MESSAGE_LENGTH);
        }
        MessageParam.Role role = "assistant".equals(m.role()) ? MessageParam.Role.ASSISTANT : MessageParam.Role.USER;
        ContentBlockParam block = ContentBlockParam.ofText(TextBlockParam.builder().text(text).build());
        return MessageParam.builder().role(role).contentOfBlockParams(List.of(block)).build();
    }

    private AnthropicClient client() {
        AnthropicClient current = client;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (client == null) {
                String apiKey = props.getAnthropicApiKey();
                if (apiKey == null) {
                    throw new ChatProviderException("Cle API Anthropic absente.");
                }
                client = AnthropicOkHttpClient.builder().apiKey(apiKey).build();
            }
            return client;
        }
    }
}
