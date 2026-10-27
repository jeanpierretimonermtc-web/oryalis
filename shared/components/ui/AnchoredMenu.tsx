import { useMemo, type ReactNode } from 'react'
import { Modal, View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

// UI-POPOVER-2.1 — convention unique pour toute "petite liste d'actions" de l'application :
// popover ancré près du déclencheur, IDENTIQUE sur toutes les plateformes (Web desktop, Web
// étroit, iOS, Android) — UI-POPOVER-2 gardait par erreur une feuille du bas sur mobile ;
// "être sur mobile" n'est plus, à lui seul, une raison d'afficher un bottom sheet (audit
// dédié). Une vraie modal métier (formulaire, étapes multiples, confirmation) reste un Modal
// séparé, hors périmètre de ce composant.
export interface AnchoredMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onPress: () => void
  danger?: boolean
  disabled?: boolean
}

export interface AnchoredMenuAnchor { x: number; y: number }

interface AnchoredMenuProps {
  visible: boolean
  onClose: () => void
  // Position capturée au clic/tap sur le déclencheur (event.nativeEvent.pageX/pageY),
  // utilisée sur toutes les plateformes — jamais de positionnement différent sur mobile.
  anchor: AnchoredMenuAnchor | null
  // Mode liste simple : passer `items`. Mode contenu libre (ex. sous-vue de confirmation
  // qui remplace temporairement le contenu, comme les confirmations archiver/supprimer déjà
  // existantes) : passer `children` à la place — jamais les deux en même temps.
  items?: AnchoredMenuItem[]
  children?: ReactNode
  // Titre optionnel au-dessus des items (mode `items` uniquement) — ex. "Changer la photo".
  title?: string
  width?: number
  // Hauteur estimée du contenu, utilisée uniquement pour décider d'ouvrir au-dessus ou en
  // dessous (jamais pour un layout réel) — voir QUICK_MENU_EST_H, référence d'origine.
  estimatedHeight?: number
}

const DEFAULT_WIDTH = 260
const DEFAULT_EST_H = 220
const SCREEN_MARGIN = 8

export function AnchoredMenu({
  visible, onClose, anchor, items, children, title, width = DEFAULT_WIDTH, estimatedHeight = DEFAULT_EST_H,
}: AnchoredMenuProps) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { width: screenW, height: screenH } = useWindowDimensions()

  // §6 — largeur adaptée au contenu, jamais plus large que l'écran disponible (écran étroit).
  const effectiveWidth = Math.min(width, screenW - SCREEN_MARGIN * 2)

  // Même formule de bornage que les références d'origine (quickMoreOpen/openPicker) :
  // ancré sous le déclencheur par défaut, bascule au-dessus si ça dépasserait le bas de
  // l'écran, toujours clampé à SCREEN_MARGIN des bords — désormais appliquée partout, jamais
  // seulement sur desktop web.
  const pos = anchor ? {
    left: Math.max(SCREEN_MARGIN, Math.min(anchor.x - effectiveWidth + 24, screenW - effectiveWidth - SCREEN_MARGIN)),
    top: anchor.y + SCREEN_MARGIN + estimatedHeight > screenH
      ? Math.max(SCREEN_MARGIN, anchor.y - estimatedHeight - SCREEN_MARGIN)
      : anchor.y + SCREEN_MARGIN,
  } : null

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* §7 — jamais de fond gris plein écran pour un simple menu : la Modal transparente ne
          sert qu'à détecter le tap extérieur et gérer le z-index, sur toutes les plateformes. */}
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <View
          style={[styles.card, { width: effectiveWidth }, pos]}
          onStartShouldSetResponder={() => true}
        >
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {items
            ? items.map(item => (
              <TouchableOpacity
                key={item.key}
                style={[styles.item, item.disabled && styles.itemDisabled]}
                onPress={() => { if (item.disabled) return; onClose(); item.onPress() }}
                activeOpacity={0.7}
                disabled={item.disabled}
              >
                {item.icon}
                <Text style={[styles.itemText, item.danger && { color: colors.danger }]} numberOfLines={1}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))
            : children}
        </View>
      </TouchableOpacity>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'transparent' },
    card: {
      position: 'absolute',
      backgroundColor: colors.card,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      paddingVertical: 6,
      boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 24, color: 'rgba(15, 23, 42, 0.16)' }],
      elevation: 12,
    },
    title: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, textAlign: 'center', paddingHorizontal: 12, paddingVertical: 8 },
    // minHeight 44 (§13/§8 UI-POPOVER-2) : zone tactile suffisante, toute la ligne cliquable.
    item:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 12, minHeight: 44 },
    itemDisabled: { opacity: 0.4 },
    itemText:     { fontSize: 15, fontFamily: fonts.medium, color: colors.text, flex: 1 },
  })
}
