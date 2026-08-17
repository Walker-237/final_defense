# Addendum au Cahier de Charges — Nouvelles Fonctionnalités

**Code :** AFB_DFT_TRES_PRXXX_CAHIER DE CHARGES SOLUTIONS_V.2_2026 — ADDENDUM
**Document de référence :** CAHIER DE CHARGES-COLLECTE DES ORDRES CLIENTELE ET COM DES LIBRABLE_V2.0_2026.docx
**Date de création de l'addendum :** 13/08/2026
**Version :** V1.0
**Solution :** DIGITALISATION DE LA GESTION ET SOUSCRIPTION DES TITRES PUBLIC (CEMAC) — Plateforme *Afriland First Bond*

---

## 1. Objet du document

Le cahier de charges initial (V2.0, révisé le 13/08/2026) décrit six modules fonctionnels (Module 1 à Module 6 — gestion des opportunités, espace investisseur, traitement interne, génération des documents, reporting, sécurité et accès). Depuis sa dernière révision, plusieurs fonctionnalités ont été développées et mises en œuvre sans y être encore intégrées, principalement autour de deux axes :

1. **L'inscription en ligne des clients avec vérification d'identité (KYC)**, jusqu'ici implicite dans le cahier de charges (qui mentionne la reconnaissance faciale uniquement comme méthode de signature électronique, §III.2) mais non détaillée comme parcours d'inscription à part entière.
2. **La gestion du référentiel « Base clients »**, un écran d'administration permettant l'import en masse des clients déjà connus de la banque.

Cet addendum documente ces fonctionnalités avec le même niveau de détail que le corps du cahier de charges, afin de permettre leur intégration lors de la prochaine révision du document de référence.

---

## 2. Synthèse des nouveautés

| # | Fonctionnalité | Utilisateurs concernés | Module du cahier de charges concerné |
|---|---|---|---|
| 1 | Inscription en ligne (auto-souscription PP/PM) | Prospect (non authentifié) | Étend le Module 2 (Espace Investisseur) |
| 2 | Capture faciale et contrôle de vivacité | Prospect, Client (co-signature) | Étend le Module 2 et le Module 6 (Sécurité) |
| 3 | Capture et analyse de pièce d'identité | Prospect | Étend le Module 2 |
| 4 | Vérification des inscriptions (back-office) | AGENT, SUPERVISEUR, ADMIN | Étend le Module 3 (Traitement interne) |
| 5 | Contrôle facial des ordres de souscription | AGENT, SUPERVISEUR, ADMIN | Étend le Module 3 et le Module 6 |
| 6 | Compte-titres joint et co-signature filmée | CLIENT_PP, CLIENT_PM | Étend le Module 2 |
| 7 | Référentiel « Base clients » (import en masse) | AGENT, SUPERVISEUR, ADMIN | Étend le Module 1 et le Module 3 |

---

## 3. Fonctionnalité 1 — Inscription en ligne (auto-souscription)

### 3.1 Objectif métier

Le cahier de charges initial relève, parmi les limites du processus actuel, un « manque d'autonomie des investisseurs, contraints de passer par des canaux indirects ». Cette limite concernait jusqu'ici la consultation des opportunités et la soumission des ordres ; elle s'étend désormais à l'**ouverture même du compte-titres**, qui ne nécessite plus de démarche préalable en agence.

### 3.2 Description fonctionnelle

Un prospect (personne physique ou morale) accède à un parcours d'inscription en ligne accessible sans authentification (`/auth/register` pour une personne physique, `/auth/register-pm` pour une personne morale). Le parcours couvre :

- La saisie de l'identité, des coordonnées et des informations de compte (e-mail, mot de passe, nom, téléphone, compte espèces à rattacher).
- Le choix du type de compte-titres : **individuel** ou **joint** (plusieurs titulaires, cf. Fonctionnalité 6).
- La capture d'une pièce d'identité (cf. Fonctionnalité 3).
- La capture du visage avec contrôle de vivacité (cf. Fonctionnalité 2).
- La lecture et l'acceptation de la convention de compte-titres en vigueur.
- La soumission du dossier complet au back-office pour validation (cf. Fonctionnalité 4).

Le dossier est **reprenable** : si l'inscription est interrompue (échec réseau, fermeture de l'onglet), le prospect peut reprendre son dossier là où il l'a laissé plutôt que de tout ressaisir.

### 3.3 Utilisateurs concernés

Prospects non authentifiés, personnes physiques (PP) ou morales (PM).

---

## 4. Fonctionnalité 2 — Capture faciale et contrôle de vivacité

### 4.1 Objectif métier

