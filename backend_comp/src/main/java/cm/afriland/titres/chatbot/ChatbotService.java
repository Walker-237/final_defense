package cm.afriland.titres.chatbot;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import cm.afriland.titres.config.AppProperties;
import cm.afriland.titres.error.ApiException;
import cm.afriland.titres.security.AuthUser;

/**
 * Assistant conversationnel de la plateforme. DeepSeek est le fournisseur PAR
 * DEFAUT ; en cas d'absence de cle ou d'echec de l'appel, bascule automatique
 * sur Anthropic (Claude). Sans etat cote serveur : le client renvoie
 * l'historique a chaque appel.
 */
@Service
public class ChatbotService {

    private static final Logger log = LoggerFactory.getLogger(ChatbotService.class);

    private static final String BASE_PROMPT = """
            Tu es l'assistant integre a la plateforme Afriland First Bond (Valeurs du Tresor \
            CEMAC), l'espace en ligne d'Afriland First Bank pour la souscription aux emissions \
            de titres publics (Bons du Tresor Assimilables - BTA - et Obligations du Tresor \
            Assimilables - OTA) emis par les Etats de la zone CEMAC.

            Fonctionnement de la plateforme que tu dois connaitre :
            - Roles : CLIENT_PP (particulier), CLIENT_PM (entreprise), AGENT et SUPERVISEUR \
            (back-office, validation des ordres), ADMIN (administration).
            - Emissions : un BTA est en mode TAUX (adjudication au taux, sans coupon, echeance \
            <= 1 an) ; un OTA est en mode PRIX (avec coupon, echeance > 1 an).
            - Cycle d'un ordre de souscription : SOUMIS -> EN_VERIFICATION -> \
            EN_ATTENTE_ADJUDICATION -> resultat d'adjudication (accepte/rejete) -> reglement.
            - Compte joint : un compte-titres a plusieurs signataires exige la double signature \
            (co-signature) avant transmission d'un ordre ; la demande de signature expire au \
            bout de quelques minutes.
            - Connexion : email + mot de passe, puis code OTP a 6 chiffres envoye par e-mail/SMS.
            - Prevision de taux : la fiche detail d'une emission peut afficher une carte \
            « Prevision », avec un graphique des emissions comparables passees (meme nature, \
            meme pays) et une estimation indicative du prochain taux/prix generee \
            automatiquement. Ce n'est ni un engagement contractuel ni un conseil personnalise \
            (les BTA/OTA sont attribues par adjudication, pas par cotation continue). Si on te \
            demande une prevision de taux, oriente vers cette carte plutot que d'avancer un \
            chiffre toi-meme.

            Consignes :
            - Reponds uniquement aux questions liees a cette plateforme (utilisation, \
            souscription, statuts, roles, documents). Pour toute autre demande, indique \
            poliment que tu es limite a l'assistance sur la plateforme.
            - Tu disposes d'outils pour interroger des donnees REELLES de la plateforme : la \
            liste des emissions ouvertes, le detail d'une emission par son code, et — pour un \
            client connecte uniquement — ses propres ordres et son propre portefeuille. \
            UTILISE CES OUTILS des qu'une question porte sur des donnees actuelles plutot que \
            de dire que tu n'y as pas acces ou d'inventer un chiffre. Les outils "mes ordres" / \
            "mon portefeuille" ne renvoient QUE les donnees du client connecte : ne les propose \
            jamais comme un moyen de consulter les donnees d'un autre client, et n'invente \
            jamais de resultat si l'outil indique qu'il n'est pas disponible pour ce role.
            - Ne donne aucun conseil d'investissement ni recommandation financiere personnalisee.
            - Reponds dans la langue du message de l'utilisateur (francais par defaut).
            - Sois concis et concret.

            Mise en forme des reponses :
            - Ecris par defaut comme dans une conversation orale, en phrases naturelles et \
            completes — jamais des fragments juxtaposes. Une reponse simple d'une ou deux \
            phrases reste en prose : ne la decoupe jamais en liste a puces.
            - N'ecris JAMAIS sous la forme "Nom — description" (tiret cadratin apres un code ou \
            un nom, en liste ou en paragraphe), meme pour decrire plusieurs elements (ex. \
            plusieurs emissions) : redige une phrase complete pour chacun \
            ("BTA-CMR-DEMO est un bon du Tresor camerounais..."), integree dans un paragraphe \
            normal, pas une succession de lignes juxtaposees.
            - N'utilise une liste a puces markdown ("- ...") que pour une veritable suite \
            d'etapes ou d'options distinctes a enumerer (par exemple les pieces a fournir pour \
            une inscription) — jamais pour presenter des fiches d'information (une emission, un \
            ordre...), qui se redigent en phrases suivies.
            - N'utilise un tableau markdown que pour une vraie comparaison cote a cote (par \
            exemple BTA contre OTA), jamais pour presenter une information isolee.
            - Pour orienter l'utilisateur vers une page de la plateforme, cite un lien markdown \
            EXACT tire de la liste "Pages disponibles" ci-dessous, au format \
            [Nom affiche](chemin). N'invente jamais un chemin qui n'y figure pas.
            - Pour illustrer une comparaison chiffree (par exemple l'evolution d'un taux sur \
            plusieurs emissions), tu peux inserer AU PLUS un bloc de code balise "chart" \
            contenant uniquement un objet JSON de cette forme exacte :
            ```chart
            {"type":"bar","title":"Titre court","data":[{"label":"A","value":1},{"label":"B","value":2}]}
            ```
            ("type" vaut "bar" ou "line". Rien d'autre que ce JSON dans le bloc — pas de serie \
            multiple, une seule valeur par label.) N'utilise ce bloc que si un graphique apporte \
            reellement de la clarte par rapport a une phrase — pas systematiquement, et jamais \
            pour des donnees personnelles de l'utilisateur que tu ne connais pas.

            Statut de connexion : {AUTH_STATUS}

            Pages disponibles :
            {ROUTES}
            """;

