import { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native'
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
  const { isConfigured, isConnected, syncing, syncResult, error, connect, disconnect, syncAll } = useGoogleCalendar()

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

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Comment ça marche ?</Text>
          <Text style={styles.infoText}>→ Oryalis → Google : vos rendez-vous Oryalis apparaissent dans Google Agenda.{'\n'}→ Google → Oryalis : les événements Google des 30 prochains jours sont importés comme rendez-vous.</Text>
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
  statusDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17, marginTop: 3 },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, flexShrink: 0 },
  badgeText: { fontSize: 11, fontFamily: fonts.bold },
  btn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },
  dangerRow: { alignItems: 'center', paddingVertical: 4 },
  dangerText: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  infoBox: { backgroundColor: colors.bgDim, borderRadius: 12, padding: 14, gap: 6 },
  infoTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  infoText: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19 },
  })
}
