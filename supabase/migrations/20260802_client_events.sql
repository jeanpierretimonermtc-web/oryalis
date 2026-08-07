-- Traçabilité des changements (pipeline, rôle, annulation et suppression de RDV) —
-- table d'événements append-only par contact, alimentant l'onglet Activité.

CREATE TABLE client_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('pipeline_change', 'role_change', 'appointment_cancelled', 'appointment_deleted')),
  old_value text,
  new_value text,
  appointment_title text,
  appointment_date timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX client_events_client_id_idx ON client_events (client_id, created_at DESC);

ALTER TABLE client_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_events_select ON client_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY client_events_insert ON client_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Pas de policy UPDATE/DELETE : append-only, "automatique et non modifiable" (doc de refonte).
