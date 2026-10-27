import { useMemo, useState, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, TextInput, ScrollView, ActivityIndicator, Platform, useWindowDimensions } from 'react-native'
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useRecommendations } from '@/features/recommendations/useRecommendations'
import { createRecommendation, updateRecommendationStatus, updateRecommendationFeedback, deleteRecommendation } from '@/features/recommendations/recommendationService'
import { CatalogProductPicker, type CatalogPickerResult } from '@/features/catalogs/CatalogProductPicker'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { TextArea } from '@/shared/components/ui/TextArea'
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
  // UI-CREATE-1 — desktop web : bouton explicite "+ Ajouter un produit" ; mobile : FAB rond
  // inchangé (accessibilityLabel explicite). Même convention que followups.tsx/interactions.tsx.
  const { width: screenW } = useWindowDimensions()
  const isDesktopWeb = Platform.OS === 'web' && screenW >= 768
  const { recommendations: allRecommendations, loading, refresh } = useRecommendations(id)
  useFocusEffect(useCallback(() => { refresh() }, [refresh]))
  // Une recommandation annulée reste dans l'historique (onglet Activité) mais ne doit plus
  // apparaître comme active/proposable ici (Lot 1.2.1 §10).
  const recommendations = useMemo(() => allRecommendations.filter(r => !r.cancelled_at), [allRecommendations])
  const [showModal, setShowModal] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [productName, setProductName] = useState('')
  const [reason, setReason] = useState('')
  const [pickedCatalog, setPickedCatalog] = useState<CatalogPickerResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // ACTION-OUTCOME-1 / P2 — recommandation dont le retour client est en cours d'ajout/édition.
  const [feedbackItem, setFeedbackItem] = useState<Recommendation | null>(null)
  // RECOMMENDATION-STATUS-FIX-1 §6/§7 — erreur du toggle de statut, affichée inline sur la carte
  // concernée (jamais Alert.alert sur web). Pas de mise à jour optimiste : l'UI ne reflète le
  // nouveau statut qu'après succès réel de la mutation (refresh() relit l'état DB), donc aucun
  // rollback n'est nécessaire ici — en cas d'échec, l'affichage reste simplement sur l'état
  // précédent, jamais "purchased" affiché alors que la DB est restée à "advised".
  const [toggleError, setToggleError] = useState<{ id: string; message: string } | null>(null)

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

  // RECOMMENDATION-STATUS-FIX-1 — cycle unique advised ↔ purchased (aligné sur la contrainte DB
  // réelle, voir RECOMMENDATION-STATUS-AUDIT-1) ; 'ordered' n'a jamais été un statut de
  // recommandation valide en base, cette transition échouait silencieusement auparavant.
  async function handleToggle(rec: Recommendation) {
    setToggleError(null)
    try {
      await updateRecommendationStatus(rec.id, rec.status === 'advised' ? 'purchased' : 'advised')
      refresh()
    } catch (e) {
      console.error('[updateRecommendationStatus]', e)
      setToggleError({ id: rec.id, message: t('common.error') })
    }
  }

  async function handleDelete(recId: string) {
    await deleteRecommendation(recId)
    setConfirmId(null)
    refresh()
  }

  return (
    <>
      <Stack.Screen options={{ title: t('recommendations.title'), headerRight: () => (
        isDesktopWeb ? (
          <TouchableOpacity onPress={() => setShowModal(true)} style={styles.newActionBtn} activeOpacity={0.85}>
            <Text style={styles.newActionBtnText}>+ {t('recommendations.add')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn} accessibilityLabel={t('recommendations.add')}>
            <Text style={styles.addBtnText}>+</Text>
          </TouchableOpacity>
        )
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

                  {/* RECOMMENDATION-STATUS-FIX-1 §6 — visible uniquement sur la carte concernée,
                      jamais un Alert.alert (convention web du projet). */}
                  {toggleError?.id === item.id ? (
                    <Text style={styles.errorMsg}>{toggleError.message}</Text>
                  ) : null}

                  {/* ACTION-OUTCOME-1 / P2 §14/§15 — extrait compact si un retour existe déjà,
                      simple bouton discret sinon (jamais "Aucun retour" affiché partout). */}
                  {item.client_feedback ? (
                    <View style={styles.feedbackBlock}>
                      <Text style={styles.feedbackLabel}>{t('recommendations.feedback_label')}</Text>
                      <Text style={styles.feedbackText} numberOfLines={2}>{item.client_feedback}</Text>
                      <TouchableOpacity onPress={() => setFeedbackItem(item)} activeOpacity={0.7}>
                        <Text style={styles.feedbackActionText}>{t('recommendations.edit_feedback')}</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.addFeedbackBtn} onPress={() => setFeedbackItem(item)} activeOpacity={0.7}>
                      <Text style={styles.feedbackActionText}>+ {t('recommendations.add_feedback')}</Text>
                    </TouchableOpacity>
                  )}
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

      {feedbackItem && (
        <RecommendationFeedbackModal
          recommendation={feedbackItem}
          onClose={() => setFeedbackItem(null)}
          onSaved={() => { setFeedbackItem(null); refresh() }}
        />
      )}
    </>
  )
}

// ACTION-OUTCOME-1 / P2 §10 — vraie modal métier (saisie), jamais AnchoredMenu : un titre, le
// produit concerné, un champ texte libre facultatif, deux boutons. Reste volontairement plus
// simple que InteractionOutcomeModal/FollowupCompletionModal (pas de chips, pas de "Suite" —
// hors périmètre de P2, cf. §4).
function RecommendationFeedbackModal({ recommendation, onClose, onSaved }: {
  recommendation: Recommendation
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [feedback, setFeedback] = useState(recommendation.client_feedback ?? '')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSubmit() {
    if (saving) return
    setErrorMsg(null)
    setSaving(true)
    try {
      // §27 — '' → null, jamais une chaîne vide stockée (trim géré par le service).
      await updateRecommendationFeedback(recommendation.id, feedback)
      onSaved()
    } catch (e) {
      console.error('[updateRecommendationFeedback]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!saving) onClose() }}>
      <View style={styles.feedbackOverlay}>
        <View style={styles.feedbackSheet}>
          <Text style={styles.feedbackModalTitle}>{t('recommendations.feedback_label')}</Text>
          <Text style={styles.feedbackModalSubject} numberOfLines={1}>{recommendation.product_name}</Text>

          <TextArea value={feedback} onChangeText={setFeedback} placeholder={t('recommendations.add_feedback')} />

          {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}

          <View style={styles.feedbackBtnRow}>
            <TouchableOpacity style={styles.feedbackCancelBtn} onPress={onClose} disabled={saving} activeOpacity={0.8}>
              <Text style={styles.feedbackCancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Button label={t('recommendations.save_feedback')} onPress={handleSubmit} loading={saving} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:          { flex: 1, backgroundColor: colors.bgDim },
  list:               { padding: 12, gap: 8 },
  loader:             { marginTop: 40 },
  addBtn:             { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addBtnText:         { color: '#fff', fontSize: 22, lineHeight: 28 },
  // UI-CREATE-1 — création principale desktop : icône + texte explicite, jamais un rond "+"
  // isolé (règle §3/§8). Couleur primaire existante, aucune nouvelle teinte.
  newActionBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginRight: 12 },
  newActionBtnText: { color: '#fff', fontSize: 14, fontFamily: fonts.semibold },

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

  // ── ACTION-OUTCOME-1 / P2 — retour client (extrait carte + bouton) ───────────────────────
  feedbackBlock:      { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, gap: 3 },
  feedbackLabel:      { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  feedbackText:       { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  feedbackActionText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primaryAction, marginTop: 2 },
  addFeedbackBtn:     { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, alignSelf: 'flex-start' },

  // ── ACTION-OUTCOME-1 / P2 — Modal retour client ──────────────────────────────────────────
  feedbackOverlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  feedbackSheet:        { width: '100%', maxWidth: 380, borderRadius: 16, padding: 20, gap: 12, backgroundColor: colors.card, boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 24, color: 'rgba(0, 0, 0, 0.2)' }], elevation: 16 },
  feedbackModalTitle:   { fontSize: 17, fontFamily: fonts.semibold, color: colors.text },
  feedbackModalSubject: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: -8 },
  feedbackBtnRow:       { flexDirection: 'row', gap: 10, marginTop: 4 },
  feedbackCancelBtn:    { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  feedbackCancelBtnText:{ fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },
  errorMsg:             { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  })
}
