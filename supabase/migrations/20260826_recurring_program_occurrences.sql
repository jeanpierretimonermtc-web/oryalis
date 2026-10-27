-- LRP-5 — recurring_program_occurrences : sépare enfin PROGRAMME / ÉCHÉANCE / COMMANDE.
-- Problème résolu : dans beaucoup d'entreprises MLM, l'envoi d'une commande récurrente est
-- automatique côté entreprise — Oryalis n'a jamais eu de notion d'"échéance" indépendante d'une
-- commande enregistrée manuellement, obligeant l'utilisateur à créer une commande juste pour
-- faire progresser son programme, ou empêchant de représenter une échéance "à confirmer" sans
-- prétendre qu'une commande a réellement été envoyée. Une ÉCHÉANCE n'est PAS une commande :
-- 0, 1 ou plusieurs commandes réelles peuvent lui être rattachées, jamais l'inverse.
--
-- PRÉPARÉE MAIS NON EXÉCUTÉE — voir rapport LRP-5. Ne modifie et ne supprime AUCUNE colonne
-- existante (recurring_programs, orders.recurring_program_id, orders.recurring_occurrence_date
-- restent strictement inchangés) — purement additive, comme 20260825_recurring_programs.sql.

-- ── Pré-requis intégrité ────────────────────────────────────────────────────────────────────
-- Même besoin que clients_id_user_id_key (LRP-4.1 §10) : une contrainte composite permettant à
-- recurring_program_occurrences de référencer un programme ET garantir, au niveau FK, que
-- user_id/client_id de l'occurrence correspondent bien à ceux du programme référencé. Purement
-- additive : id est déjà unique (PK), trivialement satisfaite par les données existantes.
ALTER TABLE public.recurring_programs DROP CONSTRAINT IF EXISTS recurring_programs_id_user_client_key;
ALTER TABLE public.recurring_programs ADD CONSTRAINT recurring_programs_id_user_client_key
  UNIQUE (id, user_id, client_id);

CREATE TABLE IF NOT EXISTS public.recurring_program_occurrences (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,
  client_id            uuid NOT NULL,
  recurring_program_id uuid NOT NULL,
  scheduled_date       date NOT NULL,
  -- Volontairement 3 valeurs seulement : "à confirmer" n'est jamais stocké, c'est un état
  -- DÉRIVÉ à l'affichage (status='scheduled' ET scheduled_date <= aujourd'hui) — voir
  -- deriveOccurrenceDisplayStatus (recurringOccurrenceService.ts). Évite un état supplémentaire
  -- à maintenir en base qui pourrait diverger de la date réelle.
  status               text NOT NULL DEFAULT 'scheduled',
  -- Renseigné à la confirmation ('confirmed') uniquement — reste NULL pour 'scheduled'/'skipped'.
  confirmed_at         timestamptz,
  -- Facultatif : ex. motif d'une occurrence 'skipped' ("Programme mis en pause", "Non
  -- réalisée — contact injoignable"...). Jamais affiché comme une donnée métier officielle.
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Une seule échéance par date pour un programme donné — contrairement aux COMMANDES qui
-- peuvent légitimement partager une même recurring_occurrence_date (principale +
-- complémentaire), une OCCURRENCE représente un cycle unique. Sert aussi de garde-fou
-- d'idempotence (23505) pour ensureOccurrenceAt/ensureNextScheduledOccurrence.
CREATE UNIQUE INDEX IF NOT EXISTS recurring_program_occurrences_program_date_idx
  ON public.recurring_program_occurrences (recurring_program_id, scheduled_date);

-- Composite FK : impossible de créer une occurrence pour un programme appartenant à un autre
-- user_id/client_id, y compris via un accès direct à la base hors application (même principe
-- que recurring_programs → clients).
ALTER TABLE public.recurring_program_occurrences
  DROP CONSTRAINT IF EXISTS recurring_program_occurrences_program_fkey;
ALTER TABLE public.recurring_program_occurrences
  ADD CONSTRAINT recurring_program_occurrences_program_fkey
    FOREIGN KEY (recurring_program_id, user_id, client_id)
    REFERENCES public.recurring_programs(id, user_id, client_id) ON DELETE CASCADE;

ALTER TABLE public.recurring_program_occurrences
  DROP CONSTRAINT IF EXISTS recurring_program_occurrences_status_check;
ALTER TABLE public.recurring_program_occurrences ADD CONSTRAINT recurring_program_occurrences_status_check
  CHECK (status IN ('scheduled', 'confirmed', 'skipped'));

