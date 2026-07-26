import { supabase } from '@/shared/lib/supabase'
import { triggerAppointmentCompleted } from '@/features/automations/automationService'
import {
  AppointmentCompletionError,
  PostCompletionRetryError,
  type Appointment,
  type AppointmentFull,
  type AppointmentTask,
  type AppointmentFilters,
  type CreateAppointmentPayload,
  type UpdateAppointmentPayload,
  type UpdateAppointmentNotesPayload,
  type UpdateBusinessContextPayload,
  type CreateTaskPayload,
  type CompleteAppointmentResult,
  type PostCompletionResult,
  type PostCompletionWarningCode,
} from './appointmentTypes'

const APPT_COLS = 'id, user_id, client_id, title, appointment_type, status, start_at, end_at, duration_minutes, timezone, location, meeting_url, provider, cancelled_at, cancellation_reason, created_at, updated_at'

export async function fetchAppointments(filters: AppointmentFilters = {}): Promise<Appointment[]> {
  let query = supabase
    .from('appointments')
    .select(APPT_COLS)
    .order('start_at', { ascending: true })

  if (filters.from)             query = query.gte('start_at', filters.from)
  if (filters.to)               query = query.lte('start_at', filters.to)
  if (filters.client_id)        query = query.eq('client_id', filters.client_id)
  if (filters.status)           query = query.eq('status', filters.status)
  if (filters.appointment_type) query = query.eq('appointment_type', filters.appointment_type)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function fetchAppointmentById(id: string): Promise<AppointmentFull | null> {
  const { data: appt, error: apptError } = await supabase
    .from('appointments')
    .select(APPT_COLS)
    .eq('id', id)
    .single()

  if (apptError) throw new Error(apptError.message)
  if (!appt) return null

  const [notesRes, bizRes, tasksRes, attendeesRes, clientPipelineRes] = await Promise.all([
    supabase.from('appointment_notes')
      .select('id, appointment_id, client_notes, internal_notes, objections, needs_identified, products_discussed, created_at, updated_at')
      .eq('appointment_id', id).maybeSingle(),
    supabase.from('appointment_business_context')
      .select('id, appointment_id, brand_id, catalog_id, main_product_id, pipeline_stage, prospect_temperature, commercial_intent, estimated_value, currency, created_at, updated_at')
      .eq('appointment_id', id).maybeSingle(),
    supabase.from('appointment_tasks')
      .select('id, appointment_id, user_id, client_id, title, task_type, priority, status, due_at, completed_at, created_at, updated_at')
      .eq('appointment_id', id).order('due_at', { ascending: true }),
    supabase.from('appointment_attendees')
      .select('id, appointment_id, client_id, external_name, external_email, status, created_at')
      .eq('appointment_id', id),
    appt.client_id
      ? supabase.from('clients').select('pipeline_stage').eq('id', appt.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (notesRes.error)     throw new Error(notesRes.error.message)
  if (bizRes.error)       throw new Error(bizRes.error.message)
  if (tasksRes.error)     throw new Error(tasksRes.error.message)
  if (attendeesRes.error) throw new Error(attendeesRes.error.message)
  if (clientPipelineRes.error) throw new Error(clientPipelineRes.error.message)

  const currentPipeline = clientPipelineRes.data?.pipeline_stage ?? null
  const businessContext = currentPipeline
    ? {
        ...(bizRes.data ?? {
          id: '', appointment_id: id, brand_id: null, catalog_id: null, main_product_id: null,
          prospect_temperature: null, commercial_intent: null, estimated_value: null,
          currency: 'EUR', created_at: '', updated_at: '',
        }),
        pipeline_stage: currentPipeline,
      }
    : (bizRes.data ?? null)

  return {
    ...appt,
    notes: notesRes.data ?? null,
    business_context: businessContext,
    tasks: tasksRes.data ?? [],
    attendees: attendeesRes.data ?? [],
  }
}

export async function createAppointment(payload: CreateAppointmentPayload): Promise<Appointment> {
  const { notes, business_context, ...apptFields } = payload

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: appt, error: apptError } = await supabase
    .from('appointments')
    .insert({ ...apptFields, user_id: user.id })
    .select(APPT_COLS)
    .single()

  if (apptError) throw new Error(apptError.message)

  if (notes && Object.values(notes).some(Boolean)) {
    const { error } = await supabase.from('appointment_notes').insert({ appointment_id: appt.id, ...notes })
    if (error) throw new Error(error.message)
  }

  if (business_context && Object.values(business_context).some(v => v !== undefined)) {
    const { error } = await supabase.from('appointment_business_context').insert({ appointment_id: appt.id, ...business_context })
    if (error) throw new Error(error.message)
  }

  return appt
}

export async function updateAppointment(id: string, payload: UpdateAppointmentPayload): Promise<Appointment> {
  if (payload.status === 'completed') {
    throw new Error('Use completeAppointment() to transition an appointment to completed.')
  }

  const { data, error } = await supabase
    .from('appointments')
    .update(payload)
    .eq('id', id)
    .select(APPT_COLS)
    .single()

  if (error) throw new Error(error.message)

  return data
}

// Seul chemin métier public pour passer un rendez-vous à l'état "completed".
// La transition est conditionnelle (WHERE status IN ('scheduled','rescheduled')) : sous
// concurrence, Postgres verrouille la ligne et une seule requête peut réellement
// transitionner ; les effets post-complétion ne sont donc déclenchés qu'une fois, même en
// cas de double appel rapproché (double-clic, appel depuis deux écrans, etc.).
// 'rescheduled' est traité comme un RDV actif à honorer (même ligne déplacée à une nouvelle
// date, cf. nextActionService.postponeNextAction et les requêtes d'agenda qui le groupent
// systématiquement avec 'scheduled') — donc complétable au même titre.
// 'cancelled' et 'no_show' sont explicitement exclus : voir AppointmentCompletionError.
export async function completeAppointment(id: string): Promise<CompleteAppointmentResult> {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['scheduled', 'rescheduled'])
    .select(APPT_COLS)
    .maybeSingle()

  if (error) throw new Error(error.message)

  if (data) {
    let postCompletion: PostCompletionResult = { success: true, warnings: [] }
    if (data.client_id) {
      try {
        postCompletion = await ensurePostCompletionActions(id, data.client_id, data.user_id)
      } catch (e) {
        console.error('[completeAppointment.postCompletion]', e)
        postCompletion = { success: false, warnings: ['automation_failed'] }
      }
    }
    return { appointment: data, transitioned: true, alreadyCompleted: false, postCompletion }
  }

  // Rien n'a été transitionné : soit déjà completed, soit cancelled/no_show, soit id inconnu.
  const { data: existing, error: fetchError } = await supabase
    .from('appointments')
    .select(APPT_COLS)
    .eq('id', id)
    .single()

  if (fetchError) throw new Error(fetchError.message)

  if (existing.status === 'completed') {
    return { appointment: existing, transitioned: false, alreadyCompleted: true, postCompletion: { success: true, warnings: [] } }
  }

  if (existing.status === 'cancelled') throw new AppointmentCompletionError('cannot_complete_cancelled')
  if (existing.status === 'no_show')   throw new AppointmentCompletionError('cannot_complete_no_show')

  throw new Error(`Cannot complete appointment with status "${existing.status}".`)
}

// Rejeu idempotent des effets post-complétion : ne recrée que ce qui manque, retourne des
// codes d'avertissement exploitables par l'UI (jamais de texte traduit ici). Appelable à la
// fois juste après la première transition et lors d'un nouvel essai explicite après échec
// partiel — jamais lancée automatiquement à chaque simple consultation d'un RDV completed.
export async function ensurePostCompletionActions(
  appointmentId: string,
  clientId: string,
  userId: string,
): Promise<PostCompletionResult> {
  const warnings: PostCompletionWarningCode[] = []

  const [bizRes, notesRes, existingRes] = await Promise.all([
    supabase
      .from('appointment_business_context')
      .select('commercial_intent, prospect_temperature, pipeline_stage')
      .eq('appointment_id', appointmentId)
      .maybeSingle(),
    supabase
      .from('appointment_notes')
      .select('objections, products_discussed')
      .eq('appointment_id', appointmentId)
      .maybeSingle(),
    supabase
      .from('followups')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('auto_generated', true)
      .eq('done', false),
  ])

  const biz   = bizRes.data
  const notes = notesRes.data
  const hasExistingAuto = (existingRes.count ?? 0) > 0

  function dueDate(daysFromNow: number): string {
    const d = new Date()
    d.setDate(d.getDate() + daysFromNow)
    return d.toISOString().split('T')[0]
  }

  // Create followup if no pending auto followup exists for this client
  if (biz && !hasExistingAuto) {
    try {
      if (biz.commercial_intent === 'buy_product') {
        const { error } = await supabase.from('followups').insert({
          client_id:            clientId,
          user_id:              userId,
          title:                'Relance suite RDV — achat produit',
          due_date:             dueDate(3),
          done:                 false,
          auto_generated:       true,
          prospect_temperature: biz.prospect_temperature ?? null,
          pipeline_stage:       biz.pipeline_stage ?? null,
          product_context:      notes?.products_discussed ?? null,
        })
        if (error) throw error
      } else if (biz.commercial_intent === 'become_distributor') {
        const { error } = await supabase.from('followups').insert({
          client_id:            clientId,
          user_id:              userId,
          title:                'Relance suite RDV — recrutement distributeur',
          due_date:             dueDate(2),
          done:                 false,
          auto_generated:       true,
          prospect_temperature: biz.prospect_temperature ?? null,
          pipeline_stage:       biz.pipeline_stage ?? null,
          product_context:      null,
        })
        if (error) throw error
      }
    } catch (e) {
      console.error('[ensurePostCompletionActions.followup]', e)
      warnings.push('followup_failed')
    }
  }

  // Create objection task regardless of existing followups — idempotent : ne recrée pas
  // de tâche si une tâche "follow_up" ouverte (pending/in_progress) existe déjà pour ce RDV.
  // Limite connue : task_type='follow_up' n'est pas un identifiant dédié aux objections
  // (appointment_tasks n'a pas de colonne auto_generated comme followups) — une tâche
  // "follow_up" créée manuellement par le praticien sur ce même RDV serait aussi détectée
  // et empêcherait la création automatique. Voir rapport de phase pour la migration future
  // recommandée (colonne auto_generated ou task_type dédié).
  if (notes?.objections?.trim()) {
    try {
      const { count: openFollowUpCount } = await supabase
        .from('appointment_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('appointment_id', appointmentId)
        .eq('task_type', 'follow_up')
        .in('status', ['pending', 'in_progress'])

      if (!openFollowUpCount) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { error } = await supabase.from('appointment_tasks').insert({
            appointment_id: appointmentId,
            client_id:      clientId,
            user_id:        user.id,
            title:          'Répondre aux objections détectées',
            task_type:      'follow_up',
            priority:       'high',
            status:         'pending',
            due_at:         new Date(Date.now() + 86400000).toISOString(),
          })
          if (error) throw error
        }
      }
    } catch (e) {
      console.error('[ensurePostCompletionActions.objectionTask]', e)
      warnings.push('objection_task_failed')
    }
  }

  // Automation : relance générique J+7 après tout RDV complété
  try {
    const { data: clientData, error: clientError } = await supabase
      .from('clients')
      .select('first_name, full_name')
      .eq('id', clientId)
      .single()
    if (clientError) throw clientError
    if (clientData) {
      const prénom = clientData.first_name || clientData.full_name.split(' ')[0]
      await triggerAppointmentCompleted(userId, clientId, prénom)
    }
  } catch (e) {
    console.error('[ensurePostCompletionActions.automation]', e)
    warnings.push('automation_failed')
  }

  return { success: warnings.length === 0, warnings }
}

// Seule API publique pour rejouer les effets post-complétion (ex. après un échec partiel).
// Impose l'invariant "completed" au niveau service — jamais uniquement côté UI — en relisant
// le statut réel depuis la base plutôt que de faire confiance à un état local potentiellement
// périmé. ensurePostCompletionActions() reste utilisable en interne (par completeAppointment)
// mais toute nouvelle tentative de rejeu doit obligatoirement passer par cette fonction.
export async function retryPostCompletionActions(appointmentId: string): Promise<PostCompletionResult> {
  const { data, error } = await supabase
    .from('appointments')
    .select('status, client_id, user_id')
    .eq('id', appointmentId)
    .single()

  if (error) throw new PostCompletionRetryError('not_found')
  if (data.status !== 'completed') throw new PostCompletionRetryError('not_completed')
  if (!data.client_id) return { success: true, warnings: [] }

  return ensurePostCompletionActions(appointmentId, data.client_id, data.user_id)
}

export async function cancelAppointment(id: string, reason?: string): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: reason ?? null })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function deleteAppointment(id: string): Promise<void> {
  const { error } = await supabase.from('appointments').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function upsertAppointmentNotes(appointmentId: string, payload: UpdateAppointmentNotesPayload): Promise<void> {
  const { error } = await supabase
    .from('appointment_notes')
    .upsert({ appointment_id: appointmentId, ...payload }, { onConflict: 'appointment_id' })

  if (error) throw new Error(error.message)
}

export async function upsertBusinessContext(appointmentId: string, payload: UpdateBusinessContextPayload): Promise<void> {
  const { error } = await supabase
    .from('appointment_business_context')
    .upsert({ appointment_id: appointmentId, ...payload }, { onConflict: 'appointment_id' })

  if (error) throw new Error(error.message)
}

export async function fetchTasksByUser(): Promise<AppointmentTask[]> {
  const { data, error } = await supabase
    .from('appointment_tasks')
    .select('id, appointment_id, user_id, client_id, title, task_type, priority, status, due_at, completed_at, created_at, updated_at')
    .neq('status', 'cancelled')
    .order('due_at', { ascending: true })

  if (error) throw new Error(error.message)
  return data ?? []
}

export async function createTask(payload: CreateTaskPayload): Promise<AppointmentTask> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('appointment_tasks')
    .insert({ ...payload, user_id: user.id })
    .select('id, appointment_id, user_id, client_id, title, task_type, priority, status, due_at, completed_at, created_at, updated_at')
    .single()

  if (error) throw new Error(error.message)
  return data
}

export async function completeTask(id: string): Promise<void> {
  const { error } = await supabase
    .from('appointment_tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('appointment_tasks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
