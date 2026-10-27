// ORDER-BUSINESS-2 — SEULE implémentation des lignes de commande structurées (order_items) :
// lecture hybride (order_items si disponibles, sinon repli sur orders.products/product_name),
// et écriture par diff d'identité stable (UPDATE l'existant, INSERT le nouveau, DELETE le
// retiré) — jamais un pattern DELETE ALL + INSERT ALL qui détruirait les ids stables dont
// dépendront les futurs retours partiels et snapshots de valeur MLM (§22).
import { supabase } from '@/shared/lib/supabase'
import type { Order, OrderItem, OrderProduct } from '@/shared/lib/types'

// ORDER-BUSINESS-2 §23/§25 — SEULE implémentation du repli "commande simple" (product_name +
// amount) vers une ligne unique, quand aucune structure de lignes n'existe encore pour cette
// commande. Remplace les 4 fallbacks auparavant dupliqués (récap RDV, correspondance produits
// abordés, liste des commandes du RDV, résumé "copie de mes données" côté Contact). Opère sur
// `order.products` (jsonb) — tenu en miroir de order_items par saveOrderItems (§24) — donc reste
// exact pour les commandes créées/éditées APRÈS ce lot, pas seulement les commandes legacy.
// ORDER-BUSINESS-4.2 §4 — jamais un `returnedQty` deviné pour une ligne legacy (JSON
// orders.products n'a aucune notion de retour) : toujours 0, explicitement, jamais laissé
// `undefined` à interpréter par chaque consommateur différemment.
export function deriveOrderLines(order: Pick<Order, 'products' | 'product_name' | 'amount'>): OrderProduct[] {
  if (order.products && order.products.length > 0) return order.products.map(p => ({ ...p, returnedQty: 0 }))
  return [{ name: order.product_name, qty: 1, price: order.amount ?? undefined, returnedQty: 0 }]
}

export async function fetchOrderItems(orderId: string): Promise<OrderItem[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as OrderItem[]
}

// ORDER-BUSINESS-4.2 §35 — lecture GROUPÉE (1 requête pour N commandes), pour éviter un fetch
// order_items par commande dans le dashboard/les listes (voir computeOrderNetAmount, consommée
// par useOrders.totalAmount, useMonthlyRevenue, goalService).
export async function fetchOrderItemsForOrders(orderIds: string[]): Promise<Map<string, OrderItem[]>> {
  const map = new Map<string, OrderItem[]>()
  if (orderIds.length === 0) return map
  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .in('order_id', orderIds)
  if (error) throw new Error(error.message)
  for (const item of (data ?? []) as OrderItem[]) {
    const list = map.get(item.order_id)
    if (list) list.push(item)
    else map.set(item.order_id, [item])
  }
  return map
}

// ORDER-BUSINESS-4.2 §5/§6 — quantité NETTE, jamais stockée en base (même doctrine que les
// snapshots MLM : stockage unitaire/historique, calcul dérivé). `quantity` (brute, commandée)
// n'est JAMAIS modifiée par un retour — seul `returnedQty` change (§7).
export function getNetQuantity(quantity: number, returnedQty: number): number {
  return Math.max(quantity - returnedQty, 0)
}

export type OrderReturnStatus = 'none' | 'partial' | 'full_pending'

// ORDER-BUSINESS-4.2.1 §6/§7/§8 — statut de retour DÉRIVÉ des order_items structurés, jamais
// stocké : 'none' (aucune ligne retournée, ou commande legacy sans order_items — aucune notion
// de retour possible dans ce cas) ; 'partial' (au moins une ligne retournée, au moins une
// quantité nette restante > 0) ; 'full_pending' (toutes les lignes à net_qty=0 mais
// `orders.status` n'est pas encore 'returned' — reflète la bannière de proposition
// d'OrderEditModal, §16/§23 ORDER-BUSINESS-4.2, jamais un changement automatique de status).
export function getOrderReturnStatus(items: OrderItem[] | undefined): OrderReturnStatus {
  if (!items || items.length === 0) return 'none'
  const hasAnyReturn = items.some(item => item.returned_qty > 0)
  if (!hasAnyReturn) return 'none'
  const allNetZero = items.every(item => getNetQuantity(item.quantity, item.returned_qty) === 0)
  return allNetZero ? 'full_pending' : 'partial'
}

