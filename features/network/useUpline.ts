import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  fetchUplineNodes,
  createUplineNode,
  updateUplineNode,
  deleteUplineNode,
} from './uplineService'
import type { UplineNode } from '@/shared/lib/types'

export function useUpline() {
  const { session } = useAuth()
  const [nodes, setNodes] = useState<UplineNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session?.user?.id) return
    setLoading(true)
    setError(null)
    try {
      setNodes(await fetchUplineNodes(session.user.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur')
    } finally {
      setLoading(false)
    }
  }, [session?.user?.id])

  useEffect(() => { load() }, [load])

  // BRAND-NETWORK-1 — position comptée dans la ligne de la marque (le nouveau est le plus haut).
  const add = useCallback(async (name: string, memberId: string | null, brandId: string | null = null) => {
    if (!session?.user?.id) return
    const position = nodes.filter(n => n.brand_id === brandId).length
    const node = await createUplineNode(session.user.id, name, memberId, position, brandId)
    setNodes(prev => [node, ...prev])
  }, [session?.user?.id, nodes])

  const update = useCallback(async (id: string, name: string, memberId: string | null, brandId: string | null) => {
    await updateUplineNode(id, name, memberId, brandId)
    setNodes(prev => prev.map(n => n.id === id ? { ...n, name, member_id: memberId, brand_id: brandId } : n))
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteUplineNode(id)
    setNodes(prev => prev.filter(n => n.id !== id))
  }, [])

  return { nodes, loading, error, reload: load, add, update, remove }
}
