// Lot 1.2 — services dédiés au parcours de clôture conditionnel selon le résultat, aux
// relances personnelles liées au RDV, aux RDV futurs liés, et à la révision d'un résultat
// déjà clôturé. Reste dans le domaine `appointments` (comme googleCalendarService.ts) plutôt
// que de créer une architecture parallèle.
import { supabase } from '@/shared/lib/supabase'
import { createFollowup } from '@/features/followups/followupService'
import { cancelFollowup } from '@/features/followups/followupService'
import { cancelTask } from '@/features/appointments/appointmentService'
import { cancelRecommendation, createRecommendation } from '@/features/recommendations/recommendationService'
import { upsertOrderForAppointment, confirmOrderFollowups } from '@/features/orders/orderService'
import { AUTOMATION_RULES, type AutoTrigger, type AutomationRule } from '@/features/automations/automationService'
import type {
  AppointmentOutcome,
  AppointmentOutcomeDetails,
  OutcomeRevisionReason,
  AppointmentOutcomeActionPlan,
} from './appointmentTypes'

// ── Snapshot sérialisé (client_events.old_value / new_value) ──────────────────
// client_events.old_value/new_value sont des colonnes `text` (pas jsonb) : sérialisation
// JSON maîtrisée et typée ici plutôt que de stocker un objet non typé.
export interface OutcomeSnapshot {
  outcome: AppointmentOutcome
  outcomeDetails: AppointmentOutcomeDetails | null
  outcomeOtherLabel: string | null
}

export function serializeOutcomeSnapshot(snapshot: OutcomeSnapshot): string {
  return JSON.stringify(snapshot)
}

export function parseOutcomeSnapshot(raw: string | null): OutcomeSnapshot | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as OutcomeSnapshot
  } catch {
    return null
  }
}

// ── Aperçu des relances automatiques applicables (lecture seule) ──────────────
// Ne crée jamais de relance — la création reste gérée par le moteur d'automatisation
// existant (checkNoContact, applyOrderAutomation, triggerAppointmentCompleted).
export function getApplicableAutomationRules(trigger: AutoTrigger): AutomationRule[] {
  return AUTOMATION_RULES.filter(r => r.trigger === trigger)
}

export async function isFirstOrderForClient(clientId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (error) throw new Error(error.message)
  return (count ?? 0) === 0
}

// ── RDV futurs du contact (pour "réutiliser un RDV existant comme suite") ─────
export interface UpcomingAppointmentOption {
  id: string
  title: string
  start_at: string
  status: string
}

