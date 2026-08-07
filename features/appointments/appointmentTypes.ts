export type AppointmentType =
  | 'discovery_call'
  | 'product_presentation'
  | 'follow_up'
  | 'closing_call'
  | 'customer_support'
  | 'team_training'
  | 'team_meeting'
  | 'webinar'
  | 'onboarding'
  | 'business_review'
  | 'other'

export type AppointmentStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled'

export type { PipelineStage } from '@/shared/lib/types'
import type { PipelineStage, NextActionType } from '@/shared/lib/types'

export type ProspectTemperature = 'cold' | 'warm' | 'hot' | 'very_hot'

export type CommercialIntent =
  | 'buy_product'
  | 'become_customer'
  | 'become_distributor'
  | 'build_team'
  | 'training'
  | 'support'
  | 'other'

// Verdict de clôture d'un RDV — distinct du statut logistique (AppointmentStatus) et de
// l'étape pipeline (qui reste une donnée en continu au niveau du contact). Renseigné
// uniquement au moment du débrief, jamais réédité rétroactivement après coup. Obligatoire
// pour toute transition vers 'completed' (Lot 1.1) — voir contrainte CHECK en base
// (appointment_business_context_outcome_check, migration 20260804_appointment_closure_guards).
export type AppointmentOutcome =
  | 'sale_completed'
  | 'interested'
  | 'follow_up_required'
  | 'not_interested'
  | 'partner_potential'
  | 'partner_recruited'
  | 'other'

// Lot 1.2 — 'follow_up_required' reste un résultat VALIDE en base (contrainte CHECK
// inchangée, données historiques réelles) mais n'est plus un choix actif : "à relancer"
// est désormais une prochaine action, pas un résultat (Principe 1). N'apparaît plus dans
// OUTCOME_PILLS ; affiché en lecture seule avec un libellé "historique" sur les anciens RDV.
export const ACTIVE_OUTCOMES: AppointmentOutcome[] = [
  'sale_completed', 'interested', 'not_interested', 'partner_potential', 'partner_recruited', 'other',
]
export const DEPRECATED_OUTCOMES: AppointmentOutcome[] = ['follow_up_required']

// ── Détails conditionnels du résultat (Lot 1.2) ─────────────────────────────────
// Union discriminée par `kind` (toujours égal à l'outcome actif) — jamais de détails d'un
// ancien résultat qui restent actifs une fois le résultat changé (voir reviseAppointmentOutcome).

export type OutcomeInterestKind =
  | 'product' | 'product_range' | 'offer' | 'subscription' | 'sample' | 'business_opportunity' | 'other'

export type NotInterestedReason =
  | 'price' | 'bad_timing' | 'no_need' | 'not_a_fit' | 'lack_of_trust' | 'already_equipped' | 'mlm_opposition' | 'other'

export interface OutcomeSaleProduct {
  productId?: string
  catalogId?: string
  label: string
  quantity: number
  variant?: string
  amount?: number
  note?: string
}

export interface SaleCompletedDetails {
  kind: 'sale_completed'
  products: OutcomeSaleProduct[]
}

export interface InterestedDetails {
  kind: 'interested'
  interests: OutcomeInterestKind[]
  freeText?: string
  comment?: string
}

export interface NotInterestedDetails {
  kind: 'not_interested'
  reason?: NotInterestedReason
  reasonOtherText?: string
  canBeRecontacted: boolean
}

export interface PartnerPotentialDetails {
  kind: 'partner_potential'
  interestArea?: string
  motivation?: string
  objective?: string
  availability?: string
  mainObjection?: string
  comment?: string
}

export interface PartnerRecruitedDetails {
  kind: 'partner_recruited'
  startDate?: string
  initialObjective?: string
  mainNeed?: string
  comment?: string
}

export interface OtherOutcomeDetails {
  kind: 'other'
}

export type AppointmentOutcomeDetails =
  | SaleCompletedDetails
  | InterestedDetails
  | NotInterestedDetails
  | PartnerPotentialDetails
  | PartnerRecruitedDetails
  | OtherOutcomeDetails

// Motif obligatoire pour réviser un résultat déjà clôturé (Lot 1.2, §15).
export type OutcomeRevisionReason =
  | 'client_changed_mind' | 'data_entry_error' | 'order_confirmed_after' | 'order_cancelled' | 'other'

