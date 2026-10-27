// ORDER-BUSINESS-3.6 §31 — hook UI -> service pour l'écran "Suivi MLM" et sa carte dashboard.
// Centralise l'état de période/catalogue, jamais dupliqué entre les deux consommateurs.
import { useState, useCallback, useEffect, useMemo } from 'react'
import { fetchMlmTracking, getPeriodRange } from './mlmTrackingService'
import type { MlmTrackingMetric, MlmTrackingPeriodPreset, DateRange } from './mlmTrackingService'

export function useMlmTracking(userId: string | undefined) {
  const [preset, setPreset] = useState<MlmTrackingPeriodPreset>('this_month')
  const [customRange, setCustomRange] = useState<DateRange>({ startDate: '', endDate: '' })
  const [catalogId, setCatalogId] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<MlmTrackingMetric[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // §15 — validation start <= end pour une période personnalisée : comparaison lexicographique
  // valide sur des dates ISO yyyy-mm-dd. Tant que la plage personnalisée est incomplète/invalide,
  // reste sur le mois en cours plutôt que d'envoyer une requête avec une plage vide/inversée.
  const range = useMemo((): DateRange => {
    if (preset !== 'custom') return getPeriodRange(preset)
    if (customRange.startDate && customRange.endDate && customRange.startDate <= customRange.endDate) return customRange
    return getPeriodRange('this_month')
  }, [preset, customRange])

  const isCustomRangeInvalid = preset === 'custom' && !!customRange.startDate && !!customRange.endDate && customRange.startDate > customRange.endDate

  const reload = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setMetrics(await fetchMlmTracking(userId, { ...range, catalogId }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setLoading(false)
    }
  }, [userId, range.startDate, range.endDate, catalogId])

  useEffect(() => { reload() }, [reload])

  return { metrics, loading, error, preset, setPreset, range, customRange, setCustomRange, isCustomRangeInvalid, catalogId, setCatalogId, reload }
}

// §27/§29 — carte dashboard : toujours le mois en cours, aucun catalogue filtré (vue synthétique
// globale), aucun état de filtre exposé (l'utilisateur affine depuis la page dédiée, jamais depuis
// le dashboard lui-même, rapport §28).
export function useMlmTrackingSummary(userId: string | undefined) {
  const [metrics, setMetrics] = useState<MlmTrackingMetric[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    setLoading(true)
    try {
      setMetrics(await fetchMlmTracking(userId, { ...getPeriodRange('this_month'), catalogId: null }))
    } catch {
      setMetrics([])
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { reload() }, [reload])

  return { metrics, loading, reload }
}
