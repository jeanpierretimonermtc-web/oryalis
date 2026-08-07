import { useState, useMemo } from 'react'
import { View, Text, TouchableOpacity, Modal, Switch, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Order, OrderType } from '@/shared/lib/types'
import type { OrderEditInput } from './orderService'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

const ORDER_TYPES: OrderType[] = ['customer', 'personal']

interface OrderEditModalProps {
  order: Order
  onClose: () => void
  onSave: (id: string, input: OrderEditInput) => Promise<boolean>
}

// Composant partagé entre la vue commandes globale (orders/index.tsx) et la vue commandes
// d'un contact (clients/[id]/orders.tsx) — une seule implémentation d'édition, pas deux qui
// dériveraient (même principe que outcomePlanSections côté RDV).
export function OrderEditModal({ order, onClose, onSave }: OrderEditModalProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const [date, setDate]               = useState(order.order_date.split('T')[0])
  const [productName, setProductName] = useState(order.product_name)
  const [amount, setAmount]           = useState(order.amount != null ? String(order.amount) : '')
  const [isLrp, setIsLrp]             = useState(order.is_lrp)
  const [orderType, setOrderType]     = useState<OrderType>(order.order_type)
  const [notes, setNotes]             = useState(order.notes ?? '')
  const [saving, setSaving]           = useState(false)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)

  async function handleSave() {
    setErrorMsg(null)
    if (!date.trim()) { setErrorMsg(t('orders.error_date')); return }
    setSaving(true)
    try {
      const ok = await onSave(order.id, {
        product_name: productName.trim() || '—',
        amount: amount ? parseFloat(amount) : null,
        order_date: date,
        is_lrp: isLrp,
        order_type: orderType,
        notes: notes.trim() || null,
      })
      if (ok) onClose()
      else setErrorMsg(t('orders.error_save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => { if (!saving) onClose() }}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{t('orders.edit_title')}</Text>
            <TouchableOpacity onPress={() => { if (!saving) onClose() }} disabled={saving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>

          <DateInput label={t('orders.fields.date')} value={date} onChangeValue={setDate} />
          <Input label={t('orders.fields.product_name')} value={productName} onChangeText={setProductName} />
          <Input label={t('orders.fields.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
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
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Button label={t('common.save')} onPress={handleSave} loading={saving} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingHorizontal: 20, paddingBottom: 32, gap: 12,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    title:  { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
    close:  { fontSize: 16, color: colors.textTertiary, padding: 4 },

    switchRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    switchLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.text, flex: 1 },

    typeRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    typePicker:  { flexDirection: 'row', gap: 8 },
    typeChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
    typeChipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    typeChipText:       { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    typeChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },

    error: { fontSize: 13, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
    formBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
    cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    cancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },
  })
}
