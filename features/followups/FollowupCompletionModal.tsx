import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { Followup, Interaction, InteractionType, InteractionOutcomeCode } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'
import { toggleFollowupDone, completeFollowupWithInteraction, createFollowup } from '@/features/followups/followupService'
import { getInteractionBySourceFollowup } from '@/features/interactions/interactionService'
import { getInteractionOutcomeOptions, outcomeSuggestsFollowup, mapInteractionTypeToActionType, buildFollowupSuggestionTexts, buildAppointmentPrefillTitle } from '@/features/interactions/interactionOutcome'
import { NextStepSelector, defaultNextStepValue, buildFollowupInputFromNextStep } from '@/features/interactions/NextStepSelector'
import type { NextStepValue } from '@/features/interactions/NextStepSelector'

// ACTION-OUTCOME-1 / P1 §24 — composant partagé unique entre la page Relances-contact
// (clients/[id]/followups.tsx) et la page Relances-globale (followups/index.tsx) : une seule
// logique de clôture professionnelle, jamais deux implémentations parallèles.
const INTERACTION_TYPES: InteractionType[] = [
  'call', 'whatsapp', 'rdv', 'visio', 'sms', 'email', 'workshop', 'group_meeting', 'product_followup',
]
const TYPE_ICONS: Record<InteractionType, string> = {
  rdv: '📅', call: '📞', visio: '🎥', whatsapp: '💬', sms: '📱',
  email: '✉️', workshop: '🎪', group_meeting: '👥', product_followup: '📦',
}

type Choice = 'simple' | 'record'

