import { useState, useEffect, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Platform, Modal, useWindowDimensions,
} from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/shared/lib/supabase'
import { useAppointmentDetail } from '@/features/appointments/useAppointments'
import type { AppointmentStatus, AppointmentTask, ProspectTemperature, CommercialIntent } from '@/features/appointments/appointmentTypes'
import { PIPELINE_STAGES, type PipelineStage } from '@/shared/lib/types'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  discovery_call:       '#3B82F6',
  product_presentation: '#8B5CF6',
  follow_up:            '#10B981',
  closing_call:         '#F59E0B',
  customer_support:     '#22D3EE',
  team_training:        '#EC4899',
  team_meeting:         '#6366F1',
  webinar:              '#F97316',
  onboarding:           '#06B6D4',
  business_review:      '#84CC16',
  other:                '#94A3B8',
}

const TEMP_COLOR: Record<string, string> = {
  cold: '#3B82F6', warm: '#F59E0B', hot: '#F97316', very_hot: '#EF4444',
}
const TEMP_EMOJI: Record<string, string> = {
  cold: '❄️', warm: '🌤', hot: '🔥', very_hot: '🔥',
}

const STATUS_PILLS: AppointmentStatus[] = ['scheduled', 'completed', 'no_show', 'rescheduled']
const TEMPERATURE_PILLS: ProspectTemperature[] = ['cold', 'warm', 'hot', 'very_hot']
const INTENT_PILLS: CommercialIntent[] = ['buy_product', 'become_customer', 'become_distributor', 'build_team', 'training', 'support', 'other']

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0') }

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function abbreviateName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : full
}

// ── Local types ───────────────────────────────────────────────────────────────

type ClientInfo = { id: string; full_name: string; status: string }
type HistoryItem = { id: string; title: string; status: string; start_at: string }

// ── Sub-components ────────────────────────────────────────────────────────────

function NoteCard({ title, value, onChange, colors, styles }: {
  title: string
  value: string
  onChange: (v: string) => void
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
}) {
  return (
    <View style={styles.noteCard}>
      <Text style={styles.noteCardTitle}>{title}</Text>
      <TextInput
        style={styles.noteInput}
        value={value}
        onChangeText={onChange}
        multiline
        placeholder="—"
        placeholderTextColor={colors.textTertiary}
      />
    </View>
  )
}

