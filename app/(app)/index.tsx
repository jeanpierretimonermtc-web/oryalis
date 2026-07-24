import { useEffect, useCallback, useRef, useMemo } from 'react'
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useDemoState } from '@/features/demo/DemoProvider'
import {
  useDashboardStats,
  useUpcomingLrp,
  usePipelineStats,
  useMonthlyRevenue,
  useAlerts,
  useDailyActions,
} from '@/features/dashboard/useDashboard'
import type { DailyActionItem, DailyActionKind } from '@/features/dashboard/useDashboard'
import { useGoals } from '@/features/goals/useGoals'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { useUpcomingAppointments } from '@/features/appointments/useAppointments'
import { usePendingFollowups } from '@/features/followups/useFollowups'
import { Avatar } from '@/shared/components/ui/Avatar'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { FollowupWithClient, Client, PipelineStage } from '@/shared/lib/types'
import type { Appointment } from '@/features/appointments/appointmentTypes'
import { formatDate } from '@/shared/lib/dateFormat'

function useLocale() {
  const { i18n } = useTranslation()
  return i18n.language === 'fr' ? 'fr-FR' : 'en-US'
}

function formatLocalDate(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// ── Quick card ────────────────────────────────────────────────────────────────
function QuickCard({
  icon,
  label,
  onPress,
}: {
  icon: string
  label: string
  onPress: () => void
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <TouchableOpacity style={styles.quickCard} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.quickCardIcon}>{icon}</Text>
      <Text style={styles.quickCardLabel}>{label}</Text>
    </TouchableOpacity>
  )
}

// ── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({
  icon,
  value,
  label,
  delta,
  accent,
  bg,
  onPress,
  wide,
}: {
  icon: string
  value: number
  label: string
  delta?: string
  accent: string
  bg: string
  onPress?: () => void
  wide?: boolean
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <TouchableOpacity
      style={[
        styles.kpiCard,
        wide ? styles.kpiCardWide : styles.kpiCardMobile,
        { borderLeftWidth: 3, borderLeftColor: accent },
      ]}
      onPress={onPress}
      activeOpacity={onPress ? 0.8 : 1}
    >
      <View style={styles.kpiTop}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <View style={[styles.kpiIconBox, { backgroundColor: bg }]}>
          <Text style={styles.kpiIconText}>{icon}</Text>
        </View>
      </View>

      <Text style={[styles.kpiValue, { color: accent }]}>{value}</Text>

      {delta ? <Text style={styles.kpiDelta}>{delta}</Text> : null}
    </TouchableOpacity>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({
  title,
  sub,
  onMore,
}: {
  title: string
  sub?: string
  onMore?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {sub ? <Text style={styles.sectionSub}>{sub}</Text> : null}
      </View>

      {onMore && (
        <TouchableOpacity onPress={onMore} activeOpacity={0.7}>
          <Text style={styles.sectionMore}>{t('dashboard.see_all')}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// ── Appointment row ───────────────────────────────────────────────────────────
function ApptRow({ appt }: { appt: Appointment }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const d = new Date(appt.start_at)
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const done = appt.status === 'completed'

  return (
    <TouchableOpacity
      style={styles.apptRow}
      onPress={() =>
        appt.client_id
          ? router.push(`/(app)/clients/${appt.client_id}/appointments`)
          : router.push('/(app)/appointments')
      }
      activeOpacity={0.7}
    >
      <View style={styles.apptTimeCol}>
        <Text style={styles.apptTimeMain}>{timeStr}</Text>
      </View>

      <Avatar name={appt.title} size={38} status="active" />

      <View style={styles.apptInfo}>
        <Text style={styles.apptName} numberOfLines={1}>
          {appt.title}
        </Text>
        <Text style={styles.apptType}>{t(`appointment_types.${appt.appointment_type}` as any)}</Text>
      </View>

      <View style={[styles.statusBadge, done ? styles.confirmedBadge : styles.pendingBadge]}>
        <Text style={[styles.statusText, done ? styles.confirmedText : styles.pendingText]}>
          {done ? t('dashboard.confirmed') : t('dashboard.pending_appt')}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

// ── Followup card ─────────────────────────────────────────────────────────────
function FollowupCard({ f }: { f: FollowupWithClient }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const today = formatLocalDate(new Date())
  const isOverdue = f.due_date < today
  const daysLate = isOverdue
    ? Math.ceil((new Date(today).getTime() - new Date(f.due_date).getTime()) / 86400000)
    : 0

  const badgeText =
    daysLate > 1
      ? t('dashboard.days_late', { days: daysLate })
      : daysLate === 1
        ? t('dashboard.yesterday')
        : t('dashboard.followup_today')

  const urgent = daysLate > 1

  return (
    <TouchableOpacity
      style={styles.followupRow}
      onPress={() => router.push(`/(app)/clients/${f.client_id}/followups`)}
      activeOpacity={0.7}
    >
      <View style={[styles.followupDot, { backgroundColor: urgent ? colors.danger : colors.secondary }]} />

      <Avatar name={f.client?.full_name ?? '?'} size={34} />

      <View style={styles.followupInfo}>
        <Text style={styles.followupName} numberOfLines={1}>
          {f.client?.full_name}
        </Text>
        <Text style={styles.followupTask} numberOfLines={1}>
          {f.title ?? f.content}
        </Text>
        <Text style={[styles.followupDue, { color: urgent ? colors.danger : colors.secondary }]}>
          🕐 {badgeText}
        </Text>
      </View>
    </TouchableOpacity>
  )
}

// ── LRP card ──────────────────────────────────────────────────────────────────
function LrpCard({ client }: { client: Client }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = useLocale()

  const daysUntil = client.next_lrp_date
    ? Math.ceil((new Date(client.next_lrp_date).getTime() - Date.now()) / 86400000)
    : null

  const urgent = daysUntil !== null && daysUntil <= 7

  return (
    <TouchableOpacity
      style={styles.apptRow}
      onPress={() => router.push(`/(app)/clients/${client.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.apptTimeCol}>
        <Text style={styles.apptTimeMain}>
          {daysUntil !== null && daysUntil <= 0
            ? t('dashboard.lrp_today')
            : daysUntil !== null
              ? t('dashboard.lrp_days', { days: daysUntil })
              : '—'}
        </Text>
        <Text style={styles.apptTimeSub}>LRP</Text>
      </View>

      <Avatar name={client.full_name} size={38} />

      <View style={styles.apptInfo}>
        <Text style={styles.apptName} numberOfLines={1}>
          {client.full_name}
        </Text>
        <Text style={styles.apptType}>
          {client.next_lrp_date &&
            formatDate(client.next_lrp_date, locale, { day: '2-digit', month: 'long' })}
        </Text>
      </View>

      {urgent && (
        <View style={[styles.statusBadge, { backgroundColor: colors.dangerLight }]}>
          <Text style={[styles.statusText, { color: colors.danger }]}>{t('common.urgent')}</Text>
        </View>
      )}
    </TouchableOpacity>
  )
}

// ── Pipeline strip ────────────────────────────────────────────────────────────
const PIPELINE_ORDER: PipelineStage[] = ['new_lead', 'contacted', 'presentation_scheduled', 'presentation_completed', 'follow_up', 'customer', 'distributor', 'lost']

function PipelineStrip({ byStage }: { byStage: Record<string, number> }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const pills = PIPELINE_ORDER.map((stage) => ({ stage, count: byStage[stage] ?? 0 })).filter(
    (p) => p.count > 0,
  )

  if (pills.length === 0) return null

  return (
    <View style={styles.pipelineWrap}>
      <Text style={styles.pipelineLabel}>{t('dashboard.pipeline')}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pipelineRow}
      >
        {pills.map(({ stage, count }, index) => {
          const palettes = [
            { bg: colors.bgDim, text: colors.textSecondary },
            { bg: colors.primaryLight, text: colors.primary },
            { bg: colors.secondaryLight, text: colors.secondary },
            { bg: colors.tertiaryLight, text: colors.tertiary },
            { bg: colors.warningLight, text: colors.warning },
            { bg: colors.successLight, text: colors.success },
            { bg: colors.primaryLight, text: colors.primary },
            { bg: colors.dangerLight, text: colors.danger },
          ]
          const sc = palettes[index]

          return (
            <TouchableOpacity
              key={stage}
              style={[styles.pipelinePill, { backgroundColor: sc.bg }]}
              onPress={() => router.push({ pathname: '/(app)/clients', params: { pipeline: stage } } as any)}
              activeOpacity={0.75}
            >
              <Text style={[styles.pipelinePillCount, { color: sc.text }]}>{count}</Text>
              <Text style={[styles.pipelinePillLabel, { color: sc.text }]}>
                {t(`pipeline_stages.${stage}`)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}

// ── Priority strip ────────────────────────────────────────────────────────────
function PriorityItem({
  count,
  label,
  onPress,
  accent,
  bg,
}: {
  count: number
  label: string
  onPress: () => void
  accent: string
  bg: string
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  if (count === 0) return null

  return (
    <TouchableOpacity
      style={[styles.priorityItem, { backgroundColor: bg, borderColor: accent }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={[styles.priorityCount, { color: accent }]}>{count}</Text>
      <Text style={[styles.priorityLabel, { color: accent }]}>{label}</Text>
    </TouchableOpacity>
  )
}

function PriorityStrip({
  overdueCount,
  lrpSoonCount,
  rdvTodayCount,
}: {
  overdueCount: number
  lrpSoonCount: number
  rdvTodayCount: number
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const total = overdueCount + lrpSoonCount + rdvTodayCount

  if (total === 0) {
    return (
      <View style={styles.allClearRow}>
        <Text style={styles.allClearText}>{t('dashboard.no_priorities')}</Text>
      </View>
    )
  }

  return (
    <View style={styles.priorityStrip}>
      <Text style={styles.priorityStripTitle}>{t('dashboard.priorities_title')}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.priorityRow}
      >
        <PriorityItem
          count={overdueCount}
          label={t('dashboard.priority_followups')}
          onPress={() => router.push('/(app)/followups')}
          accent={colors.danger}
          bg={colors.dangerLight}
        />
        <PriorityItem
          count={lrpSoonCount}
          label={t('dashboard.priority_lrp')}
          onPress={() => router.push('/(app)/clients')}
          accent={colors.secondary}
          bg={colors.secondaryLight}
        />
        <PriorityItem
          count={rdvTodayCount}
          label={t('dashboard.priority_rdv')}
          onPress={() => router.push('/(app)/appointments')}
          accent={colors.primary}
          bg={colors.primaryLight}
        />
      </ScrollView>
    </View>
  )
}

// ── Opportunity cards ─────────────────────────────────────────────────────────
function OpportunityCard({
  emoji,
  title,
  actionLabel,
  onPress,
  highlight = false,
}: {
  emoji: string
  title: string
  actionLabel: string
  onPress: () => void
  highlight?: boolean
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const cardBg = highlight ? colors.tertiaryLight : colors.card
  const cardBorder = highlight ? colors.tertiary : colors.border
  const actionClr = highlight ? colors.tertiary : colors.primary

  return (
    <TouchableOpacity
      style={[styles.oppCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text style={styles.oppEmoji}>{emoji}</Text>

      <Text style={styles.oppTitle} numberOfLines={2}>
        {title}
      </Text>

      <View style={styles.oppAction}>
        <Text style={[styles.oppActionText, { color: actionClr }]}>{actionLabel}</Text>
        <Text style={[styles.oppArrow, { color: actionClr }]}>→</Text>
      </View>
    </TouchableOpacity>
  )
}

const DAILY_ORDER: DailyActionKind[] = ['overdue_followup', 'today_appointment', 'today_action', 'hot_prospect', 'renewal']

function DailyActionCenter({ items, loading }: { items: DailyActionItem[]; loading: boolean }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = useLocale()
  if (loading) return <View style={styles.actionCenter}><ActivityIndicator color={colors.primary} /></View>

  return <View style={styles.actionCenter}>
    <View style={styles.actionCenterHeader}><View><Text style={styles.actionCenterTitle}>{t('dashboard.action_center')}</Text><Text style={styles.actionCenterSub}>{t('dashboard.action_center_sub', { count: items.length })}</Text></View><Text style={styles.actionCenterTotal}>{items.length}</Text></View>
    {items.length === 0 ? <View style={styles.allClearRow}><Text style={styles.allClearText}>{t('dashboard.no_priorities')}</Text></View> : DAILY_ORDER.map(kind => {
      const group = items.filter(item => item.kind === kind)
      if (!group.length) return null
      return <View key={kind} style={styles.actionGroup}>
        <View style={styles.actionGroupHeader}><Text style={styles.actionGroupTitle}>{t(`dashboard.daily.${kind}`)}</Text><Text style={styles.actionGroupCount}>{group.length}</Text></View>
        {group.slice(0, 5).map(item => <TouchableOpacity key={item.id} style={styles.actionRow} onPress={() => router.push(item.href as any)} activeOpacity={0.75}>
          <View style={[styles.actionKindDot, { backgroundColor: kind === 'overdue_followup' ? colors.danger : kind === 'hot_prospect' ? colors.warning : kind === 'renewal' ? colors.secondary : colors.primary }]} />
          <View style={styles.actionRowText}><Text style={styles.actionClient}>{item.clientName || item.title}</Text><Text style={styles.actionDetail}>{item.clientName ? item.title : t(`dashboard.daily.${kind}`)}{item.at ? ` · ${formatDate(item.at, locale, { day: '2-digit', month: 'short', hour: kind === 'today_appointment' ? '2-digit' : undefined, minute: kind === 'today_appointment' ? '2-digit' : undefined })}` : ''}</Text></View>
          <Text style={styles.actionArrow}>→</Text>
        </TouchableOpacity>)}
        {group.length > 5 ? <Text style={styles.actionMore}>+{group.length - 5} {t('dashboard.other_actions')}</Text> : null}
      </View>
    })}
  </View>
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { width } = useWindowDimensions()
  const isWide = width >= 768

  const { stats, loading: statsLoading, refresh: refreshStats } = useDashboardStats()
  const { appointments, loading: apptLoading, refresh: refreshAppts } = useUpcomingAppointments(10)
  const { followups, loading: fuLoading, refresh: refreshFu } = usePendingFollowups()
  const { clients: lrpClients, refresh: refreshLrp } = useUpcomingLrp(8)
  const { byStage, refresh: refreshPipeline } = usePipelineStats()
  const { amount: monthRevenue, refresh: refreshRevenue } = useMonthlyRevenue()
  const { alerts, reload: refreshAlerts } = useAlerts()
  const { goals } = useGoals()
  const { isModuleActive } = useAppConfig()
  const { items: dailyActions, loading: dailyLoading, refresh: refreshDaily } = useDailyActions()

  const firstName = session?.user?.user_metadata?.full_name?.split(' ')[0] ?? ''
  const hour = new Date().getHours()
  const greeting =
    hour < 12
      ? t('dashboard.greeting_morning')
      : hour < 18
        ? t('dashboard.greeting_afternoon')
        : t('dashboard.greeting_evening')

  const {
    demoCount,
    demoLoading,
    demoFailed,
    demoVersion,
    hideDemoCard,
    checkDemo,
    handleLoadDemo,
    handleDeleteDemo,
    handleResetDemo,
  } = useDemoState()

  function refreshAll() {
    refreshStats()
    refreshAppts()
    refreshFu()
    refreshLrp()
    refreshPipeline()
    refreshRevenue()
    refreshAlerts()
    refreshDaily()
  }

  useFocusEffect(
    useCallback(() => {
      refreshAll()
      checkDemo()
    }, []), // eslint-disable-line react-hooks/exhaustive-deps
  )

  const mountedVersion = useRef(demoVersion)

  useEffect(() => {
    if (demoVersion !== mountedVersion.current) {
      refreshAll()
    }
  }, [demoVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!statsLoading) checkDemo()
  }, [statsLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const showLoadDemo = !statsLoading && stats.totalClients === 0
  const showDemoActive = !statsLoading && demoCount > 0
  const showDemoLink = !statsLoading && stats.totalClients > 0 && demoCount === 0

  const now = new Date()
  const todayStr = formatLocalDate(now)
  const todayAppts = appointments.filter((a) => a.start_at.startsWith(todayStr))
  const overdueToday = followups.filter((f) => f.due_date <= todayStr)

  const lrpSoon = isModuleActive('renewals_lrp')
    ? lrpClients.filter((c) => {
        const days = c.next_lrp_date
          ? Math.ceil((new Date(c.next_lrp_date).getTime() - Date.now()) / 86400000)
          : null
        return days !== null && days >= 0 && days <= 5
      })
    : []

  const oppLrp = lrpSoon.slice(0, 3).map((c) => {
    const days = Math.ceil((new Date(c.next_lrp_date!).getTime() - Date.now()) / 86400000)

    return {
      key: `lrp-${c.id}`,
      emoji: '📦',
      title: `${c.full_name} — ${t('dashboard.opp_lrp', { days })}`,
      action: t('dashboard.opp_lrp_action'),
      href: `/(app)/clients/${c.id}` as const,
      highlight: false,
    }
  })

  const oppFollowups = overdueToday.slice(0, 3).map((f) => {
    const days = Math.ceil(
      (new Date(todayStr).getTime() - new Date(f.due_date).getTime()) / 86400000,
    )

    return {
      key: `fu-${f.id}`,
      emoji: '⚡',
      title: `${f.client?.full_name ?? '—'} — ${t('dashboard.opp_followup', { days })}`,
      action: t('dashboard.opp_followup_action'),
      href: `/(app)/clients/${f.client_id}/followups` as const,
      highlight: false,
    }
  })

  const oppLeaders = alerts
    .filter((a) => a.type === 'leader_emerging')
    .slice(0, 2)
    .map((a) => ({
      key: `leader-${a.id}`,
      emoji: '🌟',
      title: a.message,
      action: t('dashboard.opp_leader_action'),
      href: (a.action_url ?? '/(app)/network') as string,
      highlight: true,
    }))

  const opportunities = [...oppFollowups, ...oppLeaders, ...oppLrp]
  const visibleOpportunities = opportunities.slice(0, isWide ? 4 : 3)

  const activePct =
    stats.totalClients > 0 ? Math.round((stats.activeClients / stats.totalClients) * 100) : 0

  const hasTodaySection = todayAppts.length > 0
  const hasUrgentSection = overdueToday.length > 0
  const hasLrpSection = isModuleActive('renewals_lrp') && lrpClients.length > 0
  const hasOperationalSections = hasTodaySection || hasUrgentSection || hasLrpSection
  const useTwoColSections = isWide && hasTodaySection && (hasUrgentSection || hasLrpSection)

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, isWide && styles.contentWide]}
        refreshControl={
          <RefreshControl
            refreshing={statsLoading || apptLoading || fuLoading}
            onRefresh={refreshAll}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Greeting ──────────────────────────────────── */}
        <View style={styles.greetingRow}>
          <View style={styles.greetingLeft}>
            <Text style={styles.greeting} numberOfLines={2}>
              {greeting}
              {firstName ? `, ${firstName}` : ''}
            </Text>
            <Text style={styles.greetingSub}>{t('dashboard.title')}</Text>
          </View>

          <View style={styles.quickRow}>
            <QuickCard
              icon="👤"
              label={t('dashboard.new_client')}
              onPress={() => router.push('/(app)/clients/new')}
            />
            <QuickCard
              icon="📅"
              label={t('dashboard.quick_appointment')}
              onPress={() => router.push('/(app)/appointments')}
            />
          </View>
        </View>

        {/* ── Demo active ───────────────────────────────── */}
        {showDemoActive && (
          <View style={styles.demoBanner}>
            <Text style={styles.demoBannerText}>🧪 {t('dashboard.demo_active')}</Text>

            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              {demoLoading ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <>
                  <TouchableOpacity onPress={handleResetDemo} activeOpacity={0.7}>
                    <Text style={styles.demoBannerReset}>{t('dashboard.demo_reset')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleDeleteDemo} activeOpacity={0.7}>
                    <Text style={styles.demoBannerDelete}>{t('dashboard.demo_delete')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        {!hideDemoCard && !showDemoActive && (
          <>
            {showLoadDemo && (
              <View style={styles.demoCard}>
                <View style={styles.demoCardLeft}>
                  <Text style={styles.demoCardTitle}>{t('dashboard.demo_title')}</Text>
                  <Text style={styles.demoCardSub}>{t('dashboard.demo_subtitle')}</Text>
                </View>

                <TouchableOpacity
                  style={styles.demoLoadBtn}
                  onPress={handleLoadDemo}
                  activeOpacity={0.8}
                  disabled={demoLoading}
                >
                  {demoLoading ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.demoLoadBtnText}>{t('dashboard.demo_load')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {showDemoLink && (
              <TouchableOpacity
                style={styles.demoLink}
                onPress={handleLoadDemo}
                disabled={demoLoading}
                activeOpacity={0.7}
              >
                {demoLoading ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <Text style={styles.demoLinkText}>🧪 {t('dashboard.demo_load')}</Text>
                )}
              </TouchableOpacity>
            )}

            {demoFailed ? <Text style={styles.demoErrorText}>{t('common.error')}</Text> : null}
          </>
        )}

        {/* ── Priorités du jour ─────────────────────────── */}
        <DailyActionCenter items={dailyActions} loading={dailyLoading} />

        {/* ── Opportunités détectées ────────────────────── */}
        {false && visibleOpportunities.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title={t('dashboard.opportunities_title')} />

            {visibleOpportunities.map((opp) => (
              <OpportunityCard
                key={opp.key}
                emoji={opp.emoji}
                title={opp.title}
                actionLabel={opp.action}
                highlight={'highlight' in opp ? opp.highlight : false}
                onPress={() => router.push(opp.href as any)}
              />
            ))}
          </View>
        )}

        {/* ── KPI principaux ────────────────────────────── */}
        <View style={[styles.kpiGrid, isWide && styles.kpiGridWide]}>
          <KpiCard
            wide={isWide}
            icon="👥"
            value={stats.totalClients}
            label={t('dashboard.stats.total_clients')}
            delta={t('dashboard.kpi.new_month', { count: stats.newThisMonth })}
            accent={colors.secondary}
            bg={colors.secondaryLight}
            onPress={() =>
              router.push({ pathname: '/(app)/clients', params: { status: 'all' } } as any)
            }
          />

          <KpiCard
            wide={isWide}
            icon="🌱"
            value={stats.prospects}
            label={t('dashboard.stats.prospects')}
            delta={t('dashboard.kpi.prospects_delta')}
            accent={colors.primary}
            bg={colors.primaryLight}
            onPress={() =>
              router.push({ pathname: '/(app)/clients', params: { status: 'prospect' } } as any)
            }
          />

          <KpiCard
            wide={isWide}
            icon="🔔"
            value={stats.pendingFollowups}
            label={t('dashboard.stats.pending_followups')}
            delta={
              overdueToday.length > 0
                ? `${overdueToday.length} ${t('dashboard.kpi.overdue')}`
                : t('dashboard.kpi.active_pct', { pct: activePct })
            }
            accent={overdueToday.length > 0 ? colors.danger : colors.warning}
            bg={overdueToday.length > 0 ? colors.dangerLight : colors.warningLight}
            onPress={() => router.push('/(app)/followups')}
          />

          <KpiCard
            wide={isWide}
            icon="💬"
            value={stats.interactionsToday}
            label={t('dashboard.stats.interactions_today')}
            delta={t('dashboard.kpi.today_delta')}
            accent={colors.tertiary}
            bg={colors.tertiaryLight}
          />
        </View>

        {/* ── Pipeline ──────────────────────────────────── */}
        <PipelineStrip byStage={byStage} />

        {/* ── Sections opérationnelles ──────────────────── */}
        {false && hasOperationalSections && (
          <View style={useTwoColSections ? styles.twoCol : styles.oneCol}>
            {hasTodaySection && (
              <View style={useTwoColSections ? styles.col : undefined}>
                <View style={styles.section}>
                  <SectionHeader
                    title={t('dashboard.today_agenda')}
                    sub={`${todayAppts.length} RDV`}
                    onMore={() => router.push('/(app)/appointments')}
                  />

                  <View style={styles.listCard}>
                    {todayAppts.map((a, i) => (
                      <View key={a.id}>
                        <ApptRow appt={a} />
                        {i < todayAppts.length - 1 && <View style={styles.divider} />}
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {(hasUrgentSection || hasLrpSection) && (
              <View style={useTwoColSections ? styles.col : undefined}>
                {hasUrgentSection && (
                  <View style={styles.section}>
                    <SectionHeader
                      title={t('dashboard.urgent_followups')}
                      sub={t('dashboard.priority')}
                      onMore={() => router.push('/(app)/followups')}
                    />

                    <View style={styles.listCard}>
                      {overdueToday.slice(0, 4).map((f, i) => (
                        <View key={f.id}>
                          <FollowupCard f={f} />
                          {i < Math.min(overdueToday.length, 4) - 1 && (
                            <View style={styles.divider} />
                          )}
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {hasLrpSection && (
                  <View style={styles.section}>
                    <SectionHeader title={t('dashboard.next_lrp')} />

                    <View style={styles.listCard}>
                      {lrpClients.map((c, i) => (
                        <View key={c.id}>
                          <LrpCard client={c} />
                          {i < lrpClients.length - 1 && <View style={styles.divider} />}
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ── KPI réseau ────────────────────────────────── */}
        {stats.networkSize > 0 && (
          <View style={[styles.kpiGrid, isWide && styles.kpiGridWide]}>
            <KpiCard
              wide={isWide}
              icon="🌐"
              value={stats.networkSize}
              label={t('dashboard.kpi_network_size')}
              accent={colors.tertiary}
              bg={colors.tertiaryLight}
              onPress={() => router.push('/(app)/network' as any)}
            />

            <KpiCard
              wide={isWide}
              icon="🆕"
              value={stats.newRecruits}
              label={t('dashboard.kpi_new_recruits')}
              accent={colors.secondary}
              bg={colors.secondaryLight}
              onPress={() => router.push('/(app)/network' as any)}
            />
          </View>
        )}

        {/* ── KPI secondaires ───────────────────────────── */}
        <View style={[styles.kpiGrid, isWide && styles.kpiGridWide]}>
          <KpiCard
            wide={isWide}
            icon="💶"
            value={Math.round(monthRevenue)}
            label={t('dashboard.kpi_revenue')}
            accent={colors.success}
            bg={colors.successLight}
            onPress={() => router.push('/(app)/orders' as any)}
          />

          <KpiCard
            wide={isWide}
            icon="✅"
            value={stats.completedThisMonth}
            label={t('dashboard.kpi_completed_rdv')}
            accent={colors.primary}
            bg={colors.primaryLight}
            onPress={() => router.push('/(app)/appointments')}
          />

          <KpiCard
            wide={isWide}
            icon="🌱"
            value={stats.newThisMonth}
            label={t('dashboard.kpi_new_contacts')}
            accent={colors.secondary}
            bg={colors.secondaryLight}
            onPress={() =>
              router.push({ pathname: '/(app)/clients', params: { status: 'new_client' } } as any)
            }
          />
        </View>

        {/* ── Objectifs du mois ─────────────────────────── */}
        {isModuleActive('goals') && goals.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title={t('goals.section_title')}
              onMore={() => router.push('/(app)/goals' as any)}
            />

            <View style={styles.listCard}>
              {goals.map((g, i) => {
                const accent =
                  g.pct >= 100
                    ? colors.success
                    : g.pct >= 60
                      ? colors.primary
                      : g.pct >= 30
                        ? colors.warning
                        : colors.danger

                return (
                  <View key={g.id}>
                    {i > 0 && <View style={styles.divider} />}

                    <View style={styles.goalRow}>
                      <View style={styles.goalHeader}>
                        <Text style={styles.goalTitle}>{t(`goals.metrics.${g.metric}`)}</Text>
                        <Text style={[styles.goalValue, { color: accent }]}>
                          {g.current} / {g.target}
                        </Text>
                      </View>

                      <View style={styles.goalTrack}>
                        <View
                          style={[
                            styles.goalProgress,
                            {
                              width: `${Math.min(g.pct, 100)}%`,
                              backgroundColor: accent,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  </View>
                )
              })}
            </View>
          </View>
        )}

        {/* ── Free day ──────────────────────────────────── */}
        {todayAppts.length === 0 && overdueToday.length === 0 && (
          <View style={styles.emptyDay}>
            <Text style={styles.emptyDayEmoji}>✨</Text>
            <Text style={styles.emptyDayTitle}>{t('dashboard.free_day')}</Text>
            <Text style={styles.emptyDaySub}>{t('dashboard.free_day_sub')}</Text>
          </View>
        )}
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },

    content: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 120,
      gap: 22,
    },

    contentWide: {
      width: '100%',
      maxWidth: 1480,
      alignSelf: 'center',
      paddingHorizontal: 32,
      paddingTop: 24,
      paddingBottom: 72,
      gap: 26,
    },

    greetingRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
    },

    greetingLeft: {
      flex: 1,
    },

    greeting: {
      fontSize: 24,
      fontFamily: fonts.display,
      color: colors.primary,
      lineHeight: 30,
    },

    greetingSub: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginTop: 2,
    },

    quickRow: {
      flexDirection: 'row',
      gap: 8,
      flexShrink: 0,
    },

    quickCard: {
      backgroundColor: colors.primary,
      borderRadius: 14,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignItems: 'center',
      gap: 4,
      minWidth: 84,
      boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 6, color: 'rgba(0, 0, 0, 0.08)' }],
      elevation: 2,
    },

    quickCardIcon: {
      fontSize: 17,
    },

    quickCardLabel: {
      fontSize: 10,
      fontFamily: fonts.bold,
      color: colors.textInverse,
      textAlign: 'center',
    },

    kpiGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },

    kpiGridWide: {
      flexWrap: 'nowrap',
    },

    kpiCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 18,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
      boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0, 0, 0, 0.045)' }],
      elevation: 1,
    },

    kpiCardMobile: {
      width: '48%',
    },

    kpiCardWide: {
      flex: 1,
    },

    kpiTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 8,
    },

    kpiLabel: {
      fontSize: 10,
      fontFamily: fonts.bold,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      flex: 1,
      paddingRight: 4,
    },

    kpiIconBox: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },

    kpiIconText: {
      fontSize: 16,
    },

    kpiValue: {
      fontSize: 34,
      fontFamily: fonts.display,
      lineHeight: 38,
      letterSpacing: -1,
    },

    kpiDelta: {
      fontSize: 11,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },

    oneCol: {
      gap: 22,
    },

    twoCol: {
      flexDirection: 'row',
      gap: 22,
      alignItems: 'flex-start',
    },

    col: {
      flex: 1,
      gap: 22,
    },

    section: {
      gap: 12,
    },

    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: 12,
    },

    sectionHeaderText: {
      flex: 1,
    },

    sectionTitle: {
      fontSize: 22,
      fontFamily: fonts.display,
      color: colors.text,
      lineHeight: 28,
    },

    sectionSub: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      marginTop: 1,
    },

    sectionMore: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.primary,
      paddingTop: 4,
    },

    listCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0, 0, 0, 0.045)' }],
      elevation: 1,
    },

    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: 16,
    },

    apptRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },

    apptTimeCol: {
      minWidth: 48,
      flexShrink: 0,
      alignItems: 'flex-start',
    },

    apptTimeMain: {
      fontSize: 18,
      fontFamily: fonts.display,
      color: colors.primary,
      lineHeight: 22,
    },

    apptTimeSub: {
      fontSize: 10,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
      marginTop: 1,
    },

    apptInfo: {
      flex: 1,
    },

    apptName: {
      fontSize: 14,
      fontFamily: fonts.bold,
      color: colors.text,
    },

    apptType: {
      fontSize: 12,
      fontFamily: fonts.body,
      color: colors.textSecondary,
      marginTop: 1,
    },

    statusBadge: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 20,
      flexShrink: 0,
    },

    confirmedBadge: {
      backgroundColor: colors.successLight,
    },

    pendingBadge: {
      backgroundColor: colors.secondaryLight,
    },

    statusText: {
      fontSize: 11,
      fontFamily: fonts.medium,
    },

    confirmedText: {
      color: colors.success,
    },

    pendingText: {
      color: colors.secondary,
    },

    followupRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 10,
    },

    followupDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      marginTop: 6,
      flexShrink: 0,
    },

    followupInfo: {
      flex: 1,
    },

    followupName: {
      fontSize: 14,
      fontFamily: fonts.bold,
      color: colors.text,
    },

    followupTask: {
      fontSize: 12,
      fontFamily: fonts.body,
      color: colors.textSecondary,
      marginTop: 1,
    },

    followupDue: {
      fontSize: 11,
      fontFamily: fonts.medium,
      marginTop: 4,
    },

    emptyDay: {
      alignItems: 'center',
      paddingVertical: 48,
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },

    emptyDayEmoji: {
      fontSize: 40,
    },

    emptyDayTitle: {
      fontSize: 20,
      fontFamily: fonts.display,
      color: colors.primary,
    },

    emptyDaySub: {
      fontSize: 13,
      fontFamily: fonts.body,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 20,
    },

    demoCard: {
      backgroundColor: colors.primaryLight,
      borderRadius: 16,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderWidth: 1,
      borderColor: colors.primaryLighter,
    },

    demoCardLeft: {
      flex: 1,
      gap: 3,
    },

    demoCardTitle: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: colors.primary,
    },

    demoCardSub: {
      fontSize: 12,
      fontFamily: fonts.body,
      color: colors.textSecondary,
      lineHeight: 17,
    },

    demoLoadBtn: {
      backgroundColor: colors.primaryAction,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
      minWidth: 80,
      alignItems: 'center',
    },

    demoLoadBtnText: {
      fontSize: 13,
      fontFamily: fonts.semibold,
      color: '#ffffff',
    },

    demoBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceContainerLow,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },

    demoBannerText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.textSecondary,
    },

    demoBannerReset: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.primary,
    },

    demoBannerDelete: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.danger,
    },

    demoLink: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },

    demoLinkText: {
      fontSize: 12,
      fontFamily: fonts.medium,
      color: colors.textTertiary,
    },

    demoErrorText: {
      fontSize: 13,
      fontFamily: fonts.medium,
      color: colors.danger,
    },

    actionCenter: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 16 },
    actionCenterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    actionCenterTitle: { fontSize: 20, fontFamily: fonts.display, color: colors.text },
    actionCenterSub: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 3 },
    actionCenterTotal: { minWidth: 40, textAlign: 'center', fontSize: 22, fontFamily: fonts.display, color: colors.primary, backgroundColor: colors.primaryLight, borderRadius: 14, paddingVertical: 7 },
    actionGroup: { gap: 4 },
    actionGroupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 5 },
    actionGroupTitle: { fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
    actionGroupCount: { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 52, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border },
    actionKindDot: { width: 8, height: 8, borderRadius: 4 },
    actionRowText: { flex: 1 }, actionClient: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    actionDetail: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 2 },
    actionArrow: { color: colors.primary, fontSize: 18 }, actionMore: { textAlign: 'center', fontSize: 12, color: colors.textTertiary, paddingTop: 4 },

    priorityStrip: {
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 18,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },

    priorityStripTitle: {
      fontSize: 11,
      fontFamily: fonts.bold,
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },

    priorityRow: {
      gap: 8,
    },

    priorityItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1.5,
    },

    priorityCount: {
      fontSize: 22,
      fontFamily: fonts.display,
      lineHeight: 26,
    },

    priorityLabel: {
      fontSize: 12,
      fontFamily: fonts.medium,
      flex: 1,
    },

    allClearRow: {
      backgroundColor: colors.successLight,
      borderRadius: 14,
      paddingVertical: 14,
      paddingHorizontal: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.success,
    },

    allClearText: {
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: colors.success,
    },

    oppCard: {
      backgroundColor: colors.card,
      borderRadius: 18,
      paddingVertical: 16,
      paddingHorizontal: 18,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderWidth: 1,
      borderColor: colors.border,
      boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0, 0, 0, 0.04)' }],
      elevation: 1,
    },

    oppEmoji: {
      fontSize: 22,
      width: 34,
      textAlign: 'center',
    },

    oppTitle: {
      flex: 1,
      fontSize: 14,
      fontFamily: fonts.semibold,
      color: colors.text,
      lineHeight: 20,
    },

    oppAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },

    oppActionText: {
      fontSize: 13,
      fontFamily: fonts.semibold,
      color: colors.primary,
    },

    oppArrow: {
      fontSize: 14,
      color: colors.primary,
    },

    pipelineWrap: {
      gap: 10,
    },

    pipelineLabel: {
      fontSize: 11,
      fontFamily: fonts.bold,
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },

    pipelineRow: {
      gap: 8,
      paddingBottom: 2,
    },

    pipelinePill: {
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 14,
      minWidth: 72,
      gap: 3,
    },

    pipelinePillCount: {
      fontSize: 22,
      fontFamily: fonts.display,
      lineHeight: 26,
      letterSpacing: -0.5,
    },

    pipelinePillLabel: {
      fontSize: 10,
      fontFamily: fonts.semibold,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      opacity: 0.85,
    },

    goalRow: {
      padding: 16,
      gap: 8,
    },

    goalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
    },

    goalTitle: {
      fontSize: 14,
      fontFamily: fonts.medium,
      color: colors.text,
      flex: 1,
    },

    goalValue: {
      fontSize: 14,
      fontFamily: fonts.semibold,
    },

    goalTrack: {
      height: 6,
      backgroundColor: colors.bgDim,
      borderRadius: 3,
      overflow: 'hidden',
    },

    goalProgress: {
      height: 6,
      borderRadius: 3,
    },
  })
}
