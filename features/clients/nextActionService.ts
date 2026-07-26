import { Platform } from 'react-native'
import * as Linking from 'expo-linking'
import { supabase } from '@/shared/lib/supabase'
import type { Client } from '@/shared/lib/types'
import { toggleFollowupDone } from '@/features/followups/followupService'
import { markInteractionDone } from '@/features/interactions/interactionService'

function requireSource(client: Client) {
  if (!client.next_action_source || !client.next_action_source_id) {
    throw new Error('Aucune prochaine action à traiter.')
  }
  return { source: client.next_action_source, id: client.next_action_source_id }
}

export type CompleteNextActionResult = {
  appointmentId: string
} | void

// Orchestre la prochaine action en délégant au service dédié à chaque ressource.
// Pour un rendez-vous : la fiche Contact ne complète JAMAIS le RDV elle-même — elle
// renvoie uniquement l'identifiant du RDV pour navigation vers sa fiche, où le débrief
// est confirmé PUIS le RDV complété (appointmentService.completeAppointment), que le
// RDV soit déjà completed (débrief affiché en lecture) ou pas encore (confirmation
// suivie de la complétion). Aucune logique post-RDV n'est dupliquée ici.
// Pour followup/interaction : délégation inchangée vers leur service dédié.
export async function completeNextAction(client: Client): Promise<CompleteNextActionResult> {
  const { source, id } = requireSource(client)

  if (source === 'appointment') {
    return { appointmentId: id }
  }

  if (source === 'interaction') {
    await markInteractionDone(id)
    return
  }

  await toggleFollowupDone(id, true)
}

export async function postponeNextAction(client: Client, days = 1) {
  const { source, id } = requireSource(client)
  if (!client.next_action_at) throw new Error('Cette action ne possède pas de date.')
  const shifted = new Date(new Date(client.next_action_at).getTime() + days * 86400000)
  let operation
  if (source === 'appointment') {
    const { data, error } = await supabase.from('appointments').select('start_at, end_at').eq('id', id).single()
    if (error) throw error
    const duration = new Date(data.end_at).getTime() - new Date(data.start_at).getTime()
    operation = supabase.from('appointments').update({
      start_at: shifted.toISOString(),
      end_at: new Date(shifted.getTime() + duration).toISOString(),
      status: 'rescheduled',
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  } else if (source === 'interaction') {
    operation = supabase.from('interactions').update({ scheduled_at: shifted.toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
  } else {
    operation = supabase.from('followups').update({ due_date: shifted.toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', id)
  }
  const { error } = await operation
  if (error) throw error
}

export async function callContact(phone: string) {
  await Linking.openURL(`tel:${phone.replace(/[^+\d]/g, '')}`)
}

export async function openWhatsApp(phone: string) {
  const digits = phone.replace(/\D/g, '')
  // app_absent=0 laisse WhatsApp tenter d'ouvrir l'appli desktop/mobile installée
  // avant de proposer WhatsApp Web (connexion par QR code) en repli.
  const webUrl = `https://api.whatsapp.com/send?phone=${digits}&type=phone_number&app_absent=0`
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return
    // Nouvel onglet sur desktop (ne quitte pas Oryalis) ; même onglet sur mobile web,
    // seule méthode fiable pour déclencher le deep link vers l'appli WhatsApp mobile.
    if (window.innerWidth >= 768) window.open(webUrl, '_blank', 'noopener,noreferrer')
    else window.location.href = webUrl
    return
  }
  try {
    await Linking.openURL(`whatsapp://send?phone=${digits}`)
  } catch {
    await Linking.openURL(webUrl)
  }
}
