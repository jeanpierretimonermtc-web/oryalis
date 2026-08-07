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
import { Bell, Calendar, CheckCircle2, Flame, RefreshCw, AlertTriangle, ClipboardX, UserMinus } from 'lucide-react-native'
import { useAuth } from '@/features/auth/AuthProvider'
import { useDemoState } from '@/features/demo/DemoProvider'
import {
  useDashboardStats,
  usePipelineStats,
  useMonthlyRevenue,
  useAlerts,
  useDailyActions,
  buildTopPriorities,
  DAILY_PRIORITY,
} from '@/features/dashboard/useDashboard'
import type { DailyActionItem, DailyActionKind } from '@/features/dashboard/useDashboard'
import { useGoals } from '@/features/goals/useGoals'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { useUpcomingAppointments } from '@/features/appointments/useAppointments'
import { usePendingFollowups } from '@/features/followups/useFollowups'
import { LinearGradient } from 'expo-linear-gradient'
import { Avatar } from '@/shared/components/ui/Avatar'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import type { LineIconName } from '@/shared/components/ui/LineIcon'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, type ThemeColors } from '@/shared/theme/colors'
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
  variant,
  onPress,
}: {
  icon: LineIconName
  label: string
  variant: 'gradient' | 'tint'
  onPress: () => void
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  if (variant === 'gradient') {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <LinearGradient
          colors={brandColors.gradients.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.quickCard}
        >
          <LineIcon name={icon} size={18} color="#fff" strokeWidth={2.2} />
          <Text style={[styles.quickCardLabel, { color: '#fff' }]}>{label}</Text>
        </LinearGradient>
      </TouchableOpacity>
    )
  }

  return (
    <TouchableOpacity
      style={[styles.quickCard, styles.quickCardTint]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <LineIcon name={icon} size={18} color={colors.onSecondary} strokeWidth={2.2} />
      <Text style={[styles.quickCardLabel, { color: colors.onSecondary }]}>{label}</Text>
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


// Ordre d'affichage des catégories détaillées — reprend DAILY_PRIORITY (features/dashboard)
// pour rester cohérent avec le tri utilisé dans "Priorités du jour".
const DAILY_ORDER: DailyActionKind[] = (Object.keys(DAILY_PRIORITY) as DailyActionKind[])
  .sort((a, b) => DAILY_PRIORITY[a] - DAILY_PRIORITY[b])

// Une icône et une couleur d'accent par catégorie — pour que chaque groupe se
// distingue au premier coup d'œil sans avoir à lire le libellé.
const DAILY_ICON: Record<DailyActionKind, typeof Bell> = {
  overdue_followup: Bell, today_appointment: Calendar, today_action: CheckCircle2,
  overdue_task: AlertTriangle, hot_prospect: Flame, incomplete_appointment: ClipboardX,
  at_risk_client: UserMinus, renewal: RefreshCw,
}
function dailyAccent(kind: DailyActionKind, colors: ThemeColors) {
  switch (kind) {
    case 'overdue_followup':
    case 'overdue_task':          return { fg: colors.danger, bg: colors.dangerLight }
    case 'hot_prospect':          return { fg: colors.warning, bg: colors.warningLight }
    case 'renewal':               return { fg: colors.secondary, bg: colors.secondaryLight }
    case 'today_action':
    case 'incomplete_appointment':
    case 'at_risk_client':        return { fg: colors.tertiary, bg: colors.tertiaryLight }
    default:                      return { fg: colors.primary, bg: colors.primaryLight }
  }
}

// Traduit la raison structurée (reasonKey + reasonParams) d'un item — jamais de texte déjà
// traduit dans le hook, la traduction reste ici, comme pour dashboard.daily.${kind}.
function useReasonText() {
  const { t } = useTranslation()
  return (item: DailyActionItem) => {
    const params = { ...item.reasonParams }
    if (item.kind === 'hot_prospect' && typeof params.temp === 'string') {
      params.temp = t(`prospect_temperatures.${params.temp}`)
    }
    return t(`dashboard.reason.${item.reasonKey}`, params)
  }
}

// ── Priorités du jour (condensé, dédupliqué, plafonné) ──────────────────────────
// Reçoit la liste déjà calculée (plutôt que de la recalculer) pour que le dashboard puisse
// exclure exactement ces mêmes éléments de "À faire aujourd'hui" — jamais de doublon visuel.
function TopPriorities({ top, loading }: { top: DailyActionItem[]; loading: boolean }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = useLocale()
  const reasonText = useReasonText()

  if (loading) return <View style={styles.actionCenter}><ActivityIndicator color={colors.primary} /></View>

  return (
    <View style={styles.topPriorities}>
      <Text style={styles.topPrioritiesTitle}>{t('dashboard.priorities_title')}</Text>
      {top.length === 0 ? (
        <View style={styles.allClearRow}><Text style={styles.allClearText}>{t('dashboard.no_priorities')}</Text></View>
      ) : top.map(item => {
        const accent = dailyAccent(item.kind, colors)
        const Icon = DAILY_ICON[item.kind]
        const showViewFile = item.clientId && item.href !== `/(app)/clients/${item.clientId}`
        return (
          <View key={item.id} style={[styles.topPriorityCard, { borderLeftColor: accent.fg }]}>
            <TouchableOpacity style={styles.topPriorityMain} onPress={() => router.push(item.href as any)} activeOpacity={0.75}>
              <View style={[styles.actionGroupIconBox, { backgroundColor: accent.bg }]}>
                <Icon size={14} color={accent.fg} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.topPriorityHeaderRow}>
                  <Text style={styles.actionClient} numberOfLines={1}>{item.clientName || item.title}</Text>
                  <View style={[styles.topPriorityBadge, { backgroundColor: accent.bg }]}>
                    <Text style={[styles.topPriorityBadgeText, { color: accent.fg }]}>{t(`dashboard.daily.${item.kind}`)}</Text>
                  </View>
                </View>
                <Text style={styles.actionDetail}>
                  {reasonText(item)}
                  {item.at ? ` · ${formatDate(item.at, locale, { day: '2-digit', month: 'short', hour: item.kind === 'today_appointment' ? '2-digit' : undefined, minute: item.kind === 'today_appointment' ? '2-digit' : undefined })}` : ''}
                </Text>
              </View>
              <Text style={styles.actionArrow}>→</Text>
            </TouchableOpacity>
            {showViewFile ? (
              <TouchableOpacity onPress={() => router.push(`/(app)/clients/${item.clientId}` as any)} activeOpacity={0.7}>
                <Text style={styles.topPriorityViewFile}>{t('dashboard.view_file')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

function DailyActionCenter({ items, hasAnyToday, loading }: { items: DailyActionItem[]; hasAnyToday: boolean; loading: boolean }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = useLocale()
  const reasonText = useReasonText()
  if (loading) return <View style={styles.actionCenter}><ActivityIndicator color={colors.primary} /></View>

  return <View style={styles.actionCenter}>
    <View style={styles.actionCenterHeader}><View><Text style={styles.actionCenterTitle}>{t('dashboard.action_center')}</Text><Text style={styles.actionCenterSub}>{t('dashboard.action_center_sub_rest', { count: items.length })}</Text></View><Text style={styles.actionCenterTotal}>{items.length}</Text></View>
    {items.length === 0 ? (
      <View style={styles.allClearRow}>
        <Text style={styles.allClearText}>{hasAnyToday ? t('dashboard.action_center_empty_covered') : t('dashboard.no_priorities')}</Text>
      </View>
    ) : DAILY_ORDER.map(kind => {
      const group = items.filter(item => item.kind === kind)
      if (!group.length) return null
      const accent = dailyAccent(kind, colors)
      const Icon = DAILY_ICON[kind]
      return <View key={kind} style={styles.actionGroup}>
        <View style={styles.actionGroupHeader}>
          <View style={[styles.actionGroupIconBox, { backgroundColor: accent.bg }]}>
            <Icon size={13} color={accent.fg} strokeWidth={2.2} />
          </View>
          <Text style={[styles.actionGroupTitle, { color: accent.fg }]}>{t(`dashboard.daily.${kind}`)}</Text>
          <Text style={styles.actionGroupCount}>{group.length}</Text>
        </View>
        {group.slice(0, 5).map(item => <TouchableOpacity key={item.id} style={[styles.actionRow, { borderLeftColor: accent.fg }]} onPress={() => router.push(item.href as any)} activeOpacity={0.75}>
          <View style={styles.actionRowText}>
            <Text style={styles.actionClient}>{item.clientName || item.title}</Text>
            <Text style={styles.actionDetail}>
              {reasonText(item)}
              {item.at ? ` · ${formatDate(item.at, locale, { day: '2-digit', month: 'short', hour: kind === 'today_appointment' ? '2-digit' : undefined, minute: kind === 'today_appointment' ? '2-digit' : undefined })}` : ''}
            </Text>
          </View>
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
  const { loading: apptLoading, refresh: refreshAppts } = useUpcomingAppointments(10)
  const { followups, loading: fuLoading, refresh: refreshFu } = usePendingFollowups()
  const { byStage, refresh: refreshPipeline } = usePipelineStats()
  const { amount: monthRevenue, refresh: refreshRevenue } = useMonthlyRevenue()
  const { reload: refreshAlerts } = useAlerts()
  const { goals } = useGoals()
  const { isModuleActive } = useAppConfig()
  const { items: dailyActions, loading: dailyLoading, refresh: refreshDaily } = useDailyActions()

  // "Priorités du jour" (top 6, dédupliqué) et "À faire aujourd'hui" (tout le reste, par
  // catégorie) ne doivent jamais montrer le même élément deux fois — le second exclut
  // explicitement ce que le premier affiche déjà.
  const topPriorities = useMemo(() => buildTopPriorities(dailyActions, 6), [dailyActions])
  const remainingActions = useMemo(() => {
    const shown = new Set(topPriorities.map(i => i.id))
    return dailyActions.filter(item => !shown.has(item.id))
  }, [dailyActions, topPriorities])

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
  const overdueToday = followups.filter((f) => f.due_date <= todayStr)


  const activePct =
    stats.totalClients > 0 ? Math.round((stats.activeClients / stats.totalClients) * 100) : 0

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
              icon="personPlus"
              label={t('dashboard.new_client')}
              variant="gradient"
              onPress={() => router.push('/(app)/clients/new')}
            />
            <QuickCard
              icon="calendarPlus"
              label={t('dashboard.quick_appointment')}
              variant="tint"
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

        {/* ── Priorités du jour (condensé, dédupliqué) ──── */}
        <TopPriorities top={topPriorities} loading={dailyLoading} />

        {/* ── Détail par catégorie ──────────────────────── */}
        <DailyActionCenter items={remainingActions} hasAnyToday={dailyActions.length > 0} loading={dailyLoading} />

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
              router.push({ pathname: '/(app)/clients', params: { status: 'all' } } as any)
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

      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bgDim,
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
      borderRadius: 14,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignItems: 'center',
      gap: 4,
      minWidth: 84,
      boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(59, 130, 246, 0.3)' }],
      elevation: 2,
    },

    quickCardTint: {
      backgroundColor: colors.secondary,
      boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(34, 211, 238, 0.35)' }],
    },

    quickCardLabel: {
      fontSize: 10,
      fontFamily: fonts.bold,
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
    actionGroupHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 7 },
    actionGroupIconBox: { width: 22, height: 22, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
    actionGroupTitle: { flex: 1, fontSize: 12, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.5 },
    actionGroupCount: { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 52, paddingVertical: 8, paddingLeft: 10, borderTopWidth: 1, borderTopColor: colors.border, borderLeftWidth: 2.5 },
    actionRowText: { flex: 1 }, actionClient: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    actionDetail: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 2 },
    actionArrow: { color: colors.primary, fontSize: 18 }, actionMore: { textAlign: 'center', fontSize: 12, color: colors.textTertiary, paddingTop: 4 },

    topPriorities: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 12 },
    topPrioritiesTitle: { fontSize: 20, fontFamily: fonts.display, color: colors.text, marginBottom: 2 },
    topPriorityCard: { borderRadius: 12, borderLeftWidth: 3, backgroundColor: colors.bgDim, padding: 10, gap: 6 },
    topPriorityMain: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    topPriorityHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    topPriorityBadge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
    topPriorityBadgeText: { fontSize: 10, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.3 },
    topPriorityViewFile: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary, alignSelf: 'flex-end' },

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
