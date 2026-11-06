import { supabase } from '@/shared/lib/supabase'
import type { Appointment } from './appointmentTypes'

const GC_API = 'https://www.googleapis.com/calendar/v3'
// Identifiant du calendrier principal dans Oryalis, quel que soit le compte Google.
export const PRIMARY_CALENDAR_ID = 'primary'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GcToken {
  access_token: string
  refresh_token?: string | null
  expires_at?: string | null
}

export interface GcEvent {
  id?: string
  summary: string
  description?: string
  location?: string
  start: { dateTime: string; timeZone?: string }
  end:   { dateTime: string; timeZone?: string }
  status?: 'confirmed' | 'tentative' | 'cancelled'
}

export interface GcCalendar {
  calendar_id: string
  name: string
  color: string | null
  is_primary: boolean
  can_write: boolean
  is_visible: boolean
  is_target: boolean
}

// ── Token storage ─────────────────────────────────────────────────────────────

export async function saveGcToken(userId: string, token: GcToken): Promise<void> {
  const { error } = await supabase.from('google_calendar_tokens').upsert(
    {
      user_id:       userId,
      access_token:  token.access_token,
      refresh_token: token.refresh_token ?? null,
      expires_at:    token.expires_at ?? null,
      updated_at:    new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (error) throw new Error(error.message)
}

export async function loadGcToken(userId: string): Promise<GcToken | null> {
  const { data, error } = await supabase
    .from('google_calendar_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .single()
  if (error?.code === 'PGRST116') return null
  if (error) throw new Error(error.message)
  return data as GcToken
}

export async function deleteGcToken(userId: string): Promise<void> {
  const { error } = await supabase.from('google_calendar_tokens').delete().eq('user_id', userId)
  if (error) throw new Error(error.message)
}

// La clé secrète Google reste côté serveur (api/google-token.js).
const GOOGLE_TOKEN_URL = `${process.env.EXPO_PUBLIC_APP_URL ?? 'https://oryalis.vercel.app'}/api/google-token`

async function requestGoogleToken(payload: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`gc_token_failed: ${data.error ?? res.status}`)
  return data as { access_token: string; refresh_token: string | null; expires_in: number | null }
}

export async function exchangeGcCode(code: string, redirectUri: string, codeVerifier?: string): Promise<GcToken> {
  const data = await requestGoogleToken({
    grant_type: 'authorization_code', code, redirect_uri: redirectUri,
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  })
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  }
}

export async function refreshGcAccessToken(refreshToken: string): Promise<{ access_token: string; expires_at: string | null }> {
  const data = await requestGoogleToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
  return {
    access_token: data.access_token,
    expires_at:   data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null,
  }
}

// ── Google Calendar API helpers ───────────────────────────────────────────────

async function gcFetch(path: string, accessToken: string, options?: RequestInit) {
  let response: Response
  try {
    response = await fetch(`${GC_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers ?? {}),
      },
    })
  } catch (e) {
    throw new Error(`gc_network_error: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (response.status === 401) throw new Error('gc_token_expired')
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Google Calendar ${response.status}: ${body}`)
  }
  if (response.status === 204) return null
  return response.json()
}

const calendarPath = (calendarId: string) => `/calendars/${encodeURIComponent(calendarId)}/events`

export async function listGcEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<GcEvent[]> {
  const params = new URLSearchParams({
    timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
  })
  const data = await gcFetch(`${calendarPath(calendarId)}?${params}`, accessToken)
  return data?.items ?? []
}

export async function createGcEvent(accessToken: string, calendarId: string, event: GcEvent): Promise<GcEvent> {
  return gcFetch(calendarPath(calendarId), accessToken, {
    method: 'POST',
    body: JSON.stringify(event),
  })
}

export async function updateGcEvent(accessToken: string, calendarId: string, eventId: string, event: Partial<GcEvent>): Promise<GcEvent> {
  return gcFetch(`${calendarPath(calendarId)}/${eventId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(event),
  })
}

export async function deleteGcEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  await gcFetch(`${calendarPath(calendarId)}/${eventId}`, accessToken, { method: 'DELETE' })
}

// ── Calendar selection ────────────────────────────────────────────────────────

const GC_CALENDAR_COLS = 'calendar_id, name, color, is_primary, can_write, is_visible, is_target'

interface GcCalendarListItem {
  id: string
  summary?: string
  summaryOverride?: string
  backgroundColor?: string
  accessRole?: string
  primary?: boolean
}

async function removeImportedEvents(userId: string, calendarId: string): Promise<void> {
  const { error } = await supabase.from('appointments').delete()
    .eq('user_id', userId).eq('provider', 'google').eq('external_calendar_id', calendarId)
  if (error) throw new Error(error.message)
}

// Met à jour la liste depuis Google en conservant les choix déjà faits. Le premier passage
// reprend le comportement historique : calendrier principal seul.
export async function refreshGcCalendars(
  userId: string,
  accessToken: string
): Promise<{ calendars: GcCalendar[]; accountEmail: string | null }> {
  const data = await gcFetch('/users/me/calendarList?maxResults=250', accessToken)
  // Google ne donne pas les titres des calendriers "disponibilités seulement".
  const remote = ((data?.items ?? []) as GcCalendarListItem[]).filter(c => c.accessRole !== 'freeBusyReader')

  const { data: stored, error } = await supabase
    .from('google_calendars').select(GC_CALENDAR_COLS).eq('user_id', userId)
  if (error) throw new Error(error.message)
  const known = new Map(((stored ?? []) as GcCalendar[]).map(c => [c.calendar_id, c]))

  const rows: GcCalendar[] = remote.map(c => {
    const calendarId = c.primary ? PRIMARY_CALENDAR_ID : c.id
    const previous = known.get(calendarId)
    const canWrite = c.accessRole === 'owner' || c.accessRole === 'writer'
    return {
      calendar_id: calendarId,
      name: c.summaryOverride ?? c.summary ?? c.id,
      color: c.backgroundColor ?? null,
      is_primary: Boolean(c.primary),
      can_write: canWrite,
      is_visible: previous ? previous.is_visible : (known.size === 0 && Boolean(c.primary)),
      is_target: Boolean(previous?.is_target) && canWrite,
    }
  })
  if (!rows.some(c => c.is_target)) {
    const primary = rows.find(c => c.is_primary)
    if (primary) primary.is_target = true
  }

  if (rows.length > 0) {
    const { error: saveError } = await supabase.from('google_calendars').upsert(
      rows.map(c => ({ ...c, user_id: userId, updated_at: new Date().toISOString() })),
      { onConflict: 'user_id,calendar_id' }
    )
    if (saveError) throw new Error(saveError.message)
  }

  const remoteIds = new Set(rows.map(c => c.calendar_id))
  for (const calendarId of known.keys()) {
    if (remoteIds.has(calendarId)) continue
    await removeImportedEvents(userId, calendarId)
    const { error: deleteError } = await supabase.from('google_calendars').delete()
      .eq('user_id', userId).eq('calendar_id', calendarId)
    if (deleteError) throw new Error(deleteError.message)
  }

  const sorted = [...rows].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name))
  return { calendars: sorted, accountEmail: remote.find(c => c.primary)?.id ?? null }
}

