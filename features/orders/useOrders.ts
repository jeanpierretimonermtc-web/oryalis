import { useState, useEffect, useCallback } from 'react'
import { fetchOrders, createOrder, deleteOrder, updateOrder, cancelOrder, isOrderNetRevenue } from './orderService'
import type { OrderFilters, OrderInput, OrderEditInput, CreateOrderResult } from './orderService'
import { fetchOrderItemsForOrders, computeOrderNetAmount } from './orderItemService'
import type { OrderListItem } from '@/shared/lib/types'

export function useOrders(filters: OrderFilters = {}) {
  const [orders, setOrders]   = useState<OrderListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setOrders(await fetchOrders(filters))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.client_id, filters.from, filters.to, filters.is_lrp, filters.status, filters.order_type])

  useEffect(() => { load() }, [load])

  const add = useCallback(async (userId: string, input: OrderInput): Promise<CreateOrderResult | null> => {
    try {
      const result = await createOrder(userId, input)
      setOrders(prev => [result.order, ...prev])
      return result
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur création')
      return null
    }
  }, [])

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteOrder(id)
      setOrders(prev => prev.filter(o => o.id !== id))
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur suppression')
      return false
    }
  }, [])

  const update = useCallback(async (id: string, input: OrderEditInput): Promise<boolean> => {
    try {
      const updated = await updateOrder(id, input)
      setOrders(prev => prev.map(o => o.id === id ? updated : o))
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur modification')
      return false
    }
  }, [])

  const cancel = useCallback(async (id: string): Promise<boolean> => {
    try {
      await cancelOrder(id)
      setOrders(prev => prev.map(o => o.id === id ? { ...o, cancelled_at: new Date().toISOString() } : o))
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur annulation')
      return false
    }
  }, [])

  // LRP-4.6 §6 — CA NET : une commande retournée avait été livrée puis reprise, elle ne compte
  // plus dans le chiffre d'affaires réel malgré son statut "non annulée" (bug corrigé ici,
  // isOrderNetRevenue étant désormais la seule définition de ce périmètre — reste un simple
  // prédicat d'ÉLIGIBILITÉ, jamais un calcul de montant, §22 ORDER-BUSINESS-4.2).
  // ORDER-BUSINESS-4.2 §12/§21 — le MONTANT, lui, doit désormais être NET des retours partiels :
  // computeOrderNetAmount recalcule depuis les order_items structurés quand ils existent (sinon
  // repli sur order.amount brut historique, §21 du rapport). Lecture GROUPÉE (une seule requête
  // pour toutes les commandes éligibles, jamais un fetch par commande, §35) déclenchée à chaque
  // changement de `orders` (chargement initial ET add/remove/update/cancel, qui appellent tous
  // setOrders) — reproduit la même réactivité que l'ancien calcul synchrone, devenu asynchrone
  // uniquement parce qu'il a désormais besoin des lignes.
  const [totalAmount, setTotalAmount] = useState(0)
  useEffect(() => {
    let cancelled = false
    const eligible = orders.filter(isOrderNetRevenue)
    fetchOrderItemsForOrders(eligible.map(o => o.id)).then(itemsByOrder => {
      if (cancelled) return
      setTotalAmount(eligible.reduce((sum, o) => sum + computeOrderNetAmount(o, itemsByOrder.get(o.id)), 0))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [orders])

  return { orders, loading, error, reload: load, add, remove, update, cancel, totalAmount }
}

export function useClientOrders(clientId: string) {
  return useOrders({ client_id: clientId })
}
