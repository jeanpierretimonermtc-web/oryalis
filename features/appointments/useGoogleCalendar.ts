import { useState, useEffect, useCallback } from 'react'
import { Platform } from 'react-native'
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  saveGcToken, loadGcToken, deleteGcToken, refreshGcAccessToken,
  pushAppointmentToGoogle, pullFromGoogle,
} from './googleCalendarService'
import { fetchAppointments } from './appointmentService'
import type { GcToken } from './googleCalendarService'

// Complete auth session on web/mobile after redirect
WebBrowser.maybeCompleteAuthSession()

// ── OAuth config ──────────────────────────────────────────────────────────────
// Set EXPO_PUBLIC_GOOGLE_CLIENT_ID in your .env file.
// Also set EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS for iOS (if different).
// Create credentials at: https://console.cloud.google.com/apis/credentials

const CLIENT_ID_WEB     = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? ''
const CLIENT_ID_IOS     = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? CLIENT_ID_WEB
const CLIENT_SECRET_WEB = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_SECRET ?? ''

function getClientId() {
  if (Platform.OS === 'ios') return CLIENT_ID_IOS
  return CLIENT_ID_WEB
}

const DISCOVERY = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint:         'https://oauth2.googleapis.com/token',
  revocationEndpoint:    'https://oauth2.googleapis.com/revoke',
}

const SCOPES = ['https://www.googleapis.com/auth/calendar']

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useGoogleCalendar() {
  const { session } = useAuth()
  const userId = session?.user?.id

  const [token, setToken]         = useState<GcToken | null>(null)
  const [loading, setLoading]     = useState(true)
  const [syncing, setSyncing]     = useState(false)
  const [syncResult, setSyncResult] = useState<{ pushed: number; pulled: number } | null>(null)
  const [error, setError]         = useState<string | null>(null)

  const isConfigured = Boolean(getClientId())
  const isConnected  = Boolean(token?.access_token)

  // ── Load stored token ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return
    setLoading(true)
    loadGcToken(userId)
      .then(t => setToken(t))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [userId])

  // ── OAuth request ──────────────────────────────────────────────────────────
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: 'oryalis',
    path:   'oauth/google',
  })

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId:    getClientId(),
      scopes:      SCOPES,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      extraParams: { access_type: 'offline', prompt: 'consent' },
    },
    DISCOVERY
  )

  // Handle OAuth response
  useEffect(() => {
    if (!response || !userId) return
    if (response.type === 'success') {
      const { code } = response.params
      exchangeCode(code)
    } else if (response.type === 'error') {
      setError(response.error?.message ?? 'OAuth error')
    }
  }, [response, userId])

  async function exchangeCode(code: string) {
    if (!userId) return
    try {
      const params = new URLSearchParams({
        code,
        client_id:     getClientId(),
        client_secret: CLIENT_SECRET_WEB,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
        code_verifier: request?.codeVerifier ?? '',
      })
      const res = await fetch(DISCOVERY.tokenEndpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    params.toString(),
      })
      if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
      const data = await res.json()
      const gcToken: GcToken = {
        access_token:  data.access_token,
        refresh_token: data.refresh_token ?? null,
        expires_at:    data.expires_in
          ? new Date(Date.now() + data.expires_in * 1000).toISOString()
          : null,
      }
      await saveGcToken(userId, gcToken)
      setToken(gcToken)
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      console.error('[exchangeCode]', msg)
      setError(msg)
    }
  }

  // ── Connect / Disconnect ───────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!isConfigured) {
      setError('EXPO_PUBLIC_GOOGLE_CLIENT_ID non configuré.')
      return
    }
    if (!request) return
    setError(null)
    await promptAsync()
  }, [promptAsync, isConfigured, request])

  const disconnect = useCallback(async () => {
    if (!userId) return
    await deleteGcToken(userId)
    setToken(null)
    setSyncResult(null)
  }, [userId])

  // ── Token refresh ──────────────────────────────────────────────────────────
  // Google access tokens expire after ~1h; refresh via refresh_token before each sync.
  const ensureFreshToken = useCallback(async (): Promise<string | null> => {
    if (!userId || !token) return null
    const isExpired = !token.expires_at || new Date(token.expires_at).getTime() - 60_000 < Date.now()
    if (!isExpired) return token.access_token

    if (!token.refresh_token) {
      setError('Session Google expirée — reconnectez Google Agenda')
      return null
    }
    try {
      const refreshed = await refreshGcAccessToken(token.refresh_token, getClientId(), CLIENT_SECRET_WEB)
      const newToken: GcToken = { access_token: refreshed.access_token, refresh_token: token.refresh_token, expires_at: refreshed.expires_at }
      await saveGcToken(userId, newToken)
      setToken(newToken)
      return newToken.access_token
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      console.error('[ensureFreshToken]', msg)
      setError('Session Google expirée — reconnectez Google Agenda')
      return null
    }
  }, [userId, token])

  // ── Sync ───────────────────────────────────────────────────────────────────
  const syncAll = useCallback(async () => {
    if (!userId || !token?.access_token) return
    setSyncing(true)
    setError(null)
    try {
      const accessToken = await ensureFreshToken()
      if (!accessToken) return

      // Push Oryalis → Google (next 30 days + past 7 days)
      const from = new Date(Date.now() - 7 * 86400000).toISOString()
      const to   = new Date(Date.now() + 30 * 86400000).toISOString()
      const appointments = await fetchAppointments({ from, to })
      let pushed = 0
      for (const appt of appointments) {
        if (!appt.client_id) continue
        try {
          await pushAppointmentToGoogle(userId, appt, accessToken)
          pushed++
        } catch (e: any) {
          if (e.message === 'gc_token_expired') { setError('Token expiré — reconnectez Google Agenda'); break }
          console.error('[syncAll.push]', appt.id, e)
        }
      }

      // Pull Google → Oryalis
      const { created: pulled } = await pullFromGoogle(userId, accessToken)

      setSyncResult({ pushed, pulled })
      setTimeout(() => setSyncResult(null), 8000)
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      console.error('[syncAll]', msg)
      setError(msg)
    } finally {
      setSyncing(false)
    }
  }, [userId, token, ensureFreshToken])

  return {
    isConfigured,
    isConnected,
    loading,
    syncing,
    syncResult,
    error,
    connect,
    disconnect,
    syncAll,
  }
}
