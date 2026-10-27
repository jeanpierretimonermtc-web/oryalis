// LRP-4 — service du programme récurrent générique (recurring_programs), source de vérité du
// programme d'un contact. Remplace progressivement clients.lrp_status/next_lrp_date/
// lrp_frequency_value/lrp_frequency_unit/lrp_start_date pour tout NOUVEAU consommateur — ces
// colonnes restent en base, gelées, pour compatibilité et historique (voir migration
// 20260825_recurring_programs.sql).
import { supabase } from '@/shared/lib/supabase'
import type { RecurringProgram, RecurringProgramStatus, RecurringProgramEndMode, LrpFrequencyUnit } from '@/shared/lib/types'

export interface RecurringProgramInput {
  client_id: string
  label?: string | null
  status?: RecurringProgramStatus
  start_date?: string | null
  frequency_value?: number | null
  frequency_unit?: LrpFrequencyUnit | null
  end_mode?: RecurringProgramEndMode
  occurrence_limit?: number | null
  end_date?: string | null
  next_occurrence_date?: string | null
  // LRP-4.2 §8 — voir createProgram.
  closure_action_key?: string | null
}

export type RecurringProgramPatch = Partial<Omit<RecurringProgramInput, 'client_id'>>

// Un contact peut porter plusieurs programmes (§11) — "le" programme actif pertinent pour un
// affichage compact (jamais pour une création de commande, qui doit désormais toujours passer
// par fetchProgramsForClient + un choix explicite si 2+ actifs, LRP-4.1 §3) est celui dont
// l'échéance est la plus proche.
export async function fetchActiveProgramForClient(clientId: string): Promise<RecurringProgram | null> {
  const { data, error } = await supabase
    .from('recurring_programs')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'active')
    .order('next_occurrence_date', { ascending: true, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as RecurringProgram | null
}

// Tous les programmes d'un contact (actifs ou non) — alimente la Synthèse (une entrée par
// programme actif), le Profil, et le sélecteur de programme à la création d'une commande
// (LRP-4.1 §3 : 0/1/2+ programmes actifs n'ont pas le même comportement, décidé par l'appelant
// à partir de cette liste complète, jamais par une présélection silencieuse côté service).
export async function fetchProgramsForClient(clientId: string): Promise<RecurringProgram[]> {
  const { data, error } = await supabase
    .from('recurring_programs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as RecurringProgram[]
}

export async function fetchProgramById(id: string): Promise<RecurringProgram | null> {
  const { data, error } = await supabase
    .from('recurring_programs')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as RecurringProgram | null
}

// LRP-4.2 §8 — `closure_action_key` (optionnel) rend la création idempotente : un réessai après
// un échec partiel (programme créé avec succès au 1er essai, mais la pose du lien
// orders.recurring_program_id ayant échoué) doit RETROUVER ce programme, jamais en créer un
// second. Même mécanisme, même code d'erreur (23505, contrainte unique partielle en base) que
// orderService.createOrder — pattern déjà éprouvé dans ce projet, pas une nouvelle heuristique.
export async function createProgram(userId: string, input: RecurringProgramInput): Promise<RecurringProgram> {
  const { data, error } = await supabase
    .from('recurring_programs')
    .insert({
      user_id: userId,
      client_id: input.client_id,
      label: input.label?.trim() || null,
      status: input.status ?? 'active',
      start_date: input.start_date ?? null,
      frequency_value: input.frequency_value ?? null,
      frequency_unit: input.frequency_unit ?? null,
      end_mode: input.end_mode ?? 'open_ended',
      occurrence_limit: input.occurrence_limit ?? null,
      end_date: input.end_date ?? null,
      next_occurrence_date: input.next_occurrence_date ?? null,
      closure_action_key: input.closure_action_key ?? null,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505' && input.closure_action_key) {
      const { data: existing, error: fetchError } = await supabase
        .from('recurring_programs')
        .select('*')
        .eq('client_id', input.client_id)
        .eq('closure_action_key', input.closure_action_key)
        .single()
      if (fetchError) throw new Error(fetchError.message)
      return existing as RecurringProgram
    }
    throw new Error(error.message)
  }
  return data as RecurringProgram
}

export async function updateProgram(id: string, patch: RecurringProgramPatch): Promise<RecurringProgram> {
  const payload: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() }
  if (patch.label !== undefined) payload.label = patch.label?.trim() || null
  const { data, error } = await supabase
    .from('recurring_programs')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as RecurringProgram
}

// LRP-5 §9/§10 — DÉFINITION OFFICIELLE de la progression d'un programme, basée sur les
// ÉCHÉANCES (recurring_program_occurrences), plus sur les commandes : remplace
// countRealizedOccurrences (LRP-4.3, comptage par recurring_occurrence_date distinctes sur
// `orders`). "confirmed" ET "skipped" consomment tous deux une échéance du programme —
// occurrence_limit désigne un nombre de CYCLES prévus par le calendrier, pas un nombre de
// commandes honorées avec succès (voir rapport LRP-5 §7 : une échéance "non réalisée" a quand
// même eu lieu dans le calendrier, elle ne doit pas prolonger indéfiniment un programme "4
// échéances"). "scheduled" n'est jamais compté ici (à venir ou à confirmer, pas encore résolue).
export async function countConsumedOccurrences(programId: string): Promise<number> {
  const { count, error } = await supabase
    .from('recurring_program_occurrences')
    .select('id', { count: 'exact', head: true })
    .eq('recurring_program_id', programId)
    .in('status', ['confirmed', 'skipped'])
  if (error) throw new Error(error.message)
  return count ?? 0
}

// LRP-4.1 §6/§7 — SEULE fonction officielle de transition automatique active→completed,
// couvrant les DEUX modes de durée (jamais deux implémentations qui pourraient diverger) :
//  - occurrence_limit : le nombre d'occurrences réalisées (règle ci-dessus) a atteint la limite.
//  - end_date : la prochaine échéance calculée tomberait après la date de fin — aucune nouvelle
//    occurrence valide n'est plus possible.
// Ne s'applique jamais à un programme déjà non-actif (paused/cancelled/completed) : un retour
// ultérieur sur une commande déjà comptée ne peut donc jamais rouvrir un programme complété
// (cancelled_at reste inchangé par un retour, le compte ne varie pas).
export async function completeIfDurationReached(program: RecurringProgram): Promise<RecurringProgram> {
  if (program.status !== 'active') return program
  if (program.end_mode === 'occurrence_limit' && program.occurrence_limit != null) {
    const consumed = await countConsumedOccurrences(program.id)
    if (consumed >= program.occurrence_limit) {
      return updateProgram(program.id, { status: 'completed', next_occurrence_date: null })
    }
  }
  // LRP-4.2 §5 — deux façons pour un programme end_date d'être arrivé à son terme, testées
  // indépendamment : (a) la prochaine échéance CALCULÉE tomberait après end_date (aucune
  // nouvelle occurrence valide possible) ; (b) le calendrier lui-même a dépassé end_date SANS
  // qu'aucune nouvelle commande ne soit jamais venue déclencher (a) — cas explicitement signalé
  // par le brief ("ne dépend pas uniquement de l'ouverture de la vue programme"). Cette fonction
  // reste néanmoins déclenchée par une action utilisateur (lien de commande, ouverture de la
  // vue) : Oryalis n'a pas d'infrastructure de tâche planifiée (pas de cron/serveur), donc le
  // statut DB peut rester temporairement `active` un peu après end_date tant qu'aucune de ces
  // actions ne s'est produite — voir isProgramEligibleForNextOccurrence ci-dessous, qui garantit
  // qu'AUCUN consommateur ne signale malgré tout ce programme comme actif dans cet intervalle.
  if (program.end_mode === 'end_date' && program.end_date != null) {
    const today = new Date().toISOString().split('T')[0]
    const scheduledPastEnd = program.next_occurrence_date != null && program.next_occurrence_date > program.end_date
    const calendarPastEnd = today > program.end_date
    if (scheduledPastEnd || calendarPastEnd) {
      return updateProgram(program.id, { status: 'completed', next_occurrence_date: null })
    }
  }
  return program
}

// LRP-4.2 §5/§6 — RÈGLE MÉTIER UNIQUE déterminant si un programme doit être signalé comme
// ayant une prochaine échéance active, réutilisée identiquement par alertService, useDashboard,
// networkService et la Synthèse Contact (jamais dupliquée/redivergée dans 4 écrans). Volontairement
// indépendante de `status`seul : un programme dont `end_date` est dépassée ne doit JAMAIS être
// signalé actif, même si son statut DB n'a pas encore été normalisé à 'completed' par
// completeIfDurationReached (aucune tâche planifiée dans cette app — voir commentaire ci-dessus).
export function isProgramEligibleForNextOccurrence(
  program: Pick<RecurringProgram, 'status' | 'next_occurrence_date' | 'end_mode' | 'end_date'>,
  todayIso: string,
): boolean {
  if (program.status !== 'active') return false
  if (!program.next_occurrence_date) return false
  if (program.end_mode === 'end_date' && program.end_date != null && todayIso > program.end_date) return false
  return true
}
