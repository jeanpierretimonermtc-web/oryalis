import { useState, useEffect, useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Switch } from 'react-native'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useDemoState } from '@/features/demo/DemoProvider'
import { supabase } from '@/shared/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'

const PLAN_CONFIG: Record<string, { label: string; descKey: string }> = {
  free:    { label: 'Gratuit', descKey: 'settings.plan_free_desc'    },
  pro:     { label: 'Conseiller', descKey: 'settings.plan_pro_desc'     },
  advisor: { label: 'Conseiller', descKey: 'settings.plan_pro_desc'     },
  cabinet: { label: 'Leader', descKey: 'settings.plan_cabinet_desc' },
  leader:  { label: 'Leader', descKey: 'settings.plan_cabinet_desc' },
}

export default function DisplaySettingsScreen() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const { colors, mode, toggleTheme } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { hideDemoCard, setHideDemoCard } = useDemoState()

  const [plan, setPlan] = useState('free')
  useEffect(() => {
    if (!session?.user.id) return
    let active = true
    ;(async () => {
      try {
        const { data } = await supabase.from('profiles').select('plan').eq('id', session.user.id).single()
        if (active && data?.plan) setPlan(data.plan)
      } catch (e) {
        console.error(e)
      }
    })()
    return () => { active = false }
  }, [session?.user.id])

  const planCfg = PLAN_CONFIG[plan] ?? PLAN_CONFIG.free
  const isPaid = ['pro', 'cabinet', 'advisor', 'leader', 'enterprise'].includes(plan)

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.nav_display'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Affichage ─────────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('settings.display').toUpperCase()}</Text>
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>{t('settings.dark_mode')}</Text>
              <Text style={styles.switchDesc}>{t('settings.dark_mode_desc')}</Text>
            </View>
            <Switch value={mode === 'dark'} onValueChange={toggleTheme}
              trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.card} />
          </View>
          <View style={[styles.switchRow, styles.switchRowBorder]}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>{t('settings.hide_demo')}</Text>
              <Text style={styles.switchDesc}>{t('settings.hide_demo_desc')}</Text>
            </View>
            <Switch value={hideDemoCard} onValueChange={v => setHideDemoCard(v)}
              trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.card} />
          </View>
        </View>

        {/* ── Abonnement ────────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('settings.subscription').toUpperCase()}</Text>
        <View style={[styles.planCard, isPaid ? styles.planCardPaid : styles.planCardFree]}>
          <View style={styles.planTop}>
            <View>
              <Text style={[styles.planHint, !isPaid && { color: colors.textSecondary }]}>
                {t('settings.current_plan').toUpperCase()}
              </Text>
              <Text style={[styles.planName, !isPaid && { color: colors.primary }]}>{planCfg.label}</Text>
            </View>
            {isPaid && (
              <View style={styles.planBadge}><Text style={styles.planBadgeText}>{t('settings.plan_active')}</Text></View>
            )}
          </View>
          <Text style={[styles.planDesc, !isPaid && { color: colors.textSecondary }]}>{t(planCfg.descKey)}</Text>
          <TouchableOpacity style={[styles.upgradeBtn, isPaid && { backgroundColor: 'rgba(255,255,255,0.15)' }]} activeOpacity={0.85} onPress={() => router.push('/(app)/settings-subscription' as any)}>
            <Text style={[styles.upgradeBtnText, isPaid && { color: '#fff' }]}>{t('settings.upgrade')}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Compte ────────────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('settings.section_account').toUpperCase()}</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.logoutRow} onPress={() => supabase.auth.signOut()} activeOpacity={0.75}>
            <Text style={{ fontSize: 18 }}>🚪</Text>
            <Text style={styles.logoutText}>{t('auth.logout')}</Text>
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.version}>Oryalis v1.0.0</Text>
          <View style={styles.footerLinks}>
            <TouchableOpacity><Text style={styles.footerLink}>{t('settings.privacy')}</Text></TouchableOpacity>
            <Text style={styles.footerDot}>·</Text>
            <TouchableOpacity><Text style={styles.footerLink}>{t('settings.terms')}</Text></TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 10, maxWidth: 720, alignSelf: 'center', width: '100%', paddingBottom: 40 },
  sectionLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 0.6, paddingHorizontal: 2, paddingTop: 6 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.border },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 14, marginTop: 2 },
  switchInfo: { flex: 1, gap: 2 },
  switchLabel: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  switchDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17 },
  planCard: { borderRadius: 16, padding: 18, gap: 10, marginHorizontal: 0 },
  planCardPaid: { backgroundColor: colors.primary },
  planCardFree: { backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.border },
  planTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  planHint: { fontSize: 10, fontFamily: fonts.bold, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5 },
  planName: { fontSize: 22, fontFamily: fonts.display, color: '#fff', marginTop: 2 },
  planBadge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  planBadgeText: { fontSize: 12, fontFamily: fonts.semibold, color: '#fff' },
  planDesc: { fontSize: 13, fontFamily: fonts.body, color: 'rgba(255,255,255,0.8)', lineHeight: 18 },
  upgradeBtn: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  upgradeBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },
  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  logoutText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.danger },
  footer: { alignItems: 'center', gap: 6, paddingTop: 12, paddingBottom: 8 },
  version: { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary },
  footerLinks: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerLink: { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary },
  footerDot: { fontSize: 12, color: colors.textTertiary },
  })
}
