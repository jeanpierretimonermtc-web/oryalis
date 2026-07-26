// ── Scalar types ──────────────────────────────────────────────────────────────

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
  | 'auto_new_client'
  | 'auto_order'
  | 'auto_appointment'
  | 'auto_no_contact'

export const STATUS_KEYS: ClientStatus[] = [
  'prospect', 'new_client', 'active', 'loyal', 'vip',
  'advisor', 'team_member', 'inactive', 'lost',
]

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

export const STATUS_PRESETS: Partial<Record<ActivityType, Partial<Record<ClientStatus, string>>>> = {
  doterra:  { loyal: 'LRP',             advisor: 'Conseillère', team_member: 'Équipe'    },
  zinzino:  { loyal: 'Client récurrent', advisor: 'Partenaire',  team_member: 'Downline'  },
}

export interface UserBusinessProfile {
  id: string
  user_id: string
  activity_type: ActivityType
  custom_brand_name: string | null
  active_modules: ModuleKey[]
  automation_delays: Record<string, number>
  created_at: string
  updated_at: string
}

export interface UserStatusLabel {
  id: string
  user_id: string
  status_key: ClientStatus
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
  address: string | null
  loyalty_notes: string | null
  // ── MLM réseau (migrate15) ────────────────────────────────────────────────
  sponsor_id: string | null
  contact_role: ContactRole
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
  // ──────────────────────────────────────────────────────────────────────────
  created_at: string
  updated_at: string | null
}

/** Lightweight projection of Client used by list screens, to keep egress low. */
export type ClientListItem = Pick<Client,
  'id' | 'full_name' | 'email' | 'phone' | 'status' | 'pipeline_stage' | 'contact_role' | 'last_interaction_at'
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
  created_at: string
  updated_at: string | null
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
  client: Pick<Client, 'id' | 'full_name' | 'status' | 'contact_role' | 'pipeline_stage'>
}

export interface InteractionWithClient extends Interaction {
  client: Pick<Client, 'id' | 'full_name'>
}
