-- BRANDS-1 — Marques de l'utilisateur et marques de chaque contact.
--
-- Saisie libre (aucune liste fermée), mais sans doublon : `normalized_name` (minuscules, sans
-- accents, sans espaces ni ponctuation) est GÉNÉRÉ en base et unique par utilisateur — "Zinzino",
-- "zinzino" et "Zin Zino" sont la même marque. La détection des fautes proches ("Zinzinno") et
-- les suggestions sont faites côté app (features/brands/brandMatching.ts) avant création.
--
-- Une marque peut être liée à un catalogue (doTERRA, Zinzino, catalogue personnel) ou non.
-- Les marques d'un contact s'ajoutent à la main ou automatiquement (triggers ci-dessous) depuis
-- une commande, une recommandation ou le contexte commercial d'un RDV.
--
-- Purement additive : aucune donnée existante n'est modifiée (clients.doterra_id inchangé).

CREATE OR REPLACE FUNCTION public.normalize_brand_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    lower(translate(coalesce(p, ''),
      'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
      'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
    '[^a-z0-9]', '', 'g')
$$;

-- ── Marques de l'utilisateur ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brands (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  normalized_name  text GENERATED ALWAYS AS (public.normalize_brand_name(name)) STORED,
  -- NULL = couleur dérivée du nom côté app (stable, jamais aléatoire).
  color            text,
  -- Image importée par l'utilisateur (bucket "avatars", dossier brand-logos/), usage privé.
  logo_url         text,
  catalog_id       uuid REFERENCES public.catalogs(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.brands DROP CONSTRAINT IF EXISTS brands_name_check;
ALTER TABLE public.brands ADD CONSTRAINT brands_name_check
  CHECK (length(btrim(name)) BETWEEN 1 AND 80 AND length(normalize_brand_name(name)) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS brands_user_normalized_uidx ON public.brands (user_id, normalized_name);
CREATE INDEX IF NOT EXISTS brands_user_catalog_idx ON public.brands (user_id, catalog_id);

-- Garantie (user_id, id) pour la FK composite de client_brands. Ajout conditionnel (jamais
-- DROP + ADD : la FK de client_brands en dépend lors d'une réexécution).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'brands_id_user_id_key') THEN
    ALTER TABLE public.brands ADD CONSTRAINT brands_id_user_id_key UNIQUE (id, user_id);
  END IF;
END $$;

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brands_user_policy ON public.brands;
CREATE POLICY brands_user_policy ON public.brands
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Marques d'un contact ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_brands (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  client_id      uuid NOT NULL,
  brand_id       uuid NOT NULL,
  -- Origine du lien : affichée sur la fiche ("via commande du 12/10").
  source         text NOT NULL DEFAULT 'manual',
  source_at      timestamptz,
  -- Numéro de membre du contact chez cette marque (ex. "N° Zinzino", "ID doTERRA").
  member_number  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_brands DROP CONSTRAINT IF EXISTS client_brands_source_check;
ALTER TABLE public.client_brands ADD CONSTRAINT client_brands_source_check
  CHECK (source IN ('manual', 'order', 'recommendation', 'appointment'));

-- Contact et marque appartiennent obligatoirement au même utilisateur (FK composites).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_brands_client_fkey') THEN
    ALTER TABLE public.client_brands ADD CONSTRAINT client_brands_client_fkey
      FOREIGN KEY (client_id, user_id) REFERENCES public.clients(id, user_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_brands_brand_fkey') THEN
    ALTER TABLE public.client_brands ADD CONSTRAINT client_brands_brand_fkey
      FOREIGN KEY (brand_id, user_id) REFERENCES public.brands(id, user_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS client_brands_client_brand_uidx ON public.client_brands (client_id, brand_id);
CREATE INDEX IF NOT EXISTS client_brands_user_brand_idx ON public.client_brands (user_id, brand_id);

ALTER TABLE public.client_brands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_brands_user_policy ON public.client_brands;
CREATE POLICY client_brands_user_policy ON public.client_brands
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Liaison automatique depuis un catalogue ─────────────────────────────────────────────────
-- Trouve (ou crée) la marque de l'utilisateur correspondant au catalogue, puis rattache le
-- contact. SECURITY DEFINER : vérifie elle-même que le contact appartient à p_user_id et que le
-- catalogue lui est accessible (officiel ou personnel), jamais d'écriture pour un autre compte.
CREATE OR REPLACE FUNCTION public.ensure_client_brand_from_catalog(
  p_user_id uuid, p_client_id uuid, p_catalog_id uuid, p_source text, p_at timestamptz
) RETURNS void AS $$
DECLARE
  v_brand_id uuid;
  v_catalog_name text;
BEGIN
  IF p_user_id IS NULL OR p_client_id IS NULL OR p_catalog_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = p_client_id AND user_id = p_user_id) THEN RETURN; END IF;

  SELECT id INTO v_brand_id FROM public.brands WHERE user_id = p_user_id AND catalog_id = p_catalog_id LIMIT 1;
  IF v_brand_id IS NULL THEN
    SELECT name INTO v_catalog_name FROM public.catalogs
      WHERE id = p_catalog_id AND (type = 'official' OR user_id = p_user_id);
    IF v_catalog_name IS NULL OR length(public.normalize_brand_name(v_catalog_name)) = 0 THEN RETURN; END IF;
    INSERT INTO public.brands (user_id, name, catalog_id)
      VALUES (p_user_id, v_catalog_name, p_catalog_id)
      ON CONFLICT (user_id, normalized_name)
      DO UPDATE SET catalog_id = COALESCE(public.brands.catalog_id, EXCLUDED.catalog_id), updated_at = now()
      RETURNING id INTO v_brand_id;
  END IF;

  INSERT INTO public.client_brands (user_id, client_id, brand_id, source, source_at)
    VALUES (p_user_id, p_client_id, v_brand_id, p_source, p_at)
    ON CONFLICT (client_id, brand_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.ensure_client_brand_from_catalog(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC;

-- Les triggers ne bloquent JAMAIS l'écriture d'origine (commande, recommandation, RDV) : toute
-- erreur de rattachement est réduite à un avertissement.
CREATE OR REPLACE FUNCTION public.trg_client_brand_from_order() RETURNS trigger AS $$
BEGIN
  BEGIN
    PERFORM public.ensure_client_brand_from_catalog(NEW.user_id, NEW.client_id, NEW.catalog_id, 'order', NEW.order_date::timestamptz);
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'client_brand(order) %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS client_brand_from_order_trigger ON public.orders;
CREATE TRIGGER client_brand_from_order_trigger
  AFTER INSERT OR UPDATE OF catalog_id ON public.orders
  FOR EACH ROW WHEN (NEW.catalog_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_client_brand_from_order();

CREATE OR REPLACE FUNCTION public.trg_client_brand_from_order_item() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  BEGIN
    SELECT o.user_id, o.client_id, o.order_date, cp.catalog_id INTO r
      FROM public.orders o JOIN public.catalog_products cp ON cp.id = NEW.catalog_product_id
      WHERE o.id = NEW.order_id;
    IF FOUND THEN
      PERFORM public.ensure_client_brand_from_catalog(r.user_id, r.client_id, r.catalog_id, 'order', r.order_date::timestamptz);
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'client_brand(order_item) %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS client_brand_from_order_item_trigger ON public.order_items;
CREATE TRIGGER client_brand_from_order_item_trigger
  AFTER INSERT OR UPDATE OF catalog_product_id ON public.order_items
  FOR EACH ROW WHEN (NEW.catalog_product_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_client_brand_from_order_item();

CREATE OR REPLACE FUNCTION public.trg_client_brand_from_recommendation() RETURNS trigger AS $$
BEGIN
  BEGIN
    PERFORM public.ensure_client_brand_from_catalog(NEW.user_id, NEW.client_id, NEW.catalog_id, 'recommendation', now());
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'client_brand(recommendation) %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS client_brand_from_recommendation_trigger ON public.recommendations;
CREATE TRIGGER client_brand_from_recommendation_trigger
  AFTER INSERT OR UPDATE OF catalog_id ON public.recommendations
  FOR EACH ROW WHEN (NEW.catalog_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_client_brand_from_recommendation();

CREATE OR REPLACE FUNCTION public.trg_client_brand_from_appointment_context() RETURNS trigger AS $$
DECLARE r record;
BEGIN
  BEGIN
    SELECT a.user_id, a.client_id, a.start_at INTO r FROM public.appointments a WHERE a.id = NEW.appointment_id;
    IF FOUND THEN
      PERFORM public.ensure_client_brand_from_catalog(r.user_id, r.client_id, COALESCE(NEW.brand_id, NEW.catalog_id), 'appointment', r.start_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'client_brand(appointment) %', SQLERRM;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS client_brand_from_appointment_context_trigger ON public.appointment_business_context;
CREATE TRIGGER client_brand_from_appointment_context_trigger
  AFTER INSERT OR UPDATE OF brand_id, catalog_id ON public.appointment_business_context
  FOR EACH ROW WHEN (NEW.brand_id IS NOT NULL OR NEW.catalog_id IS NOT NULL)
  EXECUTE FUNCTION public.trg_client_brand_from_appointment_context();

-- ── Reprise de l'existant (idempotente) ─────────────────────────────────────────────────────
-- 1) Marque principale déclarée dans "Ma marque".
INSERT INTO public.brands (user_id, name, catalog_id)
SELECT p.user_id,
       CASE p.activity_type WHEN 'doterra' THEN 'doTERRA' WHEN 'zinzino' THEN 'Zinzino'
                            WHEN 'herbalife' THEN 'Herbalife' ELSE btrim(p.custom_brand_name) END,
       (SELECT c.id FROM public.catalogs c WHERE c.type = 'official' AND c.slug = p.activity_type LIMIT 1)
FROM public.user_business_profiles p
WHERE p.activity_type IN ('doterra', 'zinzino', 'herbalife')
   OR (p.activity_type = 'custom' AND length(public.normalize_brand_name(p.custom_brand_name)) > 0)
ON CONFLICT (user_id, normalized_name) DO NOTHING;

-- 2) Marques des contacts d'après l'historique.
SELECT public.ensure_client_brand_from_catalog(o.user_id, o.client_id, o.catalog_id, 'order', o.order_date::timestamptz)
  FROM public.orders o WHERE o.catalog_id IS NOT NULL;
SELECT public.ensure_client_brand_from_catalog(o.user_id, o.client_id, cp.catalog_id, 'order', o.order_date::timestamptz)
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.catalog_products cp ON cp.id = oi.catalog_product_id;
SELECT public.ensure_client_brand_from_catalog(r.user_id, r.client_id, r.catalog_id, 'recommendation', r.created_at)
  FROM public.recommendations r WHERE r.catalog_id IS NOT NULL;
SELECT public.ensure_client_brand_from_catalog(a.user_id, a.client_id, COALESCE(x.brand_id, x.catalog_id), 'appointment', a.start_at)
  FROM public.appointment_business_context x
  JOIN public.appointments a ON a.id = x.appointment_id
  WHERE x.brand_id IS NOT NULL OR x.catalog_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
