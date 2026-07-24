import Stripe from 'npm:stripe@18.5.0'

export function getStripe() {
  const key = Deno.env.get('STRIPE_SECRET_KEY')
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return new Stripe(key, { apiVersion: '2025-06-30.basil' })
}

export function mapStripeStatus(status: Stripe.Subscription.Status) {
  switch (status) {
    case 'trialing': return 'trialing'
    case 'active': return 'active'
    case 'past_due': return 'past_due'
    case 'paused': return 'paused'
    case 'canceled': return 'cancelled'
    case 'unpaid': return 'expired'
    case 'incomplete':
    case 'incomplete_expired':
    default: return 'expired'
  }
}

