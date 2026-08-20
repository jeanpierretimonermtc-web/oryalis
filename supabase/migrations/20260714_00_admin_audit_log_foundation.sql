-- Correctif chronologique ciblé (P2.3.3F) — PAS le socle 20260603.
-- admin_audit_log possède déjà une création trackée (20260714_owner_security.sql,
-- CREATE TABLE IF NOT EXISTS monolithique) : le seul problème est un forward-reference
-- intra-journée démontré empiriquement (P2.3.3E) — 20260714_owner_console.sql crée un
-- trigger AFTER INSERT sur cette table (ligne ~184-187) avant qu'elle existe, car
-- "console" trie alphabétiquement avant "security".
--
-- Comme owner_security.sql utilise CREATE TABLE IF NOT EXISTS (pas d'ADD COLUMN
-- incrémental), une structure partielle ici resterait incomplète pour toujours : la
-- structure complète réelle est donc reprise à l'identique (source : information_schema
-- de la DB de production, en lecture seule).
--
-- Note de fidélité (même cas que subscriptions.user_id en P2.3.3C) : le texte de
-- 20260714_owner_security.sql déclare "actor_user_id uuid REFERENCES auth.users(id)
-- ON DELETE SET NULL" et pareillement pour target_user_id, mais aucune de ces deux FK
-- n'existe réellement en production (vérifié via pg_constraint — 0 FK sur cette table).
-- Comme CREATE TABLE IF NOT EXISTS ne complète jamais une table déjà existante, ce
-- fichier n'a jamais pu les appliquer réellement. Reproduit fidèlement l'état réel
-- (sans ces FK), sans chercher à corriger cet écart préexistant.
--
-- RLS activée immédiatement (même principe de sécurité déjà appliqué à chaque table du
-- socle 20260603) : aucune fenêtre, même le temps d'un seul fichier du replay, où cette
-- table sensible existerait sans RLS. owner_security.sql la réactive et refait le REVOKE
-- ALL ensuite sans conflit (opérations idempotentes). Aucune policy : la DB réelle n'en
-- a aucune sur cette table (RLS activée + REVOKE ALL = accès exclusivement via les
-- fonctions SECURITY DEFINER owner_*, jamais en direct) — ne pas en inventer une.
--
-- Les 2 index (admin_audit_log_created_at_idx, admin_audit_log_target_user_idx) restent
-- volontairement absents d'ici : déjà correctement trackés via CREATE INDEX IF NOT
-- EXISTS dans owner_security.sql, qui s'exécute après ce fichier sans conflit.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id     uuid,
  action            text NOT NULL,
  target_user_id    uuid,
  target_table      text,
  target_record_id  uuid,
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_audit_log FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
