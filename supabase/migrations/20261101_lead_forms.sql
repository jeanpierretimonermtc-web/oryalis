-- LEAD-PAGE-1 — Page publique de prospect : un lien à partager (bio, réseaux sociaux) avec un
-- petit formulaire. Chaque envoi crée le contact (prospect) + une relance "à rappeler" chez
-- l'utilisateur. Aucun accès direct aux tables pour un visiteur anonyme : uniquement deux
-- fonctions SECURITY DEFINER qui valident tout.

CREATE TABLE IF NOT EXISTS public.lead_forms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,40}$'),
  title       text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
  intro       text CHECK (intro IS NULL OR char_length(intro) <= 600),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_forms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_forms_user_policy ON public.lead_forms;
CREATE POLICY lead_forms_user_policy ON public.lead_forms
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_forms TO authenticated;

-- Trace de chaque envoi : un prospect n'est jamais perdu, même si la création du contact
-- échoue (ex. quota du plan gratuit atteint) — il reste "pending" et visible par l'utilisateur.
CREATE TABLE IF NOT EXISTS public.lead_submissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id     uuid NOT NULL REFERENCES public.lead_forms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  email       text,
  phone       text,
  message     text,
  consent     boolean NOT NULL DEFAULT false,
  client_id   uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('created', 'pending')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_submissions_form_created_idx ON public.lead_submissions (form_id, created_at DESC);

ALTER TABLE public.lead_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_submissions_user_policy ON public.lead_submissions;
CREATE POLICY lead_submissions_user_policy ON public.lead_submissions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, UPDATE, DELETE ON public.lead_submissions TO authenticated;

-- Lecture publique d'un formulaire actif (titre, texte, prénom du conseiller).
CREATE OR REPLACE FUNCTION public.get_public_lead_form(p_slug text)
RETURNS TABLE (title text, intro text, advisor_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.title, f.intro, split_part(coalesce(p.full_name, ''), ' ', 1)
  FROM public.lead_forms f
  LEFT JOIN public.profiles p ON p.id = f.user_id
  WHERE f.slug = lower(trim(p_slug)) AND f.active
  LIMIT 1
$$;

-- Envoi public : validation, anti-abus, puis contact + note + relance chez l'utilisateur.
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

  -- Anti-abus : 30 envois par heure et par page ; un même email / téléphone une fois par jour.
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
    INSERT INTO public.clients (user_id, full_name, first_name, email, phone, source, contact_role, pipeline_stage, inscription_date, tracking_consent_at)
    VALUES (
      v_form.user_id, v_name,
      CASE WHEN position(' ' IN v_name) > 0 THEN split_part(v_name, ' ', 1) ELSE NULL END,
      v_email, v_phone, 'Page prospect', ARRAY['prospect'], 'new_lead', current_date,
      CASE WHEN coalesce(p_consent, false) THEN now() ELSE NULL END
    )
    RETURNING id INTO v_client;

    IF v_message IS NOT NULL THEN
      INSERT INTO public.notes (client_id, user_id, content) VALUES (v_client, v_form.user_id, v_message);
    END IF;
    INSERT INTO public.followups (client_id, user_id, title, due_date, done)
    VALUES (v_client, v_form.user_id, 'Nouveau prospect via ta page : ' || v_name, current_date, false);

    UPDATE public.lead_submissions SET client_id = v_client, status = 'created' WHERE id = v_submission;
  EXCEPTION WHEN OTHERS THEN
    -- Contact non créé (quota du plan gratuit…) : l'envoi reste enregistré en "pending".
    NULL;
  END;

  RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_lead_form(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_public_lead(text, text, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_lead_form(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_public_lead(text, text, text, text, text, boolean) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
