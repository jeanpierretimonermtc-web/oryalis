CREATE OR REPLACE FUNCTION public.has_advisor_access(target_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT plan IN ('pro', 'cabinet', 'advisor', 'leader', 'enterprise') FROM profiles WHERE id = target_user_id), false)
$$;

CREATE OR REPLACE FUNCTION public.get_my_entitlements()
RETURNS TABLE(plan text, advisor boolean, contact_limit integer, free_template_limit integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(p.plan, 'free'), public.has_advisor_access(auth.uid()),
         CASE WHEN public.has_advisor_access(auth.uid()) THEN NULL ELSE 20 END,
         CASE WHEN public.has_advisor_access(auth.uid()) THEN NULL ELSE 3 END
  FROM profiles p WHERE p.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_my_entitlements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_entitlements() TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_advisor_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_user uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF NOT public.has_advisor_access(target_user) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ADVISOR_PLAN_REQUIRED';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS advisor_orders_mutation ON public.orders;
CREATE TRIGGER advisor_orders_mutation BEFORE INSERT OR UPDATE OR DELETE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_advisor_mutation();
DROP TRIGGER IF EXISTS advisor_goals_mutation ON public.goals;
CREATE TRIGGER advisor_goals_mutation BEFORE INSERT OR UPDATE OR DELETE ON public.goals FOR EACH ROW EXECUTE FUNCTION public.enforce_advisor_mutation();
DROP TRIGGER IF EXISTS advisor_google_tokens_mutation ON public.google_calendar_tokens;
CREATE TRIGGER advisor_google_tokens_mutation BEFORE INSERT OR UPDATE ON public.google_calendar_tokens FOR EACH ROW EXECUTE FUNCTION public.enforce_advisor_mutation();
DROP TRIGGER IF EXISTS advisor_google_events_mutation ON public.google_calendar_events;
CREATE TRIGGER advisor_google_events_mutation BEFORE INSERT OR UPDATE ON public.google_calendar_events FOR EACH ROW EXECUTE FUNCTION public.enforce_advisor_mutation();
NOTIFY pgrst, 'reload schema';
