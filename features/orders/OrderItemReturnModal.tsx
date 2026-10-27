// ORDER-BUSINESS-4.2 §8/§9/§10/§11/§12 — enregistrement d'un retour partiel/total sur UNE ligne
// de commande. `returned_qty` est CUMULATIF : ce champ édite le TOTAL actuellement retourné,
// jamais un événement incrémental ("retourner encore 1") — wording explicite pour éviter toute
// ambiguïté (§10). Une seule action de sauvegarde par ouverture de cette modale (bouton
// Enregistrer, désactivé pendant l'écriture) : aucun risque de double-écriture concurrente à
// gérer ici (contrairement à un champ modifié au blur comme dans ORDER-BUSINESS-3.5, il n'y a
// qu'un seul déclenchement possible par ouverture) — ne pas sur-construire un mécanisme de
// sérialisation qui n'a pas d'usage réel dans ce flux.
import { useState, useMemo } from 'react'
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { updateOrderItemReturnedQty } from './orderItemService'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

interface Props {
  orderItemId: string
  productName: string
  quantity: number
  currentReturnedQty: number
  onClose: () => void
  onSaved: (newReturnedQty: number) => void
}

export function OrderItemReturnModal({ orderItemId, productName, quantity, currentReturnedQty, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [value, setValue] = useState(String(currentReturnedQty))
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSave() {
    const returnedQty = parseInt(value.replace(/\D/g, ''), 10)
    if (!Number.isFinite(returnedQty) || returnedQty < 0) { setErrorMsg(t('orders.return_error_invalid')); return }
    // §12 — refusé aux trois niveaux : UI (ici), service (updateOrderItemReturnedQty), DB (CHECK).
    if (returnedQty > quantity) { setErrorMsg(t('orders.return_error_exceeds')); return }
    setSaving(true)
    setErrorMsg(null)
    try {
      await updateOrderItemReturnedQty(orderItemId, returnedQty)
      onSaved(returnedQty)
      onClose()
    } catch {
      // §39 — jamais Alert.alert, message inline discret, la modale reste ouverte pour réessayer.
      setErrorMsg(t('orders.error_save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!saving) onClose() }}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{t('orders.return_modal_title')}</Text>
          <Text style={styles.productName} numberOfLines={2}>{productName}</Text>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('orders.return_ordered_qty')}</Text>
            <Text style={styles.infoValue}>{quantity}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('orders.return_already_returned')}</Text>
            <Text style={styles.infoValue}>{currentReturnedQty}</Text>
          </View>

          <Text style={styles.fieldLabel}>{t('orders.return_qty_label')}</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            keyboardType="number-pad"
            editable={!saving}
          />

          {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

          <View style={styles.actions}>
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
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
    sheet: { backgroundColor: colors.card, borderRadius: 20, padding: 20, gap: 10, width: '100%', maxWidth: 420 },
    title: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
    productName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary, marginBottom: 4 },
    infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
    infoLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.textTertiary },
    infoValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    fieldLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, marginTop: 6 },
    input: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10,
      paddingHorizontal: 12, fontSize: 15, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bg,
    },
    error: { fontSize: 12, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 8 },
    actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
    cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    cancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },
  })
}
