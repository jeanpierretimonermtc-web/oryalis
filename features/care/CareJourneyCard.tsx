import { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import type { MessageTemplate } from '@/features/messages/templates'
import { useEntitlements } from '@/features/subscriptions/useEntitlements'
import type { CareJourney, Client, Followup } from '@/shared/lib/types'
import { CARE_CHANNEL_ICON } from './careTemplates'
import type { CareChannel } from './careTemplates'
import { stopCareJourney } from './careJourneyService'
import { CareJourneyStartModal } from './CareJourneyStartModal'

const PAID_PLANS = ['pro', 'cabinet', 'advisor', 'leader', 'enterprise']

interface Props {
  client: Client
  userId: string
  advisorName: string
  journey: CareJourney | null
  steps: Followup[]
  // Clôture d'une étape : même FollowupCompletionModal que le reste de la fiche (géré par l'appelant).
  onCompleteStep: (step: Followup) => void
  onChanged: () => void
}

export function CareJourneyCard({ client, userId, advisorName, journey, steps, onCompleteStep, onChanged }: Props) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { plan, loading: planLoading } = useEntitlements()

  const [startOpen, setStartOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const fmt = (d: string) => formatDate(`${d.slice(0, 10)}T12:00:00`, locale)
  const isActive = journey?.status === 'active'
  const pending = steps.filter(s => !s.done && !s.cancelled_at)
  const next = isActive ? pending[0] ?? null : null
  const doneCount = steps.filter(s => s.done).length

  const nextTemplate = useMemo<MessageTemplate | null>(() => next ? {
    id: `care-${next.id}`,
    category: 'suivi',
    channel: 'all',
    name: next.title ?? '',
    body: next.message_body ?? '',
  } : null, [next?.id, next?.title, next?.message_body])

  if (planLoading) return null

  async function handleStop() {
    if (!journey) return
    setStopping(true)
    setErrorMsg('')
    try {
      await stopCareJourney(journey.id)
      setConfirmStop(false)
      setExpanded(false)
      onChanged()
    } catch (e) {
      console.error('[care.stop]', e)
      setErrorMsg(t('care.error'))
    } finally {
      setStopping(false)
    }
  }

  const startModal = (
    <CareJourneyStartModal
      visible={startOpen}
      onClose={() => setStartOpen(false)}
      client={client}
      userId={userId}
      advisorName={advisorName}
      onStarted={() => { setStartOpen(false); onChanged() }}
    />
  )

  // ── Aucun accompagnement en cours (ou toutes ses étapes terminées) ─────────────────────────
  if (!isActive || !next) {
    const paid = PAID_PLANS.includes(plan)
    const finishedActive = isActive && !next
    // DESIGN-B — sans accompagnement en cours : une simple pastille, jamais une grande carte vide.
    return (
      <View style={styles.wrap}>
        {finishedActive && journey ? (
          <Text style={[styles.metaText, styles.finishedText]}>🌱 {journey.label} · {t('care.finished')}</Text>
        ) : null}
        {paid ? (
          <TouchableOpacity
            style={styles.startPill}
            onPress={() => setStartOpen(true)}
            activeOpacity={0.8}
            accessibilityHint={t('care.empty_hint')}
          >
            <Text style={styles.startPillText}>🌱 {journey ? t('care.start_new_cta') : t('care.start_cta')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.lockedRow}>
            <Text style={[styles.metaText, { flex: 1 }]}>🌱 {t('care.eyebrow')} · {t('care.locked_hint')}</Text>
            <TouchableOpacity onPress={() => router.push('/(app)/settings-subscription' as any)} activeOpacity={0.7}>
              <Text style={styles.linkText}>{t('care.locked_cta')} ›</Text>
            </TouchableOpacity>
          </View>
        )}
        {startModal}
      </View>
    )
  }

  // ── Accompagnement en cours ──────────────────────────────────────────────────────────────
  const channel = (next.action_type ?? 'whatsapp') as CareChannel
  const channelLabel = `${CARE_CHANNEL_ICON[channel] ?? '💬'} ${t(`next_action_types.${channel}`)}`

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>🌱 {journey!.label}</Text>
          <Text style={styles.progressText}>{t('care.step_progress', { current: doneCount + 1, total: steps.length })}</Text>
        </View>
        <View style={styles.dotsRow}>
          {steps.map(s => (
            <View
              key={s.id}
              style={[
                styles.dot,
                s.done && styles.dotDone,
                s.id === next.id && styles.dotNext,
                !!s.cancelled_at && styles.dotCancelled,
              ]}
            />
          ))}
        </View>
        <Text style={styles.nextText}>
          {t('care.next_step', { step: next.title ?? '', channel: channelLabel, date: fmt(next.due_date) })}
        </Text>
        {next.message_body ? <Text style={styles.messageText} numberOfLines={2}>« {next.message_body} »</Text> : null}

        <View style={styles.btnRow}>
          {next.message_body ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => setMessageOpen(true)} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>{CARE_CHANNEL_ICON[channel] ?? '💬'} {t('care.send')}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.outlineBtn} onPress={() => onCompleteStep(next)} activeOpacity={0.8}>
            <Text style={styles.outlineBtnText}>✓ {t('care.done')}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => { setExpanded(v => !v); setConfirmStop(false) }} activeOpacity={0.7}>
            <Text style={styles.linkText}>{expanded ? t('care.hide') : `${t('care.manage')} ›`}</Text>
          </TouchableOpacity>
        </View>

        {expanded ? (
          <View style={styles.stepsList}>
            <Text style={styles.metaText}>{t('care.started_on', { date: fmt(journey!.start_date) })}</Text>
            {steps.map(s => {
              const status = s.done ? t('care.status_done') : s.cancelled_at ? t('care.status_cancelled') : t('care.status_todo')
              return (
                <View key={s.id} style={styles.stepRow}>
                  <Text style={styles.stepIcon}>{s.done ? '✅' : s.cancelled_at ? '⛔' : CARE_CHANNEL_ICON[(s.action_type ?? 'whatsapp') as CareChannel] ?? '💬'}</Text>
                  <Text style={[styles.stepLabel, s.id === next.id && { color: colors.primary }]} numberOfLines={1}>{s.title}</Text>
                  <Text style={styles.stepMeta}>{fmt(s.due_date)} · {status}</Text>
                </View>
              )
            })}
            {confirmStop ? (
              <View style={styles.confirmBox}>
                <Text style={styles.metaText}>{t('care.stop_confirm')}</Text>
                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.outlineBtn} onPress={() => setConfirmStop(false)} disabled={stopping} activeOpacity={0.8}>
                    <Text style={styles.outlineBtnText}>{t('care.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dangerBtn} onPress={handleStop} disabled={stopping} activeOpacity={0.85}>
                    {stopping ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>{t('care.stop_confirm_cta')}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setConfirmStop(true)} activeOpacity={0.7}>
                <Text style={styles.stopText}>{t('care.stop')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}
        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
      </View>

      <MessageModal
        visible={messageOpen}
        onClose={() => setMessageOpen(false)}
        client={client}
        advisorName={advisorName}
        initialTemplate={nextTemplate}
        editable
        title={next.title ?? undefined}
        // Tous les canaux disponibles restent proposés, quel que soit le canal prévu pour l'étape
        // (celui-ci est seulement mis en avant).
        enableEmail
        // MSG-UI-1 — message imposé par l'étape, canal de l'étape en action principale, et
        // clôture de l'étape proposée juste après l'envoi.
        lockTemplate
        preferredChannel={channel === 'call' ? undefined : channel}
        doneAction={{ label: t('care.mark_done'), onPress: () => onCompleteStep(next) }}
      />
      {startModal}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { width: '100%', paddingHorizontal: 20, marginBottom: 14, gap: 6 },
    card: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
    startPill: { width: '100%', alignItems: 'center', paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.surface },
    startPillText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    finishedText: { textAlign: 'center' },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    eyebrow: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, flexShrink: 1 },
    progressText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    dotsRow: { flexDirection: 'row', gap: 6 },
    dot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.bgDim },
    dotDone: { backgroundColor: colors.success },
    dotNext: { backgroundColor: colors.primary },
    dotCancelled: { backgroundColor: colors.border },
    nextText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    messageText: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19 },
    metaText: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
    btnRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    primaryBtn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.primaryAction },
    primaryBtnText: { fontSize: 13.5, fontFamily: fonts.semibold, color: colors.onPrimary },
    outlineBtn: { alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    outlineBtnText: { fontSize: 13.5, fontFamily: fonts.semibold, color: colors.text },
    dangerBtn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.danger },
    linkText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepsList: { gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 2 },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    stepIcon: { fontSize: 13, width: 20 },
    stepLabel: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    stepMeta: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    stopText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.danger, paddingVertical: 6 },
    confirmBox: { gap: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 10 },
    errorText: { fontSize: 12, fontFamily: fonts.medium, color: colors.danger },
  })
}
