import { useCallback, useMemo, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react-native'
import { useAuth } from '@/features/auth/AuthProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { getSetupProgress, saveSetupProgress, SETUP_TOTAL_STEPS, type SetupProgress } from './setupService'

// SETUP-1 — rappel discret sur l'accueil tant que la configuration guidée n'est pas terminée.
export function SetupResumeCard() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const userId = session?.user.id
  const [progress, setProgress] = useState<SetupProgress | null>(null)

  useFocusEffect(useCallback(() => {
    if (userId) void getSetupProgress(userId).then(setProgress)
  }, [userId]))

  if (!userId || !progress || progress.dismissed) return null

  function dismiss() {
    if (!userId || !progress) return
    const next = { ...progress, dismissed: true }
    setProgress(next)
    saveSetupProgress(userId, next).catch(e => console.error('[setup.dismiss]', e))
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.main} onPress={() => router.replace('/(auth)/onboarding?resume=1' as any)} activeOpacity={0.8}>
        <Text style={styles.title}>{t('onboarding.resume_title', { step: progress.step, total: SETUP_TOTAL_STEPS })}</Text>
        <Text style={styles.cta}>{t('onboarding.resume_cta')} ›</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={dismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel={t('common.close')}>
        <X size={16} color={colors.textTertiary} strokeWidth={2.2} />
      </TouchableOpacity>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: colors.primaryLight },
    main: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    title: { flexShrink: 1, fontSize: 13.5, fontFamily: fonts.medium, color: colors.text },
    cta: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
  })
}
