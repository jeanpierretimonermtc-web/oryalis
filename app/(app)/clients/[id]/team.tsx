import { useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useDirectTeam } from '@/features/network/useNetwork'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'

function activityColor(updatedAt: string | null, colors: ThemeColors): string {
  if (!updatedAt) return colors.textTertiary
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days < 15) return colors.success
  if (days < 30) return colors.warning
  return colors.danger
}

function initials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function ClientTeamScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { getRoleLabel } = useAppConfig()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { team, loading } = useDirectTeam(id)

  return (
    <>
      <Stack.Screen options={{ title: t('clients.tab_team'), headerBackTitle: '' }} />
      {loading ? (
        <View style={styles.loader}><ActivityIndicator color={colors.primary} /></View>
      ) : team.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{t('network.empty')}</Text>
        </View>
      ) : (
        <FlatList
          data={team}
          keyExtractor={m => m.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const rp  = getRoleColors(getPrimaryRole(item.contact_role), colors)
            const dot = activityColor(item.updated_at, colors)
            return (
              <TouchableOpacity
                style={styles.card}
                onPress={() => router.push(`/(app)/clients/${item.id}` as any)}
                activeOpacity={0.75}
              >
                <View style={[styles.avatar, { backgroundColor: rp.bg }]}>
                  <Text style={[styles.avatarText, { color: rp.text }]}>{initials(item.full_name)}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.name} numberOfLines={1}>{item.full_name}</Text>
                  {item.email ? <Text style={styles.email} numberOfLines={1}>{item.email}</Text> : null}
                </View>
                <View style={[styles.dot, { backgroundColor: dot }]} />
                <View style={[styles.badge, { backgroundColor: rp.bg }]}>
                  <Text style={[styles.badgeText, { color: rp.text }]}>
                    {item.contact_role.map(r => getRoleLabel(r)).join(' · ')}
                  </Text>
                </View>
                <Text style={styles.arrow}>›</Text>
              </TouchableOpacity>
            )
          }}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  empty:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, backgroundColor: colors.bg },
  emptyText: { fontSize: 14, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center' },
  list:   { padding: 16, gap: 0, backgroundColor: colors.bg },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
  },
  avatar:     { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: fonts.bold },
  info:       { flex: 1 },
  name:       { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  email:      { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
  dot:        { width: 10, height: 10, borderRadius: 5 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText:  { fontSize: 10, fontFamily: fonts.bold },
  arrow:      { fontSize: 20, color: colors.textTertiary },
  sep:        { height: 1, backgroundColor: colors.border, marginLeft: 66 },
  })
}
