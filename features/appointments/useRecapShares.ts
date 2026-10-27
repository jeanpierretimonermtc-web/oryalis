import { useState, useEffect, useCallback } from 'react'
import { getRecapSharesByClient } from './recapShareService'
import type { AppointmentRecapShare } from './appointmentTypes'

// RÉCAP-5D — même convention que useClientEvents (features/clients/useClientEvents.ts) : la
// timeline contact doit pouvoir rafraîchir cette liste au même titre que les autres ressources,
// via le useFocusEffect déjà en place sur la fiche contact.
export function useClientRecapShares(clientId: string) {
  const [shares, setShares] = useState<AppointmentRecapShare[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    try { setShares(await getRecapSharesByClient(clientId)) }
    finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { fetch() }, [fetch])
  return { shares, loading, refresh: fetch }
}
