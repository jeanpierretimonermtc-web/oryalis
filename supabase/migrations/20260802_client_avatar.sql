-- Photo de contact (Phase 1 — évolution avatar) : réutilise le bucket Storage "avatars"
-- déjà existant (public, policies déjà ouvertes aux utilisateurs authentifiés), avec un
-- préfixe de fichier distinct ("client-<id>.jpg") pour ne pas entrer en collision avec les
-- avatars de profil praticien (stockés en "<user_id>.jpg").

ALTER TABLE clients ADD COLUMN IF NOT EXISTS avatar_url text;
