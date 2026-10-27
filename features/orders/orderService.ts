import { supabase } from '@/shared/lib/supabase'
import type { Order, OrderListItem, OrderStatus, OrderType, OrderProduct, OrderItem } from '@/shared/lib/types'
import { applyOrderAutomation } from '@/features/automations/automationService'
import type { AutomationPlan } from '@/features/automations/automationService'
import { saveOrderItems, fetchOrderItems } from './orderItemService'

// ORDER-BUSINESS-2 §20 — dérive les lignes à écrire dans order_items pour une commande donnée :
// les lignes structurées si fournies, sinon une ligne unique de synthèse (même convention que
// deriveOrderLines/orderItemService.ts, dupliquée ici en amont de l'écriture pour rester
// utilisable avant même que la commande existe en base).
function linesToPersist(productName: string, amount: number | null | undefined, products?: OrderProduct[] | null): OrderProduct[] {
  if (products && products.length > 0) return products
  return [{ name: productName, qty: 1, price: amount ?? undefined }]
}

// ORDER-BUSINESS-2.1 §2/§3 — asymétrie DÉLIBÉRÉE entre création et modification, seule façon
// d'éliminer le risque de version périmée sans transaction Postgres/RPC (jugée disproportionnée
// ici — voir rapport ORDER-BUSINESS-2.1 §3) :
//
// - CRÉATION (persistOrderItemsOnCreate, best-effort) : aucun order_items préexistant ne peut
//   devenir "périmé" pour une commande qui vient de naître. Si cette écriture échoue,
//   getOrderItemsHybrid() se rabat sur orders.products (déjà correct et complet dans le même
//   insert) — aucune lecture incorrecte possible, seulement "pas encore migré vers order_items".
//   Cohérent avec la doctrine non-transactionnelle déjà appliquée au lien programme récurrent
//   (features/clients/lrpProgramService.ts).
//   ORDER-BUSINESS-2.2 §5 — devenir/rattrapage explicite : une commande ainsi restée
//   temporairement "JSON seul" n'est jamais une dette permanente. La PROCHAINE édition de cette
//   commande via OrderEditModal la répare automatiquement, sans action dédiée : getOrderItemsHybrid
//   se rabat sur deriveOrderLines (order_items vide), OrderEditModal assigne un id à chaque ligne
//   ainsi chargée (ensureLineIds), et le premier saveOrderItems qui suit crée alors les
//   order_items manquants. Rendre cette écriture bloquante à la création n'apporterait donc
//   aucune garantie supplémentaire (le rattrapage est déjà automatique) et ferait échouer la
//   création d'une commande — dont les données réelles (product_name/amount/products) sont
//   déjà intégralement correctes — pour l'échec d'une table secondaire : pire compromis UX pour
//   un gain de cohérence nul.
//
// - MODIFICATION (updateOrder/upsertOrderForAppointment, révision) : order_items PRÉEXISTE déjà
//   et order_items est la source de vérité prioritaire pour la lecture (getOrderItemsHybrid).
//   Un échec silencieux ici laisserait potentiellement d'anciennes lignes order_items
//   prioritaires sur un orders.products fraîchement modifié — EXACTEMENT le risque signalé.
//   Ces deux chemins n'utilisent donc JAMAIS ce helper : ils appellent saveOrderItems()
//   directement (qui lève une exception), et TOUJOURS avant d'écrire le miroir orders — un échec
//   interrompt la sauvegarde entière (throw propagé à l'appelant), orders reste intégralement
//   sur son ancienne valeur, jamais un état où l'un des deux a changé et pas l'autre.
// ORDER-BUSINESS-3.1 §3 — retourne les lignes réellement écrites (même ordre que `lines`) pour
// que l'appelant (ex. applyOutcomePlanActions) puisse apprendre les id fraîchement générés ;
// tableau vide si l'écriture best-effort échoue (voir doctrine ci-dessus, inchangée).
// ORDER-BUSINESS-3.4.1 — RÉ-AUDITÉ : depuis que saveOrderItems écrit une ligne NEW/à-produit-
// changé via la RPC transactionnelle upsert_order_item_with_metric_sync (ligne + snapshots dans
// UNE SEULE transaction Postgres), le "cas B" identifié dans le rapport ORDER-BUSINESS-3.4.1
// (§10 : "order_item créée mais snapshot échoué = état partiellement structuré") NE PEUT PLUS SE
// PRODUIRE — la RPC ne laisse jamais un tel état intermédiaire observable, elle réussit
// entièrement ou échoue entièrement. Ce catch best-effort ne couvre donc plus qu'un seul cas,
// identique à celui déjà accepté par ORDER-BUSINESS-2.1 : l'échec ATOMIQUE complet (ligne +
// snapshots, ensemble) d'une commande qui vient de naître — jamais périmé (rien ne préexistait),
// et auto-réparé par la prochaine édition via OrderEditModal (getOrderItemsHybrid retombe sur le
// JSON, ensureLineIds assigne un id, le premier saveOrderItems qui suit voit une ligne ABSENTE de
// `existing` = classée NEW = repasse par la RPC = ligne ET snapshots recréés ensemble). Sur tous
// les AUTRES chemins (updateOrder, révision RDV via upsertOrderForAppointment), saveOrderItems
// est appelée hors de tout try/catch et lève réellement.
async function persistOrderItemsOnCreate(userId: string, orderId: string, lines: OrderProduct[]): Promise<OrderItem[]> {
  try {
    return await saveOrderItems(userId, orderId, lines)
  } catch (e) {
    console.error('[orderService.persistOrderItemsOnCreate]', e)
    return []
  }
}

