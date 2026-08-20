ALTER TABLE appointments
ADD COLUMN IF NOT EXISTS native_event_id TEXT DEFAULT NULL;

COMMENT ON COLUMN appointments.native_event_id IS
  'ID de l''événement dans le calendrier natif iOS/Android';
