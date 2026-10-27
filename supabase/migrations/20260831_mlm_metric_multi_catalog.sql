-- ORDER-BUSINESS-3.5.2 — multi-catalogues pour les métriques MLM PERSONNELLES (§8/§9/§10/§11 du
-- rapport). Une métrique OFFICIELLE reste inchangée : elle appartient intrinsèquement à UN seul
-- catalogue (celui qui l'a définie), catalog_id NOT NULL, jamais concernée par ce lot (§16 du
-- rapport : "les valeurs officielles restent strictement read-only").
--
-- Avant ce lot, une métrique PERSONNELLE avait :
--   catalog_id = NULL      -> "tous les catalogues" (global)
--   catalog_id = UUID      -> "un seul catalogue" (scindée)
-- Le besoin devient : "tous mes catalogues" OU "N catalogues sélectionnés" (N >= 1, potentiellement
-- > 1). Un simple UUID nullable ne peut pas représenter un ensemble — d'où une table de jointure
-- dédiée (mlm_metric_definition_catalogs), plutôt qu'un tableau uuid[] : garde les mêmes garanties
-- (FK réelles, RLS par ligne, UNIQUE, triggers de scope) qu'une relation classique, cohérent avec
-- le reste du schéma (aucune colonne "array de références" ailleurs dans ce projet).
--
-- AUCUNE PERTE DE DONNÉES (§10) : toute métrique personnelle scindée à un catalogue avant ce lot
-- (catalog_id = X) devient scope='selected' + une ligne (metric_definition_id, X) dans la nouvelle
-- table — l'information est DÉPLACÉE, jamais supprimée. Toute métrique personnelle globale
-- (catalog_id = NULL) devient scope='all', comportement identique à avant (§10).

-- ============================================
-- 1. mlm_metric_definitions.scope
-- ============================================
-- Nullable : sans signification pour une métrique OFFICIELLE (toujours liée à SON catalogue via
-- catalog_id, jamais à "tous les catalogues" ni à une sélection) — seule une métrique PERSONNELLE
-- porte un scope non-null. Le CHECK ci-dessous rend cette règle explicite plutôt qu'implicite.
ALTER TABLE public.mlm_metric_definitions ADD COLUMN IF NOT EXISTS scope text;

-- Backfill AVANT les contraintes (une contrainte NOT NULL/CHECK ajoutée sur une colonne déjà
-- peuplée par des lignes existantes doit toujours trouver des valeurs déjà conformes).
UPDATE public.mlm_metric_definitions
SET scope = 'all'
WHERE origin = 'personal' AND catalog_id IS NULL AND scope IS NULL;

UPDATE public.mlm_metric_definitions
SET scope = 'selected'
WHERE origin = 'personal' AND catalog_id IS NOT NULL AND scope IS NULL;

-- Migre l'ancien lien simple catalog_id -> la nouvelle table de jointure, AVANT de vider
-- catalog_id (sinon l'information serait perdue, contrairement à l'exigence §10).
CREATE TABLE IF NOT EXISTS public.mlm_metric_definition_catalogs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_definition_id  uuid NOT NULL REFERENCES public.mlm_metric_definitions(id) ON DELETE CASCADE,
  catalog_id            uuid NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- Une seule ligne par (métrique, catalogue) — sélectionner deux fois le même catalogue n'a pas
  -- de sens et ne doit pas produire de doublon silencieux.
  UNIQUE (metric_definition_id, catalog_id)
);

CREATE INDEX IF NOT EXISTS mlm_metric_definition_catalogs_metric_idx
  ON public.mlm_metric_definition_catalogs (metric_definition_id);
CREATE INDEX IF NOT EXISTS mlm_metric_definition_catalogs_catalog_idx
  ON public.mlm_metric_definition_catalogs (catalog_id);

INSERT INTO public.mlm_metric_definition_catalogs (metric_definition_id, catalog_id, user_id)
SELECT md.id, md.catalog_id, md.user_id
FROM public.mlm_metric_definitions md
WHERE md.origin = 'personal' AND md.catalog_id IS NOT NULL
ON CONFLICT (metric_definition_id, catalog_id) DO NOTHING;

