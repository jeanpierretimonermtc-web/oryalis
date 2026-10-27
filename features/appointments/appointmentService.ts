import { supabase } from '@/shared/lib/supabase'
import { logClientEvent } from '@/features/clients/clientEventService'
import {
  AppointmentCompletionError,
  PostCompletionRetryError,
  type AppointmentClosureDecision,
  type Appointment,
  type AppointmentFull,
  type AppointmentWithContext,
  type CalendarAppointment,
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
  type PostCompletionPlan,
  type PostCompletionPlanKey,
  type DiscussedProduct,
} from './appointmentTypes'

const APPT_COLS = 'id, user_id, client_id, title, appointment_type, status, start_at, end_at, duration_minutes, timezone, location, meeting_url, provider, cancelled_at, cancellation_reason, followup_of_appointment_id, created_at, updated_at'

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

// RDV déjà planifiés (tous contacts confondus) sur une fenêtre donnée — pour afficher la
// charge du calendrier avant de fixer une nouvelle date (CalendarPickerModal).
export async function fetchBusyAppointments(from: string, to: string) {
  const { data, error } = await supabase
    .from('appointments')
    .select('start_at, end_at, title')
    .in('status', ['scheduled', 'rescheduled'])
    .gte('start_at', from)
    .lte('start_at', to)
  if (error) throw new Error(error.message)
  return data ?? []
}

// ACTION-3.5 — un seul appel groupé par utilisateur (jamais un par contact), pour permettre au
// filtre Contacts → À traiter → RDV de savoir quels contacts ont un RDV actif, sans N+1.
// Distincte de fetchAppointments (status scalaire uniquement, pas de .in()) et de
// fetchBusyAppointments (pas de filtre user_id, pensée pour un calendrier partagé) — un besoin
// différent, pas une redondance.
export async function fetchActiveAppointmentsByUser(userId: string): Promise<{ id: string; client_id: string | null; start_at: string }[]> {
  const { data, error } = await supabase
    .from('appointments')
    // CONTACTS-3.6 — id ajouté (même requête) : nécessaire pour cibler la ressource exacte
    // depuis "Tous types" déplié (navigation RDV, pas de nouvelle route).
    .select('id, client_id, start_at')
    .eq('user_id', userId)
    .in('status', ['scheduled', 'rescheduled'])
  if (error) throw new Error(error.message)
  return data ?? []
}

// contact_role ajouté (CAL-4.5) à la jointure clients déjà existante — même requête, mêmes
// deux fonctions (fetchCalendarAppointments/fetchNextAppointment la partagent déjà), aucun
// fetch supplémentaire. Permet au calendrier de réutiliser la couleur de rôle Contacts
// (getPrimaryRole/getRoleColors) au lieu d'une couleur propre au type de RDV.
// DASH/CAL-2 — provider ajouté à la même jointure existante (aucun fetch supplémentaire) :
// permet au calendrier de distinguer un RDV Oryalis d'un événement externe importé.
const CALENDAR_COLS = 'id, user_id, client_id, title, appointment_type, status, start_at, end_at, provider, client:clients(id, full_name, status, contact_role)'

// RDV d'une plage [rangeStart, rangeEnd[ (borne haute exclusive), avec jointure client
// minimale pour l'affichage calendrier (Mois/Semaine/Jour). Distincte de fetchAppointments :
// celle-ci filtre from/to en bornes inclusives (lte) et ne fait pas la jointure client — un
// besoin différent, pas une redondance. La notion month/week/day reste une responsabilité de
// l'écran/hook appelant, pas de cette fonction.
// userId : filtre explicite conservé du fetchRange() d'origine (CAL-2.1) — l'ancien code
// écran filtrait déjà .eq('user_id', session.user.id) avant CAL-2 ; RLS reste la protection
// de sécurité côté base, ce filtre applicatif est un comportement préexistant à préserver,
// pas une nouvelle vérification de sécurité.
export async function fetchCalendarAppointments(rangeStart: string, rangeEnd: string, userId: string): Promise<CalendarAppointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(CALENDAR_COLS)
    .eq('user_id', userId)
    .gte('start_at', rangeStart)
    .lt('start_at', rangeEnd)
    .order('start_at', { ascending: true })

  if (error) throw new Error(error.message)
  // La jointure clients(...) est inférée en tableau par le client Supabase (relation à N
  // côté générateur de types), alors qu'il s'agit d'une relation à 1 (client_id est une FK
  // simple) — cast déjà utilisé tel quel par l'ancien code écran avant ce refactor.
  return (data ?? []) as unknown as CalendarAppointment[]
}