export async function fetchUpcomingAppointmentsForClient(
  clientId: string,
  excludeAppointmentId: string,
): Promise<UpcomingAppointmentOption[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('id, title, start_at, status')
    .eq('client_id', clientId)
    .in('status', ['scheduled', 'rescheduled'])
    .neq('id', excludeAppointmentId)
    .gte('start_at', new Date().toISOString())
    .order('start_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

// Lie un RDV (déjà existant ou tout juste créé) comme suite explicite du RDV source — jamais
// déduit par date/titre/proximité.
export async function linkAppointmentAsFollowup(appointmentId: string, sourceAppointmentId: string): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({ followup_of_appointment_id: sourceAppointmentId })
    .eq('id', appointmentId)
  if (error) throw new Error(error.message)
}

// ── Détection de conflit relance personnelle vs relance existante ─────────────
export interface FollowupConflict {
  id: string
  title: string | null
  due_date: string
  action_type: string | null
  auto_generated: boolean
}

export async function detectFollowupConflict(
  clientId: string,
  dueDate: string,
  actionType: string | null,
): Promise<FollowupConflict | null> {
  const from = new Date(dueDate); from.setDate(from.getDate() - 1)
  const to = new Date(dueDate); to.setDate(to.getDate() + 1)
  const { data, error } = await supabase
    .from('followups')
    .select('id, title, due_date, action_type, auto_generated')
    .eq('client_id', clientId)
    .eq('done', false)
    .is('cancelled_at', null)
    .gte('due_date', from.toISOString().split('T')[0])
    .lte('due_date', to.toISOString().split('T')[0])
  if (error) throw new Error(error.message)
  const rows = data ?? []
  if (rows.length === 0) return null
  return rows.find(r => actionType && r.action_type === actionType) ?? rows[0]
}

// ── Relance personnelle liée au RDV (§12) ──────────────────────────────────────
export async function createPersonalFollowup(
  userId: string,
  clientId: string,
  appointmentId: string,
  input: { title: string; due_date: string; action_type: string; content?: string | null },
  closureActionKey?: string | null,
) {
  return createFollowup(userId, {
    client_id: clientId,
    title: input.title,
    due_date: input.due_date,
    done: false,
    action_type: input.action_type as any,
    content: input.content ?? null,
    appointment_id: appointmentId,
    closure_action_key: closureActionKey ?? undefined,
  })
}

// ── Exécution du plan d'actions (§13 Lot 1.2.1) ────────────────────────────────
// Actions post-clôture/révision, idempotentes (clé déterministe + index unique partiel en
// base) — rejouables sans jamais dupliquer. Unique implémentation, appelée identiquement par
// la clôture initiale et par la révision (pas de logique dupliquée entre les deux parcours).
export interface OutcomePlanWarnings {
  order: boolean
  recommendation: boolean
  personalFollowup: boolean
  appointmentLink: boolean
}

export async function applyOutcomePlanActions(
  userId: string,
  appointmentId: string,
  clientId: string,
  plan: AppointmentOutcomeActionPlan,
  actionKeyPrefix: string,
): Promise<OutcomePlanWarnings> {
  const warnings: OutcomePlanWarnings = { order: false, recommendation: false, personalFollowup: false, appointmentLink: false }

  if (plan.saleOrder && plan.saleOrder.products.length > 0) {
    try {
      const total = plan.saleOrder.products.reduce((sum, p) => sum + (p.amount ?? 0) * p.quantity, 0)
      // Réutilise (met à jour) la commande déjà liée à ce RDV plutôt que d'en créer une
      // nouvelle à chaque révision (§ correction demandée : plus aucun doublon possible, quel
      // que soit le nombre de fois où le résultat est révisé en gardant "Vente réalisée").
      const { order, isFirstOrder, clientFirstName, created } = await upsertOrderForAppointment(userId, appointmentId, {
        client_id: clientId,
        product_name: plan.saleOrder.products.map(p => p.label || '—').join(', '),
        products: plan.saleOrder.products.map(p => ({ product_id: p.productId, name: p.label, qty: p.quantity, price: p.amount })),
        amount: total > 0 ? total : null,
        status: 'delivered',
        order_type: 'customer',
      })
      // Les automatismes de commande restent indépendants de no_followup_required (§12) :
      // une vraie commande déclenche toujours ses relances, jamais gatées par la décision de
      // suite du RDV lui-même. Uniquement à la création réelle — jamais rejoué à chaque mise
      // à jour d'une commande déjà existante (la garde de insertFollowup reste une protection
      // supplémentaire, pas la seule).
      if (created) {
        await confirmOrderFollowups(userId, clientId, clientFirstName, isFirstOrder, undefined, appointmentId, order.id)
      }
    } catch (e) {
      console.error('[applyOutcomePlanActions.order]', e)
      warnings.order = true
    }
  }

  if (plan.recommendation) {
    try {
      await createRecommendation(
        userId, clientId, plan.recommendation.productName, plan.recommendation.reason,
        'advised', null, null, 1, null, appointmentId, `${actionKeyPrefix}:recommendation`,
      )
    } catch (e) {
      console.error('[applyOutcomePlanActions.recommendation]', e)
      warnings.recommendation = true
    }
  }

  if (plan.personalFollowup) {
    try {
      await createPersonalFollowup(userId, clientId, appointmentId, {
        title: plan.personalFollowup.title,
        due_date: plan.personalFollowup.dueDate,
        action_type: plan.personalFollowup.actionType,
        content: plan.personalFollowup.comment,
      }, `${actionKeyPrefix}:personal_followup`)
    } catch (e) {
      console.error('[applyOutcomePlanActions.personalFollowup]', e)
      warnings.personalFollowup = true
    }
  }

  if (plan.linkExistingAppointmentId) {
    try {
      await linkAppointmentAsFollowup(plan.linkExistingAppointmentId, appointmentId)
    } catch (e) {
      console.error('[applyOutcomePlanActions.appointmentLink]', e)
      warnings.appointmentLink = true
    }
  }

  return warnings
}

// ── Révision d'un résultat déjà clôturé (§15-19) ───────────────────────────────

export interface LinkedFollowup { id: string; title: string | null; due_date: string; done: boolean; cancelled_at: string | null; auto_generated: boolean }
export interface LinkedTask { id: string; title: string; due_at: string | null; status: string }
export interface LinkedFollowupAppointment { id: string; title: string; start_at: string; status: string }
export interface LinkedOrder { id: string; product_name: string; amount: number | null; status: string }
export interface LinkedRecommendation { id: string; product_name: string; status: string; cancelled_at: string | null }

export interface OutcomeRevisionPlan {
  appointmentId: string
  clientId: string
  previous: OutcomeSnapshot
  // Concurrence optimiste (Lot 1.2.1 §9) : transmise telle quelle à revise_appointment_outcome
  // comme p_expected_revision — la fonction refuse la modification si elle a changé entre
  // l'ouverture de ce plan et la confirmation.
  previousRevision: number
  linkedFollowups: LinkedFollowup[]
  linkedTasks: LinkedTask[]
  linkedFollowupAppointments: LinkedFollowupAppointment[]
  linkedOrders: LinkedOrder[]
  linkedRecommendations: LinkedRecommendation[]
}

// Relit l'état réel en base (jamais l'état local potentiellement périmé) — étape 1-2 de
// l'ordre des opérations §19 "Révision après clôture".
export async function buildOutcomeRevisionPlan(appointmentId: string): Promise<OutcomeRevisionPlan> {
  const { data: appt, error: apptError } = await supabase
    .from('appointments')
    .select('id, client_id')
    .eq('id', appointmentId)
    .single()
  if (apptError) throw new Error(apptError.message)

  const { data: biz, error: bizError } = await supabase
    .from('appointment_business_context')
    .select('outcome, outcome_details, outcome_other_label, outcome_revision')
    .eq('appointment_id', appointmentId)
    .single()
  if (bizError) throw new Error(bizError.message)

  const [followups, tasks, followupAppts, orders, recos] = await Promise.all([
    supabase.from('followups').select('id, title, due_date, done, cancelled_at, auto_generated').eq('appointment_id', appointmentId),
    supabase.from('appointment_tasks').select('id, title, due_at, status').eq('appointment_id', appointmentId),
    supabase.from('appointments').select('id, title, start_at, status').eq('followup_of_appointment_id', appointmentId),
    supabase.from('orders').select('id, product_name, amount, status').eq('appointment_id', appointmentId),
    supabase.from('recommendations').select('id, product_name, status, cancelled_at').eq('appointment_id', appointmentId),
  ])
  if (followups.error) throw new Error(followups.error.message)
  if (tasks.error) throw new Error(tasks.error.message)
  if (followupAppts.error) throw new Error(followupAppts.error.message)
  if (orders.error) throw new Error(orders.error.message)
  if (recos.error) throw new Error(recos.error.message)

  return {
    appointmentId,
    clientId: appt.client_id,
    previous: {
      outcome: biz.outcome,
      outcomeDetails: biz.outcome_details,
      outcomeOtherLabel: biz.outcome_other_label,
    },
    previousRevision: biz.outcome_revision,
    linkedFollowups: followups.data ?? [],
    linkedTasks: tasks.data ?? [],
    linkedFollowupAppointments: followupAppts.data ?? [],
    linkedOrders: orders.data ?? [],
    linkedRecommendations: recos.data ?? [],
  }
}

export interface OutcomeRevisionDecision {
  cancelFollowupIds: string[]
  cancelTaskIds: string[]
  cancelRecommendationIds: string[]
  // Les commandes réelles ne sont JAMAIS annulées depuis la révision (§17) — uniquement
  // affichées à titre informatif, toute annulation doit passer par le workflow commande.
}

export interface ReviseAppointmentOutcomeInput {
  userId: string
  appointmentId: string
  clientId: string
  // Concurrence optimiste (§9) : revision lue à l'ouverture du plan, transmise telle quelle.
  expectedRevision: number
  previous: OutcomeSnapshot
  next: OutcomeSnapshot
  reason: OutcomeRevisionReason
  reasonOtherText: string | null
  decision: OutcomeRevisionDecision
  // Choix explicite (§7) — jamais déduit des annulations. true seulement si le praticien a
  // coché « Aucune suite nécessaire » sans action créée ni conservée.
  noFollowupRequired: boolean
  // Nouvelles actions (§6) — mêmes types que la clôture initiale, exécutées par la même
  // fonction (applyOutcomePlanActions), pas de logique dupliquée.
  newActions: AppointmentOutcomeActionPlan
  appointmentTitle: string | null
  appointmentDate: string | null
}

export class OutcomeRevisionConflictError extends Error {
  constructor() {
    super('revision_conflict')
    this.name = 'OutcomeRevisionConflictError'
  }
}

// Service métier dédié — ne détourne jamais completeAppointment() (le RDV reste `completed`,
// seul son résultat change). Toutes les validations précèdent les effets de bord (§19).
// Noyau atomique (résultat + historique + concurrence optimiste) via la fonction Postgres
// revise_appointment_outcome (SECURITY DEFINER, §8-9) ; annulations et nouvelles actions
// restent des étapes idempotentes séparées, rejouables indépendamment du noyau.
export async function reviseAppointmentOutcome(input: ReviseAppointmentOutcomeInput): Promise<number> {
  const {
    userId, appointmentId, clientId, expectedRevision, previous, next,
    reason, reasonOtherText, decision, noFollowupRequired, newActions,
    appointmentTitle, appointmentDate,
  } = input

  if (reason === 'other' && !reasonOtherText?.trim()) {
    throw new Error('reason_other_text_required')
  }

  const { data: newRevision, error } = await supabase.rpc('revise_appointment_outcome', {
    p_appointment_id: appointmentId,
    p_expected_revision: expectedRevision,
    p_next_outcome: next.outcome,
    p_next_details: next.outcomeDetails,
    p_next_other_label: next.outcomeOtherLabel,
    p_no_followup_required: noFollowupRequired,
    p_reason: reason === 'other' ? (reasonOtherText ?? '').trim() : reason,
    p_old_value: serializeOutcomeSnapshot(previous),
    p_new_value: serializeOutcomeSnapshot(next),
    p_appointment_title: appointmentTitle,
    p_appointment_date: appointmentDate,
  })
  if (error) {
    if (error.message?.includes('revision_conflict')) throw new OutcomeRevisionConflictError()
    throw new Error(error.message)
  }

  // Annulations : uniquement les actions futures et non terminées explicitement choisies —
  // jamais une action déjà réalisée, jamais une commande réelle (§17).
  await Promise.all([
    ...decision.cancelFollowupIds.map(id => cancelFollowup(id)),
    ...decision.cancelTaskIds.map(id => cancelTask(id)),
    ...decision.cancelRecommendationIds.map(id => cancelRecommendation(id)),
  ])

  // Nouvelles actions adaptées au nouveau résultat (§6) — clé d'idempotence dérivée de la
  // révision effective renvoyée par le noyau atomique, jamais réutilisée d'une révision à l'autre.
  await applyOutcomePlanActions(userId, appointmentId, clientId, newActions, `${appointmentId}:revision:${newRevision}`)

  return newRevision as number
}
