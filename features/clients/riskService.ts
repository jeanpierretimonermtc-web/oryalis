import { supabase } from '@/shared/lib/supabase'

// AT-RISK-1 — clients qui décrochent, calculés à partir des données existantes (aucun score
// stocké) : pas de recommande, abonnement arrêté récemment, plus de nouvelles.
export const RISK_ORDER_GAP_DAYS = 60
export const RISK_NO_CONTACT_DAYS = 45
export const RISK_PROGRAM_STOP_DAYS = 60

export type RiskReason =
  | { kind: 'no_reorder'; days: number }
  | { kind: 'program_stopped'; status: 'paused' | 'cancelled'; days: number }
  | { kind: 'no_contact'; days: number }

export interface AtRiskClient {
  id: string
  full_name: string
  first_name: string | null
  reasons: RiskReason[]
}

function daysSince(iso: string, now: number): number {
  return Math.floor((now - new Date(iso).getTime()) / 86400000)
}

// DASH-RISK-1 — "Me le rappeler" : une relance normale à la date choisie (le contact a alors une
// action future et sort des clients à risque jusqu'à cette date).
export async function snoozeClientRisk(userId: string, clientId: string, dueDate: string, title: string): Promise<void> {
  const { error } = await supabase.from('followups')
    .insert({ user_id: userId, client_id: clientId, title, due_date: dueDate, done: false })
  if (error) throw error
}

// "Ne plus signaler" : le contact sort des priorités (il reste dans le filtre Dormants).
export async function dismissClientRisk(clientId: string): Promise<void> {
  const { error } = await supabase.from('clients').update({ risk_dismissed_at: new Date().toISOString() }).eq('id', clientId)
  if (error) throw error
}

export async function fetchAtRiskClients(userId: string): Promise<AtRiskClient[]> {
  const [clientsRes, ordersRes, programsRes] = await Promise.all([
    supabase.from('clients')
      .select('id, full_name, first_name, contact_role, last_interaction_at, manually_inactive')
      .eq('user_id', userId)
      .is('archived_at', null),
    supabase.from('orders')
      .select('client_id, order_date')
      .eq('user_id', userId)
      .is('cancelled_at', null)
      .neq('status', 'cancelled'),
    supabase.from('recurring_programs')
      .select('client_id, status, updated_at')
      .eq('user_id', userId),
  ])
  if (clientsRes.error) throw clientsRes.error
  if (ordersRes.error) throw ordersRes.error
  if (programsRes.error) throw programsRes.error

  const now = Date.now()
  const lastOrder = new Map<string, string>()
  for (const o of ordersRes.data ?? []) {
    if (!o.client_id || !o.order_date) continue
    const prev = lastOrder.get(o.client_id)
    if (!prev || o.order_date > prev) lastOrder.set(o.client_id, o.order_date)
  }
  const activeProgram = new Set<string>()
  const stoppedProgram = new Map<string, { status: 'paused' | 'cancelled'; at: string }>()
  for (const p of programsRes.data ?? []) {
    if (p.status === 'active') activeProgram.add(p.client_id)
    else if (p.status === 'paused' || p.status === 'cancelled') {
      const prev = stoppedProgram.get(p.client_id)
      if (!prev || p.updated_at > prev.at) stoppedProgram.set(p.client_id, { status: p.status, at: p.updated_at })
    }
  }

  const result: AtRiskClient[] = []
  for (const c of clientsRes.data ?? []) {
    // Seuls les clients (rôle client ou déjà acheteurs) ; jamais un contact marqué inactif.
    const isCustomer = (c.contact_role ?? []).includes('customer') || lastOrder.has(c.id)
    if (!isCustomer || c.manually_inactive || (c.contact_role ?? []).includes('inactive')) continue
    const reasons: RiskReason[] = []
    const last = lastOrder.get(c.id)
    if (last && !activeProgram.has(c.id)) {
      const days = daysSince(last, now)
      if (days >= RISK_ORDER_GAP_DAYS) reasons.push({ kind: 'no_reorder', days })
    }
    const stopped = stoppedProgram.get(c.id)
    if (stopped && !activeProgram.has(c.id)) {
      const days = daysSince(stopped.at, now)
      if (days <= RISK_PROGRAM_STOP_DAYS) reasons.push({ kind: 'program_stopped', status: stopped.status, days })
    }
    if (c.last_interaction_at) {
      const days = daysSince(c.last_interaction_at, now)
      if (days >= RISK_NO_CONTACT_DAYS) reasons.push({ kind: 'no_contact', days })
    }
    // Un seul signal "plus de nouvelles" ne suffit pas : il faut un signal d'achat.
    if (reasons.some(r => r.kind !== 'no_contact')) {
      result.push({ id: c.id, full_name: c.full_name, first_name: c.first_name, reasons })
    }
  }
  // Les plus fragiles d'abord : plus de signaux, puis le plus long silence d'achat.
  return result.sort((a, b) =>
    b.reasons.length - a.reasons.length
    || Math.max(...b.reasons.map(r => r.days)) - Math.max(...a.reasons.map(r => r.days)))
}
