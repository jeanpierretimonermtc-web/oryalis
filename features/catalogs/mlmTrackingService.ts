// ORDER-BUSINESS-3.6 — "Suivi MLM" : répond à "combien ai-je généré ?" (jamais "combien vaut ce
// produit ?", qui reste la responsabilité de mlmMetricService.ts / l'écran "Mes valeurs MLM" — les
// deux ne doivent JAMAIS être fusionnés, voir rapport §2). Source de vérité EXCLUSIVE :
// order_item_metric_snapshots (valeur unitaire FIGÉE au moment de la commande) + order_items
// (quantity/returned_qty) + orders (date/status/annulation) — jamais catalog_product_metric_values
// (valeur ACTUELLE du catalogue, qui a pu changer depuis, rapport §5/§43). Réutilise intégralement
// computeMlmTotals (mlmMetricService.ts) pour la formule gross/returned/net — aucune seconde
// formule indépendante qui pourrait diverger (rapport §35).
import { supabase } from '@/shared/lib/supabase'
import type { MetricOrigin } from '@/shared/lib/types'
import { computeMlmTotals } from '@/features/catalogs/mlmMetricService'
import type { OrderItemMetricSnapshot } from '@/shared/lib/types'
import { getCatalogs } from '@/features/catalogs/catalogService'

// ── Période ──────────────────────────────────────────────────────────────────────────────────

export type MlmTrackingPeriodPreset = 'this_month' | 'last_month' | 'last_3_months' | 'this_year' | 'custom'

export interface DateRange {
  startDate: string // ISO yyyy-mm-dd, inclusive
  endDate: string   // ISO yyyy-mm-dd, inclusive
}

function pad2(n: number): string { return String(n).padStart(2, '0') }
function ymd(d: Date): string { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }

// Même construction de plage que useDashboard.ts (useMonthlyRevenue, LRP-4.6) — dates locales
// simples, aucun nouveau système de timezone (rapport §15) : orders.order_date est une colonne
// date (pas timestamptz), la comparaison lexicographique yyyy-mm-dd suffit et reste cohérente
// avec le filtre déjà utilisé ailleurs dans le projet pour ce même champ.
export function getPeriodRange(preset: Exclude<MlmTrackingPeriodPreset, 'custom'>): DateRange {
  const now = new Date()
  switch (preset) {
    case 'this_month':
      return { startDate: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
    case 'last_month':
      return { startDate: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), endDate: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) }
    case 'last_3_months':
      return { startDate: ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1)), endDate: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
    case 'this_year':
      return { startDate: ymd(new Date(now.getFullYear(), 0, 1)), endDate: ymd(new Date(now.getFullYear(), 11, 31)) }
  }
}

// §44 — jamais le formatteur MONEY (§45 : PV/Credits/points ne sont pas des devises). Décimales
// uniquement si nécessaires ("1284" -> "1 284", "12.5" -> "12,5" en FR) — Intl.NumberFormat gère
// nativement le séparateur de milliers selon la locale, pas de logique manuelle.
export function formatMlmValue(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
}

// ── Lecture ──────────────────────────────────────────────────────────────────────────────────

export interface MlmTrackingCatalogBreakdown {
  // null = lignes non rattachables à un catalogue précis (catalog_product_id absent : produit
  // libre, ou produit catalogue supprimé depuis — ON DELETE SET NULL sur order_items, rapport §22).
  catalogId: string | null
  catalogName: string | null
  gross: number
  returned: number
  net: number
}

export interface MlmTrackingMetric {
  // metric_definition_id si connu, sinon le code figé (définition supprimée) — même identité que
  // MlmMetricTotal.key (mlmMetricService.ts), jamais le libellé (rapport §18).
  key: string
  code: string
  label: string
  origin: MetricOrigin
  gross: number
  returned: number
  net: number
  catalogBreakdown: MlmTrackingCatalogBreakdown[]
}