// ORDER-BUSINESS-2.2 §4/§6 — id STABLE généré côté application, attribué à une ligne dès sa
// création dans l'UI (jamais attendu de la base) : permet à saveOrderItems() de reconnaître un
// retry après échec (même id renvoyé) comme la MÊME ligne, jamais une seconde — voir usage dans
// OrderEditModal.tsx. UUID v4 simple (Math.random) : identité d'une ligne côté client, aucun
// besoin cryptographique, pas de nouvelle dépendance (expo-crypto) pour ce seul usage interne.
export function generateOrderItemId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const r = (Math.random() * 16) | 0
    const v = char === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// ORDER-BUSINESS-4.2.1 §1/§3 — exportée : réutilisée directement par tout appelant disposant
// déjà de ses order_items via une lecture GROUPÉE (fetchOrderItemsForOrders), sans repasser par
// un second fetch par commande (voir hybridLinesFromItems ci-dessous).
export function mapOrderItemToProduct(item: OrderItem): OrderProduct {
  return {
    id: item.id,
    product_id: item.catalog_product_id ?? undefined,
    name: item.product_name_snapshot,
    qty: item.quantity,
    price: item.unit_price ?? undefined,
    returnedQty: item.returned_qty,
  }
}

// ORDER-BUSINESS-4.2.1 §1/§2/§3 — même doctrine hybride que getOrderItemsHybrid (order_items en
// priorité, repli deriveOrderLines sinon), mais à partir d'items DÉJÀ chargés (ex. via une lecture
// groupée fetchOrderItemsForOrders pour plusieurs commandes à la fois) — jamais un second appel
// réseau par commande. SEULE implémentation de cette doctrine : getOrderItemsHybrid délègue
// désormais ici, aucune logique dupliquée entre le chemin "une commande" et "plusieurs commandes".
export function hybridLinesFromItems(
  order: Pick<Order, 'products' | 'product_name' | 'amount'>,
  items: OrderItem[] | undefined,
): OrderProduct[] {
  if (items && items.length > 0) return items.map(mapOrderItemToProduct)
  return deriveOrderLines(order)
}

// ORDER-BUSINESS-4.2 §8 — SEULE fonction d'écriture de `returned_qty`, jamais mêlée à
// saveOrderItems (§7 : un retour ne modifie que cette colonne, jamais quantity/unit_price/
// catalog_product_id/product_name_snapshot — saveOrderItems ne référence d'ailleurs jamais
// returned_qty dans ses payloads, elle reste donc intacte lors de toute édition de ligne
// classique). Valide côté service AVANT d'écrire (entier, >= 0, <= quantity) — défense en
// profondeur, la contrainte DB (order_items_returned_qty_check) reste l'autorité finale.
export async function updateOrderItemReturnedQty(orderItemId: string, returnedQty: number): Promise<OrderItem> {
  if (!Number.isInteger(returnedQty) || returnedQty < 0) throw new Error('invalid_returned_qty')
  const { data: current, error: fetchError } = await supabase
    .from('order_items').select('quantity').eq('id', orderItemId).single()
  if (fetchError) throw new Error(fetchError.message)
  if (returnedQty > current.quantity) throw new Error('returned_qty_exceeds_quantity')
  const { data, error } = await supabase
    .from('order_items')
    .update({ returned_qty: returnedQty, updated_at: new Date().toISOString() })
    .eq('id', orderItemId)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as OrderItem
}

// ORDER-BUSINESS-4.2 §10/§19/§20/§21/§22 — montant NET d'une commande, dérivé des lignes
// structurées quand disponibles (quantité NETTE × prix unitaire, jamais une conversion devise —
// §19). `orders.amount` reste le montant BRUT historique, jamais réécrit silencieusement par un
// retour (§20) — cette fonction ne fait que CALCULER un montant différent à la lecture, ailleurs.
// Cas legacy sans order_items structurés : comportement historique conservé tel quel
// (order.amount brut, aucun retour n'existe à ce niveau de détail — §21 du rapport).
// ORDER-BUSINESS-4.2.1 §12 — audité explicitement : `unit_price ?? 0` pourrait sous-évaluer une
// commande structurée si certaines lignes avaient un `unit_price` NULL (un prix inconnu ne doit
// jamais devenir 0€ silencieusement). Vérifié en production (lecture seule, 22 order_items) :
// **0 ligne avec unit_price NULL** actuellement — ce cas ne se produit pas aujourd'hui. Si des
// lignes à prix NULL apparaissent un jour (produit ajouté sans prix), ce comportement resterait à
// documenter/décider explicitement AVANT de faire confiance à ce calcul pour cette commande —
// non traité ici en l'absence de cas réel (§ rapport ORDER-BUSINESS-4.2.1 §11).
export function computeOrderNetAmount(order: { amount: number | null }, items: OrderItem[] | undefined): number {
  if (!items || items.length === 0) return order.amount ?? 0
  return items.reduce((sum, item) => sum + (item.unit_price ?? 0) * getNetQuantity(item.quantity, item.returned_qty), 0)
}