-- ORDER-BUSINESS-3.5.2.2 §3/§7 — CONFLIT DE CODE HÉRITÉ, détecté par audit pré-exécution (2026-08-31,
-- compte jeanpierre.timoner.mtc@gmail.com) : avant ce lot, PLUSIEURS métriques personnelles du MÊME
-- utilisateur pouvaient légitimement partager le MÊME `code`, tant qu'elles étaient scindées à des
-- catalogues DIFFÉRENTS (protégées par l'index partiel ..._personal_scoped_unique, qui inclut
-- catalog_id) ou qu'une seule était globale (..._personal_global_unique, catalog_id IS NULL) — deux
-- index partiels disjoints. Cas réel trouvé : "Pourcentage" (globale) et "pourcentage" (scindée à
-- Zinzino), même code normalisé ('pourcentage'), même utilisateur. Vider catalog_id juste en dessous
-- fusionne TOUTES les personnelles dans le MÊME espace d'unicité (..._personal_global_unique,
-- désormais seul index vivant pour une personnelle) : toute paire (ou groupe) partageant déjà le
-- même code avant ce lot violerait cet index et ferait échouer la migration entière (sans dégât : un
-- batch envoyé en une seule requête `pg` s'exécute en transaction implicite unique, un échec annule
-- tout ce qui précède dans le même envoi) — mais sans jamais s'installer.
--
-- Résolution NON destructive et GÉNÉRIQUE (§10 : "aucune perte de données") — ne cible pas
-- nominativement "Pourcentage", couvre tout groupe (user_id, code) de 2+ lignes personnelles,
-- scindées entre elles ou face à une globale : la ligne la PLUS ANCIENNE (created_at) de chaque
-- groupe garde son code inchangé, toutes les suivantes reçoivent un suffixe désambiguïsant dérivé de
-- leur PROPRE id (stable, toujours défini, contrairement à catalog_id qui peut être NULL pour une
-- globale). Aucune ligne supprimée, aucun catalog_product_metric_values ni order_item_metric_snapshots
-- touché (déjà déplacés dans la table de jointure ci-dessus avant cette étape ; vérifié par audit :
-- 0 valeur configurée et 0 snapshot pour les deux lignes du cas réel trouvé, mais cette correction
-- reste sûre même si ce n'était pas le cas). Le trigger d'immutabilité du code
-- (normalize_and_lock_mlm_metric_definition_code, 20260830_mlm_product_metrics.sql) est désactivé
-- le temps de cette correction ponctuelle puis immédiatement réactivé, dans la MÊME transaction
-- implicite qu'une éventuelle exception annulerait de toute façon en entier.
ALTER TABLE public.mlm_metric_definitions DISABLE TRIGGER normalize_and_lock_mlm_metric_definition_code;

WITH ranked_personal_codes AS (
  SELECT id, row_number() OVER (PARTITION BY user_id, code ORDER BY created_at ASC, id ASC) AS rn
  FROM public.mlm_metric_definitions
  WHERE origin = 'personal'
)
UPDATE public.mlm_metric_definitions md
SET code = md.code || '_' || substr(md.id::text, 1, 8), updated_at = now()
FROM ranked_personal_codes r
WHERE md.id = r.id AND r.rn > 1;

ALTER TABLE public.mlm_metric_definitions ENABLE TRIGGER normalize_and_lock_mlm_metric_definition_code;

-- Une fois l'information déplacée dans la table de jointure, catalog_id d'une métrique
-- PERSONNELLE n'a plus de rôle : la table de jointure devient la SEULE source de vérité pour son
-- périmètre. Mis à NULL pour éviter deux sources d'information divergentes (le CHECK ci-dessous
-- rend ce NULL obligatoire pour toute écriture future, pas seulement ce backfill ponctuel).
UPDATE public.mlm_metric_definitions SET catalog_id = NULL WHERE origin = 'personal' AND catalog_id IS NOT NULL;

-- §11 — compatibilité : une métrique officielle garde EXACTEMENT son comportement d'avant
-- (catalog_id NOT NULL, scope NULL) ; une personnelle porte désormais toujours un scope explicite
-- et plus jamais de catalog_id direct (remplacé par la table de jointure).
ALTER TABLE public.mlm_metric_definitions
  ADD CONSTRAINT mlm_metric_definitions_scope_kind_check CHECK (
    (origin = 'official' AND scope IS NULL) OR
    (origin = 'personal' AND scope IN ('all', 'selected'))
  );
