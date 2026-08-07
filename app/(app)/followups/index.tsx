import { useState, useCallback, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions, Modal } from 'react-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { usePendingFollowups } from '@/features/followups/useFollowups'
import { toggleFollowupDone, computeFollowupPriority } from '@/features/followups/followupService'
import { useFollowupBadge } from '@/features/notifications/useNotifications'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { FollowupWithClient } from '@/shared/lib/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMP_EMOJI: Record<string, string> = {
  cold: '❄️', warm: '🌤️', hot: '🔥', very_hot: '🔥',
}


function getScorePalette(score: number, colors: ThemeColors) {
  if (score >= 70) return { bg: colors.dangerLight,  text: colors.danger   }
  if (score >= 40) return { bg: colors.warningLight, text: colors.warning  }
  if (score > 0)   return { bg: colors.primaryLight, text: colors.primary  }
  return              { bg: colors.bgDim,          text: colors.textTertiary }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function initials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Tab config ────────────────────────────────────────────────────────────────

type Tab = 'overdue' | 'today' | 'upcoming'

function getTabConfig(colors: ThemeColors): Record<Tab, { labelKey: string; accent: string; emptyKey: string }> {
  return {
    overdue:  { labelKey: 'followups.overdue',  accent: colors.danger,       emptyKey: 'followups.none_overdue'  },
    today:    { labelKey: 'followups.today',    accent: colors.secondary,    emptyKey: 'followups.none_today'    },
    upcoming: { labelKey: 'followups.upcoming', accent: colors.primary,      emptyKey: 'followups.none_upcoming' },
  }
}

// ── FollowupCard ──────────────────────────────────────────────────────────────

function FollowupCard({ f, today, onRequestDone }: {
  f: FollowupWithClient & { _score: number }
  today: string
  onRequestDone: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const isOverdue  = f.due_date < today
  const isToday    = f.due_date === today
  const daysLate   = isOverdue ? Math.ceil((new Date(today).getTime() - new Date(f.due_date).getTime()) / 86400000) : 0
  const daysAhead  = !isOverdue && !isToday ? Math.ceil((new Date(f.due_date).getTime() - new Date(today).getTime()) / 86400000) : 0
  const daysOld    = Math.floor((Date.now() - new Date(f.created_at).getTime()) / 86400000)

  const dateLabel = isOverdue
    ? t(daysLate === 1 ? 'followups.late_day' : 'followups.late_days', { days: daysLate })
    : isToday ? t('followups.today')
    : t(daysAhead === 1 ? 'followups.ahead_day' : 'followups.ahead_days', { days: daysAhead })

  const scorePalette = getScorePalette(f._score, colors)

  return (
    <TouchableOpacity
      style={[styles.card, isOverdue && styles.cardOverdue]}
      onPress={() => router.push(`/(app)/clients/${f.client_id}/followups`)}
      activeOpacity={0.75}
    >
      {/* ── Row 1 : avatar + name + badges ── */}
      <View style={styles.row1}>
        <View style={[styles.avatar, { backgroundColor: scorePalette.bg }]}>
          <Text style={[styles.avatarText, { color: scorePalette.text }]}>
            {initials(f.client?.full_name ?? '?')}
          </Text>
        </View>

        <View style={styles.nameBlock}>
          <Text style={styles.clientName} numberOfLines={1}>{f.client?.full_name}</Text>
        </View>

        <View style={styles.badgesRow}>
          {/* Score */}
          {f._score > 0 && (
            <View style={[styles.badge, { backgroundColor: scorePalette.bg }]}>
              <Text style={[styles.badgeText, { color: scorePalette.text }]}>{f._score}</Text>
            </View>
          )}
          {/* Temperature */}
          {f.prospect_temperature ? (
            <Text style={styles.tempEmoji}>{TEMP_EMOJI[f.prospect_temperature] ?? ''}</Text>
          ) : null}
          {/* AUTO */}
          {f.auto_generated ? (
            <View style={[styles.badge, { backgroundColor: colors.secondaryLight }]}>
              <Text style={[styles.badgeText, { color: colors.secondary }]}>{t('followups.auto_badge')}</Text>
            </View>
          ) : null}
        </View>

        {/* Done button */}
        <TouchableOpacity style={styles.doneBtn} onPress={onRequestDone} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <View style={[styles.doneCircle, { borderColor: isOverdue ? colors.danger : colors.primary }]} />
        </TouchableOpacity>
      </View>

      {/* ── Row 2 : task title ── */}
      {(f.title ?? f.content) ? (
        <Text style={styles.taskTitle} numberOfLines={2}>{f.title ?? f.content}</Text>
      ) : null}

      {/* ── Row 3 : product context ── */}
      {f.product_context ? (
        <View style={styles.productRow}>
          <Text style={styles.productIcon}>📦</Text>
          <Text style={styles.productText} numberOfLines={1}>{f.product_context}</Text>
        </View>
      ) : null}

      {/* ── Row 4 : date + overdue badge + created ── */}
      <View style={styles.metaRow}>
        <View style={styles.dateChip}>
          <Text style={styles.dateIcon}>📅</Text>
          <Text style={[styles.dateText, { color: isOverdue ? colors.danger : isToday ? colors.secondary : colors.textSecondary }]}>
            {dateLabel}
          </Text>
        </View>
        {isOverdue && (
          <View style={[styles.badge, { backgroundColor: colors.dangerLight }]}>
            <Text style={[styles.badgeText, { color: colors.danger }]}>{t('followups.overdue_badge')}</Text>
          </View>
        )}
        <Text style={styles.createdText}>{t('followups.created_days', { days: daysOld })}</Text>
      </View>
    </TouchableOpacity>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function FollowupsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const TAB_CONFIG = useMemo(() => getTabConfig(colors), [colors])
  const { followups, loading, refresh } = usePendingFollowups()
  const [activeTab, setActiveTab] = useState<Tab>('overdue')
  const { width } = useWindowDimensions()
  const isWide = width >= 768

  useFocusEffect(useCallback(() => { refresh() }, []))

  const today = new Date().toISOString().split('T')[0]

  // Score every followup and sort descending
  const scored = useMemo(() =>
    followups
      .map(f => ({ ...f, _score: computeFollowupPriority(f, today) }))
      .sort((a, b) => b._score - a._score),
    [followups, today]
  )

  const overdue  = scored.filter(f => f.due_date < today)
  const dueToday = scored.filter(f => f.due_date === today)
  const upcoming = scored.filter(f => f.due_date > today)

  // Met à jour le badge iOS avec le nb de relances urgentes (en retard + aujourd'hui)
  useFollowupBadge(overdue.length + dueToday.length)

  const sections = { overdue, today: dueToday, upcoming }
  const displayed = sections[activeTab]

  const tabs: Tab[] = ['overdue', 'today', 'upcoming']
  const counts = { overdue: overdue.length, today: dueToday.length, upcoming: upcoming.length }

  const [confirmDone, setConfirmDone] = useState<(FollowupWithClient & { _score: number }) | null>(null)
  const [confirming,  setConfirming]  = useState(false)

  async function handleConfirmDone() {
    if (!confirmDone) return
    setConfirming(true)
    try {
      await toggleFollowupDone(confirmDone.id, true)
      await refresh()
      setConfirmDone(null)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <View style={[styles.inner, isWide && styles.innerWide]}>

          {/* ── Header ─────────────────────────────────────── */}
          <View style={styles.pageHeader}>
            <Text style={styles.pageTitle}>{t('followups.title')}</Text>
            <Text style={styles.pageSub}>{t('followups.center_subtitle')}</Text>
          </View>

          {/* ── Tab bar ────────────────────────────────────── */}
          <View style={styles.tabBar}>
            {tabs.map(tab => {
              const cfg    = TAB_CONFIG[tab]
              const active = activeTab === tab
              const count  = counts[tab]
              return (
                <TouchableOpacity key={tab} style={styles.tabItem} onPress={() => setActiveTab(tab)} activeOpacity={0.7}>
                  <View style={styles.tabLabelRow}>
                    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                      {t(cfg.labelKey)}
                    </Text>
                    {count > 0 && (
                      <View style={[styles.tabBadge, { backgroundColor: cfg.accent }]}>
                        <Text style={styles.tabBadgeText}>{count}</Text>
                      </View>
                    )}
                  </View>
                  {active && <View style={[styles.tabUnderline, { backgroundColor: cfg.accent }]} />}
                </TouchableOpacity>
              )
            })}
          </View>

          {/* ── List ───────────────────────────────────────── */}
          {loading
            ? <ActivityIndicator style={styles.loader} color={colors.primary} />
            : (
              <FlatList
                data={displayed}
                keyExtractor={f => f.id}
                renderItem={({ item }) => (
                  <FollowupCard
                    f={item}
                    today={today}
                    onRequestDone={() => setConfirmDone(item)}
                  />
                )}
                ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
                contentContainerStyle={[styles.list, displayed.length === 0 && styles.listEmpty]}
                ListEmptyComponent={
                  <EmptyState
                    message={t(TAB_CONFIG[activeTab].emptyKey)}
                    icon="✅"
                    actionLabel={t('clients.title')}
                    onAction={() => router.push('/(app)/clients')}
                  />
                }
                onRefresh={refresh}
                refreshing={loading}
              />
            )
          }
        </View>
      </View>

      {/* ── Confirmation avant de marquer une relance comme terminée ────── */}
      <Modal visible={!!confirmDone} transparent animationType="fade" onRequestClose={() => { if (!confirming) setConfirmDone(null) }}>
        <TouchableOpacity
          style={styles.confirmOverlay}
          activeOpacity={1}
          onPress={(e) => { if (!confirming && e.target === e.currentTarget) setConfirmDone(null) }}
        >
          <View style={styles.confirmSheet} onStartShouldSetResponder={() => true}>
            <View style={styles.confirmHandle} />
            <Text style={styles.confirmTitle}>{t('followups.confirm_done_title')}</Text>
            <Text style={styles.confirmText}>
              {t('followups.confirm_done_text', { name: confirmDone?.client?.full_name ?? '' })}
            </Text>
            <View style={styles.confirmBtnRow}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setConfirmDone(null)}
                disabled={confirming}
                activeOpacity={0.8}
              >
                <Text style={styles.confirmCancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDoneBtn, confirming && { opacity: 0.6 }]}
                onPress={handleConfirmDone}
                disabled={confirming}
                activeOpacity={0.8}
              >
                {confirming
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.confirmDoneBtnText}>{t('followups.confirm_done_action')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },
  inner:     { flex: 1, width: '100%' },
  innerWide: { maxWidth: 900, alignSelf: 'center' },

  pageHeader: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4, gap: 3 },
  pageTitle:  { fontSize: 28, fontFamily: fonts.display, color: colors.text },
  pageSub:    { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },

  tabBar:     { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: 16, marginBottom: 12 },
  tabItem:    { flex: 1, alignItems: 'center', paddingBottom: 0 },
  tabLabelRow:{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12 },
  tabLabel:   { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  tabLabelActive: { fontFamily: fonts.semibold, color: colors.text },
  tabBadge:   { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  tabBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: '#fff' },
  tabUnderline: { height: 2, width: '100%', borderRadius: 1, position: 'absolute', bottom: -1 },

  list:      { paddingHorizontal: 16, paddingBottom: 80, gap: 8 },
  listEmpty: { flex: 1 },
  loader:    { marginTop: 48 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.05)' }],
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardOverdue: { borderLeftWidth: 3, borderLeftColor: colors.danger },

  row1:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar:    { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText:{ fontSize: 14, fontFamily: fonts.bold },
  nameBlock: { flex: 1 },
  clientName:{ fontSize: 14, fontFamily: fonts.bold, color: colors.text },

  badgesRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  badge:     { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontFamily: fonts.bold },
  tempEmoji: { fontSize: 15 },

  doneBtn:    { flexShrink: 0, padding: 4 },
  doneCircle: { width: 24, height: 24, borderRadius: 12, borderWidth: 2 },

  taskTitle:  { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18, paddingLeft: 50 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 50 },
  productIcon:{ fontSize: 12 },
  productText:{ fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, flex: 1 },

  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 50 },
  dateChip:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateIcon:   { fontSize: 11 },
  dateText:   { fontSize: 12, fontFamily: fonts.semibold },
  createdText:{ fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginLeft: 'auto' },

  // ── Confirmation "relance terminée" ───────────────────────────────────────
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  confirmSheet:   { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 4 },
  confirmHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 12 },
  confirmTitle:   { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  confirmText:    { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 4, marginBottom: 16, lineHeight: 19 },
  confirmBtnRow:  { flexDirection: 'row', gap: 10 },
  confirmCancelBtn:     { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 13, borderWidth: 1.5, borderColor: colors.border },
  confirmCancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  confirmDoneBtn:       { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 13, backgroundColor: colors.primary },
  confirmDoneBtnText:   { fontSize: 14, fontFamily: fonts.semibold, color: '#fff' },
  })
}
