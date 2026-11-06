import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, useWindowDimensions } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import type { Followup } from '@/shared/lib/types'
import { NextStepSelector, defaultNextStepValue, buildFollowupInputFromNextStep } from '@/features/interactions/NextStepSelector'
import type { NextStepValue } from '@/features/interactions/NextStepSelector'
import { buildAppointmentPrefillTitle, buildFollowupSuggestionTexts } from '@/features/interactions/interactionOutcome'
import { createFollowup, recordFollowupReply } from './followupService'

type ReplyChoice = 'replied' | 'no_response'

export function FollowupReplyModal({ followup, name, userId, onClose, onSaved }: {
  followup: Followup
  name: string
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { height: screenH } = useWindowDimensions()

  const [choice, setChoice] = useState<ReplyChoice | null>(null)
  const [reply, setReply] = useState('')
  const [nextStep, setNextStep] = useState<NextStepValue>(() => defaultNextStepValue())
  const nextStepTouchedRef = useRef(false)
  const createdFollowupIdRef = useRef<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const subject = followup.title ?? followup.content ?? ''

  // Sans réponse, la suite logique est de relancer : proposée, jamais imposée.
  useEffect(() => {
    if (nextStepTouchedRef.current) return
    if (choice === 'no_response') {
      const suggestion = buildFollowupSuggestionTexts(t, locale, subject)
      setNextStep(v => ({
        ...v,
        step: 'followup',
        followupActionType: followup.action_type,
        followupTitle: suggestion.title,
        followupContent: suggestion.content,
      }))
    } else {
      setNextStep(v => ({ ...v, step: 'none' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choice])

  function handleNextStepChange(value: NextStepValue) {
    nextStepTouchedRef.current = true
    setNextStep(value)
  }

  async function handleSubmit() {
    if (!choice || saving) return
    setErrorMsg(null)
    setSaving(true)
    try {
      const interaction = await recordFollowupReply(followup, userId, choice, reply.trim() || null)
      if (nextStep.step === 'followup' && !createdFollowupIdRef.current) {
        const created = await createFollowup(userId, buildFollowupInputFromNextStep(followup.client_id, interaction.id, nextStep))
        createdFollowupIdRef.current = created.id
      }
      onSaved()
      if (nextStep.step === 'appointment') {
        const returnTo = encodeURIComponent(`/(app)/clients/${followup.client_id}/followups`)
        const prefillTitle = encodeURIComponent(buildAppointmentPrefillTitle(subject))
        router.push(`/(app)/appointments/new?clientId=${followup.client_id}&returnTo=${returnTo}&prefillTitle=${prefillTitle}` as any)
      }
    } catch (e) {
      console.error('[recordFollowupReply]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const options: { key: ReplyChoice; label: string }[] = [
    { key: 'replied', label: t('followups.reply_choice_replied') },
    { key: 'no_response', label: t('followups.reply_choice_none') },
  ]

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!saving) onClose() }}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView style={{ maxHeight: screenH * 0.72 }} contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{t('followups.reply_title', { name })}</Text>
            {subject ? <Text style={styles.subject} numberOfLines={2}>{subject}</Text> : null}
            {followup.awaiting_reply_since ? (
              <Text style={styles.sentOn}>{t('followups.sent_on', { date: formatDate(followup.awaiting_reply_since, locale) })}</Text>
            ) : null}

            <View style={styles.choices}>
              {options.map(option => (
                <TouchableOpacity
                  key={option.key}
                  style={styles.choiceRow}
                  onPress={() => setChoice(option.key)}
                  activeOpacity={0.7}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: choice === option.key }}
                >
                  <View style={[styles.radio, choice === option.key && styles.radioActive]} />
                  <Text style={styles.choiceLabel}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {choice === 'replied' ? (
              <TextArea label={t('followups.reply_label')} value={reply} onChangeText={setReply} />
            ) : null}
            {choice ? <NextStepSelector value={nextStep} onChange={handleNextStepChange} /> : null}
          </ScrollView>

          {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving} activeOpacity={0.8}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Button label={t('common.save')} onPress={handleSubmit} loading={saving} disabled={!choice} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    sheet: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 18, padding: 20, gap: 12 },
    title: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
    subject: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: -6 },
    sentOn: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    choices: { gap: 2 },
    choiceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border },
    radioActive: { borderColor: colors.primary, borderWidth: 6 },
    choiceLabel: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    errorMsg: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    btnRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
    cancelBtn: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: colors.border },
    cancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  })
}