ALTER TABLE public.mlm_metric_definitions
  ADD CONSTRAINT mlm_metric_definitions_personal_catalog_id_null_check CHECK (
    origin <> 'personal' OR catalog_id IS NULL
  );

-- Cet index unique ne peut plus jamais s'appliquer désormais (il exigeait catalog_id IS NOT NULL
-- pour une métrique personnelle, devenu impossible par le CHECK ci-dessus) : supprimé plutôt que
-- laissé mort, pour ne pas laisser une trace trompeuse d'un modèle révolu. Effet de bord assumé et
-- correct : l'unicité du `code` d'une métrique personnelle repose désormais uniquement sur
-- `mlm_metric_definitions_personal_global_unique` (user_id, code) WHERE catalog_id IS NULL — qui,
-- catalog_id étant maintenant TOUJOURS NULL pour une personnelle, s'applique à TOUTES les
-- métriques personnelles de l'utilisateur sans exception. C'est le comportement voulu : le `code`
-- reste l'identité technique, indépendante du périmètre catalogue (§9 du rapport).
DROP INDEX IF EXISTS public.mlm_metric_definitions_personal_scoped_unique;

ALTER TABLE public.mlm_metric_definition_catalogs ENABLE ROW LEVEL SECURITY;

-- Le périmètre catalogue d'une métrique personnelle est une configuration privée de son
-- propriétaire (jamais partagée, contrairement à la définition elle-même qui reste visible pour
-- une officielle) — une seule policy simple suffit, pas de policy SELECT séparée.
DROP POLICY IF EXISTS mlm_metric_definition_catalogs_user_policy ON public.mlm_metric_definition_catalogs;
CREATE POLICY mlm_metric_definition_catalogs_user_policy ON public.mlm_metric_definition_catalogs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================
-- 2. Trigger de scope sur mlm_metric_definition_catalogs
-- ============================================
-- Même raisonnement que check_mlm_metric_definition_catalog_scope (20260830_mlm_product_metrics.sql)
-- : la RLS "own" garantit déjà que user_id = auth.uid(), mais ne vérifie ni que la métrique
-- référencée est bien une PERSONNELLE APPARTENANT à ce même utilisateur, ni que le catalogue visé
-- lui est réellement accessible (officiel, ou son propre catalogue custom) — SECURITY DEFINER pour
-- voir l'état réel de mlm_metric_definitions/catalogs indépendamment de la RLS de l'appelant.
CREATE OR REPLACE FUNCTION public.check_mlm_metric_definition_catalog_link_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_metric_origin  text;
  v_metric_user_id uuid;
  v_catalog_type   text;
  v_catalog_owner  uuid;
BEGIN
  SELECT origin, user_id INTO v_metric_origin, v_metric_user_id
  FROM public.mlm_metric_definitions WHERE id = NEW.metric_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mlm_metric_definitions % not found', NEW.metric_definition_id;
  END IF;
  IF v_metric_origin <> 'personal' OR v_metric_user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'metric % is not a personal metric owned by %', NEW.metric_definition_id, NEW.user_id;
  END IF;

  SELECT type, user_id INTO v_catalog_type, v_catalog_owner
  FROM public.catalogs WHERE id = NEW.catalog_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalogs % not found', NEW.catalog_id;
  END IF;
  IF v_catalog_type <> 'official' AND v_catalog_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'user % cannot scope a personal metric to catalog % owned by another user', NEW.user_id, NEW.catalog_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_mlm_metric_definition_catalog_link_scope ON public.mlm_metric_definition_catalogs;
CREATE TRIGGER check_mlm_metric_definition_catalog_link_scope
  BEFORE INSERT OR UPDATE ON public.mlm_metric_definition_catalogs
  FOR EACH ROW EXECUTE FUNCTION public.check_mlm_metric_definition_catalog_link_scope();

