import { useMemo } from 'react'
import { View, Text, TouchableOpacity, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useGoogleCalendar } from '@/features/appointments/useGoogleCalendar'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { AdvisorGate } from '@/features/subscriptions/AdvisorGate'

export default function GoogleSettingsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const {
    isConfigured, isConnected, accountEmail, calendars, calendarsLoading, calendarError,
    toggleCalendar, chooseTargetCalendar, syncing, syncResult, error, connect, disconnect, syncAll,
  } = useGoogleCalendar({ withCalendars: true })

  return (
    <>
      <Stack.Screen options={settingsScreenOptions('Google Agenda')} />
      <AdvisorGate feature={t('subscription.features.calendar')}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.statusCard}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? colors.success : colors.textTertiary }]} />
          <View style={styles.statusBody}>
            <Text style={styles.statusTitle}>{t('settings.sync_google')}</Text>
            <Text style={styles.statusDesc}>{t('settings.sync_google_desc')}</Text>
            {isConnected && accountEmail ? <Text style={styles.accountLine} selectable>{t('settings.sync_google_account', { email: accountEmail })}</Text> : null}
            {!isConfigured && <Text style={[styles.statusDesc, { color: colors.warning, marginTop: 6 }]}>{t('settings.sync_google_not_configured')}</Text>}
            {error ? <Text style={[styles.statusDesc, { color: colors.danger, marginTop: 6 }]}>{error}</Text> : null}
            {syncResult ? <Text style={[styles.statusDesc, { color: colors.success, marginTop: 6 }]}>✓ {t('settings.sync_google_result', { pushed: syncResult.pushed, pulled: syncResult.pulled })}</Text> : null}
          </View>
          <View style={[styles.badge, { backgroundColor: isConnected ? colors.successLight : colors.bgDim }]}>
            <Text style={[styles.badgeText, { color: isConnected ? colors.success : colors.textTertiary }]}>
              {isConnected ? t('settings.connected') : t('settings.not_connected')}
            </Text>
          </View>
        </View>

        {!isConnected ? (
          <TouchableOpacity style={[styles.btn, !isConfigured && { opacity: 0.5 }]} onPress={connect} disabled={!isConfigured || syncing} activeOpacity={0.85}>
            <Text style={styles.btnText}>{t('settings.sync_google_connect')}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity style={[styles.btn, syncing && { opacity: 0.6 }]} onPress={syncAll} disabled={syncing} activeOpacity={0.85}>
              {syncing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>{t('settings.sync_google_sync')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={disconnect} activeOpacity={0.75} style={styles.dangerRow}>
              <Text style={styles.dangerText}>{t('settings.sync_google_disconnect')}</Text>
            </TouchableOpacity>
          </>
        )}

        {isConnected && (
          <View style={styles.calendarsCard}>
            <View style={styles.calendarsHeader}>
              <Text style={styles.calendarsTitle}>{t('settings.sync_google_calendars_title')}</Text>
              <Text style={styles.calendarsColumn}>{t('settings.sync_google_calendars_show')}</Text>
              <Text style={styles.calendarsColumn}>{t('settings.sync_google_calendars_receive')}</Text>
            </View>
            {calendarsLoading && calendars.length === 0 ? <ActivityIndicator color={colors.primary} style={styles.calendarsLoader} /> : null}
            {calendars.map(calendar => (
              <View key={calendar.calendar_id} style={styles.calendarRow}>
                <View style={[styles.calendarDot, { backgroundColor: calendar.color ?? colors.textTertiary }]} />
                <View style={styles.calendarName}>
                  <Text style={styles.calendarNameText} numberOfLines={1}>{calendar.name}</Text>
                  {calendar.is_primary ? <Text style={styles.calendarPrimary}>{t('settings.sync_google_calendars_primary')}</Text> : null}
                </View>
                <Pressable
                  style={styles.calendarControl}
                  onPress={() => toggleCalendar(calendar.calendar_id, !calendar.is_visible)}
                  disabled={syncing}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: calendar.is_visible }}
                  accessibilityLabel={`${t('settings.sync_google_calendars_show')} : ${calendar.name}`}
                >
                  <View style={[styles.checkbox, calendar.is_visible && styles.controlOn]}>
                    {calendar.is_visible ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                </Pressable>
                <Pressable
                  style={styles.calendarControl}
                  onPress={() => chooseTargetCalendar(calendar.calendar_id)}
                  disabled={syncing || !calendar.can_write || calendar.is_target}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: calendar.is_target, disabled: !calendar.can_write }}
                  accessibilityLabel={`${t('settings.sync_google_calendars_receive')} : ${calendar.name}`}
                >
                  {calendar.can_write ? (
                    <View style={[styles.radio, calendar.is_target && styles.radioOn]}>
                      {calendar.is_target ? <View style={styles.radioDot} /> : null}
                    </View>
                  ) : (
                    <Text style={styles.readOnly}>—</Text>
                  )}
                </Pressable>
              </View>
            ))}
            {calendarError ? <Text style={styles.calendarsError}>{t('settings.sync_google_calendars_error')}</Text> : null}
            <Text style={styles.calendarsHint}>{t('settings.sync_google_calendars_hint')}</Text>
          </View>
        )}

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>{t('settings.sync_google_how_title')}</Text>
          <Text style={styles.infoText}><Text style={styles.infoStrong}>{t('settings.sync_google_to_google_title')}</Text> {t('settings.sync_google_to_google')}</Text>
          <Text style={styles.infoText}><Text style={styles.infoStrong}>{t('settings.sync_google_from_google_title')}</Text> {t('settings.sync_google_from_google')}</Text>
          <Text style={styles.infoText}><Text style={styles.infoStrong}>{t('settings.sync_google_never_title')}</Text> {t('settings.sync_google_never')}</Text>
          <Text style={styles.infoText}><Text style={styles.infoStrong}>{t('settings.sync_google_when_title')}</Text> {t('settings.sync_google_when')}</Text>
        </View>
        <View style={{ height: 40 }} />
      </ScrollView>
      </AdvisorGate>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14, maxWidth: 720, alignSelf: 'center', width: '100%' },
  statusCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  statusBody: { flex: 1 },
  statusTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  accountLine: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, marginTop: 6 },
  statusDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17, marginTop: 3 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, flexShrink: 0 },
  badgeText: { fontSize: 11, fontFamily: fonts.bold },
  btn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },
  dangerRow: { alignItems: 'center', paddingVertical: 4 },
  dangerText: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  calendarsCard: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 4 },
  calendarsHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  calendarsTitle: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  calendarsColumn: { width: 64, textAlign: 'center', fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary },
  calendarsLoader: { paddingVertical: 12 },
  calendarRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  calendarDot: { width: 12, height: 12, borderRadius: 6, flexShrink: 0 },
  calendarName: { flex: 1, minWidth: 0 },
  calendarNameText: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
  calendarPrimary: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 1 },
  calendarControl: { width: 54, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  controlOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { fontSize: 13, fontFamily: fonts.bold, color: '#fff', lineHeight: 16 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  readOnly: { fontSize: 14, fontFamily: fonts.body, color: colors.textTertiary },
  calendarsError: { fontSize: 12, fontFamily: fonts.body, color: colors.danger, marginTop: 6 },
  calendarsHint: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18, marginTop: 8 },
  infoBox: { backgroundColor: colors.bgDim, borderRadius: 12, padding: 14, gap: 6 },
  infoTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  infoText: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19 },
  infoStrong: { fontFamily: fonts.semibold, color: colors.text },
  })
}
