import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack, useFocusEffect } from 'expo-router'
import { listMySupportAccessRequests, respondToSupportAccessRequest, revokeMySupportAccess, type SupportAccessRequest } from '@/features/admin/adminService'
import { Button } from '@/shared/components/ui/Button'
import { Card } from '@/shared/components/ui/Card'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

function date(value?: string | null) { return value ? new Date(value).toLocaleString('fr-FR') : '—' }

export default function SupportAccessSettingsScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [requests, setRequests] = useState<SupportAccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRequests(await listMySupportAccessRequests()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Chargement impossible.') }
    finally { setLoading(false) }
  }, [])
  useFocusEffect(useCallback(() => { void load() }, [load]))
  const act = async (action: () => Promise<unknown>) => {
    try { await action(); await load() } catch (e) { Alert.alert('Erreur', e instanceof Error ? e.message : 'Opération impossible.') }
  }
  return (
    <>
      <Stack.Screen options={{ title: 'Confidentialité & assistance' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Accès temporaire du support</Text>
        <Text style={styles.info}>Le support ne peut jamais consulter vos données privées sans votre accord. Chaque demande précise le motif, le périmètre et la durée ; vous pouvez la refuser ou la révoquer immédiatement. Chaque consultation est journalisée.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && requests.length === 0 ? <Card><Text style={styles.body}>Aucune demande d’accès.</Text></Card> : null}
        {requests.map(request => (
          <Card key={request.id} style={styles.card}>
            <Text style={styles.cardTitle}>{request.requester_email ?? 'Support Oryalis'} · {request.effective_status}</Text>
            <Text style={styles.body}>{request.reason}</Text>
            <Text style={styles.meta}>Périmètre : {request.scope === 'crm_read' ? 'lecture CRM' : 'diagnostic du compte'}</Text>
            <Text style={styles.meta}>Durée : {request.requested_duration_minutes} min · demandé le {date(request.requested_at)}</Text>
            {request.expires_at ? <Text style={styles.meta}>Expiration : {date(request.expires_at)}</Text> : null}
            {request.effective_status === 'pending' ? <View style={styles.actions}><Button size="sm" label="Autoriser" onPress={() => act(() => respondToSupportAccessRequest(request.id, true))} /><Button size="sm" variant="danger" label="Refuser" onPress={() => act(() => respondToSupportAccessRequest(request.id, false))} /></View> : null}
            {request.effective_status === 'approved' ? <Button size="sm" variant="danger" label="Révoquer maintenant" onPress={() => act(() => revokeMySupportAccess(request.id))} /> : null}
          </Card>
        ))}
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface }, content: { padding: 20, gap: 14, maxWidth: 760, width: '100%', alignSelf: 'center' },
  title: { fontSize: 25, fontFamily: fonts.bold, color: colors.text }, info: { fontSize: 14, lineHeight: 21, fontFamily: fonts.body, color: colors.textSecondary },
  card: { gap: 9 }, cardTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.text }, body: { fontSize: 14, fontFamily: fonts.body, color: colors.text },
  meta: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary }, actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, error: { color: colors.danger },
}) }
