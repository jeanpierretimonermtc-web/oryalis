import { useState, useCallback, useEffect } from 'react'
import { supabase } from '@/shared/lib/supabase'
import {
  fetchAppointments,
  fetchAppointmentById,
  createAppointment,
  updateAppointment,
  completeAppointment,
  cancelAppointment,
  deleteAppointment,
  upsertAppointmentNotes,
  upsertBusinessContext,
  fetchTasksByUser,
  createTask,
  completeTask,
  deleteTask,
} from './appointmentService'
import type {
  Appointment,
  AppointmentFull,
  AppointmentTask,
  AppointmentFilters,
  CreateAppointmentPayload,
  UpdateAppointmentPayload,
  UpdateAppointmentNotesPayload,
  UpdateBusinessContextPayload,
  CreateTaskPayload,
  CompleteAppointmentResult,
} from './appointmentTypes'

export function useAppointments(filters: AppointmentFilters = {}) {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setAppointments(await fetchAppointments(filters))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.client_id, filters.status, filters.appointment_type])

  useEffect(() => { load() }, [load])

  const add = useCallback(async (payload: CreateAppointmentPayload): Promise<Appointment | null> => {
    try {
      const created = await createAppointment(payload)
      setAppointments(prev => [...prev, created].sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()))
      return created
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur création')
      return null
    }
  }, [])

  const update = useCallback(async (id: string, payload: UpdateAppointmentPayload): Promise<boolean> => {
    try {
      const updated = await updateAppointment(id, payload)
      setAppointments(prev => prev.map(a => a.id === id ? updated : a))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour')
      return false
    }
  }, [])

  const cancel = useCallback(async (id: string, reason?: string): Promise<boolean> => {
    try {
      await cancelAppointment(id, reason)
      setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' as const, cancelled_at: new Date().toISOString() } : a))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur annulation')
      return false
    }
  }, [])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteAppointment(id)
      setAppointments(prev => prev.filter(a => a.id !== id))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression')
      return false
    }
  }, [])

  return { appointments, loading, error, reload: load, add, update, cancel, remove }
}

export function useAppointmentDetail(id: string | null) {
  const [appointment, setAppointment] = useState<AppointmentFull | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      setAppointment(await fetchAppointmentById(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const saveNotes = useCallback(async (payload: UpdateAppointmentNotesPayload): Promise<boolean> => {
    if (!id) return false
    try {
      await upsertAppointmentNotes(id, payload)
      setAppointment(prev => {
        if (!prev) return prev
        const base = prev.notes ?? { id: '', appointment_id: id as string, client_notes: null, internal_notes: null, objections: null, needs_identified: null, products_discussed: null, created_at: '', updated_at: '' }
        return { ...prev, notes: { ...base, client_notes: payload.client_notes ?? base.client_notes ?? null, internal_notes: payload.internal_notes ?? base.internal_notes ?? null, objections: payload.objections ?? base.objections ?? null, needs_identified: payload.needs_identified ?? base.needs_identified ?? null, products_discussed: payload.products_discussed ?? base.products_discussed ?? null } }
      })
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur notes')
      return false
    }
  }, [id])

  const saveBusinessContext = useCallback(async (payload: UpdateBusinessContextPayload): Promise<boolean> => {
    if (!id) return false
    try {
      await upsertBusinessContext(id, payload)
      setAppointment(prev => prev ? {
        ...prev,
        business_context: {
          ...(prev.business_context ?? { id: '', appointment_id: id, brand_id: null, catalog_id: null, main_product_id: null, pipeline_stage: 'new_lead' as const, prospect_temperature: null, commercial_intent: null, estimated_value: null, currency: 'EUR', created_at: '', updated_at: '' }),
          ...payload,
        },
      } : prev)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur contexte business')
      return false
    }
  }, [id])

  const addTask = useCallback(async (payload: CreateTaskPayload): Promise<boolean> => {
    if (!id) return false
    try {
      const task = await createTask({ ...payload, appointment_id: id })
      setAppointment(prev => prev ? { ...prev, tasks: [...prev.tasks, task] } : prev)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur tâche')
      return false
    }
  }, [id])

  const doneTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      await completeTask(taskId)
      setAppointment(prev => prev ? { ...prev, tasks: prev.tasks.map(t => t.id === taskId ? { ...t, status: 'done' as const, completed_at: new Date().toISOString() } : t) } : prev)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur complétion tâche')
      return false
    }
  }, [])

  const removeTask = useCallback(async (taskId: string): Promise<boolean> => {
    try {
      await deleteTask(taskId)
      setAppointment(prev => prev ? { ...prev, tasks: prev.tasks.filter(t => t.id !== taskId) } : prev)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur suppression tâche')
      return false
    }
  }, [])

  const update = useCallback(async (payload: UpdateAppointmentPayload): Promise<boolean> => {
    if (!id) return false
    try {
      const updated = await updateAppointment(id, payload)
      setAppointment(prev => prev ? { ...prev, ...updated } : prev)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur mise à jour')
      return false
    }
  }, [id])

  // Seul chemin de complétion : voir appointmentService.completeAppointment().
  const complete = useCallback(async (): Promise<CompleteAppointmentResult | null> => {
    if (!id) return null
    try {
      const result = await completeAppointment(id)
      setAppointment(prev => prev ? { ...prev, ...result.appointment } : prev)
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de complétion')
      return null
    }
  }, [id])

  const cancel = useCallback(async (reason?: string): Promise<boolean> => {
    if (!id) return false
    try {
      await cancelAppointment(id, reason)
      setAppointment(prev => prev ? { ...prev, status: 'cancelled' as const, cancelled_at: new Date().toISOString() } : prev)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur annulation')
      return false
    }
  }, [id])

  return { appointment, loading, error, reload: load, saveNotes, saveBusinessContext, addTask, doneTask, removeTask, update, complete, cancel }
}

