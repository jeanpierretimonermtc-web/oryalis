import { useState, useCallback, useMemo } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { usePendingFollowups } from '@/features/followups/useFollowups'
import { computeFollowupPriority } from '@/features/followups/followupService'
import { FollowupCompletionModal } from '@/features/followups/FollowupCompletionModal'
import { OpenActionLink } from '@/shared/components/ui/OpenActionLink'
import { CompleteToggle } from '@/shared/components/ui/CompleteToggle'
import { useFollowupBadge } from '@/features/notifications/useNotifications'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { ScreenHeader } from '@/shared/components/ui/ScreenHeader'
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

  // UI-AFFORDANCE-1.3 — la carte n'est plus elle-même un TouchableOpacity (elle contient un
  // vrai bouton imbriqué, CompleteToggle : deux <button> HTML imbriqués sont invalides et
  // provoquent une erreur d'hydratation sur web). La carte est désormais un simple View ; la
  // navigation reste exactement la même, portée par deux Pressable FRÈRES de CompleteToggle
  // (jamais un parent commun interactif) qui couvrent la même zone visuelle qu'avant.
  const goToContact = () => router.push(`/(app)/clients/${f.client_id}/followups` as any)

  return (
    <View style={[styles.card, isOverdue && styles.cardOverdue]}>
      {/* ── Row 1 : avatar + name + badges (ouvrable) + Terminer (frère, jamais imbriqué) ── */}
      <View style={styles.row1}>
        <TouchableOpacity
          style={styles.row1Content}
          onPress={goToContact}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`${t('common.open')} ${f.title ?? f.content ?? ''}`}
        >
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
        </TouchableOpacity>

        {/* UI-AFFORDANCE-1.2 — action métier explicite (jamais un simple carré ambigu) ; cette
            page ne liste que des relances actives (usePendingFollowups filtre done=false), donc
            toujours l'état "Terminer", jamais "Terminée" ici. */}
        <CompleteToggle
          done={false}
          onPress={onRequestDone}
          activeLabel={t('clients.finish_action')}
          doneLabel={t('followups.done')}
          accentColor={isOverdue ? colors.danger : colors.primary}
          accessibilityLabel={`${t('clients.finish_action')} — ${f.client?.full_name ?? ''}`}
        />
      </View>

      {/* ── Reste de la carte (titre/produit/méta), même zone ouvrable qu'avant ── */}
      <TouchableOpacity onPress={goToContact} activeOpacity={0.75}>
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
          {/* UI-AFFORDANCE-1 — toute cette zone navigue déjà vers la fiche Relances du contact
              au clic : décoratif (interactive=false), jamais un second déclencheur. */}
          <OpenActionLink label={t('common.open')} interactive={false} style={styles.openLink} />
        </View>
      </TouchableOpacity>
    </View>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function FollowupsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const TAB_CONFIG = useMemo(() => getTabConfig(colors), [colors])
  const { session } = useAuth()
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

  // ACTION-OUTCOME-1 / P1 §23 — remplace l'ancienne confirmation "Marquer terminé ?" (qui
  // appelait toggleFollowupDone directement, un chemin de clôture parallèle à P1) par la même
  // modale partagée que la page Relances-contact : un seul comportement de clôture, quelle que
  // soit la page d'entrée.
  const [completingFollowup, setCompletingFollowup] = useState<(FollowupWithClient & { _score: number }) | null>(null)

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <View style={[styles.inner, isWide && styles.innerWide]}>

          {/* ── Header ─────────────────────────────────────── */}
          <ScreenHeader eyebrow={t('followups.header_eyebrow')} title={t('followups.title')} subtitle={t('followups.center_subtitle')} />

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
                    onRequestDone={() => setCompletingFollowup(item)}
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

      {completingFollowup && (
        <FollowupCompletionModal
          followup={completingFollowup}
          userId={session?.user.id ?? ''}
          onClose={() => setCompletingFollowup(null)}
          onSaved={() => { setCompletingFollowup(null); refresh() }}
        />
      )}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner:     { flex: 1, width: '100%' },
  innerWide: { maxWidth: 900, alignSelf: 'center' },


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
    borderRadius: 18,
    padding: 16,
    gap: 8,
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(27, 36, 51, 0.05)' },
      { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(27, 36, 51, 0.06)' },
    ],
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  // DESIGN-A — retard signalé par un contour rouge doux plutôt qu'une bande latérale.
  cardOverdue: { borderColor: colors.dangerLight },

  row1:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  row1Content: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar:    { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText:{ fontSize: 14, fontFamily: fonts.bold },
  nameBlock: { flex: 1 },
  clientName:{ fontSize: 14, fontFamily: fonts.bold, color: colors.text },

  badgesRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  tempEmoji: { fontSize: 15 },
  badge:     { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontFamily: fonts.bold },


  taskTitle:  { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18, paddingLeft: 50 },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 50 },
  productIcon:{ fontSize: 12 },
  productText:{ fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, flex: 1 },

  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 50 },
  dateChip:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateIcon:   { fontSize: 11 },
  dateText:   { fontSize: 12, fontFamily: fonts.semibold },
  createdText:{ fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginLeft: 'auto' },
  openLink:   { marginLeft: 8 },
  })
}
