import { supabase } from '@/shared/lib/supabase'

export interface SubscriptionSnapshot {
  plan: string
  provider: 'stripe' | 'app_store' | 'play_store' | 'manual'
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export async function getMySubscription(): Promise<SubscriptionSnapshot | null> {
  const { data, error } = await supabase.rpc('get_my_subscription')
  if (error) throw error
  const row = data?.[0]
  if (!row) return null
  return {
    plan: row.plan,
    provider: row.provider,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  }
}

export async function createWebCheckout(interval: 'month' | 'year'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { interval } })
  if (error) throw error
  if (!data?.url) throw new Error(data?.error ?? 'Checkout URL missing')
  return data.url
}

export async function createBillingPortal(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('create-billing-portal')
  if (error) throw error
  if (!data?.url) throw new Error(data?.error ?? 'Portal URL missing')
  return data.url
}

