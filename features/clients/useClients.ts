import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { getClients, searchClients } from './clientService'
import type { ClientListItem, ClientStatus } from '@/shared/lib/types'

export function useClients(statusFilter?: ClientStatus) {
  const { session } = useAuth()
  const [clients, setClients] = useState<ClientListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const data = await getClients(session.user.id)
      setClients(statusFilter ? data.filter(c => c.status === statusFilter) : data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setLoading(false)
    }
  }, [session, statusFilter])

  useEffect(() => { fetch() }, [fetch])

  return { clients, loading, error, refresh: fetch }
}

export function useClientSearch() {
  const { session } = useAuth()
  const [results, setResults] = useState<ClientListItem[]>([])
  const [loading, setLoading] = useState(false)

  const search = useCallback(async (query: string, status?: ClientStatus) => {
    if (!session) return
    setLoading(true)
    try {
      const data = await searchClients(session.user.id, query, status)
      setResults(data)
    } finally {
      setLoading(false)
    }
  }, [session])

  return { results, loading, search }
}
