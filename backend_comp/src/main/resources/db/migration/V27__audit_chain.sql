-- ============================================================================
-- Chainage cryptographique du journal d'audit (integrite verifiable) : chaque
-- entree porte le hash SHA-256 de l'entree precedente + son propre contenu,
-- exactement le principe d'une blockchain (hash-chaining), sans en avoir le
-- cout — une modification retroactive d'UNE SEULE ligne, meme faite
-- directement en base (hors application), casse la chaine a partir de ce
-- point et devient detectable en recalculant les hashs.
--
-- Ce chainage seul ne protege PAS contre un attaquant qui modifierait une
-- ligne ET recalculerait toute la chaine a partir de la (memes outils, memes
-- fonctions de hash). D'ou l'ancrage periodique du "tip" (derniere entree) sur
-- une blockchain publique (cf. dossier blockchain/, Hardhat) : ce point de
-- controle externe, lui, ne peut pas etre reecrit apres coup.
-- ============================================================================
ALTER TABLE audit_log ADD COLUMN sequence   BIGSERIAL;
ALTER TABLE audit_log ADD COLUMN prev_hash  TEXT;
ALTER TABLE audit_log ADD COLUMN entry_hash TEXT;
CREATE UNIQUE INDEX idx_audit_log_sequence ON audit_log (sequence);

-- Pointeur vers le dernier hash de chaine (evite un scan complet a chaque
-- ecriture) — ligne singleton (id fige a 1).
CREATE TABLE audit_chain_state (
    id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    tip_hash    TEXT NOT NULL,
    entry_count BIGINT NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Hash "genese" (SHA-256 de la chaine vide) — meme convention que les
-- implementations de hash-chaining usuelles (ex. blocs genese de blockchain).
INSERT INTO audit_chain_state (id, tip_hash, entry_count)
VALUES (1, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 0);

-- Historique des ancrages on-chain reussis (ecrit par le script Hardhat, qui
-- se connecte directement a cette base — cf. blockchain/scripts/anchor.js).
CREATE TABLE audit_chain_anchors (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tip_hash          TEXT NOT NULL,
    entry_count       BIGINT NOT NULL,
    tx_hash           TEXT NOT NULL,
    network           TEXT NOT NULL,
    contract_address  TEXT NOT NULL,
    anchored_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_chain_anchors_date ON audit_chain_anchors (anchored_at DESC);
