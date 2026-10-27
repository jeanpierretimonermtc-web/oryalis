-- ORDER-BUSINESS-3 — valeurs MLM génériques associées aux produits : mlm_metric_definitions,
-- catalog_product_metric_values, order_item_metric_snapshots. Étend order_items (déjà créée et
-- exécutée par 20260830_order_items.sql, non modifiée ici — toute évolution DB = nouvelle
-- migration). Couvre UNIQUEMENT les "source product metrics" (PV, Credits, Points...) — pas les
-- derived metrics (Group Volume, DLV...) ni les règles de compensation (hors périmètre, voir
-- rapport ORDER-BUSINESS-3 §3).

-- ============================================
-- MLM_METRIC_DEFINITIONS
-- ============================================
-- Une définition = un "type" de valeur MLM (PV, Credits, Points Challenge...). Contextualisée
-- par catalogue et/ou par utilisateur : "PV" chez une marque n'est jamais supposée identique à
-- "PV" chez une autre (§35) — l'identité n'est donc jamais `code` seul, toujours (catalog_id,
-- code) ou (user_id, catalog_id, code). `code` est l'identifiant STABLE (jamais renommé, jamais
-- réutilisé pour un autre sens) ; `display_name` est le libellé, modifiable sans casser aucune
-- référence existante (§10).
CREATE TABLE IF NOT EXISTS public.mlm_metric_definitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin       text NOT NULL CHECK (origin IN ('official', 'personal')),
  catalog_id   uuid REFERENCES public.catalogs(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  code         text NOT NULL,
  display_name text NOT NULL,
  unit         text,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- §11/§12 : une définition officielle appartient toujours à un catalogue et jamais à un
  -- utilisateur (partagée par tous ceux qui utilisent ce catalogue, jamais recréée par compte).
  -- Une définition personnelle appartient toujours à un utilisateur ; catalog_id reste optionnel
  -- (NULL = utilisable sur n'importe quel produit, tout catalogue confondu — §12, cas de
  -- "Points Challenge" appliqué à un produit d'un catalogue officiel).
  -- ORDER-BUSINESS-3.3 — nommée `..._scope_check` (pas `..._origin_check`) : Postgres génère
  -- automatiquement un nom `mlm_metric_definitions_origin_check` pour le CHECK en ligne de la
  -- colonne `origin` ci-dessus (convention `<table>_<column>_check`), qui serait sinon entré en
  -- collision avec ce second CHECK explicite dans la MÊME instruction CREATE TABLE (erreur
  -- détectée à l'exécution réelle : "check constraint already exists").
  CONSTRAINT mlm_metric_definitions_scope_check CHECK (
    (origin = 'official' AND user_id IS NULL AND catalog_id IS NOT NULL) OR
    (origin = 'personal' AND user_id IS NOT NULL)
  )
);

-- §14/§35 — unicité TOUJOURS contextualisée, jamais une identité mondiale sur `code` seul.
CREATE UNIQUE INDEX IF NOT EXISTS mlm_metric_definitions_official_unique
  ON public.mlm_metric_definitions (catalog_id, code) WHERE origin = 'official';
CREATE UNIQUE INDEX IF NOT EXISTS mlm_metric_definitions_personal_scoped_unique
  ON public.mlm_metric_definitions (user_id, catalog_id, code) WHERE origin = 'personal' AND catalog_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mlm_metric_definitions_personal_global_unique
  ON public.mlm_metric_definitions (user_id, code) WHERE origin = 'personal' AND catalog_id IS NULL;

ALTER TABLE public.mlm_metric_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "official metric definitions visible to all" ON public.mlm_metric_definitions;
CREATE POLICY "official metric definitions visible to all" ON public.mlm_metric_definitions
  FOR SELECT USING (origin = 'official' OR auth.uid() = user_id);

DROP POLICY IF EXISTS "users manage own metric definitions" ON public.mlm_metric_definitions;
CREATE POLICY "users manage own metric definitions" ON public.mlm_metric_definitions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ORDER-BUSINESS-3.1 §13 / ORDER-BUSINESS-3.2 §10 — `code` est l'identité technique STABLE (§10) :
-- un verrou léger au niveau DB, pas seulement une convention de service, empêche tout renommage
-- technique silencieux. Fusionné avec la NORMALISATION (minuscule + trim) : sans elle, "PV",
-- "pv" et "Pv" seraient trois valeurs `code` distinctes pour les index uniques ci-dessus alors que
-- le service les considère fonctionnellement identiques — normaliser AVANT la vérification
-- d'immutabilité (sur INSERT et UPDATE, dans la MÊME fonction, pour ne jamais dépendre de l'ordre
-- d'exécution entre deux triggers BEFORE distincts sur le même événement). `display_name` reste
-- librement modifiable, non concerné.
CREATE OR REPLACE FUNCTION public.normalize_and_lock_mlm_metric_definition_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.code := lower(btrim(NEW.code));
  IF NEW.code = '' THEN
    RAISE EXCEPTION 'mlm_metric_definitions.code cannot be empty';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'mlm_metric_definitions.code is immutable (attempted % -> %)', OLD.code, NEW.code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_mlm_metric_definition_code ON public.mlm_metric_definitions;
DROP TRIGGER IF EXISTS normalize_and_lock_mlm_metric_definition_code ON public.mlm_metric_definitions;
CREATE TRIGGER normalize_and_lock_mlm_metric_definition_code
  BEFORE INSERT OR UPDATE ON public.mlm_metric_definitions
  FOR EACH ROW EXECUTE FUNCTION public.normalize_and_lock_mlm_metric_definition_code();

-- ORDER-BUSINESS-3.2 §1/§2 — gap confirmé : le CHECK ci-dessus et la RLS ("own" sur
-- mlm_metric_definitions.user_id) garantissent qu'une définition PERSONNELLE appartient à son
-- créateur, mais AUCUN des deux ne vérifie que le catalog_id auquel elle est scindée lui est
-- réellement accessible — USER_A pouvait scinder sa métrique personnelle sur CATALOG_B, un
-- catalogue custom appartenant à USER_B, en devinant/connaissant son UUID (la RLS de
-- mlm_metric_definitions ne lit jamais `catalogs`). SECURITY DEFINER pour la même raison que les
-- triggers de scope suivants : la validation doit voir l'état réel de `catalogs`, indépendamment
-- de ce que la RLS de la session appelante laisserait normalement voir.
CREATE OR REPLACE FUNCTION public.check_mlm_metric_definition_catalog_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_catalog_type  text;
  v_catalog_owner uuid;
BEGIN
  IF NEW.catalog_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT type, user_id INTO v_catalog_type, v_catalog_owner
  FROM public.catalogs WHERE id = NEW.catalog_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'catalogs % not found', NEW.catalog_id;
  END IF;

  -- Une définition OFFICIELLE est déjà garantie catalog_id NOT NULL par le CHECK ci-dessus, et ne
  -- peut être écrite que par une migration/un rôle privilégié (la RLS "own" bloque tout INSERT
  -- origin='official' pour un utilisateur normal, puisque user_id doit alors être NULL alors que
  -- WITH CHECK exige user_id = auth.uid()) — aucune restriction de catalogue supplémentaire n'a
  -- de sens ici : une métrique officielle EST intrinsèquement liée à SON catalogue.
  IF NEW.origin = 'personal' AND v_catalog_type <> 'official' AND v_catalog_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'personal metric definition (user %) cannot be scoped to catalog % owned by another user',
      NEW.user_id, NEW.catalog_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_mlm_metric_definition_catalog_scope ON public.mlm_metric_definitions;
CREATE TRIGGER check_mlm_metric_definition_catalog_scope
  BEFORE INSERT OR UPDATE ON public.mlm_metric_definitions
  FOR EACH ROW EXECUTE FUNCTION public.check_mlm_metric_definition_catalog_scope();

-- ============================================
-- CATALOG_PRODUCT_METRIC_VALUES
-- ============================================
-- Valeur d'une métrique pour un produit donné (§13) — jamais une colonne par métrique sur
-- catalog_products. Un même produit peut porter plusieurs valeurs simultanément (PV officiel +
-- Points Challenge personnel, §7) : chacune est une ligne distincte, identifiée par sa propre
-- définition référencée.
CREATE TABLE IF NOT EXISTS public.catalog_product_metric_values (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_product_id   uuid NOT NULL REFERENCES public.catalog_products(id) ON DELETE CASCADE,
  metric_definition_id uuid NOT NULL REFERENCES public.mlm_metric_definitions(id) ON DELETE CASCADE,
  value                numeric NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- §14 — une seule valeur par produit et par définition (empêche un doublon PV officiel sur le
  -- même produit) ; deux définitions différentes (PV officiel + Points Challenge perso) restent
  -- deux lignes distinctes, jamais bloquées l'une par l'autre.
  UNIQUE (catalog_product_id, metric_definition_id)
);

CREATE INDEX IF NOT EXISTS catalog_product_metric_values_product_idx
  ON public.catalog_product_metric_values (catalog_product_id);

ALTER TABLE public.catalog_product_metric_values ENABLE ROW LEVEL SECURITY;

-- §38/§39 — la portée (officielle/partagée vs personnelle) est intégralement portée par la
-- définition référencée : jamais de colonne user_id dupliquée ici qui pourrait diverger de sa
-- définition. Même pattern que la RLS existante de catalog_products vers catalogs (EXISTS).
DROP POLICY IF EXISTS "metric values visible via definition" ON public.catalog_product_metric_values;
CREATE POLICY "metric values visible via definition" ON public.catalog_product_metric_values
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.mlm_metric_definitions md
    WHERE md.id = catalog_product_metric_values.metric_definition_id
      AND (md.origin = 'official' OR md.user_id = auth.uid())
  ));