-- ============================================
-- 3. check_catalog_product_metric_value_scope — adapté au multi-catalogue (§12 du rapport)
-- ============================================
-- Remplace UNIQUEMENT la branche "personnelle scindée à un catalogue unique" (v_metric_catalog_id
-- IS NOT NULL, désormais impossible pour une personnelle) par une vérification contre la table de
-- jointure quand scope='selected'. Les branches officielle et personnelle-globale sont inchangées.
CREATE OR REPLACE FUNCTION public.check_catalog_product_metric_value_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_metric_origin         text;
  v_metric_catalog_id     uuid;
  v_metric_user_id        uuid;
  v_metric_scope          text;
  v_product_catalog_id    uuid;
  v_product_catalog_type  text;
  v_product_catalog_owner uuid;
BEGIN
  SELECT origin, catalog_id, user_id, scope INTO v_metric_origin, v_metric_catalog_id, v_metric_user_id, v_metric_scope
  FROM public.mlm_metric_definitions WHERE id = NEW.metric_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mlm_metric_definitions % not found', NEW.metric_definition_id;
  END IF;

  SELECT cp.catalog_id, c.type, c.user_id
    INTO v_product_catalog_id, v_product_catalog_type, v_product_catalog_owner
  FROM public.catalog_products cp
  JOIN public.catalogs c ON c.id = cp.catalog_id
  WHERE cp.id = NEW.catalog_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalog_products % not found', NEW.catalog_product_id;
  END IF;

  -- Officielle : inchangé, toujours liée à SON catalogue (catalog_id NOT NULL, jamais concernée
  -- par le multi-catalogue).
  IF v_metric_origin = 'official' THEN
    IF v_product_catalog_id IS DISTINCT FROM v_metric_catalog_id THEN
      RAISE EXCEPTION 'official metric % (catalog %) cannot be applied to a product of catalog %',
        NEW.metric_definition_id, v_metric_catalog_id, v_product_catalog_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Personnelle, scope='selected' : le produit doit appartenir à l'un des catalogues sélectionnés
  -- pour CETTE métrique (table de jointure), jamais déduit d'un catalog_id direct (toujours NULL
  -- désormais pour une personnelle, voir CHECK mlm_metric_definitions_personal_catalog_id_null_check).
  IF v_metric_scope = 'selected' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.mlm_metric_definition_catalogs mc
      WHERE mc.metric_definition_id = NEW.metric_definition_id AND mc.catalog_id = v_product_catalog_id
    ) THEN
      RAISE EXCEPTION 'personal metric % (scope selected) is not linked to catalog % of product %',
        NEW.metric_definition_id, v_product_catalog_id, NEW.catalog_product_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Personnelle, scope='all' : inchangé — utilisable sur tout produit réellement accessible à
  -- l'utilisateur (officiel, ou son propre catalogue custom).
  IF v_product_catalog_type <> 'official' AND v_product_catalog_owner IS DISTINCT FROM v_metric_user_id THEN
    RAISE EXCEPTION 'personal metric % (user %) cannot be applied to a product of another user''s catalog %',
      NEW.metric_definition_id, v_metric_user_id, v_product_catalog_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================
-- 4. check_order_item_metric_snapshot_definition_scope — même adaptation (§12 du rapport)
-- ============================================
-- Chemin du snapshot MANUEL (saveOrderItemMetricSnapshots, hors RPC automatique) : mêmes règles de
-- scope, évaluées contre order_items.catalog_product_id (produit réel de la ligne facturée).
CREATE OR REPLACE FUNCTION public.check_order_item_metric_snapshot_definition_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_metric_origin           text;
  v_metric_catalog_id       uuid;
  v_metric_user_id          uuid;
  v_metric_scope            text;
  v_item_catalog_product_id uuid;
  v_product_catalog_id      uuid;
  v_product_catalog_type    text;
  v_product_catalog_owner   uuid;
