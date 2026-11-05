import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import {
  getMyAppRole,
  getSupportSnapshot,
  listAdminAudit,
  listOwnerSupportAccessRequests,
  type AdminAuditEntry,
  type SupportAccessRequest,
} from '@/features/admin/adminService'
import { MfaGate } from '@/features/admin/MfaGate'
import { OwnerAlertsPanel } from '@/features/admin/OwnerAlertsPanel'
import { OwnerDashboardPanel } from '@/features/admin/OwnerDashboardPanel'
import { OwnerDeletionsPanel } from '@/features/admin/OwnerDeletionsPanel'
import { OwnerUsersPanel } from '@/features/admin/OwnerUsersPanel'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { Input } from '@/shared/components/ui/Input'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

type Tab = 'dashboard' | 'users' | 'audit' | 'alerts' | 'support' | 'deletions'

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('fr-FR') : '—'
}

export default function OwnerSettingsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [role, setRole] = useState<'owner' | 'support' | null | undefined>(undefined)

  useEffect(() => { getMyAppRole().then(setRole).catch(() => setRole(null)) }, [])
  if (role === undefined) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
  if (role !== 'owner') return <View style={styles.center}><Text style={styles.title}>{t('owner.access_required')}</Text></View>

  return (
    <>
      <Stack.Screen options={{ title: t('owner.title') }} />
      <MfaGate><OwnerConsole /></MfaGate>
    </>
  )
}

function OwnerConsole() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [tab, setTab] = useState<Tab>('dashboard')
  const [audit, setAudit] = useState<AdminAuditEntry[]>([])
  const [support, setSupport] = useState<SupportAccessRequest[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      if (tab === 'audit') setAudit(await listAdminAudit())
      if (tab === 'support') setSupport(await listOwnerSupportAccessRequests())
    } catch (e) {
      setError(e instanceof Error ? e.message : t('owner.load_error'))
    } finally { setBusy(false) }
  }, [tab])

  useEffect(() => { void load() }, [tab])

  const TAB_LABELS: Record<Tab, string> = {
    dashboard: t('owner.tab_dashboard'), users: t('owner.tab_users'), audit: t('owner.tab_audit'), alerts: t('owner.tab_alerts'), support: t('owner.tab_support'), deletions: t('owner.tab_deletions'),
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('owner.console_title')}</Text>
      <Text style={styles.subtitle}>{t('owner.console_subtitle')}</Text>
      <View style={styles.tabs}>
        {(['dashboard', 'users', 'audit', 'alerts', 'support', 'deletions'] as Tab[]).map(value => (
          <TouchableOpacity key={value} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.tabActive]}>
            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
              {TAB_LABELS[value]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {tab === 'dashboard' ? <OwnerDashboardPanel onOpenTab={setTab} /> : null}

      {tab === 'users' ? <OwnerUsersPanel /> : null}

      {tab === 'audit' ? audit.map(item => (
        <Card key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.action}</Text><Text style={styles.meta}>{formatDate(item.created_at)} · {t('owner.target_label')} : {item.target_user_id ?? '—'}</Text><Text style={styles.json}>{JSON.stringify(item.details)}</Text></Card>
      )) : null}

      {tab === 'alerts' ? <OwnerAlertsPanel /> : null}

      {tab === 'deletions' ? <OwnerDeletionsPanel /> : null}

      {tab === 'support' ? (
        <View style={styles.section}>
          {support.map(item => (
            <Card key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{item.user_email} · {item.effective_status}</Text>
              <Text style={styles.meta}>{item.scope} · {item.requested_duration_minutes} min · {formatDate(item.expires_at)}</Text>
              <Text style={styles.body}>{item.reason}</Text>
              {item.effective_status === 'approved' ? <Button size="sm" label={t('owner.view_authorized_data')} onPress={async () => { try { setSnapshot(await getSupportSnapshot(item.id)) } catch (e) { setError(e instanceof Error ? e.message : t('owner.access_denied')) } }} /> : null}
            </Card>
          ))}
          {snapshot ? <Card style={styles.card}><Text style={styles.cardTitle}>{t('owner.snapshot_title')}</Text><Text selectable style={styles.json}>{JSON.stringify(snapshot, null, 2)}</Text><Button size="sm" variant="secondary" label={t('owner.close')} onPress={() => setSnapshot(null)} /></Card> : null}
        </View>
      ) : null}
      {busy && (tab === 'audit' || tab === 'support') ? <ActivityIndicator color={colors.primary} /> : null}
    </ScrollView>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, padding: 20 },
    container: { flex: 1, backgroundColor: colors.surface },
    content: { width: '100%', maxWidth: 1100, alignSelf: 'center', padding: 20, paddingBottom: 60, gap: 14 },
    title: { fontSize: 28, fontFamily: fonts.bold, color: colors.text },
    subtitle: { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary },
    tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tab: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.bgDim },
    tabActive: { backgroundColor: colors.primary },
    tabText: { fontFamily: fonts.semibold, color: colors.textSecondary },
    tabTextActive: { color: colors.textInverse },
    section: { gap: 12 }, card: { gap: 9 },
    cardTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
    meta: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    body: { fontSize: 14, fontFamily: fonts.body, color: colors.text },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    error: { color: colors.danger, fontFamily: fonts.medium },
    json: { fontSize: 11, lineHeight: 16, fontFamily: fonts.body, color: colors.textSecondary },
  })
}
