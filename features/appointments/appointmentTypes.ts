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

// Accent unique par type de RDV, identique en light/dark (palette catégorielle, pas des
// tokens de thème) — source unique pour tous les écrans qui colorent un badge/point par type.
export const APPOINTMENT_TYPE_COLORS: Record<AppointmentType, string> = {
  discovery_call:       '#3B82F6',
  product_presentation: '#8B5CF6',
  follow_up:             '#10B981',
  closing_call:          '#F59E0B',
  customer_support:      '#22D3EE',
  team_training:         '#EC4899',
  team_meeting:          '#6366F1',
  webinar:               '#F97316',
  onboarding:            '#06B6D4',
  business_review:       '#84CC16',
  other:                 '#94A3B8',
}

export type AppointmentStatus =
  | 'scheduled'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'rescheduled'

export type { PipelineStage } from '@/shared/lib/types'
import type { PipelineStage, NextActionType, ContactRole } from '@/shared/lib/types'
import type { LrpProgramValue } from '@/features/clients/lrpProgramService'

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
  // ORDER-BUSINESS-3.1 §3/§4 — identité STABLE de la ligne order_items réellement créée pour ce
  // produit vendu, absente tant que la ligne n'a pas encore été écrite en base (première
  // clôture) ou pour toute donnée `outcome_details` antérieure à ce champ (fallback compatible,
  // §4 : jamais reconstruite depuis productId/label/position, qui ne sont pas des identités
  // fiables — voir §14 du rapport ORDER-BUSINESS-2.2). Renseigné en retour par
  // applyOutcomePlanActions une fois la ligne réellement écrite, puis reporté dans
  // appointment_business_context.outcome_details pour que la révision suivante le relise —
  // aucune migration DB requise (JSONB existant).
  id?: string
  productId?: string
  catalogId?: string
  label: string
  quantity: number
  variant?: string
  amount?: number
  note?: string
}

