-- ACTION-OUTCOME-1 / P2 — retour qualitatif du client sur une recommandation, distinct du
-- statut (advised/ordered/purchased/received/completed) et distinct de `reason`/`objective`
-- (qui décrivent pourquoi le produit a été conseillé, pas ce qui s'est passé après). Aucun
-- champ équivalent n'existe déjà sur `recommendations` (vérifié dans shared/lib/types.ts :
-- id, client_id, user_id, product_name, reason, status, catalog_id, product_id, quantity,
-- objective, recommendation_date, appointment_id, cancelled_at, closure_action_key,
-- created_at, updated_at — aucun champ notes/feedback/comment/result/outcome).
-- Texte libre, sans CHECK, même convention que interactions.notes_brutes/completion_result.
-- Additive, nullable : toutes les recommandations existantes restent client_feedback = null
-- sans backfill artificiel.
ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS client_feedback text;

NOTIFY pgrst, 'reload schema';
