import { createClient } from 'npm:@supabase/supabase-js@2'
import { json } from '../_shared/http.ts'

const ACTIVE_EVENTS = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'TEMPORARY_ENTITLEMENT_GRANT'])
const EXPIRED_EVENTS = new Set(['EXPIRATION', 'BILLING_ISSUE'])

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const expected = Deno.env.get('REVENUECAT_WEBHOOK_AUTH')
  if (!expected || req.headers.get('Authorization') !== expected) return json({ error: 'Unauthorized' }, 401)
  try {
    const payload = await req.json()
    const event = payload.event
    const userId = event?.app_user_id
    if (!userId) return json({ error: 'Missing app_user_id' }, 400)
    const provider = event.store === 'APP_STORE' ? 'app_store' : 'play_store'
    const status = ACTIVE_EVENTS.has(event.type) ? 'active' : EXPIRED_EVENTS.has(event.type) ? 'expired' : event.type === 'CANCELLATION' ? 'active' : 'active'
    const externalId = event.original_transaction_id ?? event.transaction_id
    if (!externalId) return json({ error: 'Missing transaction id' }, 400)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error } = await admin.from('subscriptions').upsert({
      user_id: userId,
      provider,
      status,
      plan: 'advisor',
      external_customer_id: userId,
      external_subscription_id: externalId,
      product_id: event.product_id,
      current_period_start: event.purchased_at_ms ? new Date(event.purchased_at_ms).toISOString() : null,
      current_period_end: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
      cancel_at_period_end: event.type === 'CANCELLATION',
      cancelled_at: event.type === 'CANCELLATION' ? new Date().toISOString() : null,
      metadata: { event_id: event.id, entitlement_ids: event.entitlement_ids ?? [] },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,external_subscription_id' })
    if (error) throw error
    return json({ received: true })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Webhook failed' }, 400)
  }
})
