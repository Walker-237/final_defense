# Guide de test — Intégrité du journal d'audit & ancrage blockchain

Ce guide couvre les deux mécanismes de détection d'altération construits
cette session :

1. **Journal d'audit** (`audit_log`) — chaînage de hash (SHA-256, façon
   blockchain) + ancrage périodique du "tip" sur une blockchain publique.
2. **Résultats d'adjudication** (`adjudication_results`) — hash figé par
   émission, une fois pour toutes + ancrage on-chain, un par émission.

Les deux couches se testent séparément : d'abord en local (sans
blockchain — le chaînage seul détecte déjà une altération), puis avec
ancrage on-chain (le point de contrôle qu'un accès direct à la base ne peut
pas effacer).

---

## 1. Prérequis

| Outil | Nécessaire pour |
|---|---|
| Docker + Docker Compose | `backend/` + PostgreSQL |
| Node.js ≥ 18 | `frontend/` et `blockchain/` |
| Un client Postgres (`psql`, DBeaver, pgAdmin…) | simuler une altération directe |

Ports par défaut (`backend/docker-compose.yml`) :
- PostgreSQL : `127.0.0.1:5434` (utilisateur `afb_app`, base `afb_titres`)
- Backend : `http://localhost:8080`
- Frontend : selon `npm start` (proxy vers le backend, cf. `proxy.conf.json`)

---

## 2. Tests automatisés (aucune base, aucun réseau requis)

### Backend (JUnit + Mockito)

```bash
cd backend
mvn test -Dtest=AuditServiceTest,AuditIntegrityControllerTest,AdjudicationResultControllerTest
```

