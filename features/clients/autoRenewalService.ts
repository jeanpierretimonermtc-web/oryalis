// AUTO-RENEWAL-1 — renouvellements gérés par l'entreprise (recurring_programs.renewal_mode =
// 'company_auto'). Oryalis n'a ni serveur ni tâche planifiée : ce traitement est rattrapé à
// l'ouverture de l'app (useAlerts, throttlé), et reste idempotent à chaque étape.
import { supabase } from '@/shared/lib/supabase'
import i18n from '@/shared/i18n'
import type { OrderListItem, RecurringProgram, RecurringProgramOccurrence } from '@/shared/lib/types'
import { createOrder, deleteOrder, getOrdersByRecurringProgram, updateOrderRecurringProgram } from '@/features/orders/orderService'
import { fetchOrderItems, hybridLinesFromItems } from '@/features/orders/orderItemService'
import { ensureOccurrenceAt, confirmOccurrence } from './recurringOccurrenceService'
import { isProgramEligibleForNextOccurrence } from './recurringProgramService'

// Un programme oublié longtemps ne doit jamais générer une avalanche de commandes d'un coup.
const MAX_CYCLES_PER_RUN = 12
const CHECKIN_DAYS_BEFORE = 3
const CHECKIN_WINDOW_DAYS = 7
export const RENEWAL_CHECKIN_RULE_ID = 'renewal_checkin'

function localIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return localIso(new Date(y, m - 1, d + days))
}

// Dernière commande du programme (ni annulée, ni retournée) servant de modèle — y compris une
// commande personnelle : la copie garde son type, donc son exclusion éventuelle du CA.
function pickTemplateOrder(orders: OrderListItem[]): OrderListItem | null {
  return orders
    .filter(o => !o.cancelled_at && o.status !== 'cancelled' && o.status !== 'returned')
    .sort((a, b) => b.order_date.localeCompare(a.order_date))[0] ?? null
}

// Recopie la dernière commande sur l'échéance donnée, sauf si une commande y est déjà rattachée
// (reprise après un échec partiel : jamais de doublon).
async function copyOrderForOccurrence(userId: string, program: RecurringProgram, occurrence: RecurringProgramOccurrence): Promise<void> {
  const orders = await getOrdersByRecurringProgram(program.id)
  if (orders.some(o => o.recurring_occurrence_id === occurrence.id)) return
  const template = pickTemplateOrder(orders)
  if (!template) return

  const items = await fetchOrderItems(template.id)
  const products = hybridLinesFromItems(template, items).map(line => ({
    product_id: line.product_id,
    name: line.name,
    qty: line.qty,
    price: line.price,
  }))
  const result = await createOrder(userId, {
    client_id: program.client_id,
    product_name: template.product_name,
    amount: template.amount,
    order_date: occurrence.scheduled_date,
    is_lrp: true,
    products,
    order_type: template.order_type,
    status: 'ordered',
    auto_renewal: true,
  })
  await updateOrderRecurringProgram(result.order.id, program.id, occurrence.id, occurrence.scheduled_date)
}

async function processProgram(userId: string, initial: RecurringProgram, todayIso: string): Promise<void> {
  let program = initial
  for (let i = 0; i < MAX_CYCLES_PER_RUN; i++) {
    if (!isProgramEligibleForNextOccurrence(program, todayIso)) return
    const due = program.next_occurrence_date as string
    if (due > todayIso) return
    const occurrence = await ensureOccurrenceAt(program, due)
    if (occurrence.status !== 'scheduled') return
    // Commande d'abord, confirmation ensuite : si la confirmation échoue, le prochain passage
    // retrouve la commande déjà rattachée et ne la recrée pas.
    await copyOrderForOccurrence(userId, program, occurrence)
    const result = await confirmOccurrence(occurrence, program)
    const { error } = await supabase
      .from('recurring_program_occurrences')
      .update({ auto_confirmed: true, updated_at: new Date().toISOString() })
      .eq('id', occurrence.id)
    if (error) throw error
    program = result.program
    if (program.next_occurrence_date === due) return
  }
}

// Relance "prendre des nouvelles" quelques jours avant un renouvellement automatique (option).
async function ensureCheckinFollowup(userId: string, program: RecurringProgram, todayIso: string): Promise<void> {
  if (!program.checkin_before_renewal || !program.next_occurrence_date) return
  const dueDate = addDaysIso(program.next_occurrence_date, -CHECKIN_DAYS_BEFORE)
  if (dueDate > addDaysIso(todayIso, CHECKIN_WINDOW_DAYS) || program.next_occurrence_date < todayIso) return

  const { count, error } = await supabase
    .from('followups')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', program.client_id)
    .eq('automation_rule_id', RENEWAL_CHECKIN_RULE_ID)
    .eq('done', false)
    .is('cancelled_at', null)
  if (error) throw error
  if ((count ?? 0) > 0) return

  const { data: client } = await supabase.from('clients').select('first_name, full_name').eq('id', program.client_id).single()
  const firstName = client?.first_name || client?.full_name?.split(' ')[0] || ''
  const { error: insertError } = await supabase.from('followups').insert({
    user_id: userId,
    client_id: program.client_id,
    title: i18n.t('recurring_program.checkin_followup_title', { name: firstName }),
    due_date: dueDate < todayIso ? todayIso : dueDate,
    done: false,
    auto_generated: true,
    action_type: 'whatsapp',
    automation_rule_id: RENEWAL_CHECKIN_RULE_ID,
  })
  if (insertError) throw insertError
}

export async function processAutoRenewals(userId: string): Promise<void> {
  const todayIso = localIso(new Date())
  const { data, error } = await supabase
    .from('recurring_programs')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .eq('renewal_mode', 'company_auto')
    .not('next_occurrence_date', 'is', null)
  if (error) throw error
  for (const program of (data ?? []) as RecurringProgram[]) {
    try {
      await processProgram(userId, program, todayIso)
      const { data: fresh } = await supabase.from('recurring_programs').select('*').eq('id', program.id).single()
      if (fresh) await ensureCheckinFollowup(userId, fresh as RecurringProgram, todayIso)
    } catch (e) {
      // Un programme en erreur ne bloque jamais les autres.
      console.error('[autoRenewal.program]', program.id, e)
    }
  }
}

// "Ce renouvellement n'a pas eu lieu" : l'échéance devient "non réalisée" et la commande recopiée
// automatiquement est supprimée. Le calendrier n'est pas modifié (une échéance non réalisée
// consomme son cycle, comme skipOccurrence) ; les commandes saisies à la main restent intactes.
export async function revertAutoRenewal(occurrence: RecurringProgramOccurrence): Promise<void> {
  if (!occurrence.auto_confirmed || occurrence.status !== 'confirmed') return
  const { data: autoOrders, error } = await supabase
    .from('orders')
    .select('id')
    .eq('recurring_occurrence_id', occurrence.id)
    .eq('auto_renewal', true)
  if (error) throw error
  for (const order of autoOrders ?? []) await deleteOrder(order.id)

  const { error: updateError } = await supabase
    .from('recurring_program_occurrences')
    .update({
      status: 'skipped',
      confirmed_at: null,
      notes: i18n.t('recurring_program.auto_renewal_reverted_note'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', occurrence.id)
  if (updateError) throw updateError
}
