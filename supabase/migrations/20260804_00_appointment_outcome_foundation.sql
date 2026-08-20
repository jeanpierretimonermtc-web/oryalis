-- Correctif chronologique ciblé (P2.3.3G) — PAS le socle 20260603.
-- appointment_business_context.outcome possède déjà sa création trackée
-- (20260804_appointment_outcome.sql, ADD COLUMN IF NOT EXISTS) : le seul problème est
-- un forward-reference intra-journée démontré empiriquement (P2.3.3F) —
-- 20260804_appointment_closure_guards.sql crée une contrainte CHECK référençant
-- "outcome" avant que la colonne existe, car "closure_guards" trie alphabétiquement
-- avant "outcome".
--
-- Définition confirmée par la DB de production en lecture seule et par
-- 20260804_appointment_outcome.sql lui-même : text, nullable, sans défaut. Aucun autre
-- fichier ne la consomme avant 20260804_appointment_outcome.sql (grep exhaustif) —
-- aucune autre dépendance à anticiper.
--
-- Volontairement absentes : outcome_details / outcome_other_label / outcome_revision
-- (ajoutées plus tard par 20260805_appointment_outcome_lot1_2.sql, déjà correctement
-- trackées) et la contrainte CHECK elle-même (créée par
-- 20260804_appointment_closure_guards.sql, qui reste inchangé et continuera de la
-- créer normalement une fois la colonne présente).

ALTER TABLE public.appointment_business_context
  ADD COLUMN IF NOT EXISTS outcome text;

NOTIFY pgrst, 'reload schema';
