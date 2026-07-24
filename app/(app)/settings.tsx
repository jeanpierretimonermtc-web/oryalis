import { useState, useCallback, useMemo } from 'react'
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native'
import { Stack, router, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { useGoogleCalendar } from '@/features/appointments/useGoogleCalendar'
import { useDemoState } from '@/features/demo/DemoProvider'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import type { LineIconName } from '@/shared/components/ui/LineIcon'
import { getMyAppRole, type AppRole } from '@/features/admin/adminService'

const SETTINGS_WIDE_BREAKPOINT = 900

function nameInitials(name: string) {
  const p = (name ?? '').trim().split(' ').filter(Boolean)
  if (!p.length) return '?'
  if (p.length === 1) return p[0][0].toUpperCase()
  return (p[0][0] + p[p.length - 1][0]).toUpperCase()
}

interface Accent { fg: string; bg: string }

function NavRow({ icon, title, desc, meta, onPress, styles, colors, danger, accent }: {
  icon: LineIconName
  title: string
  desc?: string
  meta?: string
  onPress: () => void
  styles: ReturnType<typeof makeStyles>
  colors: ThemeColors
  danger?: boolean
  accent?: Accent
}) {
  const iconBg = danger ? colors.dangerLight : accent?.bg ?? colors.bgDim
  const iconFg = danger ? colors.danger : accent?.fg ?? colors.primary
  return (
    <TouchableOpacity style={styles.navRow} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.navIconWrap, { backgroundColor: iconBg }]}>
        <LineIcon name={icon} size={18} color={iconFg} strokeWidth={2.15} />
      </View>
      <View style={styles.navBody}>
        <Text style={[styles.navTitle, danger && { color: colors.danger }]}>{title}</Text>
        {desc ? <Text style={styles.navDesc}>{desc}</Text> : null}
      </View>
      {meta ? <View style={styles.navMetaBadge}><Text style={styles.navMetaText}>{meta}</Text></View> : null}
      {!danger && <LineIcon name="chevronRight" size={18} color={colors.textTertiary} strokeWidth={2.2} />}
    </TouchableOpacity>
  )
}

function GroupLabel({ label, styles, dotColor }: { label: string; styles: ReturnType<typeof makeStyles>; dotColor?: string }) {
  return (
    <View style={styles.groupLabelRow}>
      {dotColor ? <View style={[styles.groupDot, { backgroundColor: dotColor }]} /> : null}
      <Text style={styles.groupLabel}>{label.toUpperCase()}</Text>
    </View>
  )
}

