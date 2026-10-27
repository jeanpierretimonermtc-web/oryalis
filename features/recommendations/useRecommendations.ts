import { useState, useEffect, useCallback } from 'react'
import { getRecommendationsByClient } from './recommendationService'
import type { Recommendation } from '@/shared/lib/types'

export function useRecommendations(clientId: string) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    // clientId peut être vide (ex. RDV sans contact rattaché : appointment?.client_id ?? '')
    // — un client_id vide envoyé à PostgREST échoue en 400 ("invalid input syntax for type
    // uuid"), donc on n'interroge pas du tout dans ce cas plutôt que de laisser partir une
    // requête invalide.
    if (!clientId) { setRecommendations([]); setLoading(false); return }
    setLoading(true)
    try { setRecommendations(await getRecommendationsByClient(clientId)) }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { fetch() }, [fetch])
  return { recommendations, loading, refresh: fetch }
}
