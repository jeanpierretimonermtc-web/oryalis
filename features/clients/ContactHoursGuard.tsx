import { useMemo, useState } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate, formatTime } from '@/shared/lib/dateFormat'
import { createFollowup } from '@/features/followups/followupService'
import { remoteTime, timeZoneCity, nextContactLocalHour } from './timezones'

const CONTACT_MORNING_HOUR = 9

export interface GuardedAction {
  // Libellé de l'action ("Appeler", "WhatsApp"…), repris dans le bouton "… quand même".
  label: string
  run: () => void
}

interface Props {
  action: GuardedAction | null
  contact: { id: string; first_name: string | null; full_name: string; timezone: string | null }
  userId: string
  locale: string
  onClose: () => void
  onFollowupCreated: () => void
}

// CLIENT-TZ-1 (point 1) — avant d'appeler / écrire à un contact chez qui il fait nuit :
// prévenir, et proposer une relance à 9 h chez lui au lieu de déranger.
export function ContactHoursGuard({ action, contact, userId, locale, onClose, onFollowupCreated }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const now = new Date()
  const remote = contact.timezone ? remoteTime(now, contact.timezone) : null
  const name = contact.first_name || contact.full_name
  const morning = contact.timezone ? nextContactLocalHour(contact.timezone, CONTACT_MORNING_HOUR, now) : null

  async function scheduleFollowup() {
    if (!morning || !action) return
    setSaving(true)
    setErrorMsg('')
    try {
      await createFollowup(userId, {
        client_id: contact.id,
        title: t('clients.tz_followup_title', { action: action.label, name }),
        content: t('clients.tz_followup_content', { city: timeZoneCity(contact.timezone!) }),
        due_date: `${morning.getFullYear()}-${String(morning.getMonth() + 1).padStart(2, '0')}-${String(morning.getDate()).padStart(2, '0')}`,
        done: false,
        action_type: null,
      })
      onFollowupCreated()
      onClose()
    } catch (e) {
      console.error('[contactHoursGuard.followup]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={!!action} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.icon}>🌙</Text>
          <Text style={styles.title}>
            {t('clients.tz_guard_title', { time: remote?.time ?? '', name, city: contact.timezone ? timeZoneCity(contact.timezone) : '' })}
          </Text>
          <Text style={styles.text}>{t('clients.tz_guard_text')}</Text>
          {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}

          {morning ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={scheduleFollowup} disabled={saving} activeOpacity={0.85}>
              {saving
                ? <ActivityIndicator size="small" color={colors.onPrimary} />
                : <Text style={styles.primaryBtnText}>
                    ⏰ {t('clients.tz_guard_schedule', { date: formatDate(morning, locale), time: formatTime(morning) })}
                  </Text>}
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => { const run = action?.run; onClose(); run?.() }}
            disabled={saving}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryBtnText}>{t('clients.tz_guard_anyway', { action: action?.label ?? '' })}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} disabled={saving} activeOpacity={0.7}>
            <Text style={styles.cancel}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 420, backgroundColor: colors.card, borderRadius: 18, padding: 22, gap: 12, alignItems: 'stretch' },
    icon: { fontSize: 30, textAlign: 'center' },
    title: { fontSize: 16, fontFamily: fonts.semibold, color: colors.text, textAlign: 'center' },
    text: { fontSize: 13.5, lineHeight: 19, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger, textAlign: 'center' },
    primaryBtn: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center', backgroundColor: colors.primaryAction },
    primaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onPrimary, textAlign: 'center' },
    secondaryBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
    secondaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    cancel: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, textAlign: 'center', paddingVertical: 4 },
  })
}
