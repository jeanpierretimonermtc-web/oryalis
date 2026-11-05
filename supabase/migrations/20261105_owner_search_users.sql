-- OWNER-USERS-1 — liste des comptes de la console owner : recherche, filtre par accès, tri et total,
-- pour tenir à plusieurs milliers de comptes. Données de compte uniquement, jamais le contenu CRM.
-- p_access : 'paying' | 'offered' | 'free' | 'inactive' (aucune activité depuis 30 jours) | NULL.
-- p_sort   : 'signup' | 'activity' | 'name'.

CREATE OR REPLACE FUNCTION public.owner_search_users(
  p_search text DEFAULT NULL,
  p_access text DEFAULT NULL,
  p_sort text DEFAULT 'signup',
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_result jsonb;
  v_search text := NULLIF(btrim(p_search), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  WITH accounts AS (
    SELECT
      u.id AS user_id,
      u.email::text AS email,
      p.full_name,
      r.role AS app_role,
      u.created_at,
      GREATEST(u.last_sign_in_at, (SELECT max(e.last_seen_at) FROM public.security_login_events e WHERE e.user_id = u.id)) AS last_active_at,
      s.provider,
      s.current_period_end
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.user_roles r ON r.user_id = u.id
    LEFT JOIN LATERAL (
      SELECT sub.provider, sub.current_period_end
      FROM public.subscriptions sub
      WHERE sub.user_id = u.id
        AND sub.status IN ('trialing', 'active', 'grace_period')
        AND (sub.current_period_end IS NULL OR sub.current_period_end > now())
      ORDER BY CASE WHEN sub.provider <> 'manual' THEN 0 ELSE 1 END, sub.current_period_end DESC NULLS FIRST
      LIMIT 1
    ) s ON true
    WHERE v_search IS NULL
       OR u.email ILIKE '%' || v_search || '%'
       OR p.full_name ILIKE '%' || v_search || '%'
  ),
  classified AS (
    SELECT a.*, CASE WHEN a.provider IS NULL THEN 'free' WHEN a.provider = 'manual' THEN 'offered' ELSE 'paying' END AS access
    FROM accounts a
  ),
  filtered AS (
    SELECT * FROM classified c
    WHERE p_access IS NULL
       OR (p_access = 'inactive' AND (c.last_active_at IS NULL OR c.last_active_at < now() - interval '30 days'))
       OR c.access = p_access
  ),
  page AS (
    SELECT * FROM filtered f
    ORDER BY
      CASE WHEN p_sort = 'name' THEN lower(COALESCE(f.full_name, f.email)) END ASC,
      CASE WHEN p_sort = 'activity' THEN f.last_active_at END DESC NULLS LAST,
      f.created_at DESC,
      f.user_id
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(pg) - 'provider' ORDER BY pg.position)
                      FROM (SELECT page.*, row_number() OVER () AS position FROM page) pg), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_search_users(text, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_search_users(text, text, text, integer, integer) TO authenticated;
