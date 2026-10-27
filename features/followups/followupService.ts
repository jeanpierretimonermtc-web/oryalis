import { supabase } from '@/shared/lib/supabase'
import type { Followup, FollowupWithClient, Interaction, NextActionType } from '@/shared/lib/types'
import { createInteraction, getInteractionBySourceFollowup } from '@/features/interactions/interactionService'
import type { InteractionInput } from '@/features/interactions/interactionService'

export type FollowupInput =
  Omit<Followup, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'auto_generated' | 'priority_score' | 'pipeline_stage' | 'prospect_temperature' | 'product_context' | 'appointment_id' | 'automation_rule_id' | 'cancelled_at' | 'closure_action_key' | 'order_id' | 'source_interaction_id'>
  & {
    auto_generated?: boolean
    priority_score?: number | null
    pipeline_stage?: Followup['pipeline_stage']
    prospect_temperature?: Followup['prospect_temperature']
    product_context?: Followup['product_context']
    appointment_id?: Followup['appointment_id']
    automation_rule_id?: Followup['automation_rule_id']
    // Lot 1.2.1 §4 — clé d'idempotence déterministe (RDV + révision + type d'action),
    // protégée par un index unique partiel en base.
    closure_action_key?: Followup['closure_action_key']
    order_id?: Followup['order_id']
    // ACTION-OUTCOME-1 / P1.2 — traçabilité optionnelle vers l'interaction d'origine.
    source_interaction_id?: Followup['source_interaction_id']
  }

export async function cancelFollowup(id: string): Promise<void> {
  const { error } = await supabase.from('followups').update({ cancelled_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function getFollowupsByClient(clientId: string) {
  const { data, error } = await supabase
    .from('followups')
    .select('*')
    .eq('client_id', clientId)
    .order('due_date')
  if (error) throw error
  return data as Followup[]
}

export async function getPendingFollowups(userId: string) {
  const { data, error } = await supabase
    .from('followups')
    .select('*, client:clients(id, full_name, contact_role, pipeline_stage, is_vip)')
    .eq('user_id', userId)
    .eq('done', false)
    .is('cancelled_at', null)
    .order('due_date')
  if (error) throw error
  return data
}

// Compteur léger pour le Dashboard (aucune ligne affichée, un seul nombre nécessaire).
// La comparaison de date reproduit exactement formatLocalDate() du Dashboard (date locale
// de l'appareil, pas UTC) pour éviter un écart avec le nombre affiché à l'écran.
export async function getOverdueFollowupCount(userId: string): Promise<number> {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const { count, error } = await supabase
    .from('followups')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('done', false)
    .is('cancelled_at', null)
    .lte('due_date', todayStr)
  if (error) throw error
  return count ?? 0
}

export async function createFollowup(userId: string, input: FollowupInput) {
  const { data, error } = await supabase
    .from('followups')
    .insert({ ...input, user_id: userId })
    .select()
    .single()
  if (error) {
    // 23505 = un plan de clôture/révision déjà confirmé est rejoué — renvoyer la relance déjà
    // créée plutôt que d'en créer une seconde (Lot 1.2.1 §4).
    if (error.code === '23505' && input.closure_action_key && input.appointment_id) {
      const { data: existing, error: fetchError } = await supabase
        .from('followups')
        .select('*')
        .eq('appointment_id', input.appointment_id)
        .eq('closure_action_key', input.closure_action_key)
        .single()
      if (fetchError) throw fetchError
      return existing as Followup
    }
    // ACTION-OUTCOME-1 / P1.2.1 — même principe, pour une relance créée comme "Suite" d'une
    // interaction (source_interaction_id au lieu de appointment_id, cf.
    // followups_interaction_closure_key_uidx) : un retry après perte de réponse réseau/double
    // soumission retrouve la relance déjà créée au lieu d'en créer une seconde.
    if (error.code === '23505' && input.closure_action_key && input.source_interaction_id) {
      const { data: existing, error: fetchError } = await supabase
        .from('followups')
        .select('*')
        .eq('source_interaction_id', input.source_interaction_id)
        .eq('closure_action_key', input.closure_action_key)
        .single()
      if (fetchError) throw fetchError
      return existing as Followup
    }
    throw error
  }
  return data as Followup
}

export interface FollowupUpdateInput {
  title?: string | null
  content?: string | null
  action_type?: NextActionType | null
  due_date?: string
}

// UI-AFFORDANCE-1.1 — édition ciblée d'une relance existante (titre/contenu/type/échéance
// uniquement) : ne touche jamais `done` (clôture exclusivement gérée par
// FollowupCompletionModal/P1), ni aucun champ structurel (appointment_id,
// source_interaction_id, closure_action_key, automation_rule_id, order_id, pipeline_stage) —
// seuls les champs explicitement présents dans `input` sont écrits.
export async function updateFollowup(id: string, input: FollowupUpdateInput) {
  const { error } = await supabase
    .from('followups')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function toggleFollowupDone(id: string, done: boolean) {
  const { error } = await supabase
    .from('followups')
    .update({ done, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteFollowup(id: string) {
  const { error } = await supabase.from('followups').delete().eq('id', id)
  if (error) throw error
}

export type FollowupExchangeInput = Omit<InteractionInput, 'client_id' | 'source_followup_id'>

// ACTION-OUTCOME-1 / P1 §17/§20 — "Enregistrer l'échange" a deux effets métier : créer
// l'interaction historique, puis clôturer la relance. Ordre choisi pour permettre une reprise
// propre après un échec partiel : si l'interaction est créée mais que le done=true échoue
// ensuite, un nouvel appel retrouve l'interaction déjà liée (23505 sur l'index unique partiel
// interactions_source_followup_id_uniq) au lieu d'en créer une seconde, puis retente
// uniquement la clôture — même stratégie que createFollowup/closure_action_key ci-dessus.
export async function completeFollowupWithInteraction(
  followup: Followup,
  userId: string,
  input: FollowupExchangeInput
): Promise<Interaction> {
  let interaction: Interaction
  try {
    interaction = await createInteraction(userId, {
      ...input,
      client_id: followup.client_id,
      source_followup_id: followup.id,
    })
  } catch (error: any) {
    if (error?.code === '23505') {
      const existing = await getInteractionBySourceFollowup(followup.id)
      if (!existing) throw error
      interaction = existing
    } else {
      throw error
    }
  }
  await toggleFollowupDone(followup.id, true)
  return interaction
}

export function computeFollowupPriority(f: FollowupWithClient, today: string): number {
  let score = 0
  if (f.prospect_temperature === 'very_hot') score += 40
  if (f.due_date < today) score += 30
  const pipelineStage = f.client?.pipeline_stage ?? f.pipeline_stage
  if (pipelineStage === 'follow_up') score += 20
  if (
    f.client?.is_vip ||
    f.client?.contact_role?.includes('distributor') ||
    f.client?.contact_role?.includes('leader')
  ) score += 10
  return score
}
