# Ancrage on-chain du journal d'audit — Afriland First Bond

Projet Hardhat **isolé** : ne modifie ni ne dépend d'aucun code de
`backend/` ou `frontend/`. Il lit/écrit directement dans la base Postgres du
backend (`audit_chain_state`, `audit_chain_anchors` — migration `V27`).

## Ce que ça résout

Le backend chaîne cryptographiquement chaque entrée du journal d'audit
(SHA-256 de l'entrée précédente + son propre contenu — `AuditService.java`).
Ça détecte déjà toute modification rétroactive faite **via l'application**.
Mais un attaquant avec un accès direct à la base pourrait modifier une ligne
**et** recalculer toute la chaîne à partir de là pour que ça semble cohérent.

L'ancrage périodique du "tip" (dernier hash) sur une blockchain publique
règle ce problème résiduel : une fois publié, un hash ne peut plus être
réécrit, même par quelqu'un ayant un accès total à la base. La vérification
compare alors le hash recalculé localement à celui figé sur la chaîne.

## Démarrage rapide (réseau local, aucune clé/compte requis)

```bash
npm install
npx hardhat compile
npx hardhat test              # vérifie le contrat, sans réseau ni base

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
- `scripts/deploy.js` — déploie le contrat, enregistre son adresse dans
  `deployments.json` (par réseau).
- `scripts/anchor.js` — lit le tip courant en base, l'ancre, écrit le
  résultat en base.
- `test/AuditAnchor.test.js` — 5 tests (accès restreint, empilement des
  ancrages, transfert de propriété), exécutables sans base ni réseau externe.

## Limite assumée

Ceci ne protège pas contre une compromission de la clé de service
(`SEPOLIA_PRIVATE_KEY`) elle-même, ni contre une base compromise **avant**
le tout premier ancrage. Chaque ancrage réduit la fenêtre de modification
indétectable à la période écoulée depuis le précédent — plus les ancrages
sont fréquents, plus cette fenêtre est courte.
