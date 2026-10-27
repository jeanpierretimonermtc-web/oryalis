import { useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Platform, StyleProp, ViewStyle } from 'react-native'
import { Check } from 'lucide-react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

// UI-AFFORDANCE-1.2 — convention unique pour l'action métier "Terminer" (relances,
// interactions, tâches RDV) : remplace un carré ambigu par un contrôle explicite. `done`
// bascule uniquement le libellé/style ; le comportement au clic (ouvrir une Modal métier,
// rouvrir, etc.) reste entièrement décidé par l'appelant via `onPress` — ce composant ne
// connaît aucune règle métier (P0/P1/P1.1/P1.2 restent inchangés).
export function CompleteToggle({
  done, onPress, disabled, activeLabel, doneLabel, accentColor,
  accessibilityLabel, accessibilityHint, style,
}: {
  done: boolean
  onPress: () => void
  disabled?: boolean
  activeLabel: string
  doneLabel: string
  /** Couleur d'accent de l'état actif (ex. rouge si en retard) ; colors.primary par défaut. */
  accentColor?: string
  accessibilityLabel?: string
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [hovered, setHovered] = useState(false)
  const isDisabled = !!disabled
  const activeBorder = accentColor ?? colors.primary

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (done ? doneLabel : activeLabel)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled }}
      style={({ pressed }) => [
        styles.chip,
        done ? styles.chipDone : [styles.chipActive, { borderColor: activeBorder }],
        Platform.OS === 'web' && !isDisabled ? ({ cursor: 'pointer' } as any) : null,
        (pressed || hovered) && !isDisabled ? styles.chipPressed : null,
        style,
      ]}
    >
      {done ? (
        <View style={styles.doneCircle}>
          <Check size={10} color={colors.textInverse} strokeWidth={3} />
        </View>
      ) : (
        <View style={[styles.activeCircle, { borderColor: activeBorder }]} />
      )}
      <Text style={[styles.label, done ? styles.labelDone : styles.labelActive]} numberOfLines={1}>
        {done ? doneLabel : activeLabel}
      </Text>
    </Pressable>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
      borderWidth: 1.5, alignSelf: 'flex-start',
    },
    chipActive:  { backgroundColor: colors.card },
    chipDone:    { backgroundColor: colors.successLight, borderColor: colors.success },
    chipPressed: { opacity: 0.7 },

    activeCircle: { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
    doneCircle:   { width: 14, height: 14, borderRadius: 7, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },

    label:       { fontSize: 12.5, fontFamily: fonts.semibold },
    labelActive: { color: colors.text },
    labelDone:   { color: colors.success },
  })
}
