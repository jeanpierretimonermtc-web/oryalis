import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchMyLeadForms, fetchLeadSubmissions, saveLeadForm, createContactFromSubmission, deleteLeadSubmission } from './leadService'
import type { LeadForm, LeadSubmission } from './leadService'

// LEAD-PAGE-1/2 — mes pages prospect (générale + une par marque) et les derniers envois reçus.
export function useLeadForm() {
  const { session } = useAuth()
  const userId = session?.user.id
  const [forms, setForms] = useState<LeadForm[]>([])
  const [submissions, setSubmissions] = useState<LeadSubmission[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [f, s] = await Promise.all([fetchMyLeadForms(userId), fetchLeadSubmissions(userId)])
      setForms(f)
      setSubmissions(s)
    } catch (e) {
      console.error('[leadForm.load]', e)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (existingId: string | null, input: Pick<LeadForm, 'brand_id' | 'slug' | 'title' | 'intro' | 'active'>) => {
    if (!userId) return
    const saved = await saveLeadForm(userId, existingId, input)
    setForms(prev => [...prev.filter(f => f.id !== saved.id), saved])
  }, [userId])

  const createContact = useCallback(async (submission: LeadSubmission) => {
    if (!userId) return
    await createContactFromSubmission(userId, submission)
    await load()
  }, [userId, load])

  const remove = useCallback(async (id: string) => {
    await deleteLeadSubmission(id)
    setSubmissions(prev => prev.filter(s => s.id !== id))
  }, [])

  return { forms, submissions, loading, save, createContact, remove, reload: load }
}