// ORDER-BUSINESS-2 §23 — lecture hybride OFFICIELLE, réutilisée partout où l'édition a besoin
// d'ids stables (OrderEditModal) : order_items en priorité (source détaillée), repli sur
// deriveOrderLines si la commande n'a pas encore de lignes structurées en base (jamais migrée,
// ou tout juste créée avant que le premier saveOrderItems n'ait eu lieu).
export async function getOrderItemsHybrid(order: Pick<Order, 'id' | 'products' | 'product_name' | 'amount'>): Promise<OrderProduct[]> {
  const items = await fetchOrderItems(order.id)
  return hybridLinesFromItems(order, items)
}

// ORDER-BUSINESS-2 §20/§21/§22 — SEULE fonction d'écriture des lignes d'une commande, appelée
// depuis orderService.ts (createOrder/upsertOrderForAppointment/updateOrder) — jamais une
// écriture divergente ailleurs. Diff par id : une ligne DB absente de `desiredLines` est
// supprimée, chaque ligne de `desiredLines` est écrite via upsert sur son id — jamais un pattern
// DELETE ALL + INSERT ALL qui détruirait des ids stables.
//
// ORDER-BUSINESS-2.2 §1/§2/§4/§6 — IDEMPOTENCE PAR ID, pas seulement par présence/absence d'id :
// une ligne "nouvelle" porte désormais TOUJOURS un id généré côté client dès sa création dans
// l'UI (voir generateOrderItemId, OrderEditModal.tsx), jamais laissé vide jusqu'à un retour
// serveur. Ici, `.upsert()` (INSERT ... ON CONFLICT (id) DO UPDATE) est utilisé pour toute ligne
// porteuse d'un id : que cet id existe déjà en base (retry après un échec ultérieur dans le même
// enregistrement, ou ligne déjà connue) ou pas encore (premier essai, ou échec avant que
// l'INSERT n'ait pu committer), le résultat final est IDENTIQUE et sans second id créé — un
// retry rejoue littéralement la même écriture. Seule une ligne SANS id (flux RDV, non concerné
// par ce correctif — voir rapport ORDER-BUSINESS-2.2 §8) passe par un INSERT simple, id généré
// par la base comme avant : ce chemin ne bénéficie pas encore de cette garantie d'idempotence,
// documenté explicitement.
// ORDER-BUSINESS-2.1 §7 — l'identité d'une ligne est TOUJOURS `order_items.id` (`line.id`),
// jamais `catalog_product_id` : deux lignes peuvent légitimement référencer le même produit
// catalogue (ex. "BalanceOil ×1" ajoutée deux fois séparément, ou avec des prix différents) sans
// jamais être confondues ni fusionnées par ce diff.
// ORDER-BUSINESS-3.1 §3 — retourne les lignes RÉELLEMENT écrites, dans le MÊME ORDRE que
// `desiredLines` (poussées au fil de la boucle, jamais re-triées) : permet à un appelant qui a
// construit `desiredLines` par `.map()` depuis sa propre liste ordonnée (ex. applyOutcomePlanActions
// depuis plan.saleOrder.products) de retrouver l'id réel de CHAQUE ligne par correspondance
// d'index — y compris une ligne sans id au départ (nouvelle vente RDV) qui vient de recevoir son
// premier id généré par la base. Aucune ambiguïté de tri (created_at) : chaque id vient
// directement de la réponse de son propre upsert/insert, jamais d'un refetch trié après coup.
//
// ORDER-BUSINESS-3.4.1 §1-§8 — deux chemins d'écriture distincts par ligne, selon le risque réel :
//   - NEW ou changement RÉEL de catalog_product_id : RPC transactionnelle
//     (upsert_order_item_with_metric_sync) — écrit la ligne ET synchronise ses snapshots dans
//     UNE SEULE transaction Postgres. Élimine par construction l'état intermédiaire "ligne écrite,
//     snapshot pas écrit" qu'un retry ne pouvait pas distinguer d'une ligne legacy stable (bug
//     confirmé du rapport ORDER-BUSINESS-3.4 : classée "existing + même produit" au retry, donc
//     plus jamais resynchronisée). Un échec À N'IMPORTE QUELLE étape de la RPC annule TOUT : la
//     ligne retombe exactement sur son état d'avant cet appel (absente si vraiment nouvelle, ou
//     sur son ANCIEN produit + anciens snapshots intacts si un changement de produit échoue en
//     cours de route) — un retry immédiat repart donc d'un état propre et sans ambiguïté.
//   - Existante, MÊME catalog_product_id : plain upsert (aucun risque cross-table, cette branche
//     n'écrit jamais order_item_metric_snapshots).
// ORDER-BUSINESS-3.4.2 §2/§3 — filet de sécurité CENTRALISÉ : aucune ligne id-less ne doit
// jamais atteindre la RPC (voir p_id NOT NULL côté SQL, défense en profondeur). La correction
// PRINCIPALE reste en amont, dans l'état UI de chaque appelant (OrderEditModal.addCatalogLine/
// addFreeLine, appointments/[id]/index.tsx handleAddSaleProduct/handleAddFreeSaleProduct/
// handleReuseConsideredProducts) — seul un id assigné AVANT le premier essai, et conservé tel
// quel dans l'état React à travers un retry, garantit qu'un batch de plusieurs nouvelles lignes
// converge sans churn (rapport ORDER-BUSINESS-3.4.2 §1-§4) : un id généré ICI, à chaque appel,
// ne survivrait PAS à un retry dont l'appelant ne persiste pas le retour de cette fonction — voir
// doctrine best-effort de persistOrderItemsOnCreate. Ce garde-fou protège seulement contre un
// futur appelant qui oublierait complètement d'assigner un id, jamais contre un appelant qui en
// génère un neuf à chaque tentative.
function ensureLineIds(lines: OrderProduct[]): OrderProduct[] {
  return lines.map(line => line.id ? line : { ...line, id: generateOrderItemId() })
}

