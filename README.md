# Afriland First Bond — online subscription to CEMAC public securities

A digital platform for **Afriland First Bank's treasury department** to manage and sell **public securities of the CEMAC zone** (treasury bills and bonds, *BTA / OTA*) to its customers. Investors register online, subscribe to issues, follow their portfolio and receive their documents; back-office agents and supervisors check and process the orders; and the integrity of the audit trail is anchored on a **public blockchain**.

Securities of this kind are allocated by **auction (*adjudication*)** rather than by continuous market pricing, so the platform records the auction result of each issue and derives each customer's positions from the allotted orders.

The functional specification (in French) is in the repository: the main requirements document (`CAHIER DE CHARGES-…V2.0_2026.docx`) and its addendum.

---

## Technologies used

| Part | Technology |
|---|---|
| **Frontend** | [Angular 21](https://angular.dev) with **server-side rendering** (Express 5), TypeScript 5.9, RxJS, [Tailwind CSS 4](https://tailwindcss.com) |
| **Face and identity checks (browser)** | [MediaPipe Tasks Vision](https://developers.google.com/mediapipe), [`@vladmandic/face-api`](https://github.com/vladmandic/face-api), [Tesseract.js](https://tesseract.projectnaptha.com) (OCR) |
| **Documents and exports** | [pdf.js](https://mozilla.github.io/pdf.js/), [jsPDF](https://github.com/parallax/jsPDF), html2canvas, [ExcelJS](https://github.com/exceljs/exceljs), `marked` + `DOMPurify` |
| **Backend** | **Java 21**, **Spring Boot 3.3** (Spring MVC, JDBC with `JdbcTemplate`, Bean Validation, Mail, WebSocket), Maven |
| **Database** | **PostgreSQL 16**, migrations with **Flyway** (27 versions) |
| **Authentication and security** | JWT (jjwt) with refresh-token rotation, **MFA by one-time code**, **Argon2id** password hashing (Spring Security Crypto + BouncyCastle), role-based access control, rate limiting and account lockout, optional **LDAP / Active Directory** sign-in |
| **AI** | **DeepSeek** (default chat provider) with automatic fallback to **Anthropic Claude** (also used for identity-document authenticity and face matching), through the Anthropic Java SDK |
| **QR codes** | ZXing |
| **Blockchain** | **Solidity 0.8.24** smart contracts, **Hardhat** (with `hardhat-toolbox`), the **Sepolia** Ethereum test network, Node.js with `pg` |
| **Infrastructure** | Docker and Docker Compose (multi-stage images, non-root users, Node 22 for the frontend) |
| **Testing and quality** | JUnit, Mockito and Testcontainers (backend), Vitest with jsdom (frontend), Hardhat tests (contracts), SonarQube configuration |

---

## Architecture

```
 Browser ──► Angular SSR server (Express) ──/api──► Spring Boot API ──► PostgreSQL
                                                         │
                                                         ├──► DeepSeek / Anthropic Claude (assistant, ID and face analysis, rate estimates)
                                                         ├──► Bank core-banking system (account balance lookup, through the backend only)
                                                         └──► SMTP / LDAP (e-mails and OTP codes, directory sign-in)

 Hardhat scripts ── read audit hashes in PostgreSQL ──► anchor them on Sepolia (AuditAnchor, AdjudicationAnchor contracts)
```

The Angular server relays `/api` calls to the backend, so the browser only ever talks to the frontend's origin.

---

## Main features

### Investors (individuals and companies)
- **Online registration** (individual or legal entity) with a resumable file: identity-document capture with OCR, **face capture with a liveness check**, reading and accepting the securities-account agreement.
- **Joint securities accounts** with co-signatures.
- Browse **issues (*émissions*)**, **subscribe** to them (orders with electronic signature), edit or follow an order.
- **Portfolio** derived from allotted orders, with documents and notifications, messaging with the bank, an indicative rate estimate for an issue, and a built-in user guide.

### Back-office (agents, supervisors, administrators)
- Issue management and **order processing**: validation, rejection and entry of the **auction result**.
- **Verification of registrations**, with an identity-document authenticity indicator and a face-match score (indicative, never blocking), and a **face check of subscription orders**.
- **Customer base** import and **portfolio** import (Excel), deliverables generation, reports.
- Administration: users and the role/permission matrix, OTP monitoring and settings, LDAP / Active Directory and e-mail settings, connection QR codes.
- **Audit journal** with an integrity banner at the top of the screen.

### Security and integrity
- Short-lived access tokens (15 minutes), MFA, Argon2id, parameterised SQL only, security headers (CSP, HSTS…), restricted CORS, customer data partitioning, generic errors against account enumeration.
- Liveness decisions are made **on the server only**: the browser captures and transmits, it never gives a verdict.
- **Tamper-evident audit log**: each entry is chained to the previous one with SHA-256, so any change made through the application is detected.
- **On-chain anchoring** closes the remaining gap (someone editing the database directly and recomputing the chain). Two contracts:

  | Contract | What it anchors | When |
  |---|---|---|
  | `AuditAnchor` | The tip hash of the audit chain | Periodically |
  | `AdjudicationAnchor` | The auction result of one issue (amount, rate, volume per order), for transparency towards investors | Once per issue |

  Once published, a hash cannot be rewritten, even by someone with full database access.

---

## Repository layout

| Folder | Content |
|---|---|
| `backend_comp/` | Spring Boot API (snapshot): code, Flyway migrations, `Dockerfile`, `docker-compose.yml` |
| `frontend_comp/` | Angular application (snapshot) |
| `blockchain/` | Hardhat project with both contracts (`AuditAnchor`, `AdjudicationAnchor`) and their scripts |
| `blockchain_comp/` | Earlier snapshot of the Hardhat project (`AuditAnchor` only) |
| `backend/`, `frontend/` | Recorded as **Git submodule links** but no `.gitmodules` file exists, so they are **empty after a clone**. The code lives in the `*_comp` folders |
| `*.zip` | Archives of the `*_comp` folders |
| `CAHIER DE CHARGES-…docx`, `ADDENDUM-…md` | Functional specification and the addendum for the newer features (online registration, face and ID checks, joint accounts, customer base) |
| `GUIDE-TEST-INTEGRITE-BLOCKCHAIN.md` | Step-by-step guide to test the audit and auction-result integrity checks |

---

## Getting started

### Everything with Docker (database, API and frontend)

The compose file builds the frontend from a sibling `../frontend` folder. Because that folder is empty in this repository, point it at the snapshot first: in `backend_comp/docker-compose.yml`, change `build: ../frontend` to `build: ../frontend_comp`.

```bash
cd backend_comp
cp .env.example .env        # then fill in the values (see below)
docker compose up --build
```

On first start the database is migrated by Flyway and filled with **demo data**. The API answers on `http://localhost:8080` (check with `curl http://localhost:8080/health`). Demo accounts for each role and the development one-time code are listed in `backend_comp/README.md`.

### Frontend alone (development)

```bash
cd frontend_comp
npm install
npm start                   # ng serve on http://localhost:4200, proxied to the backend
```

### Blockchain anchoring (local network, no account needed)

```bash
cd blockchain
npm install
npx hardhat compile && npx hardhat test
npm run node                # terminal 1: persistent local node
npm run deploy:local        # terminal 2
npm run anchor:local
```

For the public **Sepolia** test network, set an RPC URL and the key of a funded **test** account in `.env`, then run `npm run deploy:sepolia` and `npm run anchor:sepolia`. Each anchor is then publicly verifiable on Etherscan.

### Configuration

Settings come from environment variables (see `backend_comp/.env.example`): database connection, `APP_JWT_SECRET`, token lifetimes, allowed frontend origin, authentication mode (`LOCAL`, `LDAP` or `LDAP_THEN_LOCAL`), SMTP, and the AI provider keys (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`).

> **Before any real deployment:** serve over HTTPS, set a strong unique `APP_JWT_SECRET` and database password, **empty `APP_MFA_DEV_CODE`** (it fixes the one-time code for demos), set `APP_SEED_ON_START=false`, and never commit a `.env` file or a blockchain private key.

---

## Tests

| Part | Command |
|---|---|
| Backend (39 test classes) | `cd backend_comp && mvn test` |
| Frontend (52 spec files) | `cd frontend_comp && npm test` (Vitest), `npm run test:coverage` |
| Smart contracts (both contracts) | `cd blockchain && npx hardhat test` |
| Integrity checks | see [`GUIDE-TEST-INTEGRITE-BLOCKCHAIN.md`](./GUIDE-TEST-INTEGRITE-BLOCKCHAIN.md) |

The backend README also mentions an end-to-end Python script (`test_api.py`); it is not included in this repository.

---

## Author

Bryan Dongmo Djouaka (Walker-237).