export interface OrderFilters {
  client_id?: string
  from?: string
  to?: string
  is_lrp?: boolean
  status?: OrderStatus
  order_type?: OrderType
  recurring_program_id?: string
}

// LRP-4.6 §6 — SEULE définition de "commande comptant dans le CA net", réutilisée par tous les
// calculs de chiffre d'affaires (useOrders.totalAmount, useMonthlyRevenue du dashboard) : jamais
// redupliquée avec une variante qui oublierait une des 3 conditions. Une commande annulée ou
// retournée reste visible dans l'historique (jamais masquée) mais son montant ne compte jamais
// dans un total "net" ; une commande personnelle (auto-consommation MLM) n'a jamais compté dans
// le CA (règle déjà existante, inchangée ici — voir useOrders.ts avant ce lot).
export function isOrderNetRevenue(order: Pick<Order, 'order_type' | 'cancelled_at' | 'status'>): boolean {
  return order.order_type !== 'personal' && !order.cancelled_at && order.status !== 'returned'
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
  // ORDER-SYNC-1 — quand fourni, `product_name` et `amount` sont recalculés automatiquement
  // depuis ces lignes (voir computeOrderProductName/computeOrderProductsTotal) et remplacent
  // toute valeur transmise séparément pour ces deux champs : une seule logique de synthèse,
  // que l'édition modifie une quantité, un prix, ou ajoute/retire une ligne (§9/§10).
  products?: OrderProduct[]
}

// ORDER-SYNC-1 §9 — logique OFFICIELLE unique du total d'une commande structurée, réutilisée à
// la fois à la création (applyOutcomePlanActions, features/appointments/appointmentOutcomeService.ts)
// et à l'édition (updateOrder ci-dessous) : même formule qu'avant (prix unitaire × quantité,
// sommé), jamais un second calcul divergent.
export function computeOrderProductsTotal(products: OrderProduct[]): number {
  return products.reduce((sum, p) => sum + (p.price ?? 0) * p.qty, 0)
}

// ORDER-SYNC-1 §10 — `product_name` sert de résumé lisible de la commande (page Commandes,
// listes) : recalculé avec la même convention qu'à la création (join virgule), jamais laissé
// périmé après une édition des lignes.
export function computeOrderProductName(products: OrderProduct[]): string {
  return products.map(p => p.name || '—').join(', ')
}

// Colonnes vérifiées comme réellement consommées par les écrans qui utilisent cette fonction
// (orders/index.tsx, clients/[id]/orders.tsx, clients/[id]/index.tsx Suivi, OrderEditModal) —
// voir OrderListItem. catalog_id/product_id/quantity/currency/order_number/appointment_id/
// closure_action_key/is_first_order/created_at/updated_at/user_id ne sont lus par aucun d'eux
// (P2.1). `products` ajouté (ORDER-SYNC-1) : OrderEditModal doit savoir si une commande est
// structurée pour l'éditer sans détruire ses lignes (product_id/name/qty/price).
// LRP-4.5 §5 — `recurring_program:recurring_programs(label)` ajouté à cette même requête
// partagée (aucune requête séparée par ligne) pour que les listes de commandes affichent le
// label du programme lié sans aller le chercher ailleurs.
// LRP-OCCURRENCE-LINK-2 — `recurring_occurrence:recurring_program_occurrences(scheduled_date,
// status)` ajouté de la même façon : seule source de vérité pour l'affichage "Échéance" d'une
// commande (recurring_occurrence_id), jamais recurring_occurrence_date (snapshot legacy,
// conservé en base mais plus utilisé côté UI comme relation). Toujours zéro requête
// supplémentaire, y compris pour OrderEditModal qui lit cette même colonne via getOrderById.
// ORDER-APPOINTMENT-TRACE-1 — `appointment_id` (déjà en base depuis Lot 1.2, jamais lu par
// aucun consommateur jusqu'ici) + `source_appointment:appointments(id, start_at, title)` : même
// principe, une seule jointure groupée dans la requête déjà partagée, jamais une requête RDV
// séparée par ligne de commande. Volontairement minimal (ni notes, ni business_context, ni
// tasks) : seul ce qu'affiche OrderEditModal.
const ORDER_LIST_COLS = 'id, client_id, product_name, amount, order_date, status, notes, is_lrp, order_type, cancelled_at, products, recurring_program_id, recurring_occurrence_date, recurring_occurrence_id, appointment_id, client:clients(full_name), recurring_program:recurring_programs(label), recurring_occurrence:recurring_program_occurrences(scheduled_date, status), source_appointment:appointments(id, start_at, title)'

