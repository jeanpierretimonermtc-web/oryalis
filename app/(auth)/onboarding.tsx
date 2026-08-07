import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { router, Stack } from 'expo-router'
import { getCalendars, getLocales } from 'expo-localization'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { createClient } from '@/features/clients/clientService'
import { createFollowup } from '@/features/followups/followupService'
import { trackOnboardingEvent } from '@/features/onboarding/onboardingService'
import { upsertBusinessProfile } from '@/features/settings/businessProfileService'
import { supabase } from '@/shared/lib/supabase'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { ActivityType, ContactRole, ModuleKey, NextActionType } from '@/shared/lib/types'
import i18n from '@/shared/i18n'

const ACTIVITIES: ActivityType[] = ['generic', 'doterra', 'zinzino', 'herbalife', 'multi', 'custom']
const ROLES: ContactRole[] = ['prospect', 'customer', 'distributor']
const ACTIONS: NextActionType[] = ['call', 'whatsapp', 'sms', 'email', 'rdv']
const BASE_MODULES: ModuleKey[] = ['products', 'downline', 'client_import']
const AUTOMATIONS: ModuleKey[] = ['auto_first_order', 'auto_order', 'auto_appointment', 'auto_no_contact']

function Stepper({ step, colors }: { step: number; colors: ThemeColors }) {
  return <View style={stylesStatic.stepper}>{[1, 2, 3].map(n => <View key={n} style={[stylesStatic.stepDot, { backgroundColor: step >= n ? colors.primary : colors.bgDim, borderColor: step >= n ? colors.primary : colors.border }]}><Text style={{ color: step >= n ? '#fff' : colors.textTertiary, fontFamily: fonts.bold }}>{step > n ? '✓' : n}</Text></View>)}</View>
}

