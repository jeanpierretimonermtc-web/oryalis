import { useState, useEffect, useMemo } from 'react'
import { getCatalogs, getCatalogProducts } from './catalogService'
import { useAuth } from '@/features/auth/AuthProvider'
import type { Catalog, CatalogProductListItem } from '@/shared/lib/types'

export function useCatalogs(activeSlugs: string[] | null = null, refreshKey = 0) {
  const { session } = useAuth()
  const [allCatalogs, setAllCatalogs] = useState<Catalog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session) return
    if (allCatalogs.length === 0) setLoading(true)
    getCatalogs(session.user.id)
      .then(setAllCatalogs)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [session, refreshKey])

  const catalogs = useMemo(() => {
    if (!activeSlugs || activeSlugs.length === 0) return allCatalogs
    return allCatalogs.filter(c => c.type === 'custom' || (c.slug && activeSlugs.includes(c.slug)))
  }, [allCatalogs, activeSlugs])

  return { catalogs, loading }
}

// RDV-PRODUCTS-1 / Lot E — refreshKey optionnel, même convention que useCatalogs : permet à
// l'écran Catalogue de forcer un rechargement après addProductToCatalog/updateCatalogProduct
// (dont le cache mémoire est déjà invalidé côté service) sans changer catalogId/session.
export function useCatalogProducts(catalogId: string | null, refreshKey = 0) {
  const { session } = useAuth()
  const [products, setProducts] = useState<CatalogProductListItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!catalogId || !session) { setProducts([]); return }
    setLoading(true)
    getCatalogProducts(session.user.id, catalogId)
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [catalogId, session, refreshKey])

  return { products, loading }
}
