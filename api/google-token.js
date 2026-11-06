// Fonction serveur Vercel : échange OAuth Google. La clé secrète reste ici, jamais dans l'appli
// (toute variable EXPO_PUBLIC_ est copiée dans le code livré aux utilisateurs).
// Réservée aux utilisateurs connectés : le jeton Supabase est vérifié avant tout appel à Google.

const ALLOWED_ORIGINS = ['https://oryalis.vercel.app', 'http://localhost:8081']

async function isSignedIn(authorization) {
  if (!authorization) return false
  const res = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY },
  })
  return res.ok
}

export default async function handler(req, res) {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  try {
    if (!(await isSignedIn(req.headers.authorization))) return res.status(401).json({ error: 'unauthorized' })

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) return res.status(500).json({ error: 'server_not_configured' })

    const { grant_type: grantType, code, redirect_uri: redirectUri, code_verifier: codeVerifier, refresh_token: refreshToken } = req.body ?? {}
    const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret })
    if (grantType === 'authorization_code' && code && redirectUri) {
      params.set('grant_type', grantType)
      params.set('code', code)
      params.set('redirect_uri', redirectUri)
      if (codeVerifier) params.set('code_verifier', codeVerifier)
    } else if (grantType === 'refresh_token' && refreshToken) {
      params.set('grant_type', grantType)
      params.set('refresh_token', refreshToken)
    } else {
      return res.status(400).json({ error: 'invalid_request' })
    }

    const google = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    const data = await google.json()
    if (!google.ok) {
      console.error('[google-token]', google.status, data.error)
      return res.status(502).json({ error: data.error ?? 'google_error' })
    }
    return res.status(200).json({ access_token: data.access_token, refresh_token: data.refresh_token ?? null, expires_in: data.expires_in ?? null })
  } catch (e) {
    console.error('[google-token]', e)
    return res.status(500).json({ error: 'token_exchange_failed' })
  }
}
