-- Owner console hardening: mandatory MFA, security notifications,
-- unusual login tracking and temporary consent-based support access.

CREATE TABLE IF NOT EXISTS public.security_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('admin_action', 'unusual_login', 'support_access', 'mfa')),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_notifications_recipient_idx
  ON public.security_notifications (recipient_user_id, created_at DESC);

ALTER TABLE public.security_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS security_notifications_select_own ON public.security_notifications;
CREATE POLICY security_notifications_select_own
  ON public.security_notifications FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = recipient_user_id);

REVOKE ALL ON TABLE public.security_notifications FROM anon, authenticated;
GRANT SELECT ON TABLE public.security_notifications TO authenticated;
GRANT UPDATE (read_at, notified_at) ON TABLE public.security_notifications TO authenticated;

CREATE TABLE IF NOT EXISTS public.security_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_hash text NOT NULL,
  last_ip_hash text,
  platform text,
  user_agent text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  sign_in_count integer NOT NULL DEFAULT 1,
  first_seen_was_unusual boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, installation_hash)
);

CREATE INDEX IF NOT EXISTS security_login_events_user_idx
  ON public.security_login_events (user_id, last_seen_at DESC);

ALTER TABLE public.security_login_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.security_login_events FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.support_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('account_diagnostics', 'crm_read')),
  reason text NOT NULL,
  requested_duration_minutes integer NOT NULL CHECK (requested_duration_minutes BETWEEN 5 AND 120),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision_deadline timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  decided_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_access_requests_user_idx
  ON public.support_access_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS support_access_requests_owner_idx
  ON public.support_access_requests (requested_by, requested_at DESC);

ALTER TABLE public.support_access_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_access_requests_select_own ON public.support_access_requests;
CREATE POLICY support_access_requests_select_own
  ON public.support_access_requests FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

REVOKE ALL ON TABLE public.support_access_requests FROM anon, authenticated;
GRANT SELECT ON TABLE public.support_access_requests TO authenticated;

