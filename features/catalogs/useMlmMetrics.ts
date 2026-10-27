// ORDER-BUSINESS-3.5 §36 — hook dédié uniquement parce qu'il simplifie réellement l'écran "Mes
// valeurs MLM" : centralise le chargement + la séparation officielle/personnelle, seule logique
// répétée à travers la page et ses modales. UI -> hook -> service (mlmMetricService.ts) ->
// Supabase, aucune couche supplémentaire.
import { useState, useCallback, useEffect } from 'react'
import { fetchMlmMetricsOverview } from './mlmMetricService'
import type { MlmMetricDefinitionOverview } from './mlmMetricService'

export function useMlmMetrics(userId: string | undefined) {
  const [metrics, setMetrics] = useState<MlmMetricDefinitionOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!userId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      setMetrics(await fetchMlmMetricsOverview(userId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { reload() }, [reload])

  return {
    officialMetrics: metrics.filter(m => m.origin === 'official'),
    personalMetrics: metrics.filter(m => m.origin === 'personal'),
    loading,
    error,
    reload,
  }
}
