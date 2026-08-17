-- ============================================================================
-- Messagerie en direct client <-> back-office (discussion temps reel).
-- Un client dispose d'un fil de discussion persistant unique ; le premier
-- membre du back-office qui repond devient l'agent assigne (auto-affectation).
-- ============================================================================
CREATE TABLE chat_conversations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    agent_id            UUID REFERENCES users (id),
    statut              TEXT NOT NULL DEFAULT 'OUVERTE'
        CHECK (statut IN ('OUVERTE', 'FERMEE')),
    client_dernier_lu   TIMESTAMPTZ,
    agent_dernier_lu    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_conversations_agent ON chat_conversations (agent_id, statut);

CREATE TABLE chat_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id     UUID NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
    sender_id           UUID NOT NULL REFERENCES users (id),
    sender_role         TEXT NOT NULL,
    contenu             TEXT NOT NULL CHECK (char_length(contenu) <= 4000),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_conversation ON chat_messages (conversation_id, created_at);
