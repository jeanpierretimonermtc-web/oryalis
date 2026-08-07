import { supabase } from '@/shared/lib/supabase'
import type { Followup, FollowupWithClient } from '@/shared/lib/types'

export type FollowupInput =
  Omit<Followup, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'auto_generated' | 'priority_score' | 'pipeline_stage' | 'prospect_temperature' | 'product_context' | 'appointment_id' | 'automation_rule_id' | 'cancelled_at' | 'closure_action_key' | 'order_id'>
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
    .select('*, client:clients(id, full_name, status, contact_role, pipeline_stage, is_vip)')
    .eq('user_id', userId)
    .eq('done', false)
    .is('cancelled_at', null)
    .order('due_date')
  if (error) throw error
  return data
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
    throw error
  }
  return data as Followup
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
