import { useMemo } from 'react'
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'

interface Props {
  children: React.ReactNode
  style?: StyleProp<ViewStyle>
  padding?: number
}

export function Card({ children, style, padding = 16 }: Props) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.card, { padding }, style]}>
      {children}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    // DESIGN-A — carte blanche sans contour sur fond crème, ombre douce en deux couches.
    card: {
      backgroundColor: colors.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(27, 36, 51, 0.05)' },
        { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(27, 36, 51, 0.06)' },
      ],
      elevation: 2,
    },
  })
}
