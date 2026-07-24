import { supabase } from '@/shared/lib/supabase'
import type { Followup, FollowupWithClient } from '@/shared/lib/types'

export type FollowupInput =
  Omit<Followup, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'auto_generated' | 'priority_score' | 'pipeline_stage' | 'prospect_temperature' | 'product_context'>
  & {
    auto_generated?: boolean
    priority_score?: number | null
    pipeline_stage?: Followup['pipeline_stage']
    prospect_temperature?: Followup['prospect_temperature']
    product_context?: Followup['product_context']
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
    .select('*, client:clients(id, full_name, status, contact_role, pipeline_stage)')
    .eq('user_id', userId)
    .eq('done', false)
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
  if (error) throw error
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
    f.client?.status === 'vip' ||
    f.client?.contact_role === 'distributor' ||
    f.client?.contact_role === 'leader'
  ) score += 10
  return score
}