DROP POLICY IF EXISTS "users manage own metric values" ON public.catalog_product_metric_values;
CREATE POLICY "users manage own metric values" ON public.catalog_product_metric_values
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.mlm_metric_definitions md
    WHERE md.id = catalog_product_metric_values.metric_definition_id AND md.user_id = auth.uid()
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.mlm_metric_definitions md
    WHERE md.id = catalog_product_metric_values.metric_definition_id AND md.user_id = auth.uid()
  ));

-- ORDER-BUSINESS-3.1 §6/§7/§8/§9 — la FK vers mlm_metric_definitions/catalog_products garantit
-- seulement que les lignes référencées EXISTENT, jamais qu'elles sont MUTUELLEMENT COHÉRENTES
-- (une FK ne valide pas "ce produit appartient au bon catalogue pour cette définition") : un
-- trigger est nécessaire, l'UI/le service TypeScript seuls ne suffisent pas (§6, "ne dépends pas
-- uniquement de l'UI ou du service"). SECURITY DEFINER (comme revise_appointment_outcome,
-- 20260805_lot1_2_1_reliability.sql) : la validation doit voir l'état réel des tables, jamais
-- filtrée par la RLS du rôle appelant, pour rester une garantie fiable indépendamment de qui
-- écrit.
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
  v_product_catalog_id    uuid;
  v_product_catalog_type  text;
  v_product_catalog_owner uuid;
