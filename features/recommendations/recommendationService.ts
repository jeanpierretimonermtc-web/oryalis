import { supabase } from '@/shared/lib/supabase'
import type { Recommendation, RecommendationStatus } from '@/shared/lib/types'

export async function getRecommendationsByClient(clientId: string) {
  const { data, error } = await supabase
    .from('recommendations')
    .select('*, catalog:catalogs(name, color, icon)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Recommendation[]
}

export async function createRecommendation(
  userId: string,
  clientId: string,
  productName: string,
  reason: string | null,
  status: RecommendationStatus = 'advised',
  catalogId: string | null = null,
  productId: string | null = null,
  quantity = 1,
  objective: string | null = null,
  // Lot 1.2 — RDV source, uniquement quand créée explicitement depuis une clôture (§6).
  appointmentId: string | null = null,
  // Lot 1.2.1 §4 — clé d'idempotence déterministe, protégée par un index unique partiel
  // (appointment_id, closure_action_key) : un rejeu du même plan ne duplique jamais.
  closureActionKey: string | null = null,
) {
  const { data, error } = await supabase
    .from('recommendations')
    .insert({
      user_id: userId,
      client_id: clientId,
      product_name: productName,
      reason,
      status,
      catalog_id: catalogId,
      product_id: productId,
      quantity,
      objective,
      appointment_id: appointmentId,
      closure_action_key: closureActionKey,
    })
    .select('*, catalog:catalogs(name, color, icon)')
    .single()
  if (error) {
    if (error.code === '23505' && closureActionKey && appointmentId) {
      const { data: existing, error: fetchError } = await supabase
        .from('recommendations')
        .select('*, catalog:catalogs(name, color, icon)')
        .eq('appointment_id', appointmentId)
        .eq('closure_action_key', closureActionKey)
        .single()
      if (fetchError) throw fetchError
      return existing as Recommendation
    }
    throw error
  }
  return data as Recommendation
}

export async function updateRecommendationStatus(id: string, status: RecommendationStatus) {
  const { error } = await supabase
    .from('recommendations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteRecommendation(id: string) {
  const { error } = await supabase.from('recommendations').delete().eq('id', id)
  if (error) throw error
}

// Distinct de deleteRecommendation : conserve l'historique (Lot 1.2 §16) plutôt que de
// supprimer physiquement une recommandation non finalisée devenue caduque.
export async function cancelRecommendation(id: string): Promise<void> {
  const { error } = await supabase.from('recommendations').update({ cancelled_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}
