-- MEETING-MODE-1 — "Comment ?" d'un rendez-vous : en personne / téléphone / visio / WhatsApp.
--   appointments.meeting_mode           : le mode ; location (adresse) et meeting_url (lien) restent
--                                         les compléments, inchangés.
--   user_business_profiles.office_address / default_meeting_url : préremplissage ("mon cabinet",
--                                         "mon lien visio").

ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS meeting_mode text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_meeting_mode_check') THEN
    ALTER TABLE public.appointments ADD CONSTRAINT appointments_meeting_mode_check
      CHECK (meeting_mode IS NULL OR meeting_mode IN ('in_person', 'phone', 'video', 'whatsapp'));
  END IF;
END $$;

ALTER TABLE public.user_business_profiles ADD COLUMN IF NOT EXISTS office_address text;
ALTER TABLE public.user_business_profiles ADD COLUMN IF NOT EXISTS default_meeting_url text;

-- Reprise : un lien visio → visio ; sinon une adresse → en personne. Le reste reste non précisé.
UPDATE public.appointments SET meeting_mode = 'video'
  WHERE meeting_mode IS NULL AND coalesce(meeting_url, '') <> '';
UPDATE public.appointments SET meeting_mode = 'in_person'
  WHERE meeting_mode IS NULL AND coalesce(location, '') <> '';

NOTIFY pgrst, 'reload schema';
