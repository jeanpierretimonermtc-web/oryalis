import { useState, useEffect } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'

export function useProfilePlan() {
  const { session } = useAuth()
  const [plan, setPlan] = useState('free')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!session?.user.id) { setLoading(false); return }
    let active = true
    ;(async () => {
      try {
        const { data } = await supabase.from('profiles').select('plan').eq('id', session.user.id).single()
        if (active) setPlan(data?.plan ?? 'free')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [session?.user.id])

  return { plan, loading }
}
