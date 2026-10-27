import { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Input } from '@/shared/components/ui/Input'
import { TextArea } from '@/shared/components/ui/TextArea'
import { CalendarPickerModal } from '@/shared/components/ui/CalendarPickerModal'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import type { NextActionType } from '@/shared/lib/types'
import type { FollowupInput } from '@/features/followups/followupService'
import { FOLLOWUP_DATE_PRESETS, followupPresetDate } from '@/features/followups/followupDatePresets'

// ACTION-OUTCOME-1 / P1.2 §20 — un seul composant "Suite" partagé entre la clôture d'interaction
// (P0, clients/[id]/interactions.tsx) et l'échange créé à la clôture d'une relance (P1,
// FollowupCompletionModal) : jamais deux logiques de suite parallèles.
export type NextStepChoice = 'none' | 'followup' | 'appointment'

export type NextStepValue = {
  step: NextStepChoice
  followupDueDate: string
  followupActionType: NextActionType | null
  followupTitle: string
  // ACTION-FLOW-1 / P1 — description facultative de la relance créée comme Suite ; jamais
  // confondue avec notes_brutes/compte-rendu (§10/§27 du brief).
  followupContent: string
}

const ACTION_TYPES: NextActionType[] = ['call', 'whatsapp', 'sms', 'email', 'rdv']
const ACTION_ICONS: Record<NextActionType, string> = {
  call: '📞', whatsapp: '💬', sms: '📱', email: '✉️', rdv: '📅',
}

export function defaultNextStepValue(opts?: { actionType?: NextActionType | null; title?: string; content?: string }): NextStepValue {
  return {
    step: 'none',
    followupDueDate: followupPresetDate('7d'),
    followupActionType: opts?.actionType ?? null,
    followupTitle: opts?.title ?? '',
    followupContent: opts?.content ?? '',
  }
}

// §10/§12 — traçabilité de l'origine (source_interaction_id), jamais une contrainte d'unicité
// sur ce champ lui-même : une même interaction peut légitimement produire plusieurs relances
// dans le temps.
//
// ACTION-OUTCOME-1 / P1.2.1 — closure_action_key réutilise la même colonne générique que le
// moteur de clôture RDV (déjà partagée par orders/recommendations/followups), avec une valeur
// déterministe et stable (même format `${id}:...` que `${appointmentId}:revision:${n}:...`),
// protégée par l'index unique partiel followups_interaction_closure_key_uidx
// (source_interaction_id, closure_action_key). C'est CETTE clé, pas source_interaction_id, qui
// garantit qu'un retry après perte de réponse réseau/double soumission ne crée jamais une
// deuxième relance pour la même clôture d'interaction (voir createFollowup()).
export function buildFollowupInputFromNextStep(clientId: string, sourceInteractionId: string, value: NextStepValue): FollowupInput {
  return {
    client_id: clientId,
    title: value.followupTitle.trim() || null,
    // ACTION-FLOW-1 / P1 §10 — description facultative saisie/préremplie dans le sélecteur de
    // Suite, jamais notes_brutes recopié automatiquement.
    content: value.followupContent.trim() || null,
    due_date: value.followupDueDate,
    done: false,
    action_type: value.followupActionType,
    source_interaction_id: sourceInteractionId,
    closure_action_key: `${sourceInteractionId}:next-followup`,
  }
}

export function NextStepSelector({ value, onChange }: { value: NextStepValue; onChange: (v: NextStepValue) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [showCustomCal, setShowCustomCal] = useState(false)
  const [customActive, setCustomActive] = useState(false)

  const choices: { key: NextStepChoice; label: string }[] = [
    { key: 'none', label: t('followups.next_step_none') },
    { key: 'followup', label: t('followups.next_step_followup') },
    { key: 'appointment', label: t('followups.next_step_appointment') },
  ]

  return (
    <View style={styles.wrapper}>
      <Text style={styles.sectionLabel}>{t('followups.next_step_label')}</Text>
      {/* §27 — toujours une colonne (jamais 3 options côte à côte) : sûr sur mobile étroit. */}
      <View style={styles.choiceGroup}>
        {choices.map(({ key, label }) => {
          const active = value.step === key
          return (
            <TouchableOpacity key={key} style={styles.choiceRow} onPress={() => onChange({ ...value, step: key })} activeOpacity={0.7}>
              <View style={[styles.radio, active && styles.radioActive]} />
              <Text style={styles.choiceLabel}>{label}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {value.step === 'followup' ? (
        <View style={styles.followupForm}>
          <Text style={styles.fieldLabel}>{t('followups.due_date')}</Text>
          <View style={styles.chipRow}>
            {FOLLOWUP_DATE_PRESETS.map(preset => {
              const presetDate = followupPresetDate(preset)
              const active = !customActive && value.followupDueDate === presetDate
              return (
                <TouchableOpacity
                  key={preset}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => { setCustomActive(false); onChange({ ...value, followupDueDate: presetDate }) }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{t(`followups.preset_${preset}`)}</Text>
                </TouchableOpacity>
              )
            })}
            <TouchableOpacity style={[styles.chip, customActive && styles.chipActive]} onPress={() => setShowCustomCal(true)} activeOpacity={0.7}>
              <Text style={[styles.chipLabel, customActive && styles.chipLabelActive]}>
                {customActive ? formatDate(value.followupDueDate, locale) : t('followups.preset_custom')}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.fieldLabel}>{t('followups.action_type')}</Text>
          <View style={styles.chipRow}>
            {ACTION_TYPES.map(at => {
              const active = value.followupActionType === at
              return (
                <TouchableOpacity
                  key={at}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => onChange({ ...value, followupActionType: active ? null : at })}
                  activeOpacity={0.7}
                >
                  <Text style={styles.chipIcon}>{ACTION_ICONS[at]}</Text>
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>{t(`next_action_types.${at}`)}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          <Input
            label={`${t('followups.title_label')} (${t('common.optional')})`}
            value={value.followupTitle}
            onChangeText={text => onChange({ ...value, followupTitle: text })}
          />

          {/* ACTION-FLOW-1 / P1 §12/§13 — champ compact, visible seulement dans le choix
              "Créer une relance" ; jamais une seconde FollowupModal complète dans cette modale
              de clôture. */}
          <TextArea
            label={`${t('followups.description')} (${t('common.optional')})`}
            value={value.followupContent}
            onChangeText={text => onChange({ ...value, followupContent: text })}
            minHeight={60}
          />

          <CalendarPickerModal
            visible={showCustomCal}
            value={value.followupDueDate}
            locale={locale}
            dayAppointments={[]}
            onClose={() => setShowCustomCal(false)}
            onConfirm={date => { setCustomActive(true); onChange({ ...value, followupDueDate: date }); setShowCustomCal(false) }}
          />
        </View>
      ) : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrapper:      { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 2 },
    sectionLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    choiceGroup:  { gap: 2 },
    choiceRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
    radio:        { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: colors.border },
    radioActive:  { borderColor: colors.primary, borderWidth: 5 },
    choiceLabel:  { fontSize: 13, fontFamily: fonts.medium, color: colors.text },

    followupForm: { gap: 10, marginTop: 4, paddingLeft: 2 },
    fieldLabel:   { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip:         { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
    chipActive:   { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    chipIcon:     { fontSize: 12 },
    chipLabel:    { fontSize: 11.5, fontFamily: fonts.medium, color: colors.textSecondary },
    chipLabelActive: { color: colors.primaryAction, fontFamily: fonts.semibold },
  })
}
