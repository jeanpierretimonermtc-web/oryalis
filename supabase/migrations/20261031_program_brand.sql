-- PROGRAM-BRAND-1 — Programmes de fidélité par marque.
--   recurring_programs.brand_id        : marque du programme (un contact multi-marques peut avoir
--                                        un abonnement Zinzino ET un LRP doTERRA).
--   recurring_programs.loyalty_percent : % de fidélité, propre à chaque programme / marque.
--   recurring_programs.notes           : notes du programme.
--   brands.program_name                : nom du programme de cette marque ("LRP", "Abonnement"),
--                                        remplace le nom unique du compte quand il est renseigné.
-- Les anciennes colonnes clients.lrp_loyalty_percent / loyalty_notes / doterra_id ne sont ni
-- modifiées ni supprimées (recopiées seulement quand le rattachement est sans ambiguïté).

ALTER TABLE public.recurring_programs
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.brands(id) ON DELETE SET NULL;
ALTER TABLE public.recurring_programs
  ADD COLUMN IF NOT EXISTS loyalty_percent integer;
ALTER TABLE public.recurring_programs
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_loyalty_percent_check;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_loyalty_percent_check
  CHECK (loyalty_percent IS NULL OR (loyalty_percent BETWEEN 0 AND 100));

CREATE INDEX IF NOT EXISTS recurring_programs_brand_idx ON public.recurring_programs (brand_id);

ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS program_name text;

-- La marque d'un programme appartient toujours au même utilisateur que le programme.
CREATE OR REPLACE FUNCTION public.check_program_brand_ownership() RETURNS trigger AS $$
BEGIN
  IF NEW.brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brands b WHERE b.id = NEW.brand_id AND b.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'recurring_programs.brand_id must reference a brand owned by the same user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS recurring_programs_brand_ownership_trigger ON public.recurring_programs;
CREATE TRIGGER recurring_programs_brand_ownership_trigger
  BEFORE INSERT OR UPDATE OF brand_id, user_id ON public.recurring_programs
  FOR EACH ROW EXECUTE FUNCTION public.check_program_brand_ownership();

-- ── Rattachement automatique d'un programme à sa marque (jamais écrasé s'il est déjà choisi) ──
-- 1) marque majoritaire des produits de ses commandes (égalité → indécis, laissé vide) ;
-- 2) sinon, la marque unique du contact s'il n'en a qu'une.
CREATE OR REPLACE FUNCTION public.assign_program_brand(p_program_id uuid) RETURNS void AS $$
DECLARE
  v_prog record;
  v_brand uuid;
  v_top int;
  v_second int;
BEGIN
  SELECT id, user_id, client_id, brand_id INTO v_prog FROM public.recurring_programs WHERE id = p_program_id;
  IF NOT FOUND OR v_prog.brand_id IS NOT NULL THEN RETURN; END IF;

  WITH counts AS (
    SELECT b.id AS brand_id, count(*) AS n
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    JOIN public.catalog_products cp ON cp.id = oi.catalog_product_id
    JOIN public.brands b ON b.user_id = v_prog.user_id AND b.catalog_id = cp.catalog_id
    WHERE o.recurring_program_id = p_program_id
    GROUP BY b.id
    ORDER BY n DESC
  )
  SELECT (SELECT brand_id FROM counts LIMIT 1),
         (SELECT n FROM counts LIMIT 1),
         (SELECT n FROM counts OFFSET 1 LIMIT 1)
    INTO v_brand, v_top, v_second;
  IF v_brand IS NOT NULL AND v_second IS NOT NULL AND v_second = v_top THEN v_brand := NULL; END IF;

  IF v_brand IS NULL THEN
    SELECT CASE WHEN count(*) = 1 THEN min(cb.brand_id::text)::uuid END INTO v_brand
      FROM public.client_brands cb WHERE cb.client_id = v_prog.client_id;
  END IF;

  IF v_brand IS NOT NULL THEN
    UPDATE public.recurring_programs SET brand_id = v_brand, updated_at = now() WHERE id = p_program_id AND brand_id IS NULL;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.assign_program_brand(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.trg_assign_program_brand_from_program() RETURNS trigger AS $$
BEGIN
  BEGIN
    PERFORM public.assign_program_brand(NEW.id);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'assign_program_brand(program) %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS assign_program_brand_on_program_trigger ON public.recurring_programs;
CREATE TRIGGER assign_program_brand_on_program_trigger
  AFTER INSERT ON public.recurring_programs
  FOR EACH ROW WHEN (NEW.brand_id IS NULL)
  EXECUTE FUNCTION public.trg_assign_program_brand_from_program();

CREATE OR REPLACE FUNCTION public.trg_assign_program_brand_from_order() RETURNS trigger AS $$
BEGIN
  BEGIN
    PERFORM public.assign_program_brand(NEW.recurring_program_id);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'assign_program_brand(order) %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS assign_program_brand_on_order_trigger ON public.orders;
CREATE TRIGGER assign_program_brand_on_order_trigger
  AFTER INSERT OR UPDATE OF recurring_program_id ON public.orders
  FOR EACH ROW WHEN (NEW.recurring_program_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_assign_program_brand_from_order();

-- ── Reprise de l'existant ─────────────────────────────────────────────────────────────────
SELECT public.assign_program_brand(rp.id) FROM public.recurring_programs rp WHERE rp.brand_id IS NULL;

-- % et notes : recopiés sur le programme uniquement quand le contact n'en a qu'un.
UPDATE public.recurring_programs rp
SET loyalty_percent = COALESCE(rp.loyalty_percent, c.lrp_loyalty_percent),
    notes = COALESCE(rp.notes, c.loyalty_notes),
    updated_at = now()
FROM public.clients c
WHERE c.id = rp.client_id
  AND (c.lrp_loyalty_percent IS NOT NULL OR c.loyalty_notes IS NOT NULL)
  AND (SELECT count(*) FROM public.recurring_programs x WHERE x.client_id = c.id) = 1;

-- Ancien numéro identifiant : recopié comme N° membre quand le contact n'a qu'une marque.
UPDATE public.client_brands cb
SET member_number = c.doterra_id, updated_at = now()
FROM public.clients c
WHERE c.id = cb.client_id
  AND c.doterra_id IS NOT NULL
  AND cb.member_number IS NULL
  AND (SELECT count(*) FROM public.client_brands x WHERE x.client_id = c.id) = 1;

NOTIFY pgrst, 'reload schema';
