# Ancrage on-chain — Afriland First Bond

Projet Hardhat **isolé** : ne modifie ni ne dépend d'aucun code de
`backend/` ou `frontend/`. Il lit/écrit directement dans la base Postgres du
backend. Deux mécanismes distincts, deux contrats :

| Contrat | Ce qu'il ancre | Cadence | Table source |
|---|---|---|---|
| `AuditAnchor` | Le "tip" du chaînage du journal d'audit (défend les registres internes de la plateforme) | Périodique, un "tip" qui avance en continu | `audit_chain_state` → `audit_chain_anchors` (V27) |
| `AdjudicationAnchor` | Le résultat d'adjudication d'UNE émission (montant/taux/volume par ordre — transparence vers les investisseurs) | Une fois par émission, au figeage | `adjudication_results` → `adjudication_anchors` (V28) |

## Ce que ça résout

Le backend hache déjà chaque enregistrement (chaînage pour l'audit, hash de
snapshot pour un résultat d'adjudication figé). Ça détecte toute modification
rétroactive faite **via l'application**. Mais un attaquant avec un accès
direct à la base pourrait modifier une ligne **et** recalculer le hash à
partir de là pour que ça semble cohérent.

L'ancrage sur une blockchain publique règle ce problème résiduel : une fois
publié, un hash ne peut plus être réécrit, même par quelqu'un ayant un accès
total à la base. La vérification compare le hash recalculé localement à
celui figé sur la chaîne.

## Démarrage rapide (réseau local, aucune clé/compte requis)

```bash
npm install
npx hardhat compile
npx hardhat test              # vérifie les deux contrats, sans réseau ni base

# Terminal 1 — nœud Hardhat persistant (nécessaire pour que l'état survive
# entre le déploiement et l'ancrage)
npm run node

# Terminal 2
cp .env.example .env          # renseigner DATABASE_URL (même valeur que backend/.env)
npm run deploy:local
npm run anchor:local
```

`anchor.js` lit `audit_chain_state.tip_hash` dans Postgres, l'envoie au
contrat, puis écrit le résultat (tx hash, bloc, réseau) dans
`audit_chain_anchors` — visible immédiatement dans l'écran back-office
**Audit** (bandeau d'intégrité en haut de page).

Pour les résultats d'adjudication : après avoir figé un résultat côté
back-office (écran **Ordres**, sélectionner une émission → « 🔒 Figer les
résultats »), lancez :

```bash
npm run anchor-adjudication:local
```

`anchorAdjudication.js` ancre tout résultat figé (`adjudication_results`) pas
encore publié — le contrat refuse lui-même toute republication pour une
émission déjà ancrée.

## Passer sur un réseau public (Sepolia)

Nécessite un compte financé via un faucet Sepolia (ETH de test, sans valeur
réelle) et une URL RPC (Infura/Alchemy, inscription gratuite) :

```bash
# .env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<votre-clé>
SEPOLIA_PRIVATE_KEY=<clé privée d'un compte de test, jamais un compte réel>

npm run deploy:sepolia
npm run anchor:sepolia
```

Chaque ancrage devient alors vérifiable publiquement sur
`https://sepolia.etherscan.io` — lien affiché automatiquement dans l'écran
back-office quand `network = "sepolia"`.

## Fichiers

- `contracts/AuditAnchor.sol` — stocke une liste d'ancrages (hash + nombre
  d'entrées + horodatage), réservé au propriétaire (clé de service).
- `contracts/AdjudicationAnchor.sol` — stocke un résultat (hash) par émission,
  clé = emissionId ; refuse toute republication pour une émission déjà ancrée.
- `scripts/deploy.js` — déploie LES DEUX contrats, enregistre leurs adresses
  dans `deployments.json` (par réseau).
- `scripts/anchor.js` — lit le tip d'audit courant en base, l'ancre, écrit le
  résultat en base.
- `scripts/anchorAdjudication.js` — ancre tout résultat d'adjudication figé
  pas encore publié, un par un.
- `test/AuditAnchor.test.js`, `test/AdjudicationAnchor.test.js` — 10 tests au
  total (accès restreint, non-republication, empilement, transfert de
  propriété), exécutables sans base ni réseau externe.

## Limite assumée

Ceci ne protège pas contre une compromission de la clé de service
(`SEPOLIA_PRIVATE_KEY`) elle-même, ni contre une base compromise **avant**
le tout premier ancrage. Chaque ancrage réduit la fenêtre de modification
indétectable à la période écoulée depuis le précédent — plus les ancrages
sont fréquents, plus cette fenêtre est courte.
