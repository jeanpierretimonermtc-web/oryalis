-- One canonical commercial pipeline stored on clients.
-- Legacy appointment/followup stages remain untouched for historical audit.

CREATE OR REPLACE FUNCTION public.canonical_pipeline_stage(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE value
    WHEN 'new_lead' THEN 'new_lead'
    WHEN 'contacted' THEN 'contacted'
    WHEN 'presentation_scheduled' THEN 'presentation_scheduled'
    WHEN 'presentation_completed' THEN 'presentation_completed'
    WHEN 'follow_up' THEN 'follow_up'
    WHEN 'proposal_sent' THEN 'follow_up'
    WHEN 'customer' THEN 'customer'
    WHEN 'distributor' THEN 'distributor'
    WHEN 'inactive' THEN 'lost'
    WHEN 'lost' THEN 'lost'
    ELSE NULL
  END
$$;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS pipeline_stage text,
  ADD COLUMN IF NOT EXISTS pipeline_stage_updated_at timestamptz;

-- Establish a conservative value from the existing contact role/status.
UPDATE public.clients
SET pipeline_stage = CASE
  WHEN contact_role = 'inactive' OR status IN ('inactive', 'lost') THEN 'lost'
  WHEN contact_role IN ('distributor', 'leader', 'team_member') OR status IN ('advisor', 'team_member') THEN 'distributor'
  WHEN contact_role = 'customer' OR status IN ('new_client', 'active', 'loyal', 'vip') THEN 'customer'
  ELSE 'new_lead'
END,
pipeline_stage_updated_at = COALESCE(updated_at, created_at, now())
WHERE pipeline_stage IS NULL;

-- Promote from the most advanced historical appointment/followup signal.
WITH historical AS (
  SELECT a.client_id,
         public.canonical_pipeline_stage(b.pipeline_stage::text) AS stage,
         CASE public.canonical_pipeline_stage(b.pipeline_stage::text)
           WHEN 'new_lead' THEN 1 WHEN 'contacted' THEN 2
           WHEN 'presentation_scheduled' THEN 3 WHEN 'presentation_completed' THEN 4
           WHEN 'follow_up' THEN 5 WHEN 'customer' THEN 6
           WHEN 'distributor' THEN 7 WHEN 'lost' THEN 8 ELSE 0 END AS rank,
         COALESCE(b.updated_at, b.created_at, a.updated_at, a.created_at) AS changed_at
  FROM public.appointment_business_context b
  JOIN public.appointments a ON a.id = b.appointment_id
  WHERE a.client_id IS NOT NULL
  UNION ALL
  SELECT f.client_id,
         public.canonical_pipeline_stage(f.pipeline_stage::text),
         CASE public.canonical_pipeline_stage(f.pipeline_stage::text)
           WHEN 'new_lead' THEN 1 WHEN 'contacted' THEN 2
           WHEN 'presentation_scheduled' THEN 3 WHEN 'presentation_completed' THEN 4
           WHEN 'follow_up' THEN 5 WHEN 'customer' THEN 6
           WHEN 'distributor' THEN 7 WHEN 'lost' THEN 8 ELSE 0 END,
         COALESCE(f.updated_at, f.created_at)
  FROM public.followups f
  WHERE f.client_id IS NOT NULL AND f.pipeline_stage IS NOT NULL
), best AS (
  SELECT DISTINCT ON (client_id) client_id, stage, changed_at
  FROM historical
  WHERE stage IS NOT NULL
  ORDER BY client_id, rank DESC, changed_at DESC
)
UPDATE public.clients c
SET pipeline_stage = best.stage,
    pipeline_stage_updated_at = best.changed_at
FROM best
WHERE c.id = best.client_id
  AND CASE c.pipeline_stage
    WHEN 'new_lead' THEN 1 WHEN 'contacted' THEN 2
    WHEN 'presentation_scheduled' THEN 3 WHEN 'presentation_completed' THEN 4
    WHEN 'follow_up' THEN 5 WHEN 'customer' THEN 6
    WHEN 'distributor' THEN 7 WHEN 'lost' THEN 8 ELSE 0 END
  < CASE best.stage
    WHEN 'new_lead' THEN 1 WHEN 'contacted' THEN 2
    WHEN 'presentation_scheduled' THEN 3 WHEN 'presentation_completed' THEN 4
    WHEN 'follow_up' THEN 5 WHEN 'customer' THEN 6
    WHEN 'distributor' THEN 7 WHEN 'lost' THEN 8 ELSE 0 END;

ALTER TABLE public.clients
  ALTER COLUMN pipeline_stage SET DEFAULT 'new_lead',
  ALTER COLUMN pipeline_stage SET NOT NULL;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_pipeline_stage_check;
ALTER TABLE public.clients ADD CONSTRAINT clients_pipeline_stage_check CHECK (
  pipeline_stage IN ('new_lead', 'contacted', 'presentation_scheduled', 'presentation_completed', 'follow_up', 'customer', 'distributor', 'lost')
);

CREATE INDEX IF NOT EXISTS clients_user_pipeline_idx
  ON public.clients (user_id, pipeline_stage)
  WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_client_pipeline_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.pipeline_stage IS DISTINCT FROM OLD.pipeline_stage THEN
    NEW.pipeline_stage_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_client_pipeline_stage_trigger ON public.clients;
CREATE TRIGGER touch_client_pipeline_stage_trigger
BEFORE UPDATE OF pipeline_stage ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.touch_client_pipeline_stage();

CREATE OR REPLACE FUNCTION public.sync_client_pipeline_from_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE target_client_id uuid;
DECLARE canonical text;
BEGIN
  canonical := public.canonical_pipeline_stage(NEW.pipeline_stage::text);
  IF canonical IS NULL THEN RETURN NEW; END IF;
  SELECT client_id INTO target_client_id FROM public.appointments WHERE id = NEW.appointment_id;
  IF target_client_id IS NOT NULL THEN
    UPDATE public.clients SET pipeline_stage = canonical WHERE id = target_client_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_client_pipeline_appointment_trigger ON public.appointment_business_context;
CREATE TRIGGER sync_client_pipeline_appointment_trigger
AFTER INSERT OR UPDATE OF pipeline_stage ON public.appointment_business_context
FOR EACH ROW EXECUTE FUNCTION public.sync_client_pipeline_from_appointment();

CREATE OR REPLACE FUNCTION public.sync_client_pipeline_from_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE canonical text;
BEGIN
  canonical := public.canonical_pipeline_stage(NEW.pipeline_stage::text);
  IF canonical IS NOT NULL AND NEW.client_id IS NOT NULL THEN
    UPDATE public.clients SET pipeline_stage = canonical WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_client_pipeline_followup_trigger ON public.followups;
CREATE TRIGGER sync_client_pipeline_followup_trigger
AFTER INSERT OR UPDATE OF pipeline_stage ON public.followups
FOR EACH ROW WHEN (NEW.pipeline_stage IS NOT NULL)
EXECUTE FUNCTION public.sync_client_pipeline_from_followup();
