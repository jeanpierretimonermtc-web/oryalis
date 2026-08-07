import { useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import type { Client } from '@/shared/lib/types'
import type { Alert } from '@/shared/lib/types'
import { fetchUnreadAlerts, markAlertRead, markAllAlertsRead } from '@/features/alerts/alertService'
import { checkNoContact } from '@/features/automations/automationService'
import { computeRelationshipHealth } from '@/features/clients/relationshipHealth'

export type DailyActionKind =
  | 'overdue_followup'
  | 'today_appointment'
  | 'today_action'
  | 'overdue_task'
  | 'hot_prospect'
  | 'incomplete_appointment'
  | 'at_risk_client'
  | 'renewal'

// Ordre de priorité déterministe (1 = le plus urgent) — utilisé pour le tri de la liste
// condensée "Priorités du jour" ET comme repère de gravité pour le badge affiché.
export const DAILY_PRIORITY: Record<DailyActionKind, number> = {
  overdue_followup: 1,
  today_appointment: 2,
  today_action: 3,
  overdue_task: 4,
  hot_prospect: 5,
  incomplete_appointment: 6,
  at_risk_client: 7,
  renewal: 8,
}

export interface DailyActionItem {
  id: string
  kind: DailyActionKind
  clientId: string | null
  clientName: string
  title: string
  at: string | null
  href: string
  priority: number
  // Raison affichée : clé + paramètres (jamais de texte déjà traduit dans le hook — la
  // traduction reste à la charge du composant, comme pour `dashboard.daily.${kind}`).
  reasonKey: string
  reasonParams?: Record<string, string | number>
}

function localDayBounds(date = new Date()) {
  const start = new Date(date); start.setHours(0, 0, 0, 0)
  const end = new Date(date); end.setHours(23, 59, 59, 999)
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0')
  return { start: start.toISOString(), end: end.toISOString(), date: `${y}-${m}-${d}` }
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000))
}