export interface MlmTrackingFilters extends DateRange {
  // null/undefined = "Tous les catalogues" (inclut aussi les lignes non rattachables, rapport §22).
  catalogId?: string | null
}

// ORDER-BUSINESS-3.6 §32/§33 — AUCUN N+1 : au plus 5 requêtes, quelle que soit la taille de la
// période (jamais 1 requête par commande ni par métrique) — orders (période) -> order_items
// (IN orderIds) -> snapshots (IN itemIds) -> catalog_products (IN catalogProductIds, pour la
// répartition par catalogue) -> mlm_metric_definitions (IN metricDefinitionIds, pour le libellé
// ACTUEL). La période est filtrée EN PREMIER côté requête `orders` (jamais tout l'historique
// chargé puis filtré côté client, rapport §33).
export async function fetchMlmTracking(userId: string, filters: MlmTrackingFilters): Promise<MlmTrackingMetric[]> {
  // §8/§39 — commande annulée : jamais incluse dans le suivi. cancelled_at est la voie réelle
  // observée en production (aucune ligne status='cancelled' constatée à l'audit) ; le filtre sur
  // `status` reste une garde défensive supplémentaire, sans coût, puisque 'cancelled' est une
  // valeur valide du type OrderStatus même si non utilisée aujourd'hui.
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, status')
    .eq('user_id', userId)
    .gte('order_date', filters.startDate)
    .lte('order_date', filters.endDate)
    .is('cancelled_at', null)
    .neq('status', 'cancelled')
  if (ordersError) throw new Error(ordersError.message)
  if (!orders || orders.length === 0) return []

  const orderStatusById = new Map(orders.map(o => [o.id, o.status as string]))
  const orderIds = orders.map(o => o.id)

  const { data: items, error: itemsError } = await supabase
    .from('order_items')
    .select('id, order_id, catalog_product_id, quantity, returned_qty')
    .in('order_id', orderIds)
  if (itemsError) throw new Error(itemsError.message)
  if (!items || items.length === 0) return []

  const itemIds = items.map(i => i.id)
  const { data: snapshots, error: snapError } = await supabase
    .from('order_item_metric_snapshots')
    .select('order_item_id, metric_definition_id, metric_code_snapshot, metric_label_snapshot, origin_snapshot, unit_value')
    .in('order_item_id', itemIds)
  if (snapError) throw new Error(snapError.message)
  if (!snapshots || snapshots.length === 0) return []

  // §22 — catalogue de chaque ligne, résolu via catalog_products (jamais stocké directement sur
  // order_items) : nécessaire à la fois pour le filtre catalogue actif ET la répartition par
  // catalogue au détail (§25), donc toujours calculé, filtre ou non.
  const catalogProductIds = [...new Set(items.map(i => i.catalog_product_id).filter((v): v is string => !!v))]
  const catalogIdByProductId = new Map<string, string>()
  if (catalogProductIds.length > 0) {
    const { data: products, error: prodError } = await supabase
      .from('catalog_products')
      .select('id, catalog_id')
      .in('id', catalogProductIds)
    if (prodError) throw new Error(prodError.message)
    for (const p of products ?? []) catalogIdByProductId.set(p.id, p.catalog_id)
  }
  // getCatalogs est déjà caché (catalogService.ts) — réutilisé plutôt qu'un second aller-retour
  // vers `catalogs` pour les seuls noms.
  const catalogs = await getCatalogs(userId)
  const catalogNameById = new Map(catalogs.map(c => [c.id, c.name]))

  // §19 — libellé ACTUEL si la définition existe encore, sinon metric_label_snapshot (géré par
  // computeMlmTotals lui-même) : une seule requête groupée pour tous les metric_definition_id non
  // NULL rencontrés dans la période.
  const definitionIds = [...new Set(snapshots.map(s => s.metric_definition_id).filter((v): v is string => !!v))]
  const currentLabelById = new Map<string, string>()
  if (definitionIds.length > 0) {
    const { data: defs, error: defError } = await supabase
      .from('mlm_metric_definitions')
      .select('id, display_name')
      .in('id', definitionIds)
    if (defError) throw new Error(defError.message)
    for (const d of defs ?? []) currentLabelById.set(d.id, d.display_name)
  }

  const snapshotsByOrderItemId = new Map<string, OrderItemMetricSnapshot[]>()
  for (const s of (snapshots as OrderItemMetricSnapshot[])) {
    const list = snapshotsByOrderItemId.get(s.order_item_id)
    if (list) list.push(s)
    else snapshotsByOrderItemId.set(s.order_item_id, [s])
  }

  // §7/§36 — status='returned' historique : traité comme un retour TOTAL même si returned_qty=0
  // (retours ligne par ligne inexistants avant ORDER-BUSINESS-4). Pour toute autre commande,
  // returned_qty fait foi normalement (retour partiel ou nul, §37/§38). §21/§22 — filtre catalogue
  // actif : exclut ici les lignes non rattachables (catalogId !== filters.catalogId), y compris
  // celles à catalogId null ; "Tous les catalogues" (filters.catalogId absent) les inclut toutes.
  const lines: Array<{ id: string; qty: number; returnedQty: number; catalogId: string | null }> = []
  for (const item of items) {
    const itemCatalogId = item.catalog_product_id ? (catalogIdByProductId.get(item.catalog_product_id) ?? null) : null
    if (filters.catalogId && itemCatalogId !== filters.catalogId) continue
    const status = orderStatusById.get(item.order_id)
    const returnedQty = status === 'returned' ? item.quantity : item.returned_qty
    lines.push({ id: item.id, qty: item.quantity, returnedQty, catalogId: itemCatalogId })
  }
  if (lines.length === 0) return []

  // Totaux globaux — même fonction que la répartition par catalogue ci-dessous (une seule
  // formule, jamais deux, rapport §35), appliquée une fois sur l'ensemble des lignes retenues.
  const totals = computeMlmTotals(lines, snapshotsByOrderItemId)

  // §25 — répartition par catalogue : la MÊME fonction rejouée sur chaque sous-ensemble de lignes
  // partageant le même catalogId (y compris le bucket null = "non rattachable"), jamais une
  // second calcul divergent.
  const catalogIds = [...new Set(lines.map(l => l.catalogId))]
  const breakdownByKey = new Map<string, MlmTrackingCatalogBreakdown[]>()
  for (const catId of catalogIds) {
    const subset = lines.filter(l => l.catalogId === catId)
    const subtotals = computeMlmTotals(subset, snapshotsByOrderItemId)
    const catalogName = catId ? (catalogNameById.get(catId) ?? null) : null
    for (const st of subtotals) {
      const list = breakdownByKey.get(st.key) ?? []
      list.push({ catalogId: catId, catalogName, gross: st.gross, returned: st.returned, net: st.net })
      breakdownByKey.set(st.key, list)
    }
  }

  const result: MlmTrackingMetric[] = totals.map(t => ({
    key: t.key,
    code: t.code,
    // §19 — libellé ACTUEL si la définition existe toujours (currentLabelById), sinon le libellé
    // figé au moment du snapshot (déjà porté par t.label via computeMlmTotals).
    label: currentLabelById.get(t.key) ?? t.label,
    origin: t.origin,
    gross: t.gross,
    returned: t.returned,
    net: t.net,
    catalogBreakdown: breakdownByKey.get(t.key) ?? [],
  }))

  // Ordre stable et déterministe (alphabétique sur le libellé affiché) — §17 : jamais de somme
  // entre métriques, l'ordre n'a donc aucune conséquence de calcul, uniquement de présentation.
  result.sort((a, b) => a.label.localeCompare(b.label))
  return result
}
