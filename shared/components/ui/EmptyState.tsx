import { useMemo } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, type ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { LineIcon, type LineIconName } from './LineIcon'

interface Props {
  message: string
  icon?: string
  actionLabel?: string
  onAction?: () => void
  /** 'gradient' réservé aux CTA de croissance de premier plan (ex: ajouter un client) */
  actionVariant?: 'solid' | 'gradient'
  actionIcon?: LineIconName
}

export function EmptyState({ message, icon = '📭', actionLabel, onAction, actionVariant = 'solid', actionIcon }: Props) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const actionContent = (
    <>
      {actionIcon && <LineIcon name={actionIcon} size={16} color="#fff" strokeWidth={2.3} />}
      <Text style={styles.actionText}>{actionLabel}</Text>
    </>
  )

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.message}>{message}</Text>
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
          <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSolid, styles.actionBtnRow]} onPress={onAction} activeOpacity={0.8}>
            {actionContent}
          </TouchableOpacity>
        )
      ) : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
    icon:       { fontSize: 40 },
    message:    { fontSize: 15, fontFamily: fonts.medium, color: colors.textSecondary, textAlign: 'center' },
    actionBtn:  {
      marginTop: 4, paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12,
      boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(59, 130, 246, 0.3)' }],
      elevation: 2,
    },
    actionBtnSolid: { backgroundColor: colors.primary },
    actionBtnRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
    actionText: { fontSize: 14, fontFamily: fonts.semibold, color: '#fff' },
  })
}