export function FollowupCompletionModal({ followup, userId, onClose, onSaved }: {
  followup: Followup
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { height: screenH } = useWindowDimensions()

  const [checkingExisting, setCheckingExisting] = useState(true)
  const [existingInteraction, setExistingInteraction] = useState<Interaction | null>(null)
  const [choice, setChoice] = useState<Choice | null>(null)
  // ACTION-OUTCOME-1 / P1.2 §19/§20 — même sélecteur "Suite" que la clôture d'interaction P0,
  // appliqué ici à l'interaction historique créée par "Enregistrer l'échange".
  const [nextStep, setNextStep] = useState<NextStepValue>(() => defaultNextStepValue())
  const [nextStepTouched, setNextStepTouched] = useState(false)
  const createdFollowupIdRef = useRef<string | null>(null)
  // ACTION-OUTCOME-1 / P1 §9/§11 — followup.action_type est un sous-ensemble exact de
  // InteractionType (call/whatsapp/sms/email/rdv existent tel quel côté interaction) :
  // correspondance directe et fiable, jamais un mapping arbitraire. null quand la relance n'a
  // pas de type d'action (aucune correspondance possible) : le picker reste alors vide, le
  // choix devient obligatoire uniquement pour "Enregistrer l'échange" (§10).
  const [interactionType, setInteractionType] = useState<InteractionType | null>(followup.action_type)
  const [result, setResult] = useState<InteractionOutcomeCode | null>(null)
  const [report, setReport] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // §28 — une relance rouverte puis re-terminée peut déjà posséder son échange historique :
  // on le détecte à l'ouverture pour ne jamais en proposer/en créer un second (protégé de
  // toute façon par l'index unique partiel, mais on évite ici de montrer un choix trompeur).
  useEffect(() => {
    let cancelled = false
    setCheckingExisting(true)
    getInteractionBySourceFollowup(followup.id)
      .then(existing => { if (!cancelled) { setExistingInteraction(existing); setCheckingExisting(false) } })
      .catch(() => { if (!cancelled) setCheckingExisting(false) })
    return () => { cancelled = true }
  }, [followup.id])

  // ACTION-FLOW-1 / P1 §5/§6/§23 — même règle que le Cas A (InteractionOutcomeModal) : la
  // suggestion douce existante (résultat = à rappeler/à relancer) OU le choix manuel de "Créer
  // une relance" (quel que soit le résultat) déclenchent le même préremplissage déterministe.
  // Le sujet de la relance d'origine (followup.title/content) reste la source de vérité — §23
  // du brief : ne jamais le perdre, même en Cas B.
  useEffect(() => {
    if (choice !== 'record' || nextStepTouched) return
    const shouldPrefillFollowup = nextStep.step === 'followup' || outcomeSuggestsFollowup(result)
    if (!shouldPrefillFollowup) return
    const subject = followup.title ?? followup.content ?? (interactionType ? t(`interaction_types.${interactionType}`) : '')
    const suggestion = buildFollowupSuggestionTexts(t, locale, subject)
    setNextStep(v => ({
      ...v,
      step: 'followup',
      followupActionType: v.followupActionType ?? (interactionType ? mapInteractionTypeToActionType(interactionType) : null),
      followupTitle: v.followupTitle || suggestion.title,
      followupContent: v.followupContent || suggestion.content,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, nextStep.step, choice])

  // §7 — ne marque "touché" que sur une vraie modification de champ (type/titre/description/
  // échéance), jamais sur le simple choix du radio "Suite" (sinon le préremplissage ci-dessus ne
  // pourrait plus jamais s'appliquer).
  function handleNextStepChange(v: NextStepValue) {
    const onlyStepChanged =
      v.followupDueDate === nextStep.followupDueDate &&
      v.followupActionType === nextStep.followupActionType &&
      v.followupTitle === nextStep.followupTitle &&
      v.followupContent === nextStep.followupContent
    if (!onlyStepChanged) setNextStepTouched(true)
    setNextStep(v)
  }

  async function handleSubmit() {
    if (!choice || saving) return
    if (choice === 'record' && !interactionType) {
      setErrorMsg(t('followups.error_pick_type'))
      return
    }
    setErrorMsg(null)
    setSaving(true)
    try {
      if (choice === 'simple') {
        // §6 — clôture administrative : aucune interaction créée, c'est volontaire.
        await toggleFollowupDone(followup.id, true)
      } else if (interactionType) {
        const now = new Date().toISOString()
        const createdInteraction = await completeFollowupWithInteraction(followup, userId, {
          interaction_type: interactionType,
          // §14 — la date de l'échange réel, jamais followup.due_date même en retard.
          scheduled_at: now,
          completed_at: now,
          // §12 — reprend le titre de la relance, jamais un titre artificiel.
          subject: followup.title ?? followup.content ?? null,
          completion_result: result,
          // §16 — jamais un nouveau champ sur followups, jamais followup.content recopié ici.
          notes_brutes: report.trim() || null,
        })

        // ACTION-OUTCOME-1 / P1.2 §9/§19 — la Suite ne s'applique qu'après la clôture réussie
        // de l'échange, jamais avant ; garde de retry via createdFollowupIdRef (pas de contrainte
        // d'unicité en base ici, cf. §12).
        if (nextStep.step === 'followup' && !createdFollowupIdRef.current) {
          const createdFollowup = await createFollowup(
            userId,
            buildFollowupInputFromNextStep(followup.client_id, createdInteraction.id, nextStep)
          )
          createdFollowupIdRef.current = createdFollowup.id
        }

        if (nextStep.step === 'appointment') {
          onSaved()
          // ACTION-FLOW-2 / P0 §12/§13 — titre de RDV = sujet source lui-même (jamais une
          // phrase construite autour de lui), débarrassé d'un éventuel préfixe "Suivi ·" déjà
          // présent. Titre uniquement, jamais internalNotes/clientNotes (§18/§27), correctement
          // encodée.
          const subject = followup.title ?? followup.content ?? (interactionType ? t(`interaction_types.${interactionType}`) : '')
          const prefillTitle = buildAppointmentPrefillTitle(subject)
          router.push(`/(app)/appointments/new?clientId=${followup.client_id}&returnTo=${encodeURIComponent(`/(app)/clients/${followup.client_id}/followups`)}&prefillTitle=${encodeURIComponent(prefillTitle)}` as any)
          return
        }
      }
      onSaved()
    } catch (e) {
      console.error('[completeFollowupWithInteraction]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!saving) onClose() }}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView style={{ maxHeight: screenH * 0.72 }} contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>{t('followups.complete_title')}</Text>
          {(followup.title ?? followup.content) ? (
            <Text style={styles.subjectText} numberOfLines={2}>{followup.title ?? followup.content}</Text>
          ) : null}

          {checkingExisting ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : (
            <>
              {existingInteraction ? (
                <Text style={styles.existingNotice}>
                  {t('followups.existing_exchange_notice', {
                    date: formatDate(existingInteraction.completed_at ?? existingInteraction.created_at, locale),
                  })}
                </Text>
              ) : null}

              <Text style={styles.question}>{t('followups.complete_question')}</Text>

              <View style={styles.choiceGroup}>
                <TouchableOpacity style={styles.choiceRow} onPress={() => setChoice('simple')} activeOpacity={0.7}>
                  <View style={[styles.radio, choice === 'simple' && styles.radioActive]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceLabel}>{t('followups.close_simple')}</Text>
                    <Text style={styles.choiceHint}>{t('followups.close_simple_hint')}</Text>
                  </View>
                </TouchableOpacity>

                {!existingInteraction ? (
                  <TouchableOpacity style={styles.choiceRow} onPress={() => setChoice('record')} activeOpacity={0.7}>
                    <View style={[styles.radio, choice === 'record' && styles.radioActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.choiceLabel}>{t('followups.record_exchange')}</Text>
                      <Text style={styles.choiceHint}>{t('followups.record_exchange_hint')}</Text>
                    </View>
                  </TouchableOpacity>
                ) : null}
              </View>

              {choice === 'record' ? (
                <View style={{ gap: 12 }}>
                  {followup.content ? (
                    <View style={styles.contextBox}>
                      <Text style={styles.contextLabel}>{t('followups.context_label')}</Text>
                      <Text style={styles.contextText}>{followup.content}</Text>
                    </View>
                  ) : null}

                  <View style={{ gap: 8 }}>
                    <Text style={styles.fieldLabel}>{t('followups.exchange_type_label')}</Text>
                    <View style={styles.chipRow}>
                      {INTERACTION_TYPES.map(typeOpt => {
                        const active = interactionType === typeOpt
                        return (
                          <TouchableOpacity
                            key={typeOpt}
                            style={[styles.chip, active && styles.chipActive]}
                            onPress={() => { setInteractionType(typeOpt); setResult(null) }}
                            activeOpacity={0.7}
                          >
                            <Text style={styles.chipIcon}>{TYPE_ICONS[typeOpt]}</Text>
                            <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                              {t(`interaction_types.${typeOpt}`)}
                            </Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </View>

                  {interactionType ? (
                    <View style={{ gap: 8 }}>
                      <Text style={styles.fieldLabel}>{t('interactions.result_label')} ({t('common.optional')})</Text>
                      <View style={styles.chipRow}>
                        {getInteractionOutcomeOptions(interactionType).map(code => {
                          const active = result === code
                          return (
                            <TouchableOpacity
                              key={code}
                              style={[styles.chip, active && styles.chipActive]}
                              onPress={() => setResult(active ? null : code)}
                              activeOpacity={0.7}
                            >
                              <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                                {t(`interaction_outcomes.${code}`)}
                              </Text>
                            </TouchableOpacity>
                          )
                        })}
                      </View>
                    </View>
                  ) : null}

                  <TextArea
                    label={`${t('interactions.completion_report_label')} (${t('common.optional')})`}
                    value={report}
                    onChangeText={setReport}
                  />

                  {/* ACTION-OUTCOME-1 / P1.2 §19 — même sélecteur "Suite" que la clôture
                      d'interaction P0, appliqué à l'échange créé ici. */}
                  <NextStepSelector value={nextStep} onChange={handleNextStepChange} />
                </View>
              ) : null}
            </>
          )}
          </ScrollView>

          {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving} activeOpacity={0.8}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Button
                label={choice === 'record' ? t('followups.finish_and_record') : t('clients.finish_action')}
                onPress={handleSubmit}
                loading={saving}
                disabled={!choice || checkingExisting}
              />
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
    sheet:   { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 18, padding: 20, gap: 12 },
    title:   { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
    subjectText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: -6 },
    question: { fontSize: 13, fontFamily: fonts.semibold, color: colors.textSecondary },

    existingNotice: {
      fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary,
      backgroundColor: colors.bgDim, borderRadius: 10, padding: 10, lineHeight: 17,
    },

    choiceGroup: { gap: 4 },
    choiceRow:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
    radio:       { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, marginTop: 1 },
    radioActive: { borderColor: colors.primary, borderWidth: 6 },
    choiceLabel: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    choiceHint:  { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 1 },

    contextBox:   { backgroundColor: colors.bgDim, borderRadius: 10, padding: 10, gap: 3 },
    contextLabel: { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    contextText:  { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },

    fieldLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    chipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
    chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    chipIcon:   { fontSize: 13 },
    chipLabel:  { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    chipLabelActive: { color: colors.primaryAction, fontFamily: fonts.semibold },

    errorMsg: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },

    btnRow:   { flexDirection: 'row', gap: 10, marginTop: 4 },
    cancelBtn:     { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: colors.border },
    cancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  })
}
