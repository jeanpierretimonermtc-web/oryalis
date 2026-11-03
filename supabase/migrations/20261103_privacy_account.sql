-- PRIVACY-1 — Confidentialité & assistance : appareils connectés et demande de suppression de compte.
--
-- 1. list_my_login_devices() : security_login_events n'a pas de policy de lecture ; le praticien
--    lit ses propres appareils uniquement via cette fonction (hash d'IP jamais exposé).
-- 2. account_deletion_requests : droit à l'effacement (RGPD art. 17). La demande est enregistrée
--    avec un délai de 30 jours pendant lequel elle reste annulable ; le ou les owners en sont
--    avertis par une notification de sécurité. L'effacement lui-même reste une opération owner.

CREATE OR REPLACE FUNCTION public.list_my_login_devices()
RETURNS TABLE (
  id uuid,
  platform text,
  user_agent text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  sign_in_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT e.id, e.platform, e.user_agent, e.first_seen_at, e.last_seen_at, e.sign_in_count
  FROM public.security_login_events e
  WHERE e.user_id = (SELECT auth.uid())
  ORDER BY e.last_seen_at DESC
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION public.list_my_login_devices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_login_devices() TO authenticated;

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  reason        text CHECK (reason IS NULL OR char_length(reason) <= 500),
  cancelled_at  timestamptz,
  completed_at  timestamptz
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_deletion_requests_select_own ON public.account_deletion_requests;
CREATE POLICY account_deletion_requests_select_own ON public.account_deletion_requests
  FOR SELECT USING ((SELECT auth.uid()) = user_id);
-- Aucune écriture directe : uniquement via les deux fonctions ci-dessous.

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason text DEFAULT NULL)
RETURNS public.account_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_row public.account_deletion_requests;
  v_email text;
  v_owner record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'NOT_AUTHENTICATED';
  END IF;

  INSERT INTO public.account_deletion_requests (user_id, reason)
  VALUES (v_uid, NULLIF(btrim(p_reason), ''))
  ON CONFLICT (user_id) DO UPDATE
    SET requested_at  = now(),
        scheduled_for = now() + interval '30 days',
        reason        = EXCLUDED.reason,
        cancelled_at  = NULL,
        completed_at  = NULL
  RETURNING * INTO v_row;

  SELECT p.email INTO v_email FROM public.profiles p WHERE p.id = v_uid;
  FOR v_owner IN SELECT r.user_id FROM public.user_roles r WHERE r.role = 'owner' LOOP
    PERFORM public.create_security_notification(
      v_owner.user_id,
      'admin_action',
      'warning',
      'Demande de suppression de compte',
      COALESCE(v_email, v_uid::text) || ' a demandé la suppression de son compte (prévue le '
        || to_char(v_row.scheduled_for AT TIME ZONE 'Europe/Paris', 'DD/MM/YYYY') || ').',
      jsonb_build_object('user_id', v_uid, 'scheduled_for', v_row.scheduled_for)
    );
  END LOOP;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  UPDATE public.account_deletion_requests
     SET cancelled_at = now()
   WHERE user_id = (SELECT auth.uid())
     AND cancelled_at IS NULL
     AND completed_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.request_account_deletion(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_account_deletion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated;
