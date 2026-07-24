import { useMemo } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useEntitlements } from './useEntitlements'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { fonts } from '@/shared/theme/fonts'

export function AdvisorGate({ feature, children }: { feature: string; children: React.ReactNode }) {
  const { t } = useTranslation(); const { colors } = useTheme(); const styles = useMemo(() => StyleSheet.create({
    box: { margin: 16, padding: 24, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 10 },
    lock: { fontSize: 28 }, title: { fontSize: 19, fontFamily: fonts.display, color: colors.text, textAlign: 'center' }, text: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19 },
    btn: { marginTop: 6, backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 }, btnText: { color: '#fff', fontFamily: fonts.semibold },
  }), [colors])
  const { isAdvisor, loading } = useEntitlements()
  if (loading) return <ActivityIndicator color={colors.primary} style={{ margin: 32 }} />
  if (isAdvisor) return <>{children}</>
  return <View style={styles.box}><Text style={styles.lock}>🔒</Text><Text style={styles.title}>{t('subscription.gate_title')}</Text><Text style={styles.text}>{t('subscription.gate_text', { feature })}</Text><TouchableOpacity style={styles.btn} onPress={() => router.push('/(app)/settings-subscription')}><Text style={styles.btnText}>{t('settings.upgrade')}</Text></TouchableOpacity></View>
}
