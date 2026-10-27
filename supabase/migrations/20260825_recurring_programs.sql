-- LRP-4 / LRP-4.1 — recurring_programs : concept générique multi-MLM (délibérément PAS
-- `lrp_programs`, voir LRP-4 §3). Devient progressivement la source de vérité du programme
-- récurrent, à la place de clients.lrp_status/next_lrp_date/lrp_frequency_value/
-- lrp_frequency_unit/lrp_start_date. Ces colonnes legacy sur `clients` ne sont PAS modifiées ni
-- supprimées par cette migration — gelées, conservées pour compatibilité et traçabilité
-- historique (LRP-4 §27).

-- ── Pré-requis intégrité (LRP-4.1 §10) ─────────────────────────────────────────────────────
-- Clé composite permettant à recurring_programs de référencer un client ET garantir, au niveau
-- FK (pas seulement RLS/service), que ce client appartient bien au même utilisateur que le
-- programme. Purement additive : id est déjà unique (PK), cette contrainte composite est
-- trivialement satisfaite par les données existantes.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_id_user_id_key;
ALTER TABLE public.clients ADD CONSTRAINT clients_id_user_id_key UNIQUE (id, user_id);

CREATE TABLE IF NOT EXISTS public.recurring_programs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,
  client_id            uuid NOT NULL,
  -- LRP-4.1 §1 — libellé propre à CETTE instance de programme (ex. "Nutrition"), distinct du nom
  -- global du concept (getLrpName(), ex. "Abonnement") configuré par utilisateur. Facultatif :
  -- NULL tant que l'utilisateur n'a pas nommé un programme précis (fallback vers le nom global
  -- côté affichage, jamais stocké en dur ici).
  label                text,
  status               text NOT NULL DEFAULT 'active',
  -- Nullable : une date de début inconnue (notamment lors du backfill legacy, §28) ne doit
  -- jamais être devinée.
  start_date           date,
  -- Nullable : un programme peut exister sans fréquence connue (legacy "non définie", même
  -- convention que clients.lrp_frequency_value/unit introduits en LRP-3).
  frequency_value      integer,
  frequency_unit       text,
  end_mode             text NOT NULL DEFAULT 'open_ended',
  occurrence_limit     integer,
  end_date             date,
  next_occurrence_date date,
  -- LRP-4.2 §8 — clé d'idempotence de CRÉATION, même mécanisme déjà éprouvé sur
  -- orders.closure_action_key : un réessai après un échec partiel (programme créé avec succès,
  -- mais la pose du lien orders.recurring_program_id ayant échoué) doit retrouver CE programme
  -- plutôt que d'en créer un second en double. NULL pour tout programme créé hors de ce contexte
  -- (édition manuelle, réactivation...).
  closure_action_key   text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS recurring_programs_client_closure_key_idx
  ON public.recurring_programs (client_id, closure_action_key)
  WHERE closure_action_key IS NOT NULL;

-- Composite FK (LRP-4.1 §10) : garantit en base, pas seulement côté service/UI, que
-- recurring_programs.user_id est bien le propriétaire du client référencé — impossible de créer
-- un programme pour un client appartenant à un autre utilisateur, y compris via un accès direct
-- à la base hors application.
ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_client_id_user_id_fkey;
ALTER TABLE public.recurring_programs
  ADD CONSTRAINT recurring_programs_client_id_user_id_fkey
    FOREIGN KEY (client_id, user_id) REFERENCES public.clients(id, user_id) ON DELETE CASCADE;

ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_status_check;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_status_check
  CHECK (status IN ('active', 'paused', 'cancelled', 'completed'));

ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_frequency_value_check;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_frequency_value_check
  CHECK (frequency_value IS NULL OR frequency_value > 0);

ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_frequency_unit_check;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_frequency_unit_check
  CHECK (frequency_unit IS NULL OR frequency_unit IN ('week', 'month'));

ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_end_mode_check;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_end_mode_check
  CHECK (end_mode IN ('open_ended', 'occurrence_limit', 'end_date'));

ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_occurrence_limit_check;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_occurrence_limit_check
  CHECK (occurrence_limit IS NULL OR occurrence_limit > 0);

-- Cohérence mode de fin ↔ champs renseignés (LRP-4 §7) : jamais occurrence_limit/end_date
-- orphelins d'un end_mode qui ne les utilise pas, jamais un end_mode annonçant une limite sans
-- la valeur qui va avec.
ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_end_mode_consistency_check;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_end_mode_consistency_check
  CHECK (
    (end_mode = 'open_ended'        AND occurrence_limit IS NULL     AND end_date IS NULL) OR
    (end_mode = 'occurrence_limit'  AND occurrence_limit IS NOT NULL AND end_date IS NULL) OR
    (end_mode = 'end_date'          AND end_date IS NOT NULL         AND occurrence_limit IS NULL)
  );

