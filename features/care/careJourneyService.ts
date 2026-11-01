import { supabase } from '@/shared/lib/supabase'
import type { CareJourney, Followup } from '@/shared/lib/types'
import type { CareChannel } from './careTemplates'

// Relances après commande remplacées par les étapes d'un accompagnement actif (J+3 conservée).
export const CARE_JOURNEY_SUPERSEDED_RULES = ['nc_j30', 'ord_j15', 'ord_j30']

// ── Favoris d'accompagnement (care_templates) ─────────────────────────────────────────────────

export interface CareFavoriteStep {
  offsetDays: number
  channel: CareChannel
  label: string
  message: string
}

export interface CareFavorite {
  id: string
  name: string
  steps: CareFavoriteStep[]
  created_at: string
}

export async function fetchCareFavorites(): Promise<CareFavorite[]> {
  const { data, error } = await supabase
    .from('care_templates')
    .select('id, name, steps, created_at')
    .order('name')
  if (error) throw error
  return (data ?? []) as CareFavorite[]
}

export async function createCareFavorite(userId: string, name: string, steps: CareFavoriteStep[]): Promise<CareFavorite> {
  const { data, error } = await supabase
    .from('care_templates')
    .insert({ user_id: userId, name: name.trim(), steps })
    .select('id, name, steps, created_at')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('care_favorite_exists')
    throw error
  }
  return data as CareFavorite
}

export async function deleteCareFavorite(id: string): Promise<void> {
  const { error } = await supabase.from('care_templates').delete().eq('id', id)
  if (error) throw error
}

export interface CareStepInput {
  key: string
  title: string
  dueDate: string
  channel: CareChannel
  message: string
}

export interface StartCareJourneyInput {
  clientId: string
  templateKey: string
  label: string
  startDate: string
  steps: CareStepInput[]
}

// Dernier accompagnement du contact (actif ou non) et ses étapes, dans l'ordre chronologique.
export async function fetchLatestCareJourney(clientId: string): Promise<{ journey: CareJourney | null; steps: Followup[] }> {
  const { data: journey, error } = await supabase
    .from('care_journeys')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!journey) return { journey: null, steps: [] }

  const { data: steps, error: stepsError } = await supabase
    .from('followups')
    .select('*')
    .eq('care_journey_id', journey.id)
    .order('due_date')
  if (stepsError) throw stepsError
  return { journey: journey as CareJourney, steps: (steps ?? []) as Followup[] }
}

export async function hasActiveCareJourney(clientId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('care_journeys')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'active')
  if (error) throw error
  return (count ?? 0) > 0
}

export async function completeCareJourney(journeyId: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('care_journeys')
    .update({ status: 'completed', completed_at: now, updated_at: now })
    .eq('id', journeyId)
  if (error) throw error
}

// Arrêter = annuler les étapes encore à faire (jamais celles déjà faites), puis l'accompagnement.
// Dans cet ordre : un échec entre les deux laisse un accompagnement actif sans étape à venir,
// qu'un nouvel arrêt termine proprement.
export async function stopCareJourney(journeyId: string): Promise<void> {
  const now = new Date().toISOString()
  const { error: stepsError } = await supabase
    .from('followups')
    .update({ cancelled_at: now, updated_at: now })
    .eq('care_journey_id', journeyId)
    .eq('done', false)
    .is('cancelled_at', null)
  if (stepsError) throw stepsError

  const { error } = await supabase
    .from('care_journeys')
    .update({ status: 'stopped', stopped_at: now, updated_at: now })
    .eq('id', journeyId)
  if (error) throw error
}

export async function startCareJourney(userId: string, input: StartCareJourneyInput): Promise<CareJourney> {
  // Un accompagnement encore "actif" mais sans étape restante est clôturé avant d'en démarrer
  // un nouveau (index unique : un seul actif par contact).
  const { journey: previous, steps: previousSteps } = await fetchLatestCareJourney(input.clientId)
  if (previous?.status === 'active') {
    const remaining = previousSteps.some(s => !s.done && !s.cancelled_at)
    if (remaining) throw new Error('care_journey_already_active')
    await completeCareJourney(previous.id)
  }

  const { data: journey, error } = await supabase
    .from('care_journeys')
    .insert({
      user_id: userId,
      client_id: input.clientId,
      template_key: input.templateKey,
      label: input.label,
      start_date: input.startDate,
    })
    .select()
    .single()
  if (error) throw error

  const { error: stepsError } = await supabase.from('followups').insert(
    input.steps.map(step => ({
      user_id: userId,
      client_id: input.clientId,
      title: step.title,
      due_date: step.dueDate,
      done: false,
      auto_generated: false,
      action_type: step.channel,
      care_journey_id: journey.id,
      care_step_key: step.key,
      message_body: step.message,
    })),
  )
  if (stepsError) {
    // Création interrompue avant toute étape : l'accompagnement vide est retiré pour pouvoir
    // réessayer (aucune étape n'y est encore rattachée, rien d'historique n'est perdu).
    await supabase.from('care_journeys').delete().eq('id', journey.id)
    throw stepsError
  }
  return journey as CareJourney
}
