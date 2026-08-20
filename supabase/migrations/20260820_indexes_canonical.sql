-- Index canoniques (P2.3.5) — les 13 index de catégorie A retenus par l'audit P2.3.4
-- parmi les 21 index legacy identifiés en P2.3.1. Définitions reprises à l'identique de
-- la production (revérifiées en lecture seule juste avant écriture de ce fichier).
-- Les 8 autres (1 redondant, 5 obsolètes, 2 différés) restent volontairement absents —
-- voir rapport P2.3.4.
--
-- CREATE INDEX IF NOT EXISTS uniquement : sur une reconstruction from-scratch, crée les
-- 13 index ; sur la production actuelle, où ils existent déjà avec cette même
-- définition exacte, no-op réel.

CREATE INDEX IF NOT EXISTS idx_appointments_user_id   ON public.appointments (user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON public.appointments (client_id);
CREATE INDEX IF NOT EXISTS idx_appointments_start_at  ON public.appointments (start_at);
CREATE INDEX IF NOT EXISTS idx_appointments_status    ON public.appointments (status);

CREATE INDEX IF NOT EXISTS idx_appt_biz_appointment_id ON public.appointment_business_context (appointment_id);

CREATE INDEX IF NOT EXISTS idx_appt_notes_appointment_id ON public.appointment_notes (appointment_id);

CREATE INDEX IF NOT EXISTS idx_appt_tasks_appointment_id ON public.appointment_tasks (appointment_id);
CREATE INDEX IF NOT EXISTS idx_appt_tasks_user_id        ON public.appointment_tasks (user_id);

CREATE INDEX IF NOT EXISTS idx_appt_attendees_appointment_id ON public.appointment_attendees (appointment_id);

CREATE INDEX IF NOT EXISTS idx_clients_sponsor_id ON public.clients (sponsor_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_order_date ON public.orders (user_id, order_date DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_user_unread ON public.alerts (user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_dedup       ON public.alerts (user_id, type, client_id, created_at);
