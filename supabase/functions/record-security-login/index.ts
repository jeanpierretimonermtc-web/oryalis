import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, json } from '../_shared/http.ts'

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const authorization = req.headers.get('Authorization') ?? ''
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authorization } },
    })
    const { data: { user }, error: userError } = await client.auth.getUser()
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)

    const { installationId, platform } = await req.json().catch(() => ({}))
    if (typeof installationId !== 'string' || installationId.length < 16) {
      return json({ error: 'Invalid installation' }, 400)
    }
    const forwarded = req.headers.get('cf-connecting-ip')
      ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? 'unknown'
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await admin.rpc('record_security_login_event', {
      p_user_id: user.id,
      p_installation_hash: await sha256(installationId),
      p_ip_hash: await sha256(forwarded),
      p_platform: typeof platform === 'string' ? platform : 'unknown',
      p_user_agent: req.headers.get('user-agent') ?? 'unknown',
    })
    if (error) throw error
    return json({ unusual: Boolean(data) })
  } catch (error) {
    console.error(error)
    return json({ error: error instanceof Error ? error.message : 'Login tracking failed' }, 500)
  }
})
