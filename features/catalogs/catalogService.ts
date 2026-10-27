import { supabase } from '@/shared/lib/supabase'
import type { Catalog, CatalogProduct, CatalogProductListItem } from '@/shared/lib/types'

// ── Cache mémoire léger (P1.2 — diagnostic Egress) ────────────────────────────
// Objectif : éviter de retélécharger catalogs/catalog_products à chaque montage
// (Picker ouvert/fermé plusieurs fois, focus répété sur l'écran Catalogue). Vit
// au niveau du module : survit au démontage/remontage de tous les consommateurs
// (Picker, écran Catalogue, écrans Réglages qui appellent getCatalogs()
// directement) — un useMemo local au Picker serait insuffisant puisque celui-ci
// est détruit à chaque fermeture de la modale.
//
// Isolation utilisateur (P1.2a — durcie après audit) :
//  1. productsCache est indexé par `${userId}:${catalogId}`, jamais par catalogId
//     seul — la confidentialité ne dépend plus de l'ordre d'appel getCatalogs()
//     puis getCatalogProducts() : même si un composant conserve un catalogId
//     périmé après un changement de compte (écran resté monté en arrière-plan
//     dans un navigateur à onglets, par ex.), la clé de lecture pour le nouvel
//     utilisateur ne correspond jamais à une entrée écrite pour l'ancien.
//  2. cacheGeneration (epoch) : Map.clear() ne peut pas annuler une requête déjà
//     en vol — une Promise de l'utilisateur A démarrée avant un logout peut se
//     résoudre APRÈS la purge liée au login de B. Chaque fetch capture la
//     génération au démarrage ; il n'écrit en cache que si la génération n'a pas
//     changé entre-temps, sinon le résultat est simplement jeté (jamais stocké).
//
// Fraîcheur : TTL léger (5 min) + invalidation ciblée après chaque mutation
// connue (createCustomCatalog, addProductToCatalog).
const CATALOGS_TTL_MS = 5 * 60 * 1000
const PRODUCTS_TTL_MS = 5 * 60 * 1000

type CacheEntry<T> = { data: T; expiresAt: number }

let lastUserId: string | null = null
let cacheGeneration = 0

const catalogsCache = new Map<string, CacheEntry<Catalog[]>>()        // clé : userId
const catalogsInFlight = new Map<string, Promise<Catalog[]>>()        // clé : userId
const productsCache = new Map<string, CacheEntry<CatalogProductListItem[]>>() // clé : `${userId}:${catalogId}`
const productsInFlight = new Map<string, Promise<CatalogProductListItem[]>>() // clé : `${userId}:${catalogId}`

function purgeCatalogCache() {
  catalogsCache.clear()
  catalogsInFlight.clear()
  productsCache.clear()
  productsInFlight.clear()
  cacheGeneration++
}

// Lecture avec cache + déduplication in-flight + garde de génération, factorisée
// entre getCatalogs et getCatalogProducts (même logique, deux Maps distinctes).
// N'écrit jamais en cache : ni une erreur (fetcher() rejette avant d'atteindre
// cache.set), ni un résultat devenu obsolète (génération changée pendant le vol).
async function cachedFetch<T>(
  cache: Map<string, CacheEntry<T>>,
  inFlight: Map<string, Promise<T>>,
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.data

  const existing = inFlight.get(key)
  if (existing) return existing

  const generationAtStart = cacheGeneration
  const promise = (async () => {
    const result = await fetcher()
    if (generationAtStart === cacheGeneration) {
      cache.set(key, { data: result, expiresAt: Date.now() + ttlMs })
    }
    return result
  })()

  inFlight.set(key, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(key)
  }
}

export async function getCatalogs(userId: string): Promise<Catalog[]> {
  if (userId !== lastUserId) {
    purgeCatalogCache()
    lastUserId = userId
  }
  return cachedFetch(catalogsCache, catalogsInFlight, userId, CATALOGS_TTL_MS, async () => {
    const { data, error } = await supabase
      .from('catalogs')
      .select('*')
      .or(`type.eq.official,user_id.eq.${userId}`)
      .order('name')
    if (error) throw error
    return data as Catalog[]
  })
}

// image_url exclu : colonne présente en base (et dans l'entité complète CatalogProduct,
// cf. addProductToCatalog ci-dessous) mais jamais lue par les consommateurs de CETTE
// fonction (CatalogProductPicker, écran Catalogue) — vérifié par recherche globale (P2.1).
const CATALOG_PRODUCT_COLS = 'id, catalog_id, sku, name, category, description, unit, retail_price_eur, wholesale_price_eur, pv, latin_name, created_at'

