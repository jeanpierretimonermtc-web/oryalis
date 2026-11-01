-- BRAND-NETWORK-1 — Un réseau par marque.
--   client_brands.sponsor_client_id : parrain du contact DANS cette marque (null = directement sous moi).
--   client_brands.network_role      : 'customer' (feuille) ou 'partner' (a sa propre branche) dans cette marque.
--   upline_nodes.brand_id           : ligne ascendante propre à une marque (null = sans marque).
-- clients.sponsor_id et clients.contact_role ne sont ni modifiés ni supprimés : ils restent
-- utilisés pour les contacts sans marque et pour le CRM (filtres, étapes de parcours).

ALTER TABLE public.client_brands ADD COLUMN IF NOT EXISTS sponsor_client_id uuid;
ALTER TABLE public.client_brands ADD COLUMN IF NOT EXISTS network_role text NOT NULL DEFAULT 'customer';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_brands_network_role_check') THEN
    ALTER TABLE public.client_brands ADD CONSTRAINT client_brands_network_role_check
      CHECK (network_role IN ('customer', 'partner'));
  END IF;
  -- Parrain du même compte ; sa suppression ne remet à null que le parrain (pas user_id).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_brands_sponsor_fkey') THEN
    ALTER TABLE public.client_brands ADD CONSTRAINT client_brands_sponsor_fkey
      FOREIGN KEY (sponsor_client_id, user_id) REFERENCES public.clients(id, user_id)
      ON DELETE SET NULL (sponsor_client_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS client_brands_sponsor_idx ON public.client_brands (brand_id, sponsor_client_id);

-- Parrain valide : pas soi-même, rattaché à la même marque, et jamais de boucle dans la marque.
CREATE OR REPLACE FUNCTION public.check_client_brand_sponsor() RETURNS trigger AS $$
DECLARE
  cursor_id uuid;
  hops int := 0;
BEGIN
  IF NEW.sponsor_client_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.sponsor_client_id = NEW.client_id THEN
    RAISE EXCEPTION 'BRAND_SPONSOR_SELF' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_brands
    WHERE client_id = NEW.sponsor_client_id AND brand_id = NEW.brand_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'BRAND_SPONSOR_NOT_IN_BRAND' USING ERRCODE = '23514';
  END IF;
  cursor_id := NEW.sponsor_client_id;
  WHILE cursor_id IS NOT NULL AND hops < 1000 LOOP
    IF cursor_id = NEW.client_id THEN
      RAISE EXCEPTION 'BRAND_SPONSOR_CYCLE' USING ERRCODE = '23514';
    END IF;
    SELECT sponsor_client_id INTO cursor_id FROM public.client_brands
      WHERE client_id = cursor_id AND brand_id = NEW.brand_id;
    hops := hops + 1;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS client_brands_sponsor_check_trigger ON public.client_brands;
CREATE TRIGGER client_brands_sponsor_check_trigger
  BEFORE INSERT OR UPDATE OF sponsor_client_id, brand_id ON public.client_brands
  FOR EACH ROW EXECUTE FUNCTION public.check_client_brand_sponsor();

-- Retirer la marque d'un parrain : ses filleuls de cette marque remontent directement sous moi.
CREATE OR REPLACE FUNCTION public.release_brand_downline() RETURNS trigger AS $$
BEGIN
  UPDATE public.client_brands
    SET sponsor_client_id = NULL, updated_at = now()
    WHERE brand_id = OLD.brand_id AND sponsor_client_id = OLD.client_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS client_brands_release_downline_trigger ON public.client_brands;
CREATE TRIGGER client_brands_release_downline_trigger
  AFTER DELETE ON public.client_brands
  FOR EACH ROW EXECUTE FUNCTION public.release_brand_downline();

ALTER TABLE public.upline_nodes
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS upline_nodes_brand_idx ON public.upline_nodes (user_id, brand_id, position);

-- Reprise : rôle réseau déduit des rôles CRM actuels ; parrain recopié seulement si le
-- contact et son parrain sont tous deux rattachés à cette même marque (sans ambiguïté).
UPDATE public.client_brands cb
  SET network_role = 'partner'
  FROM public.clients c
  WHERE c.id = cb.client_id
    AND c.contact_role && ARRAY['distributor', 'leader', 'team_member']::text[]
    AND cb.network_role <> 'partner';

UPDATE public.client_brands cb
  SET sponsor_client_id = c.sponsor_id
  FROM public.clients c
  WHERE c.id = cb.client_id
    AND c.sponsor_id IS NOT NULL
    AND cb.sponsor_client_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.client_brands s
      WHERE s.client_id = c.sponsor_id AND s.brand_id = cb.brand_id
    );

NOTIFY pgrst, 'reload schema';
