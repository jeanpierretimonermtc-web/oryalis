-- NEXT-ACTION-CANCELLED-1 — une relance annulée (cancelled_at, ex. accompagnement arrêté) reste
-- done = false : elle ne doit plus être retenue comme prochaine action du contact. Seul le filtre
-- followups change ; le trigger refresh_activity_from_followups recalcule déjà à chaque UPDATE.

CREATE OR REPLACE FUNCTION public.refresh_client_activity(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next record;
  v_last timestamptz;
BEGIN
  IF p_client_id IS NULL OR NOT EXISTS (SELECT 1 FROM clients WHERE id = p_client_id) THEN
    RETURN;
  END IF;

  SELECT max(event_at) INTO v_last
  FROM (
    SELECT completed_at AS event_at
      FROM interactions WHERE client_id = p_client_id AND completed_at IS NOT NULL
    UNION ALL
    SELECT start_at FROM appointments
      WHERE client_id = p_client_id AND status = 'completed'
    UNION ALL
    SELECT COALESCE(updated_at, created_at) FROM followups
      WHERE client_id = p_client_id AND done = true
  ) completed_events;

  SELECT source, source_id, event_at, action_type INTO v_next
  FROM (
    SELECT 'appointment'::text AS source, id AS source_id, start_at AS event_at,
           'rdv'::text AS action_type, 1 AS source_order
      FROM appointments
      WHERE client_id = p_client_id AND status IN ('scheduled', 'rescheduled')
    UNION ALL
    SELECT 'interaction', id, scheduled_at,
           CASE WHEN interaction_type IN ('call', 'whatsapp', 'sms', 'email', 'rdv')
                THEN interaction_type ELSE 'rdv' END, 2
      FROM interactions
      WHERE client_id = p_client_id AND completed_at IS NULL AND scheduled_at IS NOT NULL
    UNION ALL
    SELECT 'followup', id, due_date::timestamptz, COALESCE(action_type, 'call'), 3
      FROM followups
      WHERE client_id = p_client_id AND done = false AND cancelled_at IS NULL
  ) pending_events
  ORDER BY event_at ASC, source_order ASC
  LIMIT 1;

  UPDATE clients SET
    next_action_at = v_next.event_at,
    next_action_source = v_next.source,
    next_action_source_id = v_next.source_id,
    next_action_date = v_next.event_at::date,
    next_action_type = v_next.action_type,
    last_interaction_at = v_last
  WHERE id = p_client_id;
END;
$function$;
