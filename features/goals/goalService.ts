import { supabase } from '@/shared/lib/supabase'
import type { Goal, GoalMetric } from '@/shared/lib/types'
import { isOrderNetRevenue } from '@/features/orders/orderService'
import { fetchOrderItemsForOrders, computeOrderNetAmount } from '@/features/orders/orderItemService'

export function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export async function fetchGoals(userId: string, period?: string): Promise<Goal[]> {
  const p = period ?? currentPeriod()
  const { data, error } = await supabase
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .eq('period', p)
    .order('metric')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function upsertGoal(
  userId: string,
  metric: GoalMetric,
  target: number,
  period?: string,
): Promise<Goal> {
  const p = period ?? currentPeriod()
  const { data, error } = await supabase
    .from('goals')
    .upsert(
      { user_id: userId, period: p, metric, target, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,period,metric' },
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Goal
}

export async function deleteGoal(id: string): Promise<void> {
  const { error } = await supabase.from('goals').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Compute the current value for each metric from Supabase
export async function computeCurrentValues(
  userId: string,
  period: string,
): Promise<Record<GoalMetric, number>> {
  const [y, m] = period.split('-').map(Number)
  const from = new Date(y, m - 1, 1).toISOString()
  const to   = new Date(y, m, 0, 23, 59, 59).toISOString()

  const [newClientsRes, newDistRes, revenueRes, appointmentsRes, presentationsRes, followupsRes] = await Promise.all([
    supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', from)
      .lte('created_at', to),
    supabase
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .overlaps('contact_role', ['distributor', 'leader'])
      .gte('created_at', from)
      .lte('created_at', to),
    // LRP-4.6 §6 — trouvé lors de l'audit du calcul de CA net (une commande retournée gonflait
    // aussi cet objectif "revenue") : même définition d'ÉLIGIBILITÉ qu'ailleurs (isOrderNetRevenue),
    // status ajouté à la sélection pour pouvoir l'appliquer. ORDER-BUSINESS-4.2 §13/§21 — `id`
    // ajouté pour permettre la jointure applicative vers order_items (montant NET des retours
    // partiels, voir plus bas).
    supabase
      .from('orders')
      .select('id, amount, status, order_type, cancelled_at')
      .eq('user_id', userId)
      .neq('order_type', 'personal')
      .is('cancelled_at', null)
      .gte('order_date', from.split('T')[0])
      .lte('order_date', to.split('T')[0]),
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .gte('start_at', from)
      .lte('start_at', to),
    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .eq('appointment_type', 'product_presentation')
      .gte('start_at', from)
      .lte('start_at', to),
    supabase
      .from('followups')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('done', true)
      .gte('due_date', from.split('T')[0])
      .lte('due_date', to.split('T')[0]),
  ])

  // ORDER-BUSINESS-4.2 §13/§21/§35 — montant NET des retours partiels, lecture groupée des
  // order_items (jamais un fetch par commande).
  const eligibleOrders = (revenueRes.data ?? []).filter(isOrderNetRevenue)
  const itemsByOrder = await fetchOrderItemsForOrders(eligibleOrders.map(o => o.id))
  const revenue = eligibleOrders.reduce((s, r) => s + computeOrderNetAmount(r, itemsByOrder.get(r.id)), 0)

  return {
    new_clients:      newClientsRes.count ?? 0,
    new_distributors: newDistRes.count ?? 0,
    revenue:          Math.round(revenue),
    appointments:     appointmentsRes.count ?? 0,
    presentations:    presentationsRes.count ?? 0,
    followups:        followupsRes.count ?? 0,
  }
}