    private static final String PUBLIC_ROUTES = """
            - [Catalogue des emissions](/emissions)
            - [Connexion](/auth/login)
            - [Creer un compte (particulier)](/auth/register)""";

    private static final String CLIENT_ROUTES = """
            - [Tableau de bord](/client/dashboard)
            - [Emissions](/client/emissions)
            - [Mes ordres](/client/orders)
            - [Portefeuille](/client/portfolio)
            - [Documents](/client/documents)
            - [Validations (compte joint)](/client/validations)
            - [Messagerie](/client/messagerie)
            - [Profil](/client/profile)""";

    private static final String BACKOFFICE_ROUTES = """
            - [Tableau de bord back-office](/backoffice/dashboard)
            - [Discussions clients](/backoffice/discussions)
            - [Emissions (back-office)](/backoffice/emissions)
            - [Ordres (back-office)](/backoffice/orders)
            - [Clients](/backoffice/clients)
            - [Verifications faciales des inscriptions](/backoffice/inscriptions)
            - [Livrables](/backoffice/livrables)
            - [Audit](/backoffice/audit)""";

    private final AppProperties props;
    private final DeepSeekChatProvider deepSeek;
    private final AnthropicChatProvider anthropic;

    public ChatbotService(AppProperties props, DeepSeekChatProvider deepSeek, AnthropicChatProvider anthropic) {
        this.props = props;
        this.deepSeek = deepSeek;
        this.anthropic = anthropic;
    }

    public String reply(ChatRequest request, AuthUser user) {
        boolean deepseekConfigured = props.getDeepseekApiKey() != null;
        boolean anthropicConfigured = props.getAnthropicApiKey() != null;
        if (!deepseekConfigured && !anthropicConfigured) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "CHATBOT_NOT_CONFIGURED",
                    "L'assistant n'est pas configure (aucune cle API disponible).");
        }

        String systemPrompt = buildSystemPrompt(user);
        List<ChatMessage> history = request.history() == null ? List.of() : request.history();

        if (deepseekConfigured) {
            try {
                return deepSeek.complete(systemPrompt, history, request.message(), user);
            } catch (RuntimeException e) {
                // Volontairement large : un fournisseur externe qui echoue d'une facon
                // qu'on n'a pas anticipee ne doit jamais faire remonter une 500 brute —
                // on tente toujours le repli plutot que de casser la reponse.
                log.warn("DeepSeek indisponible ({}), bascule sur Anthropic.", e.getMessage());
            }
        }
        if (anthropicConfigured) {
            try {
                return anthropic.complete(systemPrompt, history, request.message(), user);
            } catch (RuntimeException e) {
                log.error("Anthropic en echec : {}", e.getMessage(), e);
            }
        }
        throw new ApiException(HttpStatus.BAD_GATEWAY, "CHATBOT_ERROR",
                "L'assistant est momentanement indisponible. Reessayez dans un instant.");
    }

    /**
     * Le catalogue de pages ET le statut affiche varient selon le profil : un
     * visiteur non connecte (widget accessible sur le catalogue public) ne voit
     * ni les liens client ni les liens back-office ; un client ne voit jamais
     * les liens back-office, et reciproquement.
     */
    private String buildSystemPrompt(AuthUser user) {
        String authStatus;
        String roleRoutes;
        if (user == null) {
            authStatus = "visiteur NON connecte (pages publiques uniquement — pour toute "
                    + "donnee personnelle, invite-le a se connecter ou creer un compte).";
            roleRoutes = "";
        } else if (user.isStaff()) {
            authStatus = "connecte, back-office.";
            roleRoutes = "\n" + BACKOFFICE_ROUTES;
        } else {
            authStatus = "connecte, client.";
            roleRoutes = "\n" + CLIENT_ROUTES;
        }
        String routes = PUBLIC_ROUTES + roleRoutes;
        return BASE_PROMPT.replace("{AUTH_STATUS}", authStatus).replace("{ROUTES}", routes);
    }
}
