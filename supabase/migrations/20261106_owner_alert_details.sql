-- OWNER-ALERTS-3 — détail des alertes de la console owner : qui est concerné et depuis quel appareil.
-- Une alerte de connexion retrouve son appareil dans security_login_events (même compte, date de
-- première connexion la plus proche) ; l'adresse IP reste hachée et n'est jamais renvoyée.

CREATE OR REPLACE FUNCTION public.owner_list_alerts(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_me IS NULL OR NOT public.is_app_owner() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OWNER_ROLE_REQUIRED';
  END IF;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY created_at DESC), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      n.created_at,
      to_jsonb(n) - 'data' || jsonb_build_object(
        'action', n.data->>'action',
        'reason', n.data->'details'->>'reason',
        'subject', (SELECT jsonb_build_object('user_id', u.id, 'email', u.email, 'full_name', p.full_name, 'is_me', u.id = v_me)
                    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
                    WHERE u.id = NULLIF(COALESCE(n.data->>'subject_user_id', n.data->>'target_user_id'), '')::uuid),
        'actor', (SELECT jsonb_build_object('email', u.email, 'full_name', p.full_name, 'is_me', u.id = v_me)
                  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
                  WHERE u.id = NULLIF(n.data->>'actor_user_id', '')::uuid),
        'device', (SELECT jsonb_build_object('platform', e.platform, 'user_agent', e.user_agent, 'sign_in_count', e.sign_in_count, 'last_seen_at', e.last_seen_at)
                   FROM public.security_login_events e
                   WHERE n.category = 'unusual_login'
                     AND e.user_id = NULLIF(n.data->>'subject_user_id', '')::uuid
                   ORDER BY abs(extract(epoch FROM e.first_seen_at - COALESCE((n.data->>'detected_at')::timestamptz, n.created_at)))
                   LIMIT 1)
      ) AS row_data
    FROM public.security_notifications n
    WHERE n.recipient_user_id = v_me
    ORDER BY n.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 500))
  ) alerts;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.owner_list_alerts(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_list_alerts(integer) TO authenticated;
