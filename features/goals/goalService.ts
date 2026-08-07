import { supabase } from '@/shared/lib/supabase'
import type { Goal, GoalMetric } from '@/shared/lib/types'

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
    supabase
      .from('orders')
      .select('amount')
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

  const revenue = (revenueRes.data ?? []).reduce((s, r) => s + (r.amount ?? 0), 0)

  return {
    new_clients:      newClientsRes.count ?? 0,
    new_distributors: newDistRes.count ?? 0,
    revenue:          Math.round(revenue),
    appointments:     appointmentsRes.count ?? 0,
    presentations:    presentationsRes.count ?? 0,
    followups:        followupsRes.count ?? 0,
  }
}
