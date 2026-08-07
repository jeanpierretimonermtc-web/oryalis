// ── Scalar types ──────────────────────────────────────────────────────────────

/** @deprecated Ancien statut de cycle de vie — remplacé par `contact_role` (rôle),
 * `is_vip` (tag manuel) et `computeRelationshipHealth()` (santé calculée). La colonne
 * `status` reste en base pour compatibilité mais n'est plus lue/écrite comme source de
 * vérité par l'app (voir migrate42.mjs). */
export type ClientStatus =
  | 'prospect'
  | 'new_client'
  | 'active'
  | 'loyal'
  | 'vip'
  | 'inactive'
  | 'advisor'
  | 'team_member'
  | 'lost'

export type ActivityType = 'generic' | 'doterra' | 'zinzino' | 'herbalife' | 'custom' | 'multi'

export type ModuleKey =
  | 'products'
  | 'renewals_lrp'
  | 'downline'
  | 'goals'
  | 'calendar_sync'
  | 'client_import'
  | 'auto_first_order'
  | 'auto_order'
  | 'auto_appointment'
  | 'auto_no_contact'

/** @deprecated voir `ClientStatus`. */
export const STATUS_KEYS: ClientStatus[] = [
  'prospect', 'new_client', 'active', 'loyal', 'vip',
  'advisor', 'team_member', 'inactive', 'lost',
]

/** @deprecated voir `ClientStatus`. */
export const DEFAULT_STATUS_LABELS: Record<ClientStatus, string> = {
  prospect:    'Prospect',
  new_client:  'Nouveau client',
  active:      'Actif',
  loyal:       'Fidèle',
  vip:         'VIP',
  advisor:     'Conseiller',
  team_member: 'Membre équipe',
  inactive:    'Inactif',
  lost:        'Perdu',
}

/** @deprecated voir `ClientStatus`. */
export const STATUS_PRESETS: Partial<Record<ActivityType, Partial<Record<ClientStatus, string>>>> = {
  doterra:  { loyal: 'LRP',             advisor: 'Conseillère', team_member: 'Équipe'    },
  zinzino:  { loyal: 'Client récurrent', advisor: 'Partenaire',  team_member: 'Downline'  },
}

// ── Rôle relationnel : libellés personnalisables (remplace STATUS_* ci-dessus) ────────

/** Clé de personnalisation de libellé — rôle (nouveau) ou statut legacy (conservé pour
 * ne pas invalider d'anciennes lignes `user_status_labels` déjà enregistrées). */
export type LabelKey = ContactRole | ClientStatus

export const ROLE_KEYS: ContactRole[] = [
  'prospect', 'customer', 'distributor', 'leader', 'team_member', 'inactive',
]

export const DEFAULT_ROLE_LABELS: Record<ContactRole, string> = {
  prospect:    'Prospect',
  customer:    'Client',
  distributor: 'Distributeur',
  leader:      'Leader',
  team_member: 'Membre équipe',
  inactive:    'Inactif',
}

export const ROLE_PRESETS: Partial<Record<ActivityType, Partial<Record<ContactRole, string>>>> = {
  doterra: { distributor: 'Conseillère', leader: 'Conseillère Leader', team_member: 'Équipe' },
  zinzino: { distributor: 'Partenaire',  leader: 'Partenaire Leader',  team_member: 'Downline' },
}

export interface UserBusinessProfile {
  id: string
  user_id: string
  activity_type: ActivityType
  custom_brand_name: string | null
  custom_lrp_name: string | null
  active_modules: ModuleKey[]
  automation_delays: Record<string, number>
  created_at: string
  updated_at: string
}

export interface UserStatusLabel {
  id: string
  user_id: string
  status_key: LabelKey
  custom_label: string
  created_at: string
}

// 'purchased' kept during transition — migrate13 does NOT convert existing data yet.
// Phase D will run: UPDATE recommendations SET status='ordered' WHERE status='purchased'
// and remove 'purchased' from this union.
export type RecommendationStatus = 'advised' | 'purchased' | 'ordered' | 'received' | 'completed'

