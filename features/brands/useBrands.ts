import { useState, useEffect, useCallback, useMemo } from 'react'
import type { Brand, BrandNetworkRole } from '@/shared/lib/types'
import { fetchBrands, fetchClientBrands, fetchAllClientBrandLinks } from './brandService'
import type { ClientBrandLinkLite } from './brandService'
import type { BrandWithCounts, ClientBrandWithBrand } from './brandService'

// Les erreurs de lecture sont absorbées (liste vide) : les marques ne doivent jamais empêcher
// l'affichage d'un écran, y compris avant l'exécution de la migration 20261031_brands.sql.

export function useBrands() {
  const [brands, setBrands] = useState<BrandWithCounts[]>([])
  const [loading, setLoading] = useState(true)
  const fetch = useCallback(async () => {
    setLoading(true)
    try { setBrands(await fetchBrands()) }
    catch (e) { console.error('[brands.fetch]', e) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { fetch() }, [fetch])
  return { brands, loading, refresh: fetch }
}

export function useClientBrands(clientId: string) {
  const [links, setLinks] = useState<ClientBrandWithBrand[]>([])
  const fetch = useCallback(async () => {
    if (!clientId) { setLinks([]); return }
    try { setLinks(await fetchClientBrands(clientId)) }
    catch (e) { console.error('[clientBrands.fetch]', e) }
  }, [clientId])
  useEffect(() => { fetch() }, [fetch])
  return { links, refresh: fetch }
}

export type BrandRoleEntry = { brand: Brand; role: BrandNetworkRole }

// Liste des contacts : marques par contact (pastilles) et compteurs par marque (filtre).
export function useClientBrandMap() {
  const { brands, refresh: refreshBrands } = useBrands()
  const [links, setLinks] = useState<ClientBrandLinkLite[]>([])
  const fetch = useCallback(async () => {
    try { setLinks(await fetchAllClientBrandLinks()) }
    catch (e) { console.error('[clientBrands.links]', e) }
  }, [])
  useEffect(() => { fetch() }, [fetch])

  const byClient = useMemo(() => {
    const brandById = new Map<string, Brand>(brands.map(b => [b.id, b]))
    const map = new Map<string, Brand[]>()
    for (const l of links) {
      const b = brandById.get(l.brand_id)
      if (!b) continue
      map.set(l.client_id, [...(map.get(l.client_id) ?? []), b])
    }
    return map
  }, [brands, links])

  // BRAND-NETWORK-1 — rattachés à un partenaire (client avec parrain) dans chacune de leurs
  // marques : ce sont les clients de l'équipe, pas les miens.
  const linkedClientIds = useMemo(() => new Set(links.map(l => l.client_id)), [links])
  const teamClientIds = useMemo(() => {
    const mine = new Set<string>()
    for (const l of links) if (!l.sponsor_client_id || l.network_role !== 'customer') mine.add(l.client_id)
    return new Set([...linkedClientIds].filter(id => !mine.has(id)))
  }, [links, linkedClientIds])

  // BRAND-ROLES-1 — rôles réseau par marque (partenaire / leader) de chaque contact.
  const brandRolesByClient = useMemo(() => {
    const brandById = new Map<string, Brand>(brands.map(b => [b.id, b]))
    const map = new Map<string, BrandRoleEntry[]>()
    for (const l of links) {
      const b = brandById.get(l.brand_id)
      if (!b) continue
      map.set(l.client_id, [...(map.get(l.client_id) ?? []), { brand: b, role: l.network_role }])
    }
    return map
  }, [brands, links])

  const refresh = useCallback(() => { refreshBrands(); fetch() }, [refreshBrands, fetch])
  return { brands, byClient, linkedClientIds, teamClientIds, brandRolesByClient, refresh }
}
