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

// RECOMMENDATION-STATUS-FIX-1 — cycle unique advised → purchased, aligné sur la contrainte DB
// réelle (recommendations_status_check, jamais élargie depuis sa création : voir
// RECOMMENDATION-STATUS-AUDIT-1). 'ordered'/'received' relèvent du domaine Order
// (orders.status), jamais dupliqués ici ; le retour post-usage reste porté par
// recommendations.client_feedback, jamais par un statut 'completed'.
export type RecommendationStatus = 'advised' | 'purchased'

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

// ACTION-OUTCOME-1 / P0 — codes stables (jamais un libellé traduit) : résultat réel d'une
// interaction réalisée. Deux familles minimales, factorisées par nature de canal plutôt qu'un
// résultat par interaction_type (audit dédié) : synchrone (call/visio/rdv/workshop/
// group_meeting) et asynchrone (whatsapp/sms/email/product_followup) — voir
// INTERACTION_OUTCOME_OPTIONS (features/interactions) pour le mapping par type.
export type InteractionOutcomeCode =
  | 'answered' | 'no_answer' | 'voicemail' | 'callback_requested'
  | 'sent' | 'replied' | 'no_response' | 'follow_up_needed'

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

// LRP-3 — cadence du programme, indépendante du statut : ne couvre volontairement que
// week/month (pas 'day') — suffisant pour représenter la diversité réelle des programmes MLM
// (4 semaines, 6 semaines, 1/2/3 mois...) sans complexifier l'UI pour un besoin non observé.
export type LrpFrequencyUnit = 'week' | 'month'

// LRP-4 — programme récurrent générique (délibérément pas "Lrp*" : le nom affiché vient de
// getLrpName(), le nom technique ne doit référencer aucune entreprise). Devient la source de
// vérité du programme d'un contact, à la place de clients.lrp_status/next_lrp_date/
// lrp_frequency_value/lrp_frequency_unit/lrp_start_date (gelés, conservés pour compatibilité).
export type RecurringProgramStatus = 'active' | 'paused' | 'cancelled' | 'completed'
export const RECURRING_PROGRAM_STATUSES: RecurringProgramStatus[] = ['active', 'paused', 'cancelled', 'completed']

// 'occurrence_limit' → occurrence_limit renseigné, end_date null. 'end_date' → l'inverse.
// 'open_ended' → les deux sont null. Cohérence garantie côté DB par un CHECK dédié.
export type RecurringProgramEndMode = 'open_ended' | 'occurrence_limit' | 'end_date'

export interface RecurringProgram {
  id: string
  user_id: string
  client_id: string
  // LRP-4.1 §1 — libellé propre à CETTE instance (ex. "Nutrition"), distinct du nom global du
  // concept (getLrpName()). Null tant que non renseigné : l'affichage retombe alors sur
  // getLrpName() seul, jamais un texte technique.
  label: string | null
  status: RecurringProgramStatus
  start_date: string | null
  frequency_value: number | null
  frequency_unit: LrpFrequencyUnit | null
  end_mode: RecurringProgramEndMode
  occurrence_limit: number | null
  end_date: string | null
  // Source de vérité de la prochaine échéance — remplace clients.next_lrp_date pour tout
  // nouveau consommateur (alertes, dashboard, réseau, prochaines échéances).
  next_occurrence_date: string | null
  // LRP-4.2 §8 — clé d'idempotence de création (retry sans duplication), NULL hors création
  // depuis un flux commande.
  closure_action_key: string | null
  created_at: string
  updated_at: string
}

// LRP-5 — statut STOCKÉ d'une échéance de programme récurrent. Volontairement 3 valeurs
// seulement (pas de 'due' en base) : "à confirmer" est un état DÉRIVÉ à l'affichage
// (status='scheduled' ET scheduled_date <= aujourd'hui), jamais persisté — voir
// deriveOccurrenceDisplayStatus dans recurringOccurrenceService.ts.
export type RecurringProgramOccurrenceStatus = 'scheduled' | 'confirmed' | 'skipped'
export const RECURRING_PROGRAM_OCCURRENCE_STATUSES: RecurringProgramOccurrenceStatus[] = ['scheduled', 'confirmed', 'skipped']

