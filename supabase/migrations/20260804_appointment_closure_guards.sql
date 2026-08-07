-- Lot 1.1 : sécurisation de la clôture des RDV.
-- 1) "Aucune suite nécessaire" doit être une décision explicite et persistée, distincte
--    d'un simple oubli — jamais activée automatiquement, jamais vraie par défaut sur
--    l'historique (compatibilité : tous les RDV passés restent à false, pas "incomplets").
ALTER TABLE public.appointment_business_context
  ADD COLUMN IF NOT EXISTS no_followup_required boolean NOT NULL DEFAULT false;

-- 2) Contrainte sur les valeurs autorisées de outcome — NULL reste accepté (historique et
--    RDV non encore clôturés). Ajoutée seulement si absente (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'appointment_business_context'
      AND constraint_name = 'appointment_business_context_outcome_check'
  ) THEN
    ALTER TABLE public.appointment_business_context
      ADD CONSTRAINT appointment_business_context_outcome_check
      CHECK (
        outcome IS NULL OR outcome IN (
          'sale_completed',
          'interested',
          'follow_up_required',
          'not_interested',
          'partner_potential',
          'partner_recruited',
          'other'
        )
      );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