function TaskRow({ task, colors, styles, onDone, onRemove, locale }: {
  task: AppointmentTask
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
  onDone: () => void
  onRemove: () => void
  locale: string
}) {
  const { t } = useTranslation()
  const isDone = task.status === 'done'
  const isOverdue = !isDone && !!task.due_at && new Date(task.due_at) < new Date()
  const dueStr = task.due_at
    ? formatDate(task.due_at, locale, { day: '2-digit', month: 'short' })
    : null

  return (
    <View style={[styles.taskRow, isDone && styles.taskRowDone]}>
      <TouchableOpacity
        style={styles.taskCheck}
        onPress={!isDone ? onDone : undefined}
        disabled={isDone}
      >
        <View style={[styles.taskCheckBox, isDone && { backgroundColor: colors.success, borderColor: colors.success }]}>
          {isDone && <Text style={styles.taskCheckMark}>✓</Text>}
        </View>
      </TouchableOpacity>
      <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]} numberOfLines={2}>
        {task.title}
      </Text>
      <View style={styles.taskMeta}>
        {dueStr && (
          <Text style={[styles.taskDue, isOverdue && { color: colors.danger }]}>{dueStr}</Text>
        )}
        <View style={styles.taskTypeBadge}>
          <Text style={styles.taskTypeBadgeText}>{t(`task_types.${task.task_type}` as any)}</Text>
        </View>
        {!isDone && (
          <TouchableOpacity onPress={onRemove} style={styles.taskRemove}>
            <Text style={{ color: colors.textTertiary, fontSize: 18 }}>×</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AppointmentDetailScreen() {
  const { t, i18n } = useTranslation()
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  function goBack() {
    if (returnTo) router.replace(decodeURIComponent(returnTo) as any)
    else router.back()
  }

  const {
    appointment, loading,
    saveNotes, saveBusinessContext, addTask, doneTask, removeTask, update, cancel,
  } = useAppointmentDetail(id ?? null)

  const [clientNotes,       setClientNotes]       = useState('')
  const [internalNotes,     setInternalNotes]      = useState('')
  const [needsIdentified,   setNeedsIdentified]    = useState('')
  const [objections,        setObjections]         = useState('')
  const [productsDiscussed, setProductsDiscussed]  = useState('')
  const [notesDirty,        setNotesDirty]         = useState(false)
  const [saving,            setSaving]             = useState(false)
  const [newTaskTitle,      setNewTaskTitle]       = useState('')
  const [addingTask,        setAddingTask]         = useState(false)
  const [taskError,         setTaskError]          = useState<string | null>(null)
  const [showDebrief,       setShowDebrief]        = useState(false)
  const [showCancelConfirm, setShowCancelConfirm]  = useState(false)
  const [cancelling,        setCancelling]         = useState(false)
  const [inlineError,       setInlineError]        = useState<string | null>(null)
  const [practitionerName,  setPractitionerName]   = useState('')
  const [clientInfo,        setClientInfo]         = useState<ClientInfo | null>(null)
  const [clientHistory,     setClientHistory]      = useState<HistoryItem[]>([])
  const [estValue,          setEstValue]           = useState('')
  const [bizValueDirty,     setBizValueDirty]      = useState(false)
  const [savingBizValue,    setSavingBizValue]     = useState(false)

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { width: screenW } = useWindowDimensions()
  const isWeb  = Platform.OS === 'web' && screenW >= 768

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const n = appointment?.notes
    if (!n) return
    setClientNotes(n.client_notes ?? '')
    setInternalNotes(n.internal_notes ?? '')
    setNeedsIdentified(n.needs_identified ?? '')
    setObjections(n.objections ?? '')
    setProductsDiscussed(n.products_discussed ?? '')
    setNotesDirty(false)
  }, [appointment?.notes])

  useEffect(() => {
    const biz = appointment?.business_context
    setEstValue(biz?.estimated_value != null ? String(biz.estimated_value) : '')
    setBizValueDirty(false)
  }, [appointment?.business_context])

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('full_name').eq('id', user.id).single()
        .then(({ data }) => { if (data?.full_name) setPractitionerName(abbreviateName(data.full_name as string)) })
    })
  }, [])

  useEffect(() => {
    const cid = appointment?.client_id
    if (!cid) return
    supabase.from('clients').select('id, full_name, status').eq('id', cid).single()
      .then(({ data }) => { if (data) setClientInfo(data as ClientInfo) })
    supabase.from('appointments')
      .select('id, title, status, start_at')
      .eq('client_id', cid)
      .neq('id', appointment!.id)
      .order('start_at', { ascending: false })
      .limit(5)
      .then(({ data }) => { if (data) setClientHistory(data as HistoryItem[]) })
  }, [appointment?.client_id, appointment?.id])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function noteChanger(setter: (v: string) => void) {
    return (v: string) => { setter(v); setNotesDirty(true) }
  }

  async function handleSaveNotes() {
    if (!notesDirty) return
    setSaving(true)
    setInlineError(null)
    const ok = await saveNotes({
      client_notes:       clientNotes || undefined,
      internal_notes:     internalNotes || undefined,
      needs_identified:   needsIdentified || undefined,
      objections:         objections || undefined,
      products_discussed: productsDiscussed || undefined,
    })
    setSaving(false)
    if (!ok) setInlineError(t('appointments.error_save_notes'))
    else setNotesDirty(false)
  }

  async function handleStatusChange(status: AppointmentStatus) {
    setInlineError(null)
    const wasCompleted = appointment?.status === 'completed'
    const ok = await update({ status })
    if (!ok) { setInlineError(t('appointments.error_update_status')); return }
    if (status === 'completed' && !wasCompleted) setShowDebrief(true)
  }

  async function handlePipelineChange(stage: PipelineStage) {
    setInlineError(null)
    const ok = await saveBusinessContext({ pipeline_stage: stage })
    if (!ok) { setInlineError(t('appointments.error_save_business')); return }
    // Le statut du client doit refléter la dernière étape constatée en RDV.
    if (appointment?.client_id) {
      await supabase.from('clients').update({ pipeline_stage: stage }).eq('id', appointment.client_id)
    }
  }

  async function handleTemperatureChange(temp: ProspectTemperature) {
    setInlineError(null)
    const ok = await saveBusinessContext({ prospect_temperature: temp })
    if (!ok) setInlineError(t('appointments.error_save_business'))
  }

  async function handleIntentChange(intent: CommercialIntent) {
    setInlineError(null)
    const ok = await saveBusinessContext({ commercial_intent: intent })
    if (!ok) setInlineError(t('appointments.error_save_business'))
  }

  async function handleSaveBizValue() {
    if (!bizValueDirty) return
    setSavingBizValue(true)
    setInlineError(null)
    const trimmed = estValue.trim()
    const payload: { estimated_value?: number } = {}
    if (trimmed) payload.estimated_value = parseFloat(trimmed)
    const ok = await saveBusinessContext(payload)
    setSavingBizValue(false)
    if (ok) setBizValueDirty(false)
    else setInlineError(t('appointments.error_save_business'))
  }

  async function handleAddTask() {
    const title = newTaskTitle.trim()
    if (!title) { setTaskError(t('appointments.error_task_title_required')); return }
    setTaskError(null)
    setAddingTask(true)
    const ok = await addTask({ title, task_type: 'follow_up', client_id: appointment?.client_id ?? undefined })
    setAddingTask(false)
    if (ok) setNewTaskTitle('')
    else setTaskError(t('appointments.error_add_task'))
  }

  async function handleDoneTask(taskId: string) {
    const ok = await doneTask(taskId)
    if (!ok) setInlineError(t('appointments.error_done_task'))
  }

  async function handleRemoveTask(taskId: string) {
    const ok = await removeTask(taskId)
    if (!ok) setInlineError(t('appointments.error_remove_task'))
  }

  async function handleConfirmCancel() {
    setCancelling(true)
    setInlineError(null)
    const ok = await cancel()
    setCancelling(false)
    if (ok) {
      setShowCancelConfirm(false)
      goBack()
    } else {
      setShowCancelConfirm(false)
      setInlineError(t('appointments.error_update_status'))
    }
  }

  // ── Loading / Not found ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: '', headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </>
    )
  }

  if (!appointment) {
    return (
      <>
        <Stack.Screen options={{ title: t('appointments.title') }} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('appointments.not_found')}</Text>
        </View>
      </>
    )
  }

  // ── Computed ──────────────────────────────────────────────────────────────────

  const biz         = appointment.business_context
  const startDate   = new Date(appointment.start_at)
  const endDate     = new Date(appointment.end_at)
  const accentColor = TYPE_COLORS[appointment.appointment_type] ?? '#94A3B8'
  const dateStr     = formatDate(startDate, locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  const startTime   = `${pad2(startDate.getHours())}h${pad2(startDate.getMinutes())}`
  const endTime     = `${pad2(endDate.getHours())}h${pad2(endDate.getMinutes())}`
  const isCancelled = appointment.status === 'cancelled'

  const tasksOverdue = appointment.tasks.filter(
    tk => tk.status !== 'done' && tk.status !== 'cancelled' && !!tk.due_at && new Date(tk.due_at) < new Date()
  )

  const STATUS_COLOR: Record<AppointmentStatus, string> = {
    scheduled:   colors.primary,
    completed:   colors.success,
    cancelled:   colors.danger,
    no_show:     colors.warning,
    rescheduled: colors.textSecondary,
  }

  // ── Sections ───────────────────────────────────────────────────────────────────

  const heroSection = (
    <View style={styles.heroCard}>
      <View style={styles.heroRow}>
        <View style={[styles.heroAccent, { backgroundColor: accentColor }]} />
        <View style={styles.heroBody}>
          <Text style={styles.heroTitle}>{appointment.title}</Text>
          <Text style={styles.heroSub}>
            {dateStr} · {startTime} → {endTime} · {appointment.duration_minutes} min
          </Text>

          <View style={styles.pillsRow}>
            <View style={[styles.pill, { backgroundColor: accentColor + '22' }]}>
              <Text style={[styles.pillText, { color: accentColor }]}>
                {t(`appointment_types.${appointment.appointment_type}` as any)}
              </Text>
            </View>
            {biz?.prospect_temperature ? (
              <View style={[styles.pill, { backgroundColor: TEMP_COLOR[biz.prospect_temperature] + '22' }]}>
                <Text style={styles.pillEmoji}>{TEMP_EMOJI[biz.prospect_temperature]}</Text>
                <Text style={[styles.pillText, { color: TEMP_COLOR[biz.prospect_temperature] }]}>
                  {t(`prospect_temperatures.${biz.prospect_temperature}` as any)}
                </Text>
              </View>
            ) : null}
            {biz?.pipeline_stage ? (
              <View style={[styles.pill, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.pillText, { color: colors.primary }]}>
                  {t(`pipeline_stages.${biz.pipeline_stage}` as any)}
                </Text>
              </View>
            ) : null}
            {isCancelled ? (
              <View style={[styles.pill, { backgroundColor: colors.danger + '22' }]}>
                <Text style={[styles.pillText, { color: colors.danger }]}>
                  {t('appointment_statuses.cancelled')}
                </Text>
              </View>
            ) : null}
          </View>

          {(biz?.commercial_intent || biz?.estimated_value != null || appointment.location || practitionerName) ? (
            <View style={styles.metaGrid}>
              {biz?.commercial_intent ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.meta_intent')}</Text>
                  <Text style={styles.metaValue}>{t(`commercial_intents.${biz.commercial_intent}` as any)}</Text>
                </View>
              ) : null}
              {biz?.estimated_value != null ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.field_value')}</Text>
                  <Text style={styles.metaValue}>{biz.estimated_value} {biz.currency}</Text>
                </View>
              ) : null}
              {!!appointment.location ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.field_location')}</Text>
                  <Text style={styles.metaValue}>{appointment.location}</Text>
                </View>
              ) : null}
              {!!practitionerName ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.meta_practitioner')}</Text>
                  <Text style={styles.metaValue}>{practitionerName}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )

  const statusSection = (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.status_label')}</Text>
      <View style={styles.statusPills}>
        {STATUS_PILLS.map(s => {
          const active = appointment.status === s
          return (
            <TouchableOpacity
              key={s}
              onPress={() => handleStatusChange(s)}
              style={[
                styles.statusPill,
                active && { backgroundColor: STATUS_COLOR[s] + '22', borderColor: STATUS_COLOR[s] },
              ]}
              activeOpacity={0.75}
            >
              <Text style={[
                styles.statusPillText,
                { color: active ? STATUS_COLOR[s] : colors.textSecondary },
                active && { fontFamily: fonts.semibold },
              ]}>
                {t(`appointment_statuses.${s}` as any)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )

  const commercialSection = (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.section_commercial')}</Text>

      <Text style={styles.commercialSubLabel}>{t('appointments.field_pipeline')}</Text>
      <View style={styles.statusPills}>
        {PIPELINE_STAGES.map(stage => {
          const active = biz?.pipeline_stage === stage
          return (
            <TouchableOpacity
              key={stage}
              onPress={() => handlePipelineChange(stage)}
              style={[styles.statusPill, active && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
              activeOpacity={0.75}
            >
              <Text style={[styles.statusPillText, { color: active ? colors.primary : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                {t(`pipeline_stages.${stage}` as any)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <Text style={styles.commercialSubLabel}>{t('appointments.field_temperature')}</Text>
      <View style={styles.statusPills}>
        {TEMPERATURE_PILLS.map(temp => {
          const active = biz?.prospect_temperature === temp
          return (
            <TouchableOpacity
              key={temp}
              onPress={() => handleTemperatureChange(temp)}
              style={[styles.statusPill, active && { backgroundColor: TEMP_COLOR[temp] + '22', borderColor: TEMP_COLOR[temp] }]}
              activeOpacity={0.75}
            >
              <Text style={[styles.statusPillText, { color: active ? TEMP_COLOR[temp] : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                {TEMP_EMOJI[temp]} {t(`prospect_temperatures.${temp}` as any)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <Text style={styles.commercialSubLabel}>{t('appointments.field_intent')}</Text>
      <View style={styles.statusPills}>
        {INTENT_PILLS.map(intent => {
          const active = biz?.commercial_intent === intent
          return (
            <TouchableOpacity
              key={intent}
              onPress={() => handleIntentChange(intent)}
              style={[styles.statusPill, active && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
              activeOpacity={0.75}
            >
              <Text style={[styles.statusPillText, { color: active ? colors.primary : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                {t(`commercial_intents.${intent}` as any)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <Text style={styles.commercialSubLabel}>{t('appointments.field_value')}</Text>
      <TextInput
        style={styles.bizValueInput}
        value={estValue}
        onChangeText={(v) => { setEstValue(v); setBizValueDirty(true) }}
        placeholder="0.00"
        placeholderTextColor={colors.textTertiary}
        keyboardType="decimal-pad"
      />
      {bizValueDirty ? (
        <TouchableOpacity
          style={[styles.saveBtn, savingBizValue && styles.saveBtnDisabled]}
          onPress={handleSaveBizValue}
          disabled={savingBizValue}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>
            {savingBizValue ? t('appointments.saving') : t('common.save')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )

  const debriefModal = (
    <Modal visible={showDebrief} transparent animationType="slide" onRequestClose={() => setShowDebrief(false)}>
      <View style={styles.debriefOverlay}>
        <View style={styles.debriefSheet}>
          <View style={styles.debriefHandle} />
          <View style={styles.debriefHeader}>
            <Text style={styles.debriefTitle}>{t('appointments.debrief_title')}</Text>
            <TouchableOpacity onPress={() => setShowDebrief(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.debriefClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.debriefSub}>{t('appointments.debrief_sub')}</Text>

          <ScrollView style={{ maxHeight: 380 }}>
            <Text style={styles.commercialSubLabel}>{t('appointments.field_temperature')}</Text>
            <View style={styles.statusPills}>
              {TEMPERATURE_PILLS.map(temp => {
                const active = biz?.prospect_temperature === temp
                return (
                  <TouchableOpacity
                    key={temp}
                    onPress={() => handleTemperatureChange(temp)}
                    style={[styles.statusPill, active && { backgroundColor: TEMP_COLOR[temp] + '22', borderColor: TEMP_COLOR[temp] }]}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.statusPillText, { color: active ? TEMP_COLOR[temp] : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                      {TEMP_EMOJI[temp]} {t(`prospect_temperatures.${temp}` as any)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.commercialSubLabel}>{t('appointments.field_intent')}</Text>
            <View style={styles.statusPills}>
              {INTENT_PILLS.map(intent => {
                const active = biz?.commercial_intent === intent
                return (
                  <TouchableOpacity
                    key={intent}
                    onPress={() => handleIntentChange(intent)}
                    style={[styles.statusPill, active && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.statusPillText, { color: active ? colors.primary : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                      {t(`commercial_intents.${intent}` as any)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.commercialSubLabel}>{t('appointments.field_pipeline')}</Text>
            <View style={styles.statusPills}>
              {PIPELINE_STAGES.map(stage => {
                const active = biz?.pipeline_stage === stage
                return (
                  <TouchableOpacity
                    key={stage}
                    onPress={() => handlePipelineChange(stage)}
                    style={[styles.statusPill, active && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.statusPillText, { color: active ? colors.primary : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                      {t(`pipeline_stages.${stage}` as any)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.debriefDoneBtn} onPress={() => setShowDebrief(false)} activeOpacity={0.85}>
            <Text style={styles.debriefDoneBtnText}>{t('appointments.debrief_done')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )

  const cancelBanner = showCancelConfirm ? (
    <View style={styles.cancelBanner}>
      <Text style={styles.cancelBannerText}>{t('appointments.cancel_confirm_title')}</Text>
      <View style={styles.cancelBannerBtns}>
        <TouchableOpacity style={styles.cancelBannerNo} onPress={() => setShowCancelConfirm(false)} disabled={cancelling}>
          <Text style={[styles.cancelBannerNoText, { color: colors.text }]}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cancelBannerYes, cancelling && { opacity: 0.6 }]} onPress={handleConfirmCancel} disabled={cancelling}>
          <Text style={styles.cancelBannerYesText}>{t('appointments.cancel_rdv')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : null

  const notesSection = (
    <>
      <View style={isWeb ? styles.notesRow : styles.notesStack}>
        <NoteCard title={t('appointments.field_client_notes')}   value={clientNotes}      onChange={noteChanger(setClientNotes)}      colors={colors} styles={styles} />
        <NoteCard title={t('appointments.field_internal_notes')} value={internalNotes}    onChange={noteChanger(setInternalNotes)}    colors={colors} styles={styles} />
      </View>
      <View style={isWeb ? styles.notesRow : styles.notesStack}>
        <NoteCard title={t('appointments.field_objections')}     value={objections}       onChange={noteChanger(setObjections)}       colors={colors} styles={styles} />
        <NoteCard title={t('appointments.field_needs')}          value={needsIdentified}  onChange={noteChanger(setNeedsIdentified)}  colors={colors} styles={styles} />
      </View>
      <NoteCard title={t('appointments.field_products')} value={productsDiscussed} onChange={noteChanger(setProductsDiscussed)} colors={colors} styles={styles} />
      {notesDirty ? (
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSaveNotes}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>
            {saving ? t('appointments.saving') : t('appointments.save_notes')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </>
  )

  const tasksSection = (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.section_tasks')}</Text>
      {appointment.tasks.length === 0 ? (
        <Text style={styles.emptyTaskText}>{t('appointments.no_tasks_appt')}</Text>
      ) : (
        appointment.tasks.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            colors={colors}
            styles={styles}
            locale={locale}
            onDone={() => handleDoneTask(task.id)}
            onRemove={() => handleRemoveTask(task.id)}
          />
        ))
      )}
      <View style={styles.addTaskRow}>
        <TextInput
          style={styles.addTaskInput}
          value={newTaskTitle}
          onChangeText={(v) => { setNewTaskTitle(v); if (taskError) setTaskError(null) }}
          placeholder={t('appointments.add_task_placeholder')}
          placeholderTextColor={colors.textTertiary}
          onSubmitEditing={handleAddTask}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.addTaskBtn, (addingTask || !newTaskTitle.trim()) && { opacity: 0.5 }]}
          onPress={handleAddTask}
          disabled={addingTask}
          activeOpacity={0.8}
        >
          {addingTask
            ? <ActivityIndicator size="small" color="#ffffff" />
            : <Text style={styles.addTaskBtnText}>+</Text>
          }
        </TouchableOpacity>
      </View>
      {taskError ? <Text style={styles.taskErrorText}>{taskError}</Text> : null}
    </View>
  )

  const errorBanner = inlineError ? (
    <Text style={styles.errorText}>{inlineError}</Text>
  ) : null

  const headerRight = () => (
    <View style={styles.headerBtns}>
      {!isCancelled ? (
        <TouchableOpacity
          style={styles.headerBtnDanger}
          onPress={() => setShowCancelConfirm(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.headerBtnDangerText}>{t('appointments.cancel_rdv')}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={styles.headerBtnPrimary}
        onPress={() => router.push(`/(app)/appointments/new?id=${id}` as any)}
        activeOpacity={0.8}
      >
        <Text style={styles.headerBtnPrimaryText}>{t('common.edit')}</Text>
      </TouchableOpacity>
    </View>
  )

  // ── Web sidebar ────────────────────────────────────────────────────────────────

  const sidebar = (
    <View style={styles.webSidebar}>
      {biz ? (
        <View style={styles.sideSection}>
          <Text style={styles.sideSectionTitle}>{t('appointments.commercial_summary')}</Text>
          {biz.pipeline_stage ? (
            <View style={styles.sideKpiRow}>
              <Text style={styles.sideKpiLabel}>{t('appointments.field_pipeline')}</Text>
              <Text style={styles.sideKpiValue}>{t(`pipeline_stages.${biz.pipeline_stage}` as any)}</Text>
            </View>
          ) : null}
          {biz.prospect_temperature ? (
            <View style={styles.sideKpiRow}>
              <Text style={styles.sideKpiLabel}>{t('appointments.field_temperature')}</Text>
              <Text style={[styles.sideKpiValue, { color: TEMP_COLOR[biz.prospect_temperature] }]}>
                {TEMP_EMOJI[biz.prospect_temperature]} {t(`prospect_temperatures.${biz.prospect_temperature}` as any)}
              </Text>
            </View>
          ) : null}
          {biz.estimated_value != null ? (
            <View style={styles.sideKpiRow}>
              <Text style={styles.sideKpiLabel}>{t('appointments.field_value')}</Text>
              <Text style={styles.sideKpiValue}>{biz.estimated_value} {biz.currency}</Text>
            </View>
          ) : null}
          {biz.commercial_intent ? (
            <View style={styles.sideKpiRow}>
              <Text style={styles.sideKpiLabel}>{t('appointments.meta_intent')}</Text>
              <Text style={styles.sideKpiValue}>{t(`commercial_intents.${biz.commercial_intent}` as any)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {clientInfo ? (
        <View style={styles.sideSection}>
          <Text style={styles.sideSectionTitle}>{t('appointments.client_section')}</Text>
          <TouchableOpacity
            style={styles.sideClientCard}
            onPress={() => router.push(`/(app)/clients/${clientInfo.id}` as any)}
            activeOpacity={0.8}
          >
            <View style={[styles.sideAvatar, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.sideAvatarText, { color: colors.primary }]}>
                {getInitials(clientInfo.full_name)}
              </Text>
            </View>
            <View>
              <Text style={styles.sideClientName}>{clientInfo.full_name}</Text>
              <Text style={styles.sideClientSub}>{t(`client_statuses.${clientInfo.status}` as any)}</Text>
            </View>
          </TouchableOpacity>
        </View>
      ) : null}

      {clientHistory.length > 0 ? (
        <View style={styles.sideSection}>
          <Text style={styles.sideSectionTitle}>{t('appointments.historique_rdv')}</Text>
          <View style={styles.sideHistory}>
            {clientHistory.map(h => (
              <TouchableOpacity
                key={h.id}
                style={styles.sideHistoryItem}
                onPress={() => router.push(`/(app)/appointments/${h.id}` as any)}
                activeOpacity={0.8}
              >
                <Text style={styles.sideHistoryTitle} numberOfLines={1}>{h.title}</Text>
                <Text style={styles.sideHistoryDate}>
                  {formatDate(h.start_at, locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}{t(`appointment_statuses.${h.status}` as any)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {tasksOverdue.length > 0 ? (
        <View style={styles.sideOverdue}>
          <Text style={styles.sideOverdueText}>⚠️ {tasksOverdue.length} {t('appointments.tasks_overdue')}</Text>
        </View>
      ) : null}
    </View>
  )

  // ── Web layout ─────────────────────────────────────────────────────────────────
  if (isWeb) {
    return (
      <>
        <Stack.Screen options={{
          title: t('appointments.detail_title'),
          headerLeft: () => (
            <TouchableOpacity onPress={goBack} style={styles.headerBackBtn}>
              <Text style={styles.headerBackText}>‹ {t('appointments.back_agenda')}</Text>
            </TouchableOpacity>
          ),
          headerRight,
        }} />
        <View style={styles.webLayout}>
          <ScrollView style={styles.webMain} contentContainerStyle={styles.scrollContent}>
            {heroSection}
            {cancelBanner}
            {errorBanner}
            {statusSection}
        {commercialSection}
            {notesSection}
            {tasksSection}
          </ScrollView>
          {sidebar}
        </View>
        {debriefModal}
      </>
    )
  }

  // ── Mobile layout ──────────────────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen options={{
        title: t('appointments.detail_title'),
        headerBackTitle: '',
        headerLeft: () => (
          <TouchableOpacity onPress={goBack} style={styles.headerBackBtnMobile} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.headerBackArrowMobile}>‹</Text>
          </TouchableOpacity>
        ),
        headerRight,
      }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        {heroSection}
        {cancelBanner}
        {errorBanner}
        {statusSection}
        {commercialSection}
        {clientInfo ? (
          <TouchableOpacity
            style={styles.mobileClientCard}
            onPress={() => router.push(`/(app)/clients/${clientInfo.id}` as any)}
            activeOpacity={0.8}
          >
            <View style={[styles.sideAvatar, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.sideAvatarText, { color: colors.primary }]}>
                {getInitials(clientInfo.full_name)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sideClientName}>{clientInfo.full_name}</Text>
              <Text style={styles.sideClientSub}>{t('appointments.view_client_file')} →</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {notesSection}
        {tasksSection}
      </ScrollView>
      {debriefModal}
    </>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.bgDim },
    center:        { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgDim },
    scrollContent: { padding: 16, gap: 14, paddingBottom: 40 },
    emptyText:     { fontSize: 15, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },

    // Hero
    heroCard:    { backgroundColor: colors.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
    heroRow:     { flexDirection: 'row' },
    heroAccent:  { width: 4 },
    heroBody:    { flex: 1, padding: 16, gap: 8 },
    heroTitle:   { fontSize: 20, fontFamily: fonts.semibold, color: colors.text, lineHeight: 26 },
    heroSub:     { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },

    pillsRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    pill:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
    pillEmoji:   { fontSize: 12 },
    pillText:    { fontSize: 11, fontFamily: fonts.semibold },

    metaGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    metaItem:    { minWidth: '45%', flex: 1 },
    metaLabel:   { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginBottom: 2 },
    metaValue:   { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },

    // Generic card
    card:      { backgroundColor: colors.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 16 },
    cardLabel: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },

    // Status pills
    statusPills:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statusPill:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 0.5, borderColor: colors.border },
    statusPillText: { fontSize: 12, fontFamily: fonts.medium },

    // Commercial context
    commercialSubLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary, marginTop: 14, marginBottom: 8 },
    bizValueInput: { fontSize: 14, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, padding: 10, maxWidth: 160 },

    // Cancel banner
    cancelBanner:        { backgroundColor: colors.danger + '10', borderRadius: 12, borderWidth: 1, borderColor: colors.danger + '40', padding: 14, gap: 10 },
    cancelBannerText:    { fontSize: 14, fontFamily: fonts.medium, color: colors.text, textAlign: 'center' },
    cancelBannerBtns:    { flexDirection: 'row', gap: 10 },
    cancelBannerNo:      { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center' },
    cancelBannerNoText:  { fontSize: 13, fontFamily: fonts.medium },
    cancelBannerYes:     { flex: 1, paddingVertical: 9, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center' },
    cancelBannerYesText: { fontSize: 13, fontFamily: fonts.semibold, color: '#ffffff' },

    // Notes
    notesRow:      { flexDirection: 'row', gap: 12 },
    notesStack:    { flexDirection: 'column', gap: 12 },
    noteCard:      { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 12, gap: 6 },
    noteCardTitle: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    noteInput:     { fontSize: 13, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, padding: 8, minHeight: 64, textAlignVertical: 'top' },
    saveBtn:         { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText:     { fontSize: 14, fontFamily: fonts.semibold, color: '#ffffff' },

    // Debrief modal
    debriefOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    debriefSheet: {
      backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingHorizontal: 20, paddingBottom: 32, maxHeight: '85%',
    },
    debriefHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    debriefHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
    debriefTitle:  { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
    debriefClose:  { fontSize: 16, color: colors.textTertiary, padding: 4 },
    debriefSub:    { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, marginBottom: 12, lineHeight: 18 },
    debriefDoneBtn:     { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
    debriefDoneBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#ffffff' },

    // Tasks
    emptyTaskText:     { fontSize: 13, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', paddingVertical: 8 },
    taskRow:           { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    taskRowDone:       { opacity: 0.5 },
    taskCheck:         { padding: 2 },
    taskCheckBox:      { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    taskCheckMark:     { fontSize: 11, color: '#ffffff', fontFamily: fonts.bold },
    taskTitle:         { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    taskTitleDone:     { fontFamily: fonts.body, textDecorationLine: 'line-through' },
    taskMeta:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
    taskDue:           { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },
    taskTypeBadge:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.bgDim },
    taskTypeBadgeText: { fontSize: 10, fontFamily: fonts.medium, color: colors.textSecondary },
    taskRemove:        { padding: 4 },
    addTaskRow:        { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
    addTaskInput:      { flex: 1, fontSize: 13, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
    addTaskBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    addTaskBtnText:    { fontSize: 20, fontFamily: fonts.bold, color: '#ffffff', lineHeight: 24 },
    taskErrorText:     { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, marginTop: 6 },

    errorText: { fontSize: 13, fontFamily: fonts.body, color: colors.danger, textAlign: 'center', paddingHorizontal: 4 },

    // Header
    headerBackBtn:        { paddingHorizontal: 12 },
    headerBackText:       { fontSize: 14, fontFamily: fonts.medium, color: colors.primary },
    headerBackBtnMobile:  { paddingHorizontal: 12, paddingVertical: 4 },
    headerBackArrowMobile:{ fontSize: 24, fontFamily: fonts.medium, color: colors.primary, lineHeight: 28 },
    headerBtns:           { flexDirection: 'row', gap: 8, marginRight: 4 },
    headerBtnDanger:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 0.5, borderColor: colors.danger },
    headerBtnDangerText:  { fontSize: 12, fontFamily: fonts.medium, color: colors.danger },
    headerBtnPrimary:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary },
    headerBtnPrimaryText: { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

    // Mobile client card
    mobileClientCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },

    // Web layout
    webLayout: { flex: 1, flexDirection: 'row', backgroundColor: colors.bgDim },
    webMain:   { flex: 1 },

    // Sidebar
    webSidebar:       { width: 260, backgroundColor: colors.surface, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border, padding: 16 },
    sideSection:      { marginBottom: 20 },
    sideSectionTitle: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
    sideKpiRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    sideKpiLabel:     { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
    sideKpiValue:     { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    sideClientCard:   { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, backgroundColor: colors.card, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    sideAvatar:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    sideAvatarText:   { fontSize: 13, fontFamily: fonts.semibold },
    sideClientName:   { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    sideClientSub:    { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },
    sideHistory:      { gap: 6 },
    sideHistoryItem:  { padding: 8, backgroundColor: colors.card, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    sideHistoryTitle: { fontSize: 12, fontFamily: fonts.semibold, color: colors.text },
    sideHistoryDate:  { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 2 },
    sideOverdue:      { backgroundColor: colors.danger + '18', borderRadius: 8, padding: 10 },
    sideOverdueText:  { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  })
}