BEGIN
  SELECT origin, catalog_id, user_id INTO v_metric_origin, v_metric_catalog_id, v_metric_user_id
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

  -- §7 — une métrique OFFICIELLE (origin='official', catalog_id=X) ne peut s'appliquer qu'à un
  -- produit dont catalog_id = X. Exemple interdit : PV doTERRA sur un produit Zinzino.
  IF v_metric_origin = 'official' THEN
    IF v_product_catalog_id IS DISTINCT FROM v_metric_catalog_id THEN
      RAISE EXCEPTION 'official metric % (catalog %) cannot be applied to a product of catalog %',
        NEW.metric_definition_id, v_metric_catalog_id, v_product_catalog_id;
    END IF;
    RETURN NEW;
  END IF;

  -- §8 — une métrique PERSONNELLE SCINDÉE à un catalogue (catalog_id=X) ne peut s'appliquer
  -- qu'à un produit de CE catalogue.
  IF v_metric_catalog_id IS NOT NULL THEN
    IF v_product_catalog_id IS DISTINCT FROM v_metric_catalog_id THEN
      RAISE EXCEPTION 'personal metric % scoped to catalog % cannot be applied to a product of catalog %',
        NEW.metric_definition_id, v_metric_catalog_id, v_product_catalog_id;
    END IF;
    RETURN NEW;
  END IF;

  -- §9 — métrique PERSONNELLE GLOBALE (catalog_id NULL) : utilisable sur tout catalogue, mais
  -- UNIQUEMENT sur un produit que ce même utilisateur peut réellement voir/utiliser selon les
  -- règles déjà en vigueur sur catalogs/catalog_products (officiel = visible de tous ; custom =
  -- uniquement le sien). Empêche un utilisateur connaissant un UUID arbitraire d'attacher sa
  -- métrique personnelle à un produit privé d'un autre utilisateur.
  IF v_product_catalog_type <> 'official' AND v_product_catalog_owner IS DISTINCT FROM v_metric_user_id THEN
    RAISE EXCEPTION 'personal metric % (user %) cannot be applied to a product of another user''s catalog %',
      NEW.metric_definition_id, v_metric_user_id, v_product_catalog_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_catalog_product_metric_value_scope ON public.catalog_product_metric_values;
