-- Socle fondationnel (4/4) — tables CRM secondaires et intégrations externes.
-- Aucune de ces 7 tables n'est jamais référencée par nom dans les 31 migrations
-- trackées existantes (à l'exception d'un CREATE/DROP TRIGGER sur goals et
-- google_calendar_tokens/events dans 20260712_advisor_entitlements.sql) : leur
-- structure complète est donc posée ici une fois pour toutes, aucune migration
-- ultérieure ne viendra jamais la compléter.

-- ============================================
-- ALERTS
-- ============================================
CREATE TABLE IF NOT EXISTS public.alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  type       text NOT NULL,
  client_id  uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  message    text NOT NULL,
  action_url text,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alerts_user_policy ON public.alerts;
CREATE POLICY alerts_user_policy ON public.alerts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- GOALS — première utilisation trackée : 20260712_advisor_entitlements.sql (trigger).
-- ============================================
CREATE TABLE IF NOT EXISTS public.goals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  period     text NOT NULL,
  metric     text NOT NULL,
  target     integer NOT NULL,
  current    integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period, metric)
);

ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS goals_user_policy ON public.goals;
CREATE POLICY goals_user_policy ON public.goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- INTERACTIONS — première utilisation trackée : 20260712_product_analytics.sql
-- (trigger) ; corps de fonction dans 20260712_contact_activity_summary.sql.
-- ============================================
CREATE TABLE IF NOT EXISTS public.interactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  interaction_type   text NOT NULL,
  scheduled_at       timestamptz,
  completed_at       timestamptz,
  subject            text,
  summary            text,
  needs_identified   text,
  objections         text,
  interest_level     text,
  notes_brutes       text,
  ai_summary         text,
  ai_next_actions    text,
  ai_followup_draft  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz
);

ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS interactions_user_policy ON public.interactions;
CREATE POLICY interactions_user_policy ON public.interactions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- GOOGLE_CALENDAR_TOKENS — première utilisation trackée :
-- 20260712_advisor_entitlements.sql (trigger).
-- ============================================
CREATE TABLE IF NOT EXISTS public.google_calendar_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  access_token  text NOT NULL,
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  token_type    text DEFAULT 'Bearer',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.google_calendar_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_calendar_tokens_user ON public.google_calendar_tokens;
CREATE POLICY google_calendar_tokens_user ON public.google_calendar_tokens
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- GOOGLE_CALENDAR_EVENTS — première utilisation trackée :
-- 20260712_advisor_entitlements.sql (trigger). FK vers appointments, posée ici
-- puisque appointments existe déjà depuis 20260603_03.
-- ============================================
CREATE TABLE IF NOT EXISTS public.google_calendar_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  appointment_id  uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
  google_event_id text NOT NULL,
  calendar_id     text NOT NULL DEFAULT 'primary',
  last_synced_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, appointment_id),
  UNIQUE (user_id, google_event_id)
);

ALTER TABLE public.google_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_calendar_events_user ON public.google_calendar_events;
CREATE POLICY google_calendar_events_user ON public.google_calendar_events
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- USER_BUSINESS_PROFILES — structure de base + active_modules (lue par
-- 20260731_first_order_automation.sql avant d'être jamais créée autrement).
-- NE PAS inclure automation_delays / custom_lrp_name : chacune a déjà son
-- ADD COLUMN IF NOT EXISTS tracké plus loin.
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_business_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  activity_type     text NOT NULL DEFAULT 'generic',
  custom_brand_name text,
  active_modules    text[] NOT NULL DEFAULT ARRAY['products', 'renewals_lrp', 'downline', 'goals', 'calendar_sync']::text[],
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_business_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_business_profiles_user_policy ON public.user_business_profiles;
CREATE POLICY user_business_profiles_user_policy ON public.user_business_profiles
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- USER_STATUS_LABELS — jamais référencée dans les 31 migrations trackées.
-- ============================================
CREATE TABLE IF NOT EXISTS public.user_status_labels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  status_key   text NOT NULL,
  custom_label text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, status_key)
);

ALTER TABLE public.user_status_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_status_labels_user_policy ON public.user_status_labels;
CREATE POLICY user_status_labels_user_policy ON public.user_status_labels
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