export default function OnboardingScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const detectedLocale = getLocales()[0]?.languageCode === 'en' ? 'en' : 'fr'
  const detectedTimezone = getCalendars()[0]?.timeZone ?? 'Europe/Paris'
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState(session?.user?.user_metadata?.full_name ?? '')
  const [locale, setLocale] = useState(detectedLocale)
  const [timezone, setTimezone] = useState(detectedTimezone)
  const [activity, setActivity] = useState<ActivityType>('generic')
  const [brand, setBrand] = useState('')
  const [automations, setAutomations] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<ContactRole>('prospect')
  const [clientId, setClientId] = useState<string | null>(null)
  const [actionType, setActionType] = useState<NextActionType>('call')
  const [actionTitle, setActionTitle] = useState('')
  const [actionDate, setActionDate] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => { if (session) void trackOnboardingEvent(session.user.id, 'started', 1, { locale: detectedLocale, timezone: detectedTimezone }) }, [session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(destination: '/(app)' | '/(app)/import' = '/(app)') {
    if (!session) return
    const { error: profileError } = await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', session.user.id)
    if (profileError) throw profileError
    await trackOnboardingEvent(session.user.id, 'completed', 3, { destination })
    router.replace(destination)
  }

  async function submitProfile() {
    if (!session || !fullName.trim()) { setError(t('onboarding.error_name')); return }
    setBusy(true); setError(null)
    try {
      const { error: profileError } = await supabase.from('profiles').update({ full_name: fullName.trim(), locale, timezone }).eq('id', session.user.id)
      if (profileError) throw profileError
      await upsertBusinessProfile(session.user.id, { activity_type: activity, custom_brand_name: brand.trim() || null, active_modules: automations ? [...BASE_MODULES, ...AUTOMATIONS] : BASE_MODULES })
      await trackOnboardingEvent(session.user.id, 'profile_completed', 1, { activity, automations })
      await i18n.changeLanguage(locale)
      setStep(2)
    } catch (e) { setError(e instanceof Error ? e.message : t('common.error')) } finally { setBusy(false) }
  }

  async function submitContact() {
    if (!session || (!firstName.trim() && !lastName.trim())) { setError(t('onboarding.error_contact')); return }
    setBusy(true); setError(null)
    try {
      const created = await createClient(session.user.id, {
        first_name: firstName.trim() || null, full_name: [firstName.trim(), lastName.trim()].filter(Boolean).join(' '), avatar_url: null, email: null, phone: null,
        is_vip: false, manually_inactive: false, source: null, language: locale, birth_date: null, inscription_date: new Date().toISOString().slice(0, 10), profession: null,
        children: null, interests: [], client_type: null, medical_treatment: false, medical_notes: null, particularities: null, welcome_email_sent: false,
        doterra_id: null, next_lrp_date: null, lrp_status: 'not_enrolled', lrp_loyalty_percent: null, lrp_start_date: null, tracking_consent_at: null, address: null, loyalty_notes: null, sponsor_id: null, contact_role: [role],
        pipeline_stage: role === 'distributor' ? 'distributor' : 'new_lead', country: null, first_contact_date: null, first_purchase_date: null,
        acquisition_source: null, journey_stage: null, next_action_date: null, next_action_type: null, referrals_count: 0, referral_count: 0, network_potential: null,
      })
      setClientId(created.id)
      await trackOnboardingEvent(session.user.id, 'contact_created', 2, { role })
      setStep(3)
    } catch (e) { setError(e instanceof Error ? e.message : t('common.error')) } finally { setBusy(false) }
  }

  async function chooseImport() {
    if (!session) return
    setBusy(true)
    try { await trackOnboardingEvent(session.user.id, 'import_chosen', 2); await finish('/(app)/import') }
    finally { setBusy(false) }
  }

  async function submitAction() {
    if (!session || !clientId || !actionTitle.trim() || !actionDate) { setError(t('onboarding.error_action')); return }
    setBusy(true); setError(null)
    try {
      await createFollowup(session.user.id, { client_id: clientId, title: actionTitle.trim(), content: null, due_date: actionDate, done: false, action_type: actionType })
      await trackOnboardingEvent(session.user.id, 'action_created', 3, { action_type: actionType })
      await finish()
    } catch (e) { setError(e instanceof Error ? e.message : t('common.error')) } finally { setBusy(false) }
  }

  async function skipAction() {
    if (!session) return
    setBusy(true)
    try { await trackOnboardingEvent(session.user.id, 'action_skipped', 3); await finish() } finally { setBusy(false) }
  }

  const chips = <T extends string>(values: T[], selected: T, select: (value: T) => void, label: (value: T) => string) => <View style={styles.chips}>{values.map(value => <TouchableOpacity key={value} style={[styles.chip, selected === value && styles.chipActive]} onPress={() => select(value)}><Text style={[styles.chipText, selected === value && styles.chipTextActive]}>{label(value)}</Text></TouchableOpacity>)}</View>

  return <><Stack.Screen options={{ headerShown: false }} /><KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Text style={styles.logo}>ORYALIS</Text><Text style={styles.counter}>{t('onboarding.step_of', { current: step, total: 3 })}</Text><Stepper step={step} colors={colors} />
    <View style={styles.card}>
      <Text style={styles.title}>{t(`onboarding.step${step}_title`)}</Text><Text style={styles.subtitle}>{t(`onboarding.step${step}_sub`)}</Text>
      {step === 1 && <View style={styles.fields}>
        <Input label={t('onboarding.full_name')} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
        <Text style={styles.label}>{t('onboarding.activity')}</Text>{chips(ACTIVITIES, activity, setActivity, value => t(`onboarding.activities.${value}`))}
        <Input label={t('onboarding.brand')} value={brand} onChangeText={setBrand} placeholder={t('onboarding.brand_placeholder')} />
        <Text style={styles.label}>{t('onboarding.language')}</Text>{chips(['fr', 'en'], locale, setLocale, value => value === 'fr' ? 'Français' : 'English')}
        <Input label={t('onboarding.timezone')} value={timezone} onChangeText={setTimezone} autoCapitalize="none" />
        <View style={styles.automation}><View style={{ flex: 1 }}><Text style={styles.automationTitle}>{t('onboarding.automations_title')}</Text><Text style={styles.automationText}>{t('onboarding.automations_explanation')}</Text></View><Switch value={automations} onValueChange={setAutomations} /></View>
      </View>}
      {step === 2 && <View style={styles.fields}><View style={styles.row}><View style={{ flex: 1 }}><Input label={t('onboarding.contact_firstname')} value={firstName} onChangeText={setFirstName} /></View><View style={{ flex: 1 }}><Input label={t('onboarding.contact_lastname')} value={lastName} onChangeText={setLastName} /></View></View><Text style={styles.label}>{t('onboarding.contact_role')}</Text>{chips(ROLES, role, setRole, value => t(`clients.contact_role.${value}`))}</View>}
      {step === 3 && <View style={styles.fields}><Text style={styles.label}>{t('onboarding.action_type')}</Text>{chips(ACTIONS, actionType, setActionType, value => t(`next_action_types.${value}`))}<Input label={t('onboarding.action_title')} value={actionTitle} onChangeText={setActionTitle} placeholder={t('onboarding.action_title_placeholder')} /><DateInput label={t('onboarding.action_date')} value={actionDate} onChangeValue={setActionDate} /></View>}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
    <Button label={step === 3 ? t('onboarding.finish') : t('onboarding.next')} onPress={step === 1 ? submitProfile : step === 2 ? submitContact : submitAction} loading={busy} />
    {step === 2 && <TouchableOpacity style={styles.secondary} onPress={chooseImport} disabled={busy}><Text style={styles.secondaryText}>{t('onboarding.import_instead')}</Text></TouchableOpacity>}
    {step === 3 && <TouchableOpacity style={styles.secondary} onPress={skipAction} disabled={busy}><Text style={styles.secondaryText}>{t('onboarding.skip_action')}</Text></TouchableOpacity>}
  </ScrollView></KeyboardAvoidingView></>
}

const stylesStatic = StyleSheet.create({ stepper: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginVertical: 24 }, stepDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, alignItems: 'center', justifyContent: 'center' } })
function makeStyles(colors: ThemeColors) { return StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, content: { padding: 24, paddingTop: 48, paddingBottom: 48, maxWidth: 520, width: '100%', alignSelf: 'center' },
  logo: { textAlign: 'center', fontSize: 28, fontFamily: fonts.display, letterSpacing: 4, color: colors.primary }, counter: { textAlign: 'center', marginTop: 8, color: colors.textTertiary, fontFamily: fonts.medium },
  card: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 22, marginBottom: 18 }, title: { fontSize: 23, fontFamily: fonts.display, color: colors.text }, subtitle: { fontSize: 14, color: colors.textSecondary, marginTop: 4, marginBottom: 18 },
  fields: { gap: 14 }, row: { flexDirection: 'row', gap: 10 }, label: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: colors.border }, chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, chipText: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 12 }, chipTextActive: { color: colors.primary },
  automation: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: colors.bgDim, gap: 12 }, automationTitle: { fontFamily: fonts.semibold, color: colors.text, fontSize: 13 }, automationText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  error: { marginTop: 12, padding: 10, borderRadius: 8, color: colors.danger, backgroundColor: colors.dangerLight }, secondary: { alignItems: 'center', padding: 12 }, secondaryText: { color: colors.textSecondary, fontFamily: fonts.medium, fontSize: 13 },
}) }