export type CatalogType = 'official' | 'custom'

export type InteractionType =
  | 'rdv'
  | 'call'
  | 'visio'
  | 'whatsapp'
  | 'sms'
  | 'email'
  | 'workshop'
  | 'group_meeting'
  | 'product_followup'

export type InterestLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high'

export type JourneyStage =
  | 'discovery'
  | 'evaluation'
  | 'first_recommendation'
  | 'first_order'
  | 'onboarding'
  | 'followup_7d'
  | 'followup_30d'
  | 'loyal'

export type AcquisitionSource =
  | 'facebook'
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'website'
  | 'calendly'
  | 'referral'
  | 'trade_show'
  | 'workshop'
  | 'conference'
  | 'advertising'
  | 'other'

export type NetworkPotential = 'low' | 'medium' | 'high'

// Programme de commande récurrente / fidélité (ex. "LRP" chez doTERRA) — le nom affiché
// est personnalisable (voir UserBusinessProfile.custom_lrp_name), le statut ci-dessous ne
// change pas de fabricant à l'autre.
export type LrpStatus = 'not_enrolled' | 'active' | 'paused' | 'cancelled'
export const LRP_STATUSES: LrpStatus[] = ['not_enrolled', 'active', 'paused', 'cancelled']

export type ContactRole =
  | 'prospect'
  | 'customer'
  | 'distributor'
  | 'leader'
  | 'team_member'
  | 'inactive'

export type PipelineStage =
  | 'new_lead'
  | 'contacted'
  | 'presentation_scheduled'
  | 'presentation_completed'
  | 'follow_up'
  | 'customer'
  | 'distributor'
  | 'lost'

export const PIPELINE_STAGES: PipelineStage[] = [
  'new_lead', 'contacted', 'presentation_scheduled', 'presentation_completed',
  'follow_up', 'customer', 'distributor', 'lost',
]

// ── Santé de la relation (calculée, voir features/clients/relationshipHealth.ts) ──────

export type RelationshipHealthTier = 'up_to_date' | 'to_follow_up' | 'overdue' | 'dormant'

export const RELATIONSHIP_HEALTH_TIERS: RelationshipHealthTier[] = [
  'up_to_date', 'to_follow_up', 'overdue', 'dormant',
]

export interface RelationshipHealth {
  tier: RelationshipHealthTier
  /** true si `manually_inactive` a forcé ce palier, indépendamment de l'activité réelle. */
  overridden: boolean
}

export type NextActionType = 'call' | 'whatsapp' | 'sms' | 'email' | 'rdv'
export type NextActionSource = 'appointment' | 'interaction' | 'followup'

export type OrderStatus = 'pending' | 'ordered' | 'delivered' | 'cancelled' | 'returned'
export type OrderType = 'customer' | 'personal'

export type GoalMetric = 'new_clients' | 'new_distributors' | 'revenue' | 'appointments' | 'presentations' | 'followups'

export interface Goal {
  id: string
  user_id: string
  period: string
  metric: GoalMetric
  target: number
  current: number
  updated_at: string
}

export type AlertType =
  | 'prospect_forgotten'
  | 'client_inactive'
  | 'lrp_due'
  | 'distributor_dormant'
  | 'followup_overdue'
  | 'leader_emerging'

export interface Alert {
  id: string
  user_id: string
  type: AlertType
  client_id: string | null
  message: string
  action_url: string | null
  read: boolean
  created_at: string
}

// ── Entities ──────────────────────────────────────────────────────────────────

export interface Catalog {
  id: string
  slug: string | null
  name: string
  brand: string | null
  type: CatalogType
  user_id: string | null
  color: string
  icon: string
  created_at: string
}

