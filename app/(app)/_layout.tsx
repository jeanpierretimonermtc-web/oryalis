import { useEffect, useMemo, useState } from 'react'
import { Tabs, Redirect, usePathname, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { StatusBar } from 'expo-status-bar'
import { View, Text, Image, TouchableOpacity, StyleSheet, useWindowDimensions, ActivityIndicator } from 'react-native'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import { DemoProvider, useDemoState } from '@/features/demo/DemoProvider'
import { CatalogPrefsProvider } from '@/features/catalogs/CatalogPrefsProvider'
import { useCalendarSetup } from '@/features/appointments/useCalendarSetup'
import { useCalendarForegroundSync } from '@/features/appointments/useCalendarForegroundSync'
import { useNotificationSetup } from '@/features/notifications/useNotifications'
import { useSecurityNotifications } from '@/features/security/useSecurityNotifications'
import { AppConfigProvider, useAppConfig } from '@/features/settings/AppConfigProvider'
import type { ModuleKey } from '@/shared/lib/types'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

const SIDEBAR_BREAKPOINT = 768

const NAV_ITEMS: { segment: string; icon: string; labelKey: string; module?: string }[] = [
  { segment: '',             icon: '🏠', labelKey: 'dashboard.title'    },
  { segment: 'clients',      icon: '👥', labelKey: 'clients.title'      },
  { segment: 'appointments', icon: '📅', labelKey: 'appointments.title' },
  { segment: 'followups',    icon: '🔔', labelKey: 'followups.title'    },
  { segment: 'network',      icon: '🌐', labelKey: 'network.title',     module: 'downline'  },
  { segment: 'orders',       icon: '🛒', labelKey: 'orders.title'       },
  { segment: 'catalog',      icon: '📦', labelKey: 'catalog.title',     module: 'products'  },
  { segment: 'settings',     icon: '👤', labelKey: 'settings.title'     },
]

const TAB_ROUTES_BASE: { name: string; icon: string; path: string; module?: string }[] = [
  { name: 'index',        icon: '🏠', path: '/'             },
  { name: 'clients',      icon: '👥', path: '/clients'      },
  { name: 'appointments', icon: '📅', path: '/appointments' },
  { name: 'followups',    icon: '🔔', path: '/followups'    },
  { name: 'catalog',      icon: '📦', path: '/catalog',      module: 'products'  },
  { name: 'network',      icon: '🌐', path: '/network',      module: 'downline'  },
]

// ── Custom floating tab bar ─────────────────────────────────────────────────

type TabRoute = typeof TAB_ROUTES_BASE[0]

function CustomTabBar({ insets }: { insets?: any }) {
  const { width } = useWindowDimensions()
  const pathname  = usePathname()
  const { colors } = useTheme()
  const { isModuleActive } = useAppConfig()
  const tabStyles = useMemo(() => makeTabStyles(colors), [colors])

  const routes = TAB_ROUTES_BASE.filter(r => !r.module || isModuleActive(r.module as ModuleKey))

  if (width >= SIDEBAR_BREAKPOINT) return null

  function isTabActive(tab: TabRoute) {
    if (tab.name === 'index') return pathname === '/'
    return pathname === tab.path || pathname.startsWith(tab.path + '/')
  }

  return (
    <View style={[tabStyles.wrapper, { paddingBottom: Math.max(insets?.bottom ?? 0, 12) }]}>
      <View style={tabStyles.bar}>
        {routes.map(tab => {
          const isFocused = isTabActive(tab)
          return (
            <TouchableOpacity
              key={tab.name}
              style={tabStyles.tab}
              onPress={() => { if (!isFocused) router.push(tab.path as any) }}
              activeOpacity={0.75}
            >
              <View style={[tabStyles.iconWrap, isFocused && tabStyles.iconWrapActive]}>
                <Text style={[tabStyles.icon, isFocused && tabStyles.iconActive]}>{tab.icon}</Text>
              </View>
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )
}

function makeTabStyles(colors: ThemeColors) {
  return StyleSheet.create({
  wrapper: {
    backgroundColor: 'transparent',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 28,
    paddingVertical: 8,
    paddingHorizontal: 6,
    boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 20, color: 'rgba(0, 0, 0, 0.1)' }],
    elevation: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 52,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: colors.primaryLight,
  },
  icon: {
    fontSize: 22,
    opacity: 0.5,
  },
  iconActive: {
    opacity: 1,
  },
  })
}

// ── Sidebar (web ≥768px) ────────────────────────────────────────────────────

function Sidebar({ pathname }: { pathname: string }) {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors, mode } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { demoCount, demoLoading, demoFailed, checkDemo, handleLoadDemo, handleDeleteDemo } = useDemoState()
  const { isModuleActive } = useAppConfig()
  const visibleNavItems = NAV_ITEMS.filter(item => !item.module || isModuleActive(item.module as ModuleKey))

  useEffect(() => { checkDemo() }, [checkDemo, pathname])

  async function toggleDemo() {
    if (demoCount > 0) {
      await handleDeleteDemo()
    } else {
      await handleLoadDemo()
    }
    router.replace('/')
  }

  function isActive(segment: string) {
    if (segment === '') return pathname === '/'
    return pathname === '/' + segment || pathname.startsWith('/' + segment + '/')
  }

  function navigate(segment: string) {
    router.push(segment === '' ? '/' : ('/' + segment) as any)
  }

  const firstName = session?.user?.user_metadata?.full_name?.split(' ')[0] ?? session?.user?.email ?? ''

  return (
    <View style={styles.sidebar}>
      <View style={styles.sidebarTop}>
        <View style={styles.sidebarHeader}>
          <Image source={require('@/assets/logo-icon.png')} style={styles.sidebarLogo} resizeMode="contain" />
          <Image
            source={mode === 'dark' ? require('@/assets/wordmark-dark.png') : require('@/assets/wordmark-day.png')}
            style={styles.sidebarWordmark}
            resizeMode="contain"
          />
        </View>

        <View style={styles.sidebarNav}>
          {visibleNavItems.map(item => {
            const active = isActive(item.segment)
            return (
              <TouchableOpacity
                key={item.segment}
                style={[styles.navItem, active && styles.navItemActive]}
                onPress={() => navigate(item.segment)}
                activeOpacity={0.7}
              >
                <Text style={styles.navIcon}>{item.icon}</Text>
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                  {t(item.labelKey)}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>
      </View>

      <View style={styles.sidebarFooter}>
        <View style={styles.userRow}>
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarText}>{firstName.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.userName} numberOfLines={1}>{firstName}</Text>
        </View>
        <TouchableOpacity style={styles.demoBtn} onPress={toggleDemo} disabled={demoLoading} activeOpacity={0.7}>
          {demoLoading
            ? <ActivityIndicator size="small" color={colors.textSecondary} style={{ marginLeft: 4 }} />
            : <>
                <Text style={styles.demoIcon}>🧪</Text>
                <Text style={[styles.demoText, demoCount > 0 && styles.demoTextActive]}>
                  {demoCount > 0 ? t('dashboard.demo_delete') : t('dashboard.demo_load')}
                </Text>
              </>
          }
        </TouchableOpacity>
        {demoFailed ? <Text style={styles.demoErrText}>{t('common.error')}</Text> : null}
        <TouchableOpacity style={styles.logoutBtn} onPress={() => supabase.auth.signOut()} activeOpacity={0.7}>
          <Text style={styles.logoutIcon}>↩</Text>
          <Text style={styles.logoutText}>{t('auth.logout')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

// ── Root layout ─────────────────────────────────────────────────────────────

export default function AppLayout() {
  const { session, loading } = useAuth()
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { width } = useWindowDimensions()
  const pathname = usePathname()
  const isWide = width >= SIDEBAR_BREAKPOINT
  const isRootRoute = pathname === '/' || pathname === '/clients' || pathname === '/appointments' || pathname === '/followups' || pathname === '/network' || pathname === '/catalog'

  useCalendarSetup()
  useCalendarForegroundSync()
  useNotificationSetup()
  useSecurityNotifications(session)


  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  const [avatarUrl, setAvatarUrl]   = useState<string | null>(null)
  const [profileName, setProfileName] = useState<string>('')

  useEffect(() => {
    if (!session) { setOnboardingDone(null); return }
    ;(async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('onboarding_completed, avatar_url, full_name')
          .eq('id', session.user.id)
          .single()
        setOnboardingDone(data?.onboarding_completed ?? false)
        setAvatarUrl(data?.avatar_url ?? null)
        setProfileName(data?.full_name ?? '')
      } catch {
        setOnboardingDone(true)
      }
    })()
  }, [session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <View style={styles.loader}>
      <ActivityIndicator color={colors.primary} />
    </View>
  )
  if (!session) return <Redirect href="/(auth)/login" />
  if (onboardingDone === null) return (
    <View style={styles.loader}>
      <ActivityIndicator color={colors.primary} />
    </View>
  )
  if (!onboardingDone) return <Redirect href="/(auth)/onboarding" />

  const displayName = profileName || session?.user?.user_metadata?.full_name || session?.user?.email || ''
  const initials = (() => {
    const parts = displayName.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return '?'
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  })()

  return (
    <CatalogPrefsProvider>
    <DemoProvider>
    <AppConfigProvider>
      <View style={[styles.root, isWide && styles.rootWide]}>
        {isWide
          ? <Sidebar pathname={pathname} />
          : isRootRoute && (
            <View style={styles.mobileHeader}>
              <StatusBar style="light" />
              <View style={styles.mobileHeaderLeft}>
                <Image source={require('@/assets/logo-icon.png')} style={styles.mobileHeaderLeaf} resizeMode="contain" />
                <Image source={require('@/assets/wordmark-dark.png')} style={styles.mobileHeaderWordmark} resizeMode="contain" />
              </View>
              <View style={styles.mobileHeaderRight}>
                <TouchableOpacity onPress={() => router.push('/(app)/clients')} style={styles.mobileHeaderBtn}>
                  <Text style={styles.mobileHeaderBtnIcon}>🔍</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.mobileHeaderAvatar} onPress={() => router.push('/(app)/settings')}>
                  {avatarUrl
                    ? <Image source={{ uri: avatarUrl }} style={styles.mobileHeaderAvatarImg} />
                    : <Text style={styles.mobileHeaderAvatarText}>{initials}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          )
        }
        <View style={styles.content}>
          <Tabs
            tabBar={props => <CustomTabBar insets={props.insets} />}
            screenOptions={{ headerShown: false }}
          >
            <Tabs.Screen name="index"        options={{ title: t('dashboard.title')    }} />
            <Tabs.Screen name="clients"      options={{ title: t('clients.title')      }} />
            <Tabs.Screen name="appointments" options={{ title: t('appointments.title') }} />
            <Tabs.Screen name="followups"    options={{ title: t('followups.title')    }} />
            <Tabs.Screen name="catalog"      options={{ title: t('catalog.title')      }} />
            <Tabs.Screen name="catalog/protocols" options={{ href: null }} />
            <Tabs.Screen name="network"      options={{ title: t('network.title')      }} />
            <Tabs.Screen name="goals"        options={{ title: t('goals.title')        }} />
            <Tabs.Screen name="import"              options={{ title: t('settings.import_title'),      href: null }} />
            <Tabs.Screen name="export"              options={{ title: t('settings.export_title'),      href: null }} />
            <Tabs.Screen name="settings-subscription" options={{ href: null }} />
            <Tabs.Screen name="settings-profile"      options={{ href: null }} />
            <Tabs.Screen name="settings-identity"    options={{ href: null }} />
            <Tabs.Screen name="settings-contact"     options={{ href: null }} />
            <Tabs.Screen name="settings-org"         options={{ href: null }} />
            <Tabs.Screen name="settings-language"    options={{ href: null }} />
            <Tabs.Screen name="settings-crm"         options={{ href: null }} />
            <Tabs.Screen name="settings-activity"    options={{ href: null }} />
            <Tabs.Screen name="settings-modules"     options={{ href: null }} />
            <Tabs.Screen name="settings-automations" options={{ href: null }} />
            <Tabs.Screen name="settings-labels"      options={{ href: null }} />
            <Tabs.Screen name="settings-integrations" options={{ href: null }} />
            <Tabs.Screen name="settings-google"      options={{ href: null }} />
            <Tabs.Screen name="settings-catalogs"    options={{ href: null }} />
            <Tabs.Screen name="settings-display"     options={{ href: null }} />
            <Tabs.Screen name="settings-owner"       options={{ href: null }} />
            <Tabs.Screen name="settings-support-access" options={{ href: null }} />
            <Tabs.Screen name="orders"       options={{ title: t('orders.title')       }} />
            <Tabs.Screen name="settings"     options={{ title: t('settings.title')     }} />
          </Tabs>
        </View>
      </View>
    </AppConfigProvider>
    </DemoProvider>
    </CatalogPrefsProvider>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  root:     { flex: 1, flexDirection: 'column', backgroundColor: colors.bg },
  rootWide: { flexDirection: 'row' },
  content:  { flex: 1 },
  loader:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },

  // ── Mobile header ────────────────────────────────────────────────────────────
  mobileHeader: {
    backgroundColor: '#0F172A',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 44,
    paddingBottom: 12,
  },
  mobileHeaderLeft:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mobileHeaderLeaf:       { width: 36, height: 36 },
  mobileHeaderWordmark:   { width: 146, height: 20 },
  mobileHeaderRight:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mobileHeaderBtn:        { padding: 4 },
  mobileHeaderBtnIcon:    { fontSize: 18 },
  mobileHeaderAvatar:     { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mobileHeaderAvatarImg:  { width: 32, height: 32, borderRadius: 16 },
  mobileHeaderAvatarText: { fontSize: 12, fontFamily: fonts.bold, color: '#FFFFFF' },

  // ── Sidebar ──────────────────────────────────────────────────────────────────
  sidebar: {
    width: 240,
    backgroundColor: colors.card,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    justifyContent: 'space-between',
    paddingTop: 24,
    paddingBottom: 16,
  },
  sidebarTop:    { flex: 1 },
  sidebarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 8,
  },
  sidebarLogo:     { width: 44, height: 44 },
  sidebarWordmark: { width: 150, height: 20 },
  sidebarNav:     { paddingHorizontal: 8, paddingTop: 4, gap: 2 },

  navItem:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 10 },
  navItemActive: { backgroundColor: colors.primaryLight },
  navIcon:       { fontSize: 18 },
  navLabel:      { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  navLabelActive:{ color: colors.primary, fontFamily: fonts.semibold },

  sidebarFooter: { paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 4 },
  userRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 8, backgroundColor: colors.bg },
  userAvatar:    { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  userAvatarText:{ color: colors.textInverse, fontSize: 13, fontFamily: fonts.bold },
  userName:      { fontSize: 13, fontFamily: fonts.medium, color: colors.text, flex: 1 },

  logoutBtn:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8 },
  logoutIcon: { fontSize: 15, color: colors.textSecondary },
  logoutText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },

  demoBtn:        { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8 },
  demoIcon:       { fontSize: 14 },
  demoText:       { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  demoTextActive: { color: colors.danger },
  demoErrText:    { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, paddingHorizontal: 8 },
  })
}
