import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchBrandNetworks, fetchDirectDownline, fetchSponsorGraph } from './networkService'
import type { BrandNetwork, SponsorGraphNode } from './networkService'
import type { Client } from '@/shared/lib/types'

type DirectMember = Pick<Client,
  'id' | 'full_name' | 'first_name' | 'email' | 'phone' |
  'contact_role' | 'sponsor_id' | 'updated_at' | 'created_at'
>

// BRAND-NETWORK-1 — un arbre par marque (+ "sans marque"), rechargé en silence au retour.
export function useNetworkTree() {
  const { session } = useAuth()
  const [networks, setNetworks] = useState<BrandNetwork[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const loadedOnce = useRef(false)
  const load = useCallback(async () => {
    if (!session) return
    if (!loadedOnce.current) setLoading(true)
    setError(null)
    try {
      setNetworks(await fetchBrandNetworks(session.user.id))
      loadedOnce.current = true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { load() }, [load])

  return { networks, loading, error, reload: load }
}

export function useSponsorGraph(enabled = true) {
  const { session } = useAuth()
  const [graph, setGraph] = useState<SponsorGraphNode[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!session || !enabled) return
    setLoading(true)
    try {
      setGraph(await fetchSponsorGraph(session.user.id))
    } catch (e) {
      console.error('[useSponsorGraph]', e)
    } finally {
      setLoading(false)
    }
  }, [session, enabled])

  useEffect(() => { load() }, [load])

  return { graph, loading, reload: load }
}

export function useDirectTeam(clientId: string | null) {
  const [team, setTeam]     = useState<DirectMember[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    setError(null)
    try {
      setTeam(await fetchDirectDownline(clientId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur équipe')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  return { team, loading, error, reload: load }
}
