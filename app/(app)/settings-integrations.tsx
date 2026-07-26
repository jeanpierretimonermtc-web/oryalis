import { useState, useEffect, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useGoogleCalendar } from '@/features/appointments/useGoogleCalendar'
import { getCatalogs } from '@/features/catalogs/catalogService'
import { useCatalogPrefs } from '@/features/catalogs/CatalogPrefsProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import type { Catalog } from '@/shared/lib/types'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'

export default function IntegrationsSettingsScreen() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const { isConfigured: gcConfigured, isConnected: gcConnected, syncing: gcSyncing, syncResult: gcResult, error: gcError, connect: gcConnect, disconnect: gcDisconnect, syncAll: gcSync } = useGoogleCalendar()
  const { activeSlugs, setActiveSlugs } = useCatalogPrefs()

  const [catalogs, setCatalogs] = useState<Catalog[]>([])

  useEffect(() => {
    if (session?.user.id) getCatalogs(session.user.id).then(all => setCatalogs(all.filter(c => c.type === 'official'))).catch(console.error)
  }, [session?.user.id])

  function isCatalogActive(slug: string | null) {
    if (!slug) return false
    return !activeSlugs || activeSlugs.includes(slug)
  }

  function toggleCatalog(slug: string) {
    const all = catalogs.map(c => c.slug!).filter(Boolean)
    let next: string[] | null
    if (!activeSlugs) { next = all.filter(s => s !== slug); if (!next.length) return }
    else if (activeSlugs.includes(slug)) { next = activeSlugs.filter(s => s !== slug); if (!next.length) return }
    else { next = [...activeSlugs, slug]; if (all.every(s => next!.includes(s))) next = null }
    setActiveSlugs(next)
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.nav_integrations'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Google Agenda ─────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>GOOGLE AGENDA</Text>
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: gcConnected ? colors.success : colors.textTertiary }]} />
            <View style={styles.statusInfo}>
              <Text style={styles.statusTitle}>{t('settings.sync_google')}</Text>
              <Text style={styles.statusDesc}>{t('settings.sync_google_desc')}</Text>
              {!gcConfigured && <Text style={[styles.statusDesc, { color: colors.warning, marginTop: 4 }]}>{t('settings.sync_google_not_configured')}</Text>}
              {gcError ? <Text style={[styles.statusDesc, { color: colors.danger, marginTop: 4 }]}>{gcError}</Text> : null}
              {gcResult ? <Text style={[styles.statusDesc, { color: colors.success, marginTop: 4 }]}>✓ {t('settings.sync_google_result', { pushed: gcResult.pushed, pulled: gcResult.pulled })}</Text> : null}
            </View>
            <View style={[styles.connBadge, { backgroundColor: gcConnected ? colors.successLight : colors.bgDim }]}>
              <Text style={[styles.connBadgeText, { color: gcConnected ? colors.success : colors.textTertiary }]}>
                {gcConnected ? t('settings.connected') : t('settings.not_connected')}
              </Text>
            </View>
          </View>

          {!gcConnected ? (
            <TouchableOpacity style={[styles.btn, !gcConfigured && { opacity: 0.5 }]} onPress={gcConnect} disabled={!gcConfigured} activeOpacity={0.85}>
              <Text style={styles.btnText}>{t('settings.sync_google_connect')}</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ gap: 10 }}>
              <TouchableOpacity style={[styles.btn, gcSyncing && { opacity: 0.6 }]} onPress={gcSync} disabled={gcSyncing} activeOpacity={0.85}>
                {gcSyncing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>{t('settings.sync_google_sync')}</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={gcDisconnect} activeOpacity={0.75} style={styles.dangerRow}>
                <Text style={styles.dangerText}>{t('settings.sync_google_disconnect')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Catalogues ────────────────────────────────────────────────────── */}
        {catalogs.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>{t('settings.section_catalogs').toUpperCase()}</Text>
            <View style={styles.card}>
              {catalogs.map((cat, idx) => (
                <View key={cat.id} style={[styles.catRow, idx > 0 && styles.catRowBorder]}>
                  <View style={[styles.catIcon, { backgroundColor: cat.color + '20' }]}><Text style={{ fontSize: 18 }}>{cat.icon}</Text></View>
                  <Text style={styles.catName}>{cat.name}</Text>
                  <Switch value={isCatalogActive(cat.slug)} onValueChange={(_v: boolean): void => { if (cat.slug) toggleCatalog(cat.slug) }} trackColor={{ true: cat.color, false: colors.border }} thumbColor={colors.card} />
                </View>
              ))}
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 10, maxWidth: 720, alignSelf: 'center', width: '100%' },
  sectionLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 0.6, paddingHorizontal: 2, paddingTop: 6 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.border },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, flexShrink: 0 },
  statusInfo: { flex: 1 },
  statusTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  statusDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17, marginTop: 2 },
  connBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, flexShrink: 0 },
  connBadgeText: { fontSize: 11, fontFamily: fonts.bold },
  btn: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  btnText: { fontSize: 14, fontFamily: fonts.semibold, color: '#fff' },
  dangerRow: { alignItems: 'center' },
  dangerText: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  catRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 12, marginTop: 8 },
  catIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  catName: { flex: 1, fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  })
}
