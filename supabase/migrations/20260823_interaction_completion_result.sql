-- ACTION-OUTCOME-1 / P0 — résultat structuré d'une interaction réalisée.
-- Codes stables (ex. 'answered', 'no_answer', 'sent', 'replied'...) définis côté TypeScript
-- (InteractionOutcomeCode, shared/lib/types.ts) — jamais un libellé traduit stocké ici, jamais
-- un enum Postgres avec CHECK : même convention que interaction_type/interest_level, déjà de
-- simples colonnes text sans contrainte, la liste de valeurs vivant uniquement côté app.
-- Additive, nullable, idempotente : les interactions existantes et déjà terminées restent
-- completion_result = null sans aucun backfill artificiel.
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS completion_result text;

NOTIFY pgrst, 'reload schema';
