import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import type { Client } from '@/shared/lib/types'
import type { Alert } from '@/shared/lib/types'
import { computeAndSaveAlerts, fetchUnreadAlerts, markAlertRead, markAllAlertsRead } from '@/features/alerts/alertService'
import { checkNoContact } from '@/features/automations/automationService'

export type DailyActionKind = 'overdue_followup' | 'today_appointment' | 'today_action' | 'hot_prospect' | 'renewal'
export interface DailyActionItem {
  id: string
  kind: DailyActionKind
  clientId: string | null
  clientName: string
  title: string
  at: string | null
  href: string
}

function localDayBounds(date = new Date()) {
  const start = new Date(date); start.setHours(0, 0, 0, 0)
  const end = new Date(date); end.setHours(23, 59, 59, 999)
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0')
  return { start: start.toISOString(), end: end.toISOString(), date: `${y}-${m}-${d}` }
}

export function useDailyActions() {
  const { session } = useAuth()
  const [items, setItems] = useState<DailyActionItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const uid = session.user.id
      const day = localDayBounds()
      const renewalEnd = new Date(); renewalEnd.setDate(renewalEnd.getDate() + 5)
      const renewalDate = localDayBounds(renewalEnd).date
      const [overdue, appointments, actions, hotSignals, renewals] = await Promise.all([
        supabase.from('followups').select('id, client_id, title, content, due_date, client:clients(full_name, archived_at)').eq('user_id', uid).eq('done', false).lt('due_date', day.date).order('due_date').limit(20),
        supabase.from('appointments').select('id, client_id, title, start_at, client:clients(full_name, archived_at)').eq('user_id', uid).in('status', ['scheduled', 'rescheduled']).gte('start_at', day.start).lte('start_at', day.end).order('start_at').limit(20),
        supabase.from('clients').select('id, full_name, next_action_at, next_action_type, next_action_source').eq('user_id', uid).is('archived_at', null).neq('next_action_source', 'appointment').gte('next_action_at', day.start).lte('next_action_at', day.end).order('next_action_at').limit(20),
        supabase.from('followups').select('id, prospect_temperature, client:clients(id, full_name, next_action_at, archived_at, pipeline_stage)').eq('user_id', uid).in('prospect_temperature', ['hot', 'very_hot']).order('created_at', { ascending: false }).limit(50),
        supabase.from('clients').select('id, full_name, next_lrp_date').eq('user_id', uid).is('archived_at', null).not('next_lrp_date', 'is', null).gte('next_lrp_date', day.date).lte('next_lrp_date', renewalDate).order('next_lrp_date').limit(20),
      ])

      const result: DailyActionItem[] = []
      for (const row of overdue.data ?? []) {
        const client = row.client as any
        if (client?.archived_at) continue
        result.push({ id: `followup-${row.id}`, kind: 'overdue_followup', clientId: row.client_id, clientName: client?.full_name ?? '', title: row.title ?? row.content ?? 'Relance', at: row.due_date, href: `/(app)/clients/${row.client_id}/followups` })
      }
      for (const row of appointments.data ?? []) {
        const client = row.client as any
        if (client?.archived_at) continue
        result.push({ id: `appointment-${row.id}`, kind: 'today_appointment', clientId: row.client_id, clientName: client?.full_name ?? '', title: row.title, at: row.start_at, href: `/(app)/appointments/${row.id}` })
      }
      for (const row of actions.data ?? []) result.push({ id: `action-${row.id}`, kind: 'today_action', clientId: row.id, clientName: row.full_name, title: row.next_action_type ?? 'Action', at: row.next_action_at, href: `/(app)/clients/${row.id}` })
      const seenHot = new Set<string>()
      for (const row of hotSignals.data ?? []) {
        const client = row.client as any
        if (!client || client.archived_at || client.next_action_at || seenHot.has(client.id) || !['new_lead', 'contacted', 'presentation_scheduled', 'presentation_completed', 'follow_up'].includes(client.pipeline_stage)) continue
        seenHot.add(client.id)
        result.push({ id: `hot-${client.id}`, kind: 'hot_prospect', clientId: client.id, clientName: client.full_name, title: row.prospect_temperature, at: null, href: `/(app)/clients/${client.id}` })
      }
      for (const row of renewals.data ?? []) result.push({ id: `renewal-${row.id}`, kind: 'renewal', clientId: row.id, clientName: row.full_name, title: 'LRP', at: row.next_lrp_date, href: `/(app)/clients/${row.id}` })
      setItems(result)
    } finally { setLoading(false) }
  }, [session])

  useEffect(() => { fetch() }, [fetch])
  return { items, loading, refresh: fetch }
}

