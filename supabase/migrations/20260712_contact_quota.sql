-- Phase 1 monetisation: explicit contact archiving and server-enforced free quota.
-- Prepared for production deployment; do not run without reviewing the current schema.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Historical migrations created the same ownership policy twice.
-- Keep the explicit policy with USING + WITH CHECK and remove the duplicate.
DROP POLICY IF EXISTS "user owns clients" ON public.clients;

CREATE INDEX IF NOT EXISTS clients_user_active_quota_idx
  ON public.clients (user_id)
  WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION public.enforce_free_contact_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_plan text;
  active_count integer;
BEGIN
  -- Archived rows do not consume quota. Updating an already-active row is allowed.
  IF NEW.archived_at IS NOT NULL OR (TG_OP = 'UPDATE' AND OLD.archived_at IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(plan, 'free')
    INTO current_plan
    FROM public.profiles
   WHERE id = NEW.user_id;

  -- Keep legacy paid plan names valid during the pricing transition.
  IF current_plan IN ('pro', 'cabinet', 'advisor', 'leader', 'enterprise') THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO active_count
    FROM public.clients
   WHERE user_id = NEW.user_id
     AND archived_at IS NULL
     AND (TG_OP = 'INSERT' OR id <> NEW.id);

  IF active_count >= 20 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CONTACT_QUOTA_REACHED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_free_contact_quota_trigger ON public.clients;
CREATE TRIGGER enforce_free_contact_quota_trigger
BEFORE INSERT OR UPDATE OF archived_at ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.enforce_free_contact_quota();

CREATE OR REPLACE FUNCTION public.get_contact_quota()
RETURNS TABLE(plan text, active_count bigint, contact_limit integer, remaining integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(p.plan, 'free') AS plan,
    count(c.id) AS active_count,
    CASE WHEN COALESCE(p.plan, 'free') IN ('pro', 'cabinet', 'advisor', 'leader', 'enterprise')
      THEN NULL ELSE 20 END AS contact_limit,
    CASE WHEN COALESCE(p.plan, 'free') IN ('pro', 'cabinet', 'advisor', 'leader', 'enterprise')
      THEN NULL ELSE GREATEST(20 - count(c.id)::integer, 0) END AS remaining
  FROM public.profiles p
  LEFT JOIN public.clients c ON c.user_id = p.id AND c.archived_at IS NULL
  WHERE p.id = auth.uid()
  GROUP BY p.plan;
$$;

REVOKE ALL ON FUNCTION public.get_contact_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_contact_quota() TO authenticated;