// ORDER-BUSINESS-3.5.2 §34 — PostgREST plafonne une réponse à 1000 lignes par défaut : un
// catalogue dépassant ce seuil (préparé pour 5 000 produits, voir rapport) serait silencieusement
// TRONQUÉ par un simple `.select()` sans pagination — aucune erreur, juste moins de lignes que la
// réalité. Boucle par pages de 1000 (`.range()`) jusqu'à une page incomplète, résultat concaténé
// mis en cache normalement sous la même clé qu'avant (transparent pour tous les appelants
// existants). Sans effet observable pour les catalogues actuels (128/45 produits, tient dans une
// seule page) — filet de sécurité pour la croissance future, pas une reconstruction de l'existant.
const PRODUCTS_PAGE_SIZE = 1000

export async function getCatalogProducts(userId: string, catalogId: string): Promise<CatalogProductListItem[]> {
  const key = `${userId}:${catalogId}`
  return cachedFetch(productsCache, productsInFlight, key, PRODUCTS_TTL_MS, async () => {
    const all: CatalogProductListItem[] = []
    let offset = 0
    for (;;) {
      const { data, error } = await supabase
        .from('catalog_products')
        .select(CATALOG_PRODUCT_COLS)
        .eq('catalog_id', catalogId)
        .order('category')
        .order('name')
        .range(offset, offset + PRODUCTS_PAGE_SIZE - 1)
      if (error) throw error
      const page = data as CatalogProductListItem[]
      all.push(...page)
      if (page.length < PRODUCTS_PAGE_SIZE) break
      offset += PRODUCTS_PAGE_SIZE
    }
    return all
  })
}

export async function createCustomCatalog(
  userId: string,
  name: string,
  icon: string = '📦',
  color: string = '#007AFF'
): Promise<Catalog> {
  const { data, error } = await supabase
    .from('catalogs')
    .insert({ name, brand: null, type: 'custom', user_id: userId, icon, color })
    .select()
    .single()
  if (error) throw error
  // Invalidation ciblée : seule la liste de catalogues de CET utilisateur est
  // affectée par la création d'un nouveau catalogue custom.
  catalogsCache.delete(userId)
  return data as Catalog
}

// RDV-PRODUCTS-1 / Lot E — champs commerciaux (prix public/distributeur, PV), jusqu'ici
// uniquement supportés par les catalogues officiels seedés par script. Un seul type d'entrée
// pour la création ET la modification (§10-11 du brief) : mêmes champs, même forme, jamais deux
// définitions qui pourraient diverger. Optionnels explicitement `null` en base quand absents —
// jamais 0, qui serait une vraie valeur métier différente de "non renseigné".
export interface CatalogProductInput {
  name: string
  sku?: string | null
  category?: string | null
  retailPriceEur?: number | null
  wholesalePriceEur?: number | null
  pv?: number | null
}

function invalidateProductsCacheForCatalog(catalogId: string) {
  // Invalidation ciblée : la clé produits est `${userId}:${catalogId}` — on ne connaît pas ici
  // l'utilisateur appelant, donc on retire toute entrée dont le catalogId correspond, quel que
  // soit le userId préfixé (couvre aussi le cas d'un catalogue officiel visible par plusieurs
  // utilisateurs — inchangé depuis la version d'origine de cette fonction).
  const suffix = `:${catalogId}`
  for (const k of productsCache.keys()) if (k.endsWith(suffix)) productsCache.delete(k)
  for (const k of productsInFlight.keys()) if (k.endsWith(suffix)) productsInFlight.delete(k)
}

export async function addProductToCatalog(catalogId: string, input: CatalogProductInput): Promise<CatalogProduct> {
  const { data, error } = await supabase
    .from('catalog_products')
    .insert({
      catalog_id: catalogId,
      name: input.name,
      sku: input.sku ?? null,
      category: input.category ?? null,
      retail_price_eur: input.retailPriceEur ?? null,
      wholesale_price_eur: input.wholesalePriceEur ?? null,
      pv: input.pv ?? null,
    })
    .select()
    .single()
  if (error) throw error
  invalidateProductsCacheForCatalog(catalogId)
  return data as CatalogProduct
}

// RDV-PRODUCTS-1 / Lot E §11 — la RLS "users manage custom products" (FOR ALL, catalogs.user_id
// = auth.uid()) protège déjà totalement les produits des catalogues officiels : un appel sur un
// produit qui n'appartient pas à l'utilisateur échoue côté base (aucune ligne affectée), rien à
// revérifier ici. Remplace l'ensemble des champs éditables (jamais un patch partiel implicite) :
// un champ vidé dans le formulaire doit repasser à null, pas conserver l'ancienne valeur.
export async function updateCatalogProduct(productId: string, input: CatalogProductInput): Promise<CatalogProduct> {
  const { data, error } = await supabase
    .from('catalog_products')
    .update({
      name: input.name,
      sku: input.sku ?? null,
      category: input.category ?? null,
      retail_price_eur: input.retailPriceEur ?? null,
      wholesale_price_eur: input.wholesalePriceEur ?? null,
      pv: input.pv ?? null,
    })
    .eq('id', productId)
    .select()
    .single()
  if (error) throw error
  invalidateProductsCacheForCatalog(data.catalog_id as string)
  return data as CatalogProduct
}
