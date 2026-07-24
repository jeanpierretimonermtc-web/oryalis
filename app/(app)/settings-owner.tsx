import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Stack } from 'expo-router'
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
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [role, setRole] = useState<'owner' | 'support' | null | undefined>(undefined)

  useEffect(() => { getMyAppRole().then(setRole).catch(() => setRole(null)) }, [])
  if (role === undefined) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
  if (role !== 'owner') return <View style={styles.center}><Text style={styles.title}>Accès owner requis</Text></View>

  return (
    <>
      <Stack.Screen options={{ title: 'Administration & sécurité' }} />
      <MfaGate><OwnerConsole /></MfaGate>
    </>
  )
}

function OwnerConsole() {
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
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null)

  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      if (tab === 'users') setUsers(await listOwnerUsers(search))
      if (tab === 'audit') setAudit(await listAdminAudit())
      if (tab === 'alerts') setAlerts(await listSecurityNotifications())
      if (tab === 'support') setSupport(await listOwnerSupportAccessRequests())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Chargement impossible.')
    } finally { setBusy(false) }
  }, [tab, search])

  useEffect(() => { void load() }, [tab])

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('')
    try { await action(); Alert.alert('Terminé', message); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Opération impossible.') }
    finally { setBusy(false) }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Console owner</Text>
      <Text style={styles.subtitle}>Toutes les actions sont protégées par MFA et inscrites dans le journal d’audit.</Text>
      <View style={styles.tabs}>
        {(['users', 'audit', 'alerts', 'support'] as Tab[]).map(value => (
          <TouchableOpacity key={value} onPress={() => setTab(value)} style={[styles.tab, tab === value && styles.tabActive]}>
            <Text style={[styles.tabText, tab === value && styles.tabTextActive]}>
              {{ users: 'Utilisateurs', audit: 'Audit', alerts: 'Alertes', support: 'Support' }[value]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {tab === 'users' ? (
        <View style={styles.section}>
          <Input placeholder="Nom ou e-mail" value={search} onChangeText={setSearch} onSubmitEditing={load} />
          <Input label="Motif journalisé" value={reason} onChangeText={setReason} />
          <Button label="Rechercher" onPress={load} loading={busy} />
          {users.map(user => (
            <Card key={user.user_id} style={styles.card}>
              <Text style={styles.cardTitle}>{user.full_name || user.email}</Text>
              <Text style={styles.meta}>{user.email} · rôle : {user.app_role ?? 'utilisateur'}</Text>
              <Text style={styles.meta}>Offre : {user.plan} · {user.subscription_status ?? 'sans abonnement'} · fin : {formatDate(user.subscription_period_end)}</Text>
              <View style={styles.actions}>
                <Button size="sm" label="Accès 1 mois" onPress={() => run(() => grantManualAdvisorAccess(user.user_id, { lifetime: false, durationMonths: 1, reason }), 'Accès accordé.')} />
                <Button size="sm" variant="secondary" label="Prolonger +1 mois" onPress={() => run(() => extendManualAdvisorAccess(user.user_id, 1, reason), 'Accès prolongé.')} />
                <Button size="sm" variant="secondary" label="Accès à vie" onPress={() => run(() => grantManualAdvisorAccess(user.user_id, { lifetime: true, reason }), 'Accès à vie accordé.')} />
                <Button size="sm" variant="danger" label="Révoquer accès" onPress={() => run(() => revokeManualAdvisorAccess(user.user_id, reason), 'Accès révoqué.')} />
              </View>
              <View style={styles.actions}>
                <Button size="sm" variant="secondary" label="Rôle support" onPress={() => run(() => setAppRole(user.user_id, 'support', reason), 'Rôle support accordé.')} />
                <Button size="sm" variant="secondary" label="Rôle owner" onPress={() => run(() => setAppRole(user.user_id, 'owner', reason), 'Rôle owner accordé.')} />
                <Button size="sm" variant="danger" label="Retirer le rôle" onPress={() => run(() => removeAppRole(user.user_id, reason), 'Rôle retiré.')} />
              </View>
              <View style={styles.actions}>
                <Button size="sm" variant="ghost" label="Demander diagnostic (30 min)" onPress={() => run(() => requestSupportAccess(user.user_id, 'account_diagnostics', reason, 30), 'Demande envoyée à l’utilisateur.')} />
                <Button size="sm" variant="ghost" label="Demander lecture CRM (30 min)" onPress={() => run(() => requestSupportAccess(user.user_id, 'crm_read', reason, 30), 'Demande envoyée à l’utilisateur.')} />
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      {tab === 'audit' ? audit.map(item => (
        <Card key={item.id} style={styles.card}><Text style={styles.cardTitle}>{item.action}</Text><Text style={styles.meta}>{formatDate(item.created_at)} · cible : {item.target_user_id ?? '—'}</Text><Text style={styles.json}>{JSON.stringify(item.details)}</Text></Card>
      )) : null}

      {tab === 'alerts' ? (
        <View style={styles.section}>
          <Button label="Tout marquer comme lu" variant="secondary" onPress={() => run(() => markSecurityNotificationsRead(), 'Alertes marquées comme lues.')} />
          {alerts.map(item => <Card key={item.id} style={[styles.card, !item.read_at && styles.unread]}><Text style={styles.cardTitle}>{item.title}</Text><Text style={styles.meta}>{item.severity} · {formatDate(item.created_at)}</Text><Text style={styles.body}>{item.body}</Text></Card>)}
        </View>
      ) : null}

      {tab === 'support' ? (
        <View style={styles.section}>
          {support.map(item => (
            <Card key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{item.user_email} · {item.effective_status}</Text>
              <Text style={styles.meta}>{item.scope} · {item.requested_duration_minutes} min · expire : {formatDate(item.expires_at)}</Text>
              <Text style={styles.body}>{item.reason}</Text>
              {item.effective_status === 'approved' ? <Button size="sm" label="Consulter les données autorisées" onPress={async () => { try { setSnapshot(await getSupportSnapshot(item.id)) } catch (e) { setError(e instanceof Error ? e.message : 'Accès refusé.') } }} /> : null}
            </Card>
          ))}
          {snapshot ? <Card style={styles.card}><Text style={styles.cardTitle}>Aperçu consenti</Text><Text selectable style={styles.json}>{JSON.stringify(snapshot, null, 2)}</Text><Button size="sm" variant="secondary" label="Fermer" onPress={() => setSnapshot(null)} /></Card> : null}
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
    unread: { borderColor: colors.warning, borderWidth: 2 },
    json: { fontSize: 11, lineHeight: 16, fontFamily: fonts.body, color: colors.textSecondary },
  })
}
