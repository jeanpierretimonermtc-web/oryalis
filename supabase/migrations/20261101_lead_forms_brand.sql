-- LEAD-PAGE-2 — Pages prospect par marque.
--   lead_forms.brand_id : page d'une marque (null = page générale). Au plus une page générale et
--   une page par marque et par utilisateur.
--   Un prospect inscrit via la page d'une marque est rattaché à cette marque (client_brands,
--   source 'lead_page'). Sur la page générale, c'est le choix "Ma marque" des Paramètres
--   (user_business_profiles.activity_type) qui décide : une marque unique (doterra, zinzino,
--   herbalife, custom) → le prospect y est rattaché (marque créée si besoin) ; 'multi' ou
--   'generic' → sans marque.

ALTER TABLE public.lead_forms ADD COLUMN IF NOT EXISTS brand_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_forms_brand_fkey') THEN
    ALTER TABLE public.lead_forms ADD CONSTRAINT lead_forms_brand_fkey
      FOREIGN KEY (brand_id, user_id) REFERENCES public.brands(id, user_id) ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE public.lead_forms DROP CONSTRAINT IF EXISTS lead_forms_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS lead_forms_user_general_uidx ON public.lead_forms (user_id) WHERE brand_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lead_forms_user_brand_uidx ON public.lead_forms (user_id, brand_id) WHERE brand_id IS NOT NULL;

ALTER TABLE public.client_brands DROP CONSTRAINT IF EXISTS client_brands_source_check;
ALTER TABLE public.client_brands ADD CONSTRAINT client_brands_source_check
  CHECK (source IN ('manual', 'order', 'recommendation', 'appointment', 'lead_page'));

-- La page publique affiche aussi le nom de la marque (type de retour modifié : DROP puis CREATE).
DROP FUNCTION IF EXISTS public.get_public_lead_form(text);
CREATE FUNCTION public.get_public_lead_form(p_slug text)
RETURNS TABLE (title text, intro text, advisor_name text, brand_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.title, f.intro, split_part(coalesce(p.full_name, ''), ' ', 1), b.name
  FROM public.lead_forms f
  LEFT JOIN public.profiles p ON p.id = f.user_id
  LEFT JOIN public.brands b ON b.id = f.brand_id
  WHERE f.slug = lower(trim(p_slug)) AND f.active
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.get_public_lead_form(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_lead_form(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_public_lead(
  p_slug text, p_full_name text, p_email text, p_phone text, p_message text, p_consent boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_form public.lead_forms%ROWTYPE;
  v_name text := left(trim(coalesce(p_full_name, '')), 120);
  v_email text := nullif(lower(left(trim(coalesce(p_email, '')), 200)), '');
  v_phone text := nullif(left(trim(coalesce(p_phone, '')), 40), '');
  v_message text := nullif(left(trim(coalesce(p_message, '')), 2000), '');
  v_submission uuid;
  v_client uuid;
  v_brand uuid;
  v_brand_name text;
  v_activity text;
  v_custom text;
  v_single_name text;
BEGIN
  SELECT * INTO v_form FROM public.lead_forms WHERE slug = lower(trim(p_slug)) AND active;
  IF v_form.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAD_FORM_NOT_FOUND';
  END IF;
  IF char_length(v_name) < 2 OR (v_email IS NULL AND v_phone IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAD_INVALID';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAD_INVALID_EMAIL';
  END IF;

  IF (SELECT count(*) FROM public.lead_submissions WHERE form_id = v_form.id AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'LEAD_RATE_LIMIT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.lead_submissions
    WHERE form_id = v_form.id AND created_at > now() - interval '1 day'
      AND ((v_email IS NOT NULL AND email = v_email) OR (v_phone IS NOT NULL AND phone = v_phone))
  ) THEN
    RETURN 'ok';
  END IF;

  INSERT INTO public.lead_submissions (form_id, user_id, full_name, email, phone, message, consent)
  VALUES (v_form.id, v_form.user_id, v_name, v_email, v_phone, v_message, coalesce(p_consent, false))
  RETURNING id INTO v_submission;

  BEGIN
    -- Marque du prospect : celle de la page ; page générale → marque unique choisie dans
    -- "Ma marque" (créée si elle n'existe pas encore), jamais en mode multi-marques/générique.
    v_brand := v_form.brand_id;
    IF v_brand IS NULL THEN
      SELECT activity_type, custom_brand_name INTO v_activity, v_custom
        FROM public.user_business_profiles WHERE user_id = v_form.user_id;
      v_single_name := CASE v_activity
        WHEN 'doterra' THEN 'doTERRA'
        WHEN 'zinzino' THEN 'Zinzino'
        WHEN 'herbalife' THEN 'Herbalife'
        WHEN 'custom' THEN nullif(trim(coalesce(v_custom, '')), '')
        ELSE NULL END;
      IF v_single_name IS NOT NULL THEN
        SELECT id INTO v_brand FROM public.brands
          WHERE user_id = v_form.user_id AND normalized_name = public.normalize_brand_name(v_single_name);
        IF v_brand IS NULL THEN
          INSERT INTO public.brands (user_id, name) VALUES (v_form.user_id, v_single_name) RETURNING id INTO v_brand;
        END IF;
      END IF;
    END IF;
    IF v_brand IS NOT NULL THEN
      SELECT name INTO v_brand_name FROM public.brands WHERE id = v_brand;
    END IF;

    INSERT INTO public.clients (user_id, full_name, first_name, email, phone, source, contact_role, pipeline_stage, inscription_date, tracking_consent_at)
    VALUES (
      v_form.user_id, v_name,
      CASE WHEN position(' ' IN v_name) > 0 THEN split_part(v_name, ' ', 1) ELSE NULL END,
      v_email, v_phone, 'Page prospect', ARRAY['prospect'], 'new_lead', current_date,
      CASE WHEN coalesce(p_consent, false) THEN now() ELSE NULL END
    )
    RETURNING id INTO v_client;

    IF v_brand IS NOT NULL THEN
      INSERT INTO public.client_brands (user_id, client_id, brand_id, source, source_at)
      VALUES (v_form.user_id, v_client, v_brand, 'lead_page', now())
      ON CONFLICT DO NOTHING;
    END IF;
    IF v_message IS NOT NULL THEN
      INSERT INTO public.notes (client_id, user_id, content) VALUES (v_client, v_form.user_id, v_message);
    END IF;
    INSERT INTO public.followups (client_id, user_id, title, due_date, done)
    VALUES (
      v_client, v_form.user_id,
      'Nouveau prospect' || coalesce(' ' || v_brand_name, '') || ' via ta page : ' || v_name,
      current_date, false
    );

    UPDATE public.lead_submissions SET client_id = v_client, status = 'created' WHERE id = v_submission;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN 'ok';
END;
$$;

NOTIFY pgrst, 'reload schema';
