import { useState, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClientOrders } from '@/features/orders/useOrders'
import { updateOrderStatus } from '@/features/orders/orderService'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import type { OrderType } from '@/shared/lib/types'

const ORDER_TYPES: OrderType[] = ['customer', 'personal']

export default function ClientOrdersScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const { orders, loading, add, remove, reload, totalAmount } = useClientOrders(id)
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

  async function handleSave() {
    setErrorMsg(null)
    if (!date.trim()) { setErrorMsg(t('orders.error_date')); return }
    if (!session?.user) return
    setSaving(true)
    try {
      await add(session.user.id, {
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
    } catch {
      setErrorMsg(t('orders.error_save'))
    } finally {
      setSaving(false)
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
            .map(order => (
              <View key={order.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.cardLeft}>
                    <Text style={styles.cardDate}>
                      {formatDate(order.order_date, locale, { day: '2-digit', month: 'long', year: 'numeric' })}
                    </Text>
                    <Text style={styles.cardProduct} numberOfLines={1}>{order.product_name}</Text>
                  </View>
                  <View style={styles.cardRight}>
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
                      <Text style={styles.cardAmount}>{order.amount.toFixed(2)}€</Text>
                    ) : null}
                  </View>
                </View>
                {order.notes ? <Text style={styles.cardNotes}>{order.notes}</Text> : null}
                <View style={styles.cardActions}>
                  {order.status !== 'returned' ? (
                    <TouchableOpacity
                      onPress={() => updateOrderStatus(order.id, 'returned').then(reload)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.returnBtnText}>{t('orders.mark_returned')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => remove(order.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.deleteBtnText}>{t('common.delete')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
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
  cardTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardLeft:   { flex: 1, gap: 2 },
  cardDate:   { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  cardProduct:{ fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  cardRight:  { alignItems: 'flex-end', gap: 4 },
  cardAmount: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  cardNotes:  { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 18 },

  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: fonts.bold },

  cardActions:   { flexDirection: 'row', justifyContent: 'flex-end', gap: 16 },
  deleteBtn:     { alignSelf: 'flex-end' },
  deleteBtnText: { fontSize: 11, fontFamily: fonts.medium, color: colors.danger },
  returnBtnText: { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary },
  })
}
