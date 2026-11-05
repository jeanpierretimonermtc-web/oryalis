-- OWNER-DASHBOARD-1 — vue d'ensemble de la console owner. Uniquement des chiffres sur les comptes :
-- jamais le contenu CRM d'un utilisateur (nombre de comptes ayant au moins un contact, pas leurs
-- contacts). Payant = abonnement actif hors accès manuel ; offert = accès manuel actif.

CREATE OR REPLACE FUNCTION public.owner_get_dashboard()
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

  WITH accounts AS (
    SELECT
      u.id,
      u.email::text AS email,
      p.full_name,
      u.created_at,
      GREATEST(u.last_sign_in_at, (SELECT max(e.last_seen_at) FROM public.security_login_events e WHERE e.user_id = u.id)) AS last_active_at,
      EXISTS (SELECT 1 FROM public.clients c WHERE c.user_id = u.id) AS has_contacts,
      (SELECT CASE WHEN count(*) = 0 THEN NULL WHEN bool_or(s.provider <> 'manual') THEN 'paying' ELSE 'offered' END
         FROM public.subscriptions s
         WHERE s.user_id = u.id
           AND s.status IN ('trialing', 'active', 'grace_period')
           AND (s.current_period_end IS NULL OR s.current_period_end > now())) AS access
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
  )
  SELECT jsonb_build_object(
    'accounts_total', count(*),
    'signups_7d',     count(*) FILTER (WHERE created_at >= now() - interval '7 days'),
    'signups_30d',    count(*) FILTER (WHERE created_at >= now() - interval '30 days'),
    'active_7d',      count(*) FILTER (WHERE last_active_at >= now() - interval '7 days'),
    'active_30d',     count(*) FILTER (WHERE last_active_at >= now() - interval '30 days'),
    'activated',      count(*) FILTER (WHERE has_contacts),
    'paying',         count(*) FILTER (WHERE access = 'paying'),
    'offered',        count(*) FILTER (WHERE access = 'offered'),
    'free',           count(*) FILTER (WHERE access IS NULL),
    'deletions_pending', (SELECT count(*) FROM public.account_deletion_requests d WHERE d.cancelled_at IS NULL AND d.completed_at IS NULL),
    'alerts_unread',  (SELECT count(*) FROM public.security_notifications n WHERE n.recipient_user_id = auth.uid() AND n.read_at IS NULL),
    'support_pending', (SELECT count(*) FROM public.support_access_requests r WHERE r.status = 'pending'),
    'recent_signups', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('full_name', a.full_name, 'email', a.email, 'created_at', a.created_at, 'access', COALESCE(a.access, 'free')) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM accounts ORDER BY created_at DESC LIMIT 5) a
    ), '[]'::jsonb)
  ) INTO v_result
  FROM accounts;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_get_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_get_dashboard() TO authenticated;
