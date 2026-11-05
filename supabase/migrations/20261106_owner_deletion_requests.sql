-- OWNER-DELETIONS-1 — demandes de suppression de compte dans la console owner.
-- owner_delete_account efface le compte et, par cascade, toutes ses données. Irréversible, donc :
-- owner + double authentification, demande en cours et délai de 30 jours écoulé, jamais un compte
-- owner, jamais un abonnement payant actif (il continuerait d'être facturé), e-mail retapé.
-- Le journal garde l'action sans aucune donnée personnelle de la personne effacée.

-- La garde d'abonnement bloquait aussi les suppressions en cascade d'un compte gratuit. Exception
-- limitée à la transaction d'owner_delete_account : set_config n'est pas exposé aux clients.
CREATE OR REPLACE FUNCTION public.enforce_advisor_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE target_user uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.owner_account_deletion', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF NOT public.has_advisor_access(target_user) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ADVISOR_PLAN_REQUIRED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.owner_list_deletion_requests()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.scheduled_for), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      d.user_id, u.email::text AS email, p.full_name, d.requested_at, d.scheduled_for, d.reason,
      d.scheduled_for <= now() AS due,
      EXISTS (SELECT 1 FROM public.subscriptions s
              WHERE s.user_id = d.user_id AND s.provider <> 'manual'
                AND s.status IN ('trialing', 'active', 'grace_period')
                AND (s.current_period_end IS NULL OR s.current_period_end > now())) AS paying,
      (SELECT count(*) FROM public.clients c WHERE c.user_id = d.user_id) AS contacts_count
    FROM public.account_deletion_requests d
    JOIN auth.users u ON u.id = d.user_id
    LEFT JOIN public.profiles p ON p.id = d.user_id
    WHERE d.cancelled_at IS NULL AND d.completed_at IS NULL
  ) r;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_delete_account(p_target_user_id uuid, p_confirm_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_request public.account_deletion_requests;
BEGIN
  IF v_actor IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  SELECT * INTO v_request FROM public.account_deletion_requests
    WHERE user_id = p_target_user_id AND cancelled_at IS NULL AND completed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'DELETION_REQUEST_NOT_FOUND';
  END IF;
  IF v_request.scheduled_for > now() THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DELETION_NOT_DUE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_target_user_id AND role = 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DELETION_TARGET_IS_OWNER';
  END IF;
  IF EXISTS (SELECT 1 FROM public.subscriptions s
             WHERE s.user_id = p_target_user_id AND s.provider <> 'manual'
               AND s.status IN ('trialing', 'active', 'grace_period')
               AND (s.current_period_end IS NULL OR s.current_period_end > now())) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'DELETION_ACTIVE_SUBSCRIPTION';
  END IF;

  SELECT u.email::text INTO v_email FROM auth.users u WHERE u.id = p_target_user_id;
  IF v_email IS NULL OR lower(v_email) <> lower(btrim(p_confirm_email)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DELETION_EMAIL_MISMATCH';
  END IF;

  INSERT INTO public.admin_audit_log (actor_user_id, action, target_user_id, target_table, details)
  VALUES (v_actor, 'account.delete', NULL, 'auth.users', jsonb_build_object('requested_at', v_request.requested_at));

  PERFORM set_config('app.owner_account_deletion', 'on', true);
  DELETE FROM auth.users WHERE id = p_target_user_id;
  PERFORM set_config('app.owner_account_deletion', 'off', true);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_list_deletion_requests() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_delete_account(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_deletion_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_delete_account(uuid, text) TO authenticated;
