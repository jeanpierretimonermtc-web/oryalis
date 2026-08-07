import { useState, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useOrders } from '@/features/orders/useOrders'
import { OrderEditModal } from '@/features/orders/OrderEditModal'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import { AdvisorGate } from '@/features/subscriptions/AdvisorGate'
import type { Order } from '@/shared/lib/types'

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
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: 'cancel' | 'delete' } | null>(null)

  const activeOrders = orders.filter(o => !o.cancelled_at)
  const sortedOrders = orders
    .slice()
    .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())

  return (
    <>
      <Stack.Screen options={{ title: t('orders.title'), headerBackTitle: '' }} />
      <AdvisorGate feature={t('subscription.features.orders')}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

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
            return (
              <TouchableOpacity
                key={order.id}
                style={[styles.card, isCancelled && styles.cardCancelled]}
                onPress={() => { if (!isCancelled) setEditingOrder(order) }}
                activeOpacity={isCancelled ? 1 : 0.7}
              >
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    <View style={styles.cardDateRow}>
                      <Text style={styles.cardDate}>{formatDate(order.order_date, locale)}</Text>
                      {order.client?.full_name ? (
                        <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); router.push(`/(app)/clients/${order.client_id}` as any) }}>
                          <Text style={styles.cardClient} numberOfLines={1}>{order.client.full_name}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <Text style={[styles.cardProduct, isCancelled && styles.cardTextCancelled]} numberOfLines={1}>{order.product_name}</Text>
                  </View>
                  <View style={styles.cardRight}>
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
                    ) : null}
                    {order.is_lrp ? (
                      <View style={[styles.badge, { backgroundColor: colors.secondaryLight }]}>
                        <Text style={[styles.badgeText, { color: colors.secondary }]}>{t('orders.lrp')}</Text>
                      </View>
                    ) : null}
                    {order.amount != null ? (
                      <Text style={[styles.cardAmount, isCancelled && styles.cardTextCancelled]}>{order.amount.toFixed(2)}€</Text>
                    ) : null}
                  </View>
                </View>
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
        <OrderEditModal order={editingOrder} onClose={() => setEditingOrder(null)} onSave={update} />
      ) : null}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },
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
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiLeft:     { gap: 2 },
  kpiLabel:    { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  kpiValue:    { fontSize: 28, fontFamily: fonts.bold, color: colors.primary },
  kpiRight:    { alignItems: 'flex-end', gap: 2 },
  kpiSubLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  kpiSubValue: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cardCancelled: { opacity: 0.55 },
  cardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLeft:   { flex: 1, gap: 2 },
  cardDateRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardDate:   { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  cardClient: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
  cardProduct:{ fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  cardTextCancelled: { textDecorationLine: 'line-through' },
  cardRight:  { alignItems: 'flex-end', gap: 4 },
  cardAmount: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  cardNotes:  { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 18 },

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
