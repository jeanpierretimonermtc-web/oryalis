import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/shared/lib/supabase'

export function useEntitlements() {
  const [plan, setPlan] = useState('free')
  const [isAdvisor, setIsAdvisor] = useState(false)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_my_entitlements')
      if (error) throw error
      const row = data?.[0]
      setPlan(row?.plan ?? 'free'); setIsAdvisor(Boolean(row?.advisor))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  return { plan, isAdvisor, loading, freeTemplateLimit: isAdvisor ? null : 3, refresh }
}
