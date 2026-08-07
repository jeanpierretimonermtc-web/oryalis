import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  fetchStatusLabels, upsertStatusLabel,
  applyPreset, resetStatusLabels,
} from './statusLabelsService'
import type { LabelKey, ActivityType } from '@/shared/lib/types'
import { DEFAULT_ROLE_LABELS, DEFAULT_STATUS_LABELS } from '@/shared/lib/types'

const DEFAULTS: Record<string, string> = { ...DEFAULT_STATUS_LABELS, ...DEFAULT_ROLE_LABELS }

export function useStatusLabels() {
  const { session } = useAuth()
  const [labels, setLabels]   = useState<Partial<Record<LabelKey, string>>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      setLabels(await fetchStatusLabels(session.user.id))
    } catch (e) {
      console.error('[useStatusLabels]', e)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { load() }, [load])

  // Retourne le libellé personnalisé ou le défaut
  const getLabel = useCallback((key: LabelKey): string => {
    return labels[key] ?? DEFAULTS[key] ?? key
  }, [labels])

  const saveLabel = useCallback(async (key: LabelKey, value: string) => {
    if (!session) return
    try {
      await upsertStatusLabel(session.user.id, key, value)
      setLabels(prev => ({ ...prev, [key]: value }))
    } catch (e) {
      console.error('[useStatusLabels.saveLabel]', e)
    }
  }, [session])

  const applyActivityPreset = useCallback(async (activityType: ActivityType) => {
    if (!session) return
    try {
      await applyPreset(session.user.id, activityType)
      await load()
    } catch (e) {
      console.error('[useStatusLabels.applyPreset]', e)
    }
  }, [session, load])

  const reset = useCallback(async () => {
    if (!session) return
    try {
      await resetStatusLabels(session.user.id)
      setLabels({})
    } catch (e) {
      console.error('[useStatusLabels.reset]', e)
    }
  }, [session])

  return { labels, loading, getLabel, saveLabel, applyActivityPreset, reset, reload: load }
}
