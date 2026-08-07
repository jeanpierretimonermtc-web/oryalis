import { useState, useEffect, useCallback } from 'react'
import { fetchOrders, createOrder, deleteOrder, updateOrder, cancelOrder } from './orderService'
import type { OrderFilters, OrderInput, OrderEditInput, CreateOrderResult } from './orderService'
import type { Order } from '@/shared/lib/types'

export function useOrders(filters: OrderFilters = {}) {
  const [orders, setOrders]   = useState<Order[]>([])
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

  // Une commande annulée n'a jamais été honorée — exclue du chiffre d'affaires affiché.
  const totalAmount = orders
    .filter(o => o.order_type !== 'personal' && !o.cancelled_at)
    .reduce((sum, o) => sum + (o.amount ?? 0), 0)

  return { orders, loading, error, reload: load, add, remove, update, cancel, totalAmount }
}

export function useClientOrders(clientId: string) {
  return useOrders({ client_id: clientId })
}
