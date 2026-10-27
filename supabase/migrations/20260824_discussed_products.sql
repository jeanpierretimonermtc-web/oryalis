-- RDV-PRODUCTS-1 / Lot B — liste structurée des produits discutés pendant un RDV, distincte de
-- appointment_notes.products_discussed (texte libre, conservé tel quel comme note qualitative).
-- Sert de base au futur calcul de estimated_value (Lot D) : chaque entrée porte un prix
-- snapshot au moment de l'ajout, jamais relu dynamiquement depuis catalog_products (une
-- modification future du catalogue ne doit jamais changer rétroactivement un ancien RDV).
-- Additive, idempotente.
ALTER TABLE public.appointment_business_context
  ADD COLUMN IF NOT EXISTS discussed_products jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';
