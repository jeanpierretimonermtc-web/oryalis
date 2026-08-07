import { supabase } from '@/shared/lib/supabase'
import type { Order, OrderStatus, OrderType, OrderProduct } from '@/shared/lib/types'
import { applyOrderAutomation } from '@/features/automations/automationService'
import type { AutomationPlan } from '@/features/automations/automationService'

export interface OrderFilters {
  client_id?: string
  from?: string
  to?: string
  is_lrp?: boolean
  status?: OrderStatus
  order_type?: OrderType
}

export interface OrderInput {
  client_id: string
  product_name: string
  catalog_id?: string | null
  product_id?: string | null
  quantity?: number
  amount?: number | null
  currency?: string
  order_date?: string
  order_number?: string | null
  is_lrp?: boolean
  products?: OrderProduct[] | null
  status?: OrderStatus
  order_type?: OrderType
  notes?: string | null
  // Lot 1.2 — RDV source si créée depuis une clôture ("vente réalisée").
  appointment_id?: string | null
  // Lot 1.2.1 §4 — clé d'idempotence déterministe (RDV + révision + type d'action). Protégée
  // par un index unique partiel en base (appointment_id, closure_action_key) : un rejeu du
  // même plan confirmé ne crée jamais une seconde commande, y compris sous concurrence.
  closure_action_key?: string | null
}

export interface OrderEditInput {
  product_name?: string
  amount?: number | null
  order_date?: string
  notes?: string | null
  is_lrp?: boolean
  order_type?: OrderType
}

export async function fetchOrders(filters: OrderFilters = {}): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select('*, client:clients(full_name)')
    .order('order_date', { ascending: false })

  if (filters.client_id)           query = query.eq('client_id', filters.client_id)
  if (filters.from)                query = query.gte('order_date', filters.from)
  if (filters.to)                  query = query.lte('order_date', filters.to)
  if (filters.is_lrp !== undefined) query = query.eq('is_lrp', filters.is_lrp)
  if (filters.status)              query = query.eq('status', filters.status)
  if (filters.order_type)          query = query.eq('order_type', filters.order_type)

  const { data, error } = await query
  if (error) throw error
  return data as Order[]
}

export async function getOrdersByClient(clientId: string): Promise<Order[]> {
  return fetchOrders({ client_id: clientId })
}

export interface CreateOrderResult {
  order: Order
  isFirstOrder: boolean
  clientFirstName: string
  // true seulement si la ligne vient d'être insérée (jamais sur une mise à jour d'une
  // commande existante) — permet à l'appelant de ne déclencher les automatismes de
  // "nouvelle commande" qu'une seule fois, pas à chaque modification ultérieure.
  created: boolean
}

// Ne déclenche plus les relances automatiquement : retourne le contexte
// nécessaire (premier achat ou non, prénom) pour que l'écran propose un choix
// via confirmOrderFollowups() — voir aussi appointmentService.completeAppointment()
// pour le même principe côté RDV.
//
// La décision "première commande" est calculée UNE SEULE FOIS ici et persistée
// (is_first_order) — jamais recalculée à un rejeu, qui relit la valeur déjà figée sur la
// ligne existante plutôt que de recompter les commandes actuelles (correction demandée :
// le nombre de commandes change avec le temps, ce n'est pas une source fiable après coup).
export async function createOrder(userId: string, input: OrderInput): Promise<CreateOrderResult> {
  let order: Order
  let isFirstOrder: boolean

  const { data, error } = await supabase
    .from('orders')
    .insert({
      ...input,
      user_id: userId,
      is_first_order: await isFirstOrderForClient(input.client_id),
    })
    .select()
    .single()
  if (error) {
    // 23505 = violation de l'index unique partiel (appointment_id, closure_action_key) : un
    // plan déjà confirmé est rejoué (double clic, rechargement) — pas une vraie erreur, on
    // renvoie la commande déjà créée plutôt que d'en créer une seconde (Lot 1.2.1 §4). La
    // décision "première commande" est relue depuis cette ligne, jamais recalculée.
    if (error.code === '23505' && input.closure_action_key && input.appointment_id) {
      const { data: existing, error: fetchError } = await supabase
        .from('orders')
        .select('*')
        .eq('appointment_id', input.appointment_id)
        .eq('closure_action_key', input.closure_action_key)
        .single()
      if (fetchError) throw fetchError
      order = existing as Order
      isFirstOrder = existing.is_first_order ?? false
    } else {
      throw error
    }
  } else {
    order = data as Order
    isFirstOrder = order.is_first_order ?? false
  }

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('first_name, full_name')
    .eq('id', order.client_id)
    .single()
  if (clientError) throw clientError

  return {
    order,
    isFirstOrder,
    clientFirstName: client.first_name || client.full_name.split(' ')[0],
    created: !error,
  }
}

