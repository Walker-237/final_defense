-- ============================================================================
-- Defi de vivacite a actions aleatoires (remplace le controle "clignement
-- unique" contournable par une video preenregistree). Le serveur tire la
-- sequence, mesure le rythme et la continuite ; le navigateur ne rend jamais
-- de verdict — cf. cm.afriland.titres.liveness.LivenessChallengeService.
--
-- Les series de mesures (angles de pose, ratios) transmises a la verification
-- ne sont PAS persistees : seuls le verdict, les horodatages et un motif
-- d'echec (usage interne, jamais renvoye au client) sont conserves.
-- ============================================================================
CREATE TABLE liveness_challenges (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    contexte_type   TEXT NOT NULL CHECK (contexte_type IN ('INSCRIPTION', 'ORDRE', 'CO_SIGNATURE')),
    -- Reference libre vers l'operation concernee (dossier, ordre, demande de
    -- signature) — pas de FK unique possible, la cible varie selon le contexte.
    contexte_ref    UUID,
    -- Actions tirees, dans l'ordre, ex. ["TURN_LEFT","MOUTH_OPEN"].
    actions         TEXT NOT NULL,
    statut          TEXT NOT NULL DEFAULT 'EN_ATTENTE'
        CHECK (statut IN ('EN_ATTENTE', 'REUSSI', 'ECHOUE', 'EXPIRE')),
    tentatives      INTEGER NOT NULL DEFAULT 0,
    -- Motif d'echec detaille : USAGE INTERNE / BACK-OFFICE UNIQUEMENT. Ne
    -- jamais renvoyer ce champ dans une reponse HTTP (cf. regle d'architecture).
    motif_echec     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    verified_at     TIMESTAMPTZ,
    -- Chemin de repli accessibilite : apres 2 echecs, l'utilisateur peut demander
    -- une revue humaine plutot que de continuer a se heurter au seuil automatique.
    revue_demandee  BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX idx_liveness_challenges_user ON liveness_challenges (user_id, created_at DESC);

-- Blocage apres 3 echecs consecutifs (15 minutes) — meme principe que
-- users.failed_login_attempts / locked_until, mais distinct : un compte peut
-- etre bloque en vivacite sans etre bloque en connexion, et reciproquement.
CREATE TABLE liveness_lockouts (
    user_id             UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    echecs_consecutifs  INTEGER NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
