// ORDER-BUSINESS-3 — fondation service des valeurs MLM génériques (PV, Credits, Points...).
// ORDER-BUSINESS-3.4 — câblage réel : affichage minimal dans OrderEditModal, brique de reporting
// (computeMlmTotals). ORDER-BUSINESS-3.4.1 — la création/synchronisation AUTOMATIQUE des
// snapshots au moment d'écrire un order_item (nouvelle ligne, ou changement réel de produit) ne
// vit PLUS ici : elle a été déplacée dans la RPC transactionnelle
// `upsert_order_item_with_metric_sync` (supabase/migrations/20260830_order_item_metric_sync_rpc.sql),
// appelée depuis orderItemService.saveOrderItems. Motif : deux appels REST séparés (upsert de la
// ligne, puis écriture des snapshots) ne peuvent jamais être rendus atomiques côté client — un
// échec entre les deux laissait un état "ligne écrite, snapshot manquant" indiscernable d'une
// ligne legacy stable pour tout retry ultérieur (rapport ORDER-BUSINESS-3.4.1 §1-§3). Les
// fonctions ci-dessous restent des briques de LECTURE/aperçu (resolveApplicableMetricValues) ou
// d'écriture MANUELLE hors du chemin automatique (setMetricValueForProduct,
// saveOrderItemMetricSnapshots pour un futur snapshot manuel sur produit libre, §14 du rapport
// ORDER-BUSINESS-3.1) — jamais réutilisées par le chemin critique nouvelle-ligne/changement-produit.
import { supabase } from '@/shared/lib/supabase'
import type { MlmMetricDefinition, CatalogProductMetricValue, OrderItemMetricSnapshot, MetricOrigin, MlmMetricScope } from '@/shared/lib/types'
import { getNetQuantity } from '@/features/orders/orderItemService'

// §35 — jamais une lecture globale par seul `code` : toujours scoper par catalogue et/ou
// utilisateur. Retourne les définitions ACTIVES applicables à un produit de ce catalogue pour cet
// utilisateur : officielles du catalogue + personnelles de l'utilisateur scindées à ce catalogue
// + personnelles globales de l'utilisateur (catalog_id null, utilisables sur n'importe quel
// produit, §12).
export async function fetchApplicableMetricDefinitions(userId: string, catalogId: string): Promise<MlmMetricDefinition[]> {
  const { data, error } = await supabase
    .from('mlm_metric_definitions')
    .select('*')
    .eq('active', true)
    .or(`and(origin.eq.official,catalog_id.eq.${catalogId}),and(origin.eq.personal,user_id.eq.${userId})`)
  if (error) throw new Error(error.message)
  // Filtre supplémentaire côté client : une définition personnelle scindée à un AUTRE catalogue
  // que celui-ci ne doit pas s'appliquer ici (seule catalog_id null ou = catalogId est valable).
  return (data as MlmMetricDefinition[]).filter(d => d.origin === 'official' || d.catalog_id === null || d.catalog_id === catalogId)
}

// ORDER-BUSINESS-3.5 §6/§7 — génère le `code` technique STABLE à partir du libellé, une seule
// fois, à la création : l'utilisateur ne saisit jamais de code. Minuscule, sans accents, séparé
// par `_` — cohérent avec la normalisation déjà appliquée en base par le trigger
// `normalize_and_lock_mlm_metric_definition_code` (`lower(btrim(...))`), qui reste le verrou
// AUTORITATIF (cette fonction ne fait qu'anticiper le même résultat côté UI, jamais un substitut
// à la contrainte DB). "Volume Été 2026" -> "volume_ete_2026".
// Plage Unicode des marques diacritiques combinantes (U+0300–U+036F) laissées par
// `normalize('NFD')' sur un caractère accentué (ex. "é" -> "e" + ce diacritique) — construite via
// les codes de caractères plutôt qu'un littéral accentué dans le source, pour éviter tout risque
// d'encodage.
const DIACRITICS_PATTERN = new RegExp(String.fromCharCode(0x5b, 0x5c, 0x75, 0x30, 0x33, 0x30, 0x30, 0x2d, 0x5c, 0x75, 0x30, 0x33, 0x36, 0x66, 0x5d))

