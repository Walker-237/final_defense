package cm.afriland.titres.registration;

import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.errors.AnthropicException;
import com.anthropic.models.messages.Base64ImageSource;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.ImageBlockParam;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.MessageParam;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.TextBlockParam;

import cm.afriland.titres.config.AppProperties;

/**
 * Analyse d'authenticite d'une piece d'identite (CNI/passeport/carte de sejour)
 * a partir de l'image capturee, via la vision de Claude (Anthropic).
 *
 * <p><b>Indicative, jamais bloquante</b> — au meme titre que l'OCR (Fonctionnalite
 * 3 de l'addendum) : le verdict est uniquement expose a l'agent back-office lors
 * de la verification du dossier (Fonctionnalite 4). Il n'empeche jamais le depot
 * de la piece, et une indisponibilite de l'IA degrade silencieusement vers
 * {@code INDETERMINE} plutot que de faire echouer l'upload.</p>
 */
@Service
public class IdAuthenticityService {

    private static final Logger log = LoggerFactory.getLogger(IdAuthenticityService.class);

    private static final String SYSTEM_PROMPT = """
            Tu examines une photo de piece d'identite (carte nationale d'identite, passeport ou \
            carte de sejour) deposee lors d'une ouverture de compte-titres en ligne, a la recherche \
            d'indices de falsification.

            Cherche notamment :
            - Incoherences de police, de taille ou d'alignement du texte imprime.
            - Photo d'identite qui semble incrustee, decoupee ou aux bords visibles.
            - Absence ou aspect incorrect des elements de securite habituels (hologramme, \
            micro-impression, filigrane) pour ce type de document.
            - Indices de recapture d'ecran (reflets, moire, bords d'ecran visibles) plutot qu'une \
            prise de vue directe du document physique.
            - Zones visiblement retouchees numeriquement (flou localise, transitions de couleur \
            anormales).

            Consignes :
            - Reste conservateur : en cas de doute ou d'image de qualite insuffisante, choisis \
            INDETERMINE plutot qu'un verdict tranche. Ne conclus jamais a une fraude certaine — \
            c'est a l'agent back-office de decider, tu fournis un signal d'aide a la decision.
            - Fonde ton analyse uniquement sur ce que montre l'image, jamais sur des suppositions.
            """;

    private final AppProperties props;
    private volatile AnthropicClient client;

    public IdAuthenticityService(AppProperties props) {
        this.props = props;
    }

    record Result(String verdict, Double score, String commentaire) {
        static Result indetermine(String commentaire) {
            return new Result("INDETERMINE", null, commentaire);
        }
    }

    /** {@code imageDataUrl} : data URL complete (ex. {@code data:image/jpeg;base64,...}). */
    public Result analyser(String imageDataUrl) {
        if (props.getAnthropicApiKey() == null) {
            return Result.indetermine("Analyse d'authenticite non configuree.");
        }
        DataUri parsed = DataUri.parse(imageDataUrl);
        if (parsed == null) {
            return Result.indetermine("Format d'image non reconnu pour l'analyse.");
        }

        try {
            IdAuthenticityAi ai = callClaude(parsed);
            return new Result(ai.verdict(), ai.score(), buildCommentaire(ai));
        } catch (AnthropicException e) {
            log.error("Analyse d'authenticite en echec : {}", e.getMessage(), e);
            return Result.indetermine("Analyse momentanement indisponible.");
        }
    }

    private static String buildCommentaire(IdAuthenticityAi ai) {
        if (ai.indices() == null || ai.indices().isEmpty()) {
            return ai.commentaire();
        }
        return ai.commentaire() + " Indices : " + String.join(", ", ai.indices()) + ".";
    }

    private IdAuthenticityAi callClaude(DataUri image) {
        AnthropicClient anthropic = client();

        Base64ImageSource source = Base64ImageSource.builder()
                .data(image.data())
                .mediaType(image.mediaType())
                .build();
        ImageBlockParam imageBlock = ImageBlockParam.builder().source(source).build();
        TextBlockParam textBlock = TextBlockParam.builder()
                .text("Analyse l'authenticite de cette piece d'identite.")
                .build();

        MessageParam userMessage = MessageParam.builder()
                .role(MessageParam.Role.USER)
                .contentOfBlockParams(List.of(
                        ContentBlockParam.ofText(textBlock),
                        ContentBlockParam.ofImage(imageBlock)))
                .build();

        StructuredMessageCreateParams<IdAuthenticityAi> params = MessageCreateParams.builder()
                .model("claude-sonnet-5")
                .maxTokens(1024L)
                .system(SYSTEM_PROMPT)
                .outputConfig(IdAuthenticityAi.class)
                .messages(List.of(userMessage))
                .build();

        List<IdAuthenticityAi> results = new ArrayList<>();
        anthropic.messages().create(params).content().stream()
                .flatMap(cb -> cb.text().stream())
                .forEach(typed -> results.add(typed.text()));

        if (results.isEmpty()) {
            return new IdAuthenticityAi("INDETERMINE", 0.0, "Reponse IA vide.", List.of());
        }
        return results.get(0);
    }

    private AnthropicClient client() {
        AnthropicClient current = client;
        if (current != null) {
            return current;
        }
        synchronized (this) {
            if (client == null) {
                client = AnthropicOkHttpClient.builder().apiKey(props.getAnthropicApiKey()).build();
            }
            return client;
        }
    }

}
