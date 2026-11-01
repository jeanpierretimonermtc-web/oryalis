import { useMemo, useRef, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { MEETING_MODES, MEETING_MODE_ICON } from './meetingMode'
import type { MeetingMode } from './meetingMode'

interface Props {
  mode: MeetingMode | null
  onModeChange: (mode: MeetingMode | null) => void
  location: string
  onLocationChange: (v: string) => void
  meetingUrl: string
  onMeetingUrlChange: (v: string) => void
  clientFirstName?: string | null
  clientAddress?: string | null
  clientPhone?: string | null
  officeAddress?: string | null
  defaultMeetingUrl?: string | null
  onSaveOfficeAddress: (address: string) => void
  onSaveDefaultMeetingUrl: (url: string) => void
}

// MEETING-MODE-1 — "Comment ?" : un choix, puis un seul complément prérempli selon le mode.
export function MeetingModeField(props: Props) {
  const {
    mode, onModeChange, location, onLocationChange, meetingUrl, onMeetingUrlChange,
    clientFirstName, clientAddress, clientPhone, officeAddress, defaultMeetingUrl,
    onSaveOfficeAddress, onSaveDefaultMeetingUrl,
  } = props
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const addressRef = useRef<TextInput>(null)
  // Adresse du cabinet : saisie sur place (première fois ou modification), puis réutilisée.
  const [editingOffice, setEditingOffice] = useState(false)
  const [officeDraft, setOfficeDraft] = useState('')

  function startEditOffice() {
    setOfficeDraft(officeAddress ?? '')
    setEditingOffice(true)
  }

  function saveOffice() {
    const value = officeDraft.trim()
    if (!value) return
    onSaveOfficeAddress(value)
    onLocationChange(value)
    setEditingOffice(false)
  }

  function chooseOtherAddress() {
    onLocationChange('')
    setTimeout(() => addressRef.current?.focus(), 0)
  }

  function selectMode(next: MeetingMode) {
    if (next === mode) { onModeChange(null); return }
    onModeChange(next)
    if (next === 'video' && !meetingUrl.trim() && defaultMeetingUrl) onMeetingUrlChange(defaultMeetingUrl)
    if (next === 'in_person' && !location.trim()) {
      if (officeAddress) onLocationChange(officeAddress)
      else if (clientAddress) onLocationChange(clientAddress)
    }
  }

  const trimmedLocation = location.trim()
  const trimmedUrl = meetingUrl.trim()

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t('appointments.meeting_mode_label')}</Text>
      <View style={styles.chips}>
        {MEETING_MODES.map(m => {
          const active = mode === m
          return (
            <TouchableOpacity
              key={m}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => selectMode(m)}
              activeOpacity={0.75}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {MEETING_MODE_ICON[m]} {t(`appointments.meeting_mode_${m}`)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {mode === 'in_person' ? (
        <View style={styles.detail}>
          <View style={styles.suggestions}>
              {officeAddress ? (
                <TouchableOpacity
                  style={[styles.suggestion, trimmedLocation === officeAddress && styles.suggestionActive]}
                  onPress={() => onLocationChange(officeAddress)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.suggestionText} numberOfLines={1}>🏢 {t('appointments.meeting_my_office')}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.suggestion, styles.suggestionAdd]} onPress={startEditOffice} activeOpacity={0.75}>
                  <Text style={[styles.suggestionText, { color: colors.primary }]} numberOfLines={1}>+ 🏢 {t('appointments.meeting_add_office')}</Text>
                </TouchableOpacity>
              )}
              {clientAddress ? (
                <TouchableOpacity
                  style={[styles.suggestion, trimmedLocation === clientAddress && styles.suggestionActive]}
                  onPress={() => onLocationChange(clientAddress)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.suggestionText} numberOfLines={1}>
                    🏠 {t('appointments.meeting_at_client', { name: clientFirstName || t('appointments.meeting_client_fallback') })}
                  </Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.suggestion, !!trimmedLocation && trimmedLocation !== officeAddress && trimmedLocation !== clientAddress && styles.suggestionActive]}
                onPress={chooseOtherAddress}
                activeOpacity={0.75}
              >
                <Text style={styles.suggestionText} numberOfLines={1}>✏️ {t('appointments.meeting_other_address')}</Text>
              </TouchableOpacity>
          </View>

          {editingOffice ? (
            <View style={styles.officeBox}>
              <Text style={styles.officeLabel}>🏢 {t('appointments.meeting_office_label')}</Text>
              <TextInput
                style={styles.input}
                value={officeDraft}
                onChangeText={setOfficeDraft}
                placeholder={t('appointments.meeting_office_placeholder')}
                placeholderTextColor={colors.textTertiary}
                autoFocus
                onSubmitEditing={saveOffice}
                accessibilityLabel={t('appointments.meeting_office_label')}
              />
              <View style={styles.officeBtns}>
                <TouchableOpacity onPress={() => setEditingOffice(false)} activeOpacity={0.7}>
                  <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, !officeDraft.trim() && { opacity: 0.5 }]} onPress={saveOffice} disabled={!officeDraft.trim()} activeOpacity={0.85}>
                  <Text style={styles.saveBtnText}>{t('common.save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <TextInput
            ref={addressRef}
            style={styles.input}
            value={location}
            onChangeText={onLocationChange}
            placeholder={t('appointments.meeting_address_placeholder')}
            placeholderTextColor={colors.textTertiary}
            accessibilityLabel={t('appointments.meeting_address_placeholder')}
          />
          {!editingOffice && officeAddress && trimmedLocation === officeAddress ? (
            <TouchableOpacity onPress={startEditOffice} activeOpacity={0.7}>
              <Text style={styles.link}>{t('appointments.meeting_edit_office')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {mode === 'video' ? (
        <View style={styles.detail}>
          <TextInput
            style={styles.input}
            value={meetingUrl}
            onChangeText={onMeetingUrlChange}
            placeholder={t('appointments.meeting_url_placeholder')}
            placeholderTextColor={colors.textTertiary}
            keyboardType="url"
            autoCapitalize="none"
            accessibilityLabel={t('appointments.meeting_url_placeholder')}
          />
          {trimmedUrl && trimmedUrl !== defaultMeetingUrl ? (
            <TouchableOpacity onPress={() => onSaveDefaultMeetingUrl(trimmedUrl)} activeOpacity={0.7}>
              <Text style={styles.link}>{t('appointments.meeting_save_url')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {mode === 'phone' || mode === 'whatsapp' ? (
        <Text style={[styles.hint, !clientPhone && { color: colors.warning }]}>
          {clientPhone
            ? t('appointments.meeting_phone_hint', { phone: clientPhone })
            : t('appointments.meeting_phone_missing')}
        </Text>
      ) : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: 8 },
    label: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    chipText: { fontSize: 13.5, fontFamily: fonts.medium, color: colors.textSecondary },
    chipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    detail: { gap: 8 },
    suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    suggestion: { maxWidth: 260, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    suggestionAdd: { borderStyle: 'dashed', borderColor: colors.primary, backgroundColor: colors.card },
    officeBox: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    officeLabel: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.text },
    officeBtns: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 14 },
    cancelText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
    saveBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primaryAction },
    saveBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onPrimary },
    suggestionActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    suggestionText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.text },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontFamily: fonts.body, fontSize: 14, color: colors.text, backgroundColor: colors.bg },
    link: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.primary },
    hint: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
  })
}