export function generateMetricCode(displayName: string): string {
  const normalized = displayName
    .normalize('NFD').replace(DIACRITICS_PATTERN, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'metric'
}

// ORDER-BUSINESS-3.5.2 §8/§9 — remplace `catalogId?: string|null` (un seul catalogue ou global) :
// `scope` porte désormais explicitement l'intention ('all' ou 'selected'), `catalogIds` n'est
// utilisé QUE si scope='selected' (1 ou plusieurs catalogues, jamais un seul champ optionnel qui
// laisserait deviner le cas "aucun catalogue sélectionné" comme équivalent à "global").
export interface CreatePersonalMetricInput {
  displayName: string
  scope: MlmMetricScope
  catalogIds?: string[]
  unit?: string | null
  active?: boolean
}

// ORDER-BUSINESS-3.5 §6 — un nom trop proche d'une métrique déjà existante dans la même portée
// génère le même `code` (voir generateMetricCode) -> l'index unique DB rejette l'INSERT (23505).
// Type dédié pour que l'appelant (UI) distingue ce cas précis d'une erreur réseau/générique,
// sans dépendre d'un `error.code` Postgres brut à travers toute la couche service.
export class DuplicateMetricCodeError extends Error {
  constructor() { super('duplicate_metric_code') }
}

// ORDER-BUSINESS-3.5.2.1 §5/§11/§14 — erreurs typées pour create_personal_mlm_metric_definition
// et set_mlm_metric_definition_scope : chaque RPC lève un ERRCODE/MESSAGE STABLE (convention déjà
// utilisée par owner_console, 20260714_owner_console.sql) plutôt qu'un texte interpolé — permet à
// l'appelant (UI) de mapper vers un message précis SANS jamais afficher de SQL brut ni de nom de
// table (§5 du rapport 3.5.2.1), tout en gardant l'erreur technique complète dans le catch/log.
export class ScopeRequiresCatalogError extends Error {
  constructor() { super('scope_requires_catalog') }
}
export class CatalogNotAccessibleError extends Error {
  constructor() { super('catalog_not_accessible') }
}
export class MetricNotOwnedError extends Error {
  constructor() { super('metric_not_owned') }
}

// Traduit une erreur PostgREST/Postgres brute (message = le MESSAGE stable levé par la RPC) en une
// des erreurs typées ci-dessus, ou en Error générique si non reconnue (réseau, 42883 fonction
// absente tant que la migration n'est pas exécutée, etc.) — l'appelant loggue toujours l'originale
// via console.error avant d'afficher un message utilisateur (§5 : ne jamais masquer la cause
// technique dans les logs, seulement dans l'UI).
function mapMlmScopeRpcError(error: { message: string }): Error {
  if (error.message === 'SCOPE_SELECTED_REQUIRES_CATALOG') return new ScopeRequiresCatalogError()
  if (error.message === 'SCOPE_CATALOG_NOT_ACCESSIBLE') return new CatalogNotAccessibleError()
  if (error.message === 'SCOPE_METRIC_NOT_OWNED') return new MetricNotOwnedError()
  return new Error(error.message)
}

// §12 — une métrique personnelle appartient toujours à l'utilisateur qui la crée, jamais
// recréée pour "adapter" une définition officielle existante (§7 : les deux coexistent).
// ORDER-BUSINESS-3.5 §6 — `code` n'est plus un paramètre d'entrée : généré ici, une seule fois,
// depuis `displayName` (voir generateMetricCode). Un nom trop proche d'une métrique existante
// dans la même portée produit le même code -> l'index unique DB
// (`mlm_metric_definitions_personal_global_unique`) rejette l'INSERT ; l'appelant (UI) doit
// traduire cette erreur 23505 en message utilisateur, jamais la masquer.
// ORDER-BUSINESS-3.5.2.1 §12 — remplace l'ancienne séquence "INSERT PUIS RPC scope" (2 appels
// réseau, risque de définition orpheline entre les deux) par UN SEUL appel à la RPC transactionnelle
// create_personal_mlm_metric_definition (20260831_mlm_metric_multi_catalog.sql) : soit la
// définition ET ses liaisons de catalogue sont créées ensemble, soit rien n'est créé.
export async function createPersonalMetricDefinition(userId: string, input: CreatePersonalMetricInput): Promise<MlmMetricDefinition> {
  const { data, error } = await supabase.rpc('create_personal_mlm_metric_definition', {
    p_user_id: userId,
    p_code: generateMetricCode(input.displayName),
    p_display_name: input.displayName,
    p_scope: input.scope,
    p_catalog_ids: input.scope === 'selected' ? (input.catalogIds ?? []) : [],
    p_unit: input.unit ?? null,
    p_active: input.active ?? true,
  })
  if (error) {
    if (error.code === '23505') throw new DuplicateMetricCodeError()
    throw mapMlmScopeRpcError(error)
  }
  return data as MlmMetricDefinition
}

// ORDER-BUSINESS-3.5.2 §9/§11/§17 — remplace ATOMIQUEMENT (RPC transactionnelle, voir en-tête de
// 20260831_mlm_metric_multi_catalog.sql) le scope d'une métrique personnelle. `catalogIds` est
// TOUJOURS la liste COMPLÈTE désirée (jamais un delta) : la RPC supprime toutes les liaisons
// existantes puis réinsère exactement celles-ci en une seule transaction. Ne touche jamais
// catalog_product_metric_values ni order_item_metric_snapshots (§17 : aucune suppression
// silencieuse de données déjà configurées).
// ORDER-BUSINESS-3.5.2.1 §11 — validation "selected requires >=1 catalog" dupliquée ICI (en plus
// de l'UI et de la RPC, §11 du rapport 3.5.2.1 : "Validation obligatoire : UI + service + RPC") :
// échoue immédiatement, sans appel réseau, plutôt que de laisser la RPC le découvrir.
export async function updateMlmMetricScope(metricDefinitionId: string, scope: MlmMetricScope, catalogIds: string[]): Promise<void> {
  if (scope === 'selected' && catalogIds.length === 0) throw new ScopeRequiresCatalogError()
  const { error } = await supabase.rpc('set_mlm_metric_definition_scope', {
    p_metric_definition_id: metricDefinitionId,
    p_scope: scope,
    p_catalog_ids: scope === 'selected' ? catalogIds : [],
  })
  if (error) throw mapMlmScopeRpcError(error)
}

// Périmètre ACTUEL d'une métrique personnelle scope='selected' — vide pour scope='all' (aucune
// ligne n'existe jamais dans ce cas) ou pour une officielle (jamais concernée par cette table).
export async function fetchMetricDefinitionCatalogIds(metricDefinitionId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('mlm_metric_definition_catalogs')
    .select('catalog_id')
    .eq('metric_definition_id', metricDefinitionId)
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => row.catalog_id as string)
}