interface DashboardStats {
  totalClients: number
  activeClients: number
  newThisMonth: number
  pendingFollowups: number
  appointmentsThisMonth: number
  completedThisMonth: number
  prospects: number
  interactionsToday: number
  networkSize: number
  newRecruits: number
}

export function useDashboardStats() {
  const { session } = useAuth()
  const [stats, setStats] = useState<DashboardStats>({
    totalClients: 0, activeClients: 0, newThisMonth: 0,
    pendingFollowups: 0, appointmentsThisMonth: 0, completedThisMonth: 0,
    prospects: 0, interactionsToday: 0, networkSize: 0, newRecruits: 0,
  })
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const uid = session.user.id
      const firstOfMonth = new Date(); firstOfMonth.setDate(1); firstOfMonth.setHours(0, 0, 0, 0)
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999)

      const [total, active, newMonth, pending, sessions, completedSessions, prospectsRes, todayRes, networkRes, recruitsRes] = await Promise.all([
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'active'),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', firstOfMonth.toISOString()),
        supabase.from('followups').select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('done', false),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('user_id', uid).gte('start_at', firstOfMonth.toISOString()),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'completed').gte('start_at', firstOfMonth.toISOString()),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid).in('status', ['prospect', 'new_client']),
        supabase.from('interactions').select('*', { count: 'exact', head: true }).eq('user_id', uid).is('completed_at', null).gte('scheduled_at', todayStart.toISOString()).lte('scheduled_at', todayEnd.toISOString()),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid).not('sponsor_id', 'is', null),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid).not('sponsor_id', 'is', null).gte('created_at', firstOfMonth.toISOString()),
      ])

      setStats({
        totalClients: total.count ?? 0,
        activeClients: active.count ?? 0,
        newThisMonth: newMonth.count ?? 0,
        pendingFollowups: pending.count ?? 0,
        appointmentsThisMonth: sessions.count ?? 0,
        completedThisMonth: completedSessions.count ?? 0,
        prospects: prospectsRes.count ?? 0,
        interactionsToday: todayRes.count ?? 0,
        networkSize: networkRes.count ?? 0,
        newRecruits: recruitsRes.count ?? 0,
      })
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetch() }, [fetch])
  return { stats, loading, refresh: fetch }
}

export function useMonthlyRevenue() {
  const { session } = useAuth()
  const [amount, setAmount] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const now = new Date()
      const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const to = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
      const { data } = await supabase
        .from('orders')
        .select('amount')
        .eq('user_id', session.user.id)
        .gte('order_date', from)
        .lte('order_date', to)
      const total = (data ?? []).reduce((sum, row) => sum + (row.amount ?? 0), 0)
      setAmount(total)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetch() }, [fetch])
  return { amount, loading, refresh: fetch }
}

export function usePipelineStats() {
  const { session } = useAuth()
  const [byStage, setByStage] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const { data } = await supabase
        .from('clients')
        .select('pipeline_stage')
        .eq('user_id', session.user.id)
        .is('archived_at', null)
      const counts: Record<string, number> = {}
      for (const row of data ?? []) {
        counts[row.pipeline_stage] = (counts[row.pipeline_stage] ?? 0) + 1
      }
      setByStage(counts)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { fetch() }, [fetch])
  return { byStage, loading, refresh: fetch }
}

export function useUpcomingLrp(limit = 5) {
  const { session } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('user_id', session.user.id)
        .not('next_lrp_date', 'is', null)
        .order('next_lrp_date')
        .limit(limit)
      setClients((data ?? []) as Client[])
    } finally {
      setLoading(false)
    }
  }, [session, limit])

  useEffect(() => { fetch() }, [fetch])
  return { clients, loading, refresh: fetch }
}

export function useAlerts() {
  const { session } = useAuth()
  const [alerts, setAlerts]   = useState<Alert[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      // Compute new alerts + no-contact automations (fire-and-forget)
      computeAndSaveAlerts(session.user.id).catch(console.error)
      checkNoContact(session.user.id).catch(console.error)
      setAlerts(await fetchUnreadAlerts(session.user.id))
    } catch (e) {
      console.error('[useAlerts]', e)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { load() }, [load])

  const dismiss = useCallback(async (id: string) => {
    await markAlertRead(id)
    setAlerts(prev => prev.filter(a => a.id !== id))
  }, [])

  const dismissAll = useCallback(async () => {
    if (!session) return
    await markAllAlertsRead(session.user.id)
    setAlerts([])
  }, [session])

  return { alerts, unreadCount: alerts.length, loading, reload: load, dismiss, dismissAll }
}