// Priorités du jour — vue condensée de `items` pour l'en-tête du dashboard, plafonnée et
// triée par urgence. Dédupliquée par RESSOURCE (item.id, déjà scopé "type:id" — ex.
// `followup-<id>`, `appointment-<id>` — une ligne par ressource réelle), jamais par client :
// deux actions distinctes pour la même personne (relance en retard + RDV aujourd'hui)
// doivent toutes les deux apparaître. Seule une vraie même ressource détectée par deux
// règles se fusionne (garde la raison la plus prioritaire).
export function buildTopPriorities(items: DailyActionItem[], limit = 6): DailyActionItem[] {
  const byResource = new Map<string, DailyActionItem>()
  for (const item of items) {
    const existing = byResource.get(item.id)
    if (!existing || item.priority < existing.priority) byResource.set(item.id, item)
  }
  return [...byResource.values()]
    .sort((a, b) => a.priority - b.priority || (a.at ?? '').localeCompare(b.at ?? ''))
    .slice(0, limit)
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
      const nowIso = new Date().toISOString()
      const renewalEnd = new Date(); renewalEnd.setDate(renewalEnd.getDate() + 5)
      const renewalDate = localDayBounds(renewalEnd).date

      const [overdue, appointments, actions, overdueTasks, hotSignals, atRiskCandidates, renewals] = await Promise.all([
        supabase.from('followups').select('id, client_id, title, content, due_date, client:clients(full_name, archived_at)').eq('user_id', uid).eq('done', false).is('cancelled_at', null).lt('due_date', day.date).order('due_date').order('id').limit(20),
        supabase.from('appointments').select('id, client_id, title, start_at, client:clients(full_name, archived_at)').eq('user_id', uid).in('status', ['scheduled', 'rescheduled']).gte('start_at', day.start).lte('start_at', day.end).order('start_at').order('id').limit(20),
        supabase.from('clients').select('id, full_name, next_action_at, next_action_type, next_action_source').eq('user_id', uid).is('archived_at', null).neq('next_action_source', 'appointment').gte('next_action_at', day.start).lte('next_action_at', day.end).order('next_action_at').order('id').limit(20),
        supabase.from('appointment_tasks').select('id, client_id, appointment_id, title, due_at, client:clients(full_name, archived_at)').eq('user_id', uid).not('status', 'in', '(done,cancelled)').lt('due_at', nowIso).order('due_at').order('id').limit(20),
        supabase.from('followups').select('id, prospect_temperature, client:clients(id, full_name, next_action_at, archived_at, pipeline_stage)').eq('user_id', uid).eq('done', false).is('cancelled_at', null).in('prospect_temperature', ['hot', 'very_hot']).order('created_at', { ascending: false }).order('id').limit(50),
        // "Client à risque" exige une interaction réelle connue (last_interaction_at IS NOT
        // NULL) — un contact jamais sollicité n'est pas "à risque", juste pas encore
        // travaillé (voir correctif dédié). Filtré ici en amont, pas seulement dans la
        // boucle, pour ne pas charger inutilement ces lignes. Tri déterministe avant limite :
        // le contact réel le plus ancien d'abord, départagé par id. Volume réel vérifié (28
        // clients pour ce compte) très en-dessous de la limite, mais l'ordre explicite reste
        // nécessaire pour ne jamais dépendre de l'ordre naturel Postgres.
        supabase.from('clients').select('id, full_name, next_action_at, last_interaction_at, manually_inactive, created_at').eq('user_id', uid).is('archived_at', null).not('last_interaction_at', 'is', null).order('last_interaction_at', { ascending: true }).order('id').limit(300),
        supabase.from('clients').select('id, full_name, next_lrp_date').eq('user_id', uid).is('archived_at', null).not('next_lrp_date', 'is', null).gte('next_lrp_date', day.date).lte('next_lrp_date', renewalDate).order('next_lrp_date').order('id').limit(20),
      ])

      const result: DailyActionItem[] = []
      for (const row of overdue.data ?? []) {
        const client = row.client as any
        if (client?.archived_at) continue
        result.push({
          id: `followup-${row.id}`, kind: 'overdue_followup', priority: DAILY_PRIORITY.overdue_followup,
          clientId: row.client_id, clientName: client?.full_name ?? '', title: row.title ?? row.content ?? 'Relance', at: row.due_date,
          href: `/(app)/clients/${row.client_id}/followups`,
          reasonKey: 'overdue_followup', reasonParams: { days: daysBetween(row.due_date, day.date) },
        })
      }
      for (const row of appointments.data ?? []) {
        const client = row.client as any
        if (client?.archived_at) continue
        result.push({
          id: `appointment-${row.id}`, kind: 'today_appointment', priority: DAILY_PRIORITY.today_appointment,
          clientId: row.client_id, clientName: client?.full_name ?? '', title: row.title, at: row.start_at,
          href: `/(app)/appointments/${row.id}?returnTo=${encodeURIComponent('/(app)')}`,
          reasonKey: 'today_appointment',
        })
      }
      for (const row of actions.data ?? []) result.push({
        id: `action-${row.id}`, kind: 'today_action', priority: DAILY_PRIORITY.today_action,
        clientId: row.id, clientName: row.full_name, title: row.next_action_type ?? 'Action', at: row.next_action_at,
        href: `/(app)/clients/${row.id}`,
        reasonKey: 'today_action',
      })
      for (const row of overdueTasks.data ?? []) {
        const client = row.client as any
        if (client?.archived_at) continue
        // CTA le plus précis disponible : le RDV d'origine si la tâche y est liée
        // (appointment_tasks.appointment_id, lien fiable), sinon la fiche contact.
        const href = row.appointment_id
          ? `/(app)/appointments/${row.appointment_id}?returnTo=${encodeURIComponent('/(app)')}`
          : row.client_id ? `/(app)/clients/${row.client_id}` : '/(app)/appointments'
        result.push({
          id: `task-${row.id}`, kind: 'overdue_task', priority: DAILY_PRIORITY.overdue_task,
          clientId: row.client_id, clientName: client?.full_name ?? '', title: row.title, at: row.due_at,
          href,
          reasonKey: 'overdue_task', reasonParams: { days: daysBetween(row.due_at, nowIso) },
        })
      }
      const seenHot = new Set<string>()
      for (const row of hotSignals.data ?? []) {
        const client = row.client as any
        if (!client || client.archived_at || client.next_action_at || seenHot.has(client.id) || !['new_lead', 'contacted', 'presentation_scheduled', 'presentation_completed', 'follow_up'].includes(client.pipeline_stage)) continue
        seenHot.add(client.id)
        result.push({
          id: `hot-${client.id}`, kind: 'hot_prospect', priority: DAILY_PRIORITY.hot_prospect,
          clientId: client.id, clientName: client.full_name, title: row.prospect_temperature, at: null,
          href: `/(app)/clients/${client.id}`,
          reasonKey: 'hot_prospect', reasonParams: { temp: row.prospect_temperature },
        })
      }

      // RDV terminés "incomplets" — Lot 2.1, Solution A (voir rapport) : retiré tant que les
      // relances et prochains RDV n'ont pas de lien fiable (appointment_id) vers leur RDV
      // d'origine — seul appointment_tasks en a un aujourd'hui, ce qui produirait des faux
      // positifs (RDV réellement suivi par une relance manuelle, jamais par une tâche).
      // 'incomplete_appointment' reste dans DailyActionKind/DAILY_PRIORITY/i18n pour une
      // réactivation propre au Lot 3, une fois la traçabilité RDV↔relance en place.

      // Clients à risque : relationshipHealth comme unique source de vérité (jamais
      // réimplémenté ici). "dormant" exclut déjà nativement les clients manuellement
      // inactifs (overridden) et ceux ayant une action/RDV/relance future (next_action_at
      // maintenu par trigger DB). "overdue" n'est retenu que si l'échéance manquée est
      // antérieure à aujourd'hui, pour ne jamais dupliquer la catégorie "today_action".
      for (const row of (atRiskCandidates.data ?? []) as any[]) {
        // Garde en défense en profondeur — la requête filtre déjà last_interaction_at IS NOT
        // NULL, mais un contact jamais sollicité ne doit jamais pouvoir apparaître ici même
        // si la requête changeait plus tard.
        if (row.last_interaction_at == null) continue
        const health = computeRelationshipHealth(row)
        if (health.overridden) continue // volontairement inactif — exclu explicitement
        const isDormant = health.tier === 'dormant'
        const isStaleOverdue = health.tier === 'overdue' && row.next_action_at && row.next_action_at < day.start
        if (!isDormant && !isStaleOverdue) continue
        const reference = isDormant ? row.last_interaction_at : row.next_action_at
        result.push({
          id: `risk-${row.id}`, kind: 'at_risk_client', priority: DAILY_PRIORITY.at_risk_client,
          clientId: row.id, clientName: row.full_name, title: row.full_name, at: reference,
          href: `/(app)/clients/${row.id}`,
          reasonKey: isDormant ? 'at_risk_dormant' : 'at_risk_overdue',
          reasonParams: { days: daysBetween(reference, nowIso) },
        })
      }

      for (const row of renewals.data ?? []) result.push({
        id: `renewal-${row.id}`, kind: 'renewal', priority: DAILY_PRIORITY.renewal,
        clientId: row.id, clientName: row.full_name, title: 'LRP', at: row.next_lrp_date,
        href: `/(app)/clients/${row.id}`,
        reasonKey: 'renewal', reasonParams: { days: daysBetween(day.date, row.next_lrp_date) },
      })
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
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid).contains('contact_role', ['customer']).eq('manually_inactive', false),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid).gte('created_at', firstOfMonth.toISOString()),
        supabase.from('followups').select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('done', false).is('cancelled_at', null),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('user_id', uid).gte('start_at', firstOfMonth.toISOString()),
        supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'completed').gte('start_at', firstOfMonth.toISOString()),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('user_id', uid).contains('contact_role', ['prospect']),
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
        .is('cancelled_at', null)
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

