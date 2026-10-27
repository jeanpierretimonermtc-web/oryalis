-- LRP-3 — périodicité du programme LRP. Additif uniquement : NULL par défaut pour tous les
-- contacts existants (aucune fréquence supposée, même pour un contact déjà lrp_status='active'
-- — sa véritable cadence est inconnue tant que l'utilisateur ne la renseigne pas).
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS lrp_frequency_value integer,
  ADD COLUMN IF NOT EXISTS lrp_frequency_unit text;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_lrp_frequency_value_check
    CHECK (lrp_frequency_value IS NULL OR lrp_frequency_value > 0);

ALTER TABLE public.clients
  ADD CONSTRAINT clients_lrp_frequency_unit_check
    CHECK (lrp_frequency_unit IS NULL OR lrp_frequency_unit IN ('week', 'month'));

NOTIFY pgrst, 'reload schema';
