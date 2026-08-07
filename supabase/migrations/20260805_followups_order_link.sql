-- Lot 1.2.1 (suite) : lien relance → commande source, pour que la suppression d'une commande
-- supprime ses relances automatiques (réception, retours, nouvelle commande) plutôt que de
-- les laisser orphelines. ON DELETE CASCADE : garantit ce nettoyage même via un accès direct
-- à la base, pas seulement depuis l'application.
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_followups_order_id ON public.followups (order_id);

NOTIFY pgrst, 'reload schema';
