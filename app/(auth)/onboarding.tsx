import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { getCalendars, getLocales } from 'expo-localization'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { createClient } from '@/features/clients/clientService'
import { trackOnboardingEvent } from '@/features/onboarding/onboardingService'
import {
  applyBrandSetup, AUTOMATION_MODULES, clearSetupProgress, fetchSetupPrefill, getSetupProgress, KNOWN_BRANDS,
  saveSetupProfile, saveSetupProgress, SETUP_TOTAL_STEPS, type BrandMode,
} from '@/features/onboarding/setupService'
import { updateProfile } from '@/features/settings/profileService'
import { Input } from '@/shared/components/ui/Input'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { ContactRole, ModuleKey } from '@/shared/lib/types'
import i18n from '@/shared/i18n'

type Screen = 1 | 2 | 3 | 4 | 5 | 'summary' | 'later'
type AutomationChoice = 'order' | 'appointment' | 'no_contact'

const BRAND_MODES: BrandMode[] = ['one', 'many', 'none']
const ROLES: ContactRole[] = ['prospect', 'customer', 'distributor']
const TRACKED_MODULES: ModuleKey[] = ['products', 'renewals_lrp', 'downline', 'goals', 'calendar_sync']
const MODULE_ICONS: Partial<Record<ModuleKey, string>> = { products: '📦', renewals_lrp: '🔄', downline: '🌐', goals: '🎯', calendar_sync: '📅' }
const AUTOMATION_CHOICES: { key: AutomationChoice; icon: string; modules: ModuleKey[] }[] = [
  { key: 'order', icon: '🛒', modules: ['auto_first_order', 'auto_order'] },
  { key: 'appointment', icon: '📅', modules: ['auto_appointment'] },
  { key: 'no_contact', icon: '💤', modules: ['auto_no_contact'] },
]
const defaultModulesFor = (mode: BrandMode): ModuleKey[] =>
  mode === 'none' ? ['products', 'goals'] : ['products', 'renewals_lrp', 'downline', 'goals']

function Stepper({ step, colors }: { step: number; colors: ThemeColors }) {
  return <View style={stylesStatic.stepper}>{Array.from({ length: SETUP_TOTAL_STEPS }, (_, i) => i + 1).map(n => <View key={n} style={[stylesStatic.stepDot, { backgroundColor: step >= n ? colors.primary : colors.bgDim, borderColor: step >= n ? colors.primary : colors.border }]}><Text style={{ color: step >= n ? colors.onPrimary : colors.textTertiary, fontFamily: fonts.bold, fontSize: 12 }}>{step > n ? '✓' : n}</Text></View>)}</View>
}

