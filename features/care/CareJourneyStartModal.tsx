import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import { CalendarPickerModal } from '@/shared/components/ui/CalendarPickerModal'
import type { Client } from '@/shared/lib/types'
import {
  CARE_TEMPLATES, CARE_CHANNELS, CARE_CHANNEL_ICON, getCareTemplate,
  todayLocalStr, addDaysStr, daysBetweenStr, nextBirthdayStr, renderCareMessage, unrenderCareMessage,
} from './careTemplates'
import type { CareChannel, CareExtraKey } from './careTemplates'
import { startCareJourney, fetchCareFavorites, createCareFavorite, deleteCareFavorite } from './careJourneyService'
import type { CareFavorite } from './careJourneyService'

interface DraftStep {
  uid: string
  extraKey: CareExtraKey | null
  label: string
  enabled: boolean
  // Jours après la date de départ ; null pour les étapes facultatives à date propre (anniversaire).
  offset: number | null
  date: string
  channel: CareChannel
  message: string
}

type Source = { kind: 'builtin'; key: string } | { kind: 'favorite'; favorite: CareFavorite }

interface Props {
  visible: boolean
  onClose: () => void
  client: Pick<Client, 'id' | 'first_name' | 'full_name' | 'birth_date'>
  userId: string
  advisorName: string
  onStarted: () => void
}

const MAX_OFFSET = 3650
// Un libellé qui commence par "J+30" / "D+30" suit le jour choisi.
const OFFSET_PREFIX = /^([JD])\+\d+/

