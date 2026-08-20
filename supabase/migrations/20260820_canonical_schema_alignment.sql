-- Alignement canonique final (P2.3.3J) — clôt la campagne P2.3.2 → P2.3.3I.
-- Objectif : porter le schéma reconstruit depuis 20260602_init.sql jusqu'à l'état
-- canonique décidé (voir rapport P2.3.3I). Toutes les gardes sont catalog-aware
-- (interrogent pg_constraint/information_schema avant d'agir) : sur une reconstruction
-- déjà canonique, ce fichier ne doit produire AUCUNE mutation structurelle réelle.
-- Aucune exception générique (EXCEPTION WHEN OTHERS) : chaque garde teste précisément
-- l'état réel. Aucun DML métier, aucun seed, aucun backfill.
--
-- NE PAS APPLIQUER À LA PRODUCTION SANS AUTORISATION SÉPARÉE — voir section
-- PRODUCTION SAFETY du rapport P2.3.3J : sur la prod actuelle, ce fichier changerait
-- réellement 4 FK (profiles → auth.users) et poserait plusieurs contraintes NOT NULL.

-- ============================================================
-- 1) FK user_id → auth.users(id) ON DELETE CASCADE
--    Sur la reconstruction from-scratch (tracked depuis 20260602_init.sql), déjà le
--    cas : no-op. Sur la production actuelle, ces 4 FK ciblent profiles(id) : seraient
--    réellement modifiées si ce fichier était appliqué là-bas (non fait ici).
-- ============================================================
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('clients', 'clients_user_id_fkey'),
      ('followups', 'followups_user_id_fkey'),
      ('notes', 'notes_user_id_fkey'),
      ('recommendations', 'recommendations_user_id_fkey')
    ) AS t(table_name, constraint_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conname = fk.constraint_name
        AND c.conrelid = ('public.' || fk.table_name)::regclass
        AND c.confrelid = 'auth.users'::regclass
    ) THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', fk.table_name, fk.constraint_name);
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE',
        fk.table_name, fk.constraint_name
      );
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 2) NOT NULL canonique — 11 colonnes.
--    0 NULL réel confirmé en production pour chacune (audit read-only P2.3.3J) : aucun
--    backfill nécessaire. SET NOT NULL n'est exécuté que si la colonne est réellement
--    nullable au moment du run.
-- ============================================================
DO $$
DECLARE
  col record;
BEGIN
  FOR col IN
    SELECT * FROM (VALUES
      ('clients', 'created_at'),
      ('clients', 'updated_at'),
      ('followups', 'due_date'),
      ('followups', 'done'),
      ('followups', 'created_at'),
      ('followups', 'updated_at'),
      ('notes', 'created_at'),
      ('profiles', 'created_at'),
      ('profiles', 'updated_at'),
      ('recommendations', 'created_at'),
      ('recommendations', 'updated_at')
    ) AS t(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = col.table_name
        AND column_name = col.column_name AND is_nullable = 'YES'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL', col.table_name, col.column_name);
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 3) followups.content reste NULLABLE (décision canonique explicite — remplacée par
--    "title" depuis longtemps, 100% des lignes réelles en production sont déjà NULL).
--    DROP NOT NULL uniquement si la colonne est actuellement NOT NULL.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'followups'
      AND column_name = 'content' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.followups ALTER COLUMN content DROP NOT NULL;
  END IF;
END $$;

-- ============================================================
-- 4) notes.updated_at — supprimée du schéma canonique (aucun type TS, aucune fonction
--    de mise à jour, 0 référence fonctionnelle dans features/notes, absente de la
--    production réelle). DROP COLUMN IF EXISTS : nativement idempotent, la migration
--    historique 20260602_init.sql continue de la créer, celle-ci la retire ensuite.
-- ============================================================
ALTER TABLE public.notes DROP COLUMN IF EXISTS updated_at;

-- ============================================================
-- 5) appointments.native_event_id — supprimée du schéma canonique (0 référence code,
--    0 usage runtime, absente de la production réelle malgré sa migration trackée).
--    add_native_event_id_to_appointments.sql n'est pas modifiée : elle continue de la
--    créer dans la chaîne historique, celle-ci la retire ensuite.
-- ============================================================
ALTER TABLE public.appointments DROP COLUMN IF EXISTS native_event_id;

-- ============================================================
-- 6) clients_status_check → 9 valeurs canoniques.
--    Comparaison via pg_get_constraintdef (déparseur canonique PostgreSQL, fiable
--    indépendamment de la façon dont la contrainte a été créée à l'origine —
--    contrairement à information_schema.check_constraints.check_clause, qui s'est
--    révélé produire un parenthésage différent selon l'origine CREATE TABLE inline vs
--    ALTER TABLE ADD CONSTRAINT lors des tests P2.3.3H/I). Chaîne de comparaison issue
--    de la définition réelle observée en production (lecture seule, P2.3.3J).
--    Remplace uniquement si différente — jamais de DROP/ADD systématique.
-- ============================================================
DO $$
DECLARE
  v_def text;
  v_canonical CONSTANT text :=
    'CHECK ((status = ANY (ARRAY[''prospect''::text, ''new_client''::text, ''active''::text, ''loyal''::text, ''vip''::text, ''inactive''::text, ''advisor''::text, ''team_member''::text, ''lost''::text])))';
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conname = 'clients_status_check' AND c.conrelid = 'public.clients'::regclass;

  IF v_def IS DISTINCT FROM v_canonical THEN
    ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_status_check;
    ALTER TABLE public.clients ADD CONSTRAINT clients_status_check CHECK (
      status = ANY (ARRAY['prospect'::text, 'new_client'::text, 'active'::text, 'loyal'::text,
        'vip'::text, 'inactive'::text, 'advisor'::text, 'team_member'::text, 'lost'::text])
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