async function isFirstOrderForClient(clientId: string): Promise<boolean> {
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .is('cancelled_at', null)
  return (count ?? 0) === 0
}

// Lot 1.2.1 (suite) — un seul appointment ne doit jamais porter deux commandes "vente
// réalisée" : réutilise (met à jour) la commande déjà liée à ce RDV si elle existe, plutôt
// que d'en créer une nouvelle à chaque révision. Corrige à la racine le doublon observé
// (chaque révision recréait une commande car la clé d'idempotence inclut outcome_revision,
// qui change à chaque confirmation).
export async function upsertOrderForAppointment(
  userId: string,
  appointmentId: string,
  input: OrderInput,
): Promise<CreateOrderResult> {
  const { data: existing, error: existingError } = await supabase
    .from('orders')
    .select('*')
    .eq('appointment_id', appointmentId)
    .is('cancelled_at', null)
    .maybeSingle()
  if (existingError) throw existingError

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('first_name, full_name')
    .eq('id', input.client_id)
    .single()
  if (clientError) throw clientError
  const clientFirstName = client.first_name || client.full_name.split(' ')[0]

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        product_name: input.product_name,
        products: input.products ?? null,
        amount: input.amount ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single()
    if (updateError) throw updateError
    // Décision figée relue telle quelle — jamais recalculée à la mise à jour.
    return { order: updated as Order, isFirstOrder: existing.is_first_order ?? false, clientFirstName, created: false }
  }

  const isFirstOrder = await isFirstOrderForClient(input.client_id)
  const { data: createdOrder, error: insertError } = await supabase
    .from('orders')
    .insert({ ...input, user_id: userId, appointment_id: appointmentId, is_first_order: isFirstOrder })
    .select()
    .single()
  if (insertError) throw insertError
  return { order: createdOrder as Order, isFirstOrder, clientFirstName, created: true }
}

// Appelée une fois l'utilisateur ayant validé (ou fermé sans confirmer) la
// modale de choix des relances — voir app/(app)/clients/[id]/orders.tsx.
export async function confirmOrderFollowups(
  userId: string,
  clientId: string,
  firstName: string,
  isFirstOrder: boolean,
  plan?: AutomationPlan,
  appointmentId?: string | null,
  orderId?: string | null,
): Promise<void> {
  await applyOrderAutomation(userId, clientId, firstName, isFirstOrder, plan, appointmentId, orderId)
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function updateOrder(id: string, input: OrderEditInput): Promise<Order> {
  const { data, error } = await supabase
    .from('orders')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Order
}

// Distincte de deleteOrder (suppression définitive) et de status='returned' (produit rendu
// après une vente réelle) : une commande annulée n'a jamais été honorée, mais reste dans
// l'historique — jamais confondue avec les deux autres états. Les relances automatiques
// liées et non encore traitées sont annulées avec elle (jamais celles déjà faites — elles
// restent un fait historique réel, indépendant du sort ultérieur de la commande).
export async function cancelOrder(id: string): Promise<void> {
  const { error } = await supabase.from('orders').update({ cancelled_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error

  await supabase
    .from('followups')
    .update({ cancelled_at: new Date().toISOString() })
    .eq('order_id', id)
    .eq('done', false)
    .is('cancelled_at', null)
}

// Suppression définitive : les relances automatiques liées (order_id) sont supprimées avec
// la commande via ON DELETE CASCADE en base — aucune relance orpheline possible, y compris
// lors d'un accès direct à la base hors application.
export async function deleteOrder(id: string): Promise<void> {
  const { error } = await supabase.from('orders').delete().eq('id', id)
  if (error) throw error
}
