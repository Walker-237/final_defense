-- ============================================================================
-- Correspondance visage <-> piece d'identite : le "taux de fiabilite" affiche
-- au back-office est la confiance de l'IA que le visage capture en direct
-- (selfie, avec controle de vivacite) et le visage imprime sur la piece
-- deposee appartiennent a la meme personne. Indicatif, jamais bloquant : la
-- decision finale reste celle de l'agent (meme principe que l'authenticite
-- du document, cf. V23__registration.sql).
-- ============================================================================
ALTER TABLE registration_faces
    ADD COLUMN face_match_verdict     TEXT
        CHECK (face_match_verdict IN ('CORRESPOND', 'NE_CORRESPOND_PAS', 'INDETERMINE')),
    ADD COLUMN face_match_score       DOUBLE PRECISION,
    ADD COLUMN face_match_commentaire TEXT,
    ADD COLUMN face_match_le          TIMESTAMPTZ;