// Prochain RDV à venir, indépendamment de toute période affichée (ex. bandeau "Prochain RDV"
// du calendrier) — jamais fusionnée avec fetchCalendarAppointments : responsabilité distincte
// (chercher le prochain RDV global, pas les RDV d'une plage donnée).
// userId : voir commentaire de fetchCalendarAppointments — même filtre préexistant restauré.
export async function fetchNextAppointment(userId: string): Promise<CalendarAppointment | null> {
  const { data, error } = await supabase
    .from('appointments')
    .select(CALENDAR_COLS)
    .eq('user_id', userId)
    // DASH/CAL-2 — la bannière "Prochain RDV" est un repère commercial (pas juste un
    // affichage calendrier) : un événement personnel/externe ne doit jamais s'y substituer.
    .eq('provider', 'oryalis')
    .gte('start_at', new Date().toISOString())
    .in('status', ['scheduled', 'rescheduled'])
    .order('start_at', { ascending: true })
    .limit(1)

  if (error) throw new Error(error.message)
  return ((data ?? [])[0] as unknown as CalendarAppointment) ?? null
}

// Variante enrichie pour les listes qui doivent afficher un résumé du contexte commercial
// (pipeline, température, intention) sans faire un aller-retour par RDV — une seule requête
// supplémentaire, filtrée par les ids déjà chargés.
export async function fetchAppointmentsWithContext(filters: AppointmentFilters = {}): Promise<AppointmentWithContext[]> {
  const appointments = await fetchAppointments(filters)
  if (appointments.length === 0) return []

  const { data: contexts, error } = await supabase
    .from('appointment_business_context')
    .select('appointment_id, pipeline_stage, prospect_temperature, commercial_intent')
    .in('appointment_id', appointments.map(a => a.id))

  if (error) throw new Error(error.message)

  const byApptId = new Map((contexts ?? []).map(c => [c.appointment_id, c]))
  return appointments.map(appt => ({ ...appt, business_context: byApptId.get(appt.id) ?? null }))
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
      .select('id, appointment_id, brand_id, catalog_id, main_product_id, pipeline_stage, prospect_temperature, commercial_intent, commercial_intent_other_label, estimated_value, currency, outcome, no_followup_required, outcome_details, outcome_other_label, outcome_revision, discussed_products, other_outcomes, created_at, updated_at')
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
          prospect_temperature: null, commercial_intent: null, commercial_intent_other_label: null,
          estimated_value: null, currency: 'EUR', outcome: null, no_followup_required: false,
          outcome_details: null, outcome_other_label: null, outcome_revision: 1,
          discussed_products: [], other_outcomes: [], created_at: '', updated_at: '',
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
// date, cf. nextActionService.rescheduleNextAction et les requêtes d'agenda qui le groupent
// systématiquement avec 'scheduled') — donc complétable au même titre.
// 'cancelled' et 'no_show' sont explicitement exclus : voir AppointmentCompletionError.
//
// Lot 1.1 — deux garde-fous imposés ICI, pas seulement côté UI (un appel direct au service
// sans ces conditions doit échouer AVANT toute écriture) :
//  1. `outcome` doit déjà être renseigné sur appointment_business_context (relu depuis la
//     base, jamais fait confiance à un état local potentiellement périmé).
//  2. `closure.noFollowupRequired` est un paramètre obligatoire (pas optionnel) : son
//     absence structurelle empêche déjà tout appel qui l'omettrait de compiler. Le service
//     ne peut pas vérifier indépendamment qu'une relance/un prochain RDV existe réellement
//     pour CE rendez-vous (les relances/RDV n'ont pas encore de colonne appointment_id —
//     lien qui relève du Lot 3/4, hors périmètre) ; la garantie ici est donc « une décision a
//     été explicitement communiquée au service », pas une vérification croisée en base.
export async function completeAppointment(
  id: string,
  closure: AppointmentClosureDecision,
  plan?: PostCompletionPlan,
): Promise<CompleteAppointmentResult> {
  if (typeof closure?.noFollowupRequired !== 'boolean') {
    throw new AppointmentCompletionError('next_step_decision_required')
  }

  const { data: biz, error: bizError } = await supabase
    .from('appointment_business_context')
    .select('outcome')
    .eq('appointment_id', id)
    .maybeSingle()
  if (bizError) throw new Error(bizError.message)
  if (!biz?.outcome) throw new AppointmentCompletionError('outcome_required')

  const { error: closureError } = await supabase
    .from('appointment_business_context')
    .update({ no_followup_required: closure.noFollowupRequired })
    .eq('appointment_id', id)
  if (closureError) throw new Error(closureError.message)

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
        postCompletion = await ensurePostCompletionActions(id, data.client_id, data.user_id, plan)
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

// FOLLOWUP-PRODUCT-CONTEXT-2 — texte lisible pour followups.product_context, à partir des
// produits structurés du RDV (discussed_products). Volontairement local et minimal (un seul
// appelant, ensurePostCompletionActions ci-dessous) plutôt qu'un helper partagé avec
// recapProducts.ts : format différent (une ligne, virgules, jamais de prix — le contexte d'une
// relance n'est pas une proposition commerciale) et un seul site d'usage ne justifie pas une
// abstraction supplémentaire. Utilise `label` (snapshot déjà figé au moment du RDV), jamais une
// jointure catalog_products : un renommage/suppression ultérieur du produit catalogue ne doit
// jamais changer le contexte d'une relance déjà créée. Aucun filtre sur `considered` : le
// contexte d'une relance porte sur les produits ABORDÉS pendant le RDV, pas uniquement ceux
// marqués comme opportunité commerciale.
function formatDiscussedProductsAsContext(products: DiscussedProduct[]): string {
  return products
    .map(p => p.quantity > 1 ? `${p.label} ×${p.quantity}` : p.label)
    .join(', ')
}

// Rejeu idempotent des effets post-complétion : ne recrée que ce qui manque, retourne des
// codes d'avertissement exploitables par l'UI (jamais de texte traduit ici). Appelable à la
// fois juste après la première transition et lors d'un nouvel essai explicite après échec
// partiel — jamais lancée automatiquement à chaque simple consultation d'un RDV completed.
export async function ensurePostCompletionActions(
  appointmentId: string,
  clientId: string,
  userId: string,
  plan?: PostCompletionPlan,
): Promise<PostCompletionResult> {
  const warnings: PostCompletionWarningCode[] = []
  const planItem = (key: PostCompletionPlanKey) => plan?.find(p => p.key === key)

  const [bizRes, notesRes, existingRes] = await Promise.all([
    supabase
      .from('appointment_business_context')
      .select('commercial_intent, prospect_temperature, pipeline_stage, discussed_products')
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
      .eq('done', false)
      .is('cancelled_at', null),
  ])

  const biz   = bizRes.data
  const notes = notesRes.data
  const hasExistingAuto = (existingRes.count ?? 0) > 0

  function dueDate(daysFromNow: number): string {
    const d = new Date()
    d.setDate(d.getDate() + daysFromNow)
    return d.toISOString().split('T')[0]
  }

  // Create followups for each commercial intent present — indépendants les uns des autres
  // (un RDV avec plusieurs intentions à la fois, ex. buy_product + become_distributor,
  // déclenche les deux relances). hasExistingAuto reste une garde globale calculée une
  // seule fois en amont (limite connue et préexistante, non corrigée ici) : si le client a
  // déjà une relance auto en attente, aucune des relances ci-dessous n'est créée.
  if (biz && !hasExistingAuto) {
    const intents = biz.commercial_intent ?? []
    // FOLLOWUP-PRODUCT-CONTEXT-2 — discussed_products (structuré) prioritaire ; le texte libre
    // legacy `appointment_notes.products_discussed` ne sert plus que de repli pour les RDV qui
    // n'ont jamais eu de produits structurés (anciens RDV) — jamais les deux combinés, pour ne
    // jamais produire un contexte redondant ou incohérent.
    const discussedProducts: DiscussedProduct[] = biz.discussed_products ?? []
    const productContext = discussedProducts.length > 0
      ? formatDiscussedProductsAsContext(discussedProducts)
      : (notes?.products_discussed ?? null)

    const buyProductItem = planItem('buy_product')
    const shouldCreateBuyProduct = plan ? !!buyProductItem?.create : intents.includes('buy_product')

    if (shouldCreateBuyProduct) {
      try {
        const { error } = await supabase.from('followups').insert({
          client_id:            clientId,
          user_id:              userId,
          title:                'Relance suite RDV — achat produit',
          due_date:             dueDate(buyProductItem?.delayDays ?? 3),
          done:                 false,
          auto_generated:       true,
          prospect_temperature: biz.prospect_temperature ?? null,
          pipeline_stage:       biz.pipeline_stage ?? null,
          product_context:      productContext,
          // Lot 1.2.1 — sans ce lien, cette relance est invisible pour buildOutcomeRevisionPlan
          // (filtre appointment_id) : une révision ne peut alors jamais l'annuler.
          appointment_id:       appointmentId,
        })
        if (error) throw error
      } catch (e) {
        console.error('[ensurePostCompletionActions.followup.buy_product]', e)
        if (!warnings.includes('followup_failed')) warnings.push('followup_failed')
      }
    }

    const distributorItem = planItem('become_distributor')
    const shouldCreateDistributor = plan ? !!distributorItem?.create : intents.includes('become_distributor')

    if (shouldCreateDistributor) {
      try {
        const { error } = await supabase.from('followups').insert({
          client_id:            clientId,
          user_id:              userId,
          title:                'Relance suite RDV — recrutement distributeur',
          due_date:             dueDate(distributorItem?.delayDays ?? 2),
          done:                 false,
          auto_generated:       true,
          prospect_temperature: biz.prospect_temperature ?? null,
          pipeline_stage:       biz.pipeline_stage ?? null,
          product_context:      null,
          appointment_id:       appointmentId,
        })
        if (error) throw error
      } catch (e) {
        console.error('[ensurePostCompletionActions.followup.become_distributor]', e)
        if (!warnings.includes('followup_failed')) warnings.push('followup_failed')
      }
    }
  }

  // Create objection task regardless of existing followups — idempotent : ne recrée pas
  // de tâche si une tâche "follow_up" ouverte (pending/in_progress) existe déjà pour ce RDV.
  // Limite connue : task_type='follow_up' n'est pas un identifiant dédié aux objections
  // (appointment_tasks n'a pas de colonne auto_generated comme followups) — une tâche
  // "follow_up" créée manuellement par le praticien sur ce même RDV serait aussi détectée
  // et empêcherait la création automatique. Voir rapport de phase pour la migration future
  // recommandée (colonne auto_generated ou task_type dédié).
  const objectionItem = planItem('objection_task')
  const shouldCreateObjectionTask = plan ? !!objectionItem?.create : !!notes?.objections?.trim()

  if (shouldCreateObjectionTask) {
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
            title:          'Répondre aux freins exprimés',
            task_type:      'follow_up',
            priority:       'high',
            status:         'pending',
            due_at:         new Date(Date.now() + (objectionItem?.delayDays ?? 1) * 86400000).toISOString(),
          })
          if (error) throw error
        }
      }
    } catch (e) {
      console.error('[ensurePostCompletionActions.objectionTask]', e)
      warnings.push('objection_task_failed')
    }
  }

  // RDV-FOLLOWUP-1/P0 — la relance générique "RDV complété" (règle appt_j7) n'est plus créée
  // ici : elle passe désormais uniquement par le plan "Relance après ce RDV"
  // (personalFollowup/applyOutcomePlanActions), préremplie par défaut à partir de cette même
  // règle mais protégée par closure_action_key (idempotence robuste), contrairement à l'ancien
  // chemin automatique. Les automatismes de commande (applyOrderAutomation) restent inchangés.

  return { success: warnings.length === 0, warnings }
}