// LRP-5 — une ÉCHÉANCE représente un cycle prévu du programme (ex. "25/09/2026"), distincte
// d'une commande réelle : occurrence ≠ order. Une occurrence peut avoir 0, 1 ou plusieurs
// commandes réelles rattachées (via orders.recurring_occurrence_id), jamais l'inverse.
export interface RecurringProgramOccurrence {
  id: string
  user_id: string
  client_id: string
  recurring_program_id: string
  scheduled_date: string
  status: RecurringProgramOccurrenceStatus
  confirmed_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

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

/** Projection légère de CatalogProduct pour getCatalogProducts() (liste Picker + écran
 * Catalogue) — image_url exclu car jamais lu par ces 2 consommateurs (P2.1), mais
 * CatalogProduct reste l'entité complète : addProductToCatalog() renvoie la ligne
 * entière après insertion et doit continuer à typer image_url correctement (P2.1a). */
export type CatalogProductListItem = Pick<CatalogProduct,
  'id' | 'catalog_id' | 'sku' | 'name' | 'category' | 'description' | 'unit' |
  'retail_price_eur' | 'wholesale_price_eur' | 'pv' | 'latin_name' | 'created_at'
>

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
  lrp_frequency_value: number | null
  lrp_frequency_unit: LrpFrequencyUnit | null
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
  'last_interaction_at' | 'next_action_at' | 'next_action_type' | 'next_action_source' | 'is_vip' | 'manually_inactive' | 'created_at'
>

/** Projection légère de Client pour l'écran Contacts archivés — seules id/full_name/
 * archived_at y sont affichées ou utilisées (P2.1, vérifié par lecture de l'écran). */
export type ArchivedClientListItem = Pick<Client, 'id' | 'full_name' | 'archived_at'>

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
  // ACTION-OUTCOME-1 / P1.2 — interaction à l'origine de cette relance quand elle a été créée
  // via le choix "Créer une relance" à la clôture d'une interaction ; null pour toute relance
  // créée autrement. Traçabilité uniquement, jamais une contrainte d'unicité (§12 : une même
  // interaction peut légitimement produire plusieurs relances dans le temps).
  source_interaction_id: string | null
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
  // ACTION-OUTCOME-1 / P2 — retour qualitatif du client sur CETTE recommandation précise
  // ("Bonne tolérance, souhaite continuer"), distinct du statut et distinct de reason/objective
  // (qui décrivent pourquoi le produit a été conseillé, pas ce qui s'est passé après). Texte
  // libre facultatif, jamais requis pour créer/faire évoluer une recommandation.
  client_feedback: string | null
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
  // ACTION-OUTCOME-1 / P0 — résultat structuré, renseigné uniquement à la clôture (jamais à
  // la création). null pour toute interaction non terminée ou terminée sans détail (§23/§24 :
  // ne jamais confondre avec un résultat "vide" à afficher).
  completion_result: InteractionOutcomeCode | null
  // ACTION-OUTCOME-1 / P1 — relance à l'origine de cette interaction quand elle a été créée
  // via "Enregistrer l'échange" à la clôture d'une relance ; null pour toute interaction créée
  // autrement (flux normal Interactions, ou ancienne donnée antérieure à P1).
  source_followup_id: string | null
  ai_summary: string | null
  ai_next_actions: string | null
  ai_followup_draft: string | null
  created_at: string
  updated_at: string | null
}

// ORDER-BUSINESS-2 §22 — `id` optionnel : absent pour une ligne pas encore enregistrée (nouvelle
// commande, nouvelle ligne ajoutée dans OrderEditModal), présent (= order_items.id réel) dès
// qu'elle a été chargée depuis/écrite vers order_items — permet à saveOrderItems() de distinguer
// une mise à jour d'une création sans jamais recréer une ligne existante avec un nouvel id.
// ORDER-BUSINESS-4.2 §4 — `returnedQty` optionnel : absent pour une ligne JSON legacy
// (orders.products, jamais de notion de retour) ou pas encore chargée depuis order_items —
// l'appelant doit alors le traiter comme 0 (getNetQuantity), jamais deviner un retour. Présent
// (= order_items.returned_qty réel) dès que la ligne a été chargée depuis order_items.
export interface OrderProduct {
  id?: string
  product_id?: string
  name: string
  qty: number
  price?: number
  returnedQty?: number
}

// ORDER-BUSINESS-2 — ligne de commande STRUCTURÉE (order_items), vérité détaillée future d'une
// commande. Distincte de OrderProduct (forme utilisée par l'UI/l'édition, plus proche du JSON
// legacy orders.products) : mapOrderItemToProduct() (orderItemService.ts) fait le pont entre les
// deux, jamais une 3e forme divergente.
// ORDER-BUSINESS-4.2 §3 — `returned_qty` : quantité CUMULATIVE retournée sur cette ligne, jamais
// un journal d'événements (§26 du rapport : pas de besoin identifié en V1). Garantie en base par
// `CHECK (returned_qty >= 0 AND returned_qty <= quantity)` — la quantité brute `quantity` reste
// intacte, un retour ne la modifie jamais (voir getNetQuantity, orderItemService.ts).
export interface OrderItem {
  id: string
  user_id: string
  order_id: string
  catalog_product_id: string | null
  product_name_snapshot: string
  quantity: number
  unit_price: number | null
  returned_qty: number
  created_at: string
  updated_at: string
}

