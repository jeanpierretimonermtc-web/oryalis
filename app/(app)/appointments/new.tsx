import { useState, useEffect, useMemo, type ReactNode } from 'react'
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Modal, FlatList, TextInput, ActivityIndicator,
  useWindowDimensions,
} from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import { createAppointment, updateAppointment, fetchAppointmentById } from '@/features/appointments/appointmentService'
import type { AppointmentType } from '@/features/appointments/appointmentTypes'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { CalendarPickerModal } from '@/shared/components/ui/CalendarPickerModal'
import { TimePickerModal } from '@/shared/components/ui/TimePickerModal'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { Client } from '@/shared/lib/types'

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function pad(n: number) { return String(n).padStart(2, '0') }
// Interprète date+heure comme l'heure LOCALE de l'appareil (celle que l'utilisateur a
// saisie) et convertit correctement en UTC pour le stockage — une simple concaténation de
// chaînes sans fuseau était interprétée par Postgres dans le fuseau de la session (UTC),
// décalant chaque RDV de l'écart entre l'heure locale et UTC (ex. +2h en été en France).
function toISO(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString()
}
// Ajoute des minutes en arithmétique locale pure (jamais de conversion UTC intermédiaire),
// pour préremplir l'heure de fin suggérée sans décalage de fuseau.
function addMinutesToTime(date: string, time: string, minutes: number): { date: string; time: string } {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const dt = new Date(y, m - 1, d, hh, mm + minutes, 0, 0)
  return {
    date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
    time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  }
}

// ── SelectPill ────────────────────────────────────────────────────────────────
function SelectPill<T extends string>({ options, value, onChange, colors, wrap }: {
  options: { value: T; label: string }[]
  value: T | null
  onChange: (v: T) => void
  colors: ThemeColors
  // Web/large écran : tous les choix affichés d'un coup (retour à la ligne) plutôt que
  // coupés dans une bande qui défile horizontalement sans indice visuel de défilement.
  wrap?: boolean
}) {
  const pills = options.map(opt => {
    const active = opt.value === value
    return (
      <TouchableOpacity
        key={opt.value}
        style={[
          { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primaryLight : colors.card },
        ]}
        onPress={() => onChange(opt.value)}
        activeOpacity={0.75}
      >
        <Text style={{ fontSize: 13, fontFamily: active ? fonts.semibold : fonts.body, color: active ? colors.primary : colors.textSecondary }}>
          {opt.label}
        </Text>
      </TouchableOpacity>
    )
  })

  if (wrap) {
    return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 2 }}>{pills}</View>
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {pills}
    </ScrollView>
  )
}

// ── SectionCard ───────────────────────────────────────────────────────────────
function SectionCard({ icon, title, children, colors, styles }: {
  icon: string; title: string; children: ReactNode; colors: ThemeColors; styles: ReturnType<typeof makeStyles>
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={{ fontSize: 16 }}>{icon}</Text>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  )
}

// ── Field ─────────────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 11, fontFamily: fonts.semibold, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Text>
      {children}
    </View>
  )
}

