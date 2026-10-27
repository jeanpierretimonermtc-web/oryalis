import { useMemo, useState } from 'react'
import { Text, Pressable, StyleSheet, Platform, StyleProp, ViewStyle } from 'react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

// UI-AFFORDANCE-1 — convention unique pour signaler qu'une carte/ligne ouvre réellement une
// ressource : "Ouvrir ›" (vue générale/liste) ou "Modifier ›" (formulaire d'édition direct),
// jamais un chevron nu ambigu. Ne jamais poser ce composant sur une ligne sans destination
// réelle (§3 du brief). Indépendant de toute surbrillance NAV-FOCUS (?focus=<id>).
//
// `interactive` (défaut true) : passer `false` quand ce composant est posé à l'intérieur d'une
// zone déjà entièrement cliquable (toute la ligne/carte porte déjà le même onPress) — il ne
// rend alors qu'un texte décoratif, sans second Pressable ni double déclenchement possible.
export function OpenActionLink({ label, onPress, accessibilityLabel, accessibilityHint, style, interactive = true }: {
  label: string
  onPress?: () => void
  accessibilityLabel?: string
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
  interactive?: boolean
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [hovered, setHovered] = useState(false)

  if (!interactive) {
    return <Text style={styles.linkText} numberOfLines={1}>{label} ›</Text>
  }

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.link,
        Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
        (pressed || hovered) && styles.linkActive,
        style,
      ]}
    >
      <Text style={styles.linkText} numberOfLines={1}>{label} ›</Text>
    </Pressable>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    link:       { flexShrink: 0, paddingVertical: 2, paddingHorizontal: 2 },
    linkActive: { opacity: 0.65 },
    linkText:   { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.primaryAction },
  })
}
