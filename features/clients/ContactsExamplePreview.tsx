import { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, type ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { getRoleColors } from '@/shared/theme/roleColors'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import type { ContactRole } from '@/shared/lib/types'

// EMPTY-EXAMPLES-1 — aperçu purement VISUEL pour un compte sans aucun contact : montre à quoi
// ressemblera la liste plutôt qu'un écran vide. Jamais de fausses données en base, jamais
// cliquable (rien à ouvrir), toujours marqué "Exemple" pour ne pas être pris pour un vrai contact.
const EXAMPLES: { key: 'sophie' | 'thomas'; initials: string; role: ContactRole; tone: 'today' | 'later' }[] = [
  { key: 'sophie', initials: 'SM', role: 'prospect', tone: 'today' },
  { key: 'thomas', initials: 'TB', role: 'customer', tone: 'later' },
]

export function ContactsExamplePreview({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('empty_examples.title')}</Text>
      <Text style={styles.subtitle}>{t('empty_examples.subtitle')}</Text>

      <View style={[styles.cards, !compact && styles.cardsWide]}>
        {EXAMPLES.map(ex => {
          const rc = getRoleColors(ex.role, colors)
          return (
            <View key={ex.key} style={styles.card} accessibilityLabel={t('empty_examples.badge')}>
              <View style={styles.cardTop}>
                <View style={[styles.avatar, { backgroundColor: rc.bg }]}>
                  <Text style={[styles.avatarText, { color: rc.text }]}>{ex.initials}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.name}>{t(`empty_examples.${ex.key}_name`)}</Text>
                  <View style={[styles.rolePill, { backgroundColor: rc.bg }]}>
                    <Text style={[styles.rolePillText, { color: rc.text }]}>{t(`empty_examples.${ex.key}_role`)}</Text>
                  </View>
                </View>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{t('empty_examples.badge')}</Text>
                </View>
              </View>
              <Text style={[styles.action, { color: ex.tone === 'today' ? colors.warning : colors.textSecondary }]} numberOfLines={1}>
                {ex.tone === 'today' ? '🟠 ' : '📅 '}{t(`empty_examples.${ex.key}_action`)}
              </Text>
              <Text style={styles.detail} numberOfLines={2}>{t(`empty_examples.${ex.key}_detail`)}</Text>
            </View>
          )
        })}
      </View>

      <View style={styles.ctaRow}>
        <TouchableOpacity onPress={() => router.push('/(app)/clients/new')} activeOpacity={0.85}>
          <LinearGradient colors={brandColors.gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryBtn}>
            <LineIcon name="personPlus" size={16} color="#fff" strokeWidth={2.3} />
            <Text style={styles.primaryBtnText}>{t('empty_examples.cta_add')}</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push('/(app)/import' as any)} activeOpacity={0.8}>
          <Text style={styles.secondaryBtnText}>{t('empty_examples.cta_import')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, gap: 12 },
    title: { fontSize: 18, fontFamily: fonts.display, color: colors.text },
    subtitle: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19, marginTop: -6 },
    cards: { gap: 10 },
    cardsWide: { flexDirection: 'row', flexWrap: 'wrap' },
    card: {
      flexGrow: 1, flexBasis: 260, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed',
      borderColor: colors.border, backgroundColor: colors.bgDim, padding: 14, gap: 8,
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 14, fontFamily: fonts.bold },
    name: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    rolePill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
    rolePillText: { fontSize: 11, fontFamily: fonts.semibold },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.tertiaryLight },
    badgeText: { fontSize: 10, fontFamily: fonts.bold, color: colors.tertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    action: { fontSize: 13, fontFamily: fonts.semibold },
    detail: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17 },
    ctaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 2 },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12 },
    primaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: '#fff' },
    secondaryBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primaryLight },
    secondaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },
  })
}
