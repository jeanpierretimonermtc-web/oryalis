-- Lot 1.2 (§16) : annuler une action liée à un ancien résultat sans jamais la supprimer.
-- Ni `followups` ni `recommendations` n'ont aujourd'hui de mécanisme d'annulation distinct
-- de "terminée" (followups.done) ou du statut métier (recommendations.status) — les
-- réutiliser confondrait "annulée" et "terminée", ce que le Lot 1.2 interdit explicitement.
-- On reprend donc exactement le mécanisme déjà en place sur appointments.cancelled_at.
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

NOTIFY pgrst, 'reload schema';