// RDV-PRODUCTS-1 / Lot B — produit évoqué pendant le RDV, indépendant du résultat de clôture.
// Distinct de OutcomeSaleProduct (produit effectivement VENDU, stocké dans outcome_details,
// n'existe qu'une fois l'issue "Vente réalisée" choisie) : un produit discuté n'implique ni
// intention d'achat confirmée (voir `considered`) ni clôture du RDV. Mêmes conventions de champs
// qu'OutcomeSaleProduct (optionnels omis plutôt que `null`, productId/catalogId absents pour un
// produit libre) pour rester cohérent avec le seul type déjà existant de ce genre.
// Pas de champ `note` par ligne : appointment_notes.products_discussed (texte libre, conservé)
// couvre déjà le commentaire qualitatif sur les produits, à l'échelle du RDV entier.
// Pas d'identifiant de ligne : comme OutcomeSaleProduct, la liste est manipulée par index côté
// UI (ajout/suppression/édition), jamais par un id persistant — aucun besoin identifié qui le
// justifierait pour l'instant.
export interface DiscussedProduct {
  productId?: string
  catalogId?: string
  label: string
  quantity: number
  // Prix SNAPSHOT au moment de l'ajout (jamais relu depuis catalog_products.retail_price_eur
  // par la suite) — absent (pas 0) quand le catalogue ne renseigne pas de prix : 0 signifierait
  // "gratuit", ce qui est une donnée différente de "prix inconnu".
  unitPriceEur?: number
  // "Ce produit discuté correspond réellement à une opportunité commerciale" — toujours
  // explicite, jamais déduit. Faux par défaut à la création (Lot C) : être mentionné pendant le
  // RDV n'implique pas une intention d'achat.
  considered: boolean
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
  // LRP-3 §22 — mêmes règles programme contact qu'une commande créée hors RDV (jamais une
  // logique LRP spécifique au RDV). lrpProgram n'est renseigné que si isLrp est cochée ET que
  // l'utilisateur a confirmé le bloc "Programme récurrent" (jamais déduit automatiquement).
  isLrp: boolean
  lrpProgram: LrpProgramValue | null
}
export interface AppointmentOutcomeRecommendationPlan {
  productName: string
  reason: string | null
  // RDV-CLOSURE-PRODUCTS/P2 — renseignés uniquement quand la recommandation reprend EXACTEMENT
  // un seul produit envisagé issu du catalogue (discussed_products) : recommendations.product_id/
  // catalog_id ne peuvent référencer qu'un seul produit par ligne (audit confirmé), jamais
  // renseignés quand plusieurs produits sont combinés dans un même productName joint.
  productId?: string | null
  catalogId?: string | null
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
  // RDV-1 — précision texte quand commercial_intent contient 'other'. Distinct de
  // outcome_other_label (concerne le résultat du RDV, pas l'intention commerciale).
  commercial_intent_other_label: string | null
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
  // RDV-PRODUCTS-1 / Lot B — voir DiscussedProduct. Colonne additive, défaut '[]' en base :
  // toujours un tableau, jamais null, y compris pour les RDV créés avant cette migration.
  discussed_products: DiscussedProduct[]
  // "Autres retombées" — tags secondaires optionnels en plus du résultat principal `outcome`
  // (ex. une vente peut s'accompagner d'un partenaire potentiel identifié). Jamais son propre
  // outcome_details, jamais suivi par revise_appointment_outcome/client_events — persisté par un
  // simple UPDATE, comme pipeline_stage/commercial_intent. Colonne additive, défaut '{}' en
  // base : toujours un tableau, jamais null.
  other_outcomes: AppointmentOutcome[]
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

// Projection légère utilisée par le calendrier (vues Mois/Semaine/Jour + bandeau "Prochain
// RDV") : sous-ensemble de colonnes d'Appointment + jointure client minimale pour l'affichage
// (nom, statut, rôle), sans notes/tâches/contexte métier — voir AppointmentFull pour la fiche
// détail complète. contact_role (CAL-4.5) : seul champ nécessaire pour réutiliser la même
// couleur de rôle que Contacts (getPrimaryRole/getRoleColors, shared/theme/roleColors.ts) —
// pipeline_stage et is_vip ne sont volontairement pas chargés ici, non nécessaires à l'accent.
export interface CalendarAppointment extends Pick<Appointment,
  'id' | 'user_id' | 'client_id' | 'title' | 'appointment_type' | 'status' | 'start_at' | 'end_at' | 'provider'
> {
  client: { id: string; full_name: string; status: string; contact_role: ContactRole[] } | null
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
  commercial_intent_other_label?: string | null
  estimated_value?: number
  currency?: string
  outcome?: AppointmentOutcome
  no_followup_required?: boolean
  outcome_details?: AppointmentOutcomeDetails | null
  outcome_other_label?: string | null
  // RDV-PRODUCTS-1 / Lot B — remplace intégralement le tableau (upsertBusinessContext), jamais
  // de fusion partielle élément par élément : la liste complète est reconstruite côté appelant
  // (state local, comme OutcomeSaleProduct) puis persistée en un seul appel.
  discussed_products?: DiscussedProduct[]
  // "Autres retombées" — remplace intégralement le tableau, même convention que
  // discussed_products ci-dessus (liste reconstruite côté appelant, persistée en un seul appel).
  other_outcomes?: AppointmentOutcome[]
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

// RÉCAP-5B — canal de partage d'un récapitulatif. Volontairement un type dédié, distinct de
// NextActionType (qui contient aussi 'call' et 'rdv', sémantique différente : une prochaine
// action à faire, pas un canal par lequel un message a déjà été envoyé) même si certaines
// chaînes sont identiques (audit RÉCAP-5A/RÉCAP-5B §9 — jamais coupler deux domaines juste
// parce que des libellés se recoupent).
export type RecapShareChannel = 'whatsapp' | 'sms' | 'email'

// RÉCAP-5B — une ligne = "l'utilisateur a initié depuis Oryalis le partage de ce récapitulatif
// via ce canal", jamais "envoyé"/"livré"/"reçu" (voir RÉCAP-5A §1, RÉCAP-5B §1). Append-only :
// aucun champ de ce type n'est jamais modifié après création (pas de service update/delete,
// voir recapShareService.ts). `message_snapshot`/`subject_snapshot` sont des snapshots figés du
// texte réellement préparé au moment du clic, jamais reconstruits depuis l'état courant du RDV.
// RÉCAP-6 — objet normalisé unique représentant "le vrai prochain RDV à mentionner au client",
// quelle que soit la manière dont il a été associé (créé via "Suite du rendez-vous" OU choisi
// comme RDV futur existant pendant le débrief/la révision — les deux convergent structurellement
// sur appointments.followup_of_appointment_id) OU, à défaut, simplement détecté comme prochain
// RDV futur du contact (voir resolveClientFacingNextAppointment). `source` distingue les deux
// cas car seul 'linked' justifie une présélection par défaut dans le récap (§7) — 'fallback'
// n'a jamais été explicitement choisi par le praticien pour CE RDV. `purpose` reprend le titre
// réel du RDV trouvé (déjà client-facing par construction pour un RDV créé via "Suite du
// rendez-vous" — voir handleCreateNextRdv), jamais une donnée interne (pipeline/statut/id).
export interface ClientFacingNextAppointment {
  startAt: string
  purpose: string
  source: 'linked' | 'fallback'
}

export interface AppointmentRecapShare {
  id: string
  user_id: string
  client_id: string
  appointment_id: string | null
  channel: RecapShareChannel
  message_snapshot: string
  subject_snapshot: string | null
  created_at: string
}
