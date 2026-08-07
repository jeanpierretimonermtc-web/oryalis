import { supabase } from '@/shared/lib/supabase'
import type { NextActionType } from '@/shared/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

export type AutoTrigger = 'first_order' | 'order' | 'appointment' | 'no_contact'

export interface AutomationRule {
  id:          string
  trigger:     AutoTrigger
  moduleKey:   string
  delayDays:   number
  showDelayPrefix?: boolean     // false → pas de préfixe "J+X ·" dans le titre (ex: seuil d'inactivité)
  title:       string          // variables: {prénom}, {délai}
  actionType:  NextActionType
  description: string          // variables: {délai}
}

// ── Règles par défaut ─────────────────────────────────────────────────────────
// Le délai (J+X) affiché devant le titre est calculé dynamiquement à partir du
// délai effectif (par défaut ou reconfiguré par l'utilisateur) — ne jamais
// l'écrire en dur dans `title`/`description`, sous peine de désynchronisation.

export const AUTOMATION_RULES: AutomationRule[] = [
  // ── Première commande (J+3, J+30) ─────────────────────────────────────────
  // ids/délais conservés depuis l'ancien déclencheur "Nouveau client" pour ne
  // pas perdre les délais déjà personnalisés par l'utilisateur (automation_delays
  // est keyé par id de règle) — seuls trigger/moduleKey changent.
  {
    id: 'nc_j3',  trigger: 'first_order', moduleKey: 'auto_first_order', delayDays: 3,
    title:       'Réception produits {prénom}',
    actionType:  'whatsapp',
    description: 'Vérifier que le client a bien reçu ses produits',
  },
  {
    id: 'nc_j30', trigger: 'first_order', moduleKey: 'auto_first_order', delayDays: 30,
    title:       'Bilan {prénom} — satisfaction ?',
    actionType:  'call',
    description: 'Bilan pour fidéliser le nouveau client',
  },

  // ── Commande (J+3, J+15, J+30) ────────────────────────────────────────────
  {
    id: 'ord_j3',  trigger: 'order', moduleKey: 'auto_order', delayDays: 3,
    title:       'Réception commande {prénom} — bien reçu ?',
    actionType:  'whatsapp',
    description: 'Confirmer la bonne réception de la commande',
  },
  {
    id: 'ord_j15', trigger: 'order', moduleKey: 'auto_order', delayDays: 15,
    title:       'Retours produits {prénom}',
    actionType:  'whatsapp',
    description: 'Recueillir les retours après utilisation',
  },
  {
    id: 'ord_j30', trigger: 'order', moduleKey: 'auto_order', delayDays: 30,
    title:       'Check {prénom} — nouvelle commande ?',
    actionType:  'call',
    description: 'Fidélisation et opportunité de récommande',
  },

  // ── Rendez-vous complété (J+7) ────────────────────────────────────────────
  {
    id: 'appt_j7', trigger: 'appointment', moduleKey: 'auto_appointment', delayDays: 7,
    title:       'Feedback RDV {prénom} — des questions ?',
    actionType:  'whatsapp',
    description: 'Suivi après le rendez-vous',
  },

  // ── Sans contact > 30 jours ───────────────────────────────────────────────
  {
    id: 'noc_30d', trigger: 'no_contact', moduleKey: 'auto_no_contact', delayDays: 30,
    showDelayPrefix: false,
    title:       'Reprendre contact {prénom} — absent depuis {délai}+ jours',
    actionType:  'call',
    description: 'Relance automatique après {délai} jours sans contact',
  },
]

export const TRIGGER_LABELS: Record<AutoTrigger, string> = {
  first_order: 'Première commande',
  order:       'Nouvelle commande',
  appointment: 'RDV complété',
  no_contact:  'Sans contact 30+ jours',
}

export const TRIGGER_ICONS: Record<AutoTrigger, string> = {
  first_order: '🎉',
  order:       '🛒',
  appointment: '📅',
  no_contact:  '😴',
}