// Seule API publique pour rejouer les effets post-complétion (ex. après un échec partiel).
// Impose l'invariant "completed" au niveau service — jamais uniquement côté UI — en relisant
// le statut réel depuis la base plutôt que de faire confiance à un état local potentiellement
// périmé. ensurePostCompletionActions() reste utilisable en interne (par completeAppointment)
// mais toute nouvelle tentative de rejeu doit obligatoirement passer par cette fonction.
export async function retryPostCompletionActions(appointmentId: string, plan?: PostCompletionPlan): Promise<PostCompletionResult> {
  const { data, error } = await supabase
    .from('appointments')
    .select('status, client_id, user_id')
    .eq('id', appointmentId)
    .single()

  if (error) throw new PostCompletionRetryError('not_found')
  if (data.status !== 'completed') throw new PostCompletionRetryError('not_completed')
  if (!data.client_id) return { success: true, warnings: [] }

  return ensurePostCompletionActions(appointmentId, data.client_id, data.user_id, plan)
}

export async function cancelAppointment(id: string, reason?: string): Promise<void> {
  // Chargé avant la mise à jour pour pouvoir tracer l'événement (décision de la refonte) ;
  // un échec de cette lecture ne doit pas empêcher l'annulation elle-même.
  const { data: appt } = await supabase
    .from('appointments')
    .select('client_id, title, start_at, user_id')
    .eq('id', id)
    .single()

  const { error } = await supabase
    .from('appointments')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancellation_reason: reason ?? null })
    .eq('id', id)

  if (error) throw new Error(error.message)

  if (appt?.client_id) {
    try {
      await logClientEvent(appt.user_id, appt.client_id, 'appointment_cancelled', {
        appointment_title: appt.title,
        appointment_date: appt.start_at,
        reason: reason ?? null,
      })
    } catch (logError) {
      console.error('[logClientEvent]', logError)
    }
  }
}