// ORDER-BUSINESS-3.5.2 §17 — avant de retirer un catalogue du périmètre d'une métrique
// personnelle, compte les valeurs DÉJÀ configurées sur des produits de ce(s) catalogue(s) pour
// cette métrique précise, afin d'avertir explicitement l'utilisateur (jamais une suppression
// silencieuse : cette fonction ne supprime rien, elle informe seulement en amont de l'appel à
// updateMlmMetricScope). Retourne 0 si aucun catalogue retiré n'a de valeur configurée.
export async function countConfiguredValuesForCatalogs(metricDefinitionId: string, catalogIds: string[]): Promise<number> {
  if (catalogIds.length === 0) return 0
  const { count, error } = await supabase
    .from('catalog_product_metric_values')
    .select('catalog_product_id, catalog_products!inner(catalog_id)', { count: 'exact', head: true })
    .eq('metric_definition_id', metricDefinitionId)
    .in('catalog_products.catalog_id', catalogIds)
  if (error) throw new Error(error.message)
  return count ?? 0
}

// ORDER-BUSINESS-3.5 §19 — renomme `display_name` uniquement : `code` reste verrouillé par le
// trigger DB (normalize_and_lock_mlm_metric_definition_code), les valeurs produit et snapshots
// existants restent intacts (aucune des deux tables ne référence display_name).
export async function updateMetricDefinitionDisplayName(id: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('mlm_metric_definitions')
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

// §20/§21/§25 — bascule active/inactive, jamais une suppression : une métrique déjà utilisée
// dans des commandes historiques ne doit jamais casser leurs snapshots
// (metric_code_snapshot/metric_label_snapshot restent lisibles indépendamment de `active`).
// Désactiver arrête uniquement la création de NOUVEAUX snapshots (filtré par
// resolveApplicableMetricValues / la RPC upsert_order_item_with_metric_sync, toutes deux
// `active=true`) ; réactiver n'effectue aucun rétro-calcul sur les commandes passées.
export async function setMetricDefinitionActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('mlm_metric_definitions')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export interface ProductMetricValueWithDefinition extends CatalogProductMetricValue {
  definition: MlmMetricDefinition
}

// §24 — affichage "Valeurs MLM" d'un produit : officielles ET personnelles, distinguées par
// definition.origin (jamais fusionnées en une liste indifférenciée côté UI).
export async function fetchMetricValuesForProduct(catalogProductId: string): Promise<ProductMetricValueWithDefinition[]> {
  const { data, error } = await supabase
    .from('catalog_product_metric_values')
    .select('*, definition:mlm_metric_definitions(*)')
    .eq('catalog_product_id', catalogProductId)
  if (error) throw new Error(error.message)
  return data as unknown as ProductMetricValueWithDefinition[]
}

// §13/§14 — une seule valeur par (produit, définition) : upsert sur la contrainte UNIQUE dédiée,
// jamais un DELETE ALL + INSERT ALL qui casserait l'id stable de la ligne de valeur.
// ORDER-BUSINESS-3.5 §16/§17 — 0 est une valeur PLEINEMENT valide (distincte de "non configuré",
// qui correspond à l'ABSENCE de ligne, jamais à une valeur 0 stockée) : ce n'est PAS ce que cette
// fonction empêche. Seules les valeurs STRICTEMENT NÉGATIVES sont refusées ici (V1 : les source
// product metrics MLM classiques sont additives, jamais négatives) — validation service, sans
// contrainte CHECK ajoutée en base pour ce lot (aucune migration nécessaire, voir rapport §23).
export async function setMetricValueForProduct(catalogProductId: string, metricDefinitionId: string, value: number): Promise<void> {
  if (value < 0) throw new Error('negative_value_not_allowed')
  const { error } = await supabase
    .from('catalog_product_metric_values')
    .upsert(
      { catalog_product_id: catalogProductId, metric_definition_id: metricDefinitionId, value, updated_at: new Date().toISOString() },
      { onConflict: 'catalog_product_id,metric_definition_id' },
    )
  if (error) throw new Error(error.message)
}

// ORDER-BUSINESS-3.5 §15 — effacer la valeur d'un produit pour CETTE métrique personnelle
// supprime uniquement la ligne `catalog_product_metric_values` correspondante (jamais une
// définition officielle : le champ WHERE cible metric_definition_id explicitement, ciblé côté UI
// pour ne jamais pouvoir viser une métrique officielle en pratique — voir MlmMetricProductsModal,
// qui n'autorise cette action que sur des métriques `origin='personal'` possédées par l'utilisateur).
export async function deleteMetricValueForProduct(catalogProductId: string, metricDefinitionId: string): Promise<void> {
  const { error } = await supabase
    .from('catalog_product_metric_values')
    .delete()
    .eq('catalog_product_id', catalogProductId)
    .eq('metric_definition_id', metricDefinitionId)
  if (error) throw new Error(error.message)
}

// ORDER-BUSINESS-3.5.2 §22/§23/§24/§25 — application EN MASSE d'UNE valeur à N produits pour une
// même métrique. INTERDIT : une requête par produit (§23) — un seul `.upsert()` avec un tableau de
// N lignes est traduit par PostgREST en UN SEUL INSERT ... ON CONFLICT SQL portant les N lignes,
// exécuté comme une seule instruction — donc atomique PAR CONSTRUCTION (§24 : soit les N lignes
// sont écrites, soit aucune ne l'est ; le trigger check_catalog_product_metric_value_scope
// s'applique normalement à CHAQUE ligne de ce même statement, une violation sur une seule ligne
// fait échouer — et donc annule — l'ensemble). Aucune RPC nécessaire ici (contrairement au scope,
// qui enchaîne deux tables) : une seule table, une seule requête suffit à garantir l'atomicité.
// `value` peut être 0 (§25 : une vraie valeur, jamais rejetée) — seule une valeur strictement
// négative est refusée, même règle que setMetricValueForProduct.
export async function bulkSetMetricValueForProducts(metricDefinitionId: string, catalogProductIds: string[], value: number): Promise<void> {
  if (catalogProductIds.length === 0) return
  if (value < 0) throw new Error('negative_value_not_allowed')
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('catalog_product_metric_values')
    .upsert(
      catalogProductIds.map(catalogProductId => ({ catalog_product_id: catalogProductId, metric_definition_id: metricDefinitionId, value, updated_at: now })),
      { onConflict: 'catalog_product_id,metric_definition_id' },
    )
  if (error) throw new Error(error.message)
}

// ORDER-BUSINESS-3.5.2 §26 — retrait EN MASSE : un seul DELETE ... WHERE catalog_product_id IN (...)
// AND metric_definition_id = ..., atomique par construction (même raisonnement que ci-dessus).
// Ne peut jamais cibler une définition officielle en pratique : l'appelant (UI) ne propose cette
// action que sur une métrique personnelle possédée par l'utilisateur (même garde qu'ailleurs dans
// ce fichier) — la RLS ("users manage own metric values") le garantirait de toute façon côté serveur.
export async function bulkDeleteMetricValueForProducts(metricDefinitionId: string, catalogProductIds: string[]): Promise<void> {
  if (catalogProductIds.length === 0) return
  const { error } = await supabase
    .from('catalog_product_metric_values')
    .delete()
    .eq('metric_definition_id', metricDefinitionId)
    .in('catalog_product_id', catalogProductIds)
  if (error) throw new Error(error.message)
}

// ORDER-BUSINESS-3.5 §11/§12 — valeurs déjà configurées pour un LOT de produits, pour UNE
// métrique donnée (page détail : liste de produits + leur valeur actuelle ou "Non configuré").
// 1 requête pour N produits, jamais N requêtes individuelles (§12 : éviter le N+1, sans
// sur-optimiser au-delà).
export async function fetchMetricValuesForProductIds(metricDefinitionId: string, catalogProductIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (catalogProductIds.length === 0) return map
  const { data, error } = await supabase
    .from('catalog_product_metric_values')
    .select('catalog_product_id, value')
    .eq('metric_definition_id', metricDefinitionId)
    .in('catalog_product_id', catalogProductIds)
  if (error) throw new Error(error.message)
  for (const row of data ?? []) map.set(row.catalog_product_id, Number(row.value))
  return map
}

export interface ResolvedMetricValue {
  metric_definition_id: string
  code: string
  display_name: string
  origin: MetricOrigin
  unit_value: number
}

// §26 — résout les métriques applicables à un produit pour un utilisateur donné (officielles du
// catalogue du produit + personnelles de l'utilisateur, actives uniquement). Pure lecture : ne
// crée rien, n'écrit rien. ORDER-BUSINESS-3.4.1 — sert désormais d'APERÇU côté TypeScript (ex.
// future UI "Mes valeurs MLM") ; le chemin d'ÉCRITURE automatique (nouvelle ligne/changement de
// produit) recalcule cette même résolution en SQL, à l'intérieur de la RPC transactionnelle
// upsert_order_item_with_metric_sync — duplication de logique assumée et nécessaire (une fonction
// Postgres ne peut pas appeler du TypeScript), les deux lisant les mêmes tables avec les mêmes
// filtres (`active=true`, `origin='official' OR user_id=...`).
export async function resolveApplicableMetricValues(userId: string, catalogProductId: string): Promise<ResolvedMetricValue[]> {
  const values = await fetchMetricValuesForProduct(catalogProductId)
  return values
    .filter(v => v.definition.active && (v.definition.origin === 'official' || v.definition.user_id === userId))
    .map(v => ({
      metric_definition_id: v.definition.id,
      code: v.definition.code,
      display_name: v.definition.display_name,
      origin: v.definition.origin,
      unit_value: v.value,
    }))
}

// ORDER-BUSINESS-3.1 §14 — produit LIBRE en commande (catalog_product_id null) : aucune valeur
// catalogue possible (catalog_product_metric_values exige un catalog_product_id), mais une
// valeur MLM MANUELLE reste possible directement en snapshot, sans nouvelle table — décision
// confirmée : une définition personnelle (globale, catalog_id null, ou scindée à un catalogue,
// peu importe ici puisqu'aucun produit catalogue n'est impliqué) porte la value saisie à la
// main. Combiner avec saveOrderItemMetricSnapshots(userId, orderItemId, [ce résultat]).
export function buildManualOrderItemMetricSnapshot(definition: MlmMetricDefinition, value: number): ResolvedMetricValue {
  return {
    metric_definition_id: definition.id,
    code: definition.code,
    display_name: definition.display_name,
    origin: definition.origin,
    unit_value: value,
  }
}

export async function fetchOrderItemMetricSnapshots(orderItemId: string): Promise<OrderItemMetricSnapshot[]> {
  const { data, error } = await supabase
    .from('order_item_metric_snapshots')
    .select('*')
    .eq('order_item_id', orderItemId)
  if (error) throw new Error(error.message)
  return data as OrderItemMetricSnapshot[]
}

// ORDER-BUSINESS-3.4 §30 — chargement groupé (1 requête pour N lignes) : évite le N+1 quand un
// écran affiche plusieurs order_items à la fois (ex. OrderEditModal, toutes les lignes d'une
// commande). Retourne une Map même pour les lignes sans snapshot (absentes de la Map, jamais une
// entrée vide) — au consommateur de traiter `undefined`/`[]` de façon équivalente.
export async function fetchMetricSnapshotsForOrderItems(orderItemIds: string[]): Promise<Map<string, OrderItemMetricSnapshot[]>> {
  const map = new Map<string, OrderItemMetricSnapshot[]>()
  if (orderItemIds.length === 0) return map
  const { data, error } = await supabase
    .from('order_item_metric_snapshots')
    .select('*')
    .in('order_item_id', orderItemIds)
  if (error) throw new Error(error.message)
  for (const row of (data as OrderItemMetricSnapshot[]) ?? []) {
    const list = map.get(row.order_item_id)
    if (list) list.push(row)
    else map.set(row.order_item_id, [row])
  }
  return map
}

// ORDER-BUSINESS-4.2 §15/§16 — API return-aware : gross (quantité brute commandée), returned
// (quantité retournée), net (quantité conservée), TOUJOURS les trois, jamais un champ `total`
// ambigu. `unit_value` (snapshot) n'est jamais recalculé ni modifié ici — seule la quantité
// utilisée pour chaque composante change (§15 du rapport).
export interface MlmMetricTotal {
  // metric_definition_id si connu, sinon le code figé (définition supprimée, §29) — jamais le
  // libellé, modifiable et donc impropre à identifier une métrique de façon stable.
  key: string
  code: string
  label: string
  origin: MetricOrigin
  gross: number
  returned: number
  net: number
}

// ORDER-BUSINESS-3.4 §33, étendue ORDER-BUSINESS-4.2 §15/§16/§18 — somme PURE des snapshots d'un
// ensemble de lignes (une commande aujourd'hui, un autre regroupement demain), groupée par
// IDENTITÉ de métrique, return-aware : `returnedQty` absent/0 => `returned=0` et `net=gross`
// (comportement identique à avant l'introduction des retours, aucune régression pour les lignes
// sans retour). unit_value × quantité à la lecture, jamais un total pré-stocké — aucune écriture,
// aucun dashboard : brique de reporting réutilisable plus tard (§25 du rapport ORDER-BUSINESS-4.2).
// Aucune branche par métrique (PV/Credits/...) — la même formule s'applique à tous les snapshots
// d'une ligne, avec la MÊME returnedQty (§18/§24 : aucune distinction official/personal ici).
export function computeMlmTotals(
  lines: Array<{ id?: string; qty: number; returnedQty?: number }>,
  snapshotsByOrderItemId: Map<string, OrderItemMetricSnapshot[]>,
): MlmMetricTotal[] {
  const totals = new Map<string, MlmMetricTotal>()
  for (const line of lines) {
    if (!line.id) continue
    const returnedQty = line.returnedQty ?? 0
    const netQty = getNetQuantity(line.qty, returnedQty)
    for (const snap of snapshotsByOrderItemId.get(line.id) ?? []) {
      const key = snap.metric_definition_id ?? `code:${snap.metric_code_snapshot}`
      const gross = line.qty * snap.unit_value
      const returned = returnedQty * snap.unit_value
      const net = netQty * snap.unit_value
      const existing = totals.get(key)
      if (existing) {
        existing.gross += gross
        existing.returned += returned
        existing.net += net
      } else {
        totals.set(key, { key, code: snap.metric_code_snapshot, label: snap.metric_label_snapshot, origin: snap.origin_snapshot, gross, returned, net })
      }
    }
  }
  return [...totals.values()]
}

// ORDER-BUSINESS-3.4.1 §9 — remplace INTÉGRALEMENT les snapshots d'UNE ligne de commande. Le
// chemin AUTOMATIQUE (nouvelle ligne, changement réel de produit) n'appelle PLUS cette fonction
// depuis TypeScript : la RPC `upsert_order_item_with_metric_sync` fait l'équivalent en SQL, dans
// la même transaction que l'écriture de la ligne (voir en-tête de fichier). Cette fonction reste
// utile pour un futur snapshot MANUEL (ex. métrique personnelle sur un produit libre, §14 du
// rapport ORDER-BUSINESS-3.1 — hors du chemin critique nouvelle-ligne/changement-produit, donc
// sans le même risque d'incohérence cross-table : aucune écriture concurrente sur order_items
// n'accompagne cet appel).
export async function saveOrderItemMetricSnapshots(userId: string, orderItemId: string, snapshots: ResolvedMetricValue[]): Promise<void> {
  const { error: deleteError } = await supabase.from('order_item_metric_snapshots').delete().eq('order_item_id', orderItemId)
  if (deleteError) throw new Error(deleteError.message)
  if (snapshots.length === 0) return
  const { error: insertError } = await supabase.from('order_item_metric_snapshots').insert(
    snapshots.map(s => ({
      user_id: userId,
      order_item_id: orderItemId,
      metric_definition_id: s.metric_definition_id,
      metric_code_snapshot: s.code,
      metric_label_snapshot: s.display_name,
      origin_snapshot: s.origin,
      unit_value: s.unit_value,
    })),
  )
  if (insertError) throw new Error(insertError.message)
}

// ORDER-BUSINESS-3.5 §1/§3/§4/§5, étendue ORDER-BUSINESS-3.5.2 §16/§30/§31 — ligne de la page "Mes
// valeurs MLM" : une définition (officielle ou personnelle) + les NOMS de ses catalogues (§16 :
// "doTERRA · Zinzino" pour une personnelle scope='selected', un seul nom pour une officielle,
// tableau vide pour une personnelle scope='all') + le nombre de produits configurés. `catalogName`
// (singulier) est retiré : remplacé par `catalogNames` (toujours un tableau, jamais un champ
// optionnel unique) pour représenter fidèlement 0..N catalogues sans cas particulier côté UI.
export interface MlmMetricDefinitionOverview extends MlmMetricDefinition {
  catalogNames: string[]
  configuredProductCount: number
}

// Toutes les définitions VISIBLES par l'utilisateur : officielles (tout catalogue, partagées) +
// personnelles lui appartenant — RLS déjà appliquée par la policy "official OR own" de
// mlm_metric_definitions, cette requête ne fait qu'utiliser ce que l'utilisateur peut déjà voir.
export async function fetchMlmMetricsOverview(userId: string): Promise<MlmMetricDefinitionOverview[]> {
  const { data, error } = await supabase
    .from('mlm_metric_definitions')
    .select('*, catalog:catalogs(name)')
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  const defs = data as unknown as (MlmMetricDefinition & { catalog: { name: string } | null })[]

  const ids = defs.map(d => d.id)
  const counts = new Map<string, number>()
  if (ids.length > 0) {
    const { data: values, error: valuesError } = await supabase
      .from('catalog_product_metric_values')
      .select('metric_definition_id')
      .in('metric_definition_id', ids)
    if (valuesError) throw new Error(valuesError.message)
    for (const row of values ?? []) counts.set(row.metric_definition_id, (counts.get(row.metric_definition_id) ?? 0) + 1)
  }

  // ORDER-BUSINESS-3.5.2 §16/§29 — 1 requête pour TOUTES les métriques personnelles scope='selected'
  // (jamais N requêtes, une par métrique) : jointe pour lire aussi le nom du catalogue en même
  // temps que son id, réutilisé directement dans catalogNames sans second aller-retour.
  const selectedIds = defs.filter(d => d.origin === 'personal' && d.scope === 'selected').map(d => d.id)
  const catalogNamesByMetric = new Map<string, string[]>()
  if (selectedIds.length > 0) {
    const { data: links, error: linksError } = await supabase
      .from('mlm_metric_definition_catalogs')
      .select('metric_definition_id, catalog:catalogs(name)')
      .in('metric_definition_id', selectedIds)
    if (linksError) throw new Error(linksError.message)
    for (const row of (links as unknown as { metric_definition_id: string; catalog: { name: string } | null }[]) ?? []) {
      if (!row.catalog?.name) continue
      const list = catalogNamesByMetric.get(row.metric_definition_id)
      if (list) list.push(row.catalog.name)
      else catalogNamesByMetric.set(row.metric_definition_id, [row.catalog.name])
    }
  }

  return defs.map(d => ({
    ...d,
    catalogNames: d.origin === 'official' ? (d.catalog?.name ? [d.catalog.name] : []) : (catalogNamesByMetric.get(d.id) ?? []),
    configuredProductCount: counts.get(d.id) ?? 0,
  }))
}

// ORDER-BUSINESS-3.5 §10 — note : le sélecteur de catalogue de la page "Mes valeurs MLM" réutilise
// directement `getCatalogs(userId)` (features/catalogs/catalogService.ts), déjà filtré (officiels
// + custom de l'utilisateur, jamais le catalogue custom d'un autre — même règle que le trigger DB
// check_mlm_metric_definition_catalog_scope, la DB restant l'autorité finale) et caché — aucune
// nouvelle fonction créée ici pour ne pas dupliquer cette couche.
