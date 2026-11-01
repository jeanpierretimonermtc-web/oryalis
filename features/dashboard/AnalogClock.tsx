import { View } from 'react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'

interface Props {
  hours: number
  minutes: number
  size?: number
  // Contour orange la nuit chez le contact (même code couleur que les badges 🌙).
  night?: boolean
}

// WORLD-CLOCK-1 — cadran à aiguilles dessiné en vues (aucune dépendance graphique).
export function AnalogClock({ hours, minutes, size = 56, night = false }: Props) {
  const { colors } = useTheme()
  const r = size / 2
  const hourAngle = ((hours % 12) + minutes / 60) * 30
  const minuteAngle = minutes * 6
  const hand = (length: number, width: number, angle: number, color: string) => (
    <View
      style={{
        position: 'absolute',
        left: r - width / 2,
        top: r - length,
        width,
        height: length,
        borderRadius: width,
        backgroundColor: color,
        transformOrigin: 'bottom',
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  )
  return (
    <View
      style={{
        width: size, height: size, borderRadius: r,
        borderWidth: 2, borderColor: night ? colors.warning : colors.primary,
        backgroundColor: night ? colors.warningLight : colors.card,
      }}
    >
      {/* Repères 12 / 3 / 6 / 9 h. */}
      {[[r - 1.5, 3], [size - 9, r - 1.5], [r - 1.5, size - 9], [3, r - 1.5]].map(([left, top], i) => (
        <View key={i} style={{ position: 'absolute', left, top, width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.textTertiary }} />
      ))}
      {hand(r * 0.5, 3, hourAngle, colors.text)}
      {hand(r * 0.75, 2, minuteAngle, colors.primary)}
      <View style={{ position: 'absolute', left: r - 3, top: r - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.text }} />
    </View>
  )
}