// ORDER-BUSINESS-3 §8 — origine d'une métrique MLM : 'official' = définie par un catalogue
// (partagée entre tous les utilisateurs de ce catalogue, jamais recréée par compte, §11) ;
// 'personal' = définie par l'utilisateur lui-même (§12), éventuellement scindée à un catalogue
// personnel ou utilisable sur n'importe quel produit (catalog_id null).
export type MetricOrigin = 'official' | 'personal'

// ORDER-BUSINESS-3.5.2 §8/§9 — périmètre catalogue d'une métrique PERSONNELLE : 'all' = tous les
// catalogues accessibles à l'utilisateur (comportement historique catalog_id=null) ; 'selected' =
// uniquement les catalogues listés dans mlm_metric_definition_catalogs. Toujours null pour une
// métrique OFFICIELLE (liée à SON catalogue via catalog_id, jamais à un ensemble).
export type MlmMetricScope = 'all' | 'selected'

// ORDER-BUSINESS-3 §9/§10 — définition GÉNÉRIQUE d'une valeur MLM produit (PV, Credits, Points
// Volume, Points Challenge...). `code` est l'identifiant STABLE (jamais renommé, jamais réutilisé
// pour un autre sens) ; `display_name` est le libellé, modifiable librement sans jamais casser
// une référence existante. Ne couvre QUE les "source product metrics" (§3) — jamais les valeurs
// calculées (Group Volume...) ni les règles de compensation.
// ORDER-BUSINESS-3.5.2 — catalog_id reste NOT NULL pour une officielle (inchangé), mais devient
// TOUJOURS null pour une personnelle depuis ce lot (remplacé par scope + mlm_metric_definition_catalogs,
// voir 20260831_mlm_metric_multi_catalog.sql) — la colonne est conservée pour l'usage officiel
// uniquement, jamais pour représenter le périmètre d'une personnelle.
export interface MlmMetricDefinition {
  id: string
  origin: MetricOrigin
  catalog_id: string | null
  user_id: string | null
  code: string
  display_name: string
  unit: string | null
  active: boolean
  scope: MlmMetricScope | null
  created_at: string
  updated_at: string
}

// ORDER-BUSINESS-3.5.2 §9 — une ligne = "cette métrique personnelle s'applique aux produits de ce
// catalogue". N'existe jamais pour une métrique officielle (toujours catalog_id direct) ni pour
// une personnelle scope='all' (aucune ligne nécessaire, le périmètre est implicite : tout ce que
// l'utilisateur peut voir).
export interface MlmMetricDefinitionCatalog {
  id: string
  metric_definition_id: string
  catalog_id: string
  user_id: string
  created_at: string
}

// ORDER-BUSINESS-3 §13 — valeur d'UNE métrique pour UN produit catalogue. Jamais une colonne par
// métrique sur CatalogProduct : un produit peut porter plusieurs valeurs simultanément (une par
// metric_definition_id référencée), y compris une officielle ET une personnelle coexistantes (§7).
export interface CatalogProductMetricValue {
  id: string
  catalog_product_id: string
  metric_definition_id: string
  value: number
  created_at: string
  updated_at: string
}

