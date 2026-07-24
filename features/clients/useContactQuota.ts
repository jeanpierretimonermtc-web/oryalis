import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { getContactQuota, type ContactQuota } from './quotaService'

export function useContactQuota() {
  const { session } = useAuth()
  const [quota, setQuota] = useState<ContactQuota | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      setQuota(await getContactQuota(session.user.id))
    } catch (error) {
      console.error('[contactQuota]', error)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { refresh() }, [refresh])
  return { quota, loading, refresh }
}

