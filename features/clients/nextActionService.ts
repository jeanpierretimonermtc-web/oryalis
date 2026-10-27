import { Platform } from 'react-native'
import * as Linking from 'expo-linking'
import { supabase } from '@/shared/lib/supabase'
import type { Client } from '@/shared/lib/types'
import { updateInteraction } from '@/features/interactions/interactionService'

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
// Pour une interaction : délégation inchangée vers son service dédié. Pour une relance :
// ACTION-OUTCOME-1 / P1.1 — plus aucune clôture directe ici. La fiche Contact ouvre désormais
// systématiquement FollowupCompletionModal (même moteur que les pages Relances) avant d'appeler
// quoi que ce soit ; cette fonction n'est donc plus jamais invoquée pour source === 'followup'.
export async function completeNextAction(client: Client): Promise<CompleteNextActionResult> {
  const { source, id } = requireSource(client)

  if (source === 'appointment') {
    return { appointmentId: id }
  }

  if (source === 'interaction') {
    // ACTION-OUTCOME-1 / P0 — même service que la page Interactions (updateInteraction),
    // jamais un second moteur de clôture. Ce raccourci rapide depuis la fiche Contact reste
    // volontairement sans résultat/compte-rendu (hors périmètre de ce lot, cf. §2/§41) :
    // seul completed_at est renseigné, comme avant.
    await updateInteraction(id, { completed_at: new Date().toISOString() })
    return
  }

  // source === 'followup' : ne devrait structurellement plus jamais arriver (voir commentaire
  // ci-dessus) — erreur explicite plutôt qu'une clôture silencieuse qui contournerait P1.
  throw new Error('completeNextAction ne gère plus les relances : passer par FollowupCompletionModal.')
}

// Reporte la prochaine action à une date/heure choisie explicitement par l'utilisateur
// (calendrier + heure) plutôt qu'un décalage fixe — l'utilisateur choisit le nouveau
// moment plutôt que de subir un report systématique d'un jour.
export async function rescheduleNextAction(client: Client, newDateTime: Date, durationMinutes?: number) {
  const { source, id } = requireSource(client)
  const shifted = newDateTime
  let operation
  if (source === 'appointment') {
    let duration = (durationMinutes ?? 0) * 60000
    if (!duration) {
      const { data, error } = await supabase.from('appointments').select('start_at, end_at').eq('id', id).single()
      if (error) throw error
      duration = new Date(data.end_at).getTime() - new Date(data.start_at).getTime()
    }
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
