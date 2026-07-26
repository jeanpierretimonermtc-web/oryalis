import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Stack, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { getArchivedClients, restoreClient } from '@/features/clients/clientService'
import { isContactQuotaError } from '@/features/clients/quotaService'
import { useContactQuota } from '@/features/clients/useContactQuota'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { Client } from '@/shared/lib/types'

export default function ArchivedClientsScreen() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { quota, refresh: refreshQuota } = useContactQuota()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      setClients(await getArchivedClients(session.user.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [session, t])

  useFocusEffect(useCallback(() => { load() }, [load]))

  async function restore(client: Client) {
    setRestoringId(client.id)
    setError(null)
    try {
      await restoreClient(client.id)
      await Promise.all([load(), refreshQuota()])
    } catch (e) {
      setError(isContactQuotaError(e) ? t('clients.quota_restore_blocked') : e instanceof Error ? e.message : t('common.error'))
    } finally {
      setRestoringId(null)
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: t('clients.archived_title'), headerBackTitle: '' }} />
      <View style={styles.container}>
        {quota?.limit != null && (
          <View style={styles.quotaCard}>
            <Text style={styles.quotaText}>{t('clients.quota_count', { count: quota.activeCount, limit: quota.limit })}</Text>
            <Text style={styles.quotaHint}>{t('clients.archived_quota_hint')}</Text>
          </View>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator style={styles.loader} color={colors.primary} /> : (
          <FlatList
            data={clients}
            keyExtractor={item => item.id}
            contentContainerStyle={[styles.list, clients.length === 0 && styles.emptyList]}
            ListEmptyComponent={<EmptyState icon="📦" message={t('clients.archived_empty')} />}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.info}>
                  <Text style={styles.name}>{item.full_name}</Text>
                  <Text style={styles.date}>{t('clients.archived_on', { date: item.archived_at ? new Date(item.archived_at).toLocaleDateString() : '' })}</Text>
                </View>
                <TouchableOpacity style={styles.restoreBtn} onPress={() => restore(item)} disabled={restoringId === item.id}>
                  {restoringId === item.id
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={styles.restoreText}>{t('clients.restore')}</Text>}
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bgDim },
    quotaCard: { margin: 16, marginBottom: 4, borderRadius: 12, padding: 14, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.border, gap: 3 },
    quotaText: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
    quotaHint: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    error: { marginHorizontal: 16, marginTop: 12, color: colors.danger, fontFamily: fonts.medium, fontSize: 13 },
    loader: { marginTop: 48 },
    list: { padding: 16, gap: 10, maxWidth: 800, width: '100%', alignSelf: 'center' },
    emptyList: { flex: 1 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    info: { flex: 1, gap: 3 },
    name: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    date: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    restoreBtn: { minWidth: 92, alignItems: 'center', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: colors.primary },
    restoreText: { fontSize: 12, fontFamily: fonts.bold, color: '#fff' },
  })
}