export function CareJourneyStartModal({ visible, onClose, client, userId, advisorName, onStarted }: Props) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const today = todayLocalStr()
  const uidRef = useRef(0)
  const nextUid = () => `s${++uidRef.current}`

  const [source, setSource] = useState<Source>({ kind: 'builtin', key: CARE_TEMPLATES[0].key })
  const [startDate, setStartDate] = useState(today)
  const [steps, setSteps] = useState<DraftStep[]>([])
  const [favorites, setFavorites] = useState<CareFavorite[]>([])
  const [calendarFor, setCalendarFor] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [favoriteOpen, setFavoriteOpen] = useState(false)
  const [favoriteName, setFavoriteName] = useState('')
  const [favoriteSaving, setFavoriteSaving] = useState(false)
  const [favoriteMsg, setFavoriteMsg] = useState('')
  const [pendingDelete, setPendingDelete] = useState<CareFavorite | null>(null)

  const vars = useMemo(() => ({
    prénom: client.first_name || client.full_name.split(' ')[0] || '',
    mon_prénom: advisorName.split(' ')[0] || advisorName,
  }), [client.first_name, client.full_name, advisorName])

  const offsetLabel = useCallback((offset: number) => t('care.custom_step_label', { days: offset }), [t])

  const buildSteps = useCallback((src: Source, start: string): DraftStep[] => {
    let base: DraftStep[]
    if (src.kind === 'builtin') {
      const template = getCareTemplate(src.key)
      base = template.steps.map(step => ({
        uid: nextUid(),
        extraKey: null,
        label: t(`care.templates.${template.key}.steps.${step.key}.label`),
        enabled: true,
        offset: step.offsetDays,
        date: addDaysStr(start, step.offsetDays),
        channel: step.channel,
        message: renderCareMessage(t(`care.templates.${template.key}.steps.${step.key}.message`), vars),
      }))
    } else {
      base = src.favorite.steps.map(step => ({
        uid: nextUid(),
        extraKey: null,
        label: step.label,
        enabled: true,
        offset: step.offsetDays,
        date: addDaysStr(start, step.offsetDays),
        channel: step.channel,
        message: renderCareMessage(step.message, vars),
      }))
    }
    const extra = (key: CareExtraKey, date: string): DraftStep => ({
      uid: nextUid(),
      extraKey: key,
      label: t(`care.extras.${key}.label`),
      enabled: false,
      offset: null,
      date,
      channel: 'whatsapp',
      message: renderCareMessage(t(`care.extras.${key}.message`), vars),
    })
    const extras: DraftStep[] = []
    if (client.birth_date) extras.push(extra('birthday', nextBirthdayStr(client.birth_date, start)))
    extras.push(extra('anniversary', addDaysStr(start, 365)))
    return [...base, ...extras]
  }, [client.birth_date, vars, t])

  // Ouverture : modèle par défaut + chargement des favoris.
  useEffect(() => {
    if (!visible) return
    const initial: Source = { kind: 'builtin', key: CARE_TEMPLATES[0].key }
    const start = todayLocalStr()
    setSource(initial)
    setStartDate(start)
    setSteps(buildSteps(initial, start))
    setErrorMsg('')
    setSaving(false)
    setFavoriteOpen(false)
    setFavoriteName('')
    setFavoriteMsg('')
    setPendingDelete(null)
    fetchCareFavorites().then(setFavorites).catch(e => console.error('[care.favorites]', e))
  }, [visible])

  function chooseSource(src: Source) {
    setSource(src)
    setSteps(buildSteps(src, startDate))
    setErrorMsg('')
  }

  // Changer la date de départ décale toutes les étapes, sans perdre les messages modifiés.
  function changeStartDate(start: string) {
    setStartDate(start)
    setSteps(prev => prev.map(s => {
      if (s.offset != null) return { ...s, date: addDaysStr(start, s.offset) }
      if (s.extraKey === 'birthday' && client.birth_date) return { ...s, date: nextBirthdayStr(client.birth_date, start) }
      if (s.extraKey === 'anniversary') return { ...s, date: addDaysStr(start, 365) }
      return s
    }))
  }

  const updateStep = (uid: string, patch: Partial<DraftStep>) =>
    setSteps(prev => prev.map(s => (s.uid === uid ? { ...s, ...patch } : s)))

  function setStepOffset(step: DraftStep, offset: number) {
    const clamped = Math.max(0, Math.min(MAX_OFFSET, offset))
    updateStep(step.uid, {
      offset: clamped,
      date: addDaysStr(startDate, clamped),
      label: OFFSET_PREFIX.test(step.label) ? step.label.replace(OFFSET_PREFIX, (_m, letter) => `${letter}+${clamped}`) : step.label,
    })
  }

  function setStepDate(step: DraftStep, date: string) {
    if (step.offset == null) { updateStep(step.uid, { date }); return }
    const offset = Math.max(0, daysBetweenStr(startDate, date))
    updateStep(step.uid, {
      offset,
      date: addDaysStr(startDate, offset),
      label: OFFSET_PREFIX.test(step.label) ? step.label.replace(OFFSET_PREFIX, (_m, letter) => `${letter}+${offset}`) : step.label,
    })
  }

  function addStep() {
    setSteps(prev => {
      const base = prev.filter(s => s.extraKey === null)
      const lastOffset = base.reduce((max, s) => Math.max(max, s.offset ?? 0), 0)
      const offset = Math.min(MAX_OFFSET, lastOffset + 30)
      const step: DraftStep = {
        uid: nextUid(),
        extraKey: null,
        label: offsetLabel(offset),
        enabled: true,
        offset,
        date: addDaysStr(startDate, offset),
        channel: 'whatsapp',
        message: renderCareMessage(t('care.custom_step_message'), vars),
      }
      return [...base, step, ...prev.filter(s => s.extraKey !== null)]
    })
  }

  const removeStep = (uid: string) => setSteps(prev => prev.filter(s => s.uid !== uid))

  async function handleSaveFavorite() {
    const name = favoriteName.trim()
    const favSteps = steps
      .filter(s => s.extraKey === null && s.enabled && s.offset != null)
      .sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))
      .map(s => ({ offsetDays: s.offset as number, channel: s.channel, label: s.label.trim() || offsetLabel(s.offset as number), message: unrenderCareMessage(s.message.trim(), vars) }))
    if (!name) { setFavoriteMsg(t('care.favorite_name_required')); return }
    if (favSteps.length === 0) { setFavoriteMsg(t('care.no_step')); return }
    setFavoriteSaving(true)
    setFavoriteMsg('')
    try {
      const created = await createCareFavorite(userId, name, favSteps)
      setFavorites(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setSource({ kind: 'favorite', favorite: created })
      setFavoriteOpen(false)
      setFavoriteName('')
      setFavoriteMsg(t('care.favorite_saved', { name: created.name }))
    } catch (e) {
      console.error('[care.favorite.save]', e)
      setFavoriteMsg(e instanceof Error && e.message === 'care_favorite_exists' ? t('care.favorite_exists') : t('care.error'))
    } finally {
      setFavoriteSaving(false)
    }
  }

  async function handleDeleteFavorite(favorite: CareFavorite) {
    try {
      await deleteCareFavorite(favorite.id)
      setFavorites(prev => prev.filter(f => f.id !== favorite.id))
      if (source.kind === 'favorite' && source.favorite.id === favorite.id) chooseSource({ kind: 'builtin', key: CARE_TEMPLATES[0].key })
      setPendingDelete(null)
    } catch (e) {
      console.error('[care.favorite.delete]', e)
      setFavoriteMsg(t('care.error'))
    }
  }

  async function handleActivate() {
    const chosen = steps.filter(s => s.enabled && s.date >= today)
    if (chosen.length === 0) { setErrorMsg(t('care.no_step')); return }
    // Clé stable par étape (unique dans l'accompagnement) : jour pour les étapes datées.
    const used = new Set<string>()
    const keyFor = (s: DraftStep) => {
      const base: string = s.extraKey ?? `d${s.offset ?? 0}`
      let key = base
      let n = 2
      while (used.has(key)) key = `${base}_${n++}`
      used.add(key)
      return key
    }
    setSaving(true)
    setErrorMsg('')
    try {
      await startCareJourney(userId, {
        clientId: client.id,
        templateKey: source.kind === 'builtin' ? source.key : `favorite:${source.favorite.id}`,
        label: source.kind === 'builtin' ? t(`care.templates.${source.key}.name`) : source.favorite.name,
        startDate,
        steps: [...chosen]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(s => ({ key: keyFor(s), title: s.label.trim() || offsetLabel(s.offset ?? 0), dueDate: s.date, channel: s.channel, message: s.message.trim() })),
      })
      onStarted()
    } catch (e) {
      console.error('[care.start]', e)
      setErrorMsg(e instanceof Error && e.message === 'care_journey_already_active' ? t('care.error_already_active') : t('care.error'))
      setSaving(false)
    }
  }

  const fmt = (d: string) => formatDate(`${d}T12:00:00`, locale)
  const baseSteps = steps.filter(s => s.extraKey === null)
  const extraSteps = steps.filter(s => s.extraKey !== null)
  const isSelected = (src: Source) =>
    src.kind === 'builtin'
      ? source.kind === 'builtin' && source.key === src.key
      : source.kind === 'favorite' && source.favorite.id === src.favorite.id

  const renderStep = (step: DraftStep) => {
    const past = step.date < today
    const active = step.enabled && !past
    return (
      <View key={step.uid} style={[styles.stepCard, !active && styles.stepCardOff]}>
        <View style={styles.stepTopRow}>
          <TouchableOpacity
            style={styles.checkbox}
            disabled={past}
            onPress={() => updateStep(step.uid, { enabled: !step.enabled })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active, disabled: past }}
            accessibilityLabel={step.label}
            activeOpacity={0.7}
          >
            <View style={[styles.checkboxBox, active && styles.checkboxOn]}>
              {active ? <Text style={styles.checkMark}>✓</Text> : null}
            </View>
          </TouchableOpacity>
          {step.extraKey === null ? (
            <TextInput
              style={styles.labelInput}
              value={step.label}
              onChangeText={text => updateStep(step.uid, { label: text })}
              accessibilityLabel={t('care.step_name_label')}
            />
          ) : (
            <Text style={styles.stepLabel}>{step.label}</Text>
          )}
          {step.extraKey === null ? (
            <TouchableOpacity onPress={() => removeStep(step.uid)} style={styles.removeBtn} accessibilityLabel={t('care.remove_step')} activeOpacity={0.7}>
              <Text style={styles.removeBtnText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.whenRow}>
          {step.offset != null ? (
            <View style={styles.offsetBox}>
              <Text style={styles.offsetPrefix}>{t('care.day_prefix')}</Text>
              <TextInput
                style={styles.offsetInput}
                value={String(step.offset)}
                onChangeText={text => {
                  const n = parseInt(text.replace(/\D/g, ''), 10)
                  setStepOffset(step, Number.isFinite(n) ? n : 0)
                }}
                keyboardType="number-pad"
                accessibilityLabel={t('care.day_offset_label')}
              />
            </View>
          ) : null}
          <TouchableOpacity style={styles.dateBtn} onPress={() => setCalendarFor(step.uid)} activeOpacity={0.7}>
            <Text style={styles.dateBtnText}>📅 {fmt(step.date)}</Text>
          </TouchableOpacity>
          {past ? <Text style={styles.pastText}>{t('care.past_step')}</Text> : null}
        </View>

        {active ? (
          <>
            <View style={styles.channelRow}>
              {CARE_CHANNELS.map(ch => (
                <TouchableOpacity
                  key={ch}
                  style={[styles.channelChip, step.channel === ch && styles.channelChipOn]}
                  onPress={() => updateStep(step.uid, { channel: ch })}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.channelChipText, step.channel === ch && styles.channelChipTextOn]}>
                    {CARE_CHANNEL_ICON[ch]} {t(`next_action_types.${ch}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.messageInput}
              value={step.message}
              onChangeText={text => updateStep(step.uid, { message: text })}
              multiline
              accessibilityLabel={`${step.label} — ${t('care.message_label')}`}
            />
          </>
        ) : null}
      </View>
    )
  }

  const calendarStep = steps.find(s => s.uid === calendarFor)
  const calendarValue = calendarFor === 'start' ? startDate : calendarStep?.date ?? today

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>{t('care.modal_title')}</Text>
            <Text style={styles.subtitle}>{client.full_name}</Text>

            {/* Favoris personnels en tête, avant les modèles proposés. */}
            {favorites.length > 0 ? (
              <>
                <Text style={styles.fieldLabel}>{t('care.favorites_label')}</Text>
                <View style={styles.favoriteRow}>
                  {favorites.map(fav => {
                    const src: Source = { kind: 'favorite', favorite: fav }
                    const selected = isSelected(src)
                    return (
                      <View key={fav.id} style={[styles.favoriteChip, selected && styles.templateChipOn]}>
                        <TouchableOpacity onPress={() => chooseSource(src)} activeOpacity={0.7} style={styles.favoriteChipMain}>
                          <Text style={[styles.templateName, selected && styles.templateNameOn]} numberOfLines={1}>⭐ {fav.name}</Text>
                          <Text style={styles.templateDesc}>{t('care.favorite_steps_count', { count: fav.steps.length })}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setPendingDelete(fav)} style={styles.removeBtn} accessibilityLabel={`${t('care.delete_favorite')} ${fav.name}`} activeOpacity={0.7}>
                          <Text style={styles.removeBtnText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    )
                  })}
                </View>
                {pendingDelete ? (
                  <View style={styles.confirmBox}>
                    <Text style={styles.confirmText}>{t('care.delete_favorite_confirm', { name: pendingDelete.name })}</Text>
                    <View style={styles.inlineBtns}>
                      <TouchableOpacity style={styles.secondaryBtnSm} onPress={() => setPendingDelete(null)} activeOpacity={0.8}>
                        <Text style={styles.secondaryBtnText}>{t('care.cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.dangerBtnSm} onPress={() => handleDeleteFavorite(pendingDelete)} activeOpacity={0.85}>
                        <Text style={styles.primaryBtnText}>{t('care.delete_favorite')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}

            <Text style={styles.fieldLabel}>{favorites.length > 0 ? t('care.builtin_label') : t('care.template_label')}</Text>
            <View style={styles.templateRow}>
              {CARE_TEMPLATES.map(tpl => {
                const src: Source = { kind: 'builtin', key: tpl.key }
                const selected = isSelected(src)
                return (
                  <TouchableOpacity key={tpl.key} style={[styles.templateChip, selected && styles.templateChipOn]} onPress={() => chooseSource(src)} activeOpacity={0.7}>
                    <Text style={[styles.templateName, selected && styles.templateNameOn]}>🌱 {t(`care.templates.${tpl.key}.name`)}</Text>
                    <Text style={styles.templateDesc}>{t(`care.templates.${tpl.key}.description`)}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>

            <Text style={styles.fieldLabel}>{t('care.start_date_label')}</Text>
            <TouchableOpacity style={[styles.dateBtn, styles.startDateBtn]} onPress={() => setCalendarFor('start')} activeOpacity={0.7}>
              <Text style={styles.dateBtnText}>📅 {fmt(startDate)}</Text>
            </TouchableOpacity>

            <Text style={styles.hint}>{t('care.steps_hint_custom')}</Text>
            {baseSteps.map(renderStep)}
            <TouchableOpacity style={styles.addStepBtn} onPress={addStep} activeOpacity={0.8}>
              <Text style={styles.addStepText}>+ {t('care.add_step')}</Text>
            </TouchableOpacity>

            <Text style={styles.fieldLabel}>{t('care.extras_label')}</Text>
            {extraSteps.map(renderStep)}
            {!client.birth_date ? <Text style={styles.pastText}>🎂 {t('care.no_birth_date')}</Text> : null}

            {/* ── Enregistrer comme favori ── */}
            <View style={styles.favoriteBox}>
              {favoriteOpen ? (
                <>
                  <Text style={styles.fieldLabel}>{t('care.favorite_name_label')}</Text>
                  <TextInput
                    style={styles.nameInput}
                    value={favoriteName}
                    onChangeText={setFavoriteName}
                    placeholder={t('care.favorite_name_placeholder')}
                    placeholderTextColor={colors.textTertiary}
                    maxLength={80}
                    accessibilityLabel={t('care.favorite_name_label')}
                  />
                  <Text style={styles.pastText}>{t('care.favorite_hint')}</Text>
                  <View style={styles.inlineBtns}>
                    <TouchableOpacity style={styles.secondaryBtnSm} onPress={() => { setFavoriteOpen(false); setFavoriteMsg('') }} disabled={favoriteSaving} activeOpacity={0.8}>
                      <Text style={styles.secondaryBtnText}>{t('care.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.primaryBtnSm, favoriteSaving && { opacity: 0.6 }]} onPress={handleSaveFavorite} disabled={favoriteSaving} activeOpacity={0.85}>
                      {favoriteSaving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>⭐ {t('care.save_favorite')}</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <TouchableOpacity onPress={() => { setFavoriteOpen(true); setFavoriteMsg('') }} activeOpacity={0.7}>
                  <Text style={styles.linkText}>⭐ {t('care.save_as_favorite')}</Text>
                </TouchableOpacity>
              )}
              {favoriteMsg ? <Text style={styles.favoriteMsg}>{favoriteMsg}</Text> : null}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
            <Text style={styles.footerHint}>{t('care.manual_hint')}</Text>
            <View style={styles.footerBtns}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} disabled={saving} activeOpacity={0.8}>
                <Text style={styles.secondaryBtnText}>{t('care.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.primaryBtn, saving && { opacity: 0.6 }]} onPress={handleActivate} disabled={saving} activeOpacity={0.85}>
                {saving ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>{t('care.activate')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      <CalendarPickerModal
        visible={calendarFor !== null}
        value={calendarValue}
        locale={locale}
        onClose={() => setCalendarFor(null)}
        onConfirm={d => {
          if (calendarFor === 'start') changeStartDate(d)
          else if (calendarStep) setStepDate(calendarStep, d)
          setCalendarFor(null)
        }}
      />
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'center', alignItems: 'center', padding: 16 },
    sheet: { width: '100%', maxWidth: 680, maxHeight: '92%', backgroundColor: colors.card, borderRadius: 20, overflow: 'hidden' },
    content: { padding: 24, gap: 12 },
    title: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
    subtitle: { fontFamily: fonts.body, fontSize: 14, color: colors.textSecondary, marginTop: -6 },
    fieldLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text, marginTop: 6 },
    templateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    templateChip: { flexGrow: 1, flexBasis: 220, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 4 },
    templateChipOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    templateName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
    templateNameOn: { color: colors.primary },
    templateDesc: { fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary },
    favoriteRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    favoriteChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 12, paddingRight: 4, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, maxWidth: 300 },
    favoriteChipMain: { gap: 2, flexShrink: 1 },
    hint: { fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary, backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
    stepCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, gap: 10 },
    stepCardOff: { backgroundColor: colors.surface },
    stepTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    checkbox: { padding: 4 },
    checkboxBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkMark: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 12 },
    labelInput: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.text, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: 'transparent', backgroundColor: colors.surface },
    stepLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
    removeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    removeBtnText: { fontSize: 13, color: colors.textTertiary },
    whenRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
    offsetBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingLeft: 10, backgroundColor: colors.card },
    offsetPrefix: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textSecondary },
    offsetInput: { width: 56, paddingVertical: 8, paddingHorizontal: 6, fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
    dateBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    startDateBtn: { alignSelf: 'flex-start', paddingVertical: 10 },
    dateBtnText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
    pastText: { fontFamily: fonts.body, fontSize: 12, color: colors.textTertiary },
    channelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    channelChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    channelChipOn: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    channelChipText: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary },
    channelChipTextOn: { color: colors.primary },
    messageInput: { minHeight: 64, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, fontFamily: fonts.body, fontSize: 13, color: colors.text, textAlignVertical: 'top' },
    addStepBtn: { alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border },
    addStepText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.primary },
    favoriteBox: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, marginTop: 4 },
    nameInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontFamily: fonts.body, fontSize: 14, color: colors.text },
    favoriteMsg: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.textSecondary },
    linkText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.primary },
    confirmBox: { gap: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 10 },
    confirmText: { fontFamily: fonts.body, fontSize: 13, color: colors.text },
    inlineBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    footer: { borderTopWidth: 1, borderTopColor: colors.border, padding: 16, gap: 10 },
    footerHint: { fontFamily: fonts.body, fontSize: 12, color: colors.textSecondary },
    errorText: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
    footerBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
    secondaryBtn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
    secondaryBtnSm: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
    secondaryBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
    primaryBtn: { paddingVertical: 11, paddingHorizontal: 18, borderRadius: 12, backgroundColor: colors.primaryAction, minWidth: 120, alignItems: 'center' },
    primaryBtnSm: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.primaryAction, minWidth: 110, alignItems: 'center' },
    dangerBtnSm: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.danger },
    primaryBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.onPrimary },
  })
}
