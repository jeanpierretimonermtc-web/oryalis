CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name text NOT NULL CHECK (event_name IN ('started', 'profile_completed', 'contact_created', 'import_chosen', 'action_created', 'action_skipped', 'completed')),
  step smallint CHECK (step BETWEEN 1 AND 3),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_user_created ON public.onboarding_events(user_id, created_at);
ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS onboarding_events_own_select ON public.onboarding_events;
CREATE POLICY onboarding_events_own_select ON public.onboarding_events FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS onboarding_events_own_insert ON public.onboarding_events;
CREATE POLICY onboarding_events_own_insert ON public.onboarding_events FOR INSERT WITH CHECK (auth.uid() = user_id);
NOTIFY pgrst, 'reload schema';
