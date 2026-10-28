import { useMemo, type ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

// DESIGN-A — en-tête commun des écrans principaux : petite étiquette en majuscules, grand titre
// bleu nuit, phrase d'appui, actions éventuelles à droite. Un seul endroit pour la hiérarchie
// typographique, pour que tous les écrans se ressemblent.
interface Props {
  eyebrow?: string
  title: string
  subtitle?: string | null
  right?: ReactNode
  // Écran dont le conteneur a déjà ses propres marges latérales (ScrollView avec padding).
  flush?: boolean
}

export function ScreenHeader({ eyebrow, title, subtitle, right, flush = false }: Props) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.row, flush && styles.rowFlush]}>
      <View style={styles.heading}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 14, flexWrap: 'wrap' },
    rowFlush: { paddingHorizontal: 0, paddingTop: 6, paddingBottom: 4 },
    heading: { flex: 1, minWidth: 200 },
    eyebrow: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 },
    title: { fontSize: 30, fontFamily: fonts.display, color: colors.text, letterSpacing: -0.6, lineHeight: 36 },
    subtitle: { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 4 },
    right: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  })
}
