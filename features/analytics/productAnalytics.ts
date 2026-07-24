import { supabase } from '@/shared/lib/supabase'
export type ProductEvent = 'offer_viewed' | 'checkout_started' | 'checkout_failed' | 'purchase_restored'
export async function trackProductEvent(userId: string, eventName: ProductEvent, metadata: Record<string, unknown> = {}) {
  const { error } = await supabase.from('product_events').insert({ user_id:userId, event_name:eventName, metadata })
  if (error) console.error('[analytics]', error.message)
}