// ── Client Picker Modal ───────────────────────────────────────────────────────
function ClientPickerModal({ visible, onClose, onSelect, userId, colors, styles }: {
  visible: boolean; onClose: () => void; onSelect: (c: Client) => void
  userId: string; colors: ThemeColors; styles: ReturnType<typeof makeStyles>
}) {
  const { t } = useTranslation()
  const { statusColors } = useTheme()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Client[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!visible || !userId) return
    setLoading(true)
    supabase.from('clients').select('id, full_name, first_name, email, status, pipeline_stage').eq('user_id', userId).is('archived_at', null).order('full_name').limit(60)
      .then(({ data }) => { setResults((data ?? []) as Client[]); setLoading(false) })
  }, [visible, userId])

  useEffect(() => {
    if (!visible || !userId || query.length === 0) {
      if (visible && userId) {
        supabase.from('clients').select('id, full_name, first_name, email, status, pipeline_stage').eq('user_id', userId).is('archived_at', null).order('full_name').limit(60)
          .then(({ data }) => setResults((data ?? []) as Client[]))
      }
      return
    }
    if (query.length < 2) return
    const timer = setTimeout(() => {
      supabase.from('clients').select('id, full_name, first_name, email, status, pipeline_stage').eq('user_id', userId).is('archived_at', null).ilike('full_name', `%${query}%`).limit(20)
        .then(({ data }) => setResults((data ?? []) as Client[]))
    }, 200)
    return () => clearTimeout(timer)
  }, [query, visible, userId])

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.clientModal, { backgroundColor: colors.bg }]}>
        <View style={[styles.clientModalHeader, { borderBottomColor: colors.border }]}>
          <Text style={styles.clientModalTitle}>{t('appointments.select_client')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ fontSize: 18, color: colors.textSecondary }}>✕</Text>
          </TouchableOpacity>
        </View>
        <View style={[styles.searchBox, { backgroundColor: colors.bgDim, borderColor: colors.border }]}>
          <Text style={{ fontSize: 16 }}>🔍</Text>
          <TextInput style={[styles.searchInput, { color: colors.text }]} value={query} onChangeText={setQuery} placeholder={t('clients.search')} placeholderTextColor={colors.textTertiary} autoFocus />
          {query.length > 0 && <TouchableOpacity onPress={() => setQuery('')}><Text style={{ color: colors.textTertiary, fontSize: 16 }}>✕</Text></TouchableOpacity>}
        </View>
        {loading
          ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
          : <FlatList
              data={results}
              keyExtractor={c => c.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const sc = statusColors[item.status] ?? null
                return (
                  <TouchableOpacity style={styles.clientRow} onPress={() => { onSelect(item); onClose() }} activeOpacity={0.7}>
                    <View style={[styles.clientAvatar, { backgroundColor: sc?.bg ?? colors.primaryLight }]}>
                      <Text style={[styles.clientAvatarText, { color: sc?.text ?? colors.primary }]}>{initials(item.full_name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.clientRowName, { color: colors.text }]}>{item.full_name}</Text>
                      {item.email ? <Text style={[styles.clientRowEmail, { color: colors.textSecondary }]}>{item.email}</Text> : null}
                    </View>
                    <Text style={{ color: colors.textTertiary, fontSize: 20 }}>›</Text>
                  </TouchableOpacity>
                )
              }}
              ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 68 }} />}
              ListEmptyComponent={<Text style={[{ textAlign: 'center', fontSize: 14, fontFamily: fonts.body, paddingVertical: 40 }, { color: colors.textTertiary }]}>{t('clients.empty')}</Text>}
              contentContainerStyle={{ paddingBottom: 60 }}
            />
        }
      </View>
    </Modal>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function NewAppointmentScreen() {
  const { t, i18n } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { date: paramDate, time: paramTime, clientId: paramClientId, id: editId, returnTo } =
    useLocalSearchParams<{ date?: string; time?: string; clientId?: string; id?: string; returnTo?: string }>()
  const { width } = useWindowDimensions()
  const isWide = width >= 768
  const isEdit = !!editId

  // Naviguer ici depuis un autre onglet (ex. fiche contact → RDV) via un chemin absolu ne
  // laisse pas toujours un historique de retour exploitable — voir appointments/[id]/index.tsx
  // pour le même mécanisme.
  function goBack() {
    if (returnTo) router.replace(decodeURIComponent(returnTo) as any)
    else router.back()
  }
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const [loadingAppt, setLoadingAppt] = useState(isEdit)

  const defaultDate = paramDate ?? new Date().toISOString().split('T')[0]
  const defaultTime = paramTime ?? '09:00'

  const [title,         setTitle]         = useState('')
  const [apptType,      setApptType]      = useState<AppointmentType>('discovery_call')
  const [selectedClient,setSelectedClient]= useState<Client | null>(null)
  const [startDate,     setStartDate]     = useState(defaultDate)
  const [startTime,     setStartTime]     = useState(defaultTime)
  const [endDate,       setEndDate]       = useState(defaultDate)
  const [endTime,       setEndTime]       = useState(() => {
    const [h, m] = defaultTime.split(':').map(Number)
    return `${pad((h + 1) % 24)}:${pad(m)}`
  })
  const [location,      setLocation]      = useState('')
  const [meetingUrl,    setMeetingUrl]    = useState('')
  const [clientNotes,   setClientNotes]   = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  const [showClientPicker, setShowClientPicker] = useState(false)
  const [showStartCal,     setShowStartCal]     = useState(false)
  const [showStartTime,    setShowStartTime]     = useState(false)
  const [showEndCal,       setShowEndCal]        = useState(false)
  const [showEndTime,      setShowEndTime]       = useState(false)
  const [saving,           setSaving]            = useState(false)
  const [errorMsg,         setErrorMsg]          = useState<string | null>(null)

  useEffect(() => {
    if (!paramClientId || !session) return
    supabase.from('clients').select('id, full_name, first_name, email, status, pipeline_stage').eq('id', paramClientId).single()
      .then(({ data }) => {
        if (data) setSelectedClient(data as Client)
      })
  }, [paramClientId, session])

  useEffect(() => {
    if (!editId) return
    setLoadingAppt(true)
    fetchAppointmentById(editId).then(async appt => {
      if (!appt) { setLoadingAppt(false); return }
      setTitle(appt.title)
      setApptType(appt.appointment_type)
      const [sd, stRaw] = appt.start_at.split('T')
      const [ed, etRaw] = appt.end_at.split('T')
      setStartDate(sd); setStartTime(stRaw.slice(0, 5))
      setEndDate(ed); setEndTime(etRaw.slice(0, 5))
      setLocation(appt.location ?? '')
      setMeetingUrl(appt.meeting_url ?? '')
      if (appt.client_id) {
        const { data } = await supabase.from('clients').select('id, full_name, first_name, email, status, pipeline_stage').eq('id', appt.client_id).single()
        if (data) setSelectedClient(data as Client)
      }
      setLoadingAppt(false)
    }).catch(() => setLoadingAppt(false))
  }, [editId])

  function formatDate(dateStr: string) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  function handleStartDateConfirm(d: string) {
    setStartDate(d)
    if (d > endDate) setEndDate(d)
  }

  function handleSelectClient(client: Client) {
    setSelectedClient(client)
  }

  function handleStartTimeConfirm(time: string) {
    setStartTime(time)
    const { date: endD, time: endT } = addMinutesToTime(startDate, time, 60)
    setEndDate(endD)
    setEndTime(endT)
  }

  async function handleSave() {
    setErrorMsg(null)
    if (!title.trim() || !startDate || !startTime || !endDate || !endTime) {
      setErrorMsg(t('appointments.error_title_end_required'))
      return
    }
    const start_at = toISO(startDate, startTime)
    const end_at   = toISO(endDate, endTime)
    if (new Date(end_at) <= new Date(start_at)) {
      setErrorMsg(t('appointments.error_end_before_start'))
      return
    }
    if (!session) return
    setSaving(true)
    try {
      if (isEdit && editId) {
        await updateAppointment(editId, {
          title:            title.trim(),
          appointment_type: apptType,
          start_at,
          end_at,
          location:    location.trim() || undefined,
          meeting_url: meetingUrl.trim() || undefined,
        })
      } else {
        await createAppointment({
          title:            title.trim(),
          appointment_type: apptType,
          start_at,
          end_at,
          client_id:   selectedClient?.id,
          location:    location.trim() || undefined,
          meeting_url: meetingUrl.trim() || undefined,
          notes: (clientNotes.trim() || internalNotes.trim())
            ? { client_notes: clientNotes.trim() || undefined, internal_notes: internalNotes.trim() || undefined }
            : undefined,
        })
      }
      goBack()
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('common.error'))
      console.error('[newAppointment]', e)
    } finally {
      setSaving(false)
    }
  }

  const sc = selectedClient ? (statusColors[selectedClient.status] ?? null) : null

  const typeOptions: { value: AppointmentType; label: string }[] = [
    { value: 'discovery_call',       label: t('appointment_types.discovery_call') },
    { value: 'product_presentation', label: t('appointment_types.product_presentation') },
    { value: 'follow_up',            label: t('appointment_types.follow_up') },
    { value: 'closing_call',         label: t('appointment_types.closing_call') },
    { value: 'customer_support',     label: t('appointment_types.customer_support') },
    { value: 'team_training',        label: t('appointment_types.team_training') },
    { value: 'team_meeting',         label: t('appointment_types.team_meeting') },
    { value: 'webinar',              label: t('appointment_types.webinar') },
    { value: 'onboarding',           label: t('appointment_types.onboarding') },
    { value: 'business_review',      label: t('appointment_types.business_review') },
    { value: 'other',                label: t('appointment_types.other') },
  ]

  if (loadingAppt) {
    return (
      <>
        <Stack.Screen options={{
          title: t('appointments.edit_title'),
          headerBackTitle: '',
          headerLeft: () => (
            <TouchableOpacity onPress={goBack} style={styles.headerBackBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.headerBackText}>‹ {t('common.back')}</Text>
            </TouchableOpacity>
          ),
        }} />
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{
        title: isEdit ? t('appointments.edit_title') : t('appointments.new_title'),
        headerBackTitle: '',
        headerLeft: () => (
          <TouchableOpacity onPress={goBack} style={styles.headerBackBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.headerBackText}>‹ {t('common.back')}</Text>
          </TouchableOpacity>
        ),
      }} />
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, isWide && styles.contentWide]} keyboardShouldPersistTaps="handled">

        {/* ── Section 1 : Informations ─────────────────────────────── */}
        <SectionCard icon="📋" title={t('appointments.section_info')} colors={colors} styles={styles}>

          <Field label={t('appointments.field_title')}>
            <TextInput
              style={[styles.textField, { color: colors.text, borderColor: title.trim() ? colors.primary : colors.border }]}
              value={title}
              onChangeText={setTitle}
              placeholder={t('appointments.field_title')}
              placeholderTextColor={colors.textTertiary}
            />
          </Field>

          <Field label={t('appointments.type_label')}>
            <SelectPill options={typeOptions} value={apptType} onChange={setApptType} colors={colors} wrap={isWide} />
          </Field>

          <Field label={`${t('appointments.select_client')} (${t('common.optional')})`}>
            {selectedClient ? (
              <View style={styles.selectedCard}>
                <View style={[styles.avatar, { backgroundColor: sc?.bg ?? colors.primaryLight }]}>
                  <Text style={[styles.avatarText, { color: sc?.text ?? colors.primary }]}>{initials(selectedClient.full_name)}</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.selectedName, { color: colors.text }]}>{selectedClient.full_name}</Text>
                  {selectedClient.email ? <Text style={[styles.selectedEmail, { color: colors.textSecondary }]}>{selectedClient.email}</Text> : null}
                </View>
                {!isEdit && (
                  <TouchableOpacity onPress={() => setSelectedClient(null)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Text style={{ fontSize: 18, color: colors.textTertiary }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : isEdit ? null : (
              <TouchableOpacity style={[styles.pickerTrigger, { borderColor: colors.border }]} onPress={() => setShowClientPicker(true)} activeOpacity={0.7}>
                <Text style={{ fontSize: 15, fontFamily: fonts.body, color: colors.textTertiary }}>{t('clients.search')}</Text>
                <Text style={{ fontSize: 20, color: colors.textTertiary }}>›</Text>
              </TouchableOpacity>
            )}
          </Field>

          <Field label={t('appointments.field_start')}>
            <View style={styles.dateTimeRow}>
              <TouchableOpacity style={[styles.pickerTrigger, { flex: 1, borderColor: colors.border }]} onPress={() => setShowStartCal(true)} activeOpacity={0.7}>
                <Text style={{ fontSize: 14 }}>📅</Text>
                <Text style={[{ fontSize: 14, fontFamily: fonts.medium }, { color: colors.text }]}>{formatDate(startDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pickerTrigger, { borderColor: startTime ? colors.primary : colors.border }]} onPress={() => setShowStartTime(true)} activeOpacity={0.7}>
                <Text style={{ fontSize: 14 }}>🕐</Text>
                <Text style={[{ fontSize: 14, fontFamily: fonts.medium }, { color: colors.text }]}>{startTime}</Text>
              </TouchableOpacity>
            </View>
          </Field>

          <Field label={t('appointments.field_end')}>
            <View style={styles.dateTimeRow}>
              <TouchableOpacity style={[styles.pickerTrigger, { flex: 1, borderColor: colors.border }]} onPress={() => setShowEndCal(true)} activeOpacity={0.7}>
                <Text style={{ fontSize: 14 }}>📅</Text>
                <Text style={[{ fontSize: 14, fontFamily: fonts.medium }, { color: colors.text }]}>{formatDate(endDate)}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pickerTrigger, { borderColor: endTime ? colors.primary : colors.border }]} onPress={() => setShowEndTime(true)} activeOpacity={0.7}>
                <Text style={{ fontSize: 14 }}>🕐</Text>
                <Text style={[{ fontSize: 14, fontFamily: fonts.medium }, { color: colors.text }]}>{endTime}</Text>
              </TouchableOpacity>
            </View>
          </Field>

          <Field label={`${t('appointments.field_location')} (${t('common.optional')})`}>
            <TextInput style={[styles.textField, { color: colors.text, borderColor: colors.border }]} value={location} onChangeText={setLocation} placeholder="Paris, Zoom…" placeholderTextColor={colors.textTertiary} />
          </Field>

          <Field label={`${t('appointments.field_meeting_url')} (${t('common.optional')})`}>
            <TextInput style={[styles.textField, { color: colors.text, borderColor: colors.border }]} value={meetingUrl} onChangeText={setMeetingUrl} placeholder="https://zoom.us/…" placeholderTextColor={colors.textTertiary} keyboardType="url" autoCapitalize="none" />
          </Field>
        </SectionCard>

        {!isEdit && (
          /* ── Section 2 : Notes ────────────────────────────────────── */
          <SectionCard icon="📝" title={t('appointments.section_notes')} colors={colors} styles={styles}>
            <Field label={`${t('appointments.field_client_notes')} (${t('common.optional')})`}>
              <TextArea label="" value={clientNotes} onChangeText={setClientNotes} minHeight={72} />
            </Field>
            <Field label={`${t('appointments.field_internal_notes')} (${t('common.optional')})`}>
              <TextArea label="" value={internalNotes} onChangeText={setInternalNotes} minHeight={72} />
            </Field>
          </SectionCard>
        )}

        {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
        <Button label={t('common.save')} onPress={handleSave} loading={saving} />
        <View style={{ height: 40 }} />
      </ScrollView>

      <ClientPickerModal visible={showClientPicker} onClose={() => setShowClientPicker(false)} onSelect={handleSelectClient} userId={session?.user.id ?? ''} colors={colors} styles={styles} />
      <CalendarPickerModal visible={showStartCal} value={startDate} locale={locale} onClose={() => setShowStartCal(false)} onConfirm={handleStartDateConfirm} />
      <TimePickerModal visible={showStartTime} value={startTime} onClose={() => setShowStartTime(false)} onConfirm={handleStartTimeConfirm} />
      <CalendarPickerModal visible={showEndCal} value={endDate} locale={locale} onClose={() => setShowEndCal(false)} onConfirm={setEndDate} />
      <TimePickerModal visible={showEndTime} value={endTime} onClose={() => setShowEndTime(false)} onConfirm={setEndTime} />
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────
function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:   { flex: 1, backgroundColor: colors.bg },
  content:     { padding: 16, gap: 16, paddingBottom: 48 },
  contentWide: { maxWidth: 640, alignSelf: 'center', width: '100%', paddingHorizontal: 24 },

  headerBackBtn:  { paddingHorizontal: 12 },
  headerBackText: { fontSize: 14, fontFamily: fonts.medium, color: colors.primary },

  error: { color: colors.danger, fontSize: 14, textAlign: 'center', padding: 10, backgroundColor: colors.dangerLight, borderRadius: 8 },

  card:       { backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  cardTitle:  { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  cardBody:   { padding: 16, gap: 14 },

  textField: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: fonts.body, backgroundColor: colors.bg,
  },

  dateTimeRow:  { flexDirection: 'row', gap: 10 },
  pickerTrigger: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 12,
  },

  selectedCard:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.primaryLight, borderRadius: 10, padding: 12 },
  avatar:        { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText:    { fontSize: 14, fontFamily: fonts.bold },
  selectedName:  { fontSize: 15, fontFamily: fonts.semibold },
  selectedEmail: { fontSize: 12, fontFamily: fonts.body },

  clientModal:       { flex: 1 },
  clientModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  clientModalTitle:  { fontSize: 17, fontFamily: fonts.semibold, color: colors.text },
  searchBox:         { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginVertical: 12, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput:       { flex: 1, fontSize: 15, fontFamily: fonts.body, padding: 0 },
  clientRow:         { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
  clientAvatar:      { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  clientAvatarText:  { fontSize: 14, fontFamily: fonts.bold },
  clientRowName:     { fontSize: 15, fontFamily: fonts.semibold },
  clientRowEmail:    { fontSize: 13, fontFamily: fonts.body, marginTop: 1 },
  })
}
