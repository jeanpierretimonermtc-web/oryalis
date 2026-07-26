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
  commercial_intent: CommercialIntent | null
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
    commercial_intent?: CommercialIntent
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
  commercial_intent?: CommercialIntent
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

export interface CompleteAppointmentResult {
  appointment: Appointment
  transitioned: boolean
  alreadyCompleted: boolean
}