Le cahier de charges liste la « reconnaissance faciale » parmi les méthodes de signature électronique possibles (§III.2, Module 2). Cette fonctionnalité en constitue le socle technique : elle capture et vérifie le visage du client, aussi bien à l'ouverture du compte qu'à chaque usage ultérieur nécessitant une preuve d'identité (signature d'un ordre en compte joint, par exemple).

### 4.2 Description fonctionnelle

Le client cadre son visage face à la caméra. Le système guide la capture en direct (visage absent, mal centré, coupé, éclairage insuffisant ou excessif) puis demande un **clignement des yeux** afin de s'assurer qu'il s'agit d'une personne réelle présente devant la caméra, et non d'une photo présentée à l'objectif (contrôle de vivacité). Une fois la capture validée, le système calcule une empreinte faciale numérique (128 points de mesure) qui servira de référence pour les comparaisons ultérieures.

**Point important :** la comparaison entre deux visages (correspondance ou non) n'est **jamais** décidée par le navigateur — seul le serveur rend ce verdict, la capture côté client se limitant à fournir une image et une empreinte de qualité suffisante.

### 4.3 Utilisateurs concernés

Tout prospect à l'inscription ; tout co-signataire d'un compte joint lors de la validation d'une opération (cf. Fonctionnalité 6).

---

## 5. Fonctionnalité 3 — Capture et analyse de pièce d'identité

### 5.1 Objectif métier

Réduire le risque d'usurpation d'identité à l'ouverture de compte et fiabiliser les pièces reçues, sans imposer un passage en agence pour le dépôt physique du document.

### 5.2 Description fonctionnelle

Le prospect fournit sa pièce d'identité (carte nationale d'identité recto/verso, passeport, ou carte de séjour) soit par téléversement d'un fichier, soit par **prise de vue directe** via la caméra de son appareil (caméra arrière privilégiée pour une meilleure netteté, résolution maximale disponible demandée). Le système analyse automatiquement l'image :

- Lecture du texte par reconnaissance optique de caractères (OCR) — nom, date de naissance et autres mentions repérées.
- Contrôle de netteté (l'image ne doit pas être floue).
- Détection indicative du type de pièce.

**Point important :** le type de pièce détecté par l'OCR est **purement indicatif et jamais bloquant** — la décision finale d'acceptation revient systématiquement à l'agent du back-office lors de la vérification du dossier (Fonctionnalité 4), qui dispose du texte OCR complet pour contrôle.

### 5.3 Utilisateurs concernés

Prospects, lors du parcours d'inscription en ligne.

---

## 6. Fonctionnalité 4 — Vérification des inscriptions (back-office)

### 6.1 Objectif métier

Maintenir un contrôle humain systématique sur chaque ouverture de compte malgré la dématérialisation du parcours, conformément à l'exigence de conformité et de traçabilité du cahier de charges.

### 6.2 Description fonctionnelle

Un écran dédié (menu « Vérifications faciales », back-office) présente la file des dossiers d'inscription en attente : score de vivacité obtenu, type de personne (PP/PM), identité déclarée, statut de vérification. L'agent ouvre un dossier pour consulter :

- Les pièces d'identité déposées et le texte extrait par OCR.
- La capture faciale et son score de vivacité.
- Les informations de compte espèces associées.

Il **valide** ou **rejette** le dossier ; la validation déclenche l'ouverture effective du compte-titres.

### 6.3 Utilisateurs concernés

AGENT, SUPERVISEUR, ADMIN (permission de gestion des clients).

---

## 7. Fonctionnalité 5 — Contrôle facial des ordres de souscription

### 7.1 Objectif métier

Renforcer la fiabilité de la signature électronique des ordres évoquée dans le cahier de charges, en confirmant que la personne qui soumet un ordre correspond bien au titulaire enregistré.

### 7.2 Description fonctionnelle

Après la **soumission** d'un ordre (l'ordre est déjà enregistré et son traitement n'attend pas ce contrôle), le client peut faire l'objet d'un contrôle facial complémentaire : son visage est comparé à celui capturé à l'ouverture du compte. Le résultat (correspond / différent / non comparable) est mis à la disposition du back-office pour revue, **sans jamais bloquer ni remettre en cause l'ordre déjà soumis** — y compris en cas de panne réseau ou d'échec technique du contrôle.

### 7.3 Utilisateurs concernés

Clients (déclenchement du contrôle) ; AGENT, SUPERVISEUR, ADMIN (revue du résultat).

---

## 8. Fonctionnalité 6 — Compte-titres joint et co-signature filmée

### 8.1 Objectif métier

Répondre au besoin de comptes détenus par plusieurs titulaires (couple, indivision, société), avec une exigence de sécurité proportionnée : aucune opération n'est exécutée sans l'accord de chacun des signataires.

### 8.2 Description fonctionnelle

Un compte-titres peut être ouvert en mode **joint**, avec plusieurs titulaires disposant chacun de leurs propres identifiants de connexion. Lorsqu'un titulaire initie un ordre, les autres signataires reçoivent une demande de validation qu'ils doivent traiter dans un **délai de 5 minutes** :

- **Valider** exige la même preuve qu'à l'inscription : signature manuscrite **et** capture du visage avec contrôle de vivacité, comparée par le serveur à la référence enregistrée à l'ouverture du compte.
- **Refuser** n'exige aucune preuve particulière — on ne demande pas à quelqu'un de prouver son identité pour simplement dire non.

Sans réponse de l'ensemble des signataires dans le délai imparti, l'opération est **automatiquement rejetée** par le serveur.

### 8.3 Utilisateurs concernés

CLIENT_PP, CLIENT_PM titulaires d'un compte-titres joint.

---

## 9. Fonctionnalité 7 — Référentiel « Base clients »

### 9.1 Objectif métier

Le cahier de charges vise la « centralisation et fluidité du traitement » et la réduction de la « charge administrative élevée pour les équipes internes ». Le référentiel Base clients répond directement à ce besoin pour les clients déjà connus de la banque en dehors de la plateforme (base existante côté core-banking), en évitant leur ressaisie manuelle.

### 9.2 Description fonctionnelle

Un écran d'administration (menu « Base clients », back-office) permet :

- L'**import en masse** du référentiel clients depuis un fichier Excel/CSV.
- La détection et l'affichage des **doublons écartés** lors de l'import, pour revue par l'agent.
- La **pagination côté serveur** de la liste (le référentiel pouvant compter un grand nombre de fiches).
- L'**édition** d'une fiche existante, avec validation du format du compte de dépôt (12 caractères).

Ce référentiel alimente ensuite d'autres écrans de la plateforme (pré-remplissage du modèle d'import de portefeuille, pré-remplissage du compte-titres lors de la vérification faciale).