export async function fetchOrders(filters: OrderFilters = {}): Promise<OrderListItem[]> {
  let query = supabase
    .from('orders')
    .select(ORDER_LIST_COLS)
    .order('order_date', { ascending: false })

  if (filters.client_id)           query = query.eq('client_id', filters.client_id)
  if (filters.from)                query = query.gte('order_date', filters.from)
  if (filters.to)                  query = query.lte('order_date', filters.to)
  if (filters.is_lrp !== undefined) query = query.eq('is_lrp', filters.is_lrp)
  if (filters.status)              query = query.eq('status', filters.status)
  if (filters.order_type)          query = query.eq('order_type', filters.order_type)
  if (filters.recurring_program_id) query = query.eq('recurring_program_id', filters.recurring_program_id)

  const { data, error } = await query
  if (error) throw error
  // La chaîne de sélection est parsée par supabase-js à la compilation, qui type par
  // défaut toute relation embarquée comme un tableau — en pratique PostgREST renvoie un
  // objet unique pour cette relation many-to-one (order → client), comme le code
  // consommateur (order.client?.full_name) l'a toujours supposé. `unknown` reconnaît
  // explicitement cet écart entre le type déduit et la forme réelle, sans recourir à `any`.
  return data as unknown as OrderListItem[]
}

export async function getOrdersByClient(clientId: string): Promise<OrderListItem[]> {
  return fetchOrders({ client_id: clientId })
}

// LRP-4 §16 — commandes liées à un programme récurrent, pour la vue détail programme.
export async function getOrdersByRecurringProgram(programId: string): Promise<OrderListItem[]> {
  return fetchOrders({ recurring_program_id: programId })
}

// RÉCAP-6.1.1 §8 — "Voir la commande" depuis la fiche RDV : lecture ciblée par identifiant
// UNIQUEMENT (jamais par client/date/montant), indépendante du filtre mois de l'écran Commandes
// (une commande d'un autre mois que le mois sélectionné doit rester atteignable via ce lien).
export async function getOrderById(id: string): Promise<OrderListItem | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_LIST_COLS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as unknown as OrderListItem | null
}

// RÉCAP-6.1 — colonnes distinctes de ORDER_LIST_COLS : celle-ci omet délibérément `products`
// (jsonb) et `appointment_id`, non consommés par les 3 écrans qui l'utilisent (voir commentaire
// ci-dessus) — mais ce sont exactement les colonnes nécessaires ici (lignes produit détaillées
// de la commande). Source unique utilisée à la fois par la fiche RDV et le compositeur du récap
// (aucune requête métier parallèle) — voir appointments/[id]/index.tsx.
const ORDER_FOR_APPOINTMENT_COLS = 'id, client_id, appointment_id, product_name, products, amount, currency, status, is_lrp, recurring_program_id, cancelled_at, order_date'

export async function getOrdersForAppointment(appointmentId: string): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_FOR_APPOINTMENT_COLS)
    .eq('appointment_id', appointmentId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as Order[]
}

