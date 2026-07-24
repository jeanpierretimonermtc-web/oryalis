import { useMemo, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useClientAppointments } from '@/features/appointments/useAppointments'
import { deleteAppointment } from '@/features/appointments/appointmentService'
import type { Appointment, AppointmentType } from '@/features/appointments/appointmentTypes'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { Card } from '@/shared/components/ui/Card'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
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

  async function handleDelete(apptId: string) {
    await deleteAppointment(apptId)
    setConfirmId(null)
    refresh()
  }

  return (
    <>
      <Stack.Screen options={{
        title: t('appointments.title'),
        headerBackTitle: '',
        headerRight: () => (
          <TouchableOpacity onPress={() => router.push(`/(app)/appointments/new?clientId=${id}` as any)} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+</Text>
          </TouchableOpacity>
        ),
      }} />
      <View style={styles.container}>
        {loading
          ? <ActivityIndicator style={styles.loader} color={colors.primary} />
          : <FlatList
              data={appointments}
              keyExtractor={a => a.id}
              renderItem={({ item }) => (
                <AppointmentCard
                  appt={item}
                  locale={locale}
                  confirmId={confirmId}
                  onDeleteRequest={() => setConfirmId(item.id)}
                  onDeleteCancel={() => setConfirmId(null)}
                  onDeleteConfirm={() => handleDelete(item.id)}
                  colors={colors}
                  styles={styles}
                />
              )}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<EmptyState message={t('appointments.empty')} icon="📅" />}
            />
        }
      </View>
    </>
  )
}

// ── AppointmentCard ───────────────────────────────────────────────────────────
function AppointmentCard({ appt, locale, confirmId, onDeleteRequest, onDeleteCancel, onDeleteConfirm, colors, styles }: {
  appt: Appointment
  locale: string
  confirmId: string | null
  onDeleteRequest: () => void
  onDeleteCancel: () => void
  onDeleteConfirm: () => void
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
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

  return (
    <Card>
      <TouchableOpacity onPress={() => setExpanded(e => !e)} activeOpacity={0.75}>
        <View style={styles.cardHeader}>
          <View style={[styles.typeDot, { backgroundColor: accent }]} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.apptTitle}>{appt.title}</Text>
            <Text style={styles.apptDate}>{dateStr} – {endStr}</Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: (statusColor[appt.status] ?? colors.textSecondary) + '22' }]}>
            <Text style={[styles.statusText, { color: statusColor[appt.status] ?? colors.textSecondary }]}>
              {t(`appointment_types.${appt.appointment_type}` as any)}
            </Text>
          </View>
          <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.expandedContent}>
          {isConfirming ? (
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
          ) : (
            <View style={styles.cardActions}>
              <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.danger }]} onPress={onDeleteRequest} activeOpacity={0.75}>
                <Text style={styles.actionIcon}>🗑</Text>
                <Text style={[styles.actionLabel, { color: colors.danger }]}>{t('common.delete')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </Card>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list:      { padding: 12, gap: 8 },
  loader:    { marginTop: 40 },
  addBtn:    { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  addBtnText:{ color: '#fff', fontSize: 22, lineHeight: 28 },

  cardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingVertical: 2 },
  typeDot:     { width: 10, height: 10, borderRadius: 5 },
  apptTitle:   { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  apptDate:    { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:  { fontSize: 11, fontFamily: fonts.semibold },
  chevron:     { fontSize: 11, color: colors.textTertiary, paddingLeft: 2 },

  expandedContent: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, gap: 8 },

  cardActions:  { flexDirection: 'row', gap: 8 },
  actionBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, flex: 1 },
  actionIcon:   { fontSize: 13 },
  actionLabel:  { fontSize: 12, fontFamily: fonts.semibold },

  confirmRow:       { gap: 8 },
  confirmText:      { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },
  confirmBtns:      { flexDirection: 'row', gap: 8 },
  })
}