export default function OnboardingScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const userId = session?.user.id
  const { resume } = useLocalSearchParams<{ resume?: string }>()
  const detectedLocale = getLocales()[0]?.languageCode === 'en' ? 'en' : 'fr'
  const detectedTimezone = getCalendars()[0]?.timeZone ?? 'Europe/Paris'

  const [screen, setScreen] = useState<Screen>(1)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState(session?.user?.user_metadata?.full_name ?? '')
  const [locale, setLocale] = useState(detectedLocale)
  const [timezone, setTimezone] = useState(detectedTimezone)
  const [brandMode, setBrandMode] = useState<BrandMode | null>(null)
  const [selectedBrands, setSelectedBrands] = useState<string[]>([])
  const [otherBrands, setOtherBrands] = useState('')
  const [modules, setModules] = useState<ModuleKey[] | null>(null)
  const [automations, setAutomations] = useState<ModuleKey[]>(AUTOMATION_MODULES)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<ContactRole>('prospect')
  const [addContact, setAddContact] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void (async () => {
      try {
        const [prefill, progress] = await Promise.all([fetchSetupPrefill(userId), getSetupProgress(userId)])
        if (cancelled) return
        if (prefill.fullName) setFullName(prefill.fullName)
        if (prefill.locale) setLocale(prefill.locale)
        if (prefill.timezone) setTimezone(prefill.timezone)
        if (resume || progress) {
          setBrandMode(prefill.mode)
          const known = prefill.brands.filter(b => KNOWN_BRANDS.includes(b))
          setSelectedBrands(known)
          setOtherBrands(prefill.brands.filter(b => !known.includes(b)).join(', '))
          if (prefill.activeModules) {
            setModules(prefill.activeModules.filter(m => TRACKED_MODULES.includes(m)))
            setAutomations(prefill.activeModules.filter(m => AUTOMATION_MODULES.includes(m)))
          }
        }
        if (progress?.step) setScreen(Math.min(progress.step, SETUP_TOTAL_STEPS) as Screen)
      } catch (e) {
        console.error('[setup.prefill]', e)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    if (!resume) void trackOnboardingEvent(userId, 'started', 1, { locale: detectedLocale, timezone: detectedTimezone })
    return () => { cancelled = true }
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = typeof screen === 'number' ? screen : SETUP_TOTAL_STEPS
  const trackedStep = Math.min(step, 3) as 1 | 2 | 3
  const chosenModules = modules ?? defaultModulesFor(brandMode ?? 'none')
  const typedBrands = otherBrands.split(',').map(b => b.trim()).filter(Boolean)
  const brandNames = brandMode === 'one' ? (selectedBrands[0] ? [selectedBrands[0]] : typedBrands.slice(0, 1)) : [...selectedBrands, ...typedBrands]

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await action() }
    catch (e) { console.error('[setup]', e); setError(e instanceof Error ? e.message : t('common.error')) }
    finally { setBusy(false) }
  }

  async function goTo(next: Screen) {
    if (userId && typeof next === 'number') await saveSetupProgress(userId, { step: next })
    setScreen(next)
  }

  const saveModules = () => saveSetupProfile(userId!, { active_modules: [...chosenModules, ...automations, 'client_import'] })

  function submitProfile() {
    if (!fullName.trim()) { setError(t('onboarding.error_name')); return }
    void run(async () => {
      await updateProfile(userId!, { full_name: fullName.trim(), locale, timezone })
      await trackOnboardingEvent(userId!, 'profile_completed', 1, {})
      await i18n.changeLanguage(locale)
      await goTo(2)
    })
  }

  function submitBrands() {
    if (!brandMode) { setError(t('onboarding.error_brand_mode')); return }
    if (brandMode !== 'none' && brandNames.length === 0) { setError(t('onboarding.error_brand')); return }
    void run(async () => {
      await applyBrandSetup(userId!, brandMode, brandNames)
      await goTo(3)
    })
  }

  const submitModules = () => run(async () => { await saveModules(); await goTo(4) })
  const submitAutomations = () => run(async () => { await saveModules(); await goTo(5) })

  function submitContact() {
    if (!firstName.trim() && !lastName.trim()) { setError(t('onboarding.error_contact')); return }
    void run(async () => {
      await createClient(userId!, {
        first_name: firstName.trim() || null, full_name: [firstName.trim(), lastName.trim()].filter(Boolean).join(' '), avatar_url: null, email: null, phone: null,
        is_vip: false, manually_inactive: false, source: null, language: locale, birth_date: null, inscription_date: new Date().toISOString().slice(0, 10), profession: null,
        children: null, interests: [], client_type: null, medical_treatment: false, medical_notes: null, particularities: null, welcome_email_sent: false,
        doterra_id: null, next_lrp_date: null, lrp_status: 'not_enrolled', lrp_loyalty_percent: null, lrp_start_date: null, lrp_frequency_value: null, lrp_frequency_unit: null, tracking_consent_at: null, address: null, loyalty_notes: null, sponsor_id: null, contact_role: [role],
        pipeline_stage: role === 'distributor' ? 'distributor' : role === 'customer' ? 'customer' : 'new_lead', country: null, timezone: null, first_contact_date: null, first_purchase_date: null,
        acquisition_source: null, next_action_date: null, next_action_type: null, referrals_count: 0, referral_count: 0, network_potential: null,
      })
      await trackOnboardingEvent(userId!, 'contact_created', 2, { role })
      setScreen('summary')
    })
  }

  async function complete(destination: '/(app)' | '/(app)/import') {
    await updateProfile(userId!, { onboarding_completed: true })
    await clearSetupProgress(userId!)
    await trackOnboardingEvent(userId!, 'completed', 3, { destination })
    router.replace(destination)
  }

  const chooseImport = () => run(async () => {
    await trackOnboardingEvent(userId!, 'import_chosen', 2)
    await complete('/(app)/import')
  })

  const configureLater = () => run(async () => {
    await updateProfile(userId!, { onboarding_completed: true })
    await saveSetupProgress(userId!, { step })
    await trackOnboardingEvent(userId!, 'completed', trackedStep, { skipped: true })
    setScreen('later')
  })

  function toggleBrand(name: string) {
    setSelectedBrands(prev => brandMode === 'one'
      ? (prev[0] === name ? [] : [name])
      : prev.includes(name) ? prev.filter(b => b !== name) : [...prev, name])
    if (brandMode === 'one') setOtherBrands('')
  }

  function chooseBrandMode(mode: BrandMode) {
    setBrandMode(mode)
    if (mode === 'one') { setSelectedBrands(prev => prev.slice(0, 1)); setOtherBrands('') }
  }

  const chip = (key: string, label: string, active: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} style={[styles.chip, active && styles.chipActive]} onPress={onPress} activeOpacity={0.75}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  )
  const toggleRow = (key: string, icon: string, title: string, desc: string, value: boolean, onChange: (v: boolean) => void) => (
    <View key={key} style={styles.toggleRow}>
      <Text style={styles.toggleIcon}>{icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDesc}>{desc}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.card} />
    </View>
  )

  if (!ready) return <View style={[styles.root, styles.center]}><Stack.Screen options={{ headerShown: false }} /><ActivityIndicator color={colors.primary} /></View>

  if (screen === 'later' || screen === 'summary') {
    const later = screen === 'later'
    const trackedLabels = chosenModules.map(m => t(`onboarding.modules.${m}_title`)).join(', ')
    return <><Stack.Screen options={{ headerShown: false }} /><ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.logo}>ORYALIS</Text>
      <View style={[styles.card, styles.cardTop]}>
        <Text style={styles.title}>{t(later ? 'onboarding.later_title' : 'onboarding.summary_title')}</Text>
        {later ? <Text style={styles.subtitle}>{t('onboarding.later_text')}</Text> : (
          <View style={styles.fields}>
            <Text style={styles.subtitle}>{t('onboarding.summary_sub')}</Text>
            <Text style={styles.summaryLine}>🏷️ {brandNames.length > 0 ? brandNames.join(', ') : t('onboarding.summary_no_brand')}</Text>
            <Text style={styles.summaryLine}>📊 {trackedLabels || t('onboarding.summary_no_module')}</Text>
            <Text style={styles.summaryLine}>🔔 {t(automations.length > 0 ? 'onboarding.summary_reminders_on' : 'onboarding.summary_reminders_off')}</Text>
            <Text style={styles.toggleDesc}>{t('onboarding.summary_hint')}</Text>
          </View>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      <Button label={t(later ? 'onboarding.later_cta' : 'onboarding.finish')} loading={busy} onPress={() => later ? router.replace('/(app)') : run(() => complete('/(app)'))} />
    </ScrollView></>
  }

  return <><Stack.Screen options={{ headerShown: false }} /><KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.logo}>ORYALIS</Text>
    <Text style={styles.counter}>{t('onboarding.step_of', { current: screen, total: SETUP_TOTAL_STEPS })}</Text>
    <Stepper step={screen} colors={colors} />
    <View style={styles.card}>
      <Text style={styles.title}>{t(`onboarding.step${screen}_title`)}</Text>
      <Text style={styles.subtitle}>{t(`onboarding.step${screen}_sub`)}</Text>

      {screen === 1 && <View style={styles.fields}>
        <Input label={t('onboarding.full_name')} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
        <Text style={styles.label}>{t('onboarding.language')}</Text>
        <View style={styles.chips}>{(['fr', 'en'] as const).map(l => chip(l, l === 'fr' ? 'Français' : 'English', locale === l, () => setLocale(l)))}</View>
        <Input label={t('onboarding.timezone')} value={timezone} onChangeText={setTimezone} autoCapitalize="none" />
      </View>}

      {screen === 2 && <View style={styles.fields}>
        <View style={styles.chips}>{BRAND_MODES.map(m => chip(m, t(`onboarding.brand_mode_${m}`), brandMode === m, () => chooseBrandMode(m)))}</View>
        {brandMode === 'one' || brandMode === 'many' ? <>
          <Text style={styles.label}>{t(brandMode === 'one' ? 'onboarding.brand_pick_one' : 'onboarding.brand_pick_many')}</Text>
          <View style={styles.chips}>{KNOWN_BRANDS.map(b => chip(b, b, selectedBrands.includes(b), () => toggleBrand(b)))}</View>
          <Input
            label={t(brandMode === 'one' ? 'onboarding.brand_other_one' : 'onboarding.brand_other_many')}
            value={otherBrands}
            onChangeText={(v) => { setOtherBrands(v); if (brandMode === 'one') setSelectedBrands([]) }}
            placeholder={t('onboarding.brand_placeholder')}
          />
        </> : null}
      </View>}

      {screen === 3 && <View style={styles.fields}>
        {TRACKED_MODULES.map(m => toggleRow(m, MODULE_ICONS[m] ?? '•', t(`onboarding.modules.${m}_title`), t(`onboarding.modules.${m}_desc`), chosenModules.includes(m), (on) =>
          setModules(on ? [...chosenModules, m] : chosenModules.filter(x => x !== m))))}
      </View>}

      {screen === 4 && <View style={styles.fields}>
        {AUTOMATION_CHOICES.map(choice => toggleRow(choice.key, choice.icon, t(`onboarding.reminders.${choice.key}_title`), t(`onboarding.reminders.${choice.key}_desc`), choice.modules.every(m => automations.includes(m)), (on) =>
          setAutomations(prev => on ? [...new Set([...prev, ...choice.modules])] : prev.filter(m => !choice.modules.includes(m)))))}
        <Text style={styles.toggleDesc}>{t('onboarding.automations_explanation')}</Text>
      </View>}

      {screen === 5 && <View style={styles.fields}>
        {addContact ? <>
          <View style={styles.row}>
            <View style={{ flex: 1 }}><Input label={t('onboarding.contact_firstname')} value={firstName} onChangeText={setFirstName} /></View>
            <View style={{ flex: 1 }}><Input label={t('onboarding.contact_lastname')} value={lastName} onChangeText={setLastName} /></View>
          </View>
          <Text style={styles.label}>{t('onboarding.contact_role')}</Text>
          <View style={styles.chips}>{ROLES.map(r => chip(r, t(`clients.contact_role.${r}`), role === r, () => setRole(r)))}</View>
          <Button label={t('onboarding.contact_save')} onPress={submitContact} loading={busy} />
        </> : <>
          <Button label={t('onboarding.import_instead')} onPress={chooseImport} loading={busy} />
          <Button label={t('onboarding.contact_add')} variant="secondary" onPress={() => setAddContact(true)} />
          <Button label={t('onboarding.contact_later')} variant="ghost" onPress={() => setScreen('summary')} />
        </>}
      </View>}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>

    {screen !== 5 ? <Button label={t('onboarding.next')} onPress={screen === 1 ? submitProfile : screen === 2 ? submitBrands : screen === 3 ? submitModules : submitAutomations} loading={busy} /> : null}
    {screen > 1 ? <TouchableOpacity style={styles.secondary} onPress={() => setScreen((screen - 1) as Screen)} disabled={busy}><Text style={styles.secondaryText}>{t('common.back')}</Text></TouchableOpacity> : null}
    <TouchableOpacity style={styles.secondary} onPress={configureLater} disabled={busy}><Text style={styles.secondaryText}>{t('onboarding.configure_later')}</Text></TouchableOpacity>
  </ScrollView></KeyboardAvoidingView></>
}

