CREATE TABLE IF NOT EXISTS public.product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL, dedupe_key text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_product_events_name_created ON public.product_events(event_name, created_at);
ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_events_insert_own ON public.product_events;
CREATE POLICY product_events_insert_own ON public.product_events FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS product_events_select_own ON public.product_events;
CREATE POLICY product_events_select_own ON public.product_events FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.record_product_event(p_user uuid, p_name text, p_key text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO product_events(user_id, event_name, dedupe_key, metadata) VALUES(p_user, p_name, p_key, p_metadata)
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.record_product_event(uuid,text,text,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.analytics_profile_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN PERFORM record_product_event(NEW.id, 'registration_completed', 'registration'); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS analytics_profile_created_trigger ON public.profiles;
CREATE TRIGGER analytics_profile_created_trigger AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.analytics_profile_created();

CREATE OR REPLACE FUNCTION public.analytics_client_created() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM clients WHERE user_id=NEW.user_id AND archived_at IS NULL;
  PERFORM record_product_event(NEW.user_id, 'first_contact_created', 'first_contact', jsonb_build_object('source','client'));
  IF n >= 18 THEN PERFORM record_product_event(NEW.user_id, 'quota_approached', 'quota_approached', jsonb_build_object('count',n)); END IF;
  IF n >= 20 THEN PERFORM record_product_event(NEW.user_id, 'quota_reached', 'quota_reached', jsonb_build_object('count',n)); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS analytics_client_created_trigger ON public.clients;
CREATE TRIGGER analytics_client_created_trigger AFTER INSERT ON public.clients FOR EACH ROW EXECUTE FUNCTION public.analytics_client_created();

CREATE OR REPLACE FUNCTION public.analytics_contact_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE completed boolean := false; uid uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  IF TG_OP='INSERT' THEN PERFORM record_product_event(uid, 'first_action_scheduled', 'first_action_scheduled', jsonb_build_object('source',TG_TABLE_NAME)); END IF;
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='followups' THEN completed := NEW.done AND NOT OLD.done;
    ELSIF TG_TABLE_NAME='appointments' THEN completed := NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed';
    ELSIF TG_TABLE_NAME='interactions' THEN completed := NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL; END IF;
    IF completed THEN PERFORM record_product_event(uid, 'first_action_completed', 'first_action_completed', jsonb_build_object('source',TG_TABLE_NAME)); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS analytics_followup_trigger ON public.followups;
CREATE TRIGGER analytics_followup_trigger AFTER INSERT OR UPDATE ON public.followups FOR EACH ROW EXECUTE FUNCTION public.analytics_contact_event();
DROP TRIGGER IF EXISTS analytics_appointment_trigger ON public.appointments;
CREATE TRIGGER analytics_appointment_trigger AFTER INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.analytics_contact_event();
DROP TRIGGER IF EXISTS analytics_interaction_trigger ON public.interactions;
CREATE TRIGGER analytics_interaction_trigger AFTER INSERT OR UPDATE ON public.interactions FOR EACH ROW EXECUTE FUNCTION public.analytics_contact_event();

CREATE OR REPLACE FUNCTION public.analytics_onboarding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.event_name='completed' THEN PERFORM record_product_event(NEW.user_id, 'onboarding_completed', 'onboarding_completed', NEW.metadata);
  ELSIF NEW.event_name IN ('import_chosen','action_skipped') THEN PERFORM record_product_event(NEW.user_id, 'onboarding_skipped', 'onboarding_skipped', jsonb_build_object('choice',NEW.event_name)); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS analytics_onboarding_trigger ON public.onboarding_events;
CREATE TRIGGER analytics_onboarding_trigger AFTER INSERT ON public.onboarding_events FOR EACH ROW EXECUTE FUNCTION public.analytics_onboarding();

CREATE OR REPLACE FUNCTION public.analytics_subscription() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status IN ('trialing','active') THEN PERFORM record_product_event(NEW.user_id,'subscription_started','subscription_started:'||NEW.id,jsonb_build_object('provider',NEW.provider,'plan',NEW.plan));
  ELSIF NEW.status='past_due' THEN PERFORM record_product_event(NEW.user_id,'subscription_failed','subscription_failed:'||NEW.id||':'||NEW.updated_at,jsonb_build_object('provider',NEW.provider));
  ELSIF NEW.status IN ('cancelled','expired') THEN PERFORM record_product_event(NEW.user_id,'subscription_cancelled','subscription_cancelled:'||NEW.id,jsonb_build_object('provider',NEW.provider)); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS analytics_subscription_trigger ON public.subscriptions;
CREATE TRIGGER analytics_subscription_trigger AFTER INSERT OR UPDATE OF status ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.analytics_subscription();

CREATE TABLE IF NOT EXISTS public.pilot_participants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, cohort text NOT NULL DEFAULT 'pilot-1',
  started_at timestamptz NOT NULL DEFAULT now(), interview_day1_at timestamptz, interview_day7_at timestamptz,
  interview_day30_at timestamptz, willingness_to_pay smallint CHECK(willingness_to_pay BETWEEN 0 AND 10), notes text
);
ALTER TABLE public.pilot_participants ENABLE ROW LEVEL SECURITY;
-- No client policies: the pilot cohort is managed only with trusted database access.
NOTIFY pgrst, 'reload schema';
