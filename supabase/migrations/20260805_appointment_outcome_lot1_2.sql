-- Lot 1.2 : détails conditionnels du résultat + liens minimaux RDV source → actions créées
-- depuis sa clôture. Toutes les colonnes sont nullable / additives — aucune donnée
-- historique modifiée. La contrainte CHECK existante sur outcome (migration
-- 20260804_appointment_closure_guards) continue d'autoriser 'follow_up_required' —
-- non touchée ici, cette valeur reste lisible sur l'historique, seulement retirée des choix
-- actifs côté application (UI), pas de la base.

-- 1) Détails conditionnels du résultat + révision
ALTER TABLE public.appointment_business_context
  ADD COLUMN IF NOT EXISTS outcome_details jsonb,
  ADD COLUMN IF NOT EXISTS outcome_other_label text,
  ADD COLUMN IF NOT EXISTS outcome_revision integer NOT NULL DEFAULT 1;

-- 2) Relances — lien vers le RDV source + origine de règle automatique
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS automation_rule_id text;

CREATE INDEX IF NOT EXISTS idx_followups_appointment_id ON public.followups (appointment_id);

-- 3) Commandes — lien vers le RDV source (aucune commande existante modifiée)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_appointment_id ON public.orders (appointment_id);

-- 4) Recommandations — lien vers le RDV source
ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recommendations_appointment_id ON public.recommendations (appointment_id);

-- 5) Rendez-vous — lien "ce RDV est la suite de tel autre RDV" (jamais déduit par date/titre)
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS followup_of_appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_followup_of ON public.appointments (followup_of_appointment_id);

NOTIFY pgrst, 'reload schema';
