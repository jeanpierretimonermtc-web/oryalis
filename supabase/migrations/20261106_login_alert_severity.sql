-- OWNER-ALERTS-2 — une connexion depuis un nouvel appareil est à surveiller, pas critique : "Critique"
-- doit rester rare pour être lu. Seul le niveau change (fonction et alertes existantes).

CREATE OR REPLACE FUNCTION public.record_security_login_event(p_user_id uuid, p_installation_hash text, p_ip_hash text, p_platform text, p_user_agent text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
          'warning',
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
$function$;

UPDATE public.security_notifications
   SET severity = 'warning'
 WHERE category = 'unusual_login' AND severity = 'critical';