CREATE TRIGGER check_catalog_product_metric_value_scope
  BEFORE INSERT OR UPDATE ON public.catalog_product_metric_values
  FOR EACH ROW EXECUTE FUNCTION public.check_catalog_product_metric_value_scope();

-- ============================================
-- ORDER_ITEM_METRIC_SNAPSHOTS
-- ============================================
-- Prérequis (même technique que 20260830_order_items.sql pour orders) : order_items doit
-- pouvoir être référencée par (id, user_id) pour garantir par contrainte — pas seulement par
-- convention applicative — qu'un snapshot appartient toujours au même utilisateur que sa ligne.
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_id_user_id_key;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_id_user_id_key UNIQUE (id, user_id);

-- Valeur MLM FIGÉE au moment de la commande (§15) — jamais recalculée depuis le catalogue après
-- coup, y compris si le catalogue change de valeur ou si la définition est renommée/désactivée
-- (§17/§25/§29 : éditer une commande existante ne doit JAMAIS rafraîchir silencieusement ses
-- métriques).
CREATE TABLE IF NOT EXISTS public.order_item_metric_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_item_id         uuid NOT NULL,
  -- SET NULL (jamais CASCADE) : si une définition est un jour supprimée définitivement (cas rare
  -- — la désactivation `active=false` est la voie normale, §25), le snapshot doit rester lisible
  -- et ne pas disparaître avec elle.
  metric_definition_id  uuid REFERENCES public.mlm_metric_definitions(id) ON DELETE SET NULL,
  -- §17 — code ET libellé figés au moment du snapshot : une ancienne commande reste
  -- compréhensible même après un renommage, une désactivation, ou une suppression de la
  -- définition (auquel cas metric_definition_id devient NULL mais ces 2 colonnes restent).
  metric_code_snapshot  text NOT NULL,
  metric_label_snapshot text NOT NULL,
  origin_snapshot       text NOT NULL CHECK (origin_snapshot IN ('official', 'personal')),
  -- §18/§19 — valeur UNITAIRE, jamais un total opaque pré-multiplié : le total (quantity ×
  -- unit_value) reste dérivable en joignant order_items.quantity, condition nécessaire pour
  -- qu'un futur retour partiel calcule net_quantity × unit_value sans réinterpréter un total déjà
  -- agrégé.
  unit_value            numeric NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_item_metric_snapshots_order_item_user_fkey
    FOREIGN KEY (order_item_id, user_id) REFERENCES public.order_items(id, user_id) ON DELETE CASCADE,
  -- Empêche un doublon de snapshot pour la même métrique sur la même ligne tant que la
  -- définition existe encore (une fois metric_definition_id passé à NULL par ON DELETE SET NULL,
  -- la ligne est purement historique et ne peut plus entrer en conflit avec une nouvelle).
  UNIQUE (order_item_id, metric_definition_id)
);

