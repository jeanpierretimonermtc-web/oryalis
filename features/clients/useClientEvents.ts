import { useState, useEffect, useCallback } from 'react'
import { getClientEvents } from './clientEventService'
import type { ClientEvent } from './clientEventService'

export function useClientEvents(clientId: string) {
  const [events, setEvents] = useState<ClientEvent[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try { setEvents(await getClientEvents(clientId)) }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { fetch() }, [fetch])
  return { events, loading, refresh: fetch }
}