ALTER TABLE public.recurring_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_programs_user_policy ON public.recurring_programs;
CREATE POLICY recurring_programs_user_policy ON public.recurring_programs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS recurring_programs_client_id_idx ON public.recurring_programs(client_id);
CREATE INDEX IF NOT EXISTS recurring_programs_user_status_idx ON public.recurring_programs(user_id, status);

-- Volontairement PAS de UNIQUE(client_id) — LRP-4 §11 : un contact doit pouvoir porter
-- plusieurs programmes récurrents (ex. nutrition mensuel + sport bimensuel).

-- Lien commande → programme (LRP-4 §9). Nullable : une commande normale n'a pas de programme.
-- `is_lrp` reste inchangé (colonne + toutes ses lectures actuelles) — compatibilité LRP-4 §10 :
-- ce n'est plus la relation métier principale, mais elle n'est ni supprimée ni réinterprétée.
-- FK simple à `id` (pas composite) : ON DELETE SET NULL sur une FK composite forcerait
-- Postgres à mettre à NULL TOUTES les colonnes référençantes, y compris orders.user_id/
-- client_id qui sont NOT NULL — l'invariant multi-colonnes est donc garanti par un trigger
-- dédié ci-dessous plutôt que par la forme de la FK elle-même (LRP-4.1 §10).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS recurring_program_id uuid REFERENCES public.recurring_programs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_recurring_program_id_idx ON public.orders(recurring_program_id);

-- LRP-4.3 — identité d'ÉCHÉANCE, distincte de order_date : la date du CYCLE du programme que
-- cette commande consomme (ex. commande enregistrée le 28/09 pour l'échéance prévue le 25/09 →
-- recurring_occurrence_date = 25/09, order_date reste 28/09, jamais écrasée). Plusieurs
-- commandes peuvent légitimement partager la même recurring_occurrence_date (commande
-- principale + commande complémentaire du même cycle) — volontairement PAS de contrainte
-- UNIQUE. NULL pour toute commande non liée à un programme, ou legacy is_lrp=true dont
-- l'échéance ne peut être déterminée avec certitude (jamais devinée, LRP-4 §19/§28).
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS recurring_occurrence_date date;

CREATE INDEX IF NOT EXISTS orders_recurring_program_occurrence_idx
  ON public.orders(recurring_program_id, recurring_occurrence_date);

-- ── Trigger d'intégrité (LRP-4.1 §10) ──────────────────────────────────────────────────────
-- Garantit qu'une commande liée à un programme (recurring_program_id non nul) appartient
-- obligatoirement au même utilisateur ET au même client que ce programme — impossible de lier
-- par erreur (ou via un accès direct hors application) la commande d'un client au programme
-- d'un autre. Se déclenche uniquement quand une des 3 colonnes concernées change.
CREATE OR REPLACE FUNCTION public.check_order_recurring_program_ownership()
RETURNS trigger AS $$
BEGIN
  IF NEW.recurring_program_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.recurring_programs rp
      WHERE rp.id = NEW.recurring_program_id
        AND rp.user_id = NEW.user_id
        AND rp.client_id = NEW.client_id
    ) THEN
      RAISE EXCEPTION 'orders.recurring_program_id must reference a recurring_programs row owned by the same user_id and client_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS orders_recurring_program_ownership_trigger ON public.orders;
CREATE TRIGGER orders_recurring_program_ownership_trigger
  BEFORE INSERT OR UPDATE OF recurring_program_id, user_id, client_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.check_order_recurring_program_ownership();

-- ── Backfill (LRP-4 §28) ────────────────────────────────────────────────────────────────────
-- Un programme "legacy" par contact déjà engagé dans l'ancien système (statut renseigné hors
-- 'not_enrolled' OU une next_lrp_date déjà présente). end_mode toujours 'open_ended' : aucune
-- durée historique n'est déduite (le concept de durée n'existait pas avant LRP-4). label laissé
-- NULL (fallback affichage vers le nom global, LRP-4.1 §1). Idempotent : protégé par NOT
-- EXISTS, une ré-exécution de cette migration ne duplique aucun programme.
-- Les anciennes commandes `is_lrp=true` ne sont PAS rattachées automatiquement à ce programme
-- (recurring_program_id reste NULL) — LRP-4 §19/§28 : aucune association de commande historique
-- ne peut être établie avec une certitude suffisante (dates, cycles, cadence tous inconnus avant
-- l'existence même de la fréquence). Elles restent des "commandes récurrentes historiques non
-- rattachées" — is_lrp=true, recurring_program_id=NULL, état stable et documenté.
INSERT INTO public.recurring_programs
  (user_id, client_id, status, start_date, frequency_value, frequency_unit, end_mode, next_occurrence_date)
SELECT
  c.user_id, c.id, c.lrp_status, c.lrp_start_date, c.lrp_frequency_value, c.lrp_frequency_unit,
  'open_ended', c.next_lrp_date
FROM public.clients c
WHERE (c.lrp_status <> 'not_enrolled' OR c.next_lrp_date IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM public.recurring_programs rp WHERE rp.client_id = c.id);

NOTIFY pgrst, 'reload schema';