export function useAppointmentTasks() {
  const [tasks, setTasks] = useState<AppointmentTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setTasks(await fetchTasksByUser())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const done = useCallback(async (id: string): Promise<boolean> => {
    try {
      await completeTask(id)
      setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'done' as const, completed_at: new Date().toISOString() } : t))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      return false
    }
  }, [])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteTask(id)
      setTasks(prev => prev.filter(t => t.id !== id))
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      return false
    }
  }, [])

  const overdue = tasks.filter(t => t.status === 'pending' && t.due_at && new Date(t.due_at) < new Date())
  const today = tasks.filter(t => {
    if (t.status !== 'pending' || !t.due_at) return false
    const d = new Date(t.due_at), now = new Date()
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  })

  return { tasks, overdue, today, loading, error, reload: load, done, remove }
}

// ── Backward-compat — à retirer après migration des écrans ──────────────────
export function useUpcomingAppointments(limit = 10) {
  const now = new Date()
  const filters: AppointmentFilters = {
    from: now.toISOString(),
    to: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'scheduled',
  }
  const { appointments, loading, reload } = useAppointments(filters)
  return { appointments: appointments.slice(0, limit), loading, refresh: reload }
}

export function useClientAppointments(clientId: string) {
  const { appointments, loading, error, reload } = useAppointments({ client_id: clientId })
  return { appointments, loading, error, refresh: reload }
}

export function useLastRdvMap(userId: string | undefined) {
  const [lastRdvMap, setLastRdvMap] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!userId) return
    // Limite à 1 an pour éviter de charger tout l'historique
    const since = new Date()
    since.setFullYear(since.getFullYear() - 1)
    const { data } = await supabase
      .from('appointments')
      .select('client_id, start_at')
      .eq('user_id', userId)
      .gte('start_at', since.toISOString())
      .order('start_at', { ascending: false })
    if (!data) return
    const map: Record<string, string> = {}
    for (const row of data) {
      if (!map[row.client_id]) map[row.client_id] = row.start_at
    }
    setLastRdvMap(map)
  }, [userId])

  useEffect(() => { load() }, [load])

  return { lastRdvMap, refresh: load }
}
