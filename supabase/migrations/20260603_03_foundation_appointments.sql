-- Socle fondationnel (3/4) — cluster rendez-vous.
-- Source structurelle : DB réelle (information_schema / pg_catalog), recoupée avec
-- scripts/legacy-migrations/migrate_agenda2.mjs (structure la plus récente du cluster —
-- migrate_agenda.mjs a été DROP/recréé par lui et n'est plus la source de vérité pour
-- les tables, seulement pour les 8 enums déjà posés en 20260603_01).
-- Ordre : appointments -> appointment_notes / appointment_business_context /
-- appointment_tasks / appointment_attendees (toutes en FK vers appointments).

-- ============================================
-- APPOINTMENTS — structure de base. NE PAS inclure followup_of_appointment_id
-- (20260805_appointment_outcome_lot1_2.sql) ni native_event_id
-- (add_native_event_id_to_appointments.sql, colonne morte, cf. rapport) : chacune a
-- déjà son ADD COLUMN IF NOT EXISTS correctement tracké plus loin.
-- ============================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,
  client_id            uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  title                text NOT NULL,
  appointment_type     public.appointment_type_enum NOT NULL DEFAULT 'other',
  status               public.appointment_status_enum NOT NULL DEFAULT 'scheduled',
  start_at             timestamptz NOT NULL,
  end_at               timestamptz NOT NULL,
  duration_minutes     integer GENERATED ALWAYS AS (
                         EXTRACT(EPOCH FROM (end_at - start_at))::integer / 60
                       ) STORED,
  timezone             text NOT NULL DEFAULT 'Europe/Paris',
  location             text,
  meeting_url          text,
  provider             text NOT NULL DEFAULT 'oryalis',
  external_calendar_id text,
  external_event_id    text,
  last_synced_at       timestamptz,
  sync_status          text,
  cancelled_at         timestamptz,
  cancellation_reason  text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_select ON public.appointments;
CREATE POLICY appointments_select ON public.appointments FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS appointments_insert ON public.appointments;
CREATE POLICY appointments_insert ON public.appointments FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS appointments_update ON public.appointments;
CREATE POLICY appointments_update ON public.appointments FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS appointments_delete ON public.appointments;
CREATE POLICY appointments_delete ON public.appointments FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.appointments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- APPOINTMENT_NOTES
-- ============================================
CREATE TABLE IF NOT EXISTS public.appointment_notes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id     uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  client_notes       text,
  internal_notes     text,
  objections         text,
  needs_identified   text,
  products_discussed text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id)
);

ALTER TABLE public.appointment_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_notes_select ON public.appointment_notes;
CREATE POLICY appointment_notes_select ON public.appointment_notes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_notes.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_notes_insert ON public.appointment_notes;
CREATE POLICY appointment_notes_insert ON public.appointment_notes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_notes.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_notes_update ON public.appointment_notes;
CREATE POLICY appointment_notes_update ON public.appointment_notes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_notes.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_notes_delete ON public.appointment_notes;
CREATE POLICY appointment_notes_delete ON public.appointment_notes FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_notes.appointment_id AND a.user_id = auth.uid())
);

DROP TRIGGER IF EXISTS set_updated_at ON public.appointment_notes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.appointment_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- APPOINTMENT_BUSINESS_CONTEXT — commercial_intent créée SCALAIRE (forme historique
-- attendue par migrate_agenda2.mjs) : 20260726_commercial_intent_array.sql la convertit
-- ensuite en tableau via ALTER COLUMN ... TYPE. NE PAS créer directement en tableau.
-- NE PAS inclure no_followup_required / outcome / outcome_details / outcome_other_label
-- / outcome_revision : chacune a déjà son ADD COLUMN IF NOT EXISTS tracké plus loin.
-- ============================================
CREATE TABLE IF NOT EXISTS public.appointment_business_context (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id       uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  brand_id             uuid REFERENCES public.catalogs(id) ON DELETE SET NULL,
  catalog_id           uuid REFERENCES public.catalogs(id) ON DELETE SET NULL,
  main_product_id      uuid REFERENCES public.catalog_products(id) ON DELETE SET NULL,
  pipeline_stage       public.pipeline_stage_enum NOT NULL DEFAULT 'new_lead',
  prospect_temperature public.prospect_temperature_enum,
  commercial_intent    public.commercial_intent_enum,
  estimated_value      numeric,
  currency             text NOT NULL DEFAULT 'EUR',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id)
);

ALTER TABLE public.appointment_business_context ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_business_context_select ON public.appointment_business_context;
CREATE POLICY appointment_business_context_select ON public.appointment_business_context FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_business_context.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_business_context_insert ON public.appointment_business_context;
CREATE POLICY appointment_business_context_insert ON public.appointment_business_context FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_business_context.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_business_context_update ON public.appointment_business_context;
CREATE POLICY appointment_business_context_update ON public.appointment_business_context FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_business_context.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_business_context_delete ON public.appointment_business_context;
CREATE POLICY appointment_business_context_delete ON public.appointment_business_context FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_business_context.appointment_id AND a.user_id = auth.uid())
);

DROP TRIGGER IF EXISTS set_updated_at ON public.appointment_business_context;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.appointment_business_context
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- APPOINTMENT_TASKS
-- ============================================
CREATE TABLE IF NOT EXISTS public.appointment_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  user_id        uuid NOT NULL,
  client_id      uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  title          text NOT NULL,
  task_type      public.task_type_enum NOT NULL DEFAULT 'follow_up',
  priority       public.task_priority_enum NOT NULL DEFAULT 'medium',
  status         public.task_status_enum NOT NULL DEFAULT 'pending',
  due_at         timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.appointment_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_tasks_select ON public.appointment_tasks;
CREATE POLICY appointment_tasks_select ON public.appointment_tasks FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS appointment_tasks_insert ON public.appointment_tasks;
CREATE POLICY appointment_tasks_insert ON public.appointment_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS appointment_tasks_update ON public.appointment_tasks;
CREATE POLICY appointment_tasks_update ON public.appointment_tasks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS appointment_tasks_delete ON public.appointment_tasks;
CREATE POLICY appointment_tasks_delete ON public.appointment_tasks FOR DELETE USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.appointment_tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.appointment_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- APPOINTMENT_ATTENDEES
-- ============================================
CREATE TABLE IF NOT EXISTS public.appointment_attendees (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  client_id      uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  external_name  text,
  external_email text,
  status         text NOT NULL DEFAULT 'invited',
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.appointment_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_attendees_select ON public.appointment_attendees;
CREATE POLICY appointment_attendees_select ON public.appointment_attendees FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_attendees.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_attendees_insert ON public.appointment_attendees;
CREATE POLICY appointment_attendees_insert ON public.appointment_attendees FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_attendees.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_attendees_update ON public.appointment_attendees;
CREATE POLICY appointment_attendees_update ON public.appointment_attendees FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_attendees.appointment_id AND a.user_id = auth.uid())
);
DROP POLICY IF EXISTS appointment_attendees_delete ON public.appointment_attendees;
CREATE POLICY appointment_attendees_delete ON public.appointment_attendees FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_attendees.appointment_id AND a.user_id = auth.uid())
);

NOTIFY pgrst, 'reload schema';
