import { useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

// BACK-1 — bouton retour unique de l'application : flèche dans un cercle (même famille que les
// boutons ⋮ cerclés), suivie d'un libellé facultatif.
export function BackButton({ onPress, label }: { onPress: () => void; label?: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={label ?? t('common.back')}
    >
      <View style={styles.circle}>
        <ChevronLeft size={18} color={colors.text} strokeWidth={2.2} />
      </View>
      {label ? <Text style={styles.label} numberOfLines={1}>{label}</Text> : null}
    </TouchableOpacity>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
    circle: {
      width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
      backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    },
    label: { flexShrink: 1, fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  })
}
