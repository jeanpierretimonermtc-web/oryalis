import { useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { LinearGradient } from 'expo-linear-gradient'
import { useClientAppointments } from '@/features/appointments/useAppointments'
import { deleteAppointment } from '@/features/appointments/appointmentService'
import type { Appointment, AppointmentType } from '@/features/appointments/appointmentTypes'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { Card } from '@/shared/components/ui/Card'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, type ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'

const TYPE_ACCENT: Record<AppointmentType, string> = {
  discovery_call:       '#3B82F6',
  product_presentation: '#8B5CF6',
  follow_up:            '#10B981',
  closing_call:         '#F59E0B',
  customer_support:     '#22D3EE',
  team_training:        '#EC4899',
  team_meeting:         '#6366F1',
  webinar:              '#F97316',
  onboarding:           '#06B6D4',
  business_review:      '#84CC16',
  other:                '#94A3B8',
}

function pad2(n: number) { return String(n).padStart(2, '0') }
function formatDateTime(iso: string, locale: string) {
  const d = new Date(iso)
  const dateStr = formatDate(d, locale, { day: '2-digit', month: 'long', year: 'numeric' })
  const timeStr = `${pad2(d.getHours())}h${pad2(d.getMinutes())}`
  const hasTime = d.getHours() > 0 || d.getMinutes() > 0
  return hasTime ? `${dateStr} · ${timeStr}` : dateStr
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function ClientAppointmentsScreen() {
  const { t, i18n } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { appointments, loading, refresh } = useClientAppointments(id)
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const { upcoming, history } = useMemo(() => {
    const now = Date.now()
    const up: Appointment[] = []
    const hist: Appointment[] = []
    for (const a of appointments) {
      if (new Date(a.start_at).getTime() >= now) up.push(a)
      else hist.push(a)
    }
    up.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    hist.sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
    return { upcoming: up, history: hist }
  }, [appointments])

  async function handleDelete(apptId: string) {
    await deleteAppointment(apptId)
    setConfirmId(null)
    refresh()
  }

  function goToNew() {
    router.push(`/(app)/appointments/new?clientId=${id}` as any)
  }

  function viewAppointment(apptId: string) {
    const returnTo = encodeURIComponent(`/(app)/clients/${id}/appointments`)
    router.push(`/(app)/appointments/${apptId}?returnTo=${returnTo}` as any)
  }

  return (
    <>
      <Stack.Screen options={{ title: t('appointments.title'), headerBackTitle: '' }} />
      <View style={styles.container}>
        <TouchableOpacity onPress={goToNew} activeOpacity={0.85} style={styles.newBtnWrap}>
          <LinearGradient
            colors={brandColors.gradients.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.newBtn}
          >
            <LineIcon name="calendarPlus" size={16} color="#fff" strokeWidth={2.2} />
            <Text style={styles.newBtnText}>{t('appointments.add')}</Text>
          </LinearGradient>
        </TouchableOpacity>

        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : appointments.length === 0 ? (
          <EmptyState
            message={t('appointments.empty_client')}
            icon="📅"
            actionLabel={t('appointments.add')}
            actionVariant="gradient"
            actionIcon="calendarPlus"
            onAction={goToNew}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {upcoming.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>{t('appointments.upcoming')} ({upcoming.length})</Text>
                {upcoming.map(appt => (
                  <AppointmentCard
                    key={appt.id}
                    appt={appt}
                    locale={locale}
                    confirmId={confirmId}
                    onPress={() => viewAppointment(appt.id)}
                    onDeleteRequest={() => setConfirmId(appt.id)}
                    onDeleteCancel={() => setConfirmId(null)}
                    onDeleteConfirm={() => handleDelete(appt.id)}
                    colors={colors}
                    styles={styles}
                  />
                ))}
              </>
            )}

            {history.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, upcoming.length > 0 && { marginTop: 20 }]}>
                  {t('appointments.sidebar.history')} ({history.length})
                </Text>
                {history.map(appt => (
                  <AppointmentCard
                    key={appt.id}
                    appt={appt}
                    locale={locale}
                    confirmId={confirmId}
                    onPress={() => viewAppointment(appt.id)}
                    onDeleteRequest={() => setConfirmId(appt.id)}
                    onDeleteCancel={() => setConfirmId(null)}
                    onDeleteConfirm={() => handleDelete(appt.id)}
                    colors={colors}
                    styles={styles}
                  />
                ))}
              </>
            )}
            <View style={{ height: 24 }} />
          </ScrollView>
        )}
      </View>
    </>
  )
}

