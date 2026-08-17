-- ============================================================================
-- Controle facial d'un ordre de souscription (addendum, Fonctionnalite 5) :
-- apres soumission (l'ordre est deja enregistre), le client peut etre invite a
-- reprendre une photo ; elle est comparee par le SERVEUR au visage de reference
-- capture a l'ouverture du compte (registration_faces). Indicatif, jamais
-- bloquant — meme principe que registration_pieces.authenticite_* et
-- registration_faces.face_match_* (cf. V23/V24).
-- ============================================================================
CREATE TABLE order_face_checks (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id               UUID NOT NULL UNIQUE REFERENCES orders (id) ON DELETE CASCADE,
    image_base64           TEXT NOT NULL,
    liveness_score         DOUBLE PRECISION,
    challenge_type         TEXT,
    descriptor_json        TEXT,
    match_status           TEXT NOT NULL DEFAULT 'NON_COMPARABLE'
        CHECK (match_status IN ('CORRESPOND', 'DIFFERENT', 'NON_COMPARABLE')),
    -- "Taux de fiabilite" : confiance de l'IA que la photo prise au moment de
    -- l'ordre et le visage de reference (ouverture de compte) montrent la
    -- meme personne.
    taux_fiabilite         DOUBLE PRECISION,
    commentaire            TEXT,
    verification_status    TEXT NOT NULL DEFAULT 'EN_ATTENTE'
        CHECK (verification_status IN ('EN_ATTENTE', 'VALIDE', 'REJETE')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