// Lot 1.2.1 §3 — plan unique des actions liées à un résultat (clôture ou révision), enrichi
// uniquement à l'état de brouillon local et validé côté service avant tout effet de bord.
// Utilisé identiquement par la clôture et la révision — pas de seconde implémentation.
export interface AppointmentOutcomeSaleOrderPlan {
  products: OutcomeSaleProduct[]
}
export interface AppointmentOutcomeRecommendationPlan {
  productName: string
  reason: string | null
}
export interface AppointmentOutcomePersonalFollowupPlan {
  actionType: NextActionType
  title: string
  dueDate: string
  comment: string | null
}
export interface AppointmentOutcomeActionPlan {
  saleOrder: AppointmentOutcomeSaleOrderPlan | null
  recommendation: AppointmentOutcomeRecommendationPlan | null
  personalFollowup: AppointmentOutcomePersonalFollowupPlan | null
  linkExistingAppointmentId: string | null
}

export type TaskType =
  | 'follow_up'
  | 'send_catalog'
  | 'send_price_list'
  | 'send_sample'
  | 'invite_to_webinar'
  | 'invite_to_training'
  | 'send_payment_link'
  | 'customer_checkin'
  | 'team_followup'
  | 'ask_referral'
  | 'other'

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled'

export interface Appointment {
  id: string
  user_id: string
  client_id: string | null
  title: string
  appointment_type: AppointmentType
  status: AppointmentStatus
  start_at: string
  end_at: string
  duration_minutes: number
  timezone: string
  location: string | null
  meeting_url: string | null
  provider: string
  cancelled_at: string | null
  cancellation_reason: string | null
  // Lot 1.2 — RDV créé comme suite explicite d'un autre RDV (jamais déduit par date/titre).
  followup_of_appointment_id: string | null
  created_at: string
  updated_at: string
}

export interface AppointmentNote {
  id: string
  appointment_id: string
  client_notes: string | null
  internal_notes: string | null
  objections: string | null
  needs_identified: string | null
  products_discussed: string | null
  created_at: string
  updated_at: string
}

export interface AppointmentBusinessContext {
  id: string
  appointment_id: string
  brand_id: string | null
  catalog_id: string | null
  main_product_id: string | null
  pipeline_stage: PipelineStage
  prospect_temperature: ProspectTemperature | null
  commercial_intent: CommercialIntent[] | null
  estimated_value: number | null
  currency: string
  outcome: AppointmentOutcome | null
  // Décision explicite et persistée (jamais activée automatiquement) : distingue "aucune
  // suite programmée par oubli" de "l'utilisateur a confirmé qu'aucune suite n'était utile".
  no_followup_required: boolean
  // Lot 1.2 — détails conditionnels du résultat actif, révision.
  outcome_details: AppointmentOutcomeDetails | null
  outcome_other_label: string | null
  outcome_revision: number
  created_at: string
  updated_at: string
}