export interface CreateOrderResult {
  order: Order
  isFirstOrder: boolean
  clientFirstName: string
  // true seulement si la ligne vient d'être insérée (jamais sur une mise à jour d'une
  // commande existante) — permet à l'appelant de ne déclencher les automatismes de
  // "nouvelle commande" qu'une seule fois, pas à chaque modification ultérieure.
  created: boolean
  // ORDER-BUSINESS-3.1 §3 — lignes order_items réellement en base pour cette commande, dans le
  // MÊME ORDRE que les lignes fournies en entrée (input.products / linesToPersist) : permet à un
  // appelant (ex. applyOutcomePlanActions) de reporter l'id réel de chaque ligne vers son propre
  // état (ex. AppointmentOutcomeSaleOrderPlan.products) par correspondance d'index. Tableau vide
  // si l'écriture best-effort à la création a échoué (voir persistOrderItemsOnCreate).
  orderItems: OrderItem[]
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
  let orderItems: OrderItem[]

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
      // ORDER-BUSINESS-3.1 §3 — rejeu idempotent : les lignes existent déjà, on les relit telles
      // quelles (jamais recréées) pour que l'appelant apprenne quand même leurs id réels.
      orderItems = await fetchOrderItems(order.id)
    } else {
      throw error
    }
  } else {
    order = data as Order
    isFirstOrder = order.is_first_order ?? false
    // ORDER-BUSINESS-2 §20 — écrite uniquement sur une vraie création (jamais sur le rejeu
    // idempotent ci-dessus, qui retrouve une commande dont les lignes existent déjà — les
    // recréer ici sans id connu les recréerait avec de nouveaux id, contraire à §22).
    orderItems = await persistOrderItemsOnCreate(userId, order.id, linesToPersist(input.product_name, input.amount, input.products))
  }

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('first_name, full_name')
    .eq('id', order.client_id)
    .single()
  if (clientError) throw clientError

  return {
    order,
    orderItems,
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
    // ORDER-BUSINESS-2.1 §1/§2/§6 — order_items écrit AVANT le miroir orders, et son échec
    // INTERROMPT la révision (throw) : voir la doctrine détaillée au-dessus de
    // persistOrderItemsOnCreate. order_items préexiste déjà pour cette commande (elle a été
    // créée par un appel précédent à cette même fonction) — un échec silencieux ici est
    // exactement le scénario dangereux signalé (anciennes lignes order_items prioritaires sur
    // un orders.products fraîchement révisé).
    // ORDER-BUSINESS-3.1 §2/§3 — `input.products` porte désormais un `id` réel pour toute ligne
    // déjà connue (transporté depuis AppointmentOutcomeSaleOrderPlan.products via
    // applyOutcomePlanActions) : saveOrderItems reconnaît alors ces lignes par id (upsert) au
    // lieu de tout supprimer/recréer à chaque révision — quantité modifiée = même id conservé
    // (§27 du rapport ORDER-BUSINESS-3), ligne ajoutée = nouvel id, ligne retirée = suppression
    // ciblée (elle n'apparaît plus dans keepIds). Seule une ligne SANS id (donnée
    // outcome_details antérieure à ce champ, §4) retombe sur l'ancien comportement (insert simple).
    const orderItems = await saveOrderItems(userId, existing.id, linesToPersist(input.product_name, input.amount, input.products))

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({
        product_name: input.product_name,
        products: input.products ?? null,
        amount: input.amount ?? null,
        // LRP-3 §22 — la révision d'une clôture RDV peut corriger le marqueur is_lrp de CETTE
        // commande (même règle que product_name/products/amount ci-dessus), mais ne déclenche
        // jamais d'avancement du programme contact (voir applyOutcomePlanActions, gardé par
        // `created`) — distinct d'éditer une commande historique différente.
        is_lrp: input.is_lrp,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single()
    if (updateError) throw updateError
    // Décision figée relue telle quelle — jamais recalculée à la mise à jour.
    return { order: updated as Order, orderItems, isFirstOrder: existing.is_first_order ?? false, clientFirstName, created: false }
  }

  const isFirstOrder = await isFirstOrderForClient(input.client_id)
  const { data: createdOrder, error: insertError } = await supabase
    .from('orders')
    .insert({ ...input, user_id: userId, appointment_id: appointmentId, is_first_order: isFirstOrder })
    .select()
    .single()
  if (insertError) throw insertError
  // Création (pas de révision) : best-effort, voir doctrine au-dessus de persistOrderItemsOnCreate.
  const orderItems = await persistOrderItemsOnCreate(userId, createdOrder.id, linesToPersist(input.product_name, input.amount, input.products))
  return { order: createdOrder as Order, orderItems, isFirstOrder, clientFirstName, created: true }
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

// LRP-4 §9 — lien commande → programme récurrent, posé en second temps (après la création de
// la commande, jamais avant) : la commande reste enregistrée même si cette écriture secondaire
// échoue, cohérent avec la doctrine non-transactionnelle déjà appliquée au patch programme
// lui-même (voir features/clients/lrpProgramService.ts et son usage dans orders.tsx/
// appointmentOutcomeService.ts).
// LRP-4.3 — `occurrenceDate` porte l'identité de l'échéance consommée (recurring_occurrence_date,
// distincte de order_date, jamais devinée ni écrasée) — voir resolveOccurrenceDateForOrder,
// seule source officielle de cette valeur.
// LRP-5 §7 — `occurrenceId` devient la relation métier PRINCIPALE (recurring_program_occurrences),
// `occurrenceDate` reste écrite en parallèle comme snapshot/compatibilité (jamais supprimée,
// donnée déjà en production) — jamais utilisée seule pour une nouvelle logique.
export async function updateOrderRecurringProgram(
  orderId: string,
  recurringProgramId: string,
  occurrenceId: string | null,
  occurrenceDate: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({
      recurring_program_id: recurringProgramId,
      recurring_occurrence_id: occurrenceId,
      recurring_occurrence_date: occurrenceDate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
  if (error) throw error
}

// LRP-4.1 §4 — dissociation EXPLICITE uniquement (jamais un effet de bord du toggle is_lrp) :
// retire le lien programme d'une commande sans jamais toucher is_lrp (qui reste un marqueur
// historique indépendant, § "une commande peut rester is_lrp=true sans programme associé").
// LRP-5 — dissocier du programme dissocie aussi l'échéance (recurring_occurrence_id) : une
// commande sans programme ne peut pas rester rattachée à une échéance de ce programme.
// recurring_occurrence_date (snapshot) n'est volontairement PAS effacée : trace historique de ce
// que cette commande représentait avant dissociation.
export async function dissociateOrderFromProgram(orderId: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ recurring_program_id: null, recurring_occurrence_id: null, updated_at: new Date().toISOString() })
    .eq('id', orderId)
  if (error) throw error
}

export async function updateOrder(id: string, input: OrderEditInput): Promise<Order> {
  // ORDER-SYNC-1 §9/§10 — quand des lignes produit sont fournies, `amount`/`product_name` sont
  // TOUJOURS recalculés ici depuis ces lignes (jamais une valeur transmise séparément par
  // l'appelant pour ces deux champs) : garantit qu'il n'existe qu'une seule source de vérité
  // pour le total/le résumé d'une commande structurée, quel que soit l'appelant.
  const payload: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() }
  if (input.products) {
    payload.amount = computeOrderProductsTotal(input.products)
    payload.product_name = computeOrderProductName(input.products)
  }

  // ORDER-BUSINESS-2.1 §1/§2/§4/§5 — order_items (source de vérité) est TOUJOURS écrit AVANT le
  // miroir orders.products/amount/product_name, et JAMAIS de façon best-effort ici : une
  // exception interrompt toute la sauvegarde (propagée à l'appelant — useOrders.update()
  // retourne false, OrderEditModal affiche orders.error_save, jamais un faux succès). Résultat :
  // soit les deux ont changé, soit AUCUN des deux n'a changé — jamais un état où orders.products
  // porte la nouvelle version pendant qu'order_items (prioritaire à la lecture, voir
  // getOrderItemsHybrid) garde l'ancienne, silencieusement.
  if (input.products) {
    const { data: owner, error: ownerError } = await supabase.from('orders').select('user_id').eq('id', id).single()
    if (ownerError) throw new Error(ownerError.message)
    await saveOrderItems(owner.user_id, id, input.products)
  } else if (input.product_name !== undefined || input.amount !== undefined) {
    // Édition "simple" (champs Produit/Montant, sans éditeur de lignes) : synchronise la ligne
    // unique existante AVANT que orders.product_name/amount ne changent, avec les valeurs
    // effectivement destinées à être écrites (input.* si fourni, sinon la valeur actuelle) —
    // jamais une valeur pas-encore-écrite lue en retour après coup. Ne touche rien si la
    // commande porte déjà plusieurs lignes (cas contradictoire qui ne devrait pas arriver ici —
    // isStructured côté OrderEditModal gate déjà quelle UI s'affiche — jamais de fusion devinée).
    const { data: current, error: currentError } = await supabase
      .from('orders').select('user_id, product_name, amount').eq('id', id).single()
    if (currentError) throw new Error(currentError.message)
    const existingItems = await fetchOrderItems(id)
    if (existingItems.length <= 1) {
      await saveOrderItems(current.user_id, id, [{
        id: existingItems[0]?.id,
        name: input.product_name !== undefined ? input.product_name : current.product_name,
        qty: 1,
        price: (input.amount !== undefined ? input.amount : current.amount) ?? undefined,
      }])
    }
  }

  const { data, error } = await supabase
    .from('orders')
    .update(payload)
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
