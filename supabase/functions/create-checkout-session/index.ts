import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { getStripe } from '../_shared/stripe.ts'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authorization } } },
    )
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return json({ error: 'Unauthorized' }, 401)

    const { interval = 'month' } = await req.json().catch(() => ({}))
    if (!['month', 'year'].includes(interval)) return json({ error: 'Invalid interval' }, 400)
    const priceId = interval === 'year'
      ? Deno.env.get('STRIPE_ADVISOR_YEARLY_PRICE_ID')
      : Deno.env.get('STRIPE_ADVISOR_MONTHLY_PRICE_ID')
    if (!priceId) return json({ error: 'Stripe price is not configured' }, 503)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: current } = await admin
      .from('subscriptions')
      .select('external_customer_id')
      .eq('user_id', user.id)
      .eq('provider', 'stripe')
      .not('external_customer_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const stripe = getStripe()
    const appUrl = Deno.env.get('APP_URL') ?? 'https://oryalis.vercel.app'
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer: current?.external_customer_id ?? undefined,
      customer_email: current?.external_customer_id ? undefined : user.email,
      client_reference_id: user.id,
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      success_url: `${appUrl}/settings-subscription?checkout=success`,
      cancel_url: `${appUrl}/settings-subscription?checkout=cancelled`,
      metadata: { user_id: user.id, plan: 'advisor' },
      subscription_data: { metadata: { user_id: user.id, plan: 'advisor' } },
    })
    return json({ url: session.url })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Checkout failed' }, 500)
  }
})