CREATE INDEX IF NOT EXISTS order_item_metric_snapshots_order_item_idx
  ON public.order_item_metric_snapshots (order_item_id);
CREATE INDEX IF NOT EXISTS order_item_metric_snapshots_user_idx
  ON public.order_item_metric_snapshots (user_id);

ALTER TABLE public.order_item_metric_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_item_metric_snapshots_user_policy ON public.order_item_metric_snapshots;
CREATE POLICY order_item_metric_snapshots_user_policy ON public.order_item_metric_snapshots
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ORDER-BUSINESS-3.1 §12 — la FK composite (order_item_id, user_id) → order_items(id, user_id)
-- empêche déjà qu'un utilisateur crée un snapshot pour l'order_item d'un AUTRE utilisateur (la
-- paire ne correspondrait à aucune ligne order_items existante) — CONSERVÉE TELLE QUELLE, pas
-- remplacée (§8 ORDER-BUSINESS-3.2).
-- ORDER-BUSINESS-3.2 §3/§4/§5/§6/§7 — la version 3.1 de ce trigger ne vérifiait que
-- "personal.user_id = snapshot.user_id", jamais la cohérence avec le PRODUIT réel de
-- l'order_item : un snapshot "PV officiel doTERRA" pouvait être écrit sur un order_item dont le
-- produit est Zinzino (ou libre). Version étendue : mêmes règles de scope que
-- check_catalog_product_metric_value_scope, mais évaluées contre order_items.catalog_product_id
-- (le produit RÉEL de la ligne facturée) plutôt que contre un catalog_product_metric_values.
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
  v_item_catalog_product_id uuid;
  v_product_catalog_id      uuid;
  v_product_catalog_type    text;
  v_product_catalog_owner   uuid;
