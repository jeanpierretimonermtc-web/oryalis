import { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import type { FollowupOrigin } from './followupOriginService'

// FOLLOWUP-ORIGIN-1 — "Suite du RDV « tre » du 02/11 ›" : ligne cliquable quand la source existe.
// `returnTo` : page où revenir depuis le RDV ; `onNavigate` : ferme d'abord une fenêtre ouverte.
export function FollowupOriginLine({ origin, returnTo, onNavigate }: {
  origin: FollowupOrigin | undefined
  returnTo: string
  onNavigate?: () => void
}) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  if (!origin) return null

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const day = (iso: string) => formatDate(iso, locale, { day: '2-digit', month: '2-digit' })

  const content: { icon: string; text: string; href: string | null } = (() => {
    switch (origin.kind) {
      case 'care':
        return { icon: '🌱', text: t(origin.step ? 'followups.origin_care_step' : 'followups.origin_care', { label: origin.label, step: origin.step }), href: `/(app)/clients/${origin.clientId}` }
      case 'order':
        return { icon: '🛒', text: t(origin.product ? 'followups.origin_order' : 'followups.origin_order_no_product', { product: origin.product, date: day(origin.date) }), href: `/(app)/clients/${origin.clientId}/orders` }
      case 'interaction':
        return { icon: '💬', text: t('followups.origin_interaction', { date: day(origin.date) }), href: `/(app)/clients/${origin.clientId}/interactions?focus=${origin.id}` }
      case 'appointment':
        return { icon: '📅', text: t('followups.origin_appointment', { title: origin.title, date: day(origin.date) }), href: `/(app)/appointments/${origin.id}?returnTo=${encodeURIComponent(returnTo)}` }
      case 'automatic':
        return { icon: '⚙️', text: t('followups.origin_automatic', { date: day(origin.date) }), href: null }
      case 'manual':
        return { icon: '✍️', text: t('followups.origin_manual', { date: day(origin.date) }), href: null }
    }
  })()

  if (!content.href) return <Text style={styles.text} numberOfLines={1}>{content.icon} {content.text}</Text>
  const href = content.href
  return (
    <TouchableOpacity
      onPress={() => { onNavigate?.(); router.push(href as any) }}
      activeOpacity={0.7}
      accessibilityRole="link"
      accessibilityLabel={content.text}
    >
      <Text style={styles.link} numberOfLines={1}>{content.icon} {content.text} ›</Text>
    </TouchableOpacity>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    text: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
    link: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.primary },
  })
}
