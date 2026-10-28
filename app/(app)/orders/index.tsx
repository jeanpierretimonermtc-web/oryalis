import { useState, useMemo, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useOrders } from '@/features/orders/useOrders'
import { getOrderById } from '@/features/orders/orderService'
import { fetchOrderItemsForOrders, getOrderReturnStatus } from '@/features/orders/orderItemService'
import { OrderEditModal } from '@/features/orders/OrderEditModal'
import { getOrderProgramBadge } from '@/features/clients/lrpProgramService'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { ScreenHeader } from '@/shared/components/ui/ScreenHeader'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import { AdvisorGate } from '@/features/subscriptions/AdvisorGate'
import type { OrderListItem, OrderItem } from '@/shared/lib/types'

function getMonthOptions(): { label: string; value: string }[] {
  const now = new Date()
  const options = []
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    options.push({ label, value })
  }
  return options
}

export default function OrdersScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { getLrpName } = useAppConfig()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth)

  const monthFrom = `${selectedMonth}-01`
  const monthTo   = (() => {
    const [y, m] = selectedMonth.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    return `${selectedMonth}-${String(last).padStart(2, '0')}`
  })()

  const { orders, loading, totalAmount, update, cancel, remove } = useOrders({ from: monthFrom, to: monthTo })
  const monthOptions = getMonthOptions()
  const [editingOrder, setEditingOrder] = useState<OrderListItem | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: 'cancel' | 'delete' } | null>(null)

  // RÉCAP-6.1.1 §8 — "Voir la commande" depuis la fiche RDV (/orders?orderId=<id>). Lecture
  // ciblée par id uniquement (getOrderById), indépendante du filtre mois ci-dessus : une
  // commande d'un autre mois reste ouvrable. Le paramètre est nettoyé immédiatement après
  // lecture pour ne jamais rouvrir la modale involontairement (retour arrière, refresh, etc.).
  const { orderId } = useLocalSearchParams<{ orderId?: string }>()
  useEffect(() => {
    if (!orderId) return
    router.setParams({ orderId: undefined } as any)
    getOrderById(orderId).then(found => { if (found) setEditingOrder(found) }).catch(() => {})
  }, [orderId])

  const activeOrders = orders.filter(o => !o.cancelled_at)
  const sortedOrders = orders
    .slice()
    .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())

  // ORDER-BUSINESS-4.2.1 §6/§7/§8/§10/§12 — lecture GROUPÉE des order_items pour TOUTES les
  // commandes visibles (jamais une requête par commande), pour dériver un indicateur de retour
  // partiel sans jamais lire/modifier `orders.status`. Reclenchée automatiquement à chaque
  // changement de `orders` (filtre mois, ou après update/cancel/remove qui appellent tous
  // setOrders). Un retour enregistré via OrderItemReturnModal (dans OrderEditModal) n'appelle PAS
  // `update`/`onSave` — il écrit directement order_items sans jamais changer `orders` ici — donc
  // reclenchée EN PLUS explicitement à la fermeture de la modale (OrderEditModal étant une modale
  // sur cet écran, jamais une navigation de route, aucun useFocusEffect ne peut la couvrir ici,
  // contrairement à clients/[id]/index.tsx et appointments/[id]/index.tsx qui rechargent déjà au
  // focus après une navigation réelle vers/depuis /orders).
  const [orderItemsByOrderId, setOrderItemsByOrderId] = useState<Map<string, OrderItem[]>>(new Map())
  const loadOrderItems = useCallback(() => {
    let cancelled = false
    fetchOrderItemsForOrders(orders.map(o => o.id)).then(map => { if (!cancelled) setOrderItemsByOrderId(map) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders])
  useEffect(() => loadOrderItems(), [loadOrderItems])

  return (
    <>
      <Stack.Screen options={{ title: t('orders.title'), headerBackTitle: '' }} />
      <AdvisorGate feature={t('subscription.features.orders')}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <ScreenHeader flush eyebrow={t('orders.header_eyebrow')} title={t('orders.title')} subtitle={t('orders.header_subtitle')} />

        {/* ── Filtre mois ────────────────────────────────────────── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.monthRow}>
          {monthOptions.map(opt => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.monthChip, selectedMonth === opt.value && styles.monthChipActive]}
              onPress={() => setSelectedMonth(opt.value)}
              activeOpacity={0.7}
            >
              <Text style={[styles.monthChipText, selectedMonth === opt.value && styles.monthChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── KPI CA ─────────────────────────────────────────────── */}
        <View style={styles.kpiCard}>
          <View style={styles.kpiLeft}>
            <Text style={styles.kpiLabel}>{t('orders.total_month')}</Text>
            <Text style={styles.kpiValue}>{totalAmount.toFixed(2)}€</Text>
          </View>
          <View style={styles.kpiRight}>
            <Text style={styles.kpiSubLabel}>{t('orders.title')}</Text>
            <Text style={styles.kpiSubValue}>{activeOrders.length}</Text>
          </View>
        </View>

        {/* ── Liste ──────────────────────────────────────────────── */}
        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={colors.primary} />
        ) : sortedOrders.length === 0 ? (
          <EmptyState
            message={t('orders.empty')}
            icon="📦"
            actionLabel={t('clients.title')}
            onAction={() => router.push('/(app)/clients')}
          />
        ) : (
          sortedOrders.map(order => {
            const isCancelled = !!order.cancelled_at
            const programBadge = getOrderProgramBadge(order, getLrpName())
            // ORDER-BUSINESS-4.2.1 §7/§9 — `status='returned'` garde TOUJOURS la priorité (retour
            // total déjà confirmé, y compris une commande legacy avec returned_qty=0 sur ses
            // lignes — §9 : le statut historique prime, jamais reconstruit depuis les lignes).
            // Le statut dérivé des lignes n'intervient QUE si le statut DB n'est pas déjà 'returned'.
            const returnStatus = order.status === 'returned' ? 'none' : getOrderReturnStatus(orderItemsByOrderId.get(order.id))
            const hasBadges = isCancelled || order.order_type === 'personal' || order.status === 'returned' || returnStatus !== 'none' || !!programBadge
            return (
              <TouchableOpacity
                key={order.id}
                style={[styles.card, isCancelled && styles.cardCancelled]}
                onPress={() => { if (!isCancelled) setEditingOrder(order) }}
                activeOpacity={isCancelled ? 1 : 0.7}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    {/* LRP-4.5 §4 — le contact doit être identifié en premier, avant la date :
                        avec un volume élevé de commandes, c'est la première question de
                        l'utilisateur ("à qui appartient cette commande ?"), pas "quand". */}
                    {order.client?.full_name ? (
                      <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); router.push(`/(app)/clients/${order.client_id}` as any) }}>
                        <Text style={styles.cardClient} numberOfLines={1}>{order.client.full_name}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <Text style={styles.cardDate} numberOfLines={1}>{formatDate(order.order_date, locale)}</Text>
                    <Text style={[styles.cardProduct, isCancelled && styles.cardTextCancelled]} numberOfLines={1}>{order.product_name}</Text>
                  </View>
                  {order.amount != null ? (
                    <Text style={[styles.cardAmount, isCancelled && styles.cardTextCancelled]} numberOfLines={1}>{order.amount.toFixed(2)}€</Text>
                  ) : null}
                </View>
                {hasBadges ? (
                  <View style={styles.badgeRow}>
                    {isCancelled ? (
                      <View style={[styles.badge, { backgroundColor: colors.bgDim }]}>
                        <Text style={[styles.badgeText, { color: colors.textTertiary }]}>{t('orders.status_cancelled')}</Text>
                      </View>
                    ) : null}
                    {order.order_type === 'personal' ? (
                      <View style={[styles.badge, { backgroundColor: colors.bgDim }]}>
                        <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{t('orders.order_types.personal')}</Text>
                      </View>
                    ) : null}
                    {order.status === 'returned' ? (
                      <View style={[styles.badge, { backgroundColor: colors.dangerLight }]}>
                        <Text style={[styles.badgeText, { color: colors.danger }]}>{t('orders.status_returned')}</Text>
                      </View>
                    ) : returnStatus === 'partial' ? (
                      <View style={[styles.badge, { backgroundColor: colors.dangerLight }]}>
                        <Text style={[styles.badgeText, { color: colors.danger }]}>{t('orders.status_partial_return')}</Text>
                      </View>
                    ) : returnStatus === 'full_pending' ? (
                      <View style={[styles.badge, { backgroundColor: colors.dangerLight }]}>
                        <Text style={[styles.badgeText, { color: colors.danger }]}>{t('orders.status_full_return_pending')}</Text>
                      </View>
                    ) : null}
                    {programBadge ? (
                      <View style={[styles.badge, { backgroundColor: programBadge.kind === 'linked' ? colors.secondaryLight : colors.bgDim }]}>
                        <Text style={[styles.badgeText, { color: programBadge.kind === 'linked' ? colors.secondary : colors.textTertiary }]}>
                          {programBadge.kind === 'linked' ? programBadge.label : t('orders.legacy_program_badge', { name: programBadge.label })}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {order.notes ? <Text style={styles.cardNotes}>{order.notes}</Text> : null}
                {confirmAction?.id === order.id ? (
                  <View style={styles.inlineConfirmRow}>
                    <Text style={styles.inlineConfirmText}>
                      {confirmAction.type === 'cancel' ? t('orders.cancel_confirm') : t('orders.delete_confirm')}
                    </Text>
                    <View style={styles.cardActions}>
                      <TouchableOpacity onPress={() => setConfirmAction(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.returnBtnText}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => {
                          if (confirmAction.type === 'cancel') cancel(order.id)
                          else remove(order.id)
                          setConfirmAction(null)
                        }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.deleteBtnText}>{t('common.confirm')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.cardActions}>
                    {!isCancelled ? (
                      <TouchableOpacity
                        onPress={() => setConfirmAction({ id: order.id, type: 'cancel' })}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.returnBtnText}>{t('orders.cancel_order')}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => setConfirmAction({ id: order.id, type: 'delete' })}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.deleteBtnText}>{t('common.delete')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            )
          })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
      </AdvisorGate>

      {editingOrder ? (
        <OrderEditModal
          order={editingOrder}
          onClose={() => { setEditingOrder(null); loadOrderItems() }}
          onSave={update}
        />
      ) : null}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content:   { padding: 16, gap: 12, maxWidth: 800, alignSelf: 'center', width: '100%' },

  monthRow: { gap: 8, paddingBottom: 4 },
  monthChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  monthChipActive:    { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  monthChipText:      { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  monthChipTextActive:{ fontFamily: fonts.semibold, color: colors.primary },

  kpiCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(27, 36, 51, 0.05)' }, { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(27, 36, 51, 0.06)' }],
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiLeft:     { gap: 2 },
  kpiLabel:    { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  kpiValue:    { fontSize: 28, fontFamily: fonts.display, color: colors.text, letterSpacing: -0.5 },
  kpiRight:    { alignItems: 'flex-end', gap: 2 },
  kpiSubLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  kpiSubValue: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },

  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(27, 36, 51, 0.05)' }, { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(27, 36, 51, 0.06)' }],
    gap: 6,
  },
  cardCancelled: { opacity: 0.55 },
  cardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  cardLeft:   { flex: 1, gap: 2 },
  // LRP-4.5 §4/§17 — le contact prime visuellement sur la date (taille/graisse), sans surcharger
  // la carte : même hiérarchie de champs qu'avant, ordre et poids inversés.
  cardClient: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  cardDate:   { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary, marginTop: 1, flexShrink: 0 },
  cardProduct:{ fontSize: 14, fontFamily: fonts.semibold, color: colors.text, marginTop: 2 },
  cardTextCancelled: { textDecorationLine: 'line-through' },
  // LRP-4.6 §21 — flexShrink:0 défensif : un montant/nom ne doit jamais se compresser
  // caractère par caractère sur une carte étroite, même si ce n'est pas le cas observé ici.
  cardAmount: { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flexShrink: 0 },
  cardNotes:  { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 18 },

  badgeRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: fonts.bold },

  cardActions:   { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
  deleteBtn:     { alignSelf: 'flex-end' },
  deleteBtnText: { fontSize: 11, fontFamily: fonts.medium, color: colors.danger },
  returnBtnText: { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary },
  inlineConfirmRow:  { gap: 6, alignItems: 'flex-end' },
  inlineConfirmText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, alignSelf: 'stretch' },
  })
}
