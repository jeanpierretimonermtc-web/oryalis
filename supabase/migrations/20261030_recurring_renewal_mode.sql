-- AUTO-RENEWAL-1 — Mode de renouvellement d'un abonnement (programme récurrent).
--   manual       : "Je gère" — comportement historique : l'échéance passe "à confirmer" et le
--                  rappelle jusqu'à confirmation/non réalisée.
--   company_auto : "Automatique (l'entreprise)" — le client a commandé depuis son propre compte,
--                  l'entreprise renvoie seule : à la date prévue, Oryalis confirme l'échéance et
--                  recopie la dernière commande du programme (montant/produits), sans rappel.
-- Tous les programmes existants restent 'manual' : aucun changement de comportement sans action.
-- Purement additive.

ALTER TABLE public.recurring_programs
  ADD COLUMN IF NOT EXISTS renewal_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_renewal_mode_check;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_renewal_mode_check
  CHECK (renewal_mode IN ('manual', 'company_auto'));

-- Mode automatique uniquement : relance "prendre des nouvelles" 3 jours avant le renouvellement.
ALTER TABLE public.recurring_programs
  ADD COLUMN IF NOT EXISTS checkin_before_renewal boolean NOT NULL DEFAULT false;

-- Échéance confirmée par Oryalis lui-même (mode automatique), jamais par un clic : permet
-- d'afficher "Renouvelé automatiquement" et de proposer "Ce renouvellement n'a pas eu lieu".
ALTER TABLE public.recurring_program_occurrences
  ADD COLUMN IF NOT EXISTS auto_confirmed boolean NOT NULL DEFAULT false;

-- Commande recopiée automatiquement lors d'un renouvellement : seule commande que "Ce
-- renouvellement n'a pas eu lieu" a le droit de supprimer.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS auto_renewal boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS recurring_programs_auto_due_idx
  ON public.recurring_programs (user_id, next_occurrence_date)
  WHERE renewal_mode = 'company_auto' AND status = 'active';

NOTIFY pgrst, 'reload schema';
