import { useState, useEffect, useCallback } from 'react'
import { fetchLatestCareJourney } from './careJourneyService'
import type { CareJourney, Followup } from '@/shared/lib/types'

export function useCareJourney(clientId: string) {
  const [journey, setJourney] = useState<CareJourney | null>(null)
  const [steps, setSteps] = useState<Followup[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchLatestCareJourney(clientId)
      setJourney(result.journey)
      setSteps(result.steps)
    } catch (e) {
      console.error('[care.fetch]', e)
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { fetch() }, [fetch])
  return { journey, steps, loading, refresh: fetch }
}