-- Existing owner RPCs call is_app_owner(). Requiring AAL2 here enforces MFA
-- server-side for every owner operation, not merely in the interface.
CREATE OR REPLACE FUNCTION public.is_app_owner()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_owner boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = (SELECT auth.uid())
      AND role = 'owner'
  ) INTO v_is_owner;

  IF NOT v_is_owner THEN
    RETURN false;
  END IF;

  IF COALESCE(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_MFA_REQUIRED';
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_security_notification(
  p_recipient_user_id uuid,
  p_category text,
  p_severity text,
  p_title text,
  p_body text,
  p_data jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.security_notifications (
    recipient_user_id, category, severity, title, body, data
  ) VALUES (
    p_recipient_user_id, p_category, p_severity, p_title, p_body, COALESCE(p_data, '{}'::jsonb)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_security_notification(uuid, text, text, text, text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.notify_sensitive_admin_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_recipient uuid;
BEGIN
  IF NEW.action = 'support.access.view' THEN
    RETURN NEW;
  END IF;

  FOR v_recipient IN
    SELECT DISTINCT recipient
    FROM (
      SELECT NEW.actor_user_id AS recipient
      UNION ALL
      SELECT NEW.target_user_id AS recipient
      UNION ALL
      SELECT user_id AS recipient
      FROM public.user_roles
      WHERE role = 'owner' AND NEW.action LIKE 'role.%'
    ) recipients
    WHERE recipient IS NOT NULL
  LOOP
    PERFORM public.create_security_notification(
      v_recipient,
      CASE WHEN NEW.action LIKE 'support.%' THEN 'support_access' ELSE 'admin_action' END,
      CASE WHEN NEW.action LIKE 'role.%' OR NEW.action LIKE 'subscription.manual.revoke%' THEN 'warning' ELSE 'info' END,
      'Action de sécurité Oryalis',
      NEW.action,
      jsonb_build_object(
        'audit_id', NEW.id,
        'action', NEW.action,
        'actor_user_id', NEW.actor_user_id,
        'target_user_id', NEW.target_user_id,
        'details', NEW.details
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_sensitive_admin_action_trigger ON public.admin_audit_log;
CREATE TRIGGER notify_sensitive_admin_action_trigger
AFTER INSERT ON public.admin_audit_log
FOR EACH ROW EXECUTE FUNCTION public.notify_sensitive_admin_action();

REVOKE ALL ON FUNCTION public.notify_sensitive_admin_action() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.list_my_security_notifications(p_limit integer DEFAULT 100)
RETURNS SETOF public.security_notifications
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT notification.*
  FROM public.security_notifications notification
  WHERE notification.recipient_user_id = (SELECT auth.uid())
  ORDER BY notification.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
$$;

CREATE OR REPLACE FUNCTION public.claim_my_security_notifications(p_limit integer DEFAULT 20)
RETURNS SETOF public.security_notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH pending AS (
    SELECT notification.id
    FROM public.security_notifications notification
    WHERE notification.recipient_user_id = (SELECT auth.uid())
      AND notification.notified_at IS NULL
    ORDER BY notification.created_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 50))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.security_notifications notification
     SET notified_at = now()
    FROM pending
   WHERE notification.id = pending.id
  RETURNING notification.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_my_security_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.security_notifications
     SET read_at = COALESCE(read_at, now())
   WHERE recipient_user_id = (SELECT auth.uid())
     AND (p_ids IS NULL OR id = ANY(p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_security_notifications(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_my_security_notifications(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_my_security_notifications_read(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_security_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_my_security_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_security_notifications_read(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_security_login_event(
  p_user_id uuid,
  p_installation_hash text,
  p_ip_hash text,
  p_platform text,
  p_user_agent text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_has_history boolean;
  v_known_installation boolean;
  v_unusual boolean;
  v_recent_alert boolean;
  v_recipient uuid;
BEGIN
  IF p_user_id IS NULL OR NULLIF(btrim(p_installation_hash), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_LOGIN_EVENT';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.security_login_events WHERE user_id = p_user_id
  ) INTO v_has_history;

  SELECT EXISTS (
    SELECT 1 FROM public.security_login_events
    WHERE user_id = p_user_id AND installation_hash = p_installation_hash
  ) INTO v_known_installation;

  v_unusual := v_has_history AND NOT v_known_installation;

  INSERT INTO public.security_login_events (
    user_id, installation_hash, last_ip_hash, platform, user_agent, first_seen_was_unusual
  ) VALUES (
    p_user_id,
    left(p_installation_hash, 128),
    left(p_ip_hash, 128),
    left(p_platform, 40),
    left(p_user_agent, 300),
    v_unusual
  )
  ON CONFLICT (user_id, installation_hash)
  DO UPDATE SET
    last_ip_hash = EXCLUDED.last_ip_hash,
    platform = EXCLUDED.platform,
    user_agent = EXCLUDED.user_agent,
    last_seen_at = now(),
    sign_in_count = public.security_login_events.sign_in_count + 1;

  IF v_unusual THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.security_notifications
      WHERE recipient_user_id = p_user_id
        AND category = 'unusual_login'
        AND created_at > now() - interval '15 minutes'
    ) INTO v_recent_alert;

    IF NOT v_recent_alert THEN
      FOR v_recipient IN
        SELECT DISTINCT recipient
        FROM (
          SELECT p_user_id AS recipient
          UNION ALL
          SELECT user_id FROM public.user_roles WHERE role = 'owner'
        ) recipients
      LOOP
        PERFORM public.create_security_notification(
          v_recipient,
          'unusual_login',
          'critical',
          'Nouvelle connexion détectée',
          'Une connexion depuis une nouvelle installation a été détectée.',
          jsonb_build_object(
            'subject_user_id', p_user_id,
            'platform', left(p_platform, 40),
            'detected_at', now()
          )
        );
      END LOOP;
    END IF;
  END IF;

  RETURN v_unusual;
END;
$$;

REVOKE ALL ON FUNCTION public.record_security_login_event(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_security_login_event(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.owner_extend_manual_subscription(
  p_target_user_id uuid,
  p_duration_months integer DEFAULT 1,
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

  IF p_duration_months NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SUBSCRIPTION_DURATION';
  END IF;

  UPDATE public.subscriptions
     SET status = 'active',
         current_period_end = GREATEST(current_period_end, now()) + make_interval(months => p_duration_months),
         cancel_at_period_end = false,
         cancelled_at = NULL,
         metadata = metadata || jsonb_build_object(
           'extended_by', v_actor,
           'extension_months', p_duration_months,
           'extension_reason', p_reason
         ),
         updated_at = now()
   WHERE provider = 'manual'
     AND external_subscription_id = 'manual:' || p_target_user_id::text
     AND current_period_end IS NOT NULL
  RETURNING * INTO v_subscription;

  IF v_subscription.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'EXTENDABLE_MANUAL_SUBSCRIPTION_NOT_FOUND';
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_user_id, action, target_user_id, target_table, target_record_id, details
  ) VALUES (
    v_actor,
    'subscription.manual.extend',
    p_target_user_id,
    'subscriptions',
    v_subscription.id,
    jsonb_build_object('duration_months', p_duration_months, 'reason', p_reason)
  );

  RETURN QUERY SELECT
    v_subscription.user_id,
    v_subscription.plan,
    v_subscription.status,
    v_subscription.current_period_end;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_extend_manual_subscription(uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owner_extend_manual_subscription(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_request_support_access(
  p_target_user_id uuid,
  p_scope text,
  p_reason text,
  p_duration_minutes integer DEFAULT 30
)
RETURNS public.support_access_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.support_access_requests%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;
  IF p_target_user_id = v_actor THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SELF_SUPPORT_ACCESS_NOT_ALLOWED';
  END IF;
  IF p_scope NOT IN ('account_diagnostics', 'crm_read') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SUPPORT_SCOPE';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_REASON_REQUIRED';
  END IF;
  IF p_duration_minutes NOT BETWEEN 5 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_SUPPORT_DURATION';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_USER_NOT_FOUND';
  END IF;

  INSERT INTO public.support_access_requests (
    user_id, requested_by, scope, reason, requested_duration_minutes
  ) VALUES (
    p_target_user_id, v_actor, p_scope, btrim(p_reason), p_duration_minutes
  ) RETURNING * INTO v_request;

  INSERT INTO public.admin_audit_log (
    actor_user_id, action, target_user_id, target_table, target_record_id, details
  ) VALUES (
    v_actor,
    'support.access.request',
    p_target_user_id,
    'support_access_requests',
    v_request.id,
    jsonb_build_object('scope', p_scope, 'duration_minutes', p_duration_minutes, 'reason', p_reason)
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_my_support_access_requests()
RETURNS TABLE (
  id uuid,
  requested_by uuid,
  requester_email text,
  scope text,
  reason text,
  requested_duration_minutes integer,
  status text,
  effective_status text,
  requested_at timestamptz,
  decision_deadline timestamptz,
  decided_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    request.id,
    request.requested_by,
    owner.email::text,
    request.scope,
    request.reason,
    request.requested_duration_minutes,
    request.status,
    CASE
      WHEN request.status = 'pending' AND request.decision_deadline <= now() THEN 'expired'
      WHEN request.status = 'approved' AND request.expires_at <= now() THEN 'expired'
      ELSE request.status
    END,
    request.requested_at,
    request.decision_deadline,
    request.decided_at,
    request.expires_at
  FROM public.support_access_requests request
  JOIN auth.users owner ON owner.id = request.requested_by
  WHERE request.user_id = (SELECT auth.uid())
  ORDER BY request.requested_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_support_access_request(
  p_request_id uuid,
  p_approve boolean
)
RETURNS public.support_access_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.support_access_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_request
  FROM public.support_access_requests
  WHERE id = p_request_id
    AND user_id = v_actor
  FOR UPDATE;

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_REQUEST_NOT_FOUND';
  END IF;
  IF v_request.status <> 'pending' OR v_request.decision_deadline <= now() THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'SUPPORT_REQUEST_NOT_PENDING';
  END IF;

  UPDATE public.support_access_requests
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         decided_at = now(),
         expires_at = CASE WHEN p_approve THEN now() + make_interval(mins => requested_duration_minutes) ELSE NULL END,
         updated_at = now()
   WHERE id = p_request_id
  RETURNING * INTO v_request;

  INSERT INTO public.admin_audit_log (
    actor_user_id, action, target_user_id, target_table, target_record_id, details
  ) VALUES (
    v_actor,
    CASE WHEN p_approve THEN 'support.access.approve' ELSE 'support.access.reject' END,
    v_request.requested_by,
    'support_access_requests',
    v_request.id,
    jsonb_build_object('scope', v_request.scope, 'expires_at', v_request.expires_at)
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_my_support_access(p_request_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.support_access_requests%ROWTYPE;
BEGIN
  UPDATE public.support_access_requests
     SET status = 'revoked', revoked_at = now(), updated_at = now()
   WHERE id = p_request_id
     AND user_id = v_actor
     AND status = 'approved'
     AND expires_at > now()
  RETURNING * INTO v_request;

  IF v_request.id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.admin_audit_log (
    actor_user_id, action, target_user_id, target_table, target_record_id, details
  ) VALUES (
    v_actor,
    'support.access.revoke_by_user',
    v_request.requested_by,
    'support_access_requests',
    v_request.id,
    jsonb_build_object('scope', v_request.scope)
  );
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_list_support_access_requests(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_email text,
  requested_by uuid,
  scope text,
  reason text,
  requested_duration_minutes integer,
  status text,
  effective_status text,
  requested_at timestamptz,
  decided_at timestamptz,
  expires_at timestamptz
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
    request.id,
    request.user_id,
    users.email::text,
    request.requested_by,
    request.scope,
    request.reason,
    request.requested_duration_minutes,
    request.status,
    CASE
      WHEN request.status = 'pending' AND request.decision_deadline <= now() THEN 'expired'
      WHEN request.status = 'approved' AND request.expires_at <= now() THEN 'expired'
      ELSE request.status
    END,
    request.requested_at,
    request.decided_at,
    request.expires_at
  FROM public.support_access_requests request
  JOIN auth.users users ON users.id = request.user_id
  ORDER BY request.requested_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_get_support_snapshot(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_request public.support_access_requests%ROWTYPE;
  v_snapshot jsonb;
BEGIN
  IF v_actor IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  SELECT * INTO v_request
  FROM public.support_access_requests
  WHERE id = p_request_id
    AND requested_by = v_actor
    AND status = 'approved'
    AND expires_at > now();

  IF v_request.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACTIVE_SUPPORT_CONSENT_REQUIRED';
  END IF;

  SELECT jsonb_build_object(
    'request_id', v_request.id,
    'scope', v_request.scope,
    'expires_at', v_request.expires_at,
    'profile', jsonb_build_object(
      'id', profile.id,
      'full_name', profile.full_name,
      'locale', profile.locale,
      'timezone', profile.timezone,
      'plan', profile.plan,
      'onboarding_completed', profile.onboarding_completed
    ),
    'subscription', (
      SELECT to_jsonb(subscription_row)
      FROM (
        SELECT provider, status, plan, current_period_end, cancel_at_period_end
        FROM public.subscriptions
        WHERE user_id = v_request.user_id
        ORDER BY updated_at DESC
        LIMIT 1
      ) subscription_row
    ),
    'counts', jsonb_build_object(
      'clients', (SELECT count(*) FROM public.clients WHERE user_id = v_request.user_id),
      'appointments', (SELECT count(*) FROM public.appointments WHERE user_id = v_request.user_id),
      'followups', (SELECT count(*) FROM public.followups WHERE user_id = v_request.user_id)
    ),
    'recent_clients', CASE WHEN v_request.scope = 'crm_read' THEN (
      SELECT COALESCE(jsonb_agg(to_jsonb(client_row)), '[]'::jsonb)
      FROM (
        SELECT id, full_name, status, contact_role, pipeline_stage, created_at
        FROM public.clients
        WHERE user_id = v_request.user_id
        ORDER BY updated_at DESC
        LIMIT 50
      ) client_row
    ) ELSE '[]'::jsonb END
  ) INTO v_snapshot
  FROM public.profiles profile
  WHERE profile.id = v_request.user_id;

  INSERT INTO public.admin_audit_log (
    actor_user_id, action, target_user_id, target_table, target_record_id, details
  ) VALUES (
    v_actor,
    'support.access.view',
    v_request.user_id,
    'support_access_requests',
    v_request.id,
    jsonb_build_object('scope', v_request.scope, 'expires_at', v_request.expires_at)
  );

  PERFORM public.create_security_notification(
    v_request.user_id,
    'support_access',
    'warning',
    'Consultation support effectuée',
    'Le support Oryalis a consulté les données que vous aviez autorisées.',
    jsonb_build_object(
      'request_id', v_request.id,
      'scope', v_request.scope,
      'viewed_by', v_actor,
      'viewed_at', now()
    )
  );

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_request_support_access(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_my_support_access_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_to_support_access_request(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_my_support_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_list_support_access_requests(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.owner_get_support_snapshot(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.owner_request_support_access(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_my_support_access_requests() TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_support_access_request(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_my_support_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_list_support_access_requests(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_get_support_snapshot(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
