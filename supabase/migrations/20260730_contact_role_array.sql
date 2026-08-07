-- contact_role passe de valeur unique à tableau : un client peut cumuler plusieurs rôles
-- (ex. distributeur ET leader ET membre d'une équipe) au lieu de devoir en choisir un seul.
-- Colonne déjà `text NOT NULL DEFAULT 'customer'` (pas d'enum, pas de contrainte CHECK) —
-- conversion directe, aucune valeur NULL à gérer.

ALTER TABLE public.clients
  ALTER COLUMN contact_role DROP DEFAULT,
  ALTER COLUMN contact_role TYPE text[] USING ARRAY[contact_role]::text[],
  ALTER COLUMN contact_role SET DEFAULT ARRAY['customer']::text[];

NOTIFY pgrst, 'reload schema';
