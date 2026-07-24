-- Owner security boundary, manual entitlement administration and immutable audit trail.
-- Application owners do not automatically gain access to users' private CRM rows.

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('support', 'owner')),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_roles FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_table text,
  target_record_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_user_idx
  ON public.admin_audit_log (target_user_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_audit_log FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_app_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role = 'owner'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = (SELECT auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_app_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_app_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_app_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_app_role() TO authenticated;

-- profiles.plan is controlled only by trusted subscription processes.
-- Column grants prevent direct API updates; the trigger is a second line of defence.
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER, UPDATE ON TABLE public.profiles FROM authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (
  full_name,
  email,
  locale,
  timezone,
  updated_at,
  onboarding_completed,
  specialty,
  active_catalog_slugs,
  avatar_url,
  phone,
  website,
  bio,
  company,
  city,
  linkedin_url
) ON TABLE public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.protect_profile_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.plan IS DISTINCT FROM OLD.plan
     AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'PROFILE_PLAN_ADMIN_ONLY';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_plan_trigger ON public.profiles;
CREATE TRIGGER protect_profile_plan_trigger
BEFORE UPDATE OF plan ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_plan();

REVOKE ALL ON FUNCTION public.protect_profile_plan() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.owner_set_manual_subscription(
  p_target_user_id uuid,
  p_lifetime boolean DEFAULT true,
  p_duration_months integer DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  plan text,
  status text,
  current_period_end timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_end timestamptz;
  v_subscription public.subscriptions%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_USER_NOT_FOUND';
  END IF;

  IF NOT p_lifetime AND COALESCE(p_duration_months, 1) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SUBSCRIPTION_DURATION';
  END IF;

  v_end := CASE
    WHEN p_lifetime THEN NULL
    ELSE now() + make_interval(months => COALESCE(p_duration_months, 1))
  END;

  INSERT INTO public.subscriptions (
    user_id,
    provider,
    status,
    plan,
    external_subscription_id,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    cancelled_at,
    metadata,
    updated_at
  ) VALUES (
    p_target_user_id,
    'manual',
    'active',
    'advisor',
    'manual:' || p_target_user_id::text,
    now(),
    v_end,
    false,
    NULL,
    jsonb_build_object(
      'reason', COALESCE(NULLIF(btrim(p_reason), ''), 'Owner manual grant'),
      'granted_by', v_actor,
      'lifetime', p_lifetime
    ),
    now()
  )
  ON CONFLICT (provider, external_subscription_id)
  DO UPDATE SET
    status = 'active',
    plan = 'advisor',
    current_period_start = now(),
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = false,
    cancelled_at = NULL,
    metadata = EXCLUDED.metadata,
    updated_at = now()
  RETURNING * INTO v_subscription;

  INSERT INTO public.admin_audit_log (
    actor_user_id,
    action,
    target_user_id,
    target_table,
    target_record_id,
    details
  ) VALUES (
    v_actor,
    'subscription.manual.grant',
    p_target_user_id,
    'subscriptions',
    v_subscription.id,
    jsonb_build_object(
      'plan', 'advisor',
      'lifetime', p_lifetime,
      'duration_months', p_duration_months,
      'current_period_end', v_end,
      'reason', p_reason
    )
  );

  RETURN QUERY
  SELECT
    v_subscription.user_id,
    v_subscription.plan,
    v_subscription.status,
    v_subscription.current_period_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_revoke_manual_subscription(
  p_target_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  user_id uuid,
  plan text,
  status text,
  current_period_end timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_subscription public.subscriptions%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  UPDATE public.subscriptions
     SET status = 'expired',
         current_period_end = now(),
         cancel_at_period_end = true,
         cancelled_at = now(),
         metadata = metadata || jsonb_build_object(
           'revoked_by', v_actor,
           'revoked_reason', COALESCE(NULLIF(btrim(p_reason), ''), 'Owner manual revoke')
         ),
         updated_at = now()
   WHERE provider = 'manual'
     AND external_subscription_id = 'manual:' || p_target_user_id::text
  RETURNING * INTO v_subscription;

  IF v_subscription.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'MANUAL_SUBSCRIPTION_NOT_FOUND';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_user_id,
    action,
    target_user_id,
    target_table,
    target_record_id,
    details
  ) VALUES (
    v_actor,
    'subscription.manual.revoke',
    p_target_user_id,
    'subscriptions',
    v_subscription.id,
    jsonb_build_object('reason', p_reason)
  );

  RETURN QUERY
  SELECT
    v_subscription.user_id,
    v_subscription.plan,
    v_subscription.status,
    v_subscription.current_period_end;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_set_app_role(
  p_target_user_id uuid,
  p_role text,
  p_reason text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  IF p_role NOT IN ('support', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_APP_ROLE';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_USER_NOT_FOUND';
  END IF;

  INSERT INTO public.user_roles (user_id, role, granted_by, reason, updated_at)
  VALUES (p_target_user_id, p_role, v_actor, NULLIF(btrim(p_reason), ''), now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    granted_by = EXCLUDED.granted_by,
    reason = EXCLUDED.reason,
    updated_at = now();

  INSERT INTO public.admin_audit_log (
    actor_user_id,
    action,
    target_user_id,
    target_table,
    details
  ) VALUES (
    v_actor,
    'role.set',
    p_target_user_id,
    'user_roles',
    jsonb_build_object('role', p_role, 'reason', p_reason)
  );

  RETURN p_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_remove_app_role(
  p_target_user_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_existing_role text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  SELECT role INTO v_existing_role
  FROM public.user_roles
  WHERE user_id = p_target_user_id;

  IF v_existing_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_existing_role = 'owner'
     AND (SELECT count(*) FROM public.user_roles WHERE role = 'owner') <= 1 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LAST_OWNER_CANNOT_BE_REMOVED';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = p_target_user_id;

  INSERT INTO public.admin_audit_log (
    actor_user_id,
    action,
    target_user_id,
    target_table,
    details
  ) VALUES (
    v_actor,
    'role.remove',
    p_target_user_id,
    'user_roles',
    jsonb_build_object('previous_role', v_existing_role, 'reason', p_reason)
  );

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_users(
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  app_role text,
  plan text,
  subscription_provider text,
  subscription_status text,
  subscription_period_end timestamptz,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    p.full_name,
    r.role,
    COALESCE(p.plan, 'free'),
    s.provider,
    s.status,
    s.current_period_end,
    u.created_at,
    u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN public.user_roles r ON r.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT subscriptions.provider,
           subscriptions.status,
           subscriptions.current_period_end,
           subscriptions.updated_at
    FROM public.subscriptions
    WHERE subscriptions.user_id = u.id
    ORDER BY
      CASE WHEN subscriptions.status IN ('trialing', 'active', 'grace_period') THEN 0 ELSE 1 END,
      subscriptions.current_period_end DESC NULLS FIRST,
      subscriptions.updated_at DESC
    LIMIT 1
  ) s ON true
  WHERE NULLIF(btrim(p_search), '') IS NULL
     OR u.email ILIKE '%' || btrim(p_search) || '%'
     OR p.full_name ILIKE '%' || btrim(p_search) || '%'
  ORDER BY u.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_admin_audit(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  actor_user_id uuid,
  action text,
  target_user_id uuid,
  target_table text,
  target_record_id uuid,
  details jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    log.id,
    log.actor_user_id,
    log.action,
    log.target_user_id,
    log.target_table,
    log.target_record_id,
    log.details,
    log.created_at
  FROM public.admin_audit_log log
  ORDER BY log.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.owner_set_manual_subscription(uuid, boolean, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_revoke_manual_subscription(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_set_app_role(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_remove_app_role(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_list_users(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_list_admin_audit(integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.owner_set_manual_subscription(uuid, boolean, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_revoke_manual_subscription(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_set_app_role(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_remove_app_role(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_users(text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_admin_audit(integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
