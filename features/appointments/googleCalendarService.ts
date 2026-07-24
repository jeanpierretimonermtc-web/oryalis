import { supabase } from '@/shared/lib/supabase'
import type { Appointment } from './appointmentTypes'

const GC_API = 'https://www.googleapis.com/calendar/v3'
const CALENDAR_ID = 'primary'

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

export async function refreshGcAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{ access_token: string; expires_at: string | null }> {
  const params = new URLSearchParams({
    refresh_token:  refreshToken,
    client_id:      clientId,
    client_secret:  clientSecret,
    grant_type:     'refresh_token',
  })
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  })
  if (!res.ok) throw new Error(`gc_refresh_failed: ${res.status}`)
  const data = await res.json()
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

export async function listGcEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string
): Promise<GcEvent[]> {
  const params = new URLSearchParams({
    timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
  })
  const data = await gcFetch(`/calendars/${CALENDAR_ID}/events?${params}`, accessToken)
  return data?.items ?? []
}

export async function createGcEvent(accessToken: string, event: GcEvent): Promise<GcEvent> {
  return gcFetch(`/calendars/${CALENDAR_ID}/events`, accessToken, {
    method: 'POST',
    body: JSON.stringify(event),
  })
}

export async function updateGcEvent(accessToken: string, eventId: string, event: Partial<GcEvent>): Promise<GcEvent> {
  return gcFetch(`/calendars/${CALENDAR_ID}/events/${eventId}`, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(event),
  })
}

export async function deleteGcEvent(accessToken: string, eventId: string): Promise<void> {
  await gcFetch(`/calendars/${CALENDAR_ID}/events/${eventId}`, accessToken, { method: 'DELETE' })
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

function appointmentToGcEvent(appt: Appointment): GcEvent {
  return {
    summary:     appt.title,
    description: appt.appointment_type ?? undefined,
    location:    appt.location ?? undefined,
    start: { dateTime: appt.start_at, timeZone: appt.timezone ?? 'Europe/Paris' },
    end:   { dateTime: appt.end_at,   timeZone: appt.timezone ?? 'Europe/Paris' },
    status: appt.status === 'cancelled' ? 'cancelled' : 'confirmed',
  }
}

// Push one Oryalis appointment → Google Calendar
export async function pushAppointmentToGoogle(
  userId: string,
  appt: Appointment,
  accessToken: string
): Promise<string> {
  // Check if already synced
  const { data: existing } = await supabase
    .from('google_calendar_events')
    .select('google_event_id')
    .eq('user_id', userId)
    .eq('appointment_id', appt.id)
    .single()

  const gcEvent = appointmentToGcEvent(appt)

  if (existing?.google_event_id) {
    // Update existing
    if (appt.status === 'cancelled') {
      await deleteGcEvent(accessToken, existing.google_event_id)
      await supabase.from('google_calendar_events').delete()
        .eq('user_id', userId).eq('appointment_id', appt.id)
      return existing.google_event_id
    }
    await updateGcEvent(accessToken, existing.google_event_id, gcEvent)
    await supabase.from('google_calendar_events').update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', userId).eq('appointment_id', appt.id)
    return existing.google_event_id
  }

  // Create new
  const created = await createGcEvent(accessToken, gcEvent)
  await supabase.from('google_calendar_events').insert({
    user_id: userId, appointment_id: appt.id,
    google_event_id: created.id!, calendar_id: CALENDAR_ID,
  })
  return created.id!
}

// Pull Google Calendar events → Oryalis appointments (next 30 days)
export async function pullFromGoogle(
  userId: string,
  accessToken: string
): Promise<{ created: number; skipped: number }> {
  const now = new Date()
  const future = new Date(now.getTime() + 30 * 86400000)
  const events = await listGcEvents(
    accessToken,
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
        provider:         'google',
      })
      .select('id')
      .single()

    if (error || !appt) { skipped++; continue }

    await supabase.from('google_calendar_events').insert({
      user_id: userId, appointment_id: appt.id,
      google_event_id: event.id, calendar_id: CALENDAR_ID,
    })
    created++
  }

  return { created, skipped }
}
