// RÉCAP-5B — couche de persistance uniquement : aucun câblage UI/bouton de partage dans ce
// lot (voir RÉCAP-5C). Table append-only (supabase/migrations/20260824_appointment_recap_shares.sql,
// RLS SELECT+INSERT uniquement) : volontairement aucune fonction update/delete ici, l'immutabilité
// est garantie principalement par la DB, pas par convention frontend.
import { supabase } from '@/shared/lib/supabase'
import type { AppointmentRecapShare, RecapShareChannel } from './appointmentTypes'

export interface LogRecapShareInput {
  clientId: string
  appointmentId: string | null
  channel: RecapShareChannel
  messageSnapshot: string
  // Renseigné uniquement pour le canal email ; toujours absent/null pour whatsapp/sms.
  subjectSnapshot?: string | null
}

const RECAP_SHARE_COLUMNS = 'id, user_id, client_id, appointment_id, channel, message_snapshot, subject_snapshot, created_at'

// Signifie uniquement "l'utilisateur a initié depuis Oryalis le partage de ce récapitulatif via
// ce canal" — jamais "envoyé"/"livré"/"reçu" (RÉCAP-5A §1). `messageSnapshot`/`subjectSnapshot`
// doivent être le texte exact déjà préparé par l'appelant, jamais reconstruits ici.
export async function logRecapShare(userId: string, input: LogRecapShareInput): Promise<AppointmentRecapShare> {
  if (!input.clientId) throw new Error('client_id_required')
  if (!input.messageSnapshot.trim()) throw new Error('message_snapshot_required')

  const { data, error } = await supabase
    .from('appointment_recap_shares')
    .insert({
      user_id: userId,
      client_id: input.clientId,
      appointment_id: input.appointmentId,
      channel: input.channel,
      message_snapshot: input.messageSnapshot,
      subject_snapshot: input.subjectSnapshot ?? null,
    })
    .select(RECAP_SHARE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return data as AppointmentRecapShare
}

// Timeline contact (RÉCAP-5D) — non consommé dans ce lot.
export async function getRecapSharesByClient(clientId: string): Promise<AppointmentRecapShare[]> {
  const { data, error } = await supabase
    .from('appointment_recap_shares')
    .select(RECAP_SHARE_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as AppointmentRecapShare[]
}

// Fiche RDV (RÉCAP-5D) — non consommé dans ce lot. Plusieurs partages du même RDV sont
// légitimes (RÉCAP-5A §17, aucune déduplication) : uniquement le plus récent est utile ici.
export async function getLatestRecapShareForAppointment(appointmentId: string): Promise<AppointmentRecapShare | null> {
  const { data, error } = await supabase
    .from('appointment_recap_shares')
    .select(RECAP_SHARE_COLUMNS)
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as AppointmentRecapShare | null
}
