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
import type { PipelineStage } from '@/shared/lib/types'

export type ProspectTemperature = 'cold' | 'warm' | 'hot' | 'very_hot'

export type CommercialIntent =
  | 'buy_product'
  | 'become_customer'
  | 'become_distributor'
  | 'build_team'
  | 'training'
  | 'support'
  | 'other'

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
export type AppointmentCompletionErrorCode = 'cannot_complete_cancelled' | 'cannot_complete_no_show'

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
