-- ORDER-BUSINESS-3.4.1 — RPC transactionnelle pour l'écriture atomique d'un order_item ET la
-- synchronisation de ses snapshots MLM, réservée aux deux cas identifiés comme réellement
-- risqués (rapport ORDER-BUSINESS-3.4 §1/§3) : nouvelle ligne catalogue, et changement réel de
-- catalog_product_id sur une ligne existante. Élimine PAR CONSTRUCTION l'état intermédiaire
-- "ligne écrite, snapshot pas encore écrit" qu'aucune logique TypeScript ne peut distinguer de
-- façon fiable d'une ligne legacy stable (voir rapport §2/§5 : deux appels REST séparés — upsert
-- de la ligne, puis écriture des snapshots — ne peuvent jamais être rendus atomiques côté client,
-- quelle que soit la sophistication de l'orchestration). N'est PAS appelée pour une ligne
-- existante dont le produit n'a pas changé (aucun risque cross-table dans ce cas, un simple
-- upsert client suffit toujours — voir orderItemService.ts).
--
-- ORDER-BUSINESS-3.4.2 — durcie : p_id désormais OBLIGATOIRE (l'application doit toujours générer
-- un id stable AVANT le premier appel, jamais laissé à la base — voir ensureLineIds dans
-- orderItemService.ts) ; accès à p_catalog_product_id vérifié explicitement (une fonction
-- SECURITY DEFINER ne doit jamais compter sur la RLS de catalogs/catalog_products) ; un p_id déjà
-- existant doit appartenir à la FOIS au même user_id ET au même order_id (jamais de déplacement
-- de ligne entre deux commandes via cette fonction).
--
-- Ne modifie AUCUNE migration déjà exécutée. Tables/contraintes/triggers de
-- 20260830_order_items.sql et 20260830_mlm_product_metrics.sql inchangés : cette RPC exécute les
-- MÊMES opérations SQL que l'orchestration TypeScript précédente, seulement regroupées dans UNE
-- transaction — les triggers de scope existants (check_catalog_product_metric_value_scope,
-- check_order_item_metric_snapshot_definition_scope, etc.) s'appliquent normalement, une
-- fonction SECURITY DEFINER ne les contourne pas (ce sont des triggers sur les tables cibles,
-- déclenchés par l'INSERT lui-même, indépendamment de qui l'exécute).
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
  v_item          public.order_items;
  v_catalog_type  text;
  v_catalog_owner uuid;