BEGIN
  IF NEW.metric_definition_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT origin, catalog_id, user_id INTO v_metric_origin, v_metric_catalog_id, v_metric_user_id
  FROM public.mlm_metric_definitions WHERE id = NEW.metric_definition_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mlm_metric_definitions % not found', NEW.metric_definition_id;
  END IF;

  -- §3.1 §12 — jamais la définition personnelle d'un AUTRE utilisateur (une officielle reste
  -- légitimement partagée).
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

  -- §4/§7 — officielle : exige un produit catalogue du MÊME catalogue. Un produit LIBRE
  -- (catalog_product_id NULL) est TOUJOURS refusé pour une métrique officielle : sans produit
  -- catalogue réel, Oryalis ne peut jamais affirmer qu'une valeur officielle de ce catalogue
  -- s'applique à cette ligne.
  IF v_metric_origin = 'official' THEN
    IF v_item_catalog_product_id IS NULL OR v_product_catalog_id IS DISTINCT FROM v_metric_catalog_id THEN
      RAISE EXCEPTION 'official metric % (catalog %) cannot be snapshotted on order_item % (product catalog %)',
        NEW.metric_definition_id, v_metric_catalog_id, NEW.order_item_id, v_product_catalog_id;
    END IF;
    RETURN NEW;
  END IF;

  -- §5/§7 — personnelle scindée à un catalogue : même règle, produit libre également refusé.
  IF v_metric_catalog_id IS NOT NULL THEN
    IF v_item_catalog_product_id IS NULL OR v_product_catalog_id IS DISTINCT FROM v_metric_catalog_id THEN
      RAISE EXCEPTION 'personal metric % scoped to catalog % cannot be snapshotted on order_item % (product catalog %)',
        NEW.metric_definition_id, v_metric_catalog_id, NEW.order_item_id, v_product_catalog_id;
    END IF;
    RETURN NEW;
  END IF;

  -- §6/§7 — personnelle GLOBALE : autorisée sur un produit LIBRE (rien à vérifier, ex. "Points
  -- Challenge" sur un "Pack personnalisé") ou sur un produit catalogue auquel l'utilisateur a
  -- réellement accès (officiel, ou son propre catalogue custom) — jamais le catalogue custom
  -- d'un autre utilisateur, même via un UUID deviné.
  IF v_item_catalog_product_id IS NOT NULL
     AND v_product_catalog_type <> 'official'
     AND v_product_catalog_owner IS DISTINCT FROM v_metric_user_id THEN
    RAISE EXCEPTION 'personal metric % (user %) cannot be snapshotted on order_item % (product of another user''s catalog %)',
      NEW.metric_definition_id, v_metric_user_id, NEW.order_item_id, v_product_catalog_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_order_item_metric_snapshot_definition_scope ON public.order_item_metric_snapshots;
CREATE TRIGGER check_order_item_metric_snapshot_definition_scope
  BEFORE INSERT OR UPDATE ON public.order_item_metric_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.check_order_item_metric_snapshot_definition_scope();

-- ============================================
-- BACKFILL — catalog_products.pv (legacy) → catalog_product_metric_values (§21/§45)
-- ============================================
-- Étape 1 : une définition officielle "pv" par catalogue possédant AU MOINS UNE valeur PV
-- renseignée — générique, ne cible nominativement aucune marque. D'après l'audit pré-migration,
-- seul doTERRA a des valeurs PV renseignées (126/128 produits) ; Zinzino n'en a aucune (0/45) et
-- ne recevra donc aucune définition par ce backfill.
INSERT INTO public.mlm_metric_definitions (origin, catalog_id, user_id, code, display_name, active)
SELECT 'official', c.id, NULL, 'pv', 'PV', true
FROM public.catalogs c
WHERE EXISTS (SELECT 1 FROM public.catalog_products cp WHERE cp.catalog_id = c.id AND cp.pv IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM public.mlm_metric_definitions md WHERE md.catalog_id = c.id AND md.code = 'pv' AND md.origin = 'official'
  );

-- Étape 2 : copie de la valeur ACTUELLE de catalog_products.pv vers catalog_product_metric_values
-- — copie d'une définition catalogue PRÉSENTE, pas une reconstitution d'historique de commande
-- (voir §45 du rapport : rien ne garantit que cette valeur actuelle égale la valeur au moment
-- d'une commande passée — c'est précisément pourquoi order_item_metric_snapshots n'est PAS
-- backfillée, voir plus bas). catalog_products.pv n'est ni modifiée ni supprimée par cette étape
-- (§21/§22 — aucune rupture, transition progressive).
INSERT INTO public.catalog_product_metric_values (catalog_product_id, metric_definition_id, value)
SELECT cp.id, md.id, cp.pv
FROM public.catalog_products cp
JOIN public.mlm_metric_definitions md ON md.catalog_id = cp.catalog_id AND md.code = 'pv' AND md.origin = 'official'
WHERE cp.pv IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.catalog_product_metric_values v
    WHERE v.catalog_product_id = cp.id AND v.metric_definition_id = md.id
  );

-- ============================================
-- AUCUN BACKFILL de order_item_metric_snapshots — décision explicite (§32/§45/§46 CAS K)
-- ============================================
-- Les 22 order_items existants (6 avec catalog_product_id, 16 sans) NE reçoivent AUCUN snapshot
-- par cette migration. Motif vérifié par audit chiffré (rapport ORDER-BUSINESS-3 §22) : parmi les
-- 6 order_items liés à un catalog_product_id, 2 référencent un produit dont le pv CATALOGUE
-- ACTUEL est déjà NULL — preuve directe que "valeur catalogue actuelle" et "valeur au moment de
-- la commande" peuvent déjà diverger, exactement le risque que §32/§45 imposent de ne jamais
-- deviner. Un snapshot inventé ici serait indiscernable d'un snapshot réel pour tout reporting
-- futur (§36). Ces 22 lignes restent sans métrique MLM tant qu'aucune source fiable n'est
-- identifiée — aucune action automatique n'est prévue pour elles.

NOTIFY pgrst, 'reload schema';