ALTER TABLE public.recurring_program_occurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recurring_program_occurrences_user_policy ON public.recurring_program_occurrences;
CREATE POLICY recurring_program_occurrences_user_policy ON public.recurring_program_occurrences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS recurring_program_occurrences_program_id_idx
  ON public.recurring_program_occurrences(recurring_program_id);
CREATE INDEX IF NOT EXISTS recurring_program_occurrences_user_status_idx
  ON public.recurring_program_occurrences(user_id, status);

-- ── Lien commande → échéance (LRP-5 §7) ────────────────────────────────────────────────────
-- Relation métier PRINCIPALE désormais pour une commande récurrente, remplace progressivement
-- orders.recurring_occurrence_date comme source de vérité (celle-ci n'est PAS supprimée — voir
-- commentaire de colonne). FK simple à `id` (pas composite), même raison que
-- orders.recurring_program_id (LRP-4.1 §10) : ON DELETE SET NULL sur une FK composite forcerait
-- Postgres à mettre à NULL des colonnes orders NOT NULL. Volontairement PAS de contrainte
-- UNIQUE : plusieurs commandes (principale + complémentaire) peuvent pointer la même occurrence.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS recurring_occurrence_id uuid
    REFERENCES public.recurring_program_occurrences(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_recurring_occurrence_id_idx ON public.orders(recurring_occurrence_id);

COMMENT ON COLUMN public.orders.recurring_occurrence_date IS
  'LRP-5 : conservée comme snapshot/compatibilité de recurring_program_occurrences.scheduled_date au moment du rattachement. Ne plus utiliser comme relation métier — voir recurring_occurrence_id. Jamais supprimée (donnée déjà en production).';

-- ── Trigger d'intégrité ─────────────────────────────────────────────────────────────────────
-- Même garde que check_order_recurring_program_ownership (LRP-4.1 §10), étendue à l'occurrence :
-- une commande liée à une échéance doit appartenir au même user_id/client_id que l'occurrence
-- ET référencer le MÊME programme que celui déjà porté par orders.recurring_program_id — évite
-- l'incohérence "commande liée au programme A mais à une échéance du programme B".
CREATE OR REPLACE FUNCTION public.check_order_recurring_occurrence_ownership()
RETURNS trigger AS $$
BEGIN
  IF NEW.recurring_occurrence_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.recurring_program_occurrences occ
      WHERE occ.id = NEW.recurring_occurrence_id
        AND occ.user_id = NEW.user_id
        AND occ.client_id = NEW.client_id
        AND occ.recurring_program_id = NEW.recurring_program_id
    ) THEN
      RAISE EXCEPTION 'orders.recurring_occurrence_id must reference a recurring_program_occurrences row owned by the same user_id, client_id and recurring_program_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS orders_recurring_occurrence_ownership_trigger ON public.orders;
CREATE TRIGGER orders_recurring_occurrence_ownership_trigger
  BEFORE INSERT OR UPDATE OF recurring_occurrence_id, recurring_program_id, user_id, client_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.check_order_recurring_occurrence_ownership();

-- ── Backfill (LRP-5 §29 — minimal, non hasardeux) ──────────────────────────────────────────
-- Aucune reconstitution d'historique depuis les commandes existantes (dates/cycles/cadence
-- passés non fiables, LRP-4 §19/§28 déjà tranché ainsi). Seule transformation sûre : matérialiser
-- la PROCHAINE échéance déjà connue (recurring_programs.next_occurrence_date) pour les
-- programmes actifs qui en ont une — strictement équivalent à ce que ferait
-- ensureNextScheduledOccurrence() au premier chargement de la fiche programme, juste anticipé
-- pour que l'écran ÉCHÉANCES ne parte pas vide après cette migration. Idempotent (NOT EXISTS +
-- index unique). Ne crée ni ne confirme aucune commande.
INSERT INTO public.recurring_program_occurrences
  (user_id, client_id, recurring_program_id, scheduled_date, status)
SELECT rp.user_id, rp.client_id, rp.id, rp.next_occurrence_date, 'scheduled'
FROM public.recurring_programs rp
WHERE rp.status = 'active'
  AND rp.next_occurrence_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.recurring_program_occurrences occ
    WHERE occ.recurring_program_id = rp.id AND occ.scheduled_date = rp.next_occurrence_date
  );

NOTIFY pgrst, 'reload schema';