export interface CatalogProduct {
  id: string
  catalog_id: string
  sku: string | null
  name: string
  category: string | null
  description: string | null
  unit: string | null
  retail_price_eur: number | null
  wholesale_price_eur: number | null
  pv: number | null
  latin_name: string | null
  image_url: string | null
  created_at: string
}

export interface Profile {
  id: string
  full_name: string | null
  email: string | null
  locale: string | null
  timezone: string | null
  plan: string | null
  specialty: string | null
  onboarding_completed: boolean
  active_catalog_slugs: string[] | null
  // ── Profil enrichi (migrate22) ────────────────────────────────────────────
  avatar_url: string | null
  phone: string | null
  website: string | null
  bio: string | null
  company: string | null
  city: string | null
  linkedin_url: string | null
  // ─────────────────────────────────────────────────────────────────────────
  created_at: string
  updated_at: string | null
}

export interface Client {
  id: string
  user_id: string
  full_name: string
  first_name: string | null
  avatar_url: string | null
  email: string | null
  phone: string | null
  status: ClientStatus
  source: string | null
  language: string | null
  birth_date: string | null
  inscription_date: string | null
  profession: string | null
  children: string | null
  interests: string[]
  client_type: string | null
  medical_treatment: boolean
  medical_notes: string | null
  particularities: string | null
  welcome_email_sent: boolean
  doterra_id: string | null
  next_lrp_date: string | null
  lrp_status: LrpStatus
  lrp_loyalty_percent: number | null
  lrp_start_date: string | null
  address: string | null
  loyalty_notes: string | null
  tracking_consent_at: string | null
  // ── MLM réseau (migrate15) ────────────────────────────────────────────────
  sponsor_id: string | null
  contact_role: ContactRole[]
  pipeline_stage: PipelineStage
  pipeline_stage_updated_at: string | null
  // ── CRM International (migrate13) ─────────────────────────────────────────
  country: string | null
  first_contact_date: string | null
  first_purchase_date: string | null
  acquisition_source: AcquisitionSource | null
  journey_stage: JourneyStage | null
  next_action_date: string | null
  next_action_type: NextActionType | null
  next_action_at: string | null
  next_action_source: NextActionSource | null
  next_action_source_id: string | null
  last_interaction_at: string | null
  referrals_count: number
  referral_count: number
  network_potential: NetworkPotential | null
  archived_at: string | null
  // ── Modèle relationnel (migrate42) ─────────────────────────────────────────
  is_vip: boolean
  manually_inactive: boolean
  // ──────────────────────────────────────────────────────────────────────────
  created_at: string
  updated_at: string | null
}

/** Lightweight projection of Client used by list screens, to keep egress low. */
export type ClientListItem = Pick<Client,
  'id' | 'full_name' | 'first_name' | 'avatar_url' | 'email' | 'phone' | 'status' | 'pipeline_stage' | 'contact_role' |
  'last_interaction_at' | 'next_action_at' | 'is_vip' | 'manually_inactive' | 'created_at'
>

export interface UplineNode {
  id: string
  user_id: string
  name: string
  member_id: string | null
  position: number
  created_at: string
}

export interface Note {
  id: string
  client_id: string
  user_id: string
  content: string
  created_at: string
}

export type ProspectTemperature = 'cold' | 'warm' | 'hot' | 'very_hot'

export interface Followup {
  id: string
  client_id: string
  user_id: string
  title: string | null
  content: string | null
  due_date: string
  done: boolean
  action_type: NextActionType | null
  // ── Relance intelligente (migrate17) ──────────────────────────────────────
  prospect_temperature: ProspectTemperature | null
  pipeline_stage: string | null
  product_context: string | null
  auto_generated: boolean
  priority_score: number | null
  // ─────────────────────────────────────────────────────────────────────────
  // Lot 1.2 — RDV source (relance personnelle créée depuis une clôture) et, pour une
  // relance automatique, l'id de la règle AUTOMATION_RULES qui l'a créée.
  appointment_id: string | null
  automation_rule_id: string | null
  // Lot 1.2.1 (suite) — commande source (relance auto issue d'une commande) ; ON DELETE
  // CASCADE en base : cette relance disparaît si la commande est supprimée.
  order_id: string | null
  // Distincte de `done` : une relance annulée n'a jamais été traitée, contrairement à une
  // relance terminée (voir Lot 1.2 §16 — jamais confondre les deux).
  cancelled_at: string | null
  // Lot 1.2.1 — clé d'idempotence (RDV + révision + type d'action), voir index unique
  // partiel en base. Null pour toute relance créée hors clôture de RDV.
  closure_action_key: string | null
  created_at: string
  updated_at: string | null
}