### 9.3 Utilisateurs concernés

AGENT, SUPERVISEUR, ADMIN (permission de gestion des clients).

---

## 10. Bénéfices attendus

En cohérence avec la structure du cahier de charges initial (§ Bénéfice attendu) :

### 10.1 Bénéfices opérationnels
- Suppression du passage en agence pour l'ouverture de compte, avec un contrôle humain conservé au stade de la validation (back-office), pas supprimé.
- Réduction de la ressaisie manuelle des clients déjà connus de la banque grâce à l'import en masse du référentiel.
- Fiabilisation de la signature électronique des ordres par un contrôle d'identité biométrique complémentaire.

### 10.2 Bénéfices clients
- Ouverture de compte entièrement à distance, sans contrainte d'horaires ni de déplacement.
- Dossier d'inscription reprenable en cas d'interruption — aucune perte de saisie.
- Sécurité renforcée du compte-titres joint : aucune opération sans l'accord de tous les titulaires.

### 10.3 Bénéfices stratégiques et institutionnels
- Alignement avec les exigences de conformité (KYC) attendues par la BEAC et la COBAC pour l'ouverture de comptes à distance.
- Réduction du risque d'usurpation d'identité, renforçant la confiance dans la plateforme.

---

## 11. Recommandation d'intégration au cahier de charges

Lors de la prochaine révision du document CAHIER DE CHARGES-COLLECTE DES ORDRES CLIENTELE ET COM DES LIBRABLE, il est recommandé de :

1. Détailler, dans la section « III.3 Modules fonctionnels détaillés » (Module 2 — Espace Investisseur), le parcours complet d'inscription en ligne (identité, pièce, visage, convention, soumission), qui n'y figure aujourd'hui que sous la forme générale « Accessible via un identifiant unique ».
2. Ajouter un paragraphe dédié au contrôle de vivacité et à la comparaison biométrique dans la section « VI. Module 6 : Sécurité et gestion des accès », en complément de l'authentification multi-facteur déjà décrite.
3. Ajouter un **Module 7 — Référentiel Base clients** à la suite du Module 6 existant, décrivant l'import en masse et la déduplication.
4. Mentionner le compte-titres joint et son mécanisme de co-signature dans la section « III.2 Module 2 : Espace Investisseur », actuellement silencieuse sur la pluralité de titulaires.

---

*Document rédigé en complément du cahier de charges V2.0 du 13/08/2026. Ce document ne saurait être divulgué en partie ou en totalité sans autorisation écrite d'Afriland First Bank, conformément à la clause de confidentialité du document de référence.*
