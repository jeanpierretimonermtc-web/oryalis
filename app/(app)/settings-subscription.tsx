import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Linking, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { createBillingPortal, createWebCheckout, getMySubscription, type SubscriptionSnapshot } from '@/features/subscriptions/subscriptionService'
import { getMobileManagementUrl, initializeMobilePurchases, purchaseAdvisor, restoreMobilePurchases } from '@/features/subscriptions/mobilePurchaseService'
import { trackProductEvent } from '@/features/analytics/productAnalytics'

export default function SubscriptionScreen() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [plan, setPlan] = useState('free')
  const [opening, setOpening] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [interval, setInterval] = useState<'month' | 'year'>('year')
  const [subscription, setSubscription] = useState<SubscriptionSnapshot | null>(null)

  useEffect(() => {
    if (!session) return
    ;(async () => {
      const [{ data }, snapshot] = await Promise.all([
        supabase.from('profiles').select('plan').eq('id', session.user.id).single(),
        getMySubscription().catch(() => null),
      ])
      setPlan(data?.plan ?? 'free')
      setSubscription(snapshot)
      if (Platform.OS !== 'web') initializeMobilePurchases(session.user.id).catch(() => {})
    })()
  }, [session])

  useEffect(() => { if (session) void trackProductEvent(session.user.id, 'offer_viewed', { platform: Platform.OS }) }, [session?.user.id])

  const isPaid = ['pro', 'cabinet', 'advisor', 'leader', 'enterprise'].includes(plan)

  async function openSubscription() {
    setOpening(true)
    try {
      if (session) await trackProductEvent(session.user.id, 'checkout_started', { platform: Platform.OS, interval })
      if (Platform.OS === 'web') await Linking.openURL(await createWebCheckout(interval))
      else {
        const active = await purchaseAdvisor(interval)
        if (active) {
          setPlan('advisor')
          Alert.alert(t('subscription.purchase_success_title'), t('subscription.purchase_success_body'))
        }
      }
    } catch (error) {
      if (session) await trackProductEvent(session.user.id, 'checkout_failed', { platform: Platform.OS, interval, reason: error instanceof Error ? error.message : 'unknown' })
      const message = error instanceof Error && error.message.includes('REVENUECAT_NOT_CONFIGURED')
        ? t('subscription.mobile_not_configured')
        : error instanceof Error ? error.message : t('common.error')
      Alert.alert(t('common.error'), message)
    } finally {
      setOpening(false)
    }
  }

  async function restore() {
    setRestoring(true)
    try {
      const active = await restoreMobilePurchases()
      if (active && session) await trackProductEvent(session.user.id, 'purchase_restored', { platform: Platform.OS })
      Alert.alert(active ? t('subscription.restore_success_title') : t('subscription.restore_empty_title'), active ? t('subscription.restore_success_body') : t('subscription.restore_empty_body'))
      if (active) setPlan('advisor')
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error && error.message.includes('REVENUECAT_NOT_CONFIGURED') ? t('subscription.mobile_not_configured') : error instanceof Error ? error.message : t('common.error'))
    } finally {
      setRestoring(false)
    }
  }

  async function manage() {
    try {
      const url = subscription?.provider === 'stripe' || Platform.OS === 'web'
        ? await createBillingPortal()
        : await getMobileManagementUrl()
      if (url) await Linking.openURL(url)
      else Alert.alert(t('common.error'), t('subscription.manage_unavailable'))
    } catch (error) {
      Alert.alert(t('common.error'), error instanceof Error ? error.message : t('common.error'))
    }
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('subscription.title'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>{t('subscription.eyebrow')}</Text>
          <Text style={styles.title}>{t('subscription.title')}</Text>
          <Text style={styles.subtitle}>{t('subscription.subtitle')}</Text>
        </View>

        <View style={styles.planCard}>
          <View style={styles.planHeader}>
            <View>
              <Text style={styles.planName}>{t('subscription.advisor')}</Text>
              <Text style={styles.planAudience}>{t('subscription.advisor_for')}</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.price}>14,90 €</Text>
              <Text style={styles.period}>{t('subscription.per_month')}</Text>
            </View>
          </View>
          {['unlimited', 'automations', 'calendar', 'orders', 'templates', 'reports'].map(feature => (
            <View key={feature} style={styles.featureRow}>
              <Text style={styles.check}>✓</Text>
              <Text style={styles.featureText}>{t(`subscription.features.${feature}`)}</Text>
            </View>
          ))}
          <Text style={styles.annual}>{t('subscription.annual')}</Text>
          {!isPaid && (
            <View style={styles.intervalRow}>
              {(['month', 'year'] as const).map(value => (
                <TouchableOpacity key={value} style={[styles.intervalBtn, interval === value && styles.intervalBtnActive]} onPress={() => setInterval(value)}>
                  <Text style={[styles.intervalText, interval === value && styles.intervalTextActive]}>{t(`subscription.interval_${value}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity style={[styles.cta, (opening || isPaid) && styles.ctaDisabled]} onPress={openSubscription} disabled={opening || isPaid}>
            {opening ? <ActivityIndicator color="#fff" /> : <Text style={styles.ctaText}>{isPaid ? t('subscription.already_active') : t('subscription.subscribe')}</Text>}
          </TouchableOpacity>
          {isPaid && (
            <TouchableOpacity style={styles.secondaryBtn} onPress={manage}>
              <Text style={styles.secondaryBtnText}>{t('subscription.manage')}</Text>
            </TouchableOpacity>
          )}
          {Platform.OS !== 'web' && (
            <TouchableOpacity style={styles.restoreBtn} onPress={restore} disabled={restoring}>
              {restoring ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.restoreText}>{t('subscription.restore')}</Text>}
            </TouchableOpacity>
          )}
          {subscription?.currentPeriodEnd && <Text style={styles.manualHint}>{t('subscription.period_end', { date: new Date(subscription.currentPeriodEnd).toLocaleDateString() })}</Text>}
        </View>

        <View style={styles.trustCard}>
          <Text style={styles.trustTitle}>{t('subscription.trust_title')}</Text>
          <Text style={styles.trustText}>{t('subscription.trust_text')}</Text>
        </View>
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 20, paddingBottom: 48, gap: 18 },
    hero: { gap: 7, paddingVertical: 8 },
    eyebrow: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 },
    title: { fontSize: 28, fontFamily: fonts.display, color: colors.text },
    subtitle: { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 21 },
    planCard: { borderRadius: 20, padding: 22, backgroundColor: colors.card, borderWidth: 2, borderColor: colors.primary, gap: 13 },
    planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 5 },
    planName: { fontSize: 22, fontFamily: fonts.bold, color: colors.text },
    planAudience: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 3 },
    priceRow: { alignItems: 'flex-end' },
    price: { fontSize: 21, fontFamily: fonts.bold, color: colors.primary },
    period: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    check: { width: 20, fontSize: 15, fontFamily: fonts.bold, color: colors.success },
    featureText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    annual: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary, textAlign: 'center', marginTop: 5 },
    intervalRow: { flexDirection: 'row', gap: 8, backgroundColor: colors.bgDim, borderRadius: 12, padding: 4 },
    intervalBtn: { flex: 1, alignItems: 'center', borderRadius: 9, paddingVertical: 9 },
    intervalBtnActive: { backgroundColor: colors.card },
    intervalText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
    intervalTextActive: { color: colors.primary },
    cta: { minHeight: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    ctaDisabled: { opacity: 0.6 },
    ctaText: { fontSize: 14, fontFamily: fonts.bold, color: '#fff' },
    secondaryBtn: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    secondaryBtnText: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
    restoreBtn: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
    restoreText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    manualHint: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', lineHeight: 16 },
    trustCard: { borderRadius: 14, padding: 16, backgroundColor: colors.bgDim, gap: 5 },
    trustTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
    trustText: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  })
}