BEGIN
  IF NEW.metric_definition_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT origin, catalog_id, user_id, scope INTO v_metric_origin, v_metric_catalog_id, v_metric_user_id, v_metric_scope
  FROM public.mlm_metric_definitions WHERE id = NEW.metric_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mlm_metric_definitions % not found', NEW.metric_definition_id;
  END IF;

  IF v_metric_origin = 'personal' AND v_metric_user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'metric definition % belongs to another user, cannot be snapshotted by %',
      NEW.metric_definition_id, NEW.user_id;
  END IF;

  SELECT catalog_product_id INTO v_item_catalog_product_id
  FROM public.order_items WHERE id = NEW.order_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_items % not found', NEW.order_item_id;
  END IF;

  IF v_item_catalog_product_id IS NOT NULL THEN
    SELECT cp.catalog_id, c.type, c.user_id
      INTO v_product_catalog_id, v_product_catalog_type, v_product_catalog_owner
    FROM public.catalog_products cp
    JOIN public.catalogs c ON c.id = cp.catalog_id
    WHERE cp.id = v_item_catalog_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'catalog_products % not found', v_item_catalog_product_id;
    END IF;
  END IF;

  IF v_metric_origin = 'official' THEN
    IF v_item_catalog_product_id IS NULL OR v_product_catalog_id IS DISTINCT FROM v_metric_catalog_id THEN
      RAISE EXCEPTION 'official metric % (catalog %) cannot be snapshotted on order_item % (product catalog %)',
        NEW.metric_definition_id, v_metric_catalog_id, NEW.order_item_id, v_product_catalog_id;
    END IF;
    RETURN NEW;
  END IF;

  IF v_metric_scope = 'selected' THEN
    IF v_item_catalog_product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.mlm_metric_definition_catalogs mc
      WHERE mc.metric_definition_id = NEW.metric_definition_id AND mc.catalog_id = v_product_catalog_id
    ) THEN
      RAISE EXCEPTION 'personal metric % (scope selected) cannot be snapshotted on order_item % (product catalog %)',
        NEW.metric_definition_id, NEW.order_item_id, v_product_catalog_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Personnelle, scope='all' : inchangé, y compris l'autorisation d'un produit LIBRE.
  IF v_item_catalog_product_id IS NOT NULL
     AND v_product_catalog_type <> 'official'
     AND v_product_catalog_owner IS DISTINCT FROM v_metric_user_id THEN
    RAISE EXCEPTION 'personal metric % (user %) cannot be snapshotted on order_item % (product of another user''s catalog %)',
      NEW.metric_definition_id, v_metric_user_id, NEW.order_item_id, v_product_catalog_id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================
