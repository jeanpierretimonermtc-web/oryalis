-- Choix des calendriers Google : lesquels s'affichent dans Oryalis, lequel reçoit les RDV.
-- Le calendrier principal garde l'identifiant 'primary', déjà utilisé par google_calendar_events.
-- Aucune ligne pour un compte = calendrier principal seul, comme avant.

CREATE TABLE IF NOT EXISTS public.google_calendars (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_id text NOT NULL,
  name        text NOT NULL,
  color       text,
  is_primary  boolean NOT NULL DEFAULT false,
  can_write   boolean NOT NULL DEFAULT false,
  is_visible  boolean NOT NULL DEFAULT false,
  is_target   boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, calendar_id),
  CONSTRAINT google_calendars_target_writable CHECK (NOT is_target OR can_write)
);

-- Un seul calendrier reçoit les RDV, pour ne jamais les créer en double chez Google.
CREATE UNIQUE INDEX IF NOT EXISTS google_calendars_one_target
  ON public.google_calendars (user_id) WHERE is_target;

ALTER TABLE public.google_calendars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_calendars_user ON public.google_calendars;
CREATE POLICY google_calendars_user ON public.google_calendars
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.google_calendars FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendars TO authenticated;

DROP TRIGGER IF EXISTS advisor_google_calendars_mutation ON public.google_calendars;
CREATE TRIGGER advisor_google_calendars_mutation
  BEFORE INSERT OR UPDATE ON public.google_calendars
  FOR EACH ROW EXECUTE FUNCTION public.enforce_advisor_mutation();

-- Les événements déjà importés retrouvent leur calendrier d'origine.
UPDATE public.appointments a
   SET external_calendar_id = e.calendar_id
  FROM public.google_calendar_events e
 WHERE e.appointment_id = a.id
   AND a.provider = 'google'
   AND a.external_calendar_id IS NULL;
