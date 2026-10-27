-- ORDER-BUSINESS-4.2 — retours partiels : `returned_qty` sur order_items, conformément à la
-- conclusion de l'audit ORDER-BUSINESS-4.1 (modèle "colonne simple", pas de table d'événements
-- en V1). Additive uniquement : aucune nouvelle table, aucun trigger, aucun événement de retour.
--
-- Doctrine : gross_qty = quantity (inchangée, jamais modifiée par un retour) ; returned_qty =
-- quantité retournée, cumulative (l'utilisateur édite le TOTAL actuellement retourné, jamais un
-- "événement" incrémental) ; net_qty = quantity - returned_qty, calculée en application
-- (getNetQuantity), JAMAIS stockée en base (même doctrine que les snapshots MLM : stockage
-- unitaire/historique, calcul dérivé — §36 du rapport ORDER-BUSINESS-4.2).
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS returned_qty integer NOT NULL DEFAULT 0;

-- §21/§3 rapport — la DB reste AUTORITATIVE (l'UI/le service valident aussi, en amont, mais ne
-- remplacent jamais cette contrainte) : interdit tout état returned_qty négatif ou supérieur à la
-- quantité commandée, y compris si `quantity` est réduite après coup (toute UPDATE qui violerait
-- cette relation est refusée par Postgres, quelle que soit la colonne modifiée en premier).
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_returned_qty_check;
ALTER TABLE public.order_items ADD CONSTRAINT order_items_returned_qty_check
  CHECK (returned_qty >= 0 AND returned_qty <= quantity);

-- §3/§29 rapport ORDER-BUSINESS-4.2 — compatibilité historique : les 22 order_items existants
-- reçoivent `returned_qty = 0` via le DEFAULT ci-dessus (ALTER TABLE ADD COLUMN avec DEFAULT
-- remplit immédiatement les lignes existantes). AUCUN backfill arbitraire pour les commandes déjà
-- `status='returned'` (§25 rapport) : nous ne savons pas avec certitude ce qui a été retourné
-- ligne par ligne pour ces commandes historiques — inventer `returned_qty = quantity` serait une
-- donnée fabriquée, jamais une vérité observée. Ces commandes restent lisibles via leur `status`
-- global inchangé, sans détail de ligne retourné.
--
-- Aucune modification de order_items_id_user_id_key, des FK, de la RLS existante
-- (order_items_user_policy) ni d'aucune migration déjà exécutée (20260830_order_items.sql,
-- 20260830_mlm_product_metrics.sql, 20260830_order_item_metric_sync_rpc.sql). La RPC
-- upsert_order_item_with_metric_sync N'EST PAS modifiée par cette migration : auditée dans le
-- rapport ORDER-BUSINESS-4.2 §5, son INSERT/ON CONFLICT DO UPDATE ne référence explicitement
-- jamais `returned_qty` dans sa liste de colonnes — une nouvelle ligne reçoit donc naturellement
-- le DEFAULT 0, et une ligne existante mise à jour (changement de produit) ne voit JAMAIS
-- `returned_qty` réinitialisée, puisque cette colonne n'apparaît ni dans l'INSERT ni dans le
-- SET du ON CONFLICT DO UPDATE.

NOTIFY pgrst, 'reload schema';
