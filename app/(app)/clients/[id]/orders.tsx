import { useState, useMemo, useCallback } from 'react'
import { View, Text, ScrollView, TouchableOpacity, TextInput, Switch, Modal, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClientOrders } from '@/features/orders/useOrders'
import { updateOrderStatus, confirmOrderFollowups } from '@/features/orders/orderService'
import { OrderEditModal } from '@/features/orders/OrderEditModal'
import { getSuggestedRules, renderRuleTitle, renderRuleDescription } from '@/features/automations/automationService'
import type { AutomationPlan } from '@/features/automations/automationService'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import type { OrderType, ModuleKey, Order } from '@/shared/lib/types'

const ORDER_TYPES: OrderType[] = ['customer', 'personal']

interface PendingOrderContext {
  orderId: string
  clientId: string
  isFirstOrder: boolean
  clientFirstName: string
}

export default function ClientOrdersScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const { orders, loading, add, remove, update, cancel, reload, totalAmount } = useClientOrders(id)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: 'cancel' | 'delete' } | null>(null)
  useFocusEffect(useCallback(() => { reload() }, [reload]))
  const { isModuleActive, getAutomationDelay } = useAppConfig()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const [showForm, setShowForm]       = useState(false)
  const [date, setDate]               = useState(new Date().toISOString().split('T')[0])
  const [productName, setProductName] = useState('')
  const [amount, setAmount]           = useState('')
  const [isLrp, setIsLrp]             = useState(false)
  const [orderType, setOrderType]     = useState<OrderType>('customer')
  const [notes, setNotes]             = useState('')
  const [saving, setSaving]           = useState(false)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)

  const [pendingOrder, setPendingOrder]     = useState<PendingOrderContext | null>(null)
  const [followupPlan, setFollowupPlan]     = useState<Record<string, { create: boolean; delayDays: number }>>({})
  const [confirmingPlan, setConfirmingPlan] = useState(false)

  async function handleSave() {
    setErrorMsg(null)
    if (!date.trim()) { setErrorMsg(t('orders.error_date')); return }
    if (!session?.user) return
    setSaving(true)
    try {
      const result = await add(session.user.id, {
        client_id: id,
        product_name: productName.trim() || '—',
        amount: amount ? parseFloat(amount) : null,
        order_date: date,
        is_lrp: isLrp,
        order_type: orderType,
        notes: notes.trim() || null,
        status: 'delivered',
      })
      setShowForm(false)
      setDate(new Date().toISOString().split('T')[0])
      setProductName('')
      setAmount('')
      setIsLrp(false)
      setOrderType('customer')
      setNotes('')

      if (result) {
        const rules = getSuggestedRules(result.isFirstOrder).filter(r => isModuleActive(r.moduleKey as ModuleKey))
        if (rules.length > 0) {
          const plan: Record<string, { create: boolean; delayDays: number }> = {}
          rules.forEach(r => { plan[r.id] = { create: true, delayDays: getAutomationDelay(r.id, r.delayDays) } })
          setFollowupPlan(plan)
          setPendingOrder({ orderId: result.order.id, clientId: id, isFirstOrder: result.isFirstOrder, clientFirstName: result.clientFirstName })
        }
      }
    } catch {
      setErrorMsg(t('orders.error_save'))
    } finally {
      setSaving(false)
    }
  }

  function closeFollowupPlan() {
    setPendingOrder(null)
  }

  async function handleConfirmFollowupPlan() {
    if (!pendingOrder || !session?.user) { closeFollowupPlan(); return }
    setConfirmingPlan(true)
    try {
      const plan: AutomationPlan = Object.entries(followupPlan).map(([ruleId, v]) => ({
        ruleId, create: v.create, delayDays: v.delayDays,
      }))
      await confirmOrderFollowups(session.user.id, pendingOrder.clientId, pendingOrder.clientFirstName, pendingOrder.isFirstOrder, plan, null, pendingOrder.orderId)
    } catch (e) {
      console.error('[orders.confirmFollowupPlan]', e)
    } finally {
      setConfirmingPlan(false)
      setPendingOrder(null)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t('orders.title'), headerBackTitle: '' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── KPI total ──────────────────────────────────────────── */}
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>{t('orders.total_month')}</Text>
          <Text style={styles.kpiValue}>{totalAmount.toFixed(2)}€</Text>
        </View>

        {/* ── Formulaire ajout ───────────────────────────────────── */}
        {!showForm ? (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)} activeOpacity={0.8}>
            <Text style={styles.addBtnText}>+ {t('orders.add')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.form}>
            <Text style={styles.formTitle}>{t('orders.add')}</Text>
            <DateInput
              label={t('orders.fields.date')}
              value={date}
              onChangeValue={setDate}
            />
            <Input
              label={t('orders.fields.product_name')}
              value={productName}
              onChangeText={setProductName}
              placeholder="doTERRA Copaiba, kit démarrage…"
            />
            <Input
              label={t('orders.fields.amount')}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t('orders.fields.is_lrp')}</Text>
              <Switch value={isLrp} onValueChange={setIsLrp} trackColor={{ true: colors.secondary }} />
            </View>
            <View style={styles.typeRow}>
              <Text style={styles.switchLabel}>{t('orders.fields.order_type')}</Text>
              <View style={styles.typePicker}>
                {ORDER_TYPES.map(ot => (
                  <TouchableOpacity
                    key={ot}
                    style={[styles.typeChip, orderType === ot && styles.typeChipActive]}
                    onPress={() => setOrderType(ot)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.typeChipText, orderType === ot && styles.typeChipTextActive]}>
                      {t(`orders.order_types.${ot}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TextArea label={t('orders.fields.notes')} value={notes} onChangeText={setNotes} />
            {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); setErrorMsg(null) }}>
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Button label={t('common.save')} onPress={handleSave} loading={saving} />
              </View>
            </View>
          </View>
        )}

        {/* ── Liste ──────────────────────────────────────────────── */}
        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
        ) : orders.length === 0 ? (
          <Text style={styles.empty}>{t('orders.empty')}</Text>
        ) : (
          orders
            .slice()
            .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())
            .map(order => {
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
                      <Text style={styles.cardDate}>
                        {formatDate(order.order_date, locale, { day: '2-digit', month: 'long', year: 'numeric' })}
                      </Text>
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
                      {!isCancelled && order.status !== 'returned' ? (
                        <TouchableOpacity
                          onPress={() => updateOrderStatus(order.id, 'returned').then(reload)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.returnBtnText}>{t('orders.mark_returned')}</Text>
                        </TouchableOpacity>
                      ) : null}
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

      {/* ── Relances à créer suite à la commande ────────────────────── */}
      <Modal visible={!!pendingOrder} transparent animationType="slide" onRequestClose={() => { if (!confirmingPlan) closeFollowupPlan() }}>
        <View style={styles.debriefOverlay}>
          <View style={styles.debriefSheet}>
            <View style={styles.debriefHandle} />
            <View style={styles.debriefHeader}>
              <Text style={styles.debriefTitle}>{t('orders.followups_title')}</Text>
              <TouchableOpacity
                onPress={() => { if (!confirmingPlan) closeFollowupPlan() }}
                disabled={confirmingPlan}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.debriefClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {pendingOrder && getSuggestedRules(pendingOrder.isFirstOrder)
                .filter(rule => followupPlan[rule.id] !== undefined)
                .map(rule => {
                  const item = followupPlan[rule.id]
                  return (
                    <View key={rule.id} style={styles.followupPlanRow}>
                      <TouchableOpacity
                        style={styles.taskCheck}
                        onPress={() => setFollowupPlan(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], create: !prev[rule.id].create } }))}
                      >
                        <View style={[styles.taskCheckBox, item.create && { backgroundColor: colors.success, borderColor: colors.success }]}>
                          {item.create && <Text style={styles.taskCheckMark}>✓</Text>}
                        </View>
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.followupPlanLabel, !item.create && { color: colors.textTertiary }]}>
                          {renderRuleTitle(rule, pendingOrder.clientFirstName, item.delayDays)}
                        </Text>
                        <Text style={styles.followupPlanDesc}>{renderRuleDescription(rule, item.delayDays)}</Text>
                      </View>
                      {item.create && (
                        <View style={styles.followupPlanDelay}>
                          <Text style={styles.followupPlanDelayLabel}>{t('orders.followup_days_label')}</Text>
                          <TextInput
                            style={styles.followupPlanDelayInput}
                            value={String(item.delayDays)}
                            onChangeText={(v) => {
                              const n = parseInt(v, 10)
                              setFollowupPlan(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], delayDays: Number.isFinite(n) && n >= 0 ? n : 0 } }))
                            }}
                            keyboardType="number-pad"
                          />
                        </View>
                      )}
                    </View>
                  )
                })}
            </ScrollView>

            <TouchableOpacity
              style={[styles.debriefDoneBtn, confirmingPlan && { opacity: 0.6 }]}
              onPress={handleConfirmFollowupPlan}
              disabled={confirmingPlan}
              activeOpacity={0.85}
            >
              {confirmingPlan
                ? <ActivityIndicator color="#ffffff" size="small" />
                : <Text style={styles.debriefDoneBtnText}>{t('orders.followups_confirm')}</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {editingOrder ? (
        <OrderEditModal order={editingOrder} onClose={() => setEditingOrder(null)} onSave={update} />
      ) : null}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },
  content:   { padding: 16, gap: 12, maxWidth: 720, alignSelf: 'center', width: '100%' },

  kpiCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  kpiValue: { fontSize: 22, fontFamily: fonts.bold, color: colors.primary },

  addBtn: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },

  form: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formTitle:   { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  switchRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  switchLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.text, flex: 1 },
  typeRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  typePicker:  { flexDirection: 'row', gap: 8 },
  typeChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  typeChipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  typeChipText:       { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  typeChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
  error:       { fontSize: 13, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
  formBtns:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:   { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },

  empty: { textAlign: 'center', color: colors.textTertiary, fontSize: 14, fontFamily: fonts.body, marginTop: 32 },

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
  cardDate:   { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
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

  // ── Modale "Relances à créer" ─────────────────────────────────────────────
  debriefOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  debriefSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 32, maxHeight: '85%',
  },
  debriefHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  debriefHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  debriefTitle:  { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
  debriefClose:  { fontSize: 16, color: colors.textTertiary, padding: 4 },
  debriefDoneBtn:     { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  debriefDoneBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#ffffff' },

  taskCheck:    { padding: 2, marginTop: 2 },
  taskCheckBox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  taskCheckMark:{ fontSize: 11, color: '#ffffff', fontFamily: fonts.bold },

  followupPlanRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  followupPlanLabel:      { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
  followupPlanDesc:       { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 1 },
  followupPlanDelay:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  followupPlanDelayLabel: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  followupPlanDelayInput: { fontSize: 13, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, width: 48, textAlign: 'center' },
  })
}
