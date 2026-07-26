import { useMemo, useState, useCallback } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native'
import { Stack, router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClientFollowups } from '@/features/followups/useFollowups'
import { useClient } from '@/features/clients/useClient'
import { createFollowup, toggleFollowupDone, deleteFollowup } from '@/features/followups/followupService'
import { completeTask, deleteTask } from '@/features/appointments/appointmentService'
import { supabase } from '@/shared/lib/supabase'
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

// ── Concept unifié "action à suivre" ────────────────────────────────────────
// Regroupe relances, tâches liées à un RDV et interactions programmées dans
// une seule liste chronologique — un utilisateur ne devrait pas avoir à
// chercher dans 3 endroits différents "qu'est-ce qu'il me reste à faire".
type UnifiedAction = {
  id: string
  source: 'followup' | 'task' | 'interaction'
  title: string
  subtitle: string | null
  dueDate: string
  done: boolean
  actionType: NextActionType | null
  followup?: Followup
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
  const [tasks, setTasks] = useState<UnifiedAction[]>([])
  const [interactionsUpcoming, setInteractionsUpcoming] = useState<UnifiedAction[]>([])
  const [otherLoading, setOtherLoading] = useState(true)

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const loadOther = useCallback(async () => {
    if (!id) return
    setOtherLoading(true)
    const [tasksRes, interactionsRes] = await Promise.all([
      supabase
        .from('appointment_tasks')
        .select('id, title, task_type, status, due_at')
        .eq('client_id', id)
        .neq('status', 'cancelled'),
      supabase
        .from('interactions')
        .select('id, interaction_type, subject, scheduled_at')
        .eq('client_id', id)
        .is('completed_at', null)
        .not('scheduled_at', 'is', null),
    ])

    setTasks((tasksRes.data ?? []).map(tk => ({
      id: `task-${tk.id}`,
      source: 'task' as const,
      title: tk.title,
      subtitle: t('followups.source_task'),
      dueDate: tk.due_at ?? new Date().toISOString(),
      done: tk.status === 'done',
      actionType: null,
    })))

    setInteractionsUpcoming((interactionsRes.data ?? []).map(it => ({
      id: `interaction-${it.id}`,
      source: 'interaction' as const,
      title: it.subject || t(`interaction_types.${it.interaction_type}` as any),
      subtitle: t('followups.source_interaction'),
      dueDate: it.scheduled_at as string,
      done: false,
      actionType: null,
    })))

    setOtherLoading(false)
  }, [id, t])

  useFocusEffect(useCallback(() => { loadOther() }, [loadOther]))

  const unified: UnifiedAction[] = useMemo(() => {
    const fromFollowups: UnifiedAction[] = followups.map(f => ({
      id: f.id,
      source: 'followup',
      title: f.title ?? '',
      subtitle: f.content,
      dueDate: f.due_date,
      done: f.done,
      actionType: f.action_type,
      followup: f,
    }))
    return [...fromFollowups, ...tasks, ...interactionsUpcoming].sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    )
  }, [followups, tasks, interactionsUpcoming])

  async function handleToggle(item: UnifiedAction) {
    if (item.source === 'followup' && item.followup) {
      await toggleFollowupDone(item.followup.id, !item.followup.done)
      refresh()
    } else if (item.source === 'task') {
      const taskId = item.id.replace('task-', '')
      await completeTask(taskId)
      loadOther()
    }
    // Les interactions se gèrent depuis l'onglet Interactions.
  }

  async function handleDelete(item: UnifiedAction) {
    if (item.source === 'followup') {
      await deleteFollowup(item.id)
      refresh()
    } else if (item.source === 'task') {
      await deleteTask(item.id.replace('task-', ''))
      loadOther()
    }
    setConfirmId(null)
  }

  function handlePress(item: UnifiedAction) {
    if (item.source === 'interaction') router.push(`/(app)/clients/${id}/interactions` as any)
  }

  return (
    <>
      <Stack.Screen options={{ title: t('followups.title'), headerRight: () => (
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      )}} />
      <View style={styles.container}>
        {(loading || otherLoading)
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              data={unified}
              keyExtractor={f => f.id}
              renderItem={({ item }) => (
                <Card style={item.done ? styles.done : undefined}>
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => handlePress(item)}
                    activeOpacity={item.source === 'interaction' ? 0.7 : 1}
                  >
                    {item.source !== 'interaction' ? (
                      <TouchableOpacity onPress={() => handleToggle(item)} style={styles.checkbox}>
                        <Text style={styles.checkboxText}>{item.done ? '✅' : '⬜'}</Text>
                      </TouchableOpacity>
                    ) : (
                      <Text style={styles.checkboxText}>📅</Text>
                    )}
                    <View style={styles.info}>
                      <View style={styles.badgeRow}>
                        {item.actionType ? (
                          <View style={styles.actionTypeBadge}>
                            <Text style={styles.actionTypeIcon}>{ACTION_ICONS[item.actionType]}</Text>
                            <Text style={styles.actionTypeText}>{t(`next_action_types.${item.actionType}`)}</Text>
                          </View>
                        ) : null}
                        {item.source !== 'followup' ? (
                          <View style={[styles.sourceBadge, item.source === 'interaction' && styles.sourceBadgeInteraction]}>
                            <Text style={[styles.sourceBadgeText, item.source === 'interaction' && styles.sourceBadgeTextInteraction]}>
                              {item.subtitle}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {item.title ? <Text style={[styles.title, item.done && styles.doneText]}>{item.title}</Text> : null}
                      {item.source === 'followup' && item.subtitle ? (
                        <Text style={[styles.content, item.done && styles.doneText]} numberOfLines={2}>{item.subtitle}</Text>
                      ) : null}
                      <Text style={styles.date}>{formatDate(item.dueDate, locale)}</Text>
                    </View>
                    {item.source !== 'interaction' ? (
                      confirmId === item.id ? (
                        <View style={styles.inlineConfirm}>
                          <TouchableOpacity style={styles.confirmCancelBtn} onPress={() => setConfirmId(null)}>
                            <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.confirmDeleteBtn} onPress={() => handleDelete(item)}>
                            <Text style={styles.confirmDeleteText}>{t('common.delete')}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => setConfirmId(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.deleteIcon}>🗑</Text>
                        </TouchableOpacity>
                      )
                    ) : (
                      <Text style={styles.chevron}>›</Text>
                    )}
                  </TouchableOpacity>
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
  container:  { flex: 1, backgroundColor: colors.bgDim },
  list:       { padding: 12, gap: 8 },
  loader:     { marginTop: 40 },
  addBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addBtnText: { color: '#fff', fontSize: 22, lineHeight: 28 },
  done:       { opacity: 0.5 },
  row:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox:   { paddingTop: 2 },
  checkboxText: { fontSize: 20 },
  info:       { flex: 1, gap: 3 },
  badgeRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  title:      { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  content:    { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary },
  doneText:   { textDecorationLine: 'line-through', color: colors.textTertiary },
  date:       { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  deleteIcon: { fontSize: 16, paddingTop: 2 },
  chevron:    { fontSize: 20, color: colors.textTertiary, paddingTop: 2 },

  sourceBadge:              { backgroundColor: colors.bgDim, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  sourceBadgeInteraction:   { backgroundColor: colors.secondaryLight },
  sourceBadgeText:          { fontSize: 10, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.3 },
  sourceBadgeTextInteraction: { color: colors.secondary },

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
