import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { getFollowupsByClient, getPendingFollowups, getOverdueFollowupCount } from './followupService'
import type { Followup, FollowupWithClient } from '@/shared/lib/types'

export function useClientFollowups(clientId: string) {
  const [followups, setFollowups] = useState<Followup[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try { setFollowups(await getFollowupsByClient(clientId)) }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { fetch() }, [fetch])
  return { followups, loading, refresh: fetch }
}

export function usePendingFollowups() {
  const { session } = useAuth()
  const [followups, setFollowups] = useState<FollowupWithClient[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const data = await getPendingFollowups(session.user.id)
      setFollowups(data as FollowupWithClient[])
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetch() }, [fetch])
  return { followups, loading, refresh: fetch }
}

// Utilisé par le Dashboard, qui n'affiche aucune ligne de relance — seulement ce nombre.
export function useOverdueFollowupCount() {
  const { session } = useAuth()
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      setCount(await getOverdueFollowupCount(session.user.id))
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetch() }, [fetch])
  return { count, loading, refresh: fetch }
}
