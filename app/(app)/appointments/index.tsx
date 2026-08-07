import { useState, useCallback, useRef, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, useWindowDimensions, Modal,
} from 'react-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { LinearGradient } from 'expo-linear-gradient'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, type ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useGoogleCalendar } from '@/features/appointments/useGoogleCalendar'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import { deleteAppointment } from '@/features/appointments/appointmentService'
import type { AppointmentType } from '@/features/appointments/appointmentTypes'

// ── Local type (joins client for display) ─────────────────────────────────────
type CalAppt = {
  id: string
  user_id: string
  client_id: string | null
  title: string
  appointment_type: AppointmentType
  status: string
  start_at: string
  end_at: string
  client: { id: string; full_name: string; status: string } | null
}

type ViewMode = 'month' | 'week' | 'day'

// ── Constants ──────────────────────────────────────────────────────────────────
const DAY_HOUR_H   = 64
const WEEK_HOUR_H  = 38
const TIME_COL_W   = 44
const MIN_WEEK_COL = 72
const MONTH_ROWS   = 6
const START_HOUR   = 8
const END_HOUR     = 20
const DURATION_MIN = 60

const TYPE_COLORS: Record<AppointmentType, string> = {
  discovery_call:        '#3B82F6',
  product_presentation:  '#8B5CF6',
  follow_up:             '#10B981',
  closing_call:          '#F59E0B',
  customer_support:      '#22D3EE',
  team_training:         '#EC4899',
  team_meeting:          '#6366F1',
  webinar:               '#F97316',
  onboarding:            '#06B6D4',
  business_review:       '#84CC16',
  other:                 '#94A3B8',
}

