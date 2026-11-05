import { useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { useOwnerDashboard } from './useOwnerDashboard'

export type OwnerAttentionTab = 'alerts' | 'support' | 'deletions'

// OWNER-DASHBOARD-1 — page d'ouverture de la console : chiffres sur les comptes uniquement.
export function OwnerDashboardPanel({ onOpenTab }: { onOpenTab: (tab: OwnerAttentionTab) => void }) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { dashboard: d, loading, failed } = useOwnerDashboard()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  if (loading) return <ActivityIndicator color={colors.primary} />
  if (failed || !d) return <Text style={styles.muted}>{t('owner.dashboard_unavailable')}</Text>

  const attention = [
    { key: 'alerts', count: d.alerts_unread, label: t('owner.attention_alerts', { count: d.alerts_unread }), tab: 'alerts' as const },
    { key: 'support', count: d.support_pending, label: t('owner.attention_support', { count: d.support_pending }), tab: 'support' as const },
    { key: 'deletions', count: d.deletions_pending, label: t('owner.attention_deletions', { count: d.deletions_pending }), tab: 'deletions' as const },
  ].filter(item => item.count > 0)

  const stats = [
    { key: 'accounts', value: d.accounts_total, label: t('owner.stat_accounts'), sub: t('owner.stat_activated', { count: d.activated }) },
    { key: 'active', value: d.active_7d, label: t('owner.stat_active_7d'), sub: t('owner.stat_active_30d', { count: d.active_30d }) },
    { key: 'signups', value: d.signups_7d, label: t('owner.stat_signups_7d'), sub: t('owner.stat_signups_30d', { count: d.signups_30d }) },
    { key: 'paying', value: d.paying, label: t('owner.stat_paying'), sub: t('owner.stat_access', { offered: d.offered, free: d.free }) },
  ]

  return (
    <View style={styles.section}>
      {attention.length > 0 ? (
        <View style={styles.attention}>
          {attention.map(item => (
            <TouchableOpacity key={item.key} style={styles.attentionRow} onPress={() => onOpenTab(item.tab)} activeOpacity={0.75}>
              <Text style={styles.attentionText}>{item.label}</Text>
              <Text style={styles.attentionCta}>{t('owner.attention_open')} ›</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.grid}>
        {stats.map(stat => (
          <View key={stat.key} style={styles.stat}>
            <Text style={styles.statLabel}>{stat.label}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.muted}>{stat.sub}</Text>
          </View>
        ))}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{t('owner.recent_signups')}</Text>
        {d.recent_signups.map((u, index) => (
          <View key={`${u.email}-${index}`} style={[styles.row, index > 0 && styles.rowBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName} numberOfLines={1}>{u.full_name || u.email}</Text>
              <Text style={styles.muted} numberOfLines={1}>{u.email}</Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={styles.rowAccess}>{t(`owner.access_${u.access}`)}</Text>
              <Text style={styles.muted}>{formatDate(u.created_at, locale)}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    section: { gap: 14 },
    muted: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
    attention: { borderRadius: 14, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningLight, paddingHorizontal: 14, paddingVertical: 4 },
    attentionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 9 },
    attentionText: { flexShrink: 1, fontSize: 13.5, fontFamily: fonts.medium, color: colors.text },
    attentionCta: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    stat: { flexGrow: 1, flexBasis: 200, gap: 4, padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, ...SOFT_CARD_SHADOW },
    statLabel: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.textSecondary },
    statValue: { fontSize: 30, fontFamily: fonts.display, color: colors.text },
    panel: { padding: 16, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, ...SOFT_CARD_SHADOW },
    panelTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, marginBottom: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    rowName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    rowRight: { alignItems: 'flex-end', gap: 2 },
    rowAccess: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.primary },
  })
}
