-- Socle fondationnel (2/4) — catalogue et commerce.
-- Ordre de dépendance : catalogs -> catalog_products -> orders (FK catalog_id/product_id)
-- -> FK différées de recommendations.catalog_id/product_id (colonnes posées en 01, ces
-- tables n'existaient pas encore à ce stade) -> subscriptions (structure FINALE complète,
-- voir justification ci-dessous).
-- DDL uniquement : aucun seed, aucune donnée de démonstration, aucun catalogue doTERRA.

-- ============================================
-- CATALOGS
-- ============================================
CREATE TABLE IF NOT EXISTS public.catalogs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text UNIQUE,
  name       text NOT NULL,
  brand      text,
  type       text NOT NULL DEFAULT 'official',
  user_id    uuid,
  color      text NOT NULL DEFAULT '#007AFF',
  icon       text NOT NULL DEFAULT '📦',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "official catalogs visible to all" ON public.catalogs;
CREATE POLICY "official catalogs visible to all" ON public.catalogs
  FOR SELECT USING (type = 'official' OR auth.uid() = user_id);

DROP POLICY IF EXISTS "users manage own catalogs" ON public.catalogs;
CREATE POLICY "users manage own catalogs" ON public.catalogs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- CATALOG_PRODUCTS
-- ============================================
CREATE TABLE IF NOT EXISTS public.catalog_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id          uuid NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  sku                 text,
  name                text NOT NULL,
  category            text,
  created_at          timestamptz DEFAULT now(),
  description         text,
  unit                text,
  retail_price_eur    numeric,
  wholesale_price_eur numeric,
  pv                  numeric,
  latin_name          text,
  image_url           text
);

ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products visible via catalog" ON public.catalog_products;
CREATE POLICY "products visible via catalog" ON public.catalog_products
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.catalogs c
    WHERE c.id = catalog_products.catalog_id AND (c.type = 'official' OR c.user_id = auth.uid())
  ));

DROP POLICY IF EXISTS "users manage custom products" ON public.catalog_products;
CREATE POLICY "users manage custom products" ON public.catalog_products
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.catalogs c WHERE c.id = catalog_products.catalog_id AND c.user_id = auth.uid()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.catalogs c WHERE c.id = catalog_products.catalog_id AND c.user_id = auth.uid()
  ));

-- ============================================
-- Complète les FK différées de recommendations (colonnes posées dans 20260603_01,
-- catalogs/catalog_products n'existaient pas encore à ce moment).
-- ============================================
ALTER TABLE public.recommendations DROP CONSTRAINT IF EXISTS recommendations_catalog_id_fkey;
ALTER TABLE public.recommendations
  ADD CONSTRAINT recommendations_catalog_id_fkey FOREIGN KEY (catalog_id)
  REFERENCES public.catalogs(id) ON DELETE SET NULL;

ALTER TABLE public.recommendations DROP CONSTRAINT IF EXISTS recommendations_product_id_fkey;
ALTER TABLE public.recommendations
  ADD CONSTRAINT recommendations_product_id_fkey FOREIGN KEY (product_id)
  REFERENCES public.catalog_products(id) ON DELETE SET NULL;

-- ============================================
-- ORDERS — structure de base uniquement (première utilisation :
-- 20260712_advisor_entitlements.sql, trigger). NE PAS inclure order_type,
-- appointment_id, closure_action_key, cancelled_at, is_first_order : chacune a déjà
-- son propre ADD COLUMN IF NOT EXISTS correctement tracké plus loin dans la chaîne.
-- ============================================
CREATE TABLE IF NOT EXISTS public.orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  client_id    uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  catalog_id   uuid REFERENCES public.catalogs(id) ON DELETE SET NULL,
  product_id   uuid REFERENCES public.catalog_products(id) ON DELETE SET NULL,
  quantity     integer NOT NULL DEFAULT 1,
  amount       numeric,
  currency     text NOT NULL DEFAULT 'EUR',
  order_date   timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL DEFAULT 'pending',
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz,
  order_number text,
  is_lrp       boolean NOT NULL DEFAULT false,
  products     jsonb
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_user_policy ON public.orders;
CREATE POLICY orders_user_policy ON public.orders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- SUBSCRIPTIONS — cas particulier documenté en P2.3.3B/C : 20260712_product_analytics.sql
-- (alphabétiquement AVANT 20260712_subscriptions.sql le même jour) référence déjà
-- "subscriptions" pour un trigger. Le fichier qui la crée normalement utilise un
-- CREATE TABLE IF NOT EXISTS monolithique (pas d'ADD COLUMN incrémental) : une version
-- partielle ici resterait donc incomplète pour toujours. Structure FINALE complète,
-- copiée à l'identique de la DB réelle. Le rejeu ultérieur de 20260712_subscriptions.sql
-- reste sûr : CREATE TABLE IF NOT EXISTS no-op, DROP POLICY IF EXISTS avant CREATE POLICY,
-- DROP TRIGGER IF EXISTS avant CREATE TRIGGER, CREATE OR REPLACE FUNCTION partout.
--
-- Note de fidélité : le fichier tracké 20260712_subscriptions.sql déclare
-- "user_id uuid ... REFERENCES auth.users(id) ON DELETE CASCADE", mais cette FK est
-- absente de la DB réelle actuelle (vérifié via pg_constraint) — comme CREATE TABLE
-- IF NOT EXISTS ne complète jamais une table existante, ce fichier n'a jamais pu
-- réellement ajouter cette contrainte en production. Cette migration reproduit
-- fidèlement l'état réel (sans la FK), conformément à la consigne "DB réelle = source
-- de vérité structurelle" — elle ne cherche pas à corriger cet écart préexistant.
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL,
  provider                  text NOT NULL CHECK (provider IN ('stripe', 'app_store', 'play_store', 'manual')),
  status                    text NOT NULL CHECK (status IN ('trialing', 'active', 'grace_period', 'past_due', 'paused', 'cancelled', 'expired')),
  plan                      text NOT NULL DEFAULT 'advisor' CHECK (plan IN ('advisor', 'leader', 'enterprise')),
  external_customer_id      text,
  external_subscription_id  text,
  product_id                text,
  price_id                  text,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean NOT NULL DEFAULT false,
  cancelled_at              timestamptz,
  metadata                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_subscription_id)
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscriptions_read_own ON public.subscriptions;
CREATE POLICY subscriptions_read_own
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