// ORDER-BUSINESS-3 §15-§19 — valeur MLM FIGÉE au moment de la commande, jamais recalculée depuis
// le catalogue après coup (§29). `unit_value` reste toujours unitaire (jamais un total
// pré-multiplié) pour que quantity × unit_value (et, plus tard, net_quantity × unit_value après
// un retour partiel) reste calculable sans réinterpréter un total déjà agrégé (§18/§19).
// `metric_definition_id` nullable : une définition supprimée définitivement (rare, la
// désactivation est la voie normale, §25) passe cette colonne à null via ON DELETE SET NULL, mais
// metric_code_snapshot/metric_label_snapshot/origin_snapshot restent pour garder l'historique
// compréhensible (§17).
export interface OrderItemMetricSnapshot {
  id: string
  user_id: string
  order_item_id: string
  metric_definition_id: string | null
  metric_code_snapshot: string
  metric_label_snapshot: string
  origin_snapshot: MetricOrigin
  unit_value: number
  created_at: string
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
  // LRP-4 §9 — relation métier principale d'une commande récurrente, remplace progressivement
  // is_lrp (conservé pour compatibilité, jamais plus la seule source de vérité du lien).
  recurring_program_id: string | null
  // LRP-4.3 — identité de l'échéance du PROGRAMME consommée par cette commande (distincte de
  // order_date, jamais écrasée). Plusieurs commandes peuvent partager la même valeur (commande
  // principale + complémentaire du même cycle) — une seule occurrence programme en résulte.
  // LRP-5 — conservée comme SNAPSHOT/compatibilité (jamais supprimée) : la relation métier
  // officielle devient recurring_occurrence_id ci-dessous, qui pointe la ligne
  // recurring_program_occurrences réelle plutôt qu'une simple date.
  recurring_occurrence_date: string | null
  // LRP-5 — relation PRINCIPALE vers l'échéance (recurring_program_occurrences) que cette
  // commande documente. Pas de contrainte UNIQUE : plusieurs commandes (principale +
  // complémentaire) peuvent légitimement pointer la même occurrence.
  recurring_occurrence_id: string | null
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
  // LRP-4.5 §5 — jointure optionnelle vers le label du programme lié (recurring_programs.label),
  // pour afficher "Abonnement — Nutrition" dans les listes de commandes sans requête séparée par
  // ligne. Jamais présente sur les lectures qui ne la sélectionnent pas explicitement.
  recurring_program?: { label: string | null } | null
  // LRP-OCCURRENCE-LINK-2 — jointure optionnelle vers l'échéance réelle référencée par
  // recurring_occurrence_id (recurring_program_occurrences.scheduled_date/status), seule source
  // de vérité pour l'affichage "Échéance" d'une commande — jamais recurring_occurrence_date
  // (snapshot legacy, voir commentaire ci-dessus). Jamais présente sur les lectures qui ne la
  // sélectionnent pas explicitement.
  recurring_occurrence?: Pick<RecurringProgramOccurrence, 'scheduled_date' | 'status'> | null
  // ORDER-APPOINTMENT-TRACE-1 — jointure optionnelle vers le RDV source (appointment_id),
  // strictement pour l'affichage/la navigation ("cette commande provient de quel RDV ?").
  // Forme minimale volontaire (id/start_at/title uniquement, jamais notes/business_context) —
  // type inline plutôt qu'un import de `Appointment` (features/appointments/appointmentTypes.ts,
  // autre couche), même précédent que `recurring_program`/`client` ci-dessus. Jamais présent sur
  // les lectures qui ne la sélectionnent pas explicitement.
  source_appointment?: { id: string; start_at: string; title: string } | null
}

/** Projection légère de Order utilisée par les listes de commandes (globale, fiche contact,
 * modale d'édition) — colonnes vérifiées comme réellement affichées/éditées par ces 3
 * consommateurs (P2.1) ; catalog_id/product_id/quantity/currency/order_number/
 * closure_action_key/is_first_order/created_at/updated_at/user_id ne sont lus
 * par aucun d'eux. `appointment_id`/`source_appointment` (ORDER-APPOINTMENT-TRACE-1) : traçabilité
 * du RDV source, désormais affichée par OrderEditModal (§P2.1 mis à jour). `products` (ORDER-SYNC-1) : nécessaire pour qu'OrderEditModal détecte et
 * édite une commande structurée (lignes product_id/name/qty/price) sans la détruire. */
export type OrderListItem = Pick<Order,
  'id' | 'client_id' | 'product_name' | 'amount' | 'order_date' | 'status' |
  'notes' | 'is_lrp' | 'order_type' | 'cancelled_at' | 'client' | 'products' |
  'recurring_program_id' | 'recurring_occurrence_date' | 'recurring_occurrence_id' | 'recurring_program' |
  'recurring_occurrence' | 'appointment_id' | 'source_appointment'
>

// ── Joined types ──────────────────────────────────────────────────────────────

export interface NetworkNode extends Pick<Client,
  'id' | 'full_name' | 'first_name' | 'email' | 'phone' |
  'contact_role' | 'sponsor_id' | 'updated_at' | 'created_at'
> {
  children: NetworkNode[]
  level: number
  // LRP-4 — programme récurrent actif le plus proche pour ce contact (recurring_programs),
  // remplace next_lrp_date/lrp_status hérités de Client.
  activeProgramId: string | null
  nextOccurrenceDate: string | null
}

export interface FollowupWithClient extends Followup {
  client: Pick<Client, 'id' | 'full_name' | 'contact_role' | 'pipeline_stage' | 'is_vip'>
}

export interface InteractionWithClient extends Interaction {
  client: Pick<Client, 'id' | 'full_name'>
}