-- 5. upsert_order_item_with_metric_sync — RPC adaptée (§13 du rapport)
-- ============================================
-- Nécessaire (et pas seulement théorique) : sans cette adaptation, retirer un catalogue du
-- périmètre d'une métrique personnelle "scope=selected" n'empêcherait PAS la création de NOUVEAUX
-- snapshots sur ce catalogue tant qu'une ligne catalog_product_metric_values existe encore pour ce
-- produit (§17 du rapport : "retirer ce catalogue empêchera leur utilisation pour les nouvelles
-- commandes" — cette RPC est le seul chemin AUTOMATIQUE de création de snapshot, elle doit donc
-- réévaluer le scope COURANT de la métrique, pas seulement l'existence passée d'une valeur produit).
-- Signature INCHANGÉE (mêmes 8 paramètres) : CREATE OR REPLACE sur la fonction déjà exécutée par
-- 20260830_order_item_metric_sync_rpc.sql, jamais une nouvelle fonction séparée.
CREATE OR REPLACE FUNCTION public.upsert_order_item_with_metric_sync(
  p_id                    uuid,
  p_user_id               uuid,
  p_order_id              uuid,
  p_catalog_product_id    uuid,
  p_product_name_snapshot text,
  p_quantity              integer,
  p_unit_price            numeric,
  p_sync_metrics          boolean
)
RETURNS public.order_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item               public.order_items;
  v_catalog_type       text;
  v_catalog_owner      uuid;
  v_product_catalog_id uuid;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'p_id is required — the caller must assign a stable id before calling this function';
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_user_id must match the calling user';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'order % not found for user %', p_order_id, p_user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.order_items
    WHERE id = p_id AND (order_id <> p_order_id OR user_id <> p_user_id)
  ) THEN
    RAISE EXCEPTION 'order_item % does not belong to order %/user %', p_id, p_order_id, p_user_id;
  END IF;

  -- v_product_catalog_id capturé ici (nouveau) : réutilisé plus bas pour filtrer les métriques
  -- personnelles scope='selected' — inchangé pour tout le reste de ce bloc.
  IF p_catalog_product_id IS NOT NULL THEN
    SELECT cp.catalog_id, c.type, c.user_id INTO v_product_catalog_id, v_catalog_type, v_catalog_owner
    FROM public.catalog_products cp
    JOIN public.catalogs c ON c.id = cp.catalog_id
    WHERE cp.id = p_catalog_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'catalog_products % not found', p_catalog_product_id;
    END IF;
    IF v_catalog_type <> 'official' AND v_catalog_owner IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'user % cannot use catalog_product % from another user''s catalog', p_user_id, p_catalog_product_id;
    END IF;
  END IF;

  INSERT INTO public.order_items (id, user_id, order_id, catalog_product_id, product_name_snapshot, quantity, unit_price, updated_at)
  VALUES (p_id, p_user_id, p_order_id, p_catalog_product_id, p_product_name_snapshot, p_quantity, p_unit_price, now())
  ON CONFLICT (id) DO UPDATE SET
    catalog_product_id    = EXCLUDED.catalog_product_id,
    product_name_snapshot = EXCLUDED.product_name_snapshot,
    quantity              = EXCLUDED.quantity,
    unit_price            = EXCLUDED.unit_price,
    updated_at            = now()
  RETURNING * INTO v_item;

  IF p_sync_metrics THEN
    DELETE FROM public.order_item_metric_snapshots WHERE order_item_id = v_item.id;
    IF v_item.catalog_product_id IS NOT NULL THEN
      -- §13 — filtre de scope AJOUTÉ pour une métrique personnelle : officielle -> inchangé
      -- (déjà garanti par check_catalog_product_metric_value_scope à l'écriture de la valeur) ;
      -- personnelle scope='all' -> inchangé ; personnelle scope='selected' -> désormais réévaluée
      -- au moment de CET appel contre le périmètre COURANT (mlm_metric_definition_catalogs),
      -- jamais contre un catalog_id figé qui n'existe plus pour une personnelle.
      INSERT INTO public.order_item_metric_snapshots
        (user_id, order_item_id, metric_definition_id, metric_code_snapshot, metric_label_snapshot, origin_snapshot, unit_value)
      SELECT p_user_id, v_item.id, md.id, md.code, md.display_name, md.origin, v.value
      FROM public.catalog_product_metric_values v
      JOIN public.mlm_metric_definitions md ON md.id = v.metric_definition_id
      WHERE v.catalog_product_id = v_item.catalog_product_id
        AND md.active = true
        AND (
          md.origin = 'official'
          OR (md.user_id = p_user_id AND md.scope = 'all')
          OR (
            md.user_id = p_user_id AND md.scope = 'selected'
            AND EXISTS (
              SELECT 1 FROM public.mlm_metric_definition_catalogs mc
              WHERE mc.metric_definition_id = md.id AND mc.catalog_id = v_product_catalog_id
            )
          )
        );
    END IF;
  END IF;

  RETURN v_item;
END;
$$;

-- ============================================
-- 6. set_mlm_metric_definition_scope — RPC transactionnelle (§9/§11/§17 du rapport)
-- ============================================
-- Changer le périmètre d'une métrique personnelle implique DEUX écritures (mlm_metric_definitions.
-- scope + remplacement intégral des lignes de mlm_metric_definition_catalogs) qu'aucune séquence
-- de deux appels REST distincts ne peut rendre atomique côté client — même raisonnement que
-- upsert_order_item_with_metric_sync (rapport ORDER-BUSINESS-3.4.1) : un échec entre les deux
-- laisserait un état "scope=selected mais 0 catalogue sélectionné", rendant silencieusement la
-- métrique inapplicable à TOUT produit, jamais un état que l'UI a réellement demandé. Un
-- DELETE+INSERT groupé dans UNE fonction, exécuté comme une seule transaction implicite, élimine
-- cet état intermédiaire par construction.
-- ORDER-BUSINESS-3.5.2.1 §11/§13/§14/§25 — DURCIE : la validation d'accessibilité de CHAQUE
-- catalogue (officiel OU catalogue custom possédé par l'appelant) est désormais faite ICI, en un
-- pré-contrôle AVANT toute écriture (UPDATE/DELETE/INSERT), plutôt que découverte a posteriori par
-- le trigger check_mlm_metric_definition_catalog_link_scope au milieu de la boucle d'INSERT. Deux
-- effets : (1) message d'erreur STABLE et propre pour le client (ERRCODE/MESSAGE dédiés, jamais de
-- nom de table/SQL brut, convention déjà utilisée par owner_console — voir 20260714_owner_console.sql),
-- (2) atomicité totale garantie AVANT même la première écriture (§25 : un catalogue invalide au
-- milieu d'une liste ne doit jamais laisser un scope 'selected' partiellement peuplé — la moindre
-- écriture n'a lieu qu'une fois TOUS les catalogues validés). Le trigger reste en place comme
-- filet de sécurité indépendant (défense en profondeur), mais ne devrait plus jamais se déclencher
-- en pratique depuis cette RPC.
CREATE OR REPLACE FUNCTION public.set_mlm_metric_definition_scope(
  p_metric_definition_id uuid,
  p_scope                text,
  p_catalog_ids          uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id       uuid;
  v_origin        text;
  v_catalog_id    uuid;
  v_catalog_type  text;
  v_catalog_owner uuid;
BEGIN
  IF p_scope NOT IN ('all', 'selected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SCOPE_INVALID_VALUE';
  END IF;

  SELECT user_id, origin INTO v_user_id, v_origin
  FROM public.mlm_metric_definitions WHERE id = p_metric_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SCOPE_METRIC_NOT_FOUND';
  END IF;
  -- SECURITY DEFINER bypass la RLS : revérification explicite, même exigence que
  -- upsert_order_item_with_metric_sync (jamais se reposer uniquement sur l'appelant authentifié).
  IF v_origin <> 'personal' OR v_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SCOPE_METRIC_NOT_OWNED';
  END IF;

  IF p_scope = 'selected' AND (p_catalog_ids IS NULL OR array_length(p_catalog_ids, 1) IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SCOPE_SELECTED_REQUIRES_CATALOG';
  END IF;

  -- §14/§25 — pré-contrôle de TOUS les catalogues AVANT toute écriture : la boucle s'arrête au
  -- premier catalogue invalide/inaccessible, avant même le premier UPDATE, garantissant qu'aucune
  -- écriture partielle n'est jamais tentée.
  IF p_scope = 'selected' THEN
    FOREACH v_catalog_id IN ARRAY p_catalog_ids LOOP
      SELECT type, user_id INTO v_catalog_type, v_catalog_owner FROM public.catalogs WHERE id = v_catalog_id;
      IF NOT FOUND OR (v_catalog_type <> 'official' AND v_catalog_owner IS DISTINCT FROM v_user_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SCOPE_CATALOG_NOT_ACCESSIBLE';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.mlm_metric_definitions SET scope = p_scope, updated_at = now() WHERE id = p_metric_definition_id;

  -- Remplacement INTÉGRAL (jamais un patch incrémental) : reflète exactement ce que l'UI envoie,
  -- aucune divergence possible entre l'affichage et l'état réel après l'appel.
  DELETE FROM public.mlm_metric_definition_catalogs WHERE metric_definition_id = p_metric_definition_id;

  IF p_scope = 'selected' THEN
    FOREACH v_catalog_id IN ARRAY p_catalog_ids LOOP
      INSERT INTO public.mlm_metric_definition_catalogs (metric_definition_id, catalog_id, user_id)
      VALUES (p_metric_definition_id, v_catalog_id, v_user_id)
      ON CONFLICT (metric_definition_id, catalog_id) DO NOTHING;
    END LOOP;
  END IF;
  -- p_scope = 'all' : DELETE ci-dessus suffit, aucun INSERT (redevient "tous mes catalogues",
  -- §9/§17 — jamais une suppression des catalog_product_metric_values déjà configurées, cette
  -- fonction ne touche jamais cette table : les valeurs restent, seule leur APPLICABILITÉ future
  -- change, via le trigger de scope ci-dessus et la RPC de synchronisation snapshot ci-dessus).
END;
$$;

REVOKE ALL ON FUNCTION public.set_mlm_metric_definition_scope(uuid, text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_mlm_metric_definition_scope(uuid, text, uuid[]) TO authenticated;

-- ============================================
-- 7. create_personal_mlm_metric_definition — RPC transactionnelle (§12 du rapport 3.5.2.1)
-- ============================================
-- ORDER-BUSINESS-3.5.2.1 §12 — remplace l'ancienne séquence "INSERT définition PUIS RPC scope"
-- (2 appels réseau distincts, rapport 3.5.2 §33) : la création d'une métrique personnelle avec un
-- périmètre 'selected' est désormais UNE seule transaction — soit la définition ET ses liaisons de
-- catalogue existent toutes les deux, soit AUCUNE des deux n'existe. `p_code` reste calculé côté
-- TypeScript (generateMetricCode, mlmMetricService.ts) : la normalisation finale (lower/btrim) et
-- le verrou d'immutabilité restent portés par le trigger existant
-- normalize_and_lock_mlm_metric_definition_code (déclenché normalement par cet INSERT, comme pour
-- tout autre appelant) — cette RPC ne duplique pas cette logique.
CREATE OR REPLACE FUNCTION public.create_personal_mlm_metric_definition(
  p_user_id      uuid,
  p_code         text,
  p_display_name text,
  p_scope        text,
  p_catalog_ids  uuid[],
  p_unit         text,
  p_active       boolean
)
RETURNS public.mlm_metric_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_definition    public.mlm_metric_definitions;
  v_catalog_id    uuid;
  v_catalog_type  text;
  v_catalog_owner uuid;
BEGIN
  -- Jamais se reposer uniquement sur l'appelant authentifié (SECURITY DEFINER bypass la RLS) —
  -- même exigence que set_mlm_metric_definition_scope/upsert_order_item_with_metric_sync.
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SCOPE_METRIC_NOT_OWNED';
  END IF;

  IF p_scope NOT IN ('all', 'selected') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SCOPE_INVALID_VALUE';
  END IF;

  IF p_scope = 'selected' AND (p_catalog_ids IS NULL OR array_length(p_catalog_ids, 1) IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SCOPE_SELECTED_REQUIRES_CATALOG';
  END IF;

  -- Pré-contrôle de TOUS les catalogues AVANT la moindre écriture (même raisonnement que
  -- set_mlm_metric_definition_scope §14/§25) : aucune définition partiellement créée.
  IF p_scope = 'selected' THEN
    FOREACH v_catalog_id IN ARRAY p_catalog_ids LOOP
      SELECT type, user_id INTO v_catalog_type, v_catalog_owner FROM public.catalogs WHERE id = v_catalog_id;
      IF NOT FOUND OR (v_catalog_type <> 'official' AND v_catalog_owner IS DISTINCT FROM p_user_id) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SCOPE_CATALOG_NOT_ACCESSIBLE';
      END IF;
    END LOOP;
  END IF;

  -- catalog_id toujours NULL pour une personnelle (§8/§10 du rapport 3.5.2.1) : jamais renseigné
  -- directement, remplacé intégralement par scope + mlm_metric_definition_catalogs. Une violation
  -- d'unicité (23505, code déjà utilisé par cet utilisateur) remonte TELLE QUELLE au client — même
  -- comportement que l'ancien chemin en 2 appels, déjà géré par DuplicateMetricCodeError côté
  -- TypeScript (mlmMetricService.ts), aucun changement nécessaire là.
  INSERT INTO public.mlm_metric_definitions (origin, user_id, catalog_id, code, display_name, unit, active, scope)
  VALUES ('personal', p_user_id, NULL, p_code, p_display_name, p_unit, p_active, p_scope)
  RETURNING * INTO v_definition;

  IF p_scope = 'selected' THEN
    FOREACH v_catalog_id IN ARRAY p_catalog_ids LOOP
      INSERT INTO public.mlm_metric_definition_catalogs (metric_definition_id, catalog_id, user_id)
      VALUES (v_definition.id, v_catalog_id, p_user_id)
      ON CONFLICT (metric_definition_id, catalog_id) DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.create_personal_mlm_metric_definition(uuid, text, text, text, uuid[], text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_personal_mlm_metric_definition(uuid, text, text, text, uuid[], text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
