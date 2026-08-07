import { supabase } from '@/shared/lib/supabase'

export type ClientEventType = 'pipeline_change' | 'role_change' | 'appointment_cancelled' | 'appointment_deleted' | 'outcome_change'

export interface ClientEvent {
  id: string
  user_id: string
  client_id: string
  event_type: ClientEventType
  old_value: string | null
  new_value: string | null
  appointment_title: string | null
  appointment_date: string | null
  reason: string | null
  created_at: string
}

export interface ClientEventFields {
  old_value?: string | null
  new_value?: string | null
  appointment_title?: string | null
  appointment_date?: string | null
  reason?: string | null
}

// Traçabilité (décision de la refonte) — table append-only, jamais modifiée ni
// supprimée depuis l'application : voir supabase/migrations/20260802_client_events.sql.
export async function logClientEvent(
  userId: string,
  clientId: string,
  eventType: ClientEventType,
  fields: ClientEventFields = {},
) {
  const { error } = await supabase
    .from('client_events')
    .insert({ user_id: userId, client_id: clientId, event_type: eventType, ...fields })
  if (error) throw error
}

export async function getClientEvents(clientId: string) {
  const { data, error } = await supabase
    .from('client_events')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as ClientEvent[]
}
