-- Lot 1 (refonte parcours RDV) : "Résultat" du rendez-vous — verdict de clôture, distinct
-- du statut logistique (planifié/complété/absent/reporté) et de l'étape pipeline (qui, elle,
-- reste une donnée en continu au niveau du contact). Validation des valeurs côté TypeScript
-- (AppointmentOutcome), pas de contrainte CHECK en base — même approche que pipeline_stage
-- et prospect_temperature déjà en place sur cette table.
ALTER TABLE public.appointment_business_context
  ADD COLUMN IF NOT EXISTS outcome text;

NOTIFY pgrst, 'reload schema';
