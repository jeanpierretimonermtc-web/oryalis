import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'
import { getStripe } from '../_shared/stripe.ts'

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const authorization = req.headers.get('Authorization') ?? ''
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    })
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: subscription } = await admin
      .from('subscriptions')
      .select('external_customer_id')
      .eq('user_id', user.id)
      .eq('provider', 'stripe')
      .not('external_customer_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!subscription?.external_customer_id) return json({ error: 'No Stripe subscription found' }, 404)

    const stripe = getStripe()
    const appUrl = Deno.env.get('APP_URL') ?? 'https://oryalis.vercel.app'
    const portal = await stripe.billingPortal.sessions.create({
      customer: subscription.external_customer_id,
      return_url: `${appUrl}/settings-subscription`,
    })
    return json({ url: portal.url })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Portal failed' }, 500)
  }
})

