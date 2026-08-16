import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import {
  extendManualAdvisorAccess,
  getMyAppRole,
  getSupportSnapshot,
  grantManualAdvisorAccess,
  listAdminAudit,
  listOwnerSupportAccessRequests,
  listOwnerUsers,
  listSecurityNotifications,
  markSecurityNotificationsRead,
  removeAppRole,
  requestSupportAccess,
  revokeManualAdvisorAccess,
  setAppRole,
  type AdminAuditEntry,
  type OwnerUserSummary,
  type SecurityNotification,
  type SupportAccessRequest,
} from '@/features/admin/adminService'
import { MfaGate } from '@/features/admin/MfaGate'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { Input } from '@/shared/components/ui/Input'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

type Tab = 'users' | 'audit' | 'alerts' | 'support'

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
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<OwnerUserSummary[]>([])
  const [audit, setAudit] = useState<AdminAuditEntry[]>([])
  const [alerts, setAlerts] = useState<SecurityNotification[]>([])
  const [support, setSupport] = useState<SupportAccessRequest[]>([])
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('Administration Oryalis')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      if (tab === 'users') setUsers(await listOwnerUsers(search))
      if (tab === 'audit') setAudit(await listAdminAudit())
      if (tab === 'alerts') setAlerts(await listSecurityNotifications())
      if (tab === 'support') setSupport(await listOwnerSupportAccessRequests())
    } catch (e) {
      setError(e instanceof Error ? e.message : t('owner.load_error'))
    } finally { setBusy(false) }
  }, [tab, search])

  useEffect(() => { void load() }, [tab])

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(''); setNotice('')
    try { await action(); setNotice(message); await load() }
    catch (e) { setError(e instanceof Error ? e.message : t('owner.action_error')) }
    finally { setBusy(false) }
  }

  const TAB_LABELS: Record<Tab, string> = {
    users: t('owner.tab_users'), audit: t('owner.tab_audit'), alerts: t('owner.tab_alerts'), support: t('owner.tab_support'),
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('owner.console_title')}</Text>
      <Text style={styles.subtitle}>{t('owner.console_subtitle')}</Text>
      <View style={styles.tabs}>
        {(['users', 'audit', 'alerts', 'support'] as Tab[]).map(value => (
          <TouchableOpacity key={value} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.tabActive]}>
            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
              {TAB_LABELS[value]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {tab === 'users' ? (
        <View style={styles.section}>
          <Input placeholder={t('owner.search_placeholder')} value={search} onChangeText={setSearch} onSubmitEditing={load} />
          <Input label={t('owner.reason_label')} value={reason} onChangeText={setReason} />
          <Button label={t('owner.search')} onPress={load} loading={busy} />
          {users.map(user => (
            <Card key={user.user_id} style={styles.card}>
              <Text style={styles.cardTitle}>{user.full_name || user.email}</Text>
              <Text style={styles.meta}>{user.email} · {t('owner.role_label')} : {user.app_role ?? t('owner.role_default')}</Text>
              <Text style={styles.meta}>{t('owner.plan_label')} : {user.plan} · {user.subscription_status ?? t('owner.no_subscription')} · {t('owner.period_end_label')} : {formatDate(user.subscription_period_end)}</Text>
              <View style={styles.actions}>
                <Button size="sm" label={t('owner.grant_1_month')} onPress={() => run(() => grantManualAdvisorAccess(user.user_id, { lifetime: false, durationMonths: 1, reason }), t('owner.notice_access_granted'))} />
                <Button size="sm" variant="secondary" label={t('owner.extend_1_month')} onPress={() => run(() => extendManualAdvisorAccess(user.user_id, 1, reason), t('owner.notice_access_extended'))} />
                <Button size="sm" variant="secondary" label={t('owner.grant_lifetime')} onPress={() => run(() => grantManualAdvisorAccess(user.user_id, { lifetime: true, reason }), t('owner.notice_lifetime_granted'))} />
                <Button size="sm" variant="danger" label={t('owner.revoke_access')} onPress={() => run(() => revokeManualAdvisorAccess(user.user_id, reason), t('owner.notice_access_revoked'))} />
              </View>
              <View style={styles.actions}>
                <Button size="sm" variant="secondary" label={t('owner.role_support')} onPress={() => run(() => setAppRole(user.user_id, 'support', reason), t('owner.notice_role_support_granted'))} />
                <Button size="sm" variant="secondary" label={t('owner.role_owner')} onPress={() => run(() => setAppRole(user.user_id, 'owner', reason), t('owner.notice_role_owner_granted'))} />
                <Button size="sm" variant="danger" label={t('owner.remove_role')} onPress={() => run(() => removeAppRole(user.user_id, reason), t('owner.notice_role_removed'))} />
              </View>
              <View style={styles.actions}>
                <Button size="sm" variant="ghost" label={t('owner.request_diagnostics')} onPress={() => run(() => requestSupportAccess(user.user_id, 'account_diagnostics', reason, 30), t('owner.notice_request_sent'))} />
                <Button size="sm" variant="ghost" label={t('owner.request_crm_read')} onPress={() => run(() => requestSupportAccess(user.user_id, 'crm_read', reason, 30), t('owner.notice_request_sent'))} />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {tab === 'audit' ? audit.map(item => (
        <Card key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.action}</Text><Text style={styles.meta}>{formatDate(item.created_at)} · {t('owner.target_label')} : {item.target_user_id ?? '—'}</Text><Text style={styles.json}>{JSON.stringify(item.details)}</Text></Card>
      )) : null}

      {tab === 'alerts' ? (
        <View style={styles.section}>
          <Button label={t('owner.mark_all_read')} variant="secondary" onPress={() => run(() => markSecurityNotificationsRead(), t('owner.notice_alerts_read'))} />
          {alerts.map(item => <Card key={item.id} style={[styles.card, !item.read_at && styles.unread]}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.meta}>{item.severity} · {formatDate(item.created_at)}</Text><Text style={styles.body}>{item.body}</Text></Card>)}
        </View>
      ) : null}

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
      {busy && tab !== 'users' ? <ActivityIndicator color={colors.primary} /> : null}
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
    notice: { color: colors.success, fontFamily: fonts.medium },
    unread: { borderColor: colors.warning, borderWidth: 2 },
    json: { fontSize: 11, lineHeight: 16, fontFamily: fonts.body, color: colors.textSecondary },
  })
}
