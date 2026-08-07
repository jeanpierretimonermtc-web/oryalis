-- Consentement de suivi (Phase 3 RGPD, priorité avancée après analyse d'un cas réel) : les
-- praticiennes gèrent aujourd'hui ce consentement manuellement, hors de l'app. On trace au
-- minimum QUAND il a été recueilli, sans construire tout de suite un système de
-- consentements multiples/révocables — juste ce qui débloque l'usage réel observé.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS tracking_consent_at timestamptz;

NOTIFY pgrst, 'reload schema';
