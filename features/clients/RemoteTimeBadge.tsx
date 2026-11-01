import { useMemo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { remoteTime, timeZoneCity } from './timezones'

interface Props {
  at: Date
  contactTz: string | null | undefined
  // Affiche la ville ("🕒 03:00 Montreal") ; sinon l'heure seule, pour les cartes étroites.
  showCity?: boolean
  size?: 'xs' | 'sm'
}

// CLIENT-TZ-1 — badge "heure chez le contact", lisible d'un coup d'œil : 🕒 de jour,
// 🌙 sur fond orange quand l'heure tombe tôt le matin ou tard le soir chez lui.
export function RemoteTimeBadge({ at, contactTz, showCity = false, size = 'sm' }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const remote = remoteTime(at, contactTz)
  if (!remote || !contactTz) return null
  const day = remote.dayShift > 0 ? ' +1j' : remote.dayShift < 0 ? ' −1j' : ''
  const city = timeZoneCity(contactTz)
  return (
    <View
      style={[styles.badge, size === 'xs' && styles.badgeXs, remote.unsocial && styles.badgeWarn]}
      accessibilityLabel={t('clients.tz_badge_a11y', { time: remote.time, city })}
    >
      <Text style={[styles.text, size === 'xs' && styles.textXs, remote.unsocial && styles.textWarn]} numberOfLines={1}>
        {remote.unsocial ? '🌙' : '🕒'} {remote.time}{day}{showCity ? ` ${city}` : ''}
      </Text>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    badge: { alignSelf: 'flex-start', flexShrink: 1, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.secondaryLight, borderWidth: 1, borderColor: colors.secondary },
    badgeXs: { paddingHorizontal: 4, paddingVertical: 0, borderRadius: 4 },
    badgeWarn: { backgroundColor: colors.warningLight, borderColor: colors.warning },
    text: { fontSize: 11.5, fontFamily: fonts.semibold, color: colors.text },
    textXs: { fontSize: 9.5 },
    textWarn: { color: colors.text },
  })
}
