import { useState, useEffect, useMemo } from 'react'
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

function pad(n: number) { return String(n).padStart(2, '0') }

interface Props {
  visible: boolean
  value: string
  onClose: () => void
  onConfirm: (t: string) => void
}

export function TimePickerModal({ visible, value, onClose, onConfirm }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [hours,   setHours]   = useState(9)
  const [minutes, setMinutes] = useState(0)

  useEffect(() => {
    if (!visible) return
    if (value) {
      const [h, m] = value.split(':')
      setHours(parseInt(h)); setMinutes(Math.round(parseInt(m) / 5) * 5 % 60)
    } else { setHours(9); setMinutes(0) }
  }, [visible])

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.pickerBox}>
          <Text style={styles.title}>{t('appointments.time')}</Text>
          <View style={styles.timePicker}>
            <View style={styles.timeColumn}>
              <TouchableOpacity style={styles.timeArrow} onPress={() => setHours(h => (h + 1) % 24)} activeOpacity={0.7}>
                <Text style={styles.timeArrowText}>▲</Text>
              </TouchableOpacity>
              <View style={styles.timeValueBox}>
                <Text style={styles.timeValueText}>{pad(hours)}</Text>
              </View>
              <TouchableOpacity style={styles.timeArrow} onPress={() => setHours(h => (h - 1 + 24) % 24)} activeOpacity={0.7}>
                <Text style={styles.timeArrowText}>▼</Text>
              </TouchableOpacity>
              <Text style={styles.timeUnit}>h</Text>
            </View>
            <Text style={styles.timeSep}>:</Text>
            <View style={styles.timeColumn}>
              <TouchableOpacity style={styles.timeArrow} onPress={() => setMinutes(m => (m + 5) % 60)} activeOpacity={0.7}>
                <Text style={styles.timeArrowText}>▲</Text>
              </TouchableOpacity>
              <View style={styles.timeValueBox}>
                <Text style={styles.timeValueText}>{pad(minutes)}</Text>
              </View>
              <TouchableOpacity style={styles.timeArrow} onPress={() => setMinutes(m => (m - 5 + 60) % 60)} activeOpacity={0.7}>
                <Text style={styles.timeArrowText}>▼</Text>
              </TouchableOpacity>
              <Text style={styles.timeUnit}>min</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.confirmBtn} onPress={() => { onConfirm(`${pad(hours)}:${pad(minutes)}`); onClose() }} activeOpacity={0.85}>
            <Text style={styles.confirmBtnText}>{t('common.confirm')}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    pickerBox: { width: '100%', maxWidth: 340, borderRadius: 20, padding: 20, backgroundColor: colors.card, boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 24, color: 'rgba(0, 0, 0, 0.2)' }], elevation: 16 },
    title:     { fontSize: 15, fontFamily: fonts.semibold, textAlign: 'center', color: colors.text, marginBottom: 28 },
    confirmBtn:     { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 28, backgroundColor: colors.primary },
    confirmBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },

    timePicker:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
    timeColumn:    { alignItems: 'center', gap: 10 },
    timeArrow:     { padding: 8 },
    timeArrowText: { fontSize: 22, lineHeight: 26, color: colors.primary },
    timeValueBox:  { width: 80, height: 64, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDim, borderColor: colors.border },
    timeValueText: { fontSize: 32, fontFamily: fonts.bold, lineHeight: 38, color: colors.text },
    timeUnit:      { fontSize: 11, fontFamily: fonts.semibold, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textTertiary },
    timeSep:       { fontSize: 36, fontFamily: fonts.bold, marginBottom: 28, color: colors.text },
  })
}
