import { createClient } from 'npm:@supabase/supabase-js@2'
import type Stripe from 'npm:stripe@18.5.0'
import { json } from '../_shared/http.ts'
import { getStripe, mapStripeStatus } from '../_shared/stripe.ts'

async function saveSubscription(subscription: Stripe.Subscription) {
  const userId = subscription.metadata.user_id
  if (!userId) throw new Error(`Missing user_id metadata on ${subscription.id}`)
  const item = subscription.items.data[0]
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await admin.from('subscriptions').upsert({
    user_id: userId,
    provider: 'stripe',
    status: mapStripeStatus(subscription.status),
    plan: subscription.metadata.plan ?? 'advisor',
    external_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    external_subscription_id: subscription.id,
    product_id: typeof item?.price.product === 'string' ? item.price.product : item?.price.product?.id,
    price_id: item?.price.id,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    cancel_at_period_end: subscription.cancel_at_period_end,
    cancelled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
    metadata: subscription.metadata,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'provider,external_subscription_id' })
  if (error) throw error
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const signature = req.headers.get('stripe-signature')
    const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
    if (!signature || !secret) return json({ error: 'Webhook signature is not configured' }, 400)
    const rawBody = await req.text()
    const event = await getStripe().webhooks.constructEventAsync(rawBody, signature, secret)

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      if (typeof session.subscription === 'string') {
        await saveSubscription(await getStripe().subscriptions.retrieve(session.subscription))
      }
    } else if (event.type.startsWith('customer.subscription.')) {
      await saveSubscription(event.data.object as Stripe.Subscription)
    }
    return json({ received: true })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Webhook failed' }, 400)
  }
})

