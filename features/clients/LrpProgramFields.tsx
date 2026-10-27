import { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { LrpFrequencyUnit, RecurringProgram, RecurringProgramEndMode } from '@/shared/lib/types'
import { LRP_FREQUENCY_PRESETS, getLrpFrequencyLabel, initialLrpProgramValue } from './lrpProgramService'
import type { LrpProgramValue } from './lrpProgramService'
import { calculateNextLrpDate } from './clientService'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { DateInput } from '@/shared/components/ui/DateInput'
import { formatDate } from '@/shared/lib/dateFormat'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

interface LrpProgramFieldsProps {
  // LRP-4.1 §3 — TOUS les programmes actuellement actifs de ce contact (pas "le" programme
  // actif unique) : 0 → nouveau programme direct ; 1 → présélectionné automatiquement, sans
  // sélecteur affiché ; 2+ → l'utilisateur DOIT choisir explicitement, jamais un rattachement
  // silencieux au mauvais programme.
  candidatePrograms: RecurringProgram[]
  orderDate: string
  value: LrpProgramValue
  onChange: (value: LrpProgramValue) => void
  // LRP-4.2 §1 — force le mode déplié dès l'ouverture, utilisé par la vue détail programme pour
  // une édition explicite ("Modifier"), où le mode compact n'a pas de sens.
  forceExpanded?: boolean
}

// LRP-4 — UNIQUE implémentation UI du bloc "Programme récurrent", partagée par les deux seuls
// vrais points de création d'une commande récurrente dans ce projet (clients/[id]/orders.tsx et
// la clôture RDV "Vente réalisée" — orders/index.tsx n'a pas de formulaire de création, voir
// audit LRP-3/ORDER-BUSINESS-1). Jamais utilisé par OrderEditModal (édition) : éditer une
// commande existante n'affiche jamais ce bloc et ne peut jamais avancer le programme.
export function LrpProgramFields({ candidatePrograms, orderDate, value, onChange, forceExpanded }: LrpProgramFieldsProps) {
  const { t, i18n } = useTranslation()
  const { getLrpName } = useAppConfig()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const selectedProgram = candidatePrograms.find(p => p.id === value.programId) ?? null
  const hasExistingFrequency = selectedProgram?.frequency_value != null && selectedProgram?.frequency_unit != null
  const alreadyActive = selectedProgram?.status === 'active'
  const [expanded, setExpanded] = useState(!!forceExpanded || !(alreadyActive && hasExistingFrequency) || candidatePrograms.length >= 2)
  const [customMode, setCustomMode] = useState(
    hasExistingFrequency && !LRP_FREQUENCY_PRESETS.some(p => p.value === selectedProgram?.frequency_value && p.unit === selectedProgram?.frequency_unit)
  )

  function selectProgram(programId: string | null) {
    const program = candidatePrograms.find(p => p.id === programId) ?? null
    onChange(initialLrpProgramValue(program, orderDate))
    setExpanded(true)
    setCustomMode(false)
  }

  function selectPreset(presetValue: number, presetUnit: LrpFrequencyUnit) {
    setCustomMode(false)
    onChange({ ...value, frequencyValue: presetValue, frequencyUnit: presetUnit, nextLrpDate: calculateNextLrpDate(orderDate, presetValue, presetUnit) })
  }

  function changeCustomValue(raw: string) {
    const n = Math.max(1, parseInt(raw.replace(/\D/g, ''), 10) || 1)
    onChange({ ...value, frequencyValue: n, nextLrpDate: calculateNextLrpDate(orderDate, n, value.frequencyUnit) })
  }

  function changeCustomUnit(unit: LrpFrequencyUnit) {
    onChange({ ...value, frequencyUnit: unit, nextLrpDate: calculateNextLrpDate(orderDate, value.frequencyValue, unit) })
  }

  function changeEndMode(mode: RecurringProgramEndMode) {
    onChange({
      ...value, endMode: mode,
      occurrenceLimit: mode === 'occurrence_limit' ? (value.occurrenceLimit ?? 4) : null,
      endDate: mode === 'end_date' ? (value.endDate ?? '') : null,
    })
  }

  const frequencyLabel = getLrpFrequencyLabel(value.frequencyValue, value.frequencyUnit, t)
  const programTitle = t('lrp.program_title', { name: value.label.trim() || getLrpName() })

  if (!expanded) {
    return (
      <View style={styles.compactCard}>
        <Text style={styles.compactTitle}>{programTitle}</Text>
        <Text style={styles.compactLine}>
          {frequencyLabel} · {t('lrp.next_order_label')} {value.nextLrpDate ? formatDate(value.nextLrpDate, locale) : '—'}
        </Text>
        <TouchableOpacity onPress={() => setExpanded(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.editLink}>{t('common.edit')}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{programTitle}</Text>

      {candidatePrograms.length >= 2 ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>{t('lrp.select_program_label')}</Text>
          <View style={styles.chipRow}>
            {candidatePrograms.map(p => {
              const active = value.programId === p.id
              return (
                <TouchableOpacity key={p.id} style={[styles.chip, active && styles.chipActive]} onPress={() => selectProgram(p.id)} activeOpacity={0.7}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label?.trim() || getLrpName()}</Text>
                </TouchableOpacity>
              )
            })}
            <TouchableOpacity style={[styles.chip, value.programId === null && styles.chipActive]} onPress={() => selectProgram(null)} activeOpacity={0.7}>
              <Text style={[styles.chipText, value.programId === null && styles.chipTextActive]}>{t('lrp.new_program_option')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {alreadyActive && !hasExistingFrequency ? (
        <Text style={styles.legacyHint}>{t('lrp.frequency_undefined_hint')}</Text>
      ) : null}

      {/* LRP-4.3 §5 — un programme déjà ciblé peut recevoir soit une commande qui consomme
          réellement la prochaine échéance (par défaut), soit une commande complémentaire du
          même cycle déjà en cours (ex. 2e commande du mois) qui ne doit PAS faire avancer le
          programme une seconde fois. Absent pour un nouveau programme : rien à "compléter". */}
      {selectedProgram ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>{t('lrp.occurrence_mode_label')}</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              style={[styles.chip, value.consumesNewOccurrence && styles.chipActive]}
              onPress={() => onChange({ ...value, consumesNewOccurrence: true })}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, value.consumesNewOccurrence && styles.chipTextActive]}>{t('lrp.occurrence_mode_new')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.chip, !value.consumesNewOccurrence && styles.chipActive]}
              onPress={() => onChange({ ...value, consumesNewOccurrence: false })}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, !value.consumesNewOccurrence && styles.chipTextActive]}>{t('lrp.occurrence_mode_complementary')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {selectedProgram && !value.consumesNewOccurrence ? (
        <>
          <DateInput
            label={t('lrp.complementary_occurrence_field_label')}
            value={value.complementaryOccurrenceDate}
            onChangeValue={(d) => onChange({ ...value, complementaryOccurrenceDate: d })}
          />
          <Text style={styles.labelHint}>{t('lrp.occurrence_mode_complementary_hint')}</Text>
        </>
      ) : null}

      {selectedProgram && !value.consumesNewOccurrence ? null : (
      <>
      <Text style={styles.fieldLabel}>{t('lrp.program_label_field')}</Text>
      <TextInput
        style={styles.labelInput}
        value={value.label}
        onChangeText={v => onChange({ ...value, label: v })}
        placeholder={t('lrp.program_label_placeholder')}
        placeholderTextColor={colors.textTertiary}
      />
      {/* LRP-4.2 §2 — reste facultatif (jamais bloquant), mais fortement encouragé dès qu'un
          autre programme existe déjà pour ce contact : sans nom distinct, deux programmes
          seraient indiscernables partout où ils sont listés (Synthèse, Profil, sélecteur). */}
      {!value.label.trim() && candidatePrograms.length > 0 ? (
        <Text style={styles.labelHint}>{t('lrp.program_label_multi_hint')}</Text>
      ) : null}

      <Text style={styles.fieldLabel}>{t('lrp.frequency_label')}</Text>
      <View style={styles.chipRow}>
        {LRP_FREQUENCY_PRESETS.map(p => {
          const active = !customMode && value.frequencyValue === p.value && value.frequencyUnit === p.unit
          return (
            <TouchableOpacity key={p.labelKey} style={[styles.chip, active && styles.chipActive]} onPress={() => selectPreset(p.value, p.unit)} activeOpacity={0.7}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{t(p.labelKey)}</Text>
            </TouchableOpacity>
          )
        })}
        <TouchableOpacity style={[styles.chip, customMode && styles.chipActive]} onPress={() => setCustomMode(true)} activeOpacity={0.7}>
          <Text style={[styles.chipText, customMode && styles.chipTextActive]}>{t('lrp.preset_custom')}</Text>
        </TouchableOpacity>
      </View>

      {customMode ? (
        <View style={styles.customRow}>
          <Text style={styles.customPrefix}>{t('lrp.custom_prefix')}</Text>
          <TextInput
            style={styles.customInput}
            value={String(value.frequencyValue)}
            onChangeText={changeCustomValue}
            keyboardType="number-pad"
          />
          <View style={styles.unitRow}>
            {(['week', 'month'] as LrpFrequencyUnit[]).map(u => (
              <TouchableOpacity key={u} style={[styles.unitChip, value.frequencyUnit === u && styles.chipActive]} onPress={() => changeCustomUnit(u)} activeOpacity={0.7}>
                <Text style={[styles.chipText, value.frequencyUnit === u && styles.chipTextActive]}>
                  {t(u === 'week' ? 'lrp.unit_weeks' : 'lrp.unit_months')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      <DateInput
        label={t('lrp.next_order_field_label')}
        value={value.nextLrpDate}
        onChangeValue={(d) => onChange({ ...value, nextLrpDate: d })}
      />

      <Text style={styles.fieldLabel}>{t('lrp.duration_label')}</Text>
      <View style={styles.durationOptions}>
        <TouchableOpacity style={styles.durationRow} onPress={() => changeEndMode('open_ended')} activeOpacity={0.7}>
          <View style={[styles.radio, value.endMode === 'open_ended' && styles.radioActive]} />
          <Text style={styles.durationLabel}>{t('lrp.duration_open_ended')}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.durationRow} onPress={() => changeEndMode('occurrence_limit')} activeOpacity={0.7}>
          <View style={[styles.radio, value.endMode === 'occurrence_limit' && styles.radioActive]} />
          <Text style={styles.durationLabel}>{t('lrp.duration_occurrence_limit')}</Text>
        </TouchableOpacity>
        {value.endMode === 'occurrence_limit' ? (
          <>
            <View style={styles.durationInputRow}>
              <TextInput
                style={styles.customInput}
                value={value.occurrenceLimit != null ? String(value.occurrenceLimit) : ''}
                onChangeText={v => onChange({ ...value, occurrenceLimit: Math.max(1, parseInt(v.replace(/\D/g, ''), 10) || 1) })}
                keyboardType="number-pad"
              />
              <Text style={styles.durationInputSuffix}>{t('lrp.occurrences_suffix')}</Text>
            </View>
            {/* LRP-5 §9 — lève l'ambiguïté "4 échéances" : ce nombre représente des CYCLES prévus
                par le calendrier (confirmés ou marqués "non réalisée"), pas 4 commandes
                honorées avec succès — voir countConsumedOccurrences. */}
            <Text style={styles.durationHint}>{t('lrp.duration_occurrence_limit_hint')}</Text>
          </>
        ) : null}

        <TouchableOpacity style={styles.durationRow} onPress={() => changeEndMode('end_date')} activeOpacity={0.7}>
          <View style={[styles.radio, value.endMode === 'end_date' && styles.radioActive]} />
          <Text style={styles.durationLabel}>{t('lrp.duration_end_date')}</Text>
        </TouchableOpacity>
        {value.endMode === 'end_date' ? (
          <>
            <DateInput value={value.endDate ?? ''} onChangeValue={d => onChange({ ...value, endDate: d })} />
            <Text style={styles.durationHint}>{t('lrp.duration_end_date_hint')}</Text>
          </>
        ) : null}
      </View>
      </>
      )}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.secondaryLight, borderRadius: 12, padding: 14, gap: 10,
      borderWidth: 1, borderColor: colors.secondary,
    },
    title: { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
    legacyHint: { fontSize: 12, fontFamily: fonts.body, color: colors.warning },
    fieldBlock: { gap: 6 },
    fieldLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    labelInput: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 8,
      paddingHorizontal: 10, fontSize: 13, fontFamily: fonts.body, color: colors.text,
      backgroundColor: colors.card,
    },
    labelHint: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, fontStyle: 'italic' },
    durationHint: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginLeft: 24 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    chipText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    chipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    customRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    customPrefix: { fontSize: 13, fontFamily: fonts.body, color: colors.text },
    customInput: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6,
      paddingHorizontal: 10, fontSize: 13, fontFamily: fonts.body, color: colors.text,
      backgroundColor: colors.card, width: 56, textAlign: 'center',
    },
    unitRow: { flexDirection: 'row', gap: 6 },
    unitChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    durationOptions: { gap: 6 },
    durationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    radio: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    radioActive: { borderColor: colors.primary, backgroundColor: colors.primary },
    durationLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    durationInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 24 },
    durationInputSuffix: { fontSize: 13, fontFamily: fonts.body, color: colors.text },
    compactCard: { backgroundColor: colors.secondaryLight, borderRadius: 12, padding: 12, gap: 4 },
    compactTitle: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
    compactLine: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    editLink: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary, marginTop: 2 },
  })
}
