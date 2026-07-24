-- A contact's next action and last interaction are derived from source events.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_source text,
  ADD COLUMN IF NOT EXISTS next_action_source_id uuid,
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_next_action_source_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_next_action_source_check
  CHECK (next_action_source IS NULL OR next_action_source IN ('appointment', 'interaction', 'followup'));

CREATE INDEX IF NOT EXISTS idx_clients_next_action_at
  ON public.clients(user_id, next_action_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_clients_last_interaction_at
  ON public.clients(user_id, last_interaction_at) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.refresh_client_activity(p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      WHERE client_id = p_client_id AND done = false
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
$$;

REVOKE ALL ON FUNCTION public.refresh_client_activity(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.on_contact_event_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM refresh_client_activity(OLD.client_id); END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.client_id IS DISTINCT FROM OLD.client_id) THEN
    PERFORM refresh_client_activity(NEW.client_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM refresh_client_activity(NEW.client_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS refresh_activity_from_appointments ON public.appointments;
CREATE TRIGGER refresh_activity_from_appointments AFTER INSERT OR UPDATE OR DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.on_contact_event_changed();
DROP TRIGGER IF EXISTS refresh_activity_from_interactions ON public.interactions;
CREATE TRIGGER refresh_activity_from_interactions AFTER INSERT OR UPDATE OR DELETE ON public.interactions
  FOR EACH ROW EXECUTE FUNCTION public.on_contact_event_changed();
DROP TRIGGER IF EXISTS refresh_activity_from_followups ON public.followups;
CREATE TRIGGER refresh_activity_from_followups AFTER INSERT OR UPDATE OR DELETE ON public.followups
  FOR EACH ROW EXECUTE FUNCTION public.on_contact_event_changed();

SELECT public.refresh_client_activity(id) FROM public.clients;
NOTIFY pgrst, 'reload schema';