// Décocher retire les copies d'Oryalis ; rien n'est supprimé chez Google.
export async function setGcCalendarVisible(userId: string, calendarId: string, visible: boolean): Promise<void> {
  const { error } = await supabase.from('google_calendars')
    .update({ is_visible: visible, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('calendar_id', calendarId)
  if (error) throw new Error(error.message)
  if (!visible) await removeImportedEvents(userId, calendarId)
}

// Dans cet ordre : la base n'accepte qu'un seul calendrier cible à la fois.
export async function setGcTargetCalendar(userId: string, calendarId: string): Promise<void> {
  const updatedAt = new Date().toISOString()
  const { error: clearError } = await supabase.from('google_calendars')
    .update({ is_target: false, updated_at: updatedAt })
    .eq('user_id', userId).eq('is_target', true)
  if (clearError) throw new Error(clearError.message)
  const { error } = await supabase.from('google_calendars')
    .update({ is_target: true, updated_at: updatedAt })
    .eq('user_id', userId).eq('calendar_id', calendarId)
  if (error) throw new Error(error.message)
}

export async function loadGcSyncCalendars(userId: string): Promise<{ visible: string[]; target: string }> {
  const { data, error } = await supabase
    .from('google_calendars').select('calendar_id, is_visible, is_target').eq('user_id', userId)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  if (rows.length === 0) return { visible: [PRIMARY_CALENDAR_ID], target: PRIMARY_CALENDAR_ID }
  return {
    visible: rows.filter(c => c.is_visible).map(c => c.calendar_id),
    target: rows.find(c => c.is_target)?.calendar_id ?? PRIMARY_CALENDAR_ID,
  }
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

function appointmentToGcEvent(appt: Appointment): GcEvent {
  return {
    summary:     appt.title,
    description: appt.appointment_type ?? undefined,
    // MEETING-MODE-1 — une visio n'a pas d'adresse : son lien tient lieu de lieu dans l'agenda.
    location:    (appt.meeting_mode === 'video' ? appt.meeting_url : appt.location) ?? undefined,
    start: { dateTime: appt.start_at, timeZone: appt.timezone ?? 'Europe/Paris' },
    end:   { dateTime: appt.end_at,   timeZone: appt.timezone ?? 'Europe/Paris' },
    status: appt.status === 'cancelled' ? 'cancelled' : 'confirmed',
  }
}

// Push one Oryalis appointment → Google Calendar
export async function pushAppointmentToGoogle(
  userId: string,
  appt: Appointment,
  accessToken: string,
  targetCalendarId: string
): Promise<string> {
  // Check if already synced
  const { data: existing } = await supabase
    .from('google_calendar_events')
    .select('google_event_id, calendar_id')
    .eq('user_id', userId)
    .eq('appointment_id', appt.id)
    .single()

  const gcEvent = appointmentToGcEvent(appt)

  if (existing?.google_event_id) {
    // Update existing
    if (appt.status === 'cancelled') {
      await deleteGcEvent(accessToken, existing.calendar_id, existing.google_event_id)
      await supabase.from('google_calendar_events').delete()
        .eq('user_id', userId).eq('appointment_id', appt.id)
      return existing.google_event_id
    }
    await updateGcEvent(accessToken, existing.calendar_id, existing.google_event_id, gcEvent)
    await supabase.from('google_calendar_events').update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', userId).eq('appointment_id', appt.id)
    return existing.google_event_id
  }

  // Create new
  const created = await createGcEvent(accessToken, targetCalendarId, gcEvent)
  await supabase.from('google_calendar_events').insert({
    user_id: userId, appointment_id: appt.id,
    google_event_id: created.id!, calendar_id: targetCalendarId,
  })
  return created.id!
}

// Pull Google Calendar events → Oryalis appointments (next 30 days)
export async function pullFromGoogle(
  userId: string,
  accessToken: string,
  calendarIds: string[]
): Promise<{ created: number; skipped: number }> {
  let created = 0, skipped = 0
  for (const calendarId of calendarIds) {
    try {
      const result = await pullCalendar(userId, accessToken, calendarId)
      created += result.created
      skipped += result.skipped
    } catch (e) {
      // Un calendrier devenu inaccessible ne doit pas bloquer les autres.
      if (e instanceof Error && e.message === 'gc_token_expired') throw e
      console.error('[pullFromGoogle]', calendarId, e)
    }
  }
  return { created, skipped }
}

async function pullCalendar(
  userId: string,
  accessToken: string,
  calendarId: string
): Promise<{ created: number; skipped: number }> {
  const now = new Date()
  const future = new Date(now.getTime() + 30 * 86400000)
  const events = await listGcEvents(
    accessToken,
    calendarId,
    now.toISOString(),
    future.toISOString()
  )

  let created = 0, skipped = 0

  for (const event of events) {
    if (!event.id || !event.start?.dateTime) { skipped++; continue }

    // Skip if already mapped
    const { data: mapped } = await supabase
      .from('google_calendar_events')
      .select('id')
      .eq('user_id', userId)
      .eq('google_event_id', event.id)
      .single()
    if (mapped) { skipped++; continue }

    // Create appointment
    const { data: appt, error } = await supabase
      .from('appointments')
      .insert({
        user_id:          userId,
        title:            event.summary ?? 'Google Calendar event',
        appointment_type: 'other',
        status:           event.status === 'cancelled' ? 'cancelled' : 'scheduled',
        start_at:         event.start.dateTime,
        end_at:           event.end?.dateTime ?? event.start.dateTime,
        timezone:         event.start.timeZone ?? 'Europe/Paris',
        location:         event.location ?? null,
        meeting_mode:     event.location ? 'in_person' : null,
        provider:         'google',
        external_calendar_id: calendarId,
      })
      .select('id')
      .single()

    if (error || !appt) { skipped++; continue }

    await supabase.from('google_calendar_events').insert({
      user_id: userId, appointment_id: appt.id,
      google_event_id: event.id, calendar_id: calendarId,
    })
    created++
  }

  return { created, skipped }
}
