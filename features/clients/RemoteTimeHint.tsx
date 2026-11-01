import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { remoteTime, timeZoneCity } from './timezones'

interface Props {
  start: Date
  end?: Date
  contactTz: string | null | undefined
  contactName: string
}

// CLIENT-TZ-1 — "🌍 03:00 → 04:00 chez Marie (Montreal)" ; rien si même fuseau que moi.
export function RemoteTimeHint({ start, end, contactTz, contactName }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const startRemote = remoteTime(start, contactTz)
  if (!startRemote || !contactTz) return null
  const endRemote = end ? remoteTime(end, contactTz) : null
  const dayNote = startRemote.dayShift > 0 ? t('clients.tz_next_day') : startRemote.dayShift < 0 ? t('clients.tz_previous_day') : ''

  return (
    <View style={[styles.box, startRemote.unsocial && styles.boxWarn]}>
      <Text style={styles.text}>
        🌍 {t('clients.tz_their_time', {
          time: endRemote ? `${startRemote.time} → ${endRemote.time}` : startRemote.time,
          name: contactName,
          city: timeZoneCity(contactTz),
        })}{dayNote ? ` · ${dayNote}` : ''}
      </Text>
      {startRemote.unsocial ? <Text style={styles.warn}>{t('clients.tz_unsocial')}</Text> : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    box: { gap: 2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    boxWarn: { backgroundColor: colors.warningLight, borderColor: colors.warning },
    text: { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    warn: { fontSize: 12, fontFamily: fonts.medium, color: colors.warning },
  })
}
