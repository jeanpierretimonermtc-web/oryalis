import { useMemo, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClientFollowups } from '@/features/followups/useFollowups'
import { useClient } from '@/features/clients/useClient'
import { createFollowup, toggleFollowupDone, deleteFollowup } from '@/features/followups/followupService'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { Card } from '@/shared/components/ui/Card'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { PIPELINE_STAGES } from '@/shared/lib/types'
import type { Followup, NextActionType, PipelineStage } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'

const ACTION_TYPES: NextActionType[] = ['call', 'whatsapp', 'sms', 'email', 'rdv']
const ACTION_ICONS: Record<NextActionType, string> = {
  call: '📞', whatsapp: '💬', sms: '📱', email: '✉️', rdv: '📅',
}

export default function ClientFollowupsScreen() {
  const { t, i18n } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { followups, loading, refresh } = useClientFollowups(id)
  const { client } = useClient(id)
  const [showModal, setShowModal] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  async function handleToggle(f: Followup) {
    await toggleFollowupDone(f.id, !f.done)
    refresh()
  }

  async function handleDelete(fId: string) {
    await deleteFollowup(fId)
    setConfirmId(null)
    refresh()
  }

  return (
    <>
      <Stack.Screen options={{ title: t('followups.title'), headerRight: () => (
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      )}} />
      <View style={styles.container}>
        {loading
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              data={followups}
              keyExtractor={f => f.id}
              renderItem={({ item }) => (
                <Card style={item.done ? styles.done : undefined}>
                  <View style={styles.row}>
                    <TouchableOpacity onPress={() => handleToggle(item)} style={styles.checkbox}>
                      <Text style={styles.checkboxText}>{item.done ? '✅' : '⬜'}</Text>
                    </TouchableOpacity>
                    <View style={styles.info}>
                      {item.action_type ? (
                        <View style={styles.actionTypeBadge}>
                          <Text style={styles.actionTypeIcon}>{ACTION_ICONS[item.action_type]}</Text>
                          <Text style={styles.actionTypeText}>{t(`next_action_types.${item.action_type}`)}</Text>
                        </View>
                      ) : null}
                      {item.title ? <Text style={[styles.title, item.done && styles.doneText]}>{item.title}</Text> : null}
                      {item.content ? <Text style={[styles.content, item.done && styles.doneText]} numberOfLines={2}>{item.content}</Text> : null}
                      <Text style={styles.date}>
                        {formatDate(item.due_date, locale)}
                      </Text>
                    </View>
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
                </Card>
              )}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<EmptyState message={t('followups.none')} icon="🔔" />}
            />
        }
      </View>
      {showModal && (
        <FollowupModal
          clientId={id}
          userId={session?.user.id ?? ''}
          currentPipeline={client?.pipeline_stage ?? 'new_lead'}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); refresh() }}
        />
      )}
    </>
  )
}

function FollowupModal({ clientId, userId, currentPipeline, onClose, onSaved }: {
  clientId: string; userId: string; currentPipeline: PipelineStage; onClose: () => void; onSaved: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [actionType, setActionType] = useState<NextActionType | null>(null)
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>(currentPipeline)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSave() {
    if (!title.trim() && !content.trim()) {
      setErrorMsg(t('followups.error_title_or_desc'))
      return
    }
    setLoading(true)
    try {
      await createFollowup(userId, {
        client_id: clientId,
        title: title.trim() || null,
        content: content.trim() || null,
        due_date: dueDate,
        done: false,
        action_type: actionType,
        pipeline_stage: pipelineStage,
      })
      onSaved()
    } catch (e) {
      console.error('[createFollowup]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose}><Text style={styles.modalCancel}>{t('common.cancel')}</Text></TouchableOpacity>
        <Text style={styles.modalTitle}>{t('followups.add')}</Text>
        <Button label={t('common.save')} size="sm" onPress={handleSave} loading={loading} />
      </View>
      <ScrollView style={{ padding: 16 }} contentContainerStyle={{ gap: 12 }}>
        <View style={{ gap: 8 }}>
          <Text style={styles.fieldLabel}>{t('clients.fields.pipeline_stage')}</Text>
          <View style={styles.actionTypeRow}>
            {PIPELINE_STAGES.map(stage => (
              <TouchableOpacity key={stage} style={[styles.actionTypeChip, pipelineStage === stage && styles.actionTypeChipActive]} onPress={() => setPipelineStage(stage)}>
                <Text style={[styles.actionTypeChipLabel, pipelineStage === stage && styles.actionTypeChipLabelActive]}>{t(`pipeline_stages.${stage}`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={styles.fieldLabel}>{t('followups.action_type')}</Text>
          <View style={styles.actionTypeRow}>
            {ACTION_TYPES.map(at => (
              <TouchableOpacity
                key={at}
                style={[styles.actionTypeChip, actionType === at && styles.actionTypeChipActive]}
                onPress={() => setActionType(actionType === at ? null : at)}
                activeOpacity={0.7}
              >
                <Text style={styles.actionTypeChipIcon}>{ACTION_ICONS[at]}</Text>
                <Text style={[styles.actionTypeChipLabel, actionType === at && styles.actionTypeChipLabelActive]}>
                  {t(`next_action_types.${at}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <Input label={t('followups.title_label')} value={title} onChangeText={setTitle} />
        <Input label={`${t('followups.description')} (${t('common.optional')})`} value={content} onChangeText={setContent} />
        <DateInput label={t('followups.due_date')} value={dueDate} onChangeValue={setDueDate} />
        {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}
      </ScrollView>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  list:       { padding: 12, gap: 8 },
  loader:     { marginTop: 40 },
  addBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addBtnText: { color: '#fff', fontSize: 22, lineHeight: 28 },
  done:       { opacity: 0.5 },
  row:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox:   { paddingTop: 2 },
  checkboxText: { fontSize: 20 },
  info:       { flex: 1, gap: 3 },
  title:      { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  content:    { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary },
  doneText:   { textDecorationLine: 'line-through', color: colors.textTertiary },
  date:       { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  deleteIcon: { fontSize: 16, paddingTop: 2 },

  inlineConfirm:      { flexDirection: 'column', gap: 4, alignItems: 'flex-end' },
  confirmCancelBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  confirmCancelText:  { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  confirmDeleteBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.danger },
  confirmDeleteText:  { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

  errorMsg:    { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle:  { fontSize: 17, fontFamily: fonts.semibold, color: colors.text },
  modalCancel: { fontSize: 16, fontFamily: fonts.body, color: colors.primary },

  fieldLabel:           { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  actionTypeRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionTypeChip:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  actionTypeChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  actionTypeChipIcon:   { fontSize: 13 },
  actionTypeChipLabel:  { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  actionTypeChipLabelActive: { color: colors.primary, fontFamily: fonts.semibold },

  actionTypeBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  actionTypeIcon:  { fontSize: 11 },
  actionTypeText:  { fontSize: 11, fontFamily: fonts.semibold, color: colors.primaryAction },
  })
}