const NO_CONTACT_CHECK_KEY_PREFIX = 'oryalis.lastNoContactCheckAt.'
const NO_CONTACT_CHECK_MIN_INTERVAL_MS = 12 * 60 * 60 * 1000 // 12h — évite de relancer l'automatisation à chaque affichage du dashboard, sans nouvelle table (AsyncStorage, déjà utilisé par ThemeProvider).

async function runNoContactCheckThrottled(userId: string) {
  const key = NO_CONTACT_CHECK_KEY_PREFIX + userId
  try {
    const lastRun = await AsyncStorage.getItem(key)
    if (lastRun && Date.now() - Number(lastRun) < NO_CONTACT_CHECK_MIN_INTERVAL_MS) return
    await checkNoContact(userId)
    await AsyncStorage.setItem(key, String(Date.now()))
  } catch (e) {
    console.error('[runNoContactCheckThrottled]', e)
  }
}

export function useAlerts() {
  const { session } = useAuth()
  const [alerts, setAlerts]   = useState<Alert[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      // Lot 2.1 : computeAndSaveAlerts() retiré du chargement — depuis la suppression du
      // bloc "Opportunités détectées" (Lot 2), plus aucun composant ne lit `alerts`
      // (vérifié : useAlerts() n'est appelé que par ce fichier et app/(app)/index.tsx, qui ne
      // déstructure plus `alerts`). L'alimentation de la table `alerts` reste disponible via
      // alertService.ts pour un futur consommateur (ex. cloche de notifications), mais ne
      // doit plus être calculée à chaque chargement du dashboard sans lecteur réel.
      // checkNoContact reste utile : effet de bord réel (relances "reprendre contact").
      runNoContactCheckThrottled(session.user.id)
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
