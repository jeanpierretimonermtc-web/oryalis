import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Platform, useWindowDimensions } from 'react-native'
import { Stack, router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClientInteractions } from '@/features/interactions/useInteractions'
import { createInteraction, updateInteraction, deleteInteraction } from '@/features/interactions/interactionService'
import { getInteractionOutcomeOptions, outcomeSuggestsFollowup, mapInteractionTypeToActionType, buildFollowupSuggestionTexts, buildAppointmentPrefillTitle } from '@/features/interactions/interactionOutcome'
import { NextStepSelector, defaultNextStepValue, buildFollowupInputFromNextStep } from '@/features/interactions/NextStepSelector'
import { OpenActionLink } from '@/shared/components/ui/OpenActionLink'
import { CompleteToggle } from '@/shared/components/ui/CompleteToggle'
import type { NextStepValue } from '@/features/interactions/NextStepSelector'
import { createFollowup } from '@/features/followups/followupService'
import { Input } from '@/shared/components/ui/Input'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { Card } from '@/shared/components/ui/Card'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { InteractionType, InterestLevel, Interaction, InteractionOutcomeCode } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'

const INTERACTION_TYPES: InteractionType[] = [
  'call', 'whatsapp', 'rdv', 'visio', 'sms', 'email', 'workshop', 'group_meeting', 'product_followup',
]
const INTEREST_LEVELS: InterestLevel[] = ['very_low', 'low', 'medium', 'high', 'very_high']

const TYPE_ICONS: Record<InteractionType, string> = {
  rdv: '📅', call: '📞', visio: '🎥', whatsapp: '💬', sms: '📱',
  email: '✉️', workshop: '🎪', group_meeting: '👥', product_followup: '📦',
}

function getInterestColors(level: InterestLevel | null, colors: ThemeColors) {
  switch (level) {
    case 'very_low': return { bg: colors.surfaceContainerHigh, text: colors.textTertiary }
    case 'low':      return { bg: colors.primaryLight,         text: colors.primary }
    case 'medium':   return { bg: colors.warningLight,         text: colors.warning }
    case 'high':     return { bg: colors.successLight,         text: colors.success }
    case 'very_high':return { bg: colors.tertiaryLight,        text: colors.tertiary }
    default:         return { bg: colors.surfaceContainerHigh, text: colors.textSecondary }
  }
}

// CONTACT-4.2 — même helper que followups.tsx (convention de duplication locale déjà en place
// dans ce projet pour ce type de fonction pure) : colore uniquement la carte ciblée par
// ?focus=<id>, jamais toute la liste.
type FocusUrgency = 'overdue' | 'today' | null
function focusUrgency(dateStr: string): FocusUrgency {
  const target = new Date(dateStr)
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86400000)
  return diff < 0 ? 'overdue' : diff === 0 ? 'today' : null
}

function toDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${d ?? '01'}/${m ?? '01'}/${y ?? '2024'}`
}

// Interprète date+heure comme l'heure LOCALE de l'appareil (celle saisie par l'utilisateur)
// et convertit correctement en UTC — voir app/(app)/appointments/new.tsx pour le même
// correctif appliqué aux RDV (l'ancienne version étiquetait à tort l'heure locale "Z"/UTC).
function buildScheduledAt(ddmmyyyy: string, hhmm: string): string | null {
  if (!ddmmyyyy.match(/^\d{2}\/\d{2}\/\d{4}$/)) return null
  const [d, m, y] = ddmmyyyy.split('/').map(Number)
  const time = hhmm.match(/^\d{2}:\d{2}$/) ? hhmm : '00:00'
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()
}

export default function ClientInteractionsScreen() {
  const { t, i18n } = useTranslation()
  // CONTACT-4.2 — focus = id exact de l'interaction ciblée depuis "Autres actions" (fiche
  // Contact). Optionnel, absent pour toute navigation normale vers cette page.
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  // UI-CREATE-1 — desktop web : bouton explicite "+ Ajouter une interaction" ; mobile : FAB
  // rond inchangé (accessibilityLabel explicite). Même convention que followups.tsx.
  const { width: screenW } = useWindowDimensions()
  const isDesktopWeb = Platform.OS === 'web' && screenW >= 768
  const { interactions, loading, refresh } = useClientInteractions(id)
  useFocusEffect(useCallback(() => { refresh() }, [refresh]))
  const [showModal, setShowModal] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  // ACTION-OUTCOME-1 / P0 — clôture et édition partagent la même Modal (§19), jamais deux
  // implémentations ; l'un ou l'autre est actif, jamais les deux à la fois.
  const [completingItem, setCompletingItem] = useState<Interaction | null>(null)
  const [editingItem, setEditingItem] = useState<Interaction | null>(null)
  const listRef = useRef<FlatList<Interaction>>(null)
  const hasAutoScrolledRef = useRef(false)

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  // CONTACT-4.2 §10/§13/§14 — attend le chargement, cherche par id exact, scrolle une seule
  // fois. focus introuvable : ne fait rien (§12).
  useEffect(() => {
    if (hasAutoScrolledRef.current) return
    if (loading) return
    hasAutoScrolledRef.current = true
    if (!focus) return
    const index = interactions.findIndex(i => i.id === focus)
    if (index === -1) return
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 })
    })
  }, [loading, interactions, focus])

  async function handleDelete(interactionId: string) {
    await deleteInteraction(interactionId)
    setConfirmId(null)
    refresh()
  }

  return (
    <>
      <Stack.Screen options={{ title: t('interactions.title'), headerRight: () => (
        isDesktopWeb ? (
          <TouchableOpacity onPress={() => setShowModal(true)} style={styles.newActionBtn} activeOpacity={0.85}>
            <Text style={styles.newActionBtnText}>+ {t('interactions.add')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn} accessibilityLabel={t('interactions.add')}>
            <Text style={styles.addBtnText}>+</Text>
          </TouchableOpacity>
        )
      )}} />
      <View style={styles.container}>
        {loading
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              ref={listRef}
              data={interactions}
              keyExtractor={item => item.id}
              // CONTACT-4.2 §10 — filet de sécurité standard FlatList (item pas encore mesuré
              // au premier essai), un seul retry.
              onScrollToIndexFailed={(info) => {
                setTimeout(() => {
                  listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })
                }, 100)
              }}
              renderItem={({ item }) => {
                const isDone = !!item.completed_at
                const ic = getInterestColors(item.interest_level, colors)
                const dateStr = item.scheduled_at
                  ? formatDate(item.scheduled_at, locale)
                  : null
                // CONTACT-4.2 §8/§9 — uniquement la carte exactement ciblée par ?focus=<id>.
                const isFocused = item.id === focus
                const urgency = isFocused && !isDone && item.scheduled_at ? focusUrgency(item.scheduled_at) : null
                const focusStyle = !isFocused ? null
                  : urgency === 'overdue' ? styles.cardFocusedOverdue
                  : urgency === 'today' ? styles.cardFocusedToday
                  : styles.cardFocused
                return (
                  <Card style={[isDone && styles.done, focusStyle]}>
                    <View style={styles.row}>
                      {/* UI-AFFORDANCE-1.2 §5/§26 — action métier explicite. Active : ouvre le
                          parcours P0 existant (résultat/compte-rendu/suite), inchangé. Terminée :
                          non cliquable (pas de réouverture pour une interaction — "Modifier ›"
                          gère déjà l'édition du compte-rendu, jamais confondu avec "Terminée"). */}
                      <CompleteToggle
                        done={isDone}
                        onPress={() => setCompletingItem(item)}
                        disabled={isDone}
                        activeLabel={t('clients.finish_action')}
                        doneLabel={t('interactions.done')}
                        accessibilityLabel={
                          isDone
                            ? `${t('interactions.done')} — ${item.subject || t(`interaction_types.${item.interaction_type}`)}`
                            : `${t('clients.finish_action')} — ${item.subject || t(`interaction_types.${item.interaction_type}`)}`
                        }
                      />
                      {/* ACTION-OUTCOME-1 / P0 §17-18 — "clic sur la carte" pour modifier le
                          compte-rendu d'une interaction déjà terminée : réutilise le bloc
                          d'info existant plutôt qu'un nouveau menu, désactivé (donc inerte)
                          tant que l'interaction est active. */}
                      <TouchableOpacity
                        style={styles.info}
                        onPress={() => isDone && setEditingItem(item)}
                        disabled={!isDone}
                        activeOpacity={isDone ? 0.7 : 1}
                      >
                        <View style={styles.headerRow}>
                          <View style={styles.typeBadge}>
                            <Text style={styles.typeIcon}>{TYPE_ICONS[item.interaction_type]}</Text>
                            <Text style={styles.typeText}>{t(`interaction_types.${item.interaction_type}`)}</Text>
                          </View>
                          {item.interest_level ? (
                            <View style={[styles.levelBadge, { backgroundColor: ic.bg }]}>
                              <Text style={[styles.levelText, { color: ic.text }]}>
                                {t(`interest_levels.${item.interest_level}`)}
                              </Text>
                            </View>
                          ) : null}
                          {isFocused && urgency ? (
                            <View style={styles.focusUrgencyBadge}>
                              <Text style={[styles.focusUrgencyBadgeText, { color: urgency === 'overdue' ? colors.danger : colors.warning }]}>
                                {t(urgency === 'overdue' ? 'followups.overdue_badge' : 'followups.today_badge')}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        {item.subject ? (
                          <Text style={[styles.subject, isDone && styles.doneText]}>{item.subject}</Text>
                        ) : null}
                        {dateStr ? <Text style={styles.date}>{dateStr}</Text> : null}
                        {/* §20/§23/§24 — le résultat ne s'affiche que s'il existe réellement,
                            jamais un "Résultat : —" pour une ancienne interaction sans détail. */}
                        {isDone && item.completion_result ? (
                          <Text style={styles.resultText}>{t(`interaction_outcomes.${item.completion_result}`)}</Text>
                        ) : null}
                        {item.notes_brutes ? (
                          <Text style={styles.notes} numberOfLines={2}>{item.notes_brutes}</Text>
                        ) : null}
                      </TouchableOpacity>
                      {/* UI-AFFORDANCE-1 §12 — le clic ouvre directement le formulaire d'édition
                          du compte-rendu (InteractionOutcomeModal, mode='edit') : "Modifier",
                          jamais "Ouvrir". Absent pour une interaction non terminée : il n'y a
                          alors rien à ouvrir sur cette ligne (la case à cocher gère "Terminer"). */}
                      {isDone ? (
                        <OpenActionLink
                          label={t('common.edit')}
                          onPress={() => setEditingItem(item)}
                          accessibilityLabel={`${t('common.edit')} ${item.subject || t(`interaction_types.${item.interaction_type}`)}`}
                        />
                      ) : null}
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
                        <TouchableOpacity
                          onPress={() => setConfirmId(item.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.deleteIcon}>🗑</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </Card>
                )
              }}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<EmptyState message={t('interactions.empty')} icon="💬" />}
            />
        }
      </View>
      {showModal && (
        <InteractionModal
          clientId={id}
          userId={session?.user.id ?? ''}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); refresh() }}
        />
      )}
      {/* ACTION-OUTCOME-1 / P0 — même Modal pour clôturer et pour modifier après coup (§19),
          jamais deux implémentations ; mode déterminé par lequel des deux states est actif. */}
      {completingItem && (
        <InteractionOutcomeModal
          interaction={completingItem}
          mode="complete"
          onClose={() => setCompletingItem(null)}
          onSaved={() => { setCompletingItem(null); refresh() }}
        />
      )}
      {editingItem && (
        <InteractionOutcomeModal
          interaction={editingItem}
          mode="edit"
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); refresh() }}
        />
      )}
    </>
  )
}

function InteractionModal({ clientId, userId, onClose, onSaved }: {
  clientId: string; userId: string; onClose: () => void; onSaved: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [type, setType] = useState<InteractionType>('call')
  const [date, setDate] = useState(toDDMMYYYY(new Date().toISOString()))
  const [time, setTime] = useState('')
  const [subject, setSubject] = useState('')
  const [interestLevel, setInterestLevel] = useState<InterestLevel | null>(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handleSave() {
    setErrorMsg(null)
    const scheduledAt = buildScheduledAt(date, time)
    if (!scheduledAt) {
      setErrorMsg(t('appointments.error_date_required'))
      return
    }
    setLoading(true)
    try {
      await createInteraction(userId, {
        client_id: clientId,
        interaction_type: type,
        scheduled_at: scheduledAt,
        subject: subject.trim() || null,
        interest_level: interestLevel,
        notes_brutes: notes.trim() || null,
      })
      onSaved()
    } catch (e) {
      console.error('[createInteraction]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.modalCancel}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <Text style={styles.modalTitle}>{t('interactions.add')}</Text>
        <Button label={t('common.save')} size="sm" onPress={handleSave} loading={loading} />
      </View>
      <ScrollView style={styles.modalBody} contentContainerStyle={{ gap: 16 }}>

        {/* Type */}
        <View style={{ gap: 8 }}>
          <Text style={styles.fieldLabel}>{t('interactions.title')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.typeRow}>
              {INTERACTION_TYPES.map(it => (
                <TouchableOpacity
                  key={it}
                  style={[styles.typeChip, type === it && styles.typeChipActive]}
                  onPress={() => setType(it)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.typeChipIcon}>{TYPE_ICONS[it]}</Text>
                  <Text style={[styles.typeChipLabel, type === it && styles.typeChipLabelActive]}>
                    {t(`interaction_types.${it}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Date + Time */}
        <View style={styles.dateRow}>
          <View style={{ flex: 2 }}>
            <Input label={t('appointments.date')} value={date} onChangeText={setDate} placeholder="DD/MM/YYYY" />
          </View>
          <View style={{ flex: 1 }}>
            <Input label={`${t('appointments.time')} (${t('common.optional')})`} value={time} onChangeText={setTime} placeholder="HH:MM" />
          </View>
        </View>

        {/* Subject */}
        <Input
          label={`${t('interactions.subject')} (${t('common.optional')})`}
          value={subject}
          onChangeText={setSubject}
        />

        {/* Interest level */}
        <View style={{ gap: 8 }}>
          <Text style={styles.fieldLabel}>{t('interactions.interest_level')}</Text>
          <View style={styles.levelRow}>
            {INTEREST_LEVELS.map(lv => {
              const ic = getInterestColors(lv, colors)
              const active = interestLevel === lv
              return (
                <TouchableOpacity
                  key={lv}
                  style={[styles.levelChip, active && { backgroundColor: ic.bg, borderColor: ic.text }]}
                  onPress={() => setInterestLevel(interestLevel === lv ? null : lv)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.levelChipText, active && { color: ic.text, fontFamily: fonts.semibold }]}>
                    {t(`interest_levels.${lv}`)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        {/* Notes */}
        <TextArea
          label={`${t('interactions.notes')} (${t('common.optional')})`}
          value={notes}
          onChangeText={setNotes}
        />

        {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}
      </ScrollView>
    </Modal>
  )
}

// ACTION-OUTCOME-1 / P0 — vraie modal métier (saisie), jamais AnchoredMenu (§8/§18) : sert à
// la fois pour "Terminer" (mode='complete', §9) et pour "Modifier le compte-rendu" après coup
// (mode='edit', §17-19), même formulaire, même service (updateInteraction, §31). Résultat et
// compte-rendu restent tous deux optionnels (§10) : aucun blocage pour un utilisateur pressé.
function InteractionOutcomeModal({ interaction, mode, onClose, onSaved }: {
  interaction: Interaction
  mode: 'complete' | 'edit'
  onClose: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { height: screenH } = useWindowDimensions()
  const [result, setResult] = useState<InteractionOutcomeCode | null>(interaction.completion_result)
  // §12 — préremplit avec la valeur déjà saisie à la création, jamais écrasée silencieusement :
  // l'utilisateur part de ce qui existe déjà et peut le garder, le compléter ou le corriger.
  const [report, setReport] = useState(interaction.notes_brutes ?? '')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const options = getInteractionOutcomeOptions(interaction.interaction_type)

  // ACTION-OUTCOME-1 / P1.2 §17/§18 — "Suite" n'existe qu'à la clôture initiale (mode
  // 'complete'), jamais en édition d'une interaction déjà terminée : modifier résultat/
  // compte-rendu après coup ne recrée jamais de relance/RDV.
  const [nextStep, setNextStep] = useState<NextStepValue>(() => defaultNextStepValue())
  const [nextStepTouched, setNextStepTouched] = useState(false)
  // §12/§34 — garde d'idempotence pour le retry après un échec partiel : si la relance a déjà
  // été créée lors d'une tentative précédente de ce même envoi, un nouveau clic ne doit pas en
  // recréer une seconde (aucune contrainte d'unicité en base ne le ferait à notre place ici).
  const createdFollowupIdRef = useRef<string | null>(null)

  // ACTION-FLOW-1 / P1 §5/§6 — préremplissage déclenché soit par la suggestion douce existante
  // (résultat = à rappeler/à relancer), soit par le choix manuel de "Créer une relance", quel
  // que soit le résultat (§6 du brief : answered/replied/sent/... ne doivent plus laisser un
  // formulaire vide). `nextStepTouched` protège toute saisie déjà faite par l'utilisateur — voir
  // handleNextStepChange ci-dessous, qui ne l'active que sur une vraie modification de champ,
  // jamais sur le simple choix du radio "Suite".
  useEffect(() => {
    if (mode !== 'complete' || nextStepTouched) return
    const shouldPrefillFollowup = nextStep.step === 'followup' || outcomeSuggestsFollowup(result)
    if (!shouldPrefillFollowup) return
    const subject = interaction.subject || t(`interaction_types.${interaction.interaction_type}`)
    const suggestion = buildFollowupSuggestionTexts(t, locale, subject)
    setNextStep(v => ({
      ...v,
      step: 'followup',
      followupActionType: v.followupActionType ?? mapInteractionTypeToActionType(interaction.interaction_type),
      followupTitle: v.followupTitle || suggestion.title,
      followupContent: v.followupContent || suggestion.content,
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, nextStep.step, mode])

  // §7 — ne marque "touché" que si un vrai champ change (type/titre/description/échéance) ;
  // le simple choix du radio "Suite" ne doit jamais empêcher le préremplissage ci-dessus de
  // s'appliquer une première fois.
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
    if (saving) return
    setErrorMsg(null)
    setSaving(true)
    try {
      // §9 — ordre des effets : résultat + compte-rendu + clôture d'abord (appel unique et
      // idempotent, sans risque à répéter sur un retry), la suite seulement après.
      await updateInteraction(interaction.id, {
        // §14 — completed_at n'est jamais retouché en mode édition, uniquement à la clôture.
        ...(mode === 'complete' ? { completed_at: new Date().toISOString() } : {}),
        completion_result: result,
        notes_brutes: report.trim() || null,
      })

      if (mode === 'complete' && nextStep.step === 'followup' && !createdFollowupIdRef.current) {
        const created = await createFollowup(
          interaction.user_id,
          buildFollowupInputFromNextStep(interaction.client_id, interaction.id, nextStep)
        )
        createdFollowupIdRef.current = created.id
      }

      if (mode === 'complete' && nextStep.step === 'appointment') {
        onSaved()
        // ACTION-FLOW-2 / P0 §12/§13 — titre de RDV = sujet source lui-même (jamais une phrase
        // construite autour de lui), débarrassé d'un éventuel préfixe "Suivi ·" déjà présent.
        // Titre uniquement, jamais internalNotes/clientNotes (§18/§27) ; encodée comme returnTo
        // l'est déjà pour supporter espaces/accents/apostrophes/`?`/`&` sans casser l'URL.
        const subject = interaction.subject || t(`interaction_types.${interaction.interaction_type}`)
        const prefillTitle = buildAppointmentPrefillTitle(subject)
        router.push(`/(app)/appointments/new?clientId=${interaction.client_id}&returnTo=${encodeURIComponent(`/(app)/clients/${interaction.client_id}/interactions`)}&prefillTitle=${encodeURIComponent(prefillTitle)}` as any)
        return
      }

      onSaved()
    } catch (e) {
      console.error('[updateInteraction.outcome]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!saving) onClose() }}>
      <View style={styles.outcomeOverlay}>
        <View style={styles.outcomeSheet}>
          <ScrollView style={{ maxHeight: screenH * 0.72 }} contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false}>
            <Text style={styles.outcomeTitle}>
              {mode === 'complete' ? t('interactions.complete_title') : t('interactions.edit_outcome_title')}
            </Text>
            <View style={styles.outcomeSubjectRow}>
              <Text style={styles.typeIcon}>{TYPE_ICONS[interaction.interaction_type]}</Text>
              <Text style={styles.outcomeSubjectText} numberOfLines={1}>
                {interaction.subject || t(`interaction_types.${interaction.interaction_type}`)}
              </Text>
            </View>

            <View style={{ gap: 8 }}>
              <Text style={styles.fieldLabel}>{t('interactions.result_label')} ({t('common.optional')})</Text>
              <View style={styles.levelRow}>
                {options.map(code => {
                  const active = result === code
                  return (
                    <TouchableOpacity
                      key={code}
                      style={[styles.levelChip, active && styles.typeChipActive]}
                      onPress={() => setResult(active ? null : code)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.levelChipText, active && styles.typeChipLabelActive]}>
                        {t(`interaction_outcomes.${code}`)}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>
            </View>

            <TextArea
              label={`${t('interactions.completion_report_label')} (${t('common.optional')})`}
              value={report}
              onChangeText={setReport}
            />

            {/* ACTION-OUTCOME-1 / P1.2 §17/§18 — jamais affiché en mode édition, uniquement à
                la clôture initiale. */}
            {mode === 'complete' ? (
              <NextStepSelector value={nextStep} onChange={handleNextStepChange} />
            ) : null}
          </ScrollView>

          {errorMsg ? <Text style={styles.errorMsg}>{errorMsg}</Text> : null}

          <View style={styles.outcomeBtnRow}>
            <TouchableOpacity style={styles.outcomeCancelBtn} onPress={onClose} disabled={saving}>
              <Text style={styles.outcomeCancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Button
                label={mode === 'complete' ? t('clients.finish_action') : t('common.save')}
                onPress={handleSubmit}
                loading={saving}
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
  container:  { flex: 1, backgroundColor: colors.bgDim },
  list:       { padding: 12, gap: 8 },
  loader:     { marginTop: 40 },
  addBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addBtnText: { color: '#fff', fontSize: 22, lineHeight: 28 },
  // UI-CREATE-1 — création principale desktop : icône + texte explicite, jamais un rond "+"
  // isolé (règle §3/§8). Couleur primaire existante, aucune nouvelle teinte.
  newActionBtn:     { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, marginRight: 12 },
  newActionBtnText: { color: '#fff', fontSize: 14, fontFamily: fonts.semibold },
  done:       { opacity: 0.5 },
  // CONTACT-4.2 — carte exactement ciblée par ?focus=<id> uniquement (jamais toute la liste).
  cardFocused:        { borderWidth: 2, borderColor: colors.primary },
  cardFocusedOverdue: { borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.dangerLight },
  cardFocusedToday:   { borderWidth: 2, borderColor: colors.warning, backgroundColor: colors.warningLight },
  focusUrgencyBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999, backgroundColor: colors.card },
  focusUrgencyBadgeText: { fontSize: 10.5, fontFamily: fonts.bold, letterSpacing: 0.4 },

  row:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  info:      { flex: 1, gap: 5 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  typeIcon:   { fontSize: 12 },
  typeText:   { fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary },
  levelBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  levelText:  { fontSize: 11, fontFamily: fonts.semibold },
  subject:    { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  date:       { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  // ACTION-OUTCOME-1 / P0 §20 — résultat affiché de façon compacte, neutre (jamais une couleur
  // d'urgence : ce n'est pas un signal CRM, juste un fait déjà survenu).
  resultText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },
  notes:      { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  doneText:   { textDecorationLine: 'line-through', color: colors.textTertiary },
  deleteIcon: { fontSize: 16, paddingTop: 2 },

  inlineConfirm:      { flexDirection: 'column', gap: 4, alignItems: 'flex-end' },
  confirmCancelBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  confirmCancelText:  { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  confirmDeleteBtn:   { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.danger },
  confirmDeleteText:  { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitle:  { fontSize: 17, fontFamily: fonts.semibold, color: colors.text },
  modalCancel: { fontSize: 16, fontFamily: fonts.body, color: colors.primary },
  modalBody:   { padding: 16 },

  fieldLabel: { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
  typeRow:    { flexDirection: 'row', gap: 8, paddingHorizontal: 2 },
  typeChip:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  typeChipActive:      { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  typeChipIcon:        { fontSize: 14 },
  typeChipLabel:       { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  typeChipLabelActive: { color: colors.primary, fontFamily: fonts.semibold },

  dateRow:       { flexDirection: 'row', gap: 12 },
  levelRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  levelChip:     { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  levelChipText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },

  errorMsg: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },

  // ── ACTION-OUTCOME-1 / P0 — clôture/édition (§9/§28) : compacte, centrée, jamais un
  // débrief RDV miniature — un titre, un sujet de rappel, deux champs optionnels, deux boutons.
  outcomeOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  outcomeSheet:   { width: '100%', maxWidth: 380, borderRadius: 16, padding: 20, gap: 14, backgroundColor: colors.card, boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 24, color: 'rgba(0, 0, 0, 0.2)' }], elevation: 16 },
  outcomeTitle:   { fontSize: 17, fontFamily: fonts.semibold, color: colors.text },
  outcomeSubjectRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -8 },
  outcomeSubjectText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, flex: 1 },
  outcomeBtnRow:      { flexDirection: 'row', gap: 10, marginTop: 4 },
  outcomeCancelBtn:      { flex: 1, borderRadius: 10, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  outcomeCancelBtnText:  { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },
  })
}
