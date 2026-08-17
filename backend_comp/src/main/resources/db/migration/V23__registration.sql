-- ============================================================================
-- Auto-inscription en ligne (ouverture de compte-titres a distance) : dossier
-- reprenable, piece d'identite (+ analyse d'authenticite IA), capture faciale
-- de reference. Cf. addendum "Fonctionnalite 1/2/3/4" au cahier de charges.
-- ============================================================================
CREATE TABLE registration_dossiers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    type_personne           TEXT NOT NULL CHECK (type_personne IN ('PP', 'PM')),
    type_compte             TEXT NOT NULL DEFAULT 'INDIVIDUEL'
        CHECK (type_compte IN ('INDIVIDUEL', 'JOINT')),
    statut                  TEXT NOT NULL DEFAULT 'BROUILLON'
        CHECK (statut IN ('BROUILLON', 'EN_ATTENTE_VERIFICATION', 'VALIDE', 'REJETE')),
    motif_rejet             TEXT,
    convention_version      TEXT,
    convention_acceptee_at  TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registration_dossiers_statut ON registration_dossiers (statut);

-- Pieces d'identite deposees (CNI/passeport/carte de sejour, recto+verso).
-- Contenu encode en base64, meme convention que documents.contenu.
CREATE TABLE registration_pieces (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id                  UUID NOT NULL REFERENCES registration_dossiers (id) ON DELETE CASCADE,
    cote                        TEXT NOT NULL CHECK (cote IN ('RECTO', 'VERSO')),
    type_detecte                TEXT,
    ocr_texte                   TEXT,
    nettete                     DOUBLE PRECISION,
    largeur                     INTEGER,
    hauteur                     INTEGER,
    image_base64                TEXT NOT NULL,
    -- Analyse d'authenticite IA (Claude vision) — indicative, jamais bloquante :
    -- la decision finale revient toujours a l'agent back-office (Fonctionnalite 4).
    authenticite_verdict        TEXT CHECK (authenticite_verdict IN ('AUTHENTIQUE', 'SUSPECT', 'INDETERMINE')),
    authenticite_score          DOUBLE PRECISION,
    authenticite_commentaire    TEXT,
    analysee_le                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registration_pieces_dossier ON registration_pieces (dossier_id);

-- Capture faciale de reference a l'ouverture de compte (vivacite + empreinte).
CREATE TABLE registration_faces (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id              UUID NOT NULL UNIQUE REFERENCES registration_dossiers (id) ON DELETE CASCADE,
    image_base64             TEXT NOT NULL,
    landmarks_json           TEXT NOT NULL,
    liveness_score           DOUBLE PRECISION NOT NULL,
    liveness_passed          BOOLEAN NOT NULL DEFAULT FALSE,
    challenge_type           TEXT NOT NULL DEFAULT 'BLINK',
    width                    INTEGER,
    height                   INTEGER,
    descriptor_json          TEXT,
    verification_status      TEXT NOT NULL DEFAULT 'EN_ATTENTE'
        CHECK (verification_status IN ('EN_ATTENTE', 'VALIDE', 'REJETE')),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
