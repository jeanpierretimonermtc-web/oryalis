-- Lot 1.2.1 (suite) : fiabilisation du module commandes.
-- 1) Annulation douce, distincte de "retourné" (status) et de la suppression définitive —
--    même principe déjà appliqué à followups.cancelled_at / recommendations.cancelled_at.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- 2) La décision "première commande du client" doit être figée au moment de la création et
--    relue depuis la ligne existante lors d'un rejeu (idempotence) ou d'une révision — jamais
--    recalculée à partir du nombre de commandes actuel, qui change avec le temps et rendrait
--    la réponse incohérente après coup. NULL pour les commandes existantes (inconnu, jamais
--    rétro-déduit) ; toujours renseignée explicitement pour toute nouvelle commande.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_first_order boolean;

NOTIFY pgrst, 'reload schema';
