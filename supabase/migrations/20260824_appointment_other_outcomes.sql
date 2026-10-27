-- "Autres retombées" — tags secondaires optionnels sur le résultat d'un RDV (ex. une vente
-- réalisée peut s'accompagner d'un partenaire potentiel identifié). Reste distinct du résultat
-- principal `outcome` (qui seul pilote la logique de suite obligatoire/plan d'actions) : simple
-- liste informative, jamais son propre formulaire de détails, jamais suivie par la révision
-- (revise_appointment_outcome) ni par client_events — persistée via un UPDATE ordinaire de
-- appointment_business_context, comme pipeline_stage/commercial_intent.
-- Même convention que `outcome` (texte, validation côté TypeScript uniquement, pas de CHECK en
-- base) plutôt qu'un enum Postgres comme commercial_intent_enum — cohérent avec
-- 20260804_appointment_outcome.sql.
ALTER TABLE public.appointment_business_context
  ADD COLUMN IF NOT EXISTS other_outcomes text[] NOT NULL DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
