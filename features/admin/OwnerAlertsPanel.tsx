import { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { formatDate } from '@/shared/lib/dateFormat'
import type { SecurityNotification } from './adminService'
import { useOwnerAlerts, type OwnerAlertGroup } from './useOwnerAlerts'

type Category = SecurityNotification['category']

const CATEGORIES: Category[] = ['unusual_login', 'admin_action', 'support_access', 'mfa']
const CATEGORY_ICON: Record<Category, string> = { unusual_login: '🔑', admin_action: '🛠️', support_access: '🛟', mfa: '🔐' }

// OWNER-ALERTS-1 — à traiter d'abord, alertes identiques regroupées, lues repliées.
export function OwnerAlertsPanel() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { alerts, groups, loading, failed, markRead } = useOwnerAlerts()
  const [category, setCategory] = useState<Category | null>(null)
  const [readOpen, setReadOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const inCategory = groups.filter(g => !category || g.category === category)
  const toProcess = inCategory.filter(g => g.unreadIds.length > 0)
  const processed = inCategory.filter(g => g.unreadIds.length === 0)
  const unreadTotal = alerts.filter(a => !a.read_at).length
  const severityColor = (s: OwnerAlertGroup['severity']) => s === 'critical' ? colors.danger : s === 'warning' ? colors.warning : colors.primary

  async function mark(ids?: string[]) {
    setBusy(true); setError('')
    try { await markRead(ids) }
    catch (e) { console.error('[owner.alerts.read]', e); setError(t('owner.action_error')) }
    finally { setBusy(false) }
  }

  const when = (iso: string) => formatDate(iso, locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const renderGroup = (group: OwnerAlertGroup) => {
    const color = severityColor(group.severity)
    const open = expanded === group.key
    const subject = !group.subjectUserId ? null
      : t(group.subjectUserId === session?.user.id ? 'owner.alert_subject_me' : 'owner.alert_subject_other')
    return (
      <View key={group.key} style={[styles.group, { borderLeftColor: color }]}>
        <TouchableOpacity style={styles.groupMain} onPress={() => setExpanded(open ? null : group.key)} activeOpacity={0.75}>
          <Text style={styles.icon}>{CATEGORY_ICON[group.category]}</Text>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>{group.title}</Text>
              {group.items.length > 1 ? <Text style={styles.count}>×{group.items.length}</Text> : null}
            </View>
            <Text style={styles.muted} numberOfLines={1}>
              {[subject, t('owner.alert_last', { date: formatDate(group.lastAt, locale) })].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <Text style={[styles.severity, { color }]}>{t(`owner.severity_${group.severity}`)}</Text>
          <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
        </TouchableOpacity>
        {open ? (
          <View style={styles.detail}>
            <Text style={styles.body}>{group.body}</Text>
            {group.items.map(item => <Text key={item.id} style={styles.muted}>{when(item.created_at)}{item.read_at ? '' : ` · ${t('owner.alert_unread')}`}</Text>)}
          </View>
        ) : null}
        {group.unreadIds.length > 0 ? (
          <View style={styles.groupActions}>
            <Button size="sm" variant="secondary" label={t('owner.alert_mark_read')} disabled={busy} onPress={() => mark(group.unreadIds)} />
          </View>
        ) : null}
      </View>
    )
  }

  if (loading && alerts.length === 0) return <ActivityIndicator color={colors.primary} />
  if (failed) return <Text style={styles.error}>{t('owner.load_error')}</Text>

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.headerText}>{t('owner.alerts_to_process', { count: unreadTotal })}</Text>
        {unreadTotal > 0 ? <Button size="sm" variant="ghost" label={t('owner.mark_all_read')} disabled={busy} onPress={() => mark()} /> : null}
      </View>

      <View style={styles.chips}>
        <TouchableOpacity style={[styles.chip, !category && styles.chipActive]} onPress={() => setCategory(null)} activeOpacity={0.75}>
          <Text style={[styles.chipText, !category && styles.chipTextActive]}>{t('owner.filter_all')}</Text>
        </TouchableOpacity>
        {CATEGORIES.filter(c => groups.some(g => g.category === c)).map(c => {
          const active = category === c
          const count = alerts.filter(a => a.category === c && !a.read_at).length
          return (
            <TouchableOpacity key={c} style={[styles.chip, active && styles.chipActive]} onPress={() => setCategory(active ? null : c)} activeOpacity={0.75}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{CATEGORY_ICON[c]} {t(`owner.alert_category_${c}`)}{count > 0 ? ` · ${count}` : ''}</Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {toProcess.length === 0 ? <Text style={styles.empty}>✓ {t('owner.alerts_none')}</Text> : toProcess.map(renderGroup)}

      {processed.length > 0 ? (
        <>
          <TouchableOpacity onPress={() => setReadOpen(v => !v)} activeOpacity={0.7}>
            <Text style={styles.toggle}>{t('owner.alerts_read_toggle', { count: processed.length })} {readOpen ? '▴' : '▾'}</Text>
          </TouchableOpacity>
          {readOpen ? processed.map(renderGroup) : null}
        </>
      ) : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    section: { gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
    headerText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    chipText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
    chipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    group: { borderRadius: 14, borderLeftWidth: 4, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder, padding: 12, gap: 10, ...SOFT_CARD_SHADOW },
    groupMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    icon: { fontSize: 20 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flexShrink: 1, fontSize: 14.5, fontFamily: fonts.semibold, color: colors.text },
    count: { fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary },
    severity: { fontSize: 12, fontFamily: fonts.semibold },
    chevron: { fontSize: 11, color: colors.textTertiary },
    detail: { gap: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
    body: { fontSize: 13.5, lineHeight: 19, fontFamily: fonts.body, color: colors.text, marginBottom: 2 },
    muted: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
    groupActions: { flexDirection: 'row', justifyContent: 'flex-end' },
    empty: { padding: 16, textAlign: 'center', fontSize: 14, fontFamily: fonts.medium, color: colors.success },
    toggle: { fontSize: 13.5, fontFamily: fonts.semibold, color: colors.textSecondary, paddingVertical: 4 },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  })
}