export interface AppointmentTask {
  id: string
  appointment_id: string | null
  user_id: string
  client_id: string | null
  title: string
  task_type: TaskType
  priority: TaskPriority
  status: TaskStatus
  due_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface AppointmentAttendee {
  id: string
  appointment_id: string
  client_id: string | null
  external_name: string | null
  external_email: string | null
  status: 'invited' | 'accepted' | 'declined' | 'no_show'
  created_at: string
}

export interface AppointmentFull extends Appointment {
  notes: AppointmentNote | null
  business_context: AppointmentBusinessContext | null
  tasks: AppointmentTask[]
  attendees: AppointmentAttendee[]
}

// Variante légère pour les listes (ex. onglet RDV de la fiche client) : juste de quoi
// afficher un résumé du contexte commercial, sans les notes ni les tâches.
export interface AppointmentWithContext extends Appointment {
  business_context: Pick<AppointmentBusinessContext, 'pipeline_stage' | 'prospect_temperature' | 'commercial_intent'> | null
}

export interface CreateAppointmentPayload {
  client_id?: string
  title: string
  appointment_type: AppointmentType
  start_at: string
  end_at: string
  timezone?: string
  location?: string
  meeting_url?: string
  // Lot 1.2 — RDV créé comme suite explicite d'un autre RDV.
  followup_of_appointment_id?: string
  notes?: {
    client_notes?: string
    internal_notes?: string
    objections?: string
    needs_identified?: string
    products_discussed?: string
  }
  business_context?: {
    brand_id?: string
    catalog_id?: string
    main_product_id?: string
    pipeline_stage?: PipelineStage
    prospect_temperature?: ProspectTemperature
    commercial_intent?: CommercialIntent[]
    estimated_value?: number
    currency?: string
  }
}

export interface UpdateAppointmentPayload {
  title?: string
  appointment_type?: AppointmentType
  status?: AppointmentStatus
  start_at?: string
  end_at?: string
  timezone?: string
  location?: string
  meeting_url?: string
  cancelled_at?: string
  cancellation_reason?: string
  // Rattachement d'un contact à un RDV existant (créé initialement sans contact) — voir
  // clients/new.tsx?returnToAppointmentId=… (Lot 1.1).
  client_id?: string
  // Lot 1.2 — lie un RDV (nouveau ou déjà existant) comme suite d'un autre RDV.
  followup_of_appointment_id?: string
}

export interface UpdateAppointmentNotesPayload {
  client_notes?: string
  internal_notes?: string
  objections?: string
  needs_identified?: string
  products_discussed?: string
}

export interface UpdateBusinessContextPayload {
  brand_id?: string
  catalog_id?: string
  main_product_id?: string
  pipeline_stage?: PipelineStage
  prospect_temperature?: ProspectTemperature
  commercial_intent?: CommercialIntent[]
  estimated_value?: number
  currency?: string
  outcome?: AppointmentOutcome
  no_followup_required?: boolean
  outcome_details?: AppointmentOutcomeDetails | null
  outcome_other_label?: string | null
}

export interface CreateTaskPayload {
  appointment_id?: string
  client_id?: string
  title: string
  task_type: TaskType
  priority?: TaskPriority
  due_at?: string
}

export interface AppointmentFilters {
  from?: string
  to?: string
  client_id?: string
  status?: AppointmentStatus
  appointment_type?: AppointmentType
}

// Codes exploitables par l'UI (jamais de texte traduit dans le service).
export type PostCompletionWarningCode = 'followup_failed' | 'objection_task_failed' | 'automation_failed'

export interface PostCompletionResult {
  success: boolean
  warnings: PostCompletionWarningCode[]
}

export interface CompleteAppointmentResult {
  appointment: Appointment
  transitioned: boolean
  alreadyCompleted: boolean
  postCompletion: PostCompletionResult
}

// Rejet métier contrôlé — un RDV cancelled ou no_show ne peut jamais devenir completed.
export type AppointmentCompletionErrorCode =
  | 'cannot_complete_cancelled'
  | 'cannot_complete_no_show'
  | 'outcome_required'
  | 'next_step_decision_required'

// Décision explicite requise par completeAppointment() — imposée côté service, pas
// seulement côté UI (Lot 1.1). Un appel sans cet argument échoue à la compilation
// TypeScript ; un appel avec une valeur non booléenne échoue au runtime.
export interface AppointmentClosureDecision {
  noFollowupRequired: boolean
}

export class AppointmentCompletionError extends Error {
  code: AppointmentCompletionErrorCode
  constructor(code: AppointmentCompletionErrorCode) {
    super(`Cannot complete appointment: ${code}`)
    this.name = 'AppointmentCompletionError'
    this.code = code
  }
}

// Choix utilisateur des relances à créer lors du débrief (facultatif — si absent,
// ensurePostCompletionActions retombe sur la dérivation automatique historique).
export type PostCompletionPlanKey = 'buy_product' | 'become_distributor' | 'objection_task'

export interface PostCompletionPlanItem {
  key: PostCompletionPlanKey
  create: boolean
  delayDays: number
}

export type PostCompletionPlan = PostCompletionPlanItem[]

// Rejet métier contrôlé — le rejeu des actions post-complétion n'est autorisé que pour un
// rendez-vous déjà completed (garde imposée au niveau service, pas seulement dans l'UI).
export type PostCompletionRetryErrorCode = 'not_completed' | 'not_found'

export class PostCompletionRetryError extends Error {
  code: PostCompletionRetryErrorCode
  constructor(code: PostCompletionRetryErrorCode) {
    super(`Cannot retry post-completion actions: ${code}`)
    this.name = 'PostCompletionRetryError'
    this.code = code
  }
}
