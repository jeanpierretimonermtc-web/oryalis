import { useEffect, useMemo, useState } from 'react'
import { fetchFollowupOrigins, type FollowupOrigin, type FollowupOriginInput } from './followupOriginService'

// Rechargé seulement quand la liste de relances change réellement.
export function useFollowupOrigins(followups: FollowupOriginInput[]) {
  const [origins, setOrigins] = useState<Map<string, FollowupOrigin>>(new Map())
  const key = useMemo(() => followups.map(f => f.id).sort().join(','), [followups])

  useEffect(() => {
    if (!key) { setOrigins(new Map()); return }
    let cancelled = false
    fetchFollowupOrigins(followups)
      .then(map => { if (!cancelled) setOrigins(map) })
      .catch(e => console.error('[followupOrigins]', e))
    return () => { cancelled = true }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return origins
}