export interface Recommendation {
  id: string
  client_id: string
  user_id: string
  product_name: string
  reason: string | null
  status: RecommendationStatus
  catalog_id: string | null
  product_id: string | null
  quantity: number
  objective: string | null
  recommendation_date: string | null
  catalog?: Pick<Catalog, 'name' | 'color' | 'icon'>
  // Lot 1.2 — RDV source si créée depuis une clôture (jamais automatique, voir §6).
  appointment_id: string | null
  cancelled_at: string | null
  // Lot 1.2.1 — clé d'idempotence (RDV + révision), voir index unique partiel en base.
  closure_action_key: string | null
  created_at: string
  updated_at: string | null
}

export interface Interaction {
  id: string
  client_id: string
  user_id: string
  interaction_type: InteractionType
  scheduled_at: string | null
  completed_at: string | null
  subject: string | null
  summary: string | null
  needs_identified: string | null
  objections: string | null
  interest_level: InterestLevel | null
  notes_brutes: string | null
  ai_summary: string | null
  ai_next_actions: string | null
  ai_followup_draft: string | null
  created_at: string
  updated_at: string | null
}

export interface OrderProduct {
  product_id?: string
  name: string
  qty: number
  price?: number
}

export interface Order {
  id: string
  client_id: string
  user_id: string
  product_name: string
  catalog_id: string | null
  product_id: string | null
  quantity: number
  amount: number | null
  currency: string
  order_date: string
  status: OrderStatus
  notes: string | null
  // ── MLM (migrate16) ───────────────────────────────────────────────────────
  order_number: string | null
  is_lrp: boolean
  products: OrderProduct[] | null
  // ─────────────────────────────────────────────────────────────────────────
  order_type: OrderType
  // Lot 1.2 — RDV source si la commande a été créée depuis une clôture ("vente réalisée").
  appointment_id: string | null
  // Lot 1.2.1 — clé d'idempotence (RDV + révision), voir index unique partiel en base.
  closure_action_key: string | null
  // Lot 1.2.1 (suite) — annulation douce, distincte de status='returned' et de la suppression.
  cancelled_at: string | null
  // Lot 1.2.1 (suite) — figée à la création, jamais recalculée depuis le nombre de commandes
  // actuel (qui change avec le temps). NULL = commande antérieure à ce champ, inconnu.
  is_first_order: boolean | null
  created_at: string
  updated_at: string | null
  // Jointure optionnelle (vue commandes globale) — jamais présente sur les lectures qui ne la
  // sélectionnent pas explicitement.
  client?: { full_name: string } | null
}

// ── Joined types ──────────────────────────────────────────────────────────────

export interface NetworkNode extends Pick<Client,
  'id' | 'full_name' | 'first_name' | 'email' | 'phone' |
  'status' | 'contact_role' | 'sponsor_id' |
  'next_lrp_date' | 'updated_at' | 'created_at'
> {
  children: NetworkNode[]
  level: number
}

export interface FollowupWithClient extends Followup {
  client: Pick<Client, 'id' | 'full_name' | 'status' | 'contact_role' | 'pipeline_stage' | 'is_vip'>
}

export interface InteractionWithClient extends Interaction {
  client: Pick<Client, 'id' | 'full_name'>
}
