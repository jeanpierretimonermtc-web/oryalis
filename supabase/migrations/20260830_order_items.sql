-- ORDER-BUSINESS-2 — order_items : première fondation d'un modèle de commande structuré.
-- Aujourd'hui, le détail produit d'une commande vit uniquement dans `orders.products` (jsonb),
-- sans identité stable par ligne, sans intégrité référentielle vers le catalogue, et sans base
-- pour les évolutions futures (retours partiels par ligne, valeurs MLM par ligne — PV/Credits/
-- Points Volume — jamais stockées ici, voir order_item_metric_snapshots plus tard).
--
-- PRÉPARÉE MAIS NON EXÉCUTÉE — voir rapport ORDER-BUSINESS-2. Purement ADDITIVE : ne modifie,
-- ne supprime et ne rend NOT NULL aucune colonne existante. `orders.products` N'EST PAS
-- supprimée ni dépréciée en base — elle reste écrite en miroir de compatibilité (voir
-- features/orders/orderItemService.ts) tant que tous les consommateurs n'ont pas basculé.
--
-- Audit réel (2026-08-29, base live, lecture seule) : 17 commandes au total — 15 "simples"
-- (products IS NULL, product_name/amount exploitables, quantity toujours 1) et 2 "structurées"
-- (products = tableau non vide, 7 lignes au total). Aucune forme JSON inattendue (0 valeur
-- products non-tableau, 0 tableau vide, 0 ligne sans nom). Sur les 7 lignes structurées : 6 ont
-- un product_id qui correspond exactement à un catalog_products.id existant (0 référence
-- fantôme), 1 est un produit libre (HE citron, sans product_id). SUM(qty×price) des lignes
-- structurées correspond exactement à orders.amount pour les 2 commandes concernées (0 écart) —
-- aucune divergence financière historique à arbitrer dans ce lot.

-- ── Pré-requis intégrité (même pattern que clients_id_user_id_key / LRP-4.1 §10) ──────────────
-- orders.id est déjà PK (unique) : cette contrainte composite est trivialement satisfaite,
-- purement additive.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_id_user_id_key;
ALTER TABLE public.orders ADD CONSTRAINT orders_id_user_id_key UNIQUE (id, user_id);

