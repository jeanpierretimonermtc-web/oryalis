// LRP-5 — sépare enfin PROGRAMME / ÉCHÉANCE (recurring_program_occurrences) / COMMANDE : une
// échéance représente un cycle prévu (ex. "envoi automatique le 25/09" côté entreprise), pas une
// commande. occurrence ≠ order — voir shared/lib/types.ts. Ce fichier est la SEULE
// implémentation qui crée/avance des échéances : jamais une seconde logique de calendrier
// dupliquée dans un écran (même doctrine que recurringProgramService.ts pour les programmes).
import { supabase } from '@/shared/lib/supabase'
import type { RecurringProgram, RecurringProgramOccurrence, RecurringProgramOccurrenceStatus, LrpFrequencyUnit } from '@/shared/lib/types'
import { calculateNextLrpDate } from './clientService'
import { updateProgram, countConsumedOccurrences } from './recurringProgramService'
import { updateOrderRecurringProgram } from '@/features/orders/orderService'
import type { LrpProgramValue } from './lrpProgramService'
import { resolveOccurrenceDateForOrder } from './lrpProgramService'

const OCCURRENCE_COLS = '*'

export async function fetchOccurrencesForProgram(programId: string): Promise<RecurringProgramOccurrence[]> {
  const { data, error } = await supabase
    .from('recurring_program_occurrences')
    .select(OCCURRENCE_COLS)
    .eq('recurring_program_id', programId)
    .order('scheduled_date', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as RecurringProgramOccurrence[]
}

// LRP-5.1 §9/§14/§24 — "à confirmer" n'est JAMAIS stocké en base : dérivé à l'affichage
// uniquement. CORRIGE LRP-5 : une échéance 'scheduled' dont la date est dépassée ne devient "due"
// que si le PROGRAMME est actif. Programme paused/cancelled/completed → toujours 'scheduled',
// quelle que soit la date : jamais de bouton Confirmer/Non réalisée ni d'alerte pour un
// programme qui n'est plus actif (§9/§14/§23/§24 du brief LRP-5.1).
export type OccurrenceDisplayStatus = 'scheduled' | 'due' | 'confirmed' | 'skipped'

export function deriveOccurrenceDisplayStatus(
  occurrence: Pick<RecurringProgramOccurrence, 'status' | 'scheduled_date'>,
  programStatus: RecurringProgram['status'],
  todayIso: string,
): OccurrenceDisplayStatus {
  if (occurrence.status !== 'scheduled') return occurrence.status
  if (programStatus !== 'active') return 'scheduled'
  return occurrence.scheduled_date <= todayIso ? 'due' : 'scheduled'
}

// LRP-5 §2/§14 — find-or-create idempotent (même mécanisme 23505 qu'ailleurs dans ce projet,
// protégé par l'index unique (recurring_program_id, scheduled_date)) : ne crée jamais de doublon
// si appelée plusieurs fois pour la même date, jamais de commande.
export async function ensureOccurrenceAt(program: RecurringProgram, scheduledDate: string): Promise<RecurringProgramOccurrence> {
  const { data: existing, error: fetchError } = await supabase
    .from('recurring_program_occurrences')
    .select(OCCURRENCE_COLS)
    .eq('recurring_program_id', program.id)
    .eq('scheduled_date', scheduledDate)
    .maybeSingle()
  if (fetchError) throw new Error(fetchError.message)
  if (existing) return existing as RecurringProgramOccurrence

  const { data, error } = await supabase
    .from('recurring_program_occurrences')
    .insert({
      user_id: program.user_id,
      client_id: program.client_id,
      recurring_program_id: program.id,
      scheduled_date: scheduledDate,
      status: 'scheduled',
    })
    .select(OCCURRENCE_COLS)
    .single()
  if (error) {
    if (error.code === '23505') {
      const { data: raced, error: raceFetchError } = await supabase
        .from('recurring_program_occurrences')
        .select(OCCURRENCE_COLS)
        .eq('recurring_program_id', program.id)
        .eq('scheduled_date', scheduledDate)
        .single()
      if (raceFetchError) throw new Error(raceFetchError.message)
      return raced as RecurringProgramOccurrence
    }
    throw new Error(error.message)
  }
  return data as RecurringProgramOccurrence
}

// LRP-5.1 §4.B — matérialise l'échéance déjà pointée par program.next_occurrence_date (no-op si
// absente) pour un programme activé SANS commande réelle (cas B du brief : "programme créé
// indépendamment"). Jamais pour générer plusieurs échéances futures d'avance (§22 — un programme
// sans fin ne matérialise jamais que la prochaine échéance, pas des centaines). Non appelée par
// linkOrderToOccurrenceForConfirmation (cas A, avec commande — ancre désormais directement sur
// orderDate via ensureOccurrenceAt+confirmOccurrence) ni par reactivateProgram (logique dédiée,
// §10) ; conservée comme point d'entrée officiel si un flux de création SANS commande est ajouté.
export async function ensureNextScheduledOccurrence(program: RecurringProgram): Promise<RecurringProgramOccurrence | null> {
  if (!program.next_occurrence_date) return null
  return ensureOccurrenceAt(program, program.next_occurrence_date)
}

async function updateOccurrence(id: string, patch: Partial<Pick<RecurringProgramOccurrence, 'status' | 'confirmed_at' | 'notes'>>): Promise<RecurringProgramOccurrence> {
  const { data, error } = await supabase
    .from('recurring_program_occurrences')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(OCCURRENCE_COLS)
    .single()
  if (error) throw new Error(error.message)
  return data as RecurringProgramOccurrence
}

// LRP-5 §15/§16 — SEULE fonction officielle de transition d'une échéance vers 'confirmed' ou
// 'skipped', ET d'avancée du calendrier qui en découle. Idempotente : un appel sur une occurrence
// déjà résolue (confirmed/skipped) est un no-op — jamais un double avancement (essentiel pour la
// "commande complémentaire" qui vise une échéance potentiellement déjà confirmée par une 1ère
// commande). L'ancrage du calcul de la PROCHAINE échéance est TOUJOURS occurrence.scheduled_date,
// jamais confirmed_at ni une date de commande — aucune dérive de calendrier possible (LRP-5 §16).
async function resolveOccurrence(
  occurrence: RecurringProgramOccurrence,
  program: RecurringProgram,
  status: Extract<RecurringProgramOccurrenceStatus, 'confirmed' | 'skipped'>,
  notes?: string | null,
): Promise<{ occurrence: RecurringProgramOccurrence; program: RecurringProgram }> {
  if (occurrence.status !== 'scheduled') return { occurrence, program }

  const updatedOccurrence = await updateOccurrence(occurrence.id, {
    status,
    confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
    notes: notes ?? null,
  })

  let updatedProgram = program
  if (program.status === 'active') {
    const consumed = await countConsumedOccurrences(program.id)
    const limitReached = program.end_mode === 'occurrence_limit' && program.occurrence_limit != null && consumed >= program.occurrence_limit
    if (limitReached) {
      updatedProgram = await updateProgram(program.id, { status: 'completed', next_occurrence_date: null })
    } else if (program.frequency_value != null && program.frequency_unit != null) {
      // LRP-5 §16 — ancré sur l'échéance qui vient d'être résolue, jamais sur order_date/
      // confirmed_at : une confirmation en retard (échéance 25/09, confirmée le 28/09) donne
      // toujours 25/10 comme prochaine échéance, jamais 28/10.
      const nextDate = calculateNextLrpDate(updatedOccurrence.scheduled_date, program.frequency_value, program.frequency_unit)
      const pastEnd = program.end_mode === 'end_date' && program.end_date != null && nextDate > program.end_date
      if (pastEnd) {
        updatedProgram = await updateProgram(program.id, { status: 'completed', next_occurrence_date: null })
      } else {
        updatedProgram = await updateProgram(program.id, { next_occurrence_date: nextDate })
        await ensureOccurrenceAt(updatedProgram, nextDate)
      }
    }
  }
  return { occurrence: updatedOccurrence, program: updatedProgram }
}

export function confirmOccurrence(occurrence: RecurringProgramOccurrence, program: RecurringProgram) {
  return resolveOccurrence(occurrence, program, 'confirmed')
}

export function skipOccurrence(occurrence: RecurringProgramOccurrence, program: RecurringProgram, notes?: string | null) {
  return resolveOccurrence(occurrence, program, 'skipped', notes)
}

// LRP-5.1 §7/§8/§11 — CORRIGE LRP-5 : pause/annulation NE marquent PLUS l'échéance 'scheduled'
// en cours comme 'skipped'. `skipped` signifie explicitement "l'échéance a bien existé mais
// l'utilisateur confirme qu'elle n'a pas été réalisée" — jamais un effet de bord de la pause ou
// de l'annulation, qui sont des états DIFFÉRENTS d'une échéance non réalisée. L'échéance
// 'scheduled' reste donc intacte, avec sa date et son statut inchangés ; c'est le statut du
// PROGRAMME lui-même (paused/cancelled, testé par deriveOccurrenceDisplayStatus et
// isProgramEligibleForNextOccurrence) qui neutralise toute alerte/action "à confirmer" tant
// qu'il n'est pas 'active' — aucun état supplémentaire nécessaire en base (§9/§26).

// LRP-5.3 §1/§14/§19/§20 — réactivation : ne doit jamais créer une 2e échéance 'scheduled'
// concurrente ni marquer l'ancienne 'skipped' automatiquement ni changer occurrence_limit/
// progression. CORRIGE LRP-5.2 : le choix est désormais présenté SYSTÉMATIQUEMENT (même si
// l'échéance existante est encore future — §14 : le programme a pu être mis en pause justement
// parce que la date devait changer), jamais une réactivation directe invisible. Identifiants
// métier STABLES (jamais un libellé i18n comme clé) — une seule orchestration officielle,
// jamais 3 fonctions divergentes.
export type ReactivationMode = 'preserve_schedule' | 'fresh_start' | 'custom_date'

export type ReactivationChoice =
  | { mode: 'preserve_schedule' }
  | { mode: 'fresh_start' }
  | { mode: 'custom_date'; date: string }

// LRP-5.3 §4/§5/§6/§21/§22/§23 — calcule la date candidate pour CHAQUE option, sans jamais rien
// écrire (pure, utilisée aussi bien pour l'aperçu affiché dans l'UI que par reactivateProgram) :
// - preserve_schedule : si l'échéance existante est déjà >= aujourd'hui, conservée EXACTEMENT
//   (§21 — y compris si elle tombe pile aujourd'hui, elle redevient alors "à confirmer" après
//   réactivation, c'est attendu). Sinon, avance par PAS DE FRÉQUENCE depuis cette ancienne
//   échéance (jamais depuis aujourd'hui) jusqu'à obtenir la première date >= aujourd'hui —
//   conserve le jour/rythme historique (25 du mois, tous les 2 mardis...) quel que soit le
//   nombre de cycles manqués pendant la pause. Sans échéance antérieure, rien à préserver :
//   équivalent à fresh_start.
// - fresh_start : today + une fréquence, JAMAIS une échéance due le jour même (§22 — "je repars
//   pour un nouveau cycle complet", pas une échéance immédiate).
// - custom_date : exactement la date choisie, aucune fréquence appliquée dessus (§23) — devient
//   le nouvel ancrage tel quel, la fréquence ne reprend qu'à la PROCHAINE résolution
//   (confirmOccurrence/skipOccurrence, déjà ancrées sur occurrence.scheduled_date).
export function computeReactivationCandidateDate(
  program: Pick<RecurringProgram, 'frequency_value' | 'frequency_unit'>,
  currentScheduledOccurrence: RecurringProgramOccurrence | null,
  todayIso: string,
  choice: ReactivationChoice,
): string | null {
  if (choice.mode === 'custom_date') return choice.date

  if (program.frequency_value == null || program.frequency_unit == null) {
    return currentScheduledOccurrence?.scheduled_date ?? null
  }
  const freqValue = program.frequency_value
  const freqUnit = program.frequency_unit
  if (choice.mode === 'fresh_start' || !currentScheduledOccurrence) {
    return calculateNextLrpDate(todayIso, freqValue, freqUnit)
  }
  // preserve_schedule : avance strictement tant que la date reste AVANT aujourd'hui (§21 — une
  // échéance tombant pile aujourd'hui est conservée, jamais poussée au cycle suivant).
  let date = currentScheduledOccurrence.scheduled_date
  while (date < todayIso) {
    date = calculateNextLrpDate(date, freqValue, freqUnit)
  }
  return date
}

// LRP-5.3 §12 — le programme ne peut pas être réactivé "comme si de rien n'était" si son
// occurrence_limit est déjà consommé. Réutilise countConsumedOccurrences (même règle officielle
// que resolveOccurrence/completeIfDurationReached, jamais redupliquée).
export async function isProgramReactivatable(program: RecurringProgram): Promise<boolean> {
  if (program.end_mode === 'occurrence_limit' && program.occurrence_limit != null) {
    const consumed = await countConsumedOccurrences(program.id)
    if (consumed >= program.occurrence_limit) return false
  }
  return true
}

// LRP-5.3 §11 — une date candidate (calculée OU choisie manuellement) est valide seulement si
// le programme n'est pas en mode end_date, ou si elle ne le dépasse pas. Fonction pure, utilisée
// à la fois pour griser une option dans l'UI et pour la garde défensive côté service.
export function isReactivationDateWithinEnd(
  program: Pick<RecurringProgram, 'end_mode' | 'end_date'>,
  candidateDate: string | null,
): boolean {
  if (!candidateDate) return true
  if (program.end_mode !== 'end_date' || program.end_date == null) return true
  return candidateDate <= program.end_date
}

// LRP-5.3 §8/§9/§10/§19/§24 — applique le choix une fois VALIDÉ par l'utilisateur (jamais avant,
// jamais choisi à sa place). Réutilise la ligne 'scheduled' existante (UPDATE scheduled_date),
// n'en crée une nouvelle que si aucune n'existait — respecte
// UNIQUE(recurring_program_id, scheduled_date). Ne confirme, ne skip, ni n'avance
// occurrence_limit : la reprise ne consomme jamais de cycle. Idempotente : rejouée avec le même
// choix, elle réécrit les mêmes valeurs (aucun double avancement, aucune occurrence
// supplémentaire).
export async function reactivateProgram(
  program: RecurringProgram,
  currentScheduledOccurrence: RecurringProgramOccurrence | null,
  todayIso: string,
  choice: ReactivationChoice,
): Promise<RecurringProgram> {
  if (!(await isProgramReactivatable(program))) {
    return updateProgram(program.id, { status: 'completed', next_occurrence_date: null })
  }

  const targetDate = computeReactivationCandidateDate(program, currentScheduledOccurrence, todayIso, choice)

  // LRP-5.3 §11 — jamais d'échéance programmée après end_date : le programme se termine plutôt
  // que de reprendre sur une date impossible (garde défensive — l'UI est censée avoir déjà
  // empêché la sélection d'une option invalide).
  if (!isReactivationDateWithinEnd(program, targetDate)) {
    return updateProgram(program.id, { status: 'completed', next_occurrence_date: null })
  }

  if (currentScheduledOccurrence) {
    if (targetDate && targetDate !== currentScheduledOccurrence.scheduled_date) {
      await updateOccurrenceScheduledDate(currentScheduledOccurrence.id, targetDate)
    }
  } else if (targetDate) {
    await ensureOccurrenceAt(program, targetDate)
  }

  return updateProgram(program.id, { status: 'active', next_occurrence_date: targetDate })
}

async function updateOccurrenceScheduledDate(id: string, scheduledDate: string): Promise<RecurringProgramOccurrence> {
  const { data, error } = await supabase
    .from('recurring_program_occurrences')
    .update({ scheduled_date: scheduledDate, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(OCCURRENCE_COLS)
    .single()
  if (error) throw new Error(error.message)
  return data as RecurringProgramOccurrence
}

// LRP-5 §24 — rattachement MANUEL d'une commande legacy à une échéance historique (voir
// OrderEditModal "Rattacher à un programme") : enregistre l'échéance comme confirmée SANS
// jamais toucher le calendrier du programme (next_occurrence_date/occurrence_limit) — un
// rattachement historique ne doit jamais faire avancer le cycle ACTUEL (LRP-4.6 déjà tranché
// ainsi pour completeIfDurationReached, généralisé ici à l'avancement d'occurrence). Distincte de
// resolveOccurrence : pas d'appel à countConsumedOccurrences/updateProgram/ensureOccurrenceAt sur
// la suite du calendrier.
export async function recordHistoricalOccurrence(
  program: RecurringProgram,
  scheduledDate: string,
): Promise<RecurringProgramOccurrence> {
  const occurrence = await ensureOccurrenceAt(program, scheduledDate)
  if (occurrence.status === 'scheduled') {
    return updateOccurrence(occurrence.id, { status: 'confirmed', confirmed_at: new Date().toISOString() })
  }
  return occurrence
}

// LRP-5.1 §3/§4/§5 — CORRIGE LRP-5 : la toute première commande d'un programme tout juste créé
// (aucune échéance connue à consommer, occurrenceDateToConsume==null) ne doit plus rester
// "non rattachée à une échéance précise" — elle EST le cycle initial. Son échéance est ancrée
// sur `orderDate` (la seule référence disponible quand aucun calendrier n'existait encore,
// cohérent avec nextOccurrenceAnchor côté lrpProgramService.ts), créée directement 'confirmed'
// puis liée à la commande. confirmOccurrence calcule alors la suivante depuis CETTE date
// (jamais depuis `nextLrpDate` recalculé séparément) : programme "25/08, mensuel, 4 échéances"
// donne exactement 25/08 confirmed → 25/09 scheduled, jamais un 5e cycle en 25/12 (§5).
// Orchestration UNIQUE remplaçant la séquence dupliquée dans clients/[id]/orders.tsx et
// appointmentOutcomeService.ts ("créer/mettre à jour le programme, puis poser le lien commande").
export async function linkOrderToOccurrenceForConfirmation(
  orderId: string,
  program: RecurringProgram,
  confirmation: LrpProgramValue,
  orderDate: string,
): Promise<RecurringProgram> {
  const occurrenceDate = resolveOccurrenceDateForOrder(confirmation) ?? orderDate
  const occurrence = await ensureOccurrenceAt(program, occurrenceDate)
  const result = await confirmOccurrence(occurrence, program)
  await updateOrderRecurringProgram(orderId, program.id, result.occurrence.id, occurrenceDate)
  return result.program
}