export async function saveOrderItems(userId: string, orderId: string, inputLines: OrderProduct[]): Promise<OrderItem[]> {
  const desiredLines = ensureLineIds(inputLines)
  const existing = await fetchOrderItems(orderId)
  // Capture le catalog_product_id AVANT toute écriture, seule façon fiable de distinguer une
  // ligne NOUVELLE d'une ligne EXISTANTE dont le produit change réellement : jamais déduit du
  // nom/de la position/du prix, uniquement de cette identité structurée relue ici, avant mutation.
  const existingById = new Map(existing.map(item => [item.id, item]))
  const keepIds = new Set(desiredLines.filter(line => line.id).map(line => line.id as string))

  const toDelete = existing.filter(item => !keepIds.has(item.id))
  if (toDelete.length > 0) {
    const { error } = await supabase.from('order_items').delete().in('id', toDelete.map(item => item.id))
    if (error) throw new Error(error.message)
  }

  const saved: OrderItem[] = []
  for (const line of desiredLines) {
    const catalogProductId = line.product_id ?? null
    const productNameSnapshot = line.name.trim() || '—'
    const quantity = Math.max(1, Math.trunc(line.qty) || 1)
    const unitPrice = line.price ?? null

    const previousItem = line.id ? existingById.get(line.id) : undefined
    const isNew = previousItem === undefined
    const productChanged = !isNew && previousItem.catalog_product_id !== catalogProductId

    if (isNew || productChanged) {
      const { data, error } = await supabase.rpc('upsert_order_item_with_metric_sync', {
        p_id: line.id, // toujours défini : ensureLineIds() garantit qu'aucune ligne n'atteint la RPC sans id (§2/§3, p_id NOT NULL côté SQL)
        p_user_id: userId,
        p_order_id: orderId,
        p_catalog_product_id: catalogProductId,
        p_product_name_snapshot: productNameSnapshot,
        p_quantity: quantity,
        p_unit_price: unitPrice,
        p_sync_metrics: true,
      })
      if (error) throw new Error(error.message)
      saved.push(data as OrderItem)
    } else {
      // Existante, produit inchangé (§9/§19 ORDER-BUSINESS-3.4) : aucune synchronisation de
      // snapshot nécessaire, donc aucun risque cross-table — plain upsert, pas de RPC.
      const { data, error } = await supabase
        .from('order_items')
        .upsert({
          id: line.id, catalog_product_id: catalogProductId, product_name_snapshot: productNameSnapshot,
          quantity, unit_price: unitPrice, user_id: userId, order_id: orderId, updated_at: new Date().toISOString(),
        })
        .select()
        .single()
      if (error) throw new Error(error.message)
      saved.push(data as OrderItem)
    }
  }
  return saved
}
