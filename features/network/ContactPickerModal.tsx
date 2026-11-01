import { useEffect, useMemo, useState } from 'react'
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

export interface PickerOption {
  id: string
  label: string
  sub?: string
}

interface Props {
  visible: boolean
  title: string
  options: PickerOption[]
  selectedId?: string | null
  // Ligne "Moi" en tête de liste (renvoie null).
  meLabel?: string
  createLabel?: string
  onCreate?: () => void
  errorMsg?: string | null
  onPick: (id: string | null) => void
  onClose: () => void
}

export function ContactPickerModal({ visible, title, options, selectedId, meLabel, createLabel, onCreate, errorMsg, onPick, onClose }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { width } = useWindowDimensions()
  const isWide = width >= 768
  const [query, setQuery] = useState('')

  useEffect(() => { if (visible) setQuery('') }, [visible])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter(o => o.label.toLowerCase().includes(q)) : options
  }, [options, query])

  return (
    <Modal visible={visible} transparent animationType={isWide ? 'fade' : 'slide'} onRequestClose={onClose}>
      <View style={[styles.overlay, isWide && styles.overlayWide]}>
        <View style={[styles.sheet, isWide && styles.sheetWide]}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.search}
            value={query}
            onChangeText={setQuery}
            placeholder={t('network.picker_search')}
            placeholderTextColor={colors.textTertiary}
            autoFocus={isWide}
          />
          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
          <ScrollView style={styles.list} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
            {onCreate && createLabel ? (
              <TouchableOpacity style={styles.createRow} onPress={onCreate} activeOpacity={0.75}>
                <Text style={styles.createText}>+ {createLabel}</Text>
              </TouchableOpacity>
            ) : null}
            {meLabel && !query.trim() ? (
              <TouchableOpacity style={[styles.row, selectedId == null && styles.rowActive]} onPress={() => onPick(null)} activeOpacity={0.75}>
                <Text style={styles.rowLabel}>🙋 {meLabel}</Text>
              </TouchableOpacity>
            ) : null}
            {filtered.map(o => (
              <TouchableOpacity key={o.id} style={[styles.row, selectedId === o.id && styles.rowActive]} onPress={() => onPick(o.id)} activeOpacity={0.75}>
                <Text style={styles.rowLabel}>{o.label}</Text>
                {o.sub ? <Text style={styles.rowSub}>{o.sub}</Text> : null}
              </TouchableOpacity>
            ))}
            {filtered.length === 0 ? <Text style={styles.empty}>{t('network.picker_empty')}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    overlayWide: { justifyContent: 'center', alignItems: 'center', padding: 24 },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12, maxHeight: '85%' },
    sheetWide: { width: '100%', maxWidth: 480, borderRadius: 20, maxHeight: '80%' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    title: { flex: 1, fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
    close: { fontSize: 16, color: colors.textSecondary },
    search: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 14, color: colors.text, backgroundColor: colors.card },
    list: { flexGrow: 0 },
    row: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, gap: 2 },
    rowActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    rowLabel: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    rowSub: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    createRow: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary },
    createText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },
    empty: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center', paddingVertical: 12 },
    errorText: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  })
}
