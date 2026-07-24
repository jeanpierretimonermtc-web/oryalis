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
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(0, 0, 0, 0.04)' }],
      elevation: 1,
    },
  })
}