export const TRIGGER_MODULE: Record<AutoTrigger, string> = {
  first_order: 'auto_first_order',
  order:       'auto_order',
  appointment: 'auto_appointment',
  no_contact:  'auto_no_contact',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dueDateStr(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

function renderText(text: string, prénom: string, delayDays: number): string {
  return text.replace(/\{prénom\}/g, prénom).replace(/\{délai\}/g, String(delayDays))
}

export function renderRuleTitle(rule: AutomationRule, prénom: string, delayDays: number): string {
  const body = renderText(rule.title, prénom, delayDays)
  return rule.showDelayPrefix === false ? body : `J+${delayDays} · ${body}`
}

export function renderRuleDescription(rule: AutomationRule, delayDays: number): string {
  return renderText(rule.description, '', delayDays)
}

interface AutomationConfig {
  modules: string[]
  delays: Record<string, number>
}

async function getAutomationConfig(userId: string): Promise<AutomationConfig> {
  const { data: profile } = await supabase.from('profiles').select('plan').eq('id', userId).single()
  if (!['pro', 'cabinet', 'advisor', 'leader', 'enterprise'].includes(profile?.plan ?? 'free')) {
    return { modules: [], delays: {} }
  }
  const { data } = await supabase
    .from('user_business_profiles')
    .select('active_modules, automation_delays')
    .eq('user_id', userId)
    .single()
  const modules = (data?.active_modules as string[]) ?? [
    'products','renewals_lrp','downline','goals','calendar_sync',
    'auto_first_order','auto_order','auto_appointment','auto_no_contact',
  ]
  const delays = (data?.automation_delays as Record<string, number>) ?? {}
  return { modules, delays }
}

function effectiveDelay(rule: AutomationRule, delays: Record<string, number>): number {
  return delays[rule.id] ?? rule.delayDays
}

async function insertFollowup(
  userId: string,
  clientId: string,
  title: string,
  due: string,
  actionType: NextActionType,
  ruleId?: string,
  appointmentId?: string | null,
  orderId?: string | null,
): Promise<void> {
  // Idempotent : ne crée pas si une relance auto avec même titre existe déjà, non faite ET
  // non annulée (Lot 1.2.1 §10-11) — une relance auto annulée ne doit jamais bloquer
  // indéfiniment la création d'une relance légitime ultérieure du même type.
  const { count } = await supabase
    .from('followups')
    .select('id', { count: 'exact', head: true })
    .eq('user_id',       userId)
    .eq('client_id',     clientId)
    .eq('auto_generated', true)
    .eq('done',          false)
    .is('cancelled_at',  null)
    .eq('title',         title)

  if ((count ?? 0) > 0) return

  await supabase.from('followups').insert({
    user_id:       userId,
    client_id:     clientId,
    title,
    due_date:      due,
    done:          false,
    auto_generated: true,
    action_type:   actionType,
    automation_rule_id: ruleId ?? null,
    appointment_id: appointmentId ?? null,
    // Lot 1.2.1 (suite) — lien vers la commande source (trigger 'order'/'first_order'
    // uniquement) : ON DELETE CASCADE supprime cette relance si la commande est supprimée.
    order_id: orderId ?? null,
  })
}

// ── Plan de relances — choix utilisateur avant création (commandes) ───────────
// Distinct du PostCompletionPlan des RDV (spécifique aux intentions commerciales) :
// ici les items référencent directement un id de AUTOMATION_RULES, catalogué et fixe.

export interface AutomationPlanItem {
  ruleId: string
  create: boolean
  delayDays: number
}
export type AutomationPlan = AutomationPlanItem[]

// Règles pertinentes pour une commande : "Nouvelle commande" toujours, plus
// "Première commande" si c'est le tout premier achat de ce client.
export function getSuggestedRules(isFirstOrder: boolean): AutomationRule[] {
  const triggers: AutoTrigger[] = isFirstOrder ? ['order', 'first_order'] : ['order']
  return AUTOMATION_RULES.filter(r => triggers.includes(r.trigger))
}

// ── Triggers publics ──────────────────────────────────────────────────────────

// Appelé après l'enregistrement d'une commande. Si `plan` est fourni (choix
// explicite de l'utilisateur dans la modale), seules les règles cochées sont
// créées, au délai choisi. Sans `plan`, retombe sur le comportement automatique
// historique (toutes les règles suggérées et actives, au délai configuré).
// `appointmentId` : renseigné lorsque la commande provient d'une clôture/révision de RDV
// (Lot 1.2.1 §11) — trace la relance automatique jusqu'à son RDV déclencheur réel, jamais
// une approximation. Une commande manuelle (hors clôture) le laisse à null.
export async function applyOrderAutomation(
  userId: string,
  clientId: string,
  firstName: string,
  isFirstOrder: boolean,
  plan?: AutomationPlan,
  appointmentId?: string | null,
  orderId?: string | null,
): Promise<void> {
  try {
    const { modules, delays } = await getAutomationConfig(userId)
    const rules = getSuggestedRules(isFirstOrder).filter(r => modules.includes(r.moduleKey))
    for (const rule of rules) {
      const planItem = plan?.find(p => p.ruleId === rule.id)
      const shouldCreate = plan ? !!planItem?.create : true
      if (!shouldCreate) continue
      const delay = plan ? (planItem?.delayDays ?? effectiveDelay(rule, delays)) : effectiveDelay(rule, delays)
      await insertFollowup(userId, clientId, renderRuleTitle(rule, firstName, delay), dueDateStr(delay), rule.actionType, rule.id, appointmentId, orderId)
    }
  } catch (e) {
    console.error('[automation.order]', e)
  }
}

// `noFollowupRequired` (Lot 1.2.1 §12) : quand le praticien a explicitement choisi qu'aucune
// suite n'est nécessaire pour CE rendez-vous (refus définitif ou décision explicite), la
// relance automatique générique "RDV complété" ne doit pas être créée. Reste indépendant des
// automatismes de commande (applyOrderAutomation), qui ne sont jamais gatés par ce flag.
export async function triggerAppointmentCompleted(
  userId: string,
  clientId: string,
  firstName: string,
  appointmentId?: string | null,
  noFollowupRequired?: boolean,
): Promise<void> {
  try {
    if (noFollowupRequired) return
    const { modules, delays } = await getAutomationConfig(userId)
    if (!modules.includes('auto_appointment')) return
    const rules = AUTOMATION_RULES.filter(r => r.trigger === 'appointment')
    for (const rule of rules) {
      const delay = effectiveDelay(rule, delays)
      await insertFollowup(userId, clientId, renderRuleTitle(rule, firstName, delay), dueDateStr(delay), rule.actionType, rule.id, appointmentId)
    }
  } catch (e) {
    console.error('[automation.appointment]', e)
  }
}

export async function checkNoContact(userId: string): Promise<void> {
  try {
    const { modules, delays } = await getAutomationConfig(userId)
    if (!modules.includes('auto_no_contact')) return

    const rule = AUTOMATION_RULES.find(r => r.id === 'noc_30d')!
    const thresholdDays = effectiveDelay(rule, delays)
    const thresholdDate = new Date(Date.now() - thresholdDays * 86400000).toISOString()

    // Un client jamais encore contacté (last_interaction_at NULL) ne doit être considéré
    // "sans contact" qu'une fois qu'il a lui-même existé plus longtemps que le seuil —
    // sinon un client créé à l'instant est immédiatement traité comme "délaissé".
    const { data: clients } = await supabase
      .from('clients')
      .select('id, first_name, full_name')
      .eq('user_id', userId)
      .is('archived_at', null)
      .or(`last_interaction_at.lt.${thresholdDate},and(last_interaction_at.is.null,created_at.lt.${thresholdDate})`)
      .contains('contact_role', ['customer'])
      .eq('manually_inactive', false)
      .limit(20)

    for (const c of clients ?? []) {
      const prénom = c.first_name || c.full_name.split(' ')[0]
      await insertFollowup(userId, c.id, renderRuleTitle(rule, prénom, thresholdDays), dueDateStr(0), rule.actionType)
    }
  } catch (e) {
    console.error('[automation.noContact]', e)
  }
}
