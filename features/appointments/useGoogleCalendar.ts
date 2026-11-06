import { useState, useEffect, useCallback } from 'react'
import { Platform } from 'react-native'
import * as AuthSession from 'expo-auth-session'
import * as WebBrowser from 'expo-web-browser'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  saveGcToken, loadGcToken, deleteGcToken, exchangeGcCode, refreshGcAccessToken,
  pushAppointmentToGoogle, pullFromGoogle,
  refreshGcCalendars, setGcCalendarVisible, setGcTargetCalendar, loadGcSyncCalendars,
} from './googleCalendarService'
import { fetchAppointments } from './appointmentService'
import type { GcCalendar, GcToken } from './googleCalendarService'

// Complete auth session on web/mobile after redirect
WebBrowser.maybeCompleteAuthSession()

// ── OAuth config ──────────────────────────────────────────────────────────────
// Set EXPO_PUBLIC_GOOGLE_CLIENT_ID in your .env file.
// Also set EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS for iOS (if different).
// Create credentials at: https://console.cloud.google.com/apis/credentials

const CLIENT_ID_WEB     = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? ''
const CLIENT_ID_IOS     = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS ?? CLIENT_ID_WEB

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

export function useGoogleCalendar({ withCalendars = false }: { withCalendars?: boolean } = {}) {
  const { session } = useAuth()
  const userId = session?.user?.id

  const [token, setToken]         = useState<GcToken | null>(null)
  const [loading, setLoading]     = useState(true)
  const [syncing, setSyncing]     = useState(false)
  const [syncResult, setSyncResult] = useState<{ pushed: number; pulled: number } | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [accountEmail, setAccountEmail] = useState<string | null>(null)
  const [calendars, setCalendars] = useState<GcCalendar[]>([])
  const [calendarsLoading, setCalendarsLoading] = useState(false)
  const [calendarError, setCalendarError] = useState(false)

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
      const gcToken = await exchangeGcCode(code, redirectUri, request?.codeVerifier)
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
      const refreshed = await refreshGcAccessToken(token.refresh_token)
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

  const reloadCalendars = useCallback(async () => {
    if (!userId) return
    const fresh = await ensureFreshToken()
    if (!fresh) return
    const result = await refreshGcCalendars(userId, fresh)
    setCalendars(result.calendars)
    setAccountEmail(result.accountEmail)
  }, [userId, ensureFreshToken])

  const accessToken = token?.access_token
  useEffect(() => {
    if (!withCalendars || !accessToken) { setCalendars([]); setAccountEmail(null); return }
    setCalendarsLoading(true)
    reloadCalendars()
      .catch(e => { console.error('[googleCalendars]', e); setCalendarError(true) })
      .finally(() => setCalendarsLoading(false))
  }, [withCalendars, accessToken, reloadCalendars])

  // ── Calendar selection ─────────────────────────────────────────────────────
  const toggleCalendar = useCallback(async (calendarId: string, visible: boolean) => {
    if (!userId) return
    setCalendarError(false)
    setCalendars(list => list.map(c => (c.calendar_id === calendarId ? { ...c, is_visible: visible } : c)))
    try {
      await setGcCalendarVisible(userId, calendarId, visible)
      if (!visible) return
      const fresh = await ensureFreshToken()
      if (!fresh) return
      const { created } = await pullFromGoogle(userId, fresh, [calendarId])
      setSyncResult({ pushed: 0, pulled: created })
    } catch (e) {
      console.error('[toggleCalendar]', e)
      setCalendarError(true)
      setCalendars(list => list.map(c => (c.calendar_id === calendarId ? { ...c, is_visible: !visible } : c)))
    }
  }, [userId, ensureFreshToken])

  const chooseTargetCalendar = useCallback(async (calendarId: string) => {
    if (!userId) return
    setCalendarError(false)
    const previous = calendars
    setCalendars(list => list.map(c => ({ ...c, is_target: c.calendar_id === calendarId })))
    try {
      await setGcTargetCalendar(userId, calendarId)
    } catch (e) {
      console.error('[chooseTargetCalendar]', e)
      setCalendarError(true)
      setCalendars(previous)
    }
  }, [userId, calendars])

  // ── Sync ───────────────────────────────────────────────────────────────────
  const syncAll = useCallback(async () => {
    if (!userId || !token?.access_token) return
    setSyncing(true)
    setError(null)
    try {
      const accessToken = await ensureFreshToken()
      if (!accessToken) return
      const { visible, target } = await loadGcSyncCalendars(userId)

      // Push Oryalis → Google (next 30 days + past 7 days)
      const from = new Date(Date.now() - 7 * 86400000).toISOString()
      const to   = new Date(Date.now() + 30 * 86400000).toISOString()
      const appointments = await fetchAppointments({ from, to })
      let pushed = 0
      for (const appt of appointments) {
        if (!appt.client_id) continue
        try {
          await pushAppointmentToGoogle(userId, appt, accessToken, target)
          pushed++
        } catch (e: any) {
          if (e.message === 'gc_token_expired') { setError('Token expiré — reconnectez Google Agenda'); break }
          console.error('[syncAll.push]', appt.id, e)
        }
      }

      // Pull Google → Oryalis
      const { created: pulled } = await pullFromGoogle(userId, accessToken, visible)

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
    accountEmail,
    calendars,
    calendarsLoading,
    calendarError,
    toggleCalendar,
    chooseTargetCalendar,
    loading,
    syncing,
    syncResult,
    error,
    connect,
    disconnect,
    syncAll,
  }
}