Ce que ça couvre :
- `AuditServiceTest` — chaînage correct, même contenu + tip différent ⇒ hash
  différent, détection d'une entrée altérée, détection d'une entrée
  **supprimée** (casse la chaîne à l'entrée suivante).
- `AuditIntegrityControllerTest` — permission requise, comptage des entrées
  non ancrées, chaîne rompue correctement remontée.
- `AdjudicationResultControllerTest` — permission requise, refus de figer une
  émission déjà figée, refus de figer sans ordre final, recalcul en direct
  détectant une divergence après figeage.

Pour la suite complète du backend (inclut tout le reste de la plateforme) :

```bash
mvn test
```

### Blockchain (Hardhat)

```bash
cd blockchain
npm install        # première fois seulement
npx hardhat compile
npx hardhat test
```

10 tests, sans base ni réseau externe : accès restreint au propriétaire,
non-republication d'un résultat déjà ancré (`AdjudicationAnchor`), empilement
de plusieurs ancrages, transfert de propriété.

---

## 3. Test manuel de bout en bout — Journal d'audit

### 3.1 Démarrer la plateforme

```bash
cd backend
docker compose up --build
```

Vérifier : `curl http://localhost:8080/health`. Comptes de démo dans
`backend/README.md` (mot de passe `Demo1234`, OTP `123456` en dev).

### 3.2 Générer quelques entrées d'audit

Connectez-vous avec n'importe quel compte (ex. `admin@afriland.cm`) — chaque
connexion, changement de statut d'ordre, etc. écrit dans `audit_log` via
`AuditService`.

### 3.3 Vérifier que la chaîne est intacte

Back-office → **Audit**. Le bandeau en haut de page doit afficher
**✓ Chaîne intacte** avec le nombre d'entrées vérifiées et le hash "tip"
actuel.

Ou directement :

```bash
curl -H "Authorization: Bearer <token admin/superviseur>" \
  http://localhost:8080/api/v1/audit/integrity
```

### 3.4 Simuler une altération directe (hors application)

C'est le scénario central : quelqu'un avec un accès direct à la base modifie
une ligne, en contournant complètement l'application.

```bash
docker exec -it afb_titres_db psql -U afb_app -d afb_titres
```

```sql
-- Choisir une entrée existante et en modifier le contenu APRÈS coup.
SELECT sequence, action, reference FROM audit_log ORDER BY sequence LIMIT 5;

UPDATE audit_log SET reference = 'VALEUR-ALTEREE-APRES-COUP' WHERE sequence = 1;
```

Rechargez l'écran **Audit** (ou rappelez `GET /audit/integrity`) :
- **⚠ Rupture détectée (entrée n°1)** doit apparaître.
- Toutes les entrées créées *après* celle-ci sont également signalées comme
  non vérifiables (la chaîne recalculée ne rejoint plus le tip stocké).

Pour revenir à un état propre, le plus simple est de repartir d'une base
fraîche (`docker compose down -v && docker compose up --build`) plutôt que
d'essayer de "réparer" la ligne — une chaîne de hash n'est, par construction,
pas réparable après coup sans en avoir la preuve.

### 3.5 Ancrer le journal on-chain (réseau local, aucune clé requise)

```bash
cd blockchain
cp .env.example .env
# éditer .env : DATABASE_URL=postgresql://afb_app:change_me_db@localhost:5434/afb_titres
```

Terminal A (nœud Hardhat persistant) :

```bash
npm run node
```

Terminal B :

```bash
npm run deploy:local
npm run anchor:local
```

Rechargez l'écran back-office **Audit** : le bandeau doit maintenant afficher
un ancrage on-chain (réseau `localhost`, tx hash, nombre d'entrées ancrées).
Relancez `npm run anchor:local` après avoir généré de nouvelles entrées pour
voir `entreesNonAncrees` redescendre à 0.

---

## 4. Test manuel de bout en bout — Résultats d'adjudication

### 4.1 Obtenir un ordre en statut final d'adjudication

**Raccourci de test** (le plus rapide, pas le parcours réel) :

```sql
-- Choisir un ordre existant, le mettre directement dans un statut final.
SELECT id, reference, emission_id, status FROM orders LIMIT 10;

UPDATE orders
SET status = 'TOTALEMENT_RETENU', montant_adjuge = montant, taux_adjuge = taux_soumis, volume_alloue = volume
WHERE id = '<id choisi>';
```

**Parcours réel** (via l'UI) : un agent (`agent@afriland.cm`) propose un
résultat sur l'ordre (back-office → Ordres → détail de l'ordre), puis un
superviseur (`superviseur@afriland.cm`, permission `ORDER_RESULT_VALIDATE`)
le valide depuis l'écran **Ordres** — c'est cette validation qui applique
réellement le statut final.

### 4.2 Figer le résultat de l'émission

Back-office → **Ordres** → filtrer sur l'émission concernée. Le panneau
**Intégrité du résultat d'adjudication** apparaît sous les filtres :

- Cliquer **🔒 Figer les résultats**.
- Le panneau affiche alors le hash figé, le nombre d'ordres inclus, et
  « Pas encore ancré on-chain ».

Ou directement :

```bash
curl -X POST -H "Authorization: Bearer <token superviseur>" \
  http://localhost:8080/api/v1/adjudication/<emissionId>/snapshot
```

Refaire un `POST .../snapshot` sur la **même** émission doit échouer (409) —
c'est voulu : un résultat figé ne se re-fige jamais silencieusement.

### 4.3 Simuler une altération après figeage

```sql
UPDATE orders SET montant_adjuge = 999999999999 WHERE id = '<le même id qu'en 4.1>';
```

Rechargez le panneau (ou rappelez `GET /adjudication/<emissionId>/integrity`) :
**⚠ Divergence détectée** doit apparaître — le hash recalculé depuis l'état
actuel des ordres ne correspond plus au hash figé.

### 4.4 Ancrer le résultat on-chain

Après un `npm run deploy:local` (si pas déjà fait pour la partie 3) :

```bash
cd blockchain
npm run anchor-adjudication:local
```

Le script n'ancre que les résultats figés pas encore publiés — sans effet si
rien de nouveau n'est en attente. Rechargez le panneau back-office : l'ancrage
on-chain doit apparaître (tx hash, réseau).

---

## 5. Passer sur un réseau public (Sepolia) — optionnel

Nécessite un compte financé via un faucet Sepolia (ETH de test, sans valeur
réelle) et une URL RPC (Infura/Alchemy, inscription gratuite) :

```bash
# blockchain/.env
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/<votre-clé>
SEPOLIA_PRIVATE_KEY=<clé privée d'un compte de TEST, jamais un compte réel>
```

```bash
npm run deploy:sepolia
npm run anchor:sepolia                 # journal d'audit
npm run anchor-adjudication:sepolia    # résultats d'adjudication
```

Chaque ancrage devient vérifiable publiquement sur
`https://sepolia.etherscan.io` — les panneaux back-office affichent
automatiquement le lien quand `network = "sepolia"`.

---

## 6. Dépannage

| Symptôme | Cause probable |
|---|---|
| `anchor.js` / `anchorAdjudication.js` : "Aucun déploiement trouvé" | `npm run deploy:local` (ou `:sepolia`) n'a pas encore été exécuté sur ce réseau |
| `anchor.js` : "DATABASE_URL manquant" | `.env` absent ou mal renseigné dans `blockchain/` (copier `.env.example`) |
| `anchor.js` : "Table audit_chain_state vide" | migration `V27` non appliquée — relancer le backend pour que Flyway migre |
| Le panneau back-office reste vide / erreur silencieuse | vérifier le rôle connecté a bien la permission `AUDIT_READ` (Audit) ou `ORDER_VALIDATE` (figer un résultat) |
| `npm run node` puis `deploy:local` échoue avec une erreur de connexion | le nœud Hardhat du Terminal A doit rester **ouvert** pendant le déploiement et l'ancrage — c'est un réseau en mémoire, il s'éteint avec le terminal |
| Un ancrage semble "disparaître" après redémarrage | normal avec `npm run node` seul (état en mémoire) — utiliser Sepolia pour un état qui survit aux redémarrages |

---

## 7. Aide-mémoire des commandes

```bash
# Tests automatisés
cd backend && mvn test -Dtest=AuditServiceTest,AuditIntegrityControllerTest,AdjudicationResultControllerTest
cd blockchain && npx hardhat test

# Démarrage
cd backend && docker compose up --build
cd blockchain && npm run node                    # terminal séparé, à garder ouvert

# Déploiement + ancrage (réseau local)
cd blockchain && npm run deploy:local
cd blockchain && npm run anchor:local             # journal d'audit
cd blockchain && npm run anchor-adjudication:local # résultats d'adjudication

# Reset complet (base + état Hardhat)
cd backend && docker compose down -v && docker compose up --build
# + relancer `npm run node` (le réseau en mémoire ne survit pas au redémarrage)
```