// ── AppointmentCard ───────────────────────────────────────────────────────────
function AppointmentCard({ appt, locale, confirmId, onPress, onDeleteRequest, onDeleteCancel, onDeleteConfirm, colors, styles }: {
  appt: Appointment
  locale: string
  confirmId: string | null
  onPress: () => void
  onDeleteRequest: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
}) {
  const { t } = useTranslation()
  const isConfirming = confirmId === appt.id
  const accent = TYPE_ACCENT[appt.appointment_type] ?? '#94A3B8'

  const dateStr = formatDateTime(appt.start_at, locale)
  const endStr  = new Date(appt.end_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  const statusColor: Record<string, string> = {
    scheduled:  colors.primary,
    completed:  colors.success,
    cancelled:  colors.danger,
    no_show:    colors.warning,
    rescheduled:colors.textSecondary,
  }

  if (isConfirming) {
    return (
      <Card>
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>{t('appointments.confirm_delete_appt')}</Text>
          <View style={styles.confirmBtns}>
            <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={onDeleteCancel}>
              <Text style={[styles.actionLabel, { color: colors.text }]}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.danger, backgroundColor: colors.danger }]} onPress={onDeleteConfirm}>
              <Text style={[styles.actionLabel, { color: '#ffffff' }]}>{t('common.delete')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Card>
    )
  }

  return (
    <Card>
      <View style={styles.cardRow}>
        <TouchableOpacity style={styles.cardMain} onPress={onPress} activeOpacity={0.75}>
          <View style={[styles.typeDot, { backgroundColor: accent }]} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.apptTitle} numberOfLines={1}>{appt.title}</Text>
            <Text style={styles.apptDate}>{dateStr} – {endStr}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: (statusColor[appt.status] ?? colors.textSecondary) + '22' }]}>
            <Text style={[styles.statusText, { color: statusColor[appt.status] ?? colors.textSecondary }]} numberOfLines={1}>
              {t(`appointment_types.${appt.appointment_type}` as any)}
            </Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDeleteRequest} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={styles.deleteIconBtn}>
          <Text style={styles.deleteIcon}>🗑</Text>
        </TouchableOpacity>
      </View>
    </Card>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },
  list:      { padding: 12, gap: 8 },
  loader:    { marginTop: 40 },

  newBtnWrap: { alignSelf: 'flex-start', marginHorizontal: 12, marginTop: 12 },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10,
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 10, color: 'rgba(59, 130, 246, 0.35)' }],
    elevation: 3,
  },
  newBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: '#fff' },

  sectionTitle: { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4, marginTop: 4, paddingHorizontal: 4 },

  cardRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardMain:    { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingVertical: 2 },
  typeDot:     { width: 10, height: 10, borderRadius: 5 },
  apptTitle:   { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  apptDate:    { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 11, fontFamily: fonts.semibold },
  deleteIconBtn: { padding: 6 },
  deleteIcon:    { fontSize: 15 },

  cardActions:  { flexDirection: 'row', gap: 8 },
  actionBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, flex: 1 },
  actionIcon:   { fontSize: 13 },
  actionLabel:  { fontSize: 12, fontFamily: fonts.semibold },

  confirmRow:       { gap: 8 },
  confirmText:      { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },
  confirmBtns:      { flexDirection: 'row', gap: 8 },
  })
}
