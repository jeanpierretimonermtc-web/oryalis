-- Le "LRP" (Loyalty Rewards Program) doTERRA — appelé différemment selon le fabricant —
-- n'était représenté que par une seule date (`next_lrp_date`), ni éditable ni suffisante
-- pour représenter : un statut d'inscription (jamais inscrit / actif / en pause / annulé),
-- et un pourcentage de fidélité qui augmente avec l'ancienneté. Phase A + B de la refonte.

-- 1. Statut d'inscription — distingue explicitement "jamais inscrit" de "annulé", ce que
--    l'absence de date ne permettait pas de faire.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS lrp_status text NOT NULL DEFAULT 'not_enrolled',
  ADD COLUMN IF NOT EXISTS lrp_loyalty_percent integer,
  ADD COLUMN IF NOT EXISTS lrp_start_date date;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_lrp_status_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_lrp_status_check CHECK (
  lrp_status IN ('not_enrolled', 'active', 'paused', 'cancelled')
);

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_lrp_loyalty_percent_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_lrp_loyalty_percent_check CHECK (
  lrp_loyalty_percent IS NULL OR (lrp_loyalty_percent >= 0 AND lrp_loyalty_percent <= 100)
);

-- Backfill : un contact qui a déjà une prochaine date programmée était de facto inscrit.
UPDATE public.clients SET lrp_status = 'active' WHERE next_lrp_date IS NOT NULL AND lrp_status = 'not_enrolled';

-- 2. Nom personnalisable du programme (par défaut "LRP" côté app si vide) — même principe
--    que `custom_brand_name`, déjà en place pour la marque.
ALTER TABLE public.user_business_profiles
  ADD COLUMN IF NOT EXISTS custom_lrp_name text;

NOTIFY pgrst, 'reload schema';
