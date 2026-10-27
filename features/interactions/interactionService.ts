import { supabase } from '@/shared/lib/supabase'
import type { Interaction, InteractionType, InterestLevel, InteractionOutcomeCode } from '@/shared/lib/types'

export interface InteractionInput {
  client_id: string
  interaction_type: InteractionType
  scheduled_at?: string | null
  completed_at?: string | null
  subject?: string | null
  summary?: string | null
  needs_identified?: string | null
  objections?: string | null
  interest_level?: InterestLevel | null
  notes_brutes?: string | null
  completion_result?: InteractionOutcomeCode | null
  source_followup_id?: string | null
}

export async function getInteractionsByClient(clientId: string) {
  const { data, error } = await supabase
    .from('interactions')
    .select('*')
    .eq('client_id', clientId)
    .order('scheduled_at', { ascending: false, nullsFirst: false })
  if (error) throw error
  return data as Interaction[]
}

// ACTION-3.5 — équivalent groupé par utilisateur, sans limite et retards inclus, pour le
// filtre Contacts → À traiter → Interaction. Distincte de getUpcomingInteractions ci-dessous
// (qui exclut volontairement le passé et plafonne à `limit` résultats pour un autre usage) —
// ne pas la réutiliser telle quelle, ni la modifier pour ce nouveau besoin.
export async function getActiveInteractionsByUser(userId: string): Promise<{ id: string; client_id: string; scheduled_at: string }[]> {
  const { data, error } = await supabase
    .from('interactions')
    // CONTACTS-3.6 — id ajouté (même requête) : nécessaire pour cibler la ressource exacte
    // depuis "Tous types" déplié (navigation ?focus=<id>, réutilise CONTACT-4.2).
    .select('id, client_id, scheduled_at')
    .eq('user_id', userId)
    .is('completed_at', null)
    .not('scheduled_at', 'is', null)
  if (error) throw error
  return (data ?? []) as { id: string; client_id: string; scheduled_at: string }[]
}

export async function getUpcomingInteractions(userId: string, limit = 10) {
  const { data, error } = await supabase
    .from('interactions')
    .select('*, client:clients(id, full_name)')
    .eq('user_id', userId)
    .is('completed_at', null)
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at')
    .limit(limit)
  if (error) throw error
  return data as (Interaction & { client: { id: string; full_name: string } })[]
}

export async function createInteraction(userId: string, input: InteractionInput) {
  const { data, error } = await supabase
    .from('interactions')
    .insert({ ...input, user_id: userId })
    .select()
    .single()
  if (error) throw error
  return data as Interaction
}

// ACTION-OUTCOME-1 / P0 §31 — seul point d'écriture pour clôturer/modifier une interaction
// (markInteractionDone retirée : un même appel atomique gère désormais completed_at +
// completion_result + notes_brutes, jamais deux moteurs de clôture concurrents).
export async function updateInteraction(id: string, input: Partial<InteractionInput>) {
  const { data, error } = await supabase
    .from('interactions')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Interaction
}

export async function deleteInteraction(id: string) {
  const { error } = await supabase.from('interactions').delete().eq('id', id)
  if (error) throw error
}

// ACTION-OUTCOME-1 / P1 §3/§28 — retrouve l'interaction historique déjà créée pour une
// relance donnée (au plus une, garanti par l'index unique partiel sur source_followup_id) :
// sert à la fois au retry idempotent après un échec partiel et à détecter le cas d'une
// relance rouverte puis re-terminée qui possède déjà son échange.
export async function getInteractionBySourceFollowup(followupId: string) {
  const { data, error } = await supabase
    .from('interactions')
    .select('*')
    .eq('source_followup_id', followupId)
    .maybeSingle()
  if (error) throw error
  return data as Interaction | null
}

// FOLLOWUP-HISTORY-1 §16/§17 — équivalent groupé de getInteractionBySourceFollowup ci-dessus,
// pour une liste de relances terminées (fiche contact) : UNE requête `IN`, jamais 1 par relance.
// Retourne un tableau à plat ; l'appelant construit son propre lookup local
// (interactionByFollowupId[source_followup_id]) — cohérent avec fetchOrderItemsForOrders et les
// autres lectures groupées déjà en place dans le projet.
export async function getInteractionsBySourceFollowupIds(followupIds: string[]): Promise<Interaction[]> {
  if (followupIds.length === 0) return []
  const { data, error } = await supabase
    .from('interactions')
    .select('*')
    .in('source_followup_id', followupIds)
  if (error) throw error
  return data as Interaction[]
}
