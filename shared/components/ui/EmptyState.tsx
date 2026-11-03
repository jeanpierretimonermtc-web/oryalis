import { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, type ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { LineIcon, type LineIconName } from './LineIcon'

interface Props {
  message: string
  // Phrase d'appui sous le message (facultative).
  hint?: string
  icon?: string
  actionLabel?: string
  onAction?: () => void
  /** 'gradient' réservé aux CTA de croissance de premier plan (ex: ajouter un client) ;
   *  'outline' pour une action secondaire (ex: aller voir un autre onglet). */
  actionVariant?: 'solid' | 'gradient' | 'outline'
  actionIcon?: LineIconName
}

// EMPTY-STATE-2 — état vide épuré : petite pastille d'icône, message, phrase d'appui, bouton
// sans halo (facultatif).
export function EmptyState({ message, hint, icon = '📭', actionLabel, onAction, actionVariant = 'solid', actionIcon }: Props) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const outline = actionVariant === 'outline'

  const actionContent = (
    <>
      {actionIcon && <LineIcon name={actionIcon} size={16} color={outline ? colors.primary : colors.onPrimary} strokeWidth={2.3} />}
      <Text style={[styles.actionText, outline && styles.actionTextOutline]}>{actionLabel}</Text>
    </>
  )

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconBubble}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <Text style={styles.message}>{message}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {actionLabel && onAction ? (
          actionVariant === 'gradient' ? (
            <TouchableOpacity onPress={onAction} activeOpacity={0.85}>
              <LinearGradient
                colors={brandColors.gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.actionBtn, styles.actionBtnRow]}
              >
                {actionContent}
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionBtn, outline ? styles.actionBtnOutline : styles.actionBtnSolid, styles.actionBtnRow]}
              onPress={onAction}
              activeOpacity={0.8}
            >
              {actionContent}
            </TouchableOpacity>
          )
        ) : null}
      </View>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // Épuré : pas de carte, juste l'icône, le message et la phrase d'appui, centrés.
    container:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    card:       { width: '100%', maxWidth: 360, alignItems: 'center', gap: 6 },
    iconBubble: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, marginBottom: 4 },
    icon:       { fontSize: 18, color: colors.primary, fontFamily: fonts.bold },
    message:    { fontSize: 14.5, fontFamily: fonts.semibold, color: colors.text, textAlign: 'center' },
    hint:       { fontSize: 13, lineHeight: 18, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },
    actionBtn:  { marginTop: 8, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10 },
    actionBtnSolid:   { backgroundColor: colors.primaryAction },
    actionBtnOutline: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.card },
    actionBtnRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    actionText:        { fontSize: 14, fontFamily: fonts.semibold, color: colors.onPrimary },
    actionTextOutline: { color: colors.primary },
  })
}
