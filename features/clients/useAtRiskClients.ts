import { useCallback, useEffect, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchAtRiskClients } from './riskService'
import type { AtRiskClient } from './riskService'

// AT-RISK-1 — clients qui décrochent, rechargés au retour sur l'écran.
export function useAtRiskClients() {
  const { session } = useAuth()
  const [items, setItems] = useState<AtRiskClient[]>([])

  const load = useCallback(() => {
    if (!session) return
    fetchAtRiskClients(session.user.id).then(setItems).catch(e => console.error('[atRisk]', e))
  }, [session])

  useEffect(() => { load() }, [load])
  useFocusEffect(useCallback(() => { load() }, [load]))

  return { items, reload: load }
}
