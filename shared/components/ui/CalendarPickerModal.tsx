import { useState, useEffect, useMemo } from 'react'
import { View, Text, Modal, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'

function pad(n: number) { return String(n).padStart(2, '0') }
function formatHM(iso: string) {
  const d = new Date(iso)
  return `${pad(d.getHours())}h${pad(d.getMinutes())}`
}

function buildCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1)
  const totalDays = new Date(year, month + 1, 0).getDate()
  let offset = firstDay.getDay() - 1; if (offset < 0) offset = 6
  const cells: (number | null)[] = Array(offset).fill(null)
  for (let d = 1; d <= totalDays; d++) cells.push(d)
  return cells
}

export interface CalendarBusyAppointment {
  start_at: string
  end_at: string
  title: string
}

interface Props {
  visible: boolean
  value: string
  locale: string
  onClose: () => void
  onConfirm: (d: string) => void
  // RDV déjà planifiés — n'importe quel contact confondu — pour voir la charge du jour
  // (point orange) et, en cliquant un jour occupé, les horaires déjà pris ce jour-là.
  dayAppointments?: CalendarBusyAppointment[]
}

export function CalendarPickerModal({ visible, value, locale, onClose, onConfirm, dayAppointments }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const busySet = useMemo(() => new Set((dayAppointments ?? []).map(a => a.start_at.split('T')[0])), [dayAppointments])

  const todayStr = new Date().toISOString().split('T')[0]
  const [viewYear,  setViewYear]  = useState(new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(new Date().getMonth())
  const [selected,  setSelected]  = useState(value || todayStr)

  const selectedDayAppointments = useMemo(() =>
    (dayAppointments ?? [])
      .filter(a => a.start_at.startsWith(selected))
      .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [dayAppointments, selected]
  )

  useEffect(() => {
    if (!visible) return
    const base = value || todayStr
    const [y, m] = base.split('-')
    setViewYear(parseInt(y)); setViewMonth(parseInt(m) - 1); setSelected(base)
  }, [visible])

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) }
    else setViewMonth(m => m + 1)
  }

  const days       = buildCalendarDays(viewYear, viewMonth)
  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const dayNames   = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i)
    return d.toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase()
  })

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.pickerBox}>
          <View style={styles.calHeader}>
            <TouchableOpacity onPress={prevMonth} style={styles.calNavBtn}>
              <Text style={styles.calNavText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.calMonthLabel}>
              {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
            </Text>
            <TouchableOpacity onPress={nextMonth} style={styles.calNavBtn}>
              <Text style={styles.calNavText}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.calDayNames}>
            {dayNames.map((n, i) => <Text key={i} style={styles.calDayName}>{n}</Text>)}
          </View>
          <View style={styles.calGrid}>
            {days.map((day, i) => {
              if (day === null) return <View key={`_${i}`} style={styles.calCell} />
              const dateStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`
              const isSel   = dateStr === selected
              const isToday = dateStr === todayStr
              const isBusy  = busySet.has(dateStr)
              return (
                <TouchableOpacity
                  key={dateStr}
                  style={[styles.calCell, isSel && styles.calCellSelected, !isSel && isToday && styles.calCellToday]}
                  onPress={() => setSelected(dateStr)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.calDayText, isSel && styles.calDayTextSelected, !isSel && isToday && styles.calDayTextToday]}>{day}</Text>
                  {isBusy && !isSel && <View style={styles.calBusyDot} />}
                </TouchableOpacity>
              )
            })}
          </View>
          {selectedDayAppointments.length > 0 && (
            <View style={styles.calDayList}>
              <Text style={styles.calDayListTitle}>{t('common.calendar_day_appointments')}</Text>
              {selectedDayAppointments.map((a, i) => (
                <View key={i} style={styles.calDayListRow}>
                  <Text style={styles.calDayListTime}>
                    {formatHM(a.start_at)}–{formatHM(a.end_at)}
                  </Text>
                  <Text style={styles.calDayListLabel} numberOfLines={1}>{a.title}</Text>
                </View>
              ))}
            </View>
          )}
          <TouchableOpacity style={styles.confirmBtn} onPress={() => { onConfirm(selected); onClose() }} activeOpacity={0.85}>
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
    confirmBtn:     { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 16, backgroundColor: colors.primary },
    confirmBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },

    calHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
    calNavBtn:     { padding: 6 },
    calNavText:    { fontSize: 28, fontFamily: fonts.medium, lineHeight: 32, color: colors.primary },
    calMonthLabel: { fontSize: 15, fontFamily: fonts.semibold, textAlign: 'center', flex: 1, color: colors.text },
    calDayNames:   { flexDirection: 'row', marginBottom: 2 },
    calDayName:    { width: '14.285714%', textAlign: 'center', fontSize: 11, fontFamily: fonts.semibold, paddingVertical: 6, color: colors.textTertiary },
    calGrid:       { flexDirection: 'row', flexWrap: 'wrap' },
    calCell:       { width: '14.285714%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
    calCellSelected: { backgroundColor: colors.primary, borderRadius: 999 },
    calCellToday:    { borderRadius: 999, borderWidth: 1.5, borderColor: colors.primary },
    calDayText:         { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    calDayTextSelected: { color: '#fff', fontFamily: fonts.semibold },
    calDayTextToday:    { color: colors.primary, fontFamily: fonts.semibold },
    calBusyDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.warning },
    calDayList:      { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border, gap: 6 },
    calDayListTitle: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    calDayListRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
    calDayListTime:  { fontSize: 12, fontFamily: fonts.semibold, color: colors.warning, minWidth: 88 },
    calDayListLabel: { fontSize: 12, fontFamily: fonts.body, color: colors.text, flex: 1 },
  })
}
