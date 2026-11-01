-- CARE-JOURNEY-1 — Accompagnement client : un parcours daté (J+30, J+60, J+90, bilan J+120…)
-- dont chaque étape est une relance (followups) portant un message prêt à envoyer.
--
-- Nom volontairement distinct de recurring_programs (programme récurrent = LRP/abonnement) et de
-- clients.journey_stage (étape de parcours commercial) : "care journey" = accompagnement.
--
-- Les étapes ne sont PAS une nouvelle table : ce sont des relances ordinaires, pour qu'elles
-- apparaissent sans nouveau code dans l'écran Relances, la prochaine action du contact, les
-- compteurs du tableau de bord et les notifications.
--
-- Purement additive : aucune donnée existante n'est modifiée ni supprimée.

CREATE TABLE IF NOT EXISTS public.care_journeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  client_id     uuid NOT NULL,
  -- Clé du modèle de départ (features/care/careTemplates.ts), conservée pour l'historique ;
  -- les étapes réellement créées (dates/messages modifiés) font foi, pas le modèle.
  template_key  text NOT NULL,
  label         text NOT NULL,
  start_date    date NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  -- Même convention que cancelled_at ailleurs : horodatage nullable, jamais un booléen.
  stopped_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Le client doit appartenir au même utilisateur que l'accompagnement (même garantie en base que
-- recurring_programs, via la contrainte composite clients_id_user_id_key déjà présente).
ALTER TABLE public.care_journeys DROP CONSTRAINT IF EXISTS care_journeys_client_id_user_id_fkey;
ALTER TABLE public.care_journeys
  ADD CONSTRAINT care_journeys_client_id_user_id_fkey
    FOREIGN KEY (client_id, user_id) REFERENCES public.clients(id, user_id) ON DELETE CASCADE;

ALTER TABLE public.care_journeys DROP CONSTRAINT IF EXISTS care_journeys_status_check;
ALTER TABLE public.care_journeys ADD CONSTRAINT care_journeys_status_check
  CHECK (status IN ('active', 'completed', 'stopped'));

-- Un seul accompagnement actif par contact (les terminés/arrêtés restent en historique).
CREATE UNIQUE INDEX IF NOT EXISTS care_journeys_one_active_per_client_uidx
  ON public.care_journeys (client_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS care_journeys_user_status_idx ON public.care_journeys (user_id, status);

ALTER TABLE public.care_journeys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS care_journeys_user_policy ON public.care_journeys;
CREATE POLICY care_journeys_user_policy ON public.care_journeys
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Étapes = relances ─────────────────────────────────────────────────────────────────────────
-- ON DELETE CASCADE : un accompagnement n'est jamais supprimé par l'application (il est arrêté,
-- ses étapes à venir annulées via cancelled_at) ; la cascade ne joue qu'à la suppression du
-- contact, qui supprime déjà ses relances.
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS care_journey_id uuid REFERENCES public.care_journeys(id) ON DELETE CASCADE;
-- Clé stable de l'étape dans son accompagnement (d30, d60, d90, d120, birthday, anniversary…).
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS care_step_key text;
-- Message prêt à envoyer. Distinct de `content`, qui sert déjà d'intitulé de repli à l'écran.
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS message_body text;

-- Idempotence : une même étape ne peut exister qu'une fois par accompagnement.
CREATE UNIQUE INDEX IF NOT EXISTS followups_care_step_uidx
  ON public.followups (care_journey_id, care_step_key)
  WHERE care_journey_id IS NOT NULL;

-- Une étape d'accompagnement porte toujours sa clé, et inversement.
ALTER TABLE public.followups DROP CONSTRAINT IF EXISTS followups_care_step_consistency_check;
ALTER TABLE public.followups ADD CONSTRAINT followups_care_step_consistency_check
  CHECK ((care_journey_id IS NULL) = (care_step_key IS NULL));

-- Une étape appartient obligatoirement au même utilisateur ET au même contact que son
-- accompagnement (même principe que check_order_recurring_program_ownership).
CREATE OR REPLACE FUNCTION public.check_followup_care_journey_ownership()
RETURNS trigger AS $$
BEGIN
  IF NEW.care_journey_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.care_journeys cj
      WHERE cj.id = NEW.care_journey_id
        AND cj.user_id = NEW.user_id
        AND cj.client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'followups.care_journey_id must reference a care_journeys row owned by the same user_id and client_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS followups_care_journey_ownership_trigger ON public.followups;
CREATE TRIGGER followups_care_journey_ownership_trigger
  BEFORE INSERT OR UPDATE OF care_journey_id, user_id, client_id ON public.followups
  FOR EACH ROW EXECUTE FUNCTION public.check_followup_care_journey_ownership();

-- ── Favoris d'accompagnement ───────────────────────────────────────────────────────────────
-- Modèles personnels nommés par l'utilisateur (jours, canaux, libellés et messages). Les messages
-- y sont stockés avec leurs variables ({prénom}, {mon_prénom}), jamais avec le prénom d'un contact.
-- steps : [{ "offsetDays": 30, "channel": "whatsapp", "label": "J+30 · …", "message": "…" }, …]
CREATE TABLE IF NOT EXISTS public.care_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  steps       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.care_templates DROP CONSTRAINT IF EXISTS care_templates_name_check;
ALTER TABLE public.care_templates ADD CONSTRAINT care_templates_name_check
  CHECK (length(btrim(name)) BETWEEN 1 AND 80);

ALTER TABLE public.care_templates DROP CONSTRAINT IF EXISTS care_templates_steps_check;
ALTER TABLE public.care_templates ADD CONSTRAINT care_templates_steps_check
  CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 30);

-- Deux favoris d'un même utilisateur ne portent pas le même nom (casse ignorée).
CREATE UNIQUE INDEX IF NOT EXISTS care_templates_user_name_uidx
  ON public.care_templates (user_id, lower(btrim(name)));

ALTER TABLE public.care_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS care_templates_user_policy ON public.care_templates;
CREATE POLICY care_templates_user_policy ON public.care_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
