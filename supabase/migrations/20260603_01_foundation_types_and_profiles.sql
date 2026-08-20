-- Socle fondationnel (1/4) — réconciliation chronologique du drift de schéma (P2.3.3A/B/C).
-- Objectif unique : permettre à 20260712_advisor_entitlements.sql et aux migrations
-- suivantes de s'exécuter sans "relation/column does not exist" sur une reconstruction
-- from-scratch. Aucun changement fonctionnel sur la DB actuelle (tout est déjà présent,
-- chaque instruction est un no-op vérifié contre l'état réel de la base).
--
-- Ne contient QUE ce qui est utilisé avant sa première migration trackée existante.
-- Les colonnes déjà correctement ajoutées plus tard via ADD COLUMN IF NOT EXISTS
-- (order_type, appointment_id, outcome*, automation_delays, custom_lrp_name, etc.)
-- restent volontairement absentes d'ici — voir P2.3.3B pour la matrice complète.

-- ============================================
-- ENUMS (requis dès 20260712_canonical_pipeline.sql)
-- ============================================
DO $$ BEGIN
  CREATE TYPE public.appointment_type_enum AS ENUM (
    'discovery_call', 'product_presentation', 'follow_up', 'closing_call',
    'customer_support', 'team_training', 'team_meeting', 'webinar',
    'onboarding', 'business_review', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.appointment_status_enum AS ENUM (
    'scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pipeline_stage_enum AS ENUM (
    'new_lead', 'contacted', 'presentation_scheduled', 'presentation_completed',
    'follow_up', 'proposal_sent', 'customer', 'distributor', 'inactive', 'lost'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.prospect_temperature_enum AS ENUM ('cold', 'warm', 'hot', 'very_hot');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.commercial_intent_enum AS ENUM (
    'buy_product', 'become_customer', 'become_distributor', 'build_team',
    'training', 'support', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.task_type_enum AS ENUM (
    'follow_up', 'send_catalog', 'send_price_list', 'send_sample',
    'invite_to_webinar', 'invite_to_training', 'send_payment_link',
    'customer_checkin', 'team_followup', 'ask_referral', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.task_priority_enum AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.task_status_enum AS ENUM ('pending', 'in_progress', 'done', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- PROFILES — 12 colonnes requises avant le GRANT UPDATE (colonne par colonne) de
-- 20260714_owner_security.sql, qui échoue immédiatement si l'une d'elles manque.
-- ============================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email                 text,
  ADD COLUMN IF NOT EXISTS timezone              text DEFAULT 'Europe/Paris',
  ADD COLUMN IF NOT EXISTS onboarding_completed  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS specialty             text,
  ADD COLUMN IF NOT EXISTS active_catalog_slugs  text[],
  ADD COLUMN IF NOT EXISTS avatar_url            text,
  ADD COLUMN IF NOT EXISTS phone                 text,
  ADD COLUMN IF NOT EXISTS website               text,
  ADD COLUMN IF NOT EXISTS bio                   text,
  ADD COLUMN IF NOT EXISTS company               text,
  ADD COLUMN IF NOT EXISTS city                  text,
  ADD COLUMN IF NOT EXISTS linkedin_url          text;

-- ============================================
-- CLIENTS — colonnes fondationnelles (utilisées avant toute ADD COLUMN trackée) +
-- colonnes "legacy" jamais reprises par aucune migration trackée ultérieure.
-- ============================================
-- contact_role créée SCALAIRE : 20260730_contact_role_array.sql (comme
-- 20260712_canonical_pipeline.sql et 20260729_relationship_model.sql qui la lisent
-- juste avant, via des comparaisons scalaires "contact_role = 'x'" / "contact_role IN
-- (...)") s'attend explicitement à une colonne text, pas encore un tableau — son propre
-- commentaire le confirme : "Colonne déjà text NOT NULL DEFAULT 'customer'". C'est ce
-- fichier qui la convertit ensuite en text[]. Ne pas anticiper la forme finale, même
-- principe que commercial_intent (voir 20260603_03).
-- archived_at (P2.3.3D) : consommée par 20260712_canonical_pipeline.sql (index partiel
-- clients_user_pipeline_idx) et 20260712_contact_activity_summary.sql, tous deux
-- exécutés AVANT 20260712_contact_quota.sql (qui la crée normalement, alphabétiquement
-- après "canonical" et "contact_activity"). Découverte empiriquement par le premier
-- replay from-scratch (P2.3.3D), pas par lecture statique. Définition exacte confirmée
-- contre la DB réelle et contact_quota.sql : timestamptz, nullable, sans défaut.
-- next_lrp_date (P2.3.3H) : jamais créée par aucune migration trackée (contrairement à
-- archived_at/admin_audit_log/outcome, aucun fichier ultérieur ne l'ajoute non plus) —
-- une lacune du socle, pas un simple problème d'ordre. Consommée par
-- 20260804_lrp_program.sql (backfill lrp_status), qui la traite déjà comme préexistante
-- ("n'était représenté que par une seule date"). Découverte empiriquement (P2.3.3G).
-- Définition confirmée contre la DB réelle : date, nullable, sans défaut.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contact_role          text NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS sponsor_id            uuid,
  ADD COLUMN IF NOT EXISTS archived_at           timestamptz,
  ADD COLUMN IF NOT EXISTS next_lrp_date         date,
  ADD COLUMN IF NOT EXISTS next_action_date      date,
  ADD COLUMN IF NOT EXISTS next_action_type      text,
  ADD COLUMN IF NOT EXISTS language              text DEFAULT 'fr',
  ADD COLUMN IF NOT EXISTS birth_date            date,
  ADD COLUMN IF NOT EXISTS profession            text,
  ADD COLUMN IF NOT EXISTS children              text,
  ADD COLUMN IF NOT EXISTS interests             text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS client_type           text,
  ADD COLUMN IF NOT EXISTS medical_treatment     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS medical_notes         text,
  ADD COLUMN IF NOT EXISTS particularities       text,
  ADD COLUMN IF NOT EXISTS welcome_email_sent    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS doterra_id            text,
  ADD COLUMN IF NOT EXISTS first_name            text,
  ADD COLUMN IF NOT EXISTS inscription_date      date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS country               text,
  ADD COLUMN IF NOT EXISTS first_contact_date    date,
  ADD COLUMN IF NOT EXISTS first_purchase_date   date,
  ADD COLUMN IF NOT EXISTS acquisition_source    text,
  ADD COLUMN IF NOT EXISTS referrals_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_count        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS network_potential     text,
  ADD COLUMN IF NOT EXISTS address               text,
  ADD COLUMN IF NOT EXISTS loyalty_notes         text,
  -- source (P2.3.3I) : jamais créée par aucune migration trackée, référencée seulement
  -- (jamais définie) dans le script legacy migrate5.mjs — colonne fondationnelle
  -- manquante au même titre que les autres colonnes "legacy" ci-dessus.
  ADD COLUMN IF NOT EXISTS source                text;

-- sponsor_id est auto-référentielle (clients.id) — clients existe déjà depuis
-- 20260602_init.sql, la FK peut donc être posée immédiatement sans dépendance externe.
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_sponsor_id_fkey;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_sponsor_id_fkey FOREIGN KEY (sponsor_id)
  REFERENCES public.clients(id) ON DELETE SET NULL;

-- ============================================
-- FOLLOWUPS — colonne fondationnelle (requise par le CREATE TRIGGER ... UPDATE OF
-- pipeline_stage de 20260712_canonical_pipeline.sql) + colonnes legacy jamais reprises.
-- ============================================
-- title (P2.3.3I) : text NOT NULL en production, jamais reprise par aucune migration
-- trackée. Sûre à ajouter NOT NULL sans DEFAULT sur une reconstruction from-scratch :
-- la table est vide à ce stade (aucun INSERT avant ce point dans la chaîne), donc aucune
-- ligne existante à satisfaire. action_type/prospect_temperature : confirmées text
-- simples (pas les enums task_type_enum/prospect_temperature_enum) contre la DB réelle
-- et migrate13.mjs/migrate17.mjs — prospect_temperature appartient au même lot original
-- que pipeline_stage/product_context/auto_generated/priority_score (migrate17.mjs,
-- "5 colonnes ajoutées"), omise par erreur lors du socle initial (P2.3.3C) et révélée
-- par la comparaison automatisée de P2.3.3H.
ALTER TABLE public.followups
  ADD COLUMN IF NOT EXISTS title                 text NOT NULL,
  ADD COLUMN IF NOT EXISTS pipeline_stage         text,
  ADD COLUMN IF NOT EXISTS product_context        text,
  ADD COLUMN IF NOT EXISTS auto_generated         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority_score         integer,
  ADD COLUMN IF NOT EXISTS action_type            text,
  ADD COLUMN IF NOT EXISTS prospect_temperature   text;

-- ============================================
-- RECOMMENDATIONS — colonnes legacy jamais reprises par aucune migration trackée.
-- catalog_id/product_id restent de simples uuid ici : leurs FK vers catalogs/
-- catalog_products sont ajoutées dans 20260603_02 (ces tables n'existent pas encore).
-- status (P2.3.3I) : text nullable DEFAULT 'advised', confirmée contre la DB réelle,
-- avec sa contrainte CHECK associée (recommendations_status_check, elle aussi jamais
-- trackée puisque dépendante de cette colonne).
-- ============================================
ALTER TABLE public.recommendations
  ADD COLUMN IF NOT EXISTS catalog_id            uuid,
  ADD COLUMN IF NOT EXISTS product_id            uuid,
  ADD COLUMN IF NOT EXISTS quantity              integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS objective             text,
  ADD COLUMN IF NOT EXISTS recommendation_date   timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status                text DEFAULT 'advised';

ALTER TABLE public.recommendations DROP CONSTRAINT IF EXISTS recommendations_status_check;
ALTER TABLE public.recommendations ADD CONSTRAINT recommendations_status_check
  CHECK (status = ANY (ARRAY['advised'::text, 'purchased'::text]));

-- ============================================
-- FONCTION UPDATED_AT — jamais trackée, requise par les 4 triggers set_updated_at
-- créés dans 20260603_03 (cluster appointments).
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
