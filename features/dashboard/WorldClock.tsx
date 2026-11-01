import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchContactTimeZones } from '@/features/clients/clientService'
import type { ContactTimeZone } from '@/features/clients/clientService'
import { deviceTimeZone, remoteTime, timeZoneCity } from '@/features/clients/timezones'
import { useClockStyle } from './clockPreference'
import { AnalogClock } from './AnalogClock'

const MAX_ZONES = 4

// WORLD-CLOCK-1 — mon heure + l'heure chez mes contacts à l'étranger (un fuseau par carte,
// prénoms regroupés). Les fuseaux des contacts vus aujourd'hui passent en premier.
export function WorldClock({ priorityClientIds = [] }: { priorityClientIds?: string[] }) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const clockStyle = useClockStyle()
  const [now, setNow] = useState(() => new Date())
  const [contacts, setContacts] = useState<ContactTimeZone[]>([])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!session) return
    fetchContactTimeZones(session.user.id).then(setContacts).catch(e => console.error('[worldClock]', e))
  }, [session])

  const myTz = deviceTimeZone()
  const zones = useMemo(() => {
    const priority = new Set(priorityClientIds)
    const byTz = new Map<string, { tz: string; names: string[]; priority: boolean }>()
    for (const c of contacts) {
      if (!c.timezone || c.timezone === myTz) continue
      const entry = byTz.get(c.timezone) ?? { tz: c.timezone, names: [], priority: false }
      entry.names.push(c.first_name || c.full_name.split(' ')[0])
      entry.priority = entry.priority || priority.has(c.id)
      byTz.set(c.timezone, entry)
    }
    return [...byTz.values()]
      .filter(z => remoteTime(now, z.tz) !== null)
      .sort((a, b) => Number(b.priority) - Number(a.priority) || b.names.length - a.names.length)
      .slice(0, MAX_ZONES)
  }, [contacts, myTz, priorityClientIds, now])

  if (clockStyle === 'hidden') return null

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const myTime = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const analog = clockStyle === 'analog'

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <View style={[styles.card, styles.myCard]}>
          {analog ? <AnalogClock hours={now.getHours()} minutes={now.getMinutes()} size={52} /> : null}
          <View>
            <Text style={styles.myTime}>{myTime}</Text>
            <Text style={styles.cardSub}>{t('dashboard.clock_me', { city: timeZoneCity(myTz) })}</Text>
          </View>
        </View>
        {zones.map(z => {
          const remote = remoteTime(now, z.tz)!
          const [h, m] = remote.time.split(':').map(Number)
          const names = z.names.length > 2 ? `${z.names.slice(0, 2).join(', ')} +${z.names.length - 2}` : z.names.join(', ')
          return (
            <View key={z.tz} style={[styles.card, remote.unsocial && styles.cardNight]}>
              {analog ? <AnalogClock hours={h} minutes={m} size={40} night={remote.unsocial} /> : null}
              <View>
                <Text style={styles.zoneTime}>
                  {remote.unsocial ? '🌙' : '🕒'} {remote.time}
                  {remote.dayShift > 0 ? <Text style={styles.cardSub}> +1j</Text> : remote.dayShift < 0 ? <Text style={styles.cardSub}> −1j</Text> : null}
                </Text>
                <Text style={styles.zoneCity} numberOfLines={1}>{timeZoneCity(z.tz)}</Text>
                <Text style={styles.cardSub} numberOfLines={1}>{names}</Text>
              </View>
            </View>
          )
        })}
        {zones.length === 0 ? (
          <TouchableOpacity style={[styles.card, styles.hintCard]} onPress={() => router.push('/(app)/clients' as any)} activeOpacity={0.75}>
            <Text style={styles.cardSub}>🌍 {t('dashboard.clock_hint')}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginTop: -8 },
    row: { gap: 10, paddingVertical: 2 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, minWidth: 130 },
    myCard: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    cardNight: { borderColor: colors.warning, backgroundColor: colors.warningLight },
    hintCard: { maxWidth: 260 },
    myTime: { fontSize: 24, fontFamily: fonts.display, color: colors.text, letterSpacing: -0.5 },
    zoneTime: { fontSize: 17, fontFamily: fonts.semibold, color: colors.text },
    zoneCity: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.text },
    cardSub: { fontSize: 11.5, fontFamily: fonts.body, color: colors.textSecondary },
  })
}
