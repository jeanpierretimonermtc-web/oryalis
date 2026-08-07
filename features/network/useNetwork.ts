import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchNetworkTree, fetchDirectDownline } from './networkService'
import type { NetworkNode } from '@/shared/lib/types'
import type { Client } from '@/shared/lib/types'

type DirectMember = Pick<Client,
  'id' | 'full_name' | 'first_name' | 'email' | 'phone' |
  'status' | 'contact_role' | 'sponsor_id' |
  'next_lrp_date' | 'updated_at' | 'created_at'
>

export function useNetworkTree() {
  const { session } = useAuth()
  const [tree, setTree]     = useState<NetworkNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      setTree(await fetchNetworkTree(session.user.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur réseau')
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { load() }, [load])

  // Flat list of all nodes (for counts, search, etc.)
  function flatten(nodes: NetworkNode[]): NetworkNode[] {
    return nodes.flatMap(n => [n, ...flatten(n.children)])
  }
  const allNodes = flatten(tree)

  const totalSize       = allNodes.length
  const distributors    = allNodes.filter(n => n.contact_role.includes('distributor') || n.contact_role.includes('leader')).length
  const activeThisMonth = allNodes.filter(n => {
    if (!n.updated_at) return false
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    return new Date(n.updated_at) >= cutoff
  }).length

  return { tree, allNodes, totalSize, distributors, activeThisMonth, loading, error, reload: load }
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