CREATE TABLE IF NOT EXISTS public.order_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL,
  order_id               uuid NOT NULL,
  -- Nullable (§6/§12) : produit libre, produit catalogue supprimé depuis, donnée importée,
  -- commande historique — une ligne doit pouvoir exister sans référence catalogue certaine.
  catalog_product_id     uuid,
  -- Snapshot (§7) : le nom du produit TEL QU'IL ÉTAIT au moment de la commande. Si le catalogue
  -- renomme "BalanceOil" en "BalanceOil+" demain, cette ligne continue d'afficher "BalanceOil".
  -- Même doctrine prévue plus tard pour les valeurs MLM par ligne.
  product_name_snapshot  text NOT NULL,
  quantity               integer NOT NULL DEFAULT 1,
  -- Snapshot du prix RÉELLEMENT appliqué à cette commande (§9) — jamais recalculé depuis le
  -- catalogue actuel. Nullable : une ligne libre peut ne porter aucun prix connu (déjà le cas
  -- aujourd'hui dans orders.products, ex. "HE citron" sans price). Devise implicite = celle de
  -- la commande parente (orders.currency, déjà existante) : aucune nouvelle colonne `_eur`
  -- ajoutée ici — MONEY (conversion/devise multiple) reste un lot séparé à venir.
  unit_price             numeric,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- LRP-4.1 §10 / ORDER-BUSINESS-2 §5 — garantit qu'une ligne appartient bien au même user_id que
-- sa commande, y compris via un accès direct à la base. Contrairement aux FK
-- recurring_programs/recurring_program_occurrences (où une FK composite avec ON DELETE SET NULL
-- aurait nullifié des colonnes NOT NULL d'orders), ici ON DELETE CASCADE est le comportement
-- RÉELLEMENT souhaité (supprimer une commande doit supprimer ses lignes) : une FK composite
-- directe suffit, aucun trigger séparé nécessaire.
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_order_id_user_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_order_id_user_id_fkey
    FOREIGN KEY (order_id, user_id) REFERENCES public.orders(id, user_id) ON DELETE CASCADE;

-- FK simple (pas composite) vers le catalogue : aucune notion d'ON DELETE CASCADE ici, la
-- disparition d'un produit catalogue ne doit jamais effacer l'historique d'une ligne de
-- commande déjà passée (§6) — seul le lien se détache, le snapshot reste.
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_catalog_product_id_fkey;
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_catalog_product_id_fkey
    FOREIGN KEY (catalog_product_id) REFERENCES public.catalog_products(id) ON DELETE SET NULL;

ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_quantity_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_quantity_check CHECK (quantity > 0);

-- Volontairement PAS de returned_qty ni de colonnes de valeur MLM (PV/Credits/Points Volume)
-- dans cette table (§13/§14) — évolutions additives futures (ALTER TABLE ADD COLUMN, ou table
-- fille order_item_metric_snapshots), jamais bloquées par ce schéma minimal.

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_items_user_policy ON public.order_items;
CREATE POLICY order_items_user_policy ON public.order_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS order_items_user_id_idx ON public.order_items(user_id);

-- ── Backfill (§18/§19 — déterministe, idempotent, non destructif) ─────────────────────────────
-- Idempotence ET résumabilité (ORDER-BUSINESS-2.1 §8/§9), analysées explicitement :
-- 1. Chaque INSERT est gardé par NOT EXISTS(order_items déjà présents pour CETTE commande) — une
--    ré-exécution intégrale de cette migration ne duplique donc rien, sans dépendre d'une clé
--    artificielle sans sens métier.
-- 2. Une commande STRUCTURÉE ne peut jamais finir avec SEULEMENT une partie de ses lignes
--    migrées : le premier INSERT ci-dessous produit TOUTES les lignes d'une même commande (via
--    jsonb_array_elements) en UN SEUL statement SQL — un statement Postgres est atomique de bout
--    en bout (aucune sous-transaction/savepoint utilisée ici), donc soit toutes ses lignes sont
--    insérées, soit aucune ne l'est. Aucune contrainte d'unicité autre que la clé primaire
--    (uuid généré, jamais en collision) n'existe sur order_items : aucun scénario ne peut donc
--    rejeter certaines lignes d'une commande tout en acceptant les autres.
-- 3. Si l'exécution de CE FICHIER est interrompue entre les deux INSERT ci-dessous (structurées
--    puis simples), le rejouer intégralement est sûr : le premier INSERT retrouve un NOT EXISTS
--    déjà faux pour les commandes déjà migrées (aucun doublon) et le second termine le travail
--    pour les commandes encore non traitées. Les deux INSERT ciblent des ensembles de commandes
--    strictement disjoints (products non-vide vs products NULL/vide) : aucun chevauchement
--    possible entre les deux passes.
-- orders.products n'est jamais lu de manière destructive (aucun UPDATE/DELETE sur orders dans ce
-- fichier).

-- Commandes STRUCTURÉES (products = tableau non vide) → une ligne order_items par élément.
-- catalog_product_id n'est repris QUE s'il correspond à un catalog_products.id réel (LEFT JOIN) —
-- jamais deviné par un rapprochement de nom, jamais laissé pointer vers une référence fantôme.
INSERT INTO public.order_items (user_id, order_id, catalog_product_id, product_name_snapshot, quantity, unit_price)
SELECT
  o.user_id,
  o.id,
  cp.id,
  COALESCE(NULLIF(trim(elem->>'name'), ''), '—'),
  GREATEST(COALESCE((elem->>'qty')::int, 1), 1),
  NULLIF(elem->>'price', '')::numeric
FROM public.orders o
CROSS JOIN LATERAL jsonb_array_elements(o.products) AS elem
LEFT JOIN public.catalog_products cp ON cp.id::text = elem->>'product_id'
WHERE o.products IS NOT NULL
  AND jsonb_typeof(o.products) = 'array'
  AND jsonb_array_length(o.products) > 0
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id);

-- Commandes SIMPLES (products NULL ou vide, product_name/amount exploitables) → une seule ligne
-- de synthèse, reflétant exactement ce que l'application affiche déjà pour ces commandes.
INSERT INTO public.order_items (user_id, order_id, catalog_product_id, product_name_snapshot, quantity, unit_price)
SELECT
  o.user_id,
  o.id,
  NULL,
  o.product_name,
  1,
  o.amount
FROM public.orders o
WHERE (o.products IS NULL OR jsonb_array_length(o.products) = 0)
  AND o.product_name IS NOT NULL AND trim(o.product_name) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id);

NOTIFY pgrst, 'reload schema';
