import { useCallback, useEffect, useState } from 'react'
import { getOwnerDashboard, type OwnerDashboard } from './adminService'

export function useOwnerDashboard() {
  const [dashboard, setDashboard] = useState<OwnerDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true); setFailed(false)
    try { setDashboard(await getOwnerDashboard()) }
    catch (e) { console.error('[owner.dashboard]', e); setFailed(true) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  return { dashboard, loading, failed, refresh }
}
