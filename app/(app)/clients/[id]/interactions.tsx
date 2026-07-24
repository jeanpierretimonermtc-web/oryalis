import { useMemo, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClientInteractions } from '@/features/interactions/useInteractions'
import { createInteraction, markInteractionDone, deleteInteraction } from '@/features/interactions/interactionService'
import { Input } from '@/shared/components/ui/Input'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { Card } from '@/shared/components/ui/Card'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { InteractionType, InterestLevel } from '@/shared/lib/types'
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

function toDDMMYYYY(iso: string): string {
  const [y, m, d] = iso.split('T')[0].split('-')
  return `${d ?? '01'}/${m ?? '01'}/${y ?? '2024'}`
}

function buildScheduledAt(ddmmyyyy: string, hhmm: string): string | null {
  if (!ddmmyyyy.match(/^\d{2}\/\d{2}\/\d{4}$/)) return null
  const [d, m, y] = ddmmyyyy.split('/')
  const time = hhmm.match(/^\d{2}:\d{2}$/) ? hhmm : '00:00'
  return `${y}-${m}-${d}T${time}:00.000Z`
}

export default function ClientInteractionsScreen() {
  const { t, i18n } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { interactions, loading, refresh } = useClientInteractions(id)
  const [showModal, setShowModal] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  async function handleMarkDone(interactionId: string) {
    await markInteractionDone(interactionId)
    refresh()
  }

  async function handleDelete(interactionId: string) {
    await deleteInteraction(interactionId)
    setConfirmId(null)
    refresh()
  }

  return (
    <>
      <Stack.Screen options={{ title: t('interactions.title'), headerRight: () => (
        <TouchableOpacity onPress={() => setShowModal(true)} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      )}} />
      <View style={styles.container}>
        {loading
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              data={interactions}
              keyExtractor={item => item.id}
              renderItem={({ item }) => {
                const isDone = !!item.completed_at
                const ic = getInterestColors(item.interest_level, colors)
                const dateStr = item.scheduled_at
                  ? formatDate(item.scheduled_at, locale)
                  : null
                return (
                  <Card style={isDone ? styles.done : undefined}>
                    <View style={styles.row}>
                      <TouchableOpacity
                        onPress={() => !isDone && handleMarkDone(item.id)}
                        style={styles.checkbox}
                        disabled={isDone}
                      >
                        <Text style={styles.checkboxText}>{isDone ? '✅' : '⬜'}</Text>
                      </TouchableOpacity>
                      <View style={styles.info}>
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
                        </View>
                        {item.subject ? (
                          <Text style={[styles.subject, isDone && styles.doneText]}>{item.subject}</Text>
                        ) : null}
                        {dateStr ? <Text style={styles.date}>{dateStr}</Text> : null}
                        {item.notes_brutes ? (
                          <Text style={styles.notes} numberOfLines={2}>{item.notes_brutes}</Text>
                        ) : null}
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

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bg },
  list:       { padding: 12, gap: 8 },
  loader:     { marginTop: 40 },
  addBtn:     { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addBtnText: { color: '#fff', fontSize: 22, lineHeight: 28 },
  done:       { opacity: 0.5 },

  row:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox:  { paddingTop: 2 },
  checkboxText: { fontSize: 20 },
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
  })
}