const stylesStatic = StyleSheet.create({ stepper: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginVertical: 20 }, stepDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' } })
function makeStyles(colors: ThemeColors) { return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, center: { alignItems: 'center', justifyContent: 'center' }, content: { padding: 24, paddingTop: 48, paddingBottom: 48, maxWidth: 520, width: '100%', alignSelf: 'center' },
  logo: { textAlign: 'center', fontSize: 28, fontFamily: fonts.display, letterSpacing: 4, color: colors.primary }, counter: { textAlign: 'center', marginTop: 8, color: colors.textTertiary, fontFamily: fonts.medium },
  card: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 22, marginBottom: 18 }, cardTop: { marginTop: 24 }, title: { fontSize: 23, fontFamily: fonts.display, color: colors.text }, subtitle: { fontSize: 14, lineHeight: 20, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 4, marginBottom: 18 },
  fields: { gap: 14 }, row: { flexDirection: 'row', gap: 10 }, label: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: colors.border }, chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, chipText: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 13 }, chipTextActive: { color: colors.primary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, toggleIcon: { fontSize: 20, width: 26, textAlign: 'center' }, toggleTitle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 14 }, toggleDesc: { fontFamily: fonts.body, color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  summaryLine: { fontSize: 14, lineHeight: 20, fontFamily: fonts.medium, color: colors.text },
  error: { marginTop: 12, padding: 10, borderRadius: 8, color: colors.danger, backgroundColor: colors.dangerLight }, secondary: { alignItems: 'center', padding: 12 }, secondaryText: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
}) }
