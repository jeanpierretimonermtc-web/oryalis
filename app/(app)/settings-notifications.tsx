import { useEffect, useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, Platform, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  loadNotificationPrefs, saveNotificationPrefs,
  DEFAULT_NOTIFICATION_PREFS, DIGEST_HOUR_OPTIONS, APPOINTMENT_LEAD_OPTIONS,
  type NotificationPrefs,
} from '@/features/notifications/notificationPrefs'
import { hasNotificationPermission, requestPermissions } from '@/features/notifications/notificationService'
import { refreshScheduledNotifications } from '@/features/notifications/useNotifications'

function leadLabel(minutes: number, t: (k: string, o?: Record<string, unknown>) => string): string {
  return minutes >= 60
    ? t('settings.notif_lead_hours', { count: minutes / 60 })
    : t('settings.notif_lead_minutes', { count: minutes })
}

export default function NotificationSettingsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const isWeb = Platform.OS === 'web'

  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS)
  const [loading, setLoading] = useState(true)
  const [permitted, setPermitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      setPrefs(await loadNotificationPrefs())
      setPermitted(await hasNotificationPermission())
      setLoading(false)
    })()
  }, [])

  function update(patch: Partial<NotificationPrefs>) {
    setPrefs(p => ({ ...p, ...patch }))
    setSaved(false)
  }

  async function handleAllow() {
    setErrorMsg(null)
    const ok = await requestPermissions()
    setPermitted(ok)
    if (!ok) setErrorMsg(t('settings.notif_permission_denied'))
  }

  async function handleSave() {
    setSaving(true)
    setErrorMsg(null)
    try {
      await saveNotificationPrefs(prefs)
      // Sur mobile, application immédiate ; sur le web, le téléphone les appliquera à sa
      // prochaine ouverture (refreshScheduledNotifications est sans effet sur le web).
      if (session) await refreshScheduledNotifications(session.user.id, true)
      setSaved(true)
    } catch (e) {
      console.error('[settings-notifications.save]', e)
      setErrorMsg(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.section_notifications'))} />
      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {isWeb && (
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>{t('settings.notif_web_info')}</Text>
            </View>
          )}
            <>
              {!isWeb && !permitted && (
                <View style={styles.permissionCard}>
                  <Text style={styles.infoText}>{t('settings.notif_permission_needed')}</Text>
                  <Button label={t('settings.notif_allow')} onPress={handleAllow} />
                </View>
              )}

              <View style={styles.card}>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{t('settings.notif_digest_title')}</Text>
                    <Text style={styles.rowDesc}>{t('settings.notif_digest_desc')}</Text>
                  </View>
                  <Switch value={prefs.digestEnabled} onValueChange={v => update({ digestEnabled: v })} trackColor={{ true: colors.primary }} />
                </View>
                {prefs.digestEnabled && (
                  <>
                    <Text style={styles.label}>{t('settings.notif_digest_hour').toUpperCase()}</Text>
                    <View style={styles.chipRow}>
                      {DIGEST_HOUR_OPTIONS.map(h => {
                        const active = prefs.digestHour === h
                        return (
                          <TouchableOpacity key={h} style={[styles.chip, active && styles.chipActive]} onPress={() => update({ digestHour: h })} activeOpacity={0.75}>
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{`${String(h).padStart(2, '0')}:00`}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </>
                )}
              </View>

              <View style={styles.card}>
                <View style={styles.switchRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{t('settings.notif_appointments_title')}</Text>
                    <Text style={styles.rowDesc}>{t('settings.notif_appointments_desc')}</Text>
                  </View>
                  <Switch value={prefs.appointmentRemindersEnabled} onValueChange={v => update({ appointmentRemindersEnabled: v })} trackColor={{ true: colors.primary }} />
                </View>
                {prefs.appointmentRemindersEnabled && (
                  <>
                    <Text style={styles.label}>{t('settings.notif_appointments_lead').toUpperCase()}</Text>
                    <View style={styles.chipRow}>
                      {APPOINTMENT_LEAD_OPTIONS.map(m => {
                        const active = prefs.appointmentLeadMinutes === m
                        return (
                          <TouchableOpacity key={m} style={[styles.chip, active && styles.chipActive]} onPress={() => update({ appointmentLeadMinutes: m })} activeOpacity={0.75}>
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{leadLabel(m, t)}</Text>
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </>
                )}
              </View>

              <Text style={styles.privacy}>{t('settings.notif_privacy')}</Text>
              {!isWeb && <Text style={styles.privacy}>{t('settings.notif_how_it_works')}</Text>}

              {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
              <Button label={saved ? `✓  ${t('settings.saved')}` : t('settings.save')} onPress={handleSave} loading={saving} />
            </>
        </ScrollView>
      )}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, gap: 14, maxWidth: 720, alignSelf: 'center', width: '100%', paddingBottom: 40 },
    card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12 },
    permissionCard: { backgroundColor: colors.warningLight, borderRadius: 16, padding: 16, gap: 12 },
    infoCard: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 },
    infoText: { fontSize: 14, fontFamily: fonts.body, color: colors.text, lineHeight: 20 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    rowDesc: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
    label: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 0.6 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
    chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
    chipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    privacy: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 17 },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  })
}