export default function SettingsMenuScreen() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors, mode, toggleTheme } = useTheme()
  const { width } = useWindowDimensions()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { profile: businessProfile, isModuleActive } = useAppConfig()
  const { isConnected: gcConnected } = useGoogleCalendar()
  const { hideDemoCard, setHideDemoCard } = useDemoState()

  const [fullName, setFullName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [bio, setBio] = useState('')
  const [phone, setPhone] = useState('')
  const [website, setWebsite] = useState('')
  const [linkedin, setLinkedin] = useState('')
  const [company, setCompany] = useState('')
  const [city, setCity] = useState('')
  const [locale, setLocale] = useState('fr')
  const [timezone, setTimezone] = useState('Europe/Paris')
  const [plan, setPlan] = useState('free')
  const [loading, setLoading] = useState(true)
  const [appRole, setAppRole] = useState<AppRole | null>(null)

  useFocusEffect(useCallback(() => {
    let active = true
    getMyAppRole().then(role => { if (active) setAppRole(role) }).catch(() => {})
    return () => { active = false }
  }, []))

  const loadProfile = useCallback(() => {
    if (!session?.user.id) {
      setLoading(false)
      return
    }
    let active = true
    ;(async () => {
      try {
        const { data } = await supabase.from('profiles')
          .select('full_name, specialty, avatar_url, bio, phone, website, linkedin_url, company, city, locale, timezone, plan')
          .eq('id', session.user.id)
          .single()
        if (active && data) {
          setFullName(data.full_name ?? '')
          setSpecialty(data.specialty ?? '')
          setAvatarUrl(data.avatar_url ?? '')
          setBio(data.bio ?? '')
          setPhone(data.phone ?? '')
          setWebsite(data.website ?? '')
          setLinkedin(data.linkedin_url ?? '')
          setCompany(data.company ?? '')
          setCity(data.city ?? '')
          setLocale(data.locale ?? 'fr')
          setTimezone(data.timezone ?? 'Europe/Paris')
          setPlan(data.plan ?? 'free')
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [session?.user.id])

  useFocusEffect(loadProfile)

  const isWide = width >= SETTINGS_WIDE_BREAKPOINT
  const initials = nameInitials(fullName || session?.user?.email || '')
  const planLabel = plan === 'pro' ? 'Pro' : plan === 'cabinet' ? 'Cabinet' : t('settings.plan_free')
  const displayName = fullName || session?.user?.email || t('settings.profile_unnamed')
  const profileFields = [fullName, specialty, avatarUrl, bio, phone, website || linkedin, company, city, locale, timezone]
  const completedFields = profileFields.filter(value => typeof value === 'string' && value.trim()).length
  const completion = Math.round((completedFields / profileFields.length) * 100)
  const missingIdentity = !fullName || !specialty || !avatarUrl
  const activeModulesCount = businessProfile.active_modules?.length ?? 0
  const previewMeta = [specialty, company, city].filter(Boolean).join(' / ')
  const nextProfilePath = !fullName || !specialty || !avatarUrl
    ? '/(app)/settings-identity'
    : !phone && !website && !linkedin
      ? '/(app)/settings-contact'
      : !company && !city
        ? '/(app)/settings-org'
        : '/(app)/settings-language'
  const nav = (path: string) => () => router.push(path as any)

  if (loading) return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.loader}><ActivityIndicator color={colors.primary} /></View>
    </>
  )

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{t('settings.title')}</Text>
          <Text style={styles.pageSubtitle}>{t('settings.subtitle')}</Text>
        </View>

        <View style={[styles.shell, isWide && styles.shellWide]}>
          <View style={[styles.profileColumn, isWide && styles.profileColumnWide]}>
            <View style={styles.hero}>
              <View style={styles.heroBrandStrip}>
                <View style={[styles.heroBrandSeg, { backgroundColor: colors.secondary }]} />
                <View style={[styles.heroBrandSeg, { backgroundColor: colors.primary }]} />
                <View style={[styles.heroBrandSeg, { backgroundColor: colors.tertiary }]} />
              </View>
              <View style={styles.heroBody}>
              <View style={styles.heroTop}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={styles.heroAvatar} />
                ) : (
                  <View style={styles.heroAvatarPlaceholder}>
                    <Text style={styles.heroInitials}>{initials}</Text>
                  </View>
                )}
                <View style={styles.heroInfo}>
                  <Text style={styles.heroEyebrow}>{t('settings.professional_identity')}</Text>
                  <Text style={styles.heroName} numberOfLines={2}>{displayName}</Text>
                  <Text style={styles.heroSpecialty} numberOfLines={2}>
                    {specialty || t('settings.specialty_placeholder')}
                  </Text>
                </View>
              </View>

              <View style={styles.heroMetaGrid}>
                <View style={styles.heroMetaItem}>
                  <Text style={styles.heroMetaLabel}>{t('settings.company')}</Text>
                  <Text style={styles.heroMetaValue} numberOfLines={1}>{company || t('settings.not_configured')}</Text>
                </View>
                <View style={styles.heroMetaItem}>
                  <Text style={styles.heroMetaLabel}>{t('settings.city')}</Text>
                  <Text style={styles.heroMetaValue} numberOfLines={1}>{city || t('settings.not_configured')}</Text>
                </View>
              </View>

              <View style={styles.heroBadges}>
                <View style={styles.heroPlanBadge}>
                  <Text style={styles.heroPlanText}>{planLabel}</Text>
                </View>
                <View style={[styles.heroPlanBadge, gcConnected ? styles.successBadge : styles.neutralBadge]}>
                  <Text style={[styles.heroPlanText, gcConnected ? styles.successText : styles.neutralText]}>
                    {gcConnected ? t('settings.connected') : t('settings.not_connected')}
                  </Text>
                </View>
              </View>
              </View>
            </View>

            <View style={styles.completionCard}>
              <View style={styles.completionTop}>
                <View style={styles.completionText}>
                  <Text style={styles.cardTitle}>{t('settings.profile_completion')}</Text>
                  <Text style={styles.cardDesc}>
                    {missingIdentity ? t('settings.profile_completion_desc') : t('settings.profile_ready_desc')}
                  </Text>
                </View>
                <Text style={styles.completionValue}>{completion}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${completion}%` }]} />
              </View>
              <TouchableOpacity style={styles.secondaryAction} onPress={nav(nextProfilePath)} activeOpacity={0.8}>
                <Text style={styles.secondaryActionText}>{t('settings.complete_profile')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.previewCard}>
              <Text style={styles.cardTitle}>{t('settings.profile_preview_title')}</Text>
              <Text style={styles.previewName}>{displayName}</Text>
              <Text style={styles.previewMeta}>{previewMeta || t('settings.profile_preview_empty')}</Text>
              <Text style={styles.previewBody} numberOfLines={4}>
                {bio || t('settings.profile_preview_desc')}
              </Text>
            </View>
          </View>

          <View style={styles.settingsColumn}>
            <View style={styles.statusGrid}>
              <View style={styles.statusCard}>
                <View style={[styles.statusIcon, { backgroundColor: colors.tertiaryLight }]}><LineIcon name="modules" size={16} color={colors.tertiary} strokeWidth={2.2} /></View>
                <View>
                  <Text style={styles.statusValue}>{activeModulesCount}</Text>
                  <Text style={styles.statusLabel}>{t('settings.active_modules')}</Text>
                </View>
              </View>
              <View style={styles.statusCard}>
                <View style={[styles.statusIcon, { backgroundColor: colors.secondaryLight }]}><LineIcon name="calendar" size={16} color={colors.secondary} strokeWidth={2.2} /></View>
                <View>
                  <Text style={styles.statusValue}>{gcConnected ? t('settings.yes_short') : t('settings.no_short')}</Text>
                  <Text style={styles.statusLabel}>Google Agenda</Text>
                </View>
              </View>
              <View style={styles.statusCard}>
                <View style={[styles.statusIcon, { backgroundColor: colors.primaryLight }]}><LineIcon name="subscription" size={16} color={colors.primary} strokeWidth={2.2} /></View>
                <View>
                  <Text style={styles.statusValue}>{planLabel}</Text>
                  <Text style={styles.statusLabel}>{t('settings.current_plan')}</Text>
                </View>
              </View>
            </View>

            <View style={styles.group}>
              <GroupLabel label={t('settings.nav_profile')} styles={styles} dotColor={colors.primary} />
              <NavRow icon="identity" title={t('settings.section_identity')} desc={t('settings.identity_desc')} meta={missingIdentity ? t('settings.to_complete') : undefined} onPress={nav('/(app)/settings-identity')} styles={styles} colors={colors} />
              <View style={styles.sep} />
              <NavRow icon="contact" title={t('settings.section_contact')} desc={t('settings.contact_desc')} onPress={nav('/(app)/settings-contact')} styles={styles} colors={colors} />
              <View style={styles.sep} />
              <NavRow icon="org" title={t('settings.section_org')} desc={t('settings.org_desc')} onPress={nav('/(app)/settings-org')} styles={styles} colors={colors} />
              <View style={styles.sep} />
              <NavRow icon="language" title={t('settings.nav_preferences')} desc={t('settings.preferences_desc')} meta={locale.toUpperCase()} onPress={nav('/(app)/settings-language')} styles={styles} colors={colors} />
            </View>

            <View style={styles.group}>
              <GroupLabel label={t('settings.nav_crm')} styles={styles} dotColor={colors.tertiary} />
              <NavRow icon="activity" title={t('settings.section_activity')} desc={t('settings.activity_desc')} onPress={nav('/(app)/settings-activity')} styles={styles} colors={colors} accent={{ fg: colors.tertiary, bg: colors.tertiaryLight }} />
              <View style={styles.sep} />
              <NavRow icon="modules" title={t('settings.section_modules')} desc={t('settings.modules_desc')} meta={String(activeModulesCount)} onPress={nav('/(app)/settings-modules')} styles={styles} colors={colors} accent={{ fg: colors.tertiary, bg: colors.tertiaryLight }} />
              <View style={styles.sep} />
              <NavRow icon="activity" title={t('settings.section_automations')} desc={t('settings.automations_desc')} onPress={nav('/(app)/settings-automations')} styles={styles} colors={colors} accent={{ fg: colors.tertiary, bg: colors.tertiaryLight }} />
              <View style={styles.sep} />
              <NavRow icon="labels" title={t('settings.section_labels')} desc={t('settings.labels_desc')} onPress={nav('/(app)/settings-labels')} styles={styles} colors={colors} accent={{ fg: colors.tertiary, bg: colors.tertiaryLight }} />
              <View style={styles.sep} />
              <NavRow icon="import" title={t('settings.nav_import')} desc={t('settings.import_short_desc')} onPress={nav('/(app)/import')} styles={styles} colors={colors} accent={{ fg: colors.tertiary, bg: colors.tertiaryLight }} />
              <View style={styles.sep} />
              <NavRow icon="import" title={t('settings.export_contacts')} desc={t('settings.export_contacts_desc')} onPress={nav('/(app)/export')} styles={styles} colors={colors} accent={{ fg: colors.tertiary, bg: colors.tertiaryLight }} />
              {isModuleActive('goals') && (
                <>
                  <View style={styles.sep} />
                  <NavRow icon="goals" title={t('goals.title')} desc={t('settings.nav_goals_desc')} onPress={nav('/(app)/goals')} styles={styles} colors={colors} accent={{ fg: colors.tertiary, bg: colors.tertiaryLight }} />
                </>
              )}
            </View>

            <View style={styles.group}>
              <GroupLabel label={t('settings.nav_integrations')} styles={styles} dotColor={colors.secondary} />
              <NavRow icon="calendar" title="Google Agenda" desc={gcConnected ? t('settings.connected') : t('settings.not_connected')} meta={gcConnected ? t('settings.ok_short') : undefined} onPress={nav('/(app)/settings-google')} styles={styles} colors={colors} accent={{ fg: colors.secondary, bg: colors.secondaryLight }} />
              <View style={styles.sep} />
              <NavRow icon="catalogs" title={t('settings.section_catalogs')} desc={t('settings.catalogs_desc')} onPress={nav('/(app)/settings-catalogs')} styles={styles} colors={colors} accent={{ fg: colors.secondary, bg: colors.secondaryLight }} />
            </View>

            <View style={styles.group}>
              <GroupLabel label={t('settings.nav_display')} styles={styles} />
              <View style={styles.navRow}>
                <View style={styles.navIconWrap}><LineIcon name="display" size={18} color={colors.primary} strokeWidth={2.15} /></View>
                <View style={styles.navBody}>
                  <Text style={styles.navTitle}>{t('settings.dark_mode')}</Text>
                  <Text style={styles.navDesc}>{t('settings.dark_mode_desc')}</Text>
                </View>
                <Switch value={mode === 'dark'} onValueChange={toggleTheme}
                  trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.card} />
              </View>
              <View style={styles.sep} />
              <View style={styles.navRow}>
                <View style={styles.navIconWrap}><LineIcon name="demo" size={18} color={colors.primary} strokeWidth={2.15} /></View>
                <View style={styles.navBody}>
                  <Text style={styles.navTitle}>{t('settings.hide_demo')}</Text>
                  <Text style={styles.navDesc}>{t('settings.hide_demo_desc')}</Text>
                </View>
                <Switch value={hideDemoCard} onValueChange={v => setHideDemoCard(v)}
                  trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.card} />
              </View>
              <View style={styles.sep} />
              <NavRow icon="subscription" title={t('settings.subscription')} desc={planLabel} onPress={nav('/(app)/settings-display')} styles={styles} colors={colors} />
            </View>

            <View style={[styles.group, { marginBottom: 8 }]}>
              <GroupLabel label={t('settings.section_account')} styles={styles} />
              <NavRow icon="shield" title={t('settings.support_access_title')} desc={t('settings.support_access_desc')} onPress={nav('/(app)/settings-support-access')} styles={styles} colors={colors} />
              {appRole === 'owner' ? (
                <>
                  <View style={styles.sep} />
                  <NavRow icon="shield" title={t('settings.owner_admin_title')} desc={t('settings.owner_admin_desc')} meta="OWNER" onPress={nav('/(app)/settings-owner')} styles={styles} colors={colors} />
                </>
              ) : null}
              <View style={styles.sep} />
              <NavRow icon="logout" title={t('auth.logout')} onPress={() => supabase.auth.signOut()} styles={styles} colors={colors} danger />
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.version}>Oryalis v1.0.0</Text>
        </View>
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  container: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 40, maxWidth: 1180, alignSelf: 'center', width: '100%' },

  pageHeader: { marginBottom: 18, gap: 4 },
  pageTitle: { fontSize: 28, fontFamily: fonts.display, color: colors.text },
  pageSubtitle: { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary },

  shell: { gap: 14 },
  shellWide: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  profileColumn: { gap: 12 },
  profileColumnWide: { width: 360 },
  settingsColumn: { flex: 1, gap: 12 },

  hero: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0, 0, 0, 0.04)' }],
    elevation: 2,
  },
  heroBrandStrip: { flexDirection: 'row', height: 4 },
  heroBrandSeg:   { flex: 1 },
  heroBody:       { padding: 18, gap: 16 },
  heroTop: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  heroAvatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: colors.primaryLight },
  heroAvatarPlaceholder: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  heroInitials: { fontSize: 24, fontFamily: fonts.bold, color: colors.textInverse },
  heroInfo: { flex: 1, gap: 3 },
  heroEyebrow: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 0.6, textTransform: 'uppercase' },
  heroName: { fontSize: 20, fontFamily: fonts.bold, color: colors.text, lineHeight: 25 },
  heroSpecialty: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  heroMetaGrid: { flexDirection: 'row', gap: 10 },
  heroMetaItem: { flex: 1, backgroundColor: colors.bgDim, borderRadius: 12, padding: 10, gap: 2 },
  heroMetaLabel: { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroMetaValue: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  heroBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroPlanBadge: { backgroundColor: colors.primaryLight, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  heroPlanText: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },
  successBadge: { backgroundColor: colors.successLight },
  successText: { color: colors.success },
  neutralBadge: { backgroundColor: colors.bgDim },
  neutralText: { color: colors.textSecondary },

  completionCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
  },
  completionTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' },
  completionText: { flex: 1, gap: 4 },
  completionValue: { fontSize: 28, fontFamily: fonts.bold, color: colors.primary },
  cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  cardDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17 },
  progressTrack: { height: 8, backgroundColor: colors.bgDim, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 999 },
  secondaryAction: { borderRadius: 12, backgroundColor: colors.primaryLight, paddingVertical: 12, alignItems: 'center' },
  secondaryActionText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },

  previewCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  previewName: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  previewMeta: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  previewBody: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19 },

  statusGrid: { flexDirection: 'row', gap: 10 },
  statusCard: { flex: 1, minWidth: 0, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 8 },
  statusIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  statusValue: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  statusLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },

  group: {
    backgroundColor: colors.card,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 5, color: 'rgba(0, 0, 0, 0.03)' }],
    elevation: 1,
  },
  groupLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 5,
  },
  groupDot: { width: 6, height: 6, borderRadius: 3 },
  groupLabel: {
    fontSize: 11,
    fontFamily: fonts.bold,
    color: colors.textTertiary,
    letterSpacing: 0.8,
  },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 62 },

  navRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  navIconWrap: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.bgDim, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  navBody: { flex: 1, gap: 2, minWidth: 0 },
  navTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  navDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 16 },
  navMetaBadge: { backgroundColor: colors.bgDim, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  navMetaText: { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary },

  footer: { alignItems: 'center', paddingVertical: 14 },
  version: { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary },
  })
}
