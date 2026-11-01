import { useCallback, useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { guessMapping, parseCsv, prepareImport, runImport } from './orderImportService'
import type { ColumnMapping, ImportResult, ParsedCsv, PreparedRow } from './orderImportService'

// ORDER-IMPORT-1 — étapes de l'import : fichier → colonnes → aperçu → import.
export function useOrderImport() {
  const { session } = useAuth()
  const [csv, setCsv] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [rows, setRows] = useState<PreparedRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadText = useCallback((text: string) => {
    const parsed = parseCsv(text)
    setResult(null)
    setRows(null)
    if (parsed.headers.length === 0 || parsed.rows.length === 0) { setCsv(null); return false }
    setCsv(parsed)
    setMapping(guessMapping(parsed.headers))
    return true
  }, [])

  const analyze = useCallback(async (defaultProduct: string) => {
    if (!session || !csv) return
    setBusy(true)
    setError(null)
    try {
      setRows(await prepareImport(session.user.id, csv, mapping, defaultProduct))
    } catch (e) {
      console.error('[orderImport.prepare]', e)
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setBusy(false)
    }
  }, [session, csv, mapping])

  const start = useCallback(async (createMissingContacts: boolean) => {
    if (!session || !rows) return
    setBusy(true)
    setError(null)
    setProgress(0)
    try {
      setResult(await runImport(session.user.id, rows, createMissingContacts, (done, total) => setProgress(total ? Math.round(done / total * 100) : 100)))
      setRows(null)
    } catch (e) {
      console.error('[orderImport.run]', e)
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setBusy(false)
    }
  }, [session, rows])

  const reset = useCallback(() => { setCsv(null); setRows(null); setResult(null); setMapping({}); setError(null) }, [])

  return { csv, mapping, setMapping, rows, setRows, busy, progress, result, error, loadText, analyze, start, reset }
}
