import { useMemo, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, TextInput, ScrollView, ActivityIndicator } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useRecommendations } from '@/features/recommendations/useRecommendations'
import { createRecommendation, updateRecommendationStatus, deleteRecommendation } from '@/features/recommendations/recommendationService'
import { CatalogProductPicker, type CatalogPickerResult } from '@/features/catalogs/CatalogProductPicker'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { Recommendation } from '@/shared/lib/types'

export default function ClientRecommendationsScreen() {
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { recommendations, loading, refresh } = useRecommendations(id)
  const [showModal, setShowModal] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [productName, setProductName] = useState('')
  const [reason, setReason] = useState('')
  const [pickedCatalog, setPickedCatalog] = useState<CatalogPickerResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  function handlePickerSelect(result: CatalogPickerResult) {
    setProductName(result.productName)
    setPickedCatalog(result)
  }

  function resetModal() {
    setShowModal(false)
    setProductName('')
    setReason('')
    setPickedCatalog(null)
  }

  async function handleSave() {
    if (!productName.trim() || !session) return
    setSaving(true)
    try {
      await createRecommendation(
        session.user.id, id,
        productName.trim(), reason || null,
        'advised',
        pickedCatalog?.catalogId ?? null,
        pickedCatalog?.productId ?? null
      )
      resetModal()
      refresh()
    } finally { setSaving(false) }
  }

  async function handleToggle(rec: Recommendation) {
    await updateRecommendationStatus(rec.id, rec.status === 'advised' ? 'ordered' : 'advised')
    refresh()
  }

  async function handleDelete(recId: string) {
    await deleteRecommendation(recId)
    setConfirmId(null)
    refresh()
  }

  return (
    <>
      <Stack.Screen options={{ title: t('recommendations.title'), headerRight: () => (
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      )}} />
      <View style={styles.container}>
        {loading
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              data={recommendations}
              keyExtractor={r => r.id}
              renderItem={({ item }) => (
                <Card style={styles.recCard}>
                  <View style={styles.recRow}>
                    <View style={styles.recInfo}>
                      {item.catalog && (
                        <View style={[styles.catalogBadge, { backgroundColor: item.catalog.color + '18' }]}>
                          <Text style={styles.catalogIcon}>{item.catalog.icon}</Text>
                          <Text style={[styles.catalogName, { color: item.catalog.color }]}>{item.catalog.name}</Text>
                        </View>
                      )}
                      <Text style={styles.recName}>{item.product_name}</Text>
                      {item.reason ? <Text style={styles.recReason}>{item.reason}</Text> : null}
                    </View>
                    <View style={styles.recActions}>
                      <TouchableOpacity
                        style={[styles.statusBtn, item.status !== 'advised' && styles.statusBtnActive]}
                        onPress={() => handleToggle(item)}
                      >
                        <Text style={[styles.statusBtnText, item.status !== 'advised' && styles.statusBtnTextActive]}>
                          {t(`recommendations.${item.status}`)}
                        </Text>
                      </TouchableOpacity>
                      {confirmId === item.id ? (
                        <View style={styles.inlineConfirm}>
                          <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setConfirmId(null)}>
                            <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.confirmDeleteBtn} onPress={() => handleDelete(item.id)}>
                            <Text style={styles.confirmDeleteText}>{t('common.delete')}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => setConfirmId(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.deleteIcon}>🗑</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </Card>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<EmptyState message={t('recommendations.empty')} icon="🌿" />}
            />
        }
      </View>

      {/* Add modal */}
      <Modal animationType="slide" presentationStyle="pageSheet" visible={showModal} onRequestClose={resetModal}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={resetModal}><Text style={styles.modalCancel}>{t('common.cancel')}</Text></TouchableOpacity>
          <Text style={styles.modalTitle}>{t('recommendations.add')}</Text>
          <Button label={t('common.save')} size="sm" onPress={handleSave} loading={saving} />
        </View>
        <ScrollView style={styles.modalContent} contentContainerStyle={{ gap: 12 }}>
          <View style={styles.productRow}>
            <TextInput
              style={[styles.productInput, { flex: 1 }]}
              placeholder={t('recommendations.product_placeholder')}
              value={productName}
              onChangeText={text => { setProductName(text); setPickedCatalog(null) }}
              placeholderTextColor={colors.textTertiary}
            />
            <TouchableOpacity
              style={[styles.catalogBtn, pickedCatalog && { borderColor: pickedCatalog.catalogColor, backgroundColor: pickedCatalog.catalogColor + '15' }]}
              onPress={() => setShowPicker(true)}
            >
              {pickedCatalog
                ? <Text style={{ fontSize: 13, color: pickedCatalog.catalogColor, fontFamily: fonts.semibold }}>{pickedCatalog.catalogIcon} {pickedCatalog.catalogName}</Text>
                : <Text style={{ fontSize: 13, color: colors.primary, fontFamily: fonts.semibold }}>📦 {t('recommendations.catalog')}</Text>
              }
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.reasonInput}
            placeholder={t('recommendations.reason')}
            value={reason}
            onChangeText={setReason}
            multiline
            placeholderTextColor={colors.textTertiary}
          />
        </ScrollView>
      </Modal>

      {/* Catalog picker */}
      {showPicker && (
        <CatalogProductPicker
          onSelect={handlePickerSelect}
          onClose={() => setShowPicker(false)}
        />
      )}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:          { flex: 1, backgroundColor: colors.bgDim },
  list:               { padding: 12, gap: 8 },
  loader:             { marginTop: 40 },
  addBtn:             { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addBtnText:         { color: '#fff', fontSize: 22, lineHeight: 28 },

  recCard:            { },
  recRow:             { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  recInfo:            { flex: 1, gap: 4 },
  catalogBadge:       { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  catalogIcon:        { fontSize: 11 },
  catalogName:        { fontSize: 11, fontFamily: fonts.semibold },
  recName:            { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  recReason:          { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
  recActions:         { flexDirection: 'column', alignItems: 'flex-end', gap: 8 },
  statusBtn:          { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  statusBtnActive:    { backgroundColor: colors.successLight, borderColor: colors.success },
  statusBtnText:      { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  statusBtnTextActive:{ color: colors.success },
  deleteIcon:         { fontSize: 16 },

  inlineConfirm:      { flexDirection: 'column', gap: 4, alignItems: 'flex-end' },
  confirmCancelBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  confirmCancelText:  { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  confirmDeleteBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.danger },
  confirmDeleteText:  { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

  modalHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle:         { fontSize: 17, fontFamily: fonts.semibold, color: colors.text },
  modalCancel:        { fontSize: 16, fontFamily: fonts.body, color: colors.primary },
  modalContent:       { padding: 16 },
  productRow:         { flexDirection: 'row', gap: 8, alignItems: 'center' },
  productInput:       { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, fontFamily: fonts.body, backgroundColor: colors.card, color: colors.text },
  catalogBtn:         { borderWidth: 1.5, borderColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  reasonInput:        { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 15, fontFamily: fonts.body, backgroundColor: colors.card, color: colors.text, minHeight: 80 },
  })
}