BEGIN
  -- §2 — id STABLE obligatoire : cette fonction ne doit plus jamais générer elle-même l'identité
  -- d'une ligne. L'application (ensureLineIds, orderItemService.ts) garantit qu'un id est déjà
  -- assigné AVANT le premier appel et le réutilise à travers tout retry — condition nécessaire
  -- pour qu'un batch de plusieurs nouvelles lignes converge sans churn/duplication (rapport
  -- ORDER-BUSINESS-3.4.2 §1/§4).
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'p_id is required — the caller must assign a stable id before calling this function';
  END IF;

  -- §8 — auto-protection obligatoire : cette fonction bypass la RLS de order_items/
  -- order_item_metric_snapshots (SECURITY DEFINER) — sans ces vérifications explicites, un
  -- appelant authentifié pourrait écrire dans la commande d'un AUTRE utilisateur en passant
  -- simplement un p_user_id/p_order_id arbitraire. Même exigence que
  -- revise_appointment_outcome (20260805_lot1_2_1_reliability.sql). Ne jamais se reposer
  -- uniquement sur le p_user_id transmis par le client : toujours revérifié contre auth.uid()
  -- ET contre l'ownership réel de la commande.
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'p_user_id must match the calling user';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND user_id = p_user_id) THEN
    RAISE EXCEPTION 'order % not found for user %', p_order_id, p_user_id;
  END IF;

  -- §7 — un p_id déjà existant doit appartenir à la FOIS au même user_id ET au même order_id :
  -- sans la vérification order_id, un utilisateur pourrait réutiliser l'id d'une ligne lui
  -- appartenant déjà pour la "déplacer" silencieusement vers une autre de ses commandes via
  -- p_order_id. Une order_item ne change JAMAIS de commande par cette fonction.
  IF EXISTS (
    SELECT 1 FROM public.order_items
    WHERE id = p_id AND (order_id <> p_order_id OR user_id <> p_user_id)
  ) THEN
    RAISE EXCEPTION 'order_item % does not belong to order %/user %', p_id, p_order_id, p_user_id;
  END IF;

  -- §5/§6/§10 — accès au produit catalogue : INDÉPENDANT de p_sync_metrics (une ligne peut
  -- référencer un produit sans que ses métriques soient synchronisées à CET appel précis, ex.
  -- p_sync_metrics=false sur une ligne dont le produit n'a pas changé — l'accès au produit
  -- lui-même reste une règle à part entière, jamais un bypass de sécurité). Une fonction
  -- SECURITY DEFINER ne doit jamais compter sur la RLS de catalogs/catalog_products : la RLS ne
  -- s'applique JAMAIS à l'intérieur d'une fonction SECURITY DEFINER (elle s'exécute avec les
  -- privilèges du propriétaire, qui bypass RLS), d'où cette vérification explicite.
  IF p_catalog_product_id IS NOT NULL THEN
    SELECT c.type, c.user_id INTO v_catalog_type, v_catalog_owner
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

  -- p_sync_metrics = isNew OU productChanged, décidé par l'appelant (orderItemService.ts) —
  -- jamais recalculé ici : cette fonction ne sait pas ce qu'était catalog_product_id AVANT cet
  -- appel, seul l'appelant (qui a lu order_items juste avant) le sait.
  IF p_sync_metrics THEN
    DELETE FROM public.order_item_metric_snapshots WHERE order_item_id = v_item.id;
    -- delete-first est SANS RISQUE ici (contrairement à un contexte non transactionnel, rapport
    -- ORDER-BUSINESS-3.4.1 §3/§7) : un échec de l'INSERT ci-dessous annule AUSSI ce DELETE et
    -- l'upsert de la ligne au-dessus — jamais un état "0 snapshot" observable de l'extérieur si
    -- l'un des deux échoue.
    IF v_item.catalog_product_id IS NOT NULL THEN
      -- §9 — filtrage EXPLICITE, indépendant de toute RLS (contournée par SECURITY DEFINER) :
      -- une métrique officielle (partagée) OU une métrique personnelle appartenant STRICTEMENT à
      -- p_user_id. Une métrique personnelle d'un AUTRE utilisateur attachée au même produit
      -- officiel (catalog_product_metric_values.metric_definition_id référençant une définition
      -- dont user_id <> p_user_id) est exclue par la seconde moitié de cette condition — jamais
      -- récupérée simplement parce qu'elle existe sur le produit (CAS H).
      INSERT INTO public.order_item_metric_snapshots
        (user_id, order_item_id, metric_definition_id, metric_code_snapshot, metric_label_snapshot, origin_snapshot, unit_value)
      SELECT p_user_id, v_item.id, md.id, md.code, md.display_name, md.origin, v.value
      FROM public.catalog_product_metric_values v
      JOIN public.mlm_metric_definitions md ON md.id = v.metric_definition_id
      WHERE v.catalog_product_id = v_item.catalog_product_id
        AND md.active = true
        AND (md.origin = 'official' OR md.user_id = p_user_id);
    END IF;
    -- catalog_product_id NULL (passage vers un produit libre) : DELETE déjà fait ci-dessus,
    -- aucun INSERT — exactement §15/§16 d'ORDER-BUSINESS-3.4, désormais atomique avec l'upsert
    -- de la ligne elle-même.
  END IF;

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_order_item_with_metric_sync(uuid, uuid, uuid, uuid, text, integer, numeric, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_order_item_with_metric_sync(uuid, uuid, uuid, uuid, text, integer, numeric, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
