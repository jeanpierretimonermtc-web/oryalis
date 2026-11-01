import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, Image } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { getPublicLeadForm, submitPublicLead } from '@/features/leads/leadService'
import type { PublicLeadForm } from '@/features/leads/leadService'

// LEAD-PAGE-1 — page publique (sans compte) : présentation du conseiller + formulaire.
export default function PublicLeadPage() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const [form, setForm] = useState<PublicLeadForm | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'not_found' | 'sent'>('loading')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    getPublicLeadForm(slug)
      .then(f => { setForm(f); setState(f ? 'ready' : 'not_found') })
      .catch(e => { console.error('[publicLead.load]', e); setState('not_found') })
  }, [slug])

  async function send() {
    setError(null)
    if (fullName.trim().length < 2) { setError(t('public_lead.error_name')); return }
    if (!email.trim() && !phone.trim()) { setError(t('public_lead.error_contact')); return }
    setSending(true)
    try {
      await submitPublicLead(slug!, { fullName, email, phone, message, consent })
      setState('sent')
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      setError(t(code === 'invalid_email' ? 'public_lead.error_email' : code === 'rate_limit' ? 'public_lead.error_rate' : 'public_lead.error_generic'))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: form?.title ?? 'Oryalis' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Image source={require('@/assets/logo-icon.png')} style={styles.logo} resizeMode="contain" />
          {state === 'loading' ? (
            <ActivityIndicator color={colors.primary} />
          ) : state === 'not_found' ? (
            <>
              <Text style={styles.title}>{t('public_lead.not_found_title')}</Text>
              <Text style={styles.intro}>{t('public_lead.not_found_text')}</Text>
            </>
          ) : state === 'sent' ? (
            <>
              <Text style={styles.sentIcon}>🌿</Text>
              <Text style={styles.title}>{t('public_lead.sent_title')}</Text>
              <Text style={styles.intro}>{t('public_lead.sent_text', { name: form?.advisor_name || '' })}</Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>{form!.title}</Text>
              {form!.brand_name ? <Text style={styles.brand}>{form!.brand_name}</Text> : null}
              {form!.intro ? <Text style={styles.intro}>{form!.intro}</Text> : null}
              {form!.advisor_name ? <Text style={styles.advisor}>{t('public_lead.with', { name: form!.advisor_name })}</Text> : null}

              <Text style={styles.label}>{t('public_lead.name')} *</Text>
              <TextInput style={styles.input} value={fullName} onChangeText={setFullName} autoComplete="name" maxLength={120} />
              <Text style={styles.label}>{t('public_lead.email')}</Text>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" maxLength={200} />
              <Text style={styles.label}>{t('public_lead.phone')}</Text>
              <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={40} />
              <Text style={styles.hint}>{t('public_lead.contact_hint')}</Text>
              <Text style={styles.label}>{t('public_lead.message')}</Text>
              <TextInput style={[styles.input, styles.multiline]} value={message} onChangeText={setMessage} multiline maxLength={2000} placeholder={t('public_lead.message_placeholder')} placeholderTextColor={colors.textTertiary} />

              <TouchableOpacity style={styles.checkRow} onPress={() => setConsent(v => !v)} activeOpacity={0.8} accessibilityRole="checkbox" accessibilityState={{ checked: consent }}>
                <View style={[styles.checkBox, consent && styles.checkBoxOn]}>{consent ? <Text style={styles.checkMark}>✓</Text> : null}</View>
                <Text style={styles.checkText}>{t('public_lead.consent', { name: form!.advisor_name || '' })}</Text>
              </TouchableOpacity>

              {error ? <Text style={styles.error}>{error}</Text> : null}
              <TouchableOpacity style={[styles.primaryBtn, sending && { opacity: 0.6 }]} onPress={send} disabled={sending} activeOpacity={0.85}>
                {sending ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>{t('public_lead.send')}</Text>}
              </TouchableOpacity>
              <Text style={styles.privacy}>{t('public_lead.privacy')}</Text>
            </>
          )}
        </View>
        <Text style={styles.footer}>Oryalis</Text>
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.surface },
    content: { padding: 20, paddingTop: 40, alignItems: 'center', gap: 16, minHeight: '100%' },
    card: { width: '100%', maxWidth: 480, backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 24, gap: 10 },
    logo: { width: 48, height: 48, alignSelf: 'center', marginBottom: 4 },
    title: { fontSize: 22, fontFamily: fonts.display, color: colors.text, textAlign: 'center' },
    intro: { fontSize: 14.5, lineHeight: 21, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },
    brand: { alignSelf: 'center', fontSize: 12.5, fontFamily: fonts.semibold, color: colors.tertiary, backgroundColor: colors.tertiaryLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
    advisor: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary, textAlign: 'center', marginBottom: 6 },
    sentIcon: { fontSize: 40, textAlign: 'center' },
    label: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, marginTop: 4 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontFamily: fonts.body, fontSize: 15, color: colors.text, backgroundColor: colors.bg },
    multiline: { minHeight: 90, textAlignVertical: 'top' },
    hint: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 6 },
    checkBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    checkBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkMark: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 12 },
    checkText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: fonts.body, color: colors.textSecondary },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    primaryBtn: { marginTop: 8, borderRadius: 12, paddingVertical: 13, alignItems: 'center', backgroundColor: colors.primaryAction },
    primaryBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.onPrimary },
    privacy: { fontSize: 11.5, lineHeight: 16, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center' },
    footer: { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary },
  })
}