export async function deleteAppointment(id: string): Promise<void> {
  // Chargé avant la suppression : une fois le RDV supprimé, ces informations
  // ne seraient plus récupérables pour l'événement de traçabilité.
  const { data: appt } = await supabase
    .from('appointments')
    .select('client_id, title, start_at, user_id')
    .eq('id', id)
    .single()

  const { error } = await supabase.from('appointments').delete().eq('id', id)
  if (error) throw new Error(error.message)

  if (appt?.client_id) {
    try {
      await logClientEvent(appt.user_id, appt.client_id, 'appointment_deleted', {
        appointment_title: appt.title,
        appointment_date: appt.start_at,
      })
    } catch (logError) {
      console.error('[logClientEvent]', logError)
    }
  }
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

// TASK-RDV-1 (fix) — une tâche liée à ce RDV peut désormais être terminée/rouverte depuis un
// AUTRE écran (fiche Contact). La fiche RDV n'a pas de canal de synchronisation en temps réel
// avec cet autre écran : un refetch ciblé au retour sur focus (voir useFocusEffect côté RDV)
// est le mécanisme retenu, même filtre/tri que la lecture initiale (fetchAppointmentById) pour
// ne jamais faire régresser l'ordre/le contenu affiché.
export async function fetchTasksForAppointment(appointmentId: string): Promise<AppointmentTask[]> {
  const { data, error } = await supabase
    .from('appointment_tasks')
    .select('id, appointment_id, user_id, client_id, title, task_type, priority, status, due_at, completed_at, created_at, updated_at')
    .eq('appointment_id', appointmentId)
    .order('due_at', { ascending: true })
  if (error) throw new Error(error.message)
  return data ?? []
}

// TASK-RDV-1 §7 — fonction unique et réversible : marquer terminée ET rouvrir passent par la
// même implémentation (jamais deux fonctions qui pourraient diverger), même modèle déjà utilisé
// par toggleFollowupDone. Ne supprime jamais la tâche (§5) — uniquement status/completed_at.
// Réouverture -> 'pending' (pas de suivi de l'état antérieur exact, cohérent avec le modèle
// actuel où pending/in_progress sont déjà traités de façon équivalente comme "actif" partout —
// voir useClientTasks/fetchTasksByUser, filtrés IN (pending, in_progress) / != cancelled).
export async function setAppointmentTaskDone(id: string, done: boolean): Promise<void> {
  const { error } = await supabase
    .from('appointment_tasks')
    .update({ status: done ? 'done' : 'pending', completed_at: done ? new Date().toISOString() : null })
    .eq('id', id)

  if (error) throw new Error(error.message)
}

// Conservée telle quelle pour les appelants qui ne gèrent pas la réouverture (useAppointmentTasks,
// hook non consommé par aucun écran à ce jour — vérifié) : simple délégation, aucun second calcul.
export async function completeTask(id: string): Promise<void> {
  return setAppointmentTaskDone(id, true)
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('appointment_tasks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// TASK-RDV-1 §10 — traçabilité : tâches terminées d'un contact, pour l'affichage compact et
// replié par défaut de la fiche Contact. Triées par date de complétion la plus récente d'abord.
export async function fetchDoneTasksByClient(clientId: string): Promise<AppointmentTask[]> {
  const { data, error } = await supabase
    .from('appointment_tasks')
    .select('id, appointment_id, user_id, client_id, title, task_type, priority, status, due_at, completed_at, created_at, updated_at')
    .eq('client_id', clientId)
    .eq('status', 'done')
    .order('completed_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

// TASK-RDV-1 §12 — compteur léger (head:true, pas de lignes transférées) pour n'afficher
// l'affordance "Terminées (N)" que si elle a réellement du contenu, sans charger les lignes tant
// que la section n'est pas dépliée.
export async function countDoneTasksByClient(clientId: string): Promise<number> {
  const { count, error } = await supabase
    .from('appointment_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'done')
  if (error) throw new Error(error.message)
  return count ?? 0
}

// Distinct de completeTask/deleteTask (Lot 1.2 §16) : une tâche annulée n'a jamais été
// réalisée, contrairement à une tâche terminée — jamais confondues, jamais supprimée.
export async function cancelTask(id: string): Promise<void> {
  const { error } = await supabase.from('appointment_tasks').update({ status: 'cancelled' }).eq('id', id)
  if (error) throw new Error(error.message)
}