const EVENT_PALETTE = [
  { bg: '#ede9f8', text: '#6b4fc8', accent: '#6b4fc8' },
  { bg: '#dbeeff', text: '#2563ab', accent: '#2563ab' },
  { bg: '#caecbc', text: '#3d7534', accent: '#3d7534' },
  { bg: '#fde8d0', text: '#c17b2a', accent: '#c17b2a' },
  { bg: '#fce4ec', text: '#c2185b', accent: '#c2185b' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  date.setHours(0, 0, 0, 0)
  return date
}
function addDays(d: Date, n: number): Date {
  const date = new Date(d); date.setDate(date.getDate() + n); return date
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}
function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function pad2(n: number) { return String(n).padStart(2, '0') }
function formatTime(d: Date) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
function clientColorIdx(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return h % EVENT_PALETTE.length
}
function firstWord(s: string | null | undefined) {
  return (s ?? '').split(' ')[0] ?? ''
}

// ── Locale data ───────────────────────────────────────────────────────────────
const DAYS_SHORT_FR = ['DIM', 'LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM']
const DAYS_SHORT_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DAYS_LONG_FR  = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const DAYS_LONG_EN  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const MONTHS_FULL_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const GRID_HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

// ─────────────────────────────────────────────────────────────────────────────
export default function AgendaScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { width: screenW } = useWindowDimensions()
  const isFr = i18n.language === 'fr'
  const { isConfigured: gcConfigured, isConnected: gcConnected, syncing: gcSyncing, syncResult: gcResult, error: gcError, syncAll: gcSyncAll } = useGoogleCalendar()

  const daysShort = isFr ? DAYS_SHORT_FR : DAYS_SHORT_EN
  const daysLong  = isFr ? DAYS_LONG_FR  : DAYS_LONG_EN
  const months    = isFr ? MONTHS_FR     : MONTHS_EN
  const monthsFull = isFr ? MONTHS_FULL_FR : MONTHS_FULL_EN
  const daysShortMon = [...daysShort.slice(1), daysShort[0]]

  const today = useRef((() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })()).current

  const [viewMode,    setViewMode]    = useState<ViewMode>('week')
  const [weekStart,   setWeekStart]   = useState<Date>(() => getMonday(today))
  const [selectedDay, setSelectedDay] = useState<Date>(today)
  const [monthAnchor, setMonthAnchor] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [rangeAppts,   setRangeAppts]   = useState<CalAppt[]>([])
  const [loadingRange, setLoadingRange] = useState(true)
  const [nextAppt,     setNextAppt]     = useState<CalAppt | null>(null)

  // Menu d'action rapide (Voir / Modifier / Supprimer) ouvert au clic sur un RDV du
  // calendrier, sans quitter la page — la suppression est irréversible, contrairement à
  // "Annuler" (statut) déjà disponible depuis la fiche détaillée.
  const [actionMenuAppt, setActionMenuAppt] = useState<CalAppt | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingAppt, setDeletingAppt] = useState(false)

  const monthGridStart = useMemo(
    () => getMonday(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1)),
    [monthAnchor]
  )
  const rangeStart = viewMode === 'month' ? monthGridStart : weekStart
  const rangeEnd   = viewMode === 'month' ? addDays(monthGridStart, MONTH_ROWS * 7) : addDays(weekStart, 7)

  // ── Data ──────────────────────────────────────────────────────────────────
  const fetchRange = useCallback(async () => {
    if (!session) return
    setLoadingRange(true)
    try {
      const { data } = await supabase
        .from('appointments')
        .select('id, user_id, client_id, title, appointment_type, status, start_at, end_at, client:clients(id, full_name, status)')
        .eq('user_id', session.user.id)
        .gte('start_at', rangeStart.toISOString())
        .lt('start_at', rangeEnd.toISOString())
        .order('start_at')
      setRangeAppts((data ?? []) as unknown as CalAppt[])
    } catch (e) {
      console.error('[Agenda.fetchRange]', e)
    } finally {
      setLoadingRange(false)
    }
  }, [session, rangeStart, rangeEnd])

  useFocusEffect(useCallback(() => { fetchRange() }, [fetchRange]))

  // Repère "prochain RDV" indépendant de la semaine/mois affiché, pour toujours
  // savoir où se trouve le prochain rendez-vous même si la vue actuelle est vide.
  const fetchNextAppt = useCallback(async () => {
    if (!session) return
    const { data } = await supabase
      .from('appointments')
      .select('id, user_id, client_id, title, appointment_type, status, start_at, end_at, client:clients(id, full_name, status)')
      .eq('user_id', session.user.id)
      .gte('start_at', new Date().toISOString())
      .in('status', ['scheduled', 'rescheduled'])
      .order('start_at')
      .limit(1)
    setNextAppt(((data ?? [])[0] as unknown as CalAppt) ?? null)
  }, [session])

  useFocusEffect(useCallback(() => { fetchNextAppt() }, [fetchNextAppt]))

  function jumpToAppt(appt: CalAppt) {
    const day = new Date(appt.start_at)
    day.setHours(0, 0, 0, 0)
    setSelectedDay(day)
    setWeekStart(getMonday(day))
    setMonthAnchor(new Date(day.getFullYear(), day.getMonth(), 1))
    setViewMode('day')
  }

  function openApptMenu(appt: CalAppt) {
    setActionMenuAppt(appt)
    setConfirmingDelete(false)
  }

  function closeApptMenu() {
    if (deletingAppt) return
    setActionMenuAppt(null)
    setConfirmingDelete(false)
  }

  function handleViewAppt() {
    if (!actionMenuAppt) return
    router.push(`/(app)/appointments/${actionMenuAppt.id}` as any)
    closeApptMenu()
  }

  function handleEditAppt() {
    if (!actionMenuAppt) return
    router.push(`/(app)/appointments/new?id=${actionMenuAppt.id}` as any)
    closeApptMenu()
  }

  async function handleDeleteAppt() {
    if (!actionMenuAppt) return
    setDeletingAppt(true)
    try {
      await deleteAppointment(actionMenuAppt.id)
      setActionMenuAppt(null)
      setConfirmingDelete(false)
      await Promise.all([fetchRange(), fetchNextAppt()])
    } catch (e) {
      console.error('[Agenda.deleteAppointment]', e)
    } finally {
      setDeletingAppt(false)
    }
  }

  const handleGoogleSyncPress = useCallback(async () => {
    if (!gcConnected) { router.push('/(app)/settings-google' as any); return }
    await gcSyncAll()
    fetchRange()
  }, [gcConnected, gcSyncAll, fetchRange])

  // ── Responsive column widths ────────────────────────────────────────────────
  const sidebarW    = screenW >= 768 ? 240 : 0
  const weekColW    = Math.max(MIN_WEEK_COL, Math.floor((screenW - sidebarW - TIME_COL_W - 4) / 7))
  const totalGridW  = 7 * weekColW
  const monthColW   = Math.floor((screenW - sidebarW - 24) / 7)
  const monthCompact = monthColW < 92

  // ── Derived ───────────────────────────────────────────────────────────────
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const monthDays = Array.from({ length: MONTH_ROWS * 7 }, (_, i) => addDays(monthGridStart, i))
  const dayAppts  = rangeAppts.filter(a => isSameDay(new Date(a.start_at), selectedDay))
  const isToday   = isSameDay(selectedDay, today)
  const weekEnd7  = addDays(weekStart, 6)
  const isCurrentPeriod = viewMode === 'month'
    ? (monthAnchor.getFullYear() === today.getFullYear() && monthAnchor.getMonth() === today.getMonth())
    : isToday

  const weekLabel = isFr
    ? `${weekStart.getDate()} ${months[weekStart.getMonth()]} – ${weekEnd7.getDate()} ${months[weekEnd7.getMonth()]} ${weekEnd7.getFullYear()}`
    : `${months[weekStart.getMonth()]} ${weekStart.getDate()} – ${months[weekEnd7.getMonth()]} ${weekEnd7.getDate()}, ${weekEnd7.getFullYear()}`

  const monthLabel = `${monthsFull[monthAnchor.getMonth()]} ${monthAnchor.getFullYear()}`
  const periodLabel = viewMode === 'month' ? monthLabel : weekLabel

  const dayHeaderText = isFr
    ? `${isToday ? "Aujourd'hui" : daysLong[selectedDay.getDay()]}, ${selectedDay.getDate()} ${months[selectedDay.getMonth()]}`
    : `${isToday ? 'Today' : daysLong[selectedDay.getDay()]}, ${months[selectedDay.getMonth()]} ${selectedDay.getDate()}`

  function dayApptCountLabel(count: number) {
    if (count === 0) return t('appointments.day_none')
    if (count === 1) return t('appointments.day_one')
    return t('appointments.day_other', { count })
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  function goPrev() {
    if (viewMode === 'month') { setMonthAnchor(m => addMonths(m, -1)); return }
    if (viewMode === 'day') {
      const next = addDays(selectedDay, -1)
      setSelectedDay(next)
      setWeekStart(getMonday(next))
      return
    }
    setWeekStart(ws => addDays(ws, -7)); setSelectedDay(d => addDays(d, -7))
  }
  function goNext() {
    if (viewMode === 'month') { setMonthAnchor(m => addMonths(m, 1)); return }
    if (viewMode === 'day') {
      const next = addDays(selectedDay, 1)
      setSelectedDay(next)
      setWeekStart(getMonday(next))
      return
    }
    setWeekStart(ws => addDays(ws, 7)); setSelectedDay(d => addDays(d, 7))
  }
  function jumpToToday() {
    setWeekStart(getMonday(today))
    setSelectedDay(today)
    setMonthAnchor(new Date(today.getFullYear(), today.getMonth(), 1))
  }

  function selectDay(day: Date, switchToDayView = false) {
    setSelectedDay(day)
    if (switchToDayView) setViewMode('day')
  }

  function goToDayFromMonth(day: Date) {
    setSelectedDay(day)
    setWeekStart(getMonday(day))
    setViewMode('day')
  }

  // ── Appointment block helpers ─────────────────────────────────────────────
  function apptTopPx(appt: CalAppt, hourH: number) {
    const d = new Date(appt.start_at)
    const frac = d.getHours() + d.getMinutes() / 60
    return (Math.max(frac, START_HOUR) - START_HOUR) * hourH
  }
  function apptHeightPx(appt: CalAppt, hourH: number, minH: number) {
    const start = new Date(appt.start_at).getTime()
    const end   = new Date(appt.end_at).getTime()
    const durMin = Math.max((end - start) / 60000, DURATION_MIN)
    return Math.max((durMin / 60) * hourH - 6, minH)
  }

  // ── MONTH VIEW ─────────────────────────────────────────────────────────────
  function renderMonthGrid() {
    const weeks = Array.from({ length: MONTH_ROWS }, (_, i) => monthDays.slice(i * 7, i * 7 + 7))
    return (
      <View style={styles.monthWrap}>
        <View style={styles.monthHeaderRow}>
          {daysShortMon.map((d, i) => (
            <View key={i} style={styles.monthHeaderCell}>
              <Text style={styles.monthHeaderText}>{d}</Text>
            </View>
          ))}
        </View>
        <View style={styles.monthGridBorder}>
          {weeks.map((week, wi) => (
            <View key={wi} style={styles.monthWeekRow}>
              {week.map((day, di) => {
                const inMonth = day.getMonth() === monthAnchor.getMonth()
                const isTod   = isSameDay(day, today)
                const isSel   = isSameDay(day, selectedDay)
                const events  = rangeAppts.filter(a => isSameDay(new Date(a.start_at), day))
                const maxChips = monthCompact ? 4 : 3
                return (
                  <TouchableOpacity
                    key={di}
                    style={[styles.monthCell, !inMonth && styles.monthCellOutside]}
                    onPress={() => goToDayFromMonth(day)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.monthDateBadge, isTod && styles.monthDateBadgeToday, isSel && styles.monthDateBadgeSel]}>
                      <Text style={[
                        styles.monthDateText,
                        !inMonth && styles.monthDateTextOutside,
                        isTod && !isSel && styles.monthDateTextToday,
                        isSel && styles.monthDateTextSel,
                      ]}>{day.getDate()}</Text>
                    </View>

                    {monthCompact ? (
                      <View style={styles.monthDotsRow}>
                        {events.slice(0, maxChips).map(appt => {
                          const accent = TYPE_COLORS[appt.appointment_type] ?? '#94A3B8'
                          const pal    = appt.client_id ? EVENT_PALETTE[clientColorIdx(appt.client_id)] : { accent }
                          return <View key={appt.id} style={[styles.monthDot, { backgroundColor: pal.accent }]} />
                        })}
                        {events.length > maxChips && <Text style={styles.monthMoreText}>+{events.length - maxChips}</Text>}
                      </View>
                    ) : (
                      <View style={styles.monthEvents}>
                        {events.slice(0, maxChips).map(appt => {
                          const accent = TYPE_COLORS[appt.appointment_type] ?? '#94A3B8'
                          const pal    = appt.client_id ? EVENT_PALETTE[clientColorIdx(appt.client_id)] : { bg: colors.bgDim, text: colors.textSecondary, accent }
                          return (
                            <View key={appt.id} style={[styles.monthEventChip, { backgroundColor: pal.bg, borderLeftColor: accent }]}>
                              <Text style={[styles.monthEventText, { color: pal.text }]} numberOfLines={1}>
                                {appt.client ? firstWord(appt.client.full_name) : appt.title}
                              </Text>
                            </View>
                          )
                        })}
                        {events.length > maxChips && <Text style={styles.monthMoreText}>+{events.length - maxChips}</Text>}
                      </View>
                    )}
                  </TouchableOpacity>
                )
              })}
            </View>
          ))}
        </View>
      </View>
    )
  }

  // ── WEEK VIEW ──────────────────────────────────────────────────────────────
  const GRID_H        = (END_HOUR - START_HOUR) * WEEK_HOUR_H
  const WEEK_HEADER_H = 64

  function renderWeekGrid() {
    return (
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: TIME_COL_W }}>
          <View style={{ height: WEEK_HEADER_H, backgroundColor: colors.primaryLight, borderBottomWidth: 1, borderBottomColor: colors.border }} />
          <View style={[styles.timeCol, { height: GRID_H + 8 }]}>
            {GRID_HOURS.filter(h => h % 2 === 0).map(h => (
              <View key={h} style={{ position: 'absolute', top: (h - START_HOUR) * WEEK_HOUR_H - 8, width: TIME_COL_W }}>
                <Text style={styles.hourLabelWeek}>{pad2(h)}h</Text>
              </View>
            ))}
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View style={{ width: totalGridW }}>
            <View style={{ flexDirection: 'row', height: WEEK_HEADER_H, backgroundColor: colors.primaryLight, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' }}>
              {weekDays.map((day, i) => {
                const isSel = isSameDay(day, selectedDay)
                const isTod = isSameDay(day, today)
                const hasDot = rangeAppts.some(a => isSameDay(new Date(a.start_at), day))
                return (
                  <TouchableOpacity key={i} style={[styles.weekDayHeaderCell, { width: weekColW, justifyContent: 'center' }]} onPress={() => selectDay(day, true)} activeOpacity={0.7}>
                    <Text style={[styles.weekDayShort, (isSel || isTod) && styles.weekDayShortActive]}>{daysShort[day.getDay()]}</Text>
                    <View style={[styles.weekDayCircle, isTod && styles.weekDayCircleToday, isSel && styles.weekDayCircleSel]}>
                      <Text style={[styles.weekDayNum, isTod && !isSel && styles.weekDayNumToday, isSel && styles.weekDayNumSel]}>{day.getDate()}</Text>
                    </View>
                    {hasDot && <View style={[styles.dot, isSel && styles.dotSel]} />}
                  </TouchableOpacity>
                )
              })}
            </View>

            <View style={{ width: totalGridW, height: GRID_H, position: 'relative' }}>
              {GRID_HOURS.map(h => (
                <View key={h} style={[styles.weekHourLine, { top: (h - START_HOUR) * WEEK_HOUR_H }, h % 2 === 0 ? styles.weekHourLineMain : styles.weekHourLineMinor]} />
              ))}
              {weekDays.map((_, i) => (
                <View key={i} style={[styles.weekColDiv, { left: i * weekColW }]} />
              ))}

              {weekDays.map((day, dayIdx) => {
                const appts = rangeAppts.filter(a => isSameDay(new Date(a.start_at), day))
                return appts.map(appt => {
                  const accent = TYPE_COLORS[appt.appointment_type] ?? '#94A3B8'
                  const pal    = appt.client_id ? EVENT_PALETTE[clientColorIdx(appt.client_id)] : { bg: '#f1f5f9', text: '#475569', accent }
                  const topPx  = apptTopPx(appt, WEEK_HOUR_H)
                  const hPx    = apptHeightPx(appt, WEEK_HOUR_H, 24)
                  const d      = new Date(appt.start_at)
                  return (
                    <TouchableOpacity
                      key={appt.id}
                      style={[styles.weekApptBlock, { left: dayIdx * weekColW + 3, width: weekColW - 6, top: topPx + 2, height: hPx, backgroundColor: pal.bg, borderLeftColor: accent }]}
                      onPress={() => openApptMenu(appt)}
                      accessibilityLabel={t('appointments.view_detail_hint')}
                      activeOpacity={0.8}
                    >
                      {hPx > 30 && (
                        <Text style={[styles.weekApptTime, { color: pal.text }]}>{formatTime(d)}</Text>
                      )}
                      <Text style={[styles.weekApptName, { color: pal.text }]} numberOfLines={1}>
                        {appt.client ? firstWord(appt.client.full_name) : appt.title}
                      </Text>
                    </TouchableOpacity>
                  )
                })
              })}

              {weekDays.map((day, dayIdx) => (
                <TouchableOpacity key={`zone-${dayIdx}`} style={{ position: 'absolute', left: dayIdx * weekColW, width: weekColW, top: 0, height: GRID_H, zIndex: 0 }} onPress={() => selectDay(day, true)} activeOpacity={1} />
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    )
  }

  // ── DAY VIEW ───────────────────────────────────────────────────────────────
  function renderDayView() {
    return (
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.dayInfoBar}>
          <View>
            <Text style={styles.dayHeaderText}>{dayHeaderText}</Text>
            <Text style={styles.dayApptCount}>{dayApptCountLabel(dayAppts.length)}</Text>
          </View>
          {loadingRange && <ActivityIndicator size="small" color={colors.primary} />}
        </View>

        <View style={[styles.timeGrid, { height: (END_HOUR - START_HOUR) * DAY_HOUR_H + 32 }]}>
          {GRID_HOURS.map(h => (
            <View key={h} style={[styles.hourRow, { top: (h - START_HOUR) * DAY_HOUR_H }]}>
              <Text style={styles.hourLabel}>{pad2(h)}h</Text>
              <View style={[styles.hourLine, h % 2 === 0 ? styles.hourLineMain : styles.hourLineMinor]} />
            </View>
          ))}

          <TouchableOpacity
            style={styles.dayTapZone}
            onPress={(e) => {
              const tapY = e.nativeEvent.locationY
              const hour = Math.min(Math.max(Math.floor(tapY / DAY_HOUR_H) + START_HOUR, START_HOUR), END_HOUR - 1)
              const dateStr = selectedDay.toISOString().split('T')[0]
              router.push(`/(app)/appointments/new?date=${dateStr}&time=${pad2(hour)}:00` as any)
            }}
            activeOpacity={0.95}
          />

          {dayAppts.map(appt => {
            const d      = new Date(appt.start_at)
            const end    = new Date(appt.end_at)
            const topPx  = apptTopPx(appt, DAY_HOUR_H) + 4
            const hPx    = apptHeightPx(appt, DAY_HOUR_H, 56)
            const accent = TYPE_COLORS[appt.appointment_type] ?? '#94A3B8'
            const pal    = appt.client_id ? EVENT_PALETTE[clientColorIdx(appt.client_id)] : { bg: '#f1f5f9', text: '#475569', accent }
            return (
              <TouchableOpacity
                key={appt.id}
                style={[styles.dayApptBlock, { top: topPx, height: hPx, backgroundColor: pal.bg, borderLeftColor: accent, zIndex: 1 }]}
                onPress={() => openApptMenu(appt)}
                accessibilityLabel={t('appointments.view_detail_hint')}
                activeOpacity={0.8}
              >
                <View style={styles.dayApptHeaderRow}>
                  <Text style={[styles.dayApptTime, { color: accent }]}>
                    {formatTime(d)} – {formatTime(end)}
                  </Text>
                </View>
                <Text style={[styles.dayApptClient, { color: pal.text }]} numberOfLines={1}>
                  {appt.client ? appt.client.full_name : appt.title}
                </Text>
                {appt.client && hPx > 72 ? (
                  <Text style={[styles.dayApptTheme, { color: pal.text }]} numberOfLines={1}>{appt.title}</Text>
                ) : null}
              </TouchableOpacity>
            )
          })}

          {dayAppts.length === 0 && !loadingRange && (
            <View style={styles.emptyDay}>
              <Text style={styles.emptyDayEmoji}>✨</Text>
              <Text style={styles.emptyDayTitle}>{t('appointments.free_day')}</Text>
              <Text style={styles.emptyDaySub}>{t('appointments.free_day_sub')}</Text>
            </View>
          )}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    )
  }

  // ── ROOT ───────────────────────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>

        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{t('appointments.nav_title')}</Text>
          <View style={styles.headerRight}>
            {gcConfigured && (
              <TouchableOpacity
                style={[styles.syncBtn, gcConnected && styles.syncBtnConnected]}
                onPress={handleGoogleSyncPress}
                disabled={gcSyncing}
                activeOpacity={0.7}
                accessibilityLabel={gcConnected ? t('settings.sync_google_sync') : t('settings.sync_google_connect')}
              >
                {gcSyncing
                  ? <ActivityIndicator size="small" color={gcConnected ? colors.primary : colors.textTertiary} />
                  : <LineIcon name="sync" size={16} color={gcConnected ? colors.primary : colors.textTertiary} />
                }
              </TouchableOpacity>
            )}
            {!isCurrentPeriod && (
              <TouchableOpacity style={styles.todayBtn} onPress={jumpToToday} activeOpacity={0.7}>
                <Text style={styles.todayBtnText}>{t('appointments.today_short')}</Text>
              </TouchableOpacity>
            )}
            {loadingRange && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
        </View>

        {(gcResult || gcError) && (
          <Text style={[styles.gcStatusText, gcError && { color: colors.danger }]}>
            {gcError ? gcError : `✓ ${t('settings.sync_google_result', { pushed: gcResult!.pushed, pulled: gcResult!.pulled })}`}
          </Text>
        )}

        {nextAppt && (
          <TouchableOpacity style={styles.nextApptBanner} onPress={() => jumpToAppt(nextAppt)} activeOpacity={0.8}>
            <LineIcon name="calendarPlus" size={15} color={colors.primary} strokeWidth={2} />
            <Text style={styles.nextApptText} numberOfLines={1}>
              {t('appointments.next_appt_banner', {
                date: `${daysShort[new Date(nextAppt.start_at).getDay()]} ${new Date(nextAppt.start_at).getDate()} ${months[new Date(nextAppt.start_at).getMonth()]}`,
                time: formatTime(new Date(nextAppt.start_at)),
                name: nextAppt.client ? firstWord(nextAppt.client.full_name) : nextAppt.title,
              })}
            </Text>
            <Text style={styles.nextApptArrow}>→</Text>
          </TouchableOpacity>
        )}

        <View style={styles.viewToggleRow}>
          <View style={styles.viewToggle}>
            <TouchableOpacity style={[styles.toggleBtn, viewMode === 'month' && styles.toggleBtnActive]} onPress={() => setViewMode('month')} activeOpacity={0.75}>
              <Text style={[styles.toggleBtnText, viewMode === 'month' && styles.toggleBtnTextActive]}>{t('appointments.view_month')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toggleBtn, viewMode === 'week' && styles.toggleBtnActive]} onPress={() => setViewMode('week')} activeOpacity={0.75}>
              <Text style={[styles.toggleBtnText, viewMode === 'week' && styles.toggleBtnTextActive]}>{t('appointments.view_week')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toggleBtn, viewMode === 'day' && styles.toggleBtnActive]} onPress={() => setViewMode('day')} activeOpacity={0.75}>
              <Text style={[styles.toggleBtnText, viewMode === 'day' && styles.toggleBtnTextActive]}>{t('appointments.view_day')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.weekNavCompact}>
            <TouchableOpacity onPress={goPrev} style={styles.weekArrow} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
              <LineIcon name="chevronLeft" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <Text style={styles.weekLabel} numberOfLines={1}>{periodLabel}</Text>
            <TouchableOpacity onPress={goNext} style={styles.weekArrow} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
              <LineIcon name="chevronRight" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {viewMode === 'month' && (
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {renderMonthGrid()}
            <View style={{ height: 80 }} />
          </ScrollView>
        )}

        {viewMode === 'week' && (
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            {renderWeekGrid()}
            <View style={{ height: 80 }} />
          </ScrollView>
        )}

        {viewMode === 'day' && renderDayView()}

        <View style={styles.bottomBar}>
          <View style={styles.bottomLeft}>
            <Text style={styles.bottomWeekLabel}>{viewMode === 'month' ? t('appointments.this_month') : t('appointments.this_week')}</Text>
            <Text style={styles.bottomWeekCount}>
              {rangeAppts.length === 1
                ? t('appointments.week_appt_one')
                : t('appointments.week_appt_other', { count: rangeAppts.length })}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              const dateStr = selectedDay.toISOString().split('T')[0]
              router.push(`/(app)/appointments/new?date=${dateStr}` as any)
            }}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={brandColors.gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.newRdvBtn}
            >
              <LineIcon name="calendarPlus" size={16} color="#fff" strokeWidth={2.2} />
              <Text style={styles.newRdvText}>{t('appointments.add')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      <Modal visible={!!actionMenuAppt} transparent animationType="fade" onRequestClose={closeApptMenu}>
        <TouchableOpacity style={styles.apptMenuOverlay} activeOpacity={1} onPress={closeApptMenu}>
          <TouchableOpacity activeOpacity={1} style={styles.apptMenuSheet}>
            {actionMenuAppt ? (
              <>
                <View style={styles.apptMenuHeader}>
                  <Text style={styles.apptMenuTitle} numberOfLines={1}>{actionMenuAppt.title}</Text>
                  <Text style={styles.apptMenuSub}>
                    {(() => {
                      const d = new Date(actionMenuAppt.start_at)
                      return `${d.getDate()} ${months[d.getMonth()]} · ${formatTime(d)}`
                    })()}
                  </Text>
                </View>

                {confirmingDelete ? (
                  <>
                    <Text style={styles.apptMenuConfirmText}>{t('appointments.confirm_delete_appt')}</Text>
                    <View style={styles.apptMenuConfirmRow}>
                      <TouchableOpacity
                        style={styles.apptMenuSecondaryBtn}
                        onPress={() => setConfirmingDelete(false)}
                        disabled={deletingAppt}
                      >
                        <Text style={styles.apptMenuSecondaryBtnText}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.apptMenuDangerBtn, deletingAppt && { opacity: 0.6 }]}
                        onPress={handleDeleteAppt}
                        disabled={deletingAppt}
                      >
                        {deletingAppt
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={styles.apptMenuDangerBtnText}>{t('common.delete')}</Text>}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={styles.apptMenuRow} onPress={handleViewAppt} activeOpacity={0.7}>
                      <Text style={styles.apptMenuRowText}>{t('appointments.view_detail_hint')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.apptMenuRow} onPress={handleEditAppt} activeOpacity={0.7}>
                      <Text style={styles.apptMenuRowText}>{t('common.edit')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.apptMenuRow} onPress={() => setConfirmingDelete(true)} activeOpacity={0.7}>
                      <Text style={[styles.apptMenuRowText, { color: colors.danger }]}>{t('common.delete')}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },

  // Menu d'action rapide sur un RDV du calendrier
  apptMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  apptMenuSheet:   { width: '100%', maxWidth: 320, borderRadius: 16, padding: 16, backgroundColor: colors.card, boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 24, color: 'rgba(0, 0, 0, 0.2)' }], elevation: 16 },
  apptMenuHeader:  { marginBottom: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  apptMenuTitle:   { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  apptMenuSub:     { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 2 },
  apptMenuRow:     { paddingVertical: 12 },
  apptMenuRowText: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
  apptMenuConfirmText: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18, marginBottom: 14 },
  apptMenuConfirmRow:  { flexDirection: 'row', gap: 10 },
  apptMenuSecondaryBtn:     { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  apptMenuSecondaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  apptMenuDangerBtn:        { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: colors.danger },
  apptMenuDangerBtnText:    { fontSize: 14, fontFamily: fonts.semibold, color: '#ffffff' },

  pageHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  pageTitle:    { fontSize: 28, fontFamily: fonts.display, color: colors.text },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  todayBtn:     { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: colors.primaryLight },
  todayBtnText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },

  syncBtn:          { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgDim },
  syncBtnConnected: { backgroundColor: colors.primaryLight },
  gcStatusText:     { fontSize: 11, fontFamily: fonts.medium, color: colors.success, paddingHorizontal: 20, paddingTop: 4 },

  nextApptBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 8, marginBottom: 2,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10,
    backgroundColor: colors.primaryLight,
  },
  nextApptText:  { flex: 1, fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
  nextApptArrow: { fontSize: 14, color: colors.primary },

  viewToggleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: 8, columnGap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card },
  viewToggle:          { flexDirection: 'row', backgroundColor: colors.bgDim, borderRadius: 10, padding: 3, gap: 2 },
  toggleBtn:           { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 },
  toggleBtnActive:     { backgroundColor: colors.card, boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(0, 0, 0, 0.1)' }], elevation: 2 },
  toggleBtnText:       { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  toggleBtnTextActive: { color: colors.text, fontFamily: fonts.semibold },

  weekNavCompact: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 1 },
  weekArrow:      { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  weekLabel:      { fontSize: 12, fontFamily: fonts.semibold, color: colors.text, textAlign: 'center', maxWidth: 110 },

  weekDayHeaderCell:  { alignItems: 'center', gap: 3 },
  weekDayShort:       { fontSize: 9, fontFamily: fonts.bold, color: colors.textSecondary, letterSpacing: 0.5 },
  weekDayShortActive: { color: colors.primary },
  weekDayCircle:      { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  weekDayCircleToday: { borderWidth: 1.5, borderColor: colors.primary },
  weekDayCircleSel:   { backgroundColor: colors.primary },
  weekDayNum:         { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
  weekDayNumToday:    { color: colors.primary, fontFamily: fonts.semibold },
  weekDayNumSel:      { color: '#ffffff', fontFamily: fonts.bold },

  timeCol:           { width: TIME_COL_W, position: 'relative' },
  hourLabelWeek:     { fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary, textAlign: 'right', paddingRight: 8 },
  weekHourLine:      { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  weekHourLineMain:  { backgroundColor: colors.border, opacity: 0.9 },
  weekHourLineMinor: { backgroundColor: colors.border, opacity: 0.35 },
  weekColDiv:        { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: colors.border, opacity: 0.5 },

  weekApptBlock: { position: 'absolute', borderRadius: 5, borderLeftWidth: 2.5, paddingHorizontal: 4, paddingVertical: 2, overflow: 'hidden', zIndex: 2 },
  weekApptTime:  { fontSize: 9, fontFamily: fonts.medium, opacity: 0.85 },
  weekApptName:  { fontSize: 11, fontFamily: fonts.bold },

  // ── Month grid ─────────────────────────────────────────────────────────────
  monthWrap:       { paddingHorizontal: 12, paddingTop: 10 },
  monthHeaderRow:  { flexDirection: 'row', paddingBottom: 8 },
  monthHeaderCell: { flex: 1, alignItems: 'center' },
  monthHeaderText: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 0.5 },
  monthGridBorder: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.border },
  monthWeekRow:    { flexDirection: 'row', gap: StyleSheet.hairlineWidth },
  monthCell: {
    flex: 1, minHeight: 88, backgroundColor: colors.card, padding: 5, gap: 3,
    marginBottom: StyleSheet.hairlineWidth,
  },
  monthCellOutside:    { backgroundColor: colors.bgDim },
  monthDateBadge:      { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  monthDateBadgeToday: { backgroundColor: colors.primaryLight },
  monthDateBadgeSel:   { backgroundColor: colors.primary },
  monthDateText:       { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  monthDateTextOutside:{ color: colors.textTertiary },
  monthDateTextToday:  { color: colors.primary, fontFamily: fonts.bold },
  monthDateTextSel:    { color: '#ffffff', fontFamily: fonts.bold },
  monthEvents:         { gap: 2 },
  monthEventChip:      { borderRadius: 4, borderLeftWidth: 2.5, paddingHorizontal: 4, paddingVertical: 1.5 },
  monthEventText:      { fontSize: 9.5, fontFamily: fonts.semibold },
  monthMoreText:       { fontSize: 9.5, fontFamily: fonts.medium, color: colors.textTertiary, paddingLeft: 3, marginTop: 1 },
  monthDotsRow:        { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 3, paddingLeft: 2 },
  monthDot:            { width: 5, height: 5, borderRadius: 2.5 },

  dot:            { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary },
  dotSel:         { backgroundColor: '#ffffff' },

  dayInfoBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  dayHeaderText:  { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
  dayApptCount:   { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 1 },

  body:          { flex: 1 },
  timeGrid:      { position: 'relative', paddingTop: 4 },
  hourRow:       { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-start', height: DAY_HOUR_H },
  hourLabel:     { width: TIME_COL_W, fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary, textAlign: 'right', paddingRight: 10, lineHeight: 16 },
  hourLine:      { flex: 1, height: StyleSheet.hairlineWidth, marginTop: 8, marginRight: 8 },
  hourLineMain:  { backgroundColor: colors.border },
  hourLineMinor: { backgroundColor: colors.border, opacity: 0.4 },

  dayTapZone:   { position: 'absolute', top: 0, left: TIME_COL_W, right: 0, bottom: 0, zIndex: 0 },

  dayApptBlock:     { position: 'absolute', left: TIME_COL_W + 4, right: 8, borderRadius: 10, borderLeftWidth: 4, paddingHorizontal: 12, paddingVertical: 8, overflow: 'hidden' },
  dayApptHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  dayApptTime:      { fontSize: 11, fontFamily: fonts.medium, opacity: 0.9 },
  dayApptClient:    { fontSize: 16, fontFamily: fonts.bold, lineHeight: 20 },
  dayApptTheme:     { fontSize: 12, fontFamily: fonts.body, opacity: 0.72, marginTop: 3, lineHeight: 16 },

  emptyDay:      { position: 'absolute', top: 80, left: TIME_COL_W, right: 8, alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyDayEmoji: { fontSize: 36 },
  emptyDayTitle: { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
  emptyDaySub:   { fontSize: 13, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center' },

  bottomBar:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, gap: 12 },
  bottomLeft:      { flex: 1, gap: 1 },
  bottomWeekLabel: { fontSize: 11, fontFamily: fonts.body, color: colors.textSecondary },
  bottomWeekCount: { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  newRdvBtn:       {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12,
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(59, 130, 246, 0.35)' }],
    elevation: 3,
  },
  newRdvText:      { fontSize: 14, fontFamily: fonts.semibold, color: '#ffffff' },
  })
}
