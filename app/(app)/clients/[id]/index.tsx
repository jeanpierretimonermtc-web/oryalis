import { useState, useMemo, useEffect, useCallback } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Platform, useWindowDimensions, Modal, TextInput } from 'react-native'
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClient } from '@/features/clients/useClient'
import { updateClient } from '@/features/clients/clientService'
import { useClientAppointmentsWithContext } from '@/features/appointments/useAppointments'
import { useNotes } from '@/features/notes/useNotes'
import { createNote, deleteNote } from '@/features/notes/noteService'
import { useClientFollowups } from '@/features/followups/useFollowups'
import { useRecommendations } from '@/features/recommendations/useRecommendations'
import { useClientInteractions } from '@/features/interactions/useInteractions'
import { useClientOrders } from '@/features/orders/useOrders'
import { useDirectTeam } from '@/features/network/useNetwork'
import { useClientEvents } from '@/features/clients/useClientEvents'
import { callContact, completeNextAction, openWhatsApp, postponeNextAction } from '@/features/clients/nextActionService'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { supabase } from '@/shared/lib/supabase'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import { buildClientSummaryTemplate } from '@/features/messages/templates'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import {
  Calendar, FileText, Bell, Leaf, ShoppingCart, MessageCircle, Users, Globe, Map, Hourglass,
  Star, Lock, Phone, Mail, Cake, Briefcase, Baby, Link as LinkIcon, CalendarCheck, MapPin,
  Clock, Target, TriangleAlert, Trash2, Check, History, Camera, Image as ImageIcon,
} from 'lucide-react-native'
import type { ThemeColors } from '@/shared/theme/colors'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { gravatarUrl } from '@/shared/lib/gravatar'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import { computeRelationshipHealth } from '@/features/clients/relationshipHealth'

type Tab = 'synthese' | 'chrono' | 'suivi' | 'profil'

type TimelineKind = 'rdv' | 'note' | 'relance' | 'reco' | 'commande' | 'interaction' | 'changement'
type TimelineStatusFilter = 'all' | 'done' | 'pending' | 'cancelled'

// Libellé du filtre "type" — réutilise les clés déjà utilisées pour les onglets correspondants.
const TIMELINE_KIND_LABEL_KEY: Record<TimelineKind, string> = {
  rdv:         'clients.tab_rdv',
  note:        'clients.tab_notes',
  relance:     'clients.tab_followups',
  reco:        'clients.tab_reco',
  commande:    'clients.tab_orders',
  interaction: 'clients.tab_interactions',
  changement:  'clients.tab_changes',
}

interface TimelineEntry {
  id: string
  date: string
  title: string
  sub?: string
  done?: boolean
  kind: TimelineKind
  // Catégorie de statut exploitable par le filtre — absente pour les types sans notion
  // de "fait / en attente / annulé" (ex. notes, commandes).
  statusCategory?: 'done' | 'pending' | 'cancelled'
  // Types de contenu de débrief présents — uniquement pour les entrées 'rdv'.
  noteTags?: string[]
  onPress: () => void
}

// Icône linéaire par domaine — réutilisée par l'Activité, Synthèse et Suivi pour que
// le même type d'événement soit toujours identifiable par la même forme.
type IconComp = typeof Calendar
const KIND_ICON: Record<TimelineKind, IconComp> = {
  rdv: Calendar, note: FileText, relance: Bell, reco: Leaf, commande: ShoppingCart, interaction: MessageCircle,
  changement: History,
}

// Débrief RDV (appointment_notes) : quels champs sont remplis, avec quelle icône/libellé —
// réutilise exactement les libellés de la fiche RDV pour ne pas introduire un second vocabulaire.
const NOTE_TAG_META: Record<string, { icon: IconComp; labelKey: string }> = {
  client_notes:       { icon: FileText,     labelKey: 'appointments.field_client_notes' },
  products_discussed: { icon: ShoppingCart, labelKey: 'appointments.field_products' },
  needs_identified:   { icon: Target,       labelKey: 'appointments.field_needs' },
  objections:          { icon: TriangleAlert, labelKey: 'appointments.field_objections' },
  internal_notes:      { icon: Lock,          labelKey: 'appointments.field_internal_notes' },
}

function monthYearLabel(key: string, locale: string): string {
  const [y, m] = key.split('-').map(Number)
  const label = new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// Repère chronologique compact, dans la même notation "J+X"/"J-X" que le reste de l'app
// (relances, débrief RDV) — plus dense et déjà familier qu'une phrase du type "il y a 3 jours".
function relativeDayLabel(dateStr: string, t: (key: string) => string): string {
  const target = new Date(dateStr)
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86400000)
  if (diffDays === 0) return t('clients.timeline_today')
  return diffDays > 0 ? `${t('clients.timeline_day_plus')}${diffDays}` : `${t('clients.timeline_day_minus')}${Math.abs(diffDays)}`
}

// Écart en jours par rapport à aujourd'hui, en comparant des dates locales (pas des
// instants) — évite qu'une échéance du jour datée à minuit UTC ne paraisse "en retard".
function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86400000)
}

const NEXT_ACTION_ICON: Record<string, IconComp> = {
  call: Phone, whatsapp: MessageCircle, sms: Mail, email: Mail, rdv: Calendar,
}

const BASE_TABS: { key: Tab; labelKey: string }[] = [
  { key: 'synthese', labelKey: 'clients.tab_synthese' },
  { key: 'chrono',   labelKey: 'clients.tab_timeline' },
  { key: 'suivi',    labelKey: 'clients.tab_suivi' },
  { key: 'profil',   labelKey: 'clients.tab_profil' },
]

function nameInitials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function fmtShort(d: string | null | undefined, locale: string) {
  if (!d) return '—'
  return formatDate(d, locale, { day: '2-digit', month: 'short' })
}

function openAddressInMaps(address: string) {
  const query = encodeURIComponent(address)
  const url = Platform.select({
    ios:     `maps:0,0?q=${query}`,
    android: `geo:0,0?q=${query}`,
    default: `https://www.google.com/maps/search/?api=1&query=${query}`,
  })!
  Linking.openURL(url).catch(() => {
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${query}`).catch(console.error)
  })
}

export default function ClientDetailScreen() {
  const { t, i18n } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const APPT_STATUS_COLOR: Record<string, string> = {
    scheduled: colors.primary,
    completed: colors.success,
    cancelled: colors.danger,
    no_show: colors.warning,
    rescheduled: colors.textSecondary,
  }
  // Une couleur par type d'événement de l'onglet Activité — reprend les tokens du thème,
  // jamais de couleur en dur (cf. convention CLAUDE.md).
  const TIMELINE_KIND_COLOR: Record<TimelineKind, { bg: string; text: string }> = {
    rdv:         { bg: colors.primaryLight,   text: colors.primary },
    note:        { bg: colors.bgDim,          text: colors.textSecondary },
    relance:     { bg: colors.warningLight,   text: colors.warning },
    reco:        { bg: colors.successLight,   text: colors.success },
    commande:    { bg: colors.tertiaryLight,  text: colors.tertiary },
    interaction: { bg: colors.secondaryLight, text: colors.secondary },
    // Gris neutre — événement système automatique, pas un contenu créé par l'utilisateur.
    changement:  { bg: colors.bgDim,          text: colors.textTertiary },
  }
  // Statut générique -> couleur, cohérent avec APPT_STATUS_COLOR (pending≈scheduled).
  const TIMELINE_STATUS_COLOR: Record<'done' | 'pending' | 'cancelled', string> = {
    done: colors.success, pending: colors.primary, cancelled: colors.danger,
  }
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const { client, loading, refresh } = useClient(id)
  // Sans ça, revenir de "Modifier" (ou de toute autre page) affiche des données
  // périmées tant que l'utilisateur ne quitte pas et ne revient pas sur la fiche.
  useFocusEffect(useCallback(() => { refresh() }, [refresh]))
  const { appointments } = useClientAppointmentsWithContext(id)
  const { notes, refresh: refreshNotes } = useNotes(id)
  const { followups } = useClientFollowups(id)
  const { recommendations } = useRecommendations(id)
  const { interactions } = useClientInteractions(id)
  const { orders } = useClientOrders(id)
  const { team } = useDirectTeam(id)
  const { events: clientEvents } = useClientEvents(id)
  const [activeTab, setActiveTab]       = useState<Tab>('synthese')
  const [messageOpen, setMessageOpen]   = useState(false)
  const [actionBusy, setActionBusy]     = useState(false)
  const [actionError, setActionError]   = useState<string | null>(null)
  const [phoneCopied, setPhoneCopied]   = useState(false)
  const [timelineKindFilter,   setTimelineKindFilter]   = useState<'all' | TimelineKind>('all')
  const [timelineStatusFilter, setTimelineStatusFilter] = useState<TimelineStatusFilter>('all')
  const [timelinePeriodFilter, setTimelinePeriodFilter] = useState<string | null>(null) // 'YYYY-MM' ou null = toute période
  const [openTimelineFilter, setOpenTimelineFilter] = useState<'type' | 'status' | 'period' | null>(null)
  const [noteDraft, setNoteDraft]                 = useState('')
  const [noteSaving, setNoteSaving]                 = useState(false)
  const [noteDeleteConfirmId, setNoteDeleteConfirmId] = useState<string | null>(null)
  const [apptNoteTags, setApptNoteTags] = useState<Record<string, string[]>>({})
  // Décision #7 "Protéger les données sensibles" : masqué par défaut, jamais révélé
  // automatiquement — remis à zéro à chaque montage de l'écran (pas de persistance).
  const [sensitiveRevealed, setSensitiveRevealed] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [showShareProfile, setShowShareProfile] = useState(false)
  const [showPhotoSheet, setShowPhotoSheet] = useState(false)
  const [showPhotoUrl, setShowPhotoUrl]     = useState(false)
  const [photoUrlDraft, setPhotoUrlDraft]   = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [gravatarFailed, setGravatarFailed] = useState(false)
  const { isModuleActive, getRoleLabel, getLrpName } = useAppConfig()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { width: screenW } = useWindowDimensions()
  const isDesktopWeb = Platform.OS === 'web' && screenW >= 768

  const isNetworkRole = !!client?.contact_role.includes('distributor') || !!client?.contact_role.includes('leader')

  // Débrief RDV disponible pour les entrées 'rdv' de l'Activité — quels champs sont remplis.
  const apptIdsKey = appointments.map(a => a.id).sort().join(',')
  useEffect(() => {
    const apptIds = apptIdsKey ? apptIdsKey.split(',') : []
    if (apptIds.length === 0) { setApptNoteTags({}); return }
    let cancelled = false
    supabase
      .from('appointment_notes')
      .select('appointment_id, client_notes, internal_notes, objections, needs_identified, products_discussed')
      .in('appointment_id', apptIds)
      .then(({ data }) => {
        if (cancelled || !data) return
        const tags: Record<string, string[]> = {}
        for (const row of data) {
          const keys: string[] = []
          if (row.client_notes)       keys.push('client_notes')
          if (row.products_discussed) keys.push('products_discussed')
          if (row.needs_identified)   keys.push('needs_identified')
          if (row.objections)         keys.push('objections')
          if (row.internal_notes)     keys.push('internal_notes')
          if (keys.length > 0) tags[row.appointment_id] = keys
        }
        setApptNoteTags(tags)
      })
    return () => { cancelled = true }
  }, [apptIdsKey])

  if (loading || !client) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.center}><ActivityIndicator color={colors.primaryAction} /></View>
      </>
    )
  }

  // KPI calculations
  const now = new Date()
  const past   = appointments.filter(a => new Date(a.start_at) <= now)
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
  const future = appointments.filter(a => new Date(a.start_at) > now)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
  const lastDate = client.last_interaction_at

  // ── Activité relationnelle : fusion de tous les événements par date ─────────
  const timelineEntries: TimelineEntry[] = [
    ...appointments.map(appt => ({
      id: `rdv-${appt.id}`,
      date: appt.start_at,
      title: appt.title,
      sub: t(`appointment_statuses.${appt.status}` as any),
      kind: 'rdv' as const,
      statusCategory: (appt.status === 'completed' ? 'done' : appt.status === 'cancelled' || appt.status === 'no_show' ? 'cancelled' : 'pending') as 'done' | 'pending' | 'cancelled',
      noteTags: apptNoteTags[appt.id],
      onPress: () => router.push(`/(app)/appointments/${appt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any),
    })),
    ...notes.map(note => ({
      id: `note-${note.id}`,
      date: note.created_at,
      title: note.content,
      kind: 'note' as const,
      onPress: () => {},
    })),
    ...followups.map(f => ({
      id: `relance-${f.id}`,
      date: f.due_date,
      title: f.title ?? f.content ?? t('followups.title'),
      sub: f.done ? t('followups.done') : undefined,
      done: f.done,
      kind: 'relance' as const,
      statusCategory: (f.done ? 'done' : 'pending') as 'done' | 'pending',
      onPress: () => router.push(`/(app)/clients/${id}/followups`),
    })),
    ...recommendations.map(r => ({
      id: `reco-${r.id}`,
      date: r.recommendation_date ?? r.created_at,
      title: r.product_name,
      sub: r.reason ?? t(`recommendations.${r.status}`),
      kind: 'reco' as const,
      statusCategory: (r.status === 'advised' ? 'pending' : 'done') as 'done' | 'pending',
      onPress: () => router.push(`/(app)/clients/${id}/recommendations`),
    })),
    ...orders.map(o => ({
      id: `commande-${o.id}`,
      date: o.order_date,
      title: o.product_name,
      sub: o.amount != null ? `${o.amount.toFixed(0)}€` : undefined,
      kind: 'commande' as const,
      onPress: () => router.push(`/(app)/clients/${id}/orders`),
    })),
    ...interactions.map(item => ({
      id: `interaction-${item.id}`,
      date: item.scheduled_at ?? item.completed_at ?? item.created_at,
      title: item.subject ?? t(`interaction_types.${item.interaction_type}`),
      sub: t(`interaction_types.${item.interaction_type}`),
      done: !!item.completed_at,
      kind: 'interaction' as const,
      statusCategory: (item.completed_at ? 'done' : 'pending') as 'done' | 'pending',
      onPress: () => router.push(`/(app)/clients/${id}/interactions`),
    })),
    // Traçabilité (refonte) — automatique et non modifiable : jamais cliquable.
    ...clientEvents.map(ev => {
      let title = ''
      let sub: string | undefined
      if (ev.event_type === 'pipeline_change') {
        title = t('clients.event_pipeline_change', {
          old: ev.old_value ? t(`pipeline_stages.${ev.old_value}`) : '—',
          new: ev.new_value ? t(`pipeline_stages.${ev.new_value}`) : '—',
        })
      } else if (ev.event_type === 'role_change') {
        const label = (v: string | null) => v ? v.split(',').filter(Boolean).map(r => getRoleLabel(r as any)).join(', ') : '—'
        title = t('clients.event_role_change', { old: label(ev.old_value), new: label(ev.new_value) })
      } else if (ev.event_type === 'appointment_cancelled') {
        title = ev.appointment_title ?? t('clients.event_appointment_cancelled')
        sub = ev.reason ? `${t('clients.event_appointment_cancelled')} · ${ev.reason}` : t('clients.event_appointment_cancelled')
      } else {
        title = ev.appointment_title ?? t('clients.event_appointment_deleted')
        sub = t('clients.event_appointment_deleted')
      }
      return {
        id: `changement-${ev.id}`,
        date: ev.created_at,
        title,
        sub,
        kind: 'changement' as const,
        onPress: () => {},
      }
    }),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // ── Filtres de l'onglet Activité : type, statut, période (mois/année) ───────
  const timelineAvailableKinds = Array.from(new Set(timelineEntries.map(e => e.kind))) as TimelineKind[]
  const timelineAvailableMonths = Array.from(new Set(timelineEntries.map(e => e.date.slice(0, 7)))).sort((a, b) => b.localeCompare(a))

  const filteredTimelineEntries = timelineEntries.filter(e => {
    if (timelineKindFilter !== 'all' && e.kind !== timelineKindFilter) return false
    if (timelineStatusFilter !== 'all' && e.statusCategory !== timelineStatusFilter) return false
    if (timelinePeriodFilter && e.date.slice(0, 7) !== timelinePeriodFilter) return false
    return true
  })

  async function runNextAction<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (actionBusy) return undefined // garde anti-double-clic
    setActionBusy(true)
    setActionError(null)
    try {
      const result = await action()
      await refresh()
      return result
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour. Réessayez.')
      return undefined
    } finally {
      setActionBusy(false)
    }
  }

  async function handleAddNote() {
    if (!noteDraft.trim() || !session) return
    setNoteSaving(true)
    try {
      await createNote(session.user.id, id, noteDraft.trim())
      setNoteDraft('')
      await refreshNotes()
    } finally {
      setNoteSaving(false)
    }
  }

  async function handleDeleteNote(noteId: string) {
    await deleteNote(noteId)
    setNoteDeleteConfirmId(null)
    await refreshNotes()
  }

  async function copyPhone(phone: string) {
    await Clipboard.setStringAsync(phone)
    setPhoneCopied(true)
    setTimeout(() => setPhoneCopied(false), 2000)
  }

  function openMeet() {
    Linking.openURL('https://meet.google.com/new')
  }

  // Réutilise le bucket Storage "avatars" déjà en place pour les photos de profil
  // praticien (voir settings-identity.tsx), avec un préfixe distinct pour ne pas
  // entrer en collision avec "<user_id>.jpg".
  async function uploadAvatarImage(uri: string) {
    setUploadingAvatar(true)
    setActionError(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      let jwtRole = 'no-session'
      if (token) {
        try {
          jwtRole = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? 'unknown'
        } catch { jwtRole = 'decode-failed' }
      }
      // DIAGNOSTIC TEMPORAIRE — à retirer une fois le bug RLS storage identifié.
      console.error(`[uploadAvatarImage] session=${!!sessionData.session} role=${jwtRole}`)
      if (token) {
        try {
          const rawResp = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/avatars/debug-raw-test.txt`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
              'Content-Type': 'text/plain',
              'x-upsert': 'true',
            },
            body: 'debug',
          })
          const rawText = await rawResp.text()
          console.error(`[uploadAvatarImage] raw fetch status=${rawResp.status} body=${rawText}`)
        } catch (rawErr) {
          console.error('[uploadAvatarImage] raw fetch threw', rawErr instanceof Error ? rawErr.message : String(rawErr))
        }
      }
      const blob = await (await fetch(uri)).blob()
      const path = `client-${id}.jpg`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (uploadError) throw uploadError
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
      // Force le rechargement de l'image (même URL réutilisée à chaque changement de photo).
      await updateClient(id, { avatar_url: `${publicUrl}?t=${Date.now()}` })
      await refresh()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[uploadAvatarImage]', message)
      setActionError(`${t('clients.photo_upload_error')} (${message})`)
    } finally {
      setUploadingAvatar(false)
    }
  }

  async function pickCamera() {
    setShowPhotoSheet(false)
    if (Platform.OS !== 'web') { const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) return }
    const r = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 })
    if (!r.canceled && r.assets[0]) await uploadAvatarImage(r.assets[0].uri)
  }

  async function pickLibrary() {
    setShowPhotoSheet(false)
    if (Platform.OS !== 'web') { const p = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!p.granted) return }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 })
    if (!r.canceled && r.assets[0]) await uploadAvatarImage(r.assets[0].uri)
  }

  async function saveAvatarUrl() {
    if (!photoUrlDraft.trim()) return
    setActionError(null)
    try {
      await updateClient(id, { avatar_url: photoUrlDraft.trim() })
      await refresh()
      setShowPhotoUrl(false)
      setPhotoUrlDraft('')
    } catch (err) {
      console.error('[saveAvatarUrl]', err)
      setActionError(t('clients.photo_upload_error'))
    }
  }

  const health = computeRelationshipHealth({
    next_action_at: client.next_action_at,
    last_interaction_at: client.last_interaction_at,
    manually_inactive: client.manually_inactive,
    created_at: client.created_at,
  })
  const sc = statusColors[health.tier] ?? { bg: colors.surfaceContainerHigh, text: colors.textSecondary }
  // L'avatar est teinté par rôle (pas par santé relationnelle, déjà visible via la
  // pastille de statut à côté du nom) — même palette que les filtres de la liste et
  // les pastilles de rôle du hero (getRoleColors/getPrimaryRole).
  const roleColor = getRoleColors(getPrimaryRole(client.contact_role), colors)
  // Ordre de priorité de la photo : upload manuel → Gravatar (si un email existe) → initiales.
  const heroPhotoUrl = client.avatar_url ?? (client.email && !gravatarFailed ? gravatarUrl(client.email) : null)

  // Signal explicable (décision #6 de la refonte) : plus de score numérique brut —
  // seule la température la plus chaude relevée en relance est affichée, en clair.
  const bestFollowup = followups.reduce<typeof followups[0] | null>((best, f) => {
    if (!f.prospect_temperature) return best
    const order = { very_hot: 4, hot: 3, warm: 2, cold: 1 }
    if (!best?.prospect_temperature) return f
    return (order[f.prospect_temperature] ?? 0) > (order[best.prospect_temperature!] ?? 0) ? f : best
  }, null)
  const hotTemperature = bestFollowup?.prospect_temperature === 'hot' || bestFollowup?.prospect_temperature === 'very_hot'
    ? bestFollowup.prospect_temperature
    : null
  const hotTemperatureColor = hotTemperature === 'very_hot'
    ? { bg: colors.dangerLight, text: colors.danger }
    : { bg: colors.warningLight, text: colors.warning }

  const particularityItems = client.particularities
    ? client.particularities.split('\n').map(s => s.trim()).filter(Boolean)
    : []

  // ── Bloc "Prochaine action" du hero — priorité visuelle maximale (décision refonte
  // Écran 3 : "Action primaire... bouton le plus visible") ────────────────────────
  const nextActionDays = client.next_action_at ? daysUntil(client.next_action_at) : null
  const nextActionUrgency: 'overdue' | 'today' | 'upcoming' =
    nextActionDays === null ? 'upcoming' : nextActionDays < 0 ? 'overdue' : nextActionDays === 0 ? 'today' : 'upcoming'
  const NEXT_ACTION_COLOR = {
    overdue:  { fg: colors.danger,  bg: colors.dangerLight },
    today:    { fg: colors.warning, bg: colors.warningLight },
    upcoming: { fg: colors.primary, bg: colors.primaryLight },
  }
  const nextActionColor = NEXT_ACTION_COLOR[nextActionUrgency]

  // ── Synthèse : jusqu'à 3 échéances les plus proches, tous domaines confondus ──
  const upcomingItems: { key: string; kind: TimelineKind; categoryLabel: string; title: string; date: string; onPress: () => void }[] = []
  if (future[0]) {
    upcomingItems.push({
      key: 'rdv', kind: 'rdv', categoryLabel: t('clients.next_rdv'),
      title: future[0].title, date: future[0].start_at,
      onPress: () => router.push(`/(app)/appointments/${future[0].id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any),
    })
  }
  const nextFollowup = followups
    .filter(f => !f.done)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0]
  if (nextFollowup) {
    upcomingItems.push({
      key: 'relance', kind: 'relance', categoryLabel: t('clients.tab_followups'),
      title: nextFollowup.title ?? nextFollowup.content ?? t('followups.title'), date: nextFollowup.due_date,
      onPress: () => router.push(`/(app)/clients/${id}/followups`),
    })
  }
  const openReco = recommendations
    .filter(r => r.status === 'advised')
    .sort((a, b) => new Date(b.recommendation_date ?? b.created_at).getTime() - new Date(a.recommendation_date ?? a.created_at).getTime())[0]
  if (openReco) {
    upcomingItems.push({
      key: 'reco', kind: 'reco', categoryLabel: t('clients.tab_reco'),
      title: openReco.product_name, date: openReco.recommendation_date ?? openReco.created_at,
      onPress: () => router.push(`/(app)/clients/${id}/recommendations`),
    })
  }

  // Résumé "copie de mes données" (RGPD) — uniquement des informations client-facing par
  // nature, jamais les notes internes/objections/santé (Décision #7).
  const shareProfileTemplate = buildClientSummaryTemplate({
    interests: client.interests ?? [],
    appointments: appointments
      .filter(a => a.status === 'completed')
      .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
      .map(a => ({ dateLabel: formatDate(a.start_at, locale), typeLabel: t(`appointment_types.${a.appointment_type}` as any) })),
    recommendations: recommendations.map(r => ({ productName: r.product_name })),
  })

  // Identité, prochaine action, KPI, actions rapides — regroupés une seule fois ici pour
  // pouvoir être rendus soit dans la colonne latérale persistante (desktop), soit en tête
  // du fil unique (mobile), sans dupliquer le JSX.
  const heroSection = (
    <>
          {/* ── Hero (compact) ───────────────────────────────────── */}
          <View style={styles.hero}>
            <View style={styles.heroTopRow}>
              <TouchableOpacity onPress={() => setShowPhotoSheet(true)} activeOpacity={0.85} style={styles.avatarWrap}>
                {uploadingAvatar ? (
                  <View style={[styles.bigAvatar, { backgroundColor: roleColor.bg }]}>
                    <ActivityIndicator size="small" color={roleColor.text} />
                  </View>
                ) : heroPhotoUrl ? (
                  <View style={[styles.avatarRing, { borderColor: roleColor.text }]}>
                    <Image
                      source={{ uri: heroPhotoUrl }}
                      style={styles.avatarRingImg}
                      onError={() => { if (!client.avatar_url) setGravatarFailed(true) }}
                    />
                  </View>
                ) : (
                  <View style={[styles.bigAvatar, { backgroundColor: roleColor.bg }]}>
                    <Text style={[styles.bigAvatarText, { color: roleColor.text }]}>{nameInitials(client.full_name)}</Text>
                  </View>
                )}
                <View style={styles.avatarEditBadge}>
                  <Camera size={12} color={colors.textSecondary} strokeWidth={2.2} />
                </View>
              </TouchableOpacity>
              <View style={styles.heroIdentity}>
                <Text style={styles.heroName} numberOfLines={1}>{client.full_name}</Text>
                <View style={styles.heroBadges}>
                  <View style={[styles.heroPill, { backgroundColor: sc.bg }]}>
                    <Text style={[styles.heroPillText, { color: sc.text }]}>
                      {t(`relationship_health.${health.tier}`).toUpperCase()}
                    </Text>
                  </View>
                  {client.is_vip ? (
                    <View style={[styles.heroPill, { backgroundColor: statusColors.vip.bg }]}>
                      <Text style={[styles.heroPillText, { color: statusColors.vip.text }]}>
                        {t('clients.vip_badge').toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                  {client.contact_role.filter(r => r !== 'customer').map(role => {
                    const rc = getRoleColors(role, colors)
                    return (
                      <View key={role} style={[styles.heroPill, { backgroundColor: rc.bg }]}>
                        <Text style={[styles.heroPillText, { color: rc.text }]}>
                          {getRoleLabel(role).toUpperCase()}
                        </Text>
                      </View>
                    )
                  })}
                  {client.client_type ? (
                    <View style={[styles.heroPill, { backgroundColor: colors.surfaceContainerHighest, maxWidth: 160 }]}>
                      <Text style={[styles.heroPillText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {client.client_type.toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                  {hotTemperature ? (
                    <View style={[styles.heroPill, { backgroundColor: hotTemperatureColor.bg }]}>
                      <Text style={[styles.heroPillText, { color: hotTemperatureColor.text }]}>
                        {t(`prospect_temperatures.${hotTemperature}`).toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity
                style={styles.heroMoreBtn}
                onPress={() => setMoreMenuOpen(true)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.heroMoreIcon}>⋮</Text>
              </TouchableOpacity>
            </View>

            {/* ── Prochaine action — priorité visuelle maximale ────── */}
            {client.next_action_source ? (
              <View style={[styles.nextActionBlock, { backgroundColor: nextActionColor.bg, borderColor: nextActionColor.fg }]}>
                <View style={styles.nextActionTopRow}>
                  <View style={[styles.nextActionIconBox, { backgroundColor: colors.card }]}>
                    {(() => {
                      const NextIcon = client.next_action_type ? NEXT_ACTION_ICON[client.next_action_type] : Clock
                      return <NextIcon size={19} color={nextActionColor.fg} strokeWidth={2} />
                    })()}
                  </View>
                  <View style={styles.nextActionTextBlock}>
                    <Text style={[styles.nextActionLabel, { color: nextActionColor.fg }]}>
                      {nextActionUrgency === 'overdue' ? t('clients.next_action_overdue') : t('clients.next_action_title')}
                    </Text>
                    <Text style={styles.nextActionMainText}>
                      {client.next_action_type ? t(`next_action_types.${client.next_action_type}`) : t(`clients.next_action_source_${client.next_action_source}`)}
                    </Text>
                    {client.next_action_at ? (
                      <Text style={styles.nextActionMeta}>
                        {formatDate(client.next_action_at, locale)} · {relativeDayLabel(client.next_action_at, t)}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.nextActionBtnRow}>
                  <TouchableOpacity
                    disabled={actionBusy}
                    style={[styles.nextActionBtnPrimary, { backgroundColor: nextActionColor.fg }, actionBusy && { opacity: 0.6 }]}
                    onPress={() => {
                      // Pour un rendez-vous : jamais de complétion directe depuis la fiche
                      // Contact — navigation vers la fiche RDV, où le débrief est confirmé
                      // PUIS le RDV complété (RDV déjà completed : débrief affiché en lecture,
                      // aucune nouvelle complétion tentée).
                      runNextAction(() => completeNextAction(client)).then(result => {
                        if (result?.appointmentId) {
                          router.push(`/(app)/appointments/${result.appointmentId}?debrief=1&returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)
                        }
                      })
                    }}
                    activeOpacity={0.85}
                  >
                    {actionBusy
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.nextActionBtnPrimaryText}>
                          {client.next_action_source === 'appointment' ? t('clients.finish_action_debrief') : t('clients.finish_action')}
                        </Text>}
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={actionBusy}
                    style={[styles.nextActionBtnSecondary, { borderColor: nextActionColor.fg }]}
                    onPress={() => runNextAction(() => postponeNextAction(client))}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.nextActionBtnSecondaryText, { color: nextActionColor.fg }]}>{t('clients.postpone_action')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.nextActionEmpty} onPress={() => router.push(`/(app)/clients/${id}/followups`)} activeOpacity={0.75}>
                <Text style={styles.nextActionEmptyText}>{t('clients.next_action_empty')}</Text>
                <View style={styles.nextActionEmptyBtn}>
                  <Text style={styles.nextActionEmptyBtnText}>{t('clients.plan_followup')}</Text>
                </View>
              </TouchableOpacity>
            )}
            {actionError && (
              <Text style={{ color: colors.danger, fontSize: 12, fontFamily: fonts.medium, marginTop: 4 }}>
                {actionError}
              </Text>
            )}

            {/* KPI strip — le "prochain" a désormais sa propre zone ci-dessus */}
            <View style={styles.kpiStrip}>
              <View style={styles.kpiCol}>
                <Text style={styles.kpiLabel}>{t('clients.kpi_rdv')}</Text>
                <Text style={styles.kpiValue}>{appointments.length}</Text>
              </View>
              <View style={styles.kpiDivider} />
              <View style={styles.kpiCol}>
                <Text style={styles.kpiLabel}>{t('clients.kpi_last')}</Text>
                <Text style={styles.kpiValue}>{fmtShort(lastDate, locale)}</Text>
              </View>
            </View>
          </View>

          {/* ── Actions secondaires ──────────────────────────────── */}
          <View style={styles.secondaryActions}>
            {client.phone ? (
              <>
                {isDesktopWeb ? (
                  <TouchableOpacity style={styles.saBtn} onPress={() => copyPhone(client.phone!)} activeOpacity={0.8}>
                    <LineIcon name="copy" size={16} color={colors.text} strokeWidth={2} />
                    <Text style={styles.saLabel}>{phoneCopied ? t('clients.phone_copied') : t('clients.copy_phone')}</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.saBtn} onPress={() => callContact(client.phone!)} activeOpacity={0.8}>
                    <LineIcon name="phone" size={16} color={colors.text} strokeWidth={2} />
                    <Text style={styles.saLabel}>{t('clients.call_action')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.saBtn} onPress={() => openWhatsApp(client.phone!)} activeOpacity={0.8}>
                  <LineIcon name="whatsapp" size={16} color={colors.text} strokeWidth={2} />
                  <Text style={styles.saLabel}>WhatsApp</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity style={styles.saBtn} onPress={() => setMessageOpen(true)} activeOpacity={0.8}>
              <LineIcon name="message" size={16} color={colors.text} strokeWidth={2} />
              <Text style={styles.saLabel}>{t('clients.message_action')}</Text>
            </TouchableOpacity>
          </View>

          {/* ── Menu "Plus" (feuille inférieure) ─────────────────── */}
          <Modal visible={moreMenuOpen} transparent animationType="fade" onRequestClose={() => setMoreMenuOpen(false)}>
            <TouchableOpacity style={styles.moreMenuOverlay} activeOpacity={1} onPress={(e) => { if (e.target === e.currentTarget) setMoreMenuOpen(false) }}>
              <View style={styles.moreMenuSheet} onStartShouldSetResponder={() => true}>
                <View style={styles.moreMenuHandle} />
                <TouchableOpacity
                  style={styles.moreMenuOption}
                  onPress={() => { setMoreMenuOpen(false); router.push(`/(app)/clients/${id}/edit` as any) }}
                  activeOpacity={0.7}
                >
                  <LineIcon name="edit" size={18} color={colors.text} strokeWidth={2} />
                  <Text style={styles.moreMenuOptionText}>{t('clients.edit_action')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.moreMenuOption}
                  onPress={() => { setMoreMenuOpen(false); setShowShareProfile(true) }}
                  activeOpacity={0.7}
                >
                  <LineIcon name="shield" size={18} color={colors.text} strokeWidth={2} />
                  <Text style={styles.moreMenuOptionText}>{t('clients.share_profile_action')}</Text>
                </TouchableOpacity>
                {isDesktopWeb && client.phone ? (
                  <TouchableOpacity
                    style={styles.moreMenuOption}
                    onPress={() => { setMoreMenuOpen(false); openMeet() }}
                    activeOpacity={0.7}
                  >
                    <LineIcon name="video" size={18} color={colors.text} strokeWidth={2} />
                    <Text style={styles.moreMenuOptionText}>Meet</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </TouchableOpacity>
          </Modal>

          {/* ── Photo de contact (feuille inférieure) ────────────── */}
          <Modal visible={showPhotoSheet} transparent animationType="fade" onRequestClose={() => setShowPhotoSheet(false)}>
            <TouchableOpacity style={styles.moreMenuOverlay} activeOpacity={1} onPress={(e) => { if (e.target === e.currentTarget) setShowPhotoSheet(false) }}>
              <View style={styles.moreMenuSheet} onStartShouldSetResponder={() => true}>
                <View style={styles.moreMenuHandle} />
                <Text style={styles.photoSheetTitle}>{t('clients.change_photo')}</Text>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity style={styles.moreMenuOption} onPress={pickCamera} activeOpacity={0.7}>
                    <Camera size={18} color={colors.text} strokeWidth={2} />
                    <Text style={styles.moreMenuOptionText}>{t('clients.photo_camera')}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.moreMenuOption} onPress={pickLibrary} activeOpacity={0.7}>
                  <ImageIcon size={18} color={colors.text} strokeWidth={2} />
                  <Text style={styles.moreMenuOptionText}>{t('clients.photo_library')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.moreMenuOption} onPress={() => { setShowPhotoSheet(false); setActionError(null); setShowPhotoUrl(true) }} activeOpacity={0.7}>
                  <LinkIcon size={18} color={colors.text} strokeWidth={2} />
                  <Text style={styles.moreMenuOptionText}>{t('clients.photo_url')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>

          {/* ── Photo par URL ─────────────────────────────────────── */}
          <Modal visible={showPhotoUrl} transparent animationType="fade" onRequestClose={() => setShowPhotoUrl(false)}>
            <TouchableOpacity style={styles.moreMenuOverlay} activeOpacity={1} onPress={(e) => { if (e.target === e.currentTarget) setShowPhotoUrl(false) }}>
              <View style={styles.moreMenuSheet} onStartShouldSetResponder={() => true}>
                <View style={styles.moreMenuHandle} />
                <Text style={styles.photoSheetTitle}>{t('clients.photo_url')}</Text>
                <TextInput
                  style={styles.photoUrlInput}
                  value={photoUrlDraft}
                  onChangeText={setPhotoUrlDraft}
                  placeholder={t('clients.photo_url_placeholder')}
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  keyboardType="url"
                  autoFocus
                />
                {actionError && (
                  <Text style={styles.photoUrlError}>{actionError}</Text>
                )}
                <TouchableOpacity style={styles.photoUrlSaveBtn} onPress={saveAvatarUrl} activeOpacity={0.85}>
                  <Text style={styles.photoUrlSaveBtnText}>{t('common.save')}</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </Modal>
    </>
  )

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.root}>

        {/* ── Navigation bar ──────────────────────────────────────── */}
        <View style={styles.navBar}>
          <TouchableOpacity style={styles.backRow} onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={styles.backArrow}>←</Text>
            <Text style={styles.navTitle}>{t('clients.profile_title')}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.bodyRow, isDesktopWeb && styles.bodyRowDesktop]}>

          {/* ── Colonne latérale persistante (desktop uniquement) ─── */}
          {isDesktopWeb && (
            <View style={styles.desktopSidebar}>
              {heroSection}
            </View>
          )}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, isDesktopWeb && styles.scrollContentDesktop]}
            showsVerticalScrollIndicator={false}
          >

          {!isDesktopWeb && heroSection}
          {/* ── Tab bar ──────────────────────────────────────────── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
            {BASE_TABS.map(tab => (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
                  {t(tab.labelKey)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Tab content ──────────────────────────────────────── */}
          <View style={styles.tabContent}>

            {/* ─ Synthèse ─ */}
            {activeTab === 'synthese' && (
              <View style={[styles.tabColumns, isDesktopWeb && styles.tabColumnsDesktop]}>
                {!(client.pipeline_stage || client.next_action_type || client.next_action_date) && upcomingItems.length === 0 ? (
                  <Text style={styles.emptyText}>{t('clients.synthese_empty')}</Text>
                ) : null}

                {/* Parcours */}
                {(client.pipeline_stage || client.next_action_type || client.next_action_date) ? (
                  <View style={[styles.card, isDesktopWeb && styles.tabColumnItem]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
                        <Map size={14} color={colors.primary} strokeWidth={2} />
                      </View>
                      <Text style={styles.cardTitle}>{t('clients.sections.journey')}</Text>
                    </View>
                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>{t('clients.fields.pipeline_stage').toUpperCase()}</Text>
                      <Text style={styles.fieldValue}>{t(`pipeline_stages.${client.pipeline_stage}`)}</Text>
                    </View>
                    {client.next_action_type ? (
                      <View style={styles.fieldBlock}>
                        <Text style={styles.fieldLabel}>{t('clients.fields.next_action_type').toUpperCase()}</Text>
                        <Text style={styles.fieldValue}>{t(`next_action_types.${client.next_action_type}`)}</Text>
                      </View>
                    ) : null}
                    {client.next_action_at ? (
                      <View style={styles.fieldBlock}>
                        <Text style={styles.fieldLabel}>{t('clients.fields.next_action_date').toUpperCase()}</Text>
                        <Text style={styles.fieldValue}>
                          {formatDate(client.next_action_at, locale)} · {client.next_action_source}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* Prochaines échéances */}
                {upcomingItems.length > 0 ? (
                  <View style={[styles.card, isDesktopWeb && styles.tabColumnItem]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.secondaryLight }]}>
                        <Hourglass size={14} color={colors.secondary} strokeWidth={2} />
                      </View>
                      <Text style={styles.cardTitle}>{t('clients.upcoming_title')}</Text>
                    </View>
                    {upcomingItems.map(item => {
                      const ItemIcon = KIND_ICON[item.kind]
                      const itemColor = TIMELINE_KIND_COLOR[item.kind]
                      return (
                      <TouchableOpacity key={item.key} style={styles.addressRow} onPress={item.onPress} activeOpacity={0.75}>
                        <View style={[styles.fieldIconBox, { backgroundColor: itemColor.bg }]}><ItemIcon size={15} color={itemColor.text} strokeWidth={2} /></View>
                        <View style={styles.addressTextBlock}>
                          <Text style={styles.fieldLabel}>{item.categoryLabel.toUpperCase()}</Text>
                          <Text style={styles.fieldValue} numberOfLines={1}>{item.title} · {fmtShort(item.date, locale)}</Text>
                        </View>
                        <Text style={styles.addressChevron}>›</Text>
                      </TouchableOpacity>
                      )
                    })}
                  </View>
                ) : null}
              </View>
            )}

            {/* ─ Activité ─ */}
            {activeTab === 'chrono' && (
              <View style={styles.listTab}>
                {/* ── Composeur de note libre ────────────────────────────── */}
                <View style={styles.noteComposer}>
                  <TextInput
                    style={styles.noteComposerInput}
                    placeholder={t('notes.add')}
                    value={noteDraft}
                    onChangeText={setNoteDraft}
                    multiline
                    placeholderTextColor={colors.textTertiary}
                  />
                  <TouchableOpacity
                    style={[styles.noteComposerBtn, (!noteDraft.trim() || noteSaving) && styles.noteComposerBtnDisabled]}
                    onPress={handleAddNote}
                    disabled={noteSaving || !noteDraft.trim()}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.noteComposerBtnText}>↑</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.noteComposerHint}>{t('notes.timeline_note_hint')}</Text>

                {/* ── Barre de filtres compacte ─────────────────────────── */}
                <View style={styles.timelineFilterBar}>
                  <TouchableOpacity style={styles.timelineFilterBtn} onPress={() => setOpenTimelineFilter('type')} activeOpacity={0.75}>
                    <Text style={styles.timelineFilterBtnLabel}>{t('clients.timeline_filter_type')}</Text>
                    <Text style={styles.timelineFilterBtnValue} numberOfLines={1}>
                      {timelineKindFilter === 'all' ? t('clients.filter_all') : t(TIMELINE_KIND_LABEL_KEY[timelineKindFilter])}
                    </Text>
                    <Text style={styles.timelineFilterChevron}>▾</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.timelineFilterBtn} onPress={() => setOpenTimelineFilter('status')} activeOpacity={0.75}>
                    <Text style={styles.timelineFilterBtnLabel}>{t('clients.timeline_filter_status')}</Text>
                    <Text style={styles.timelineFilterBtnValue} numberOfLines={1}>{t(`clients.timeline_filter_status_${timelineStatusFilter}`)}</Text>
                    <Text style={styles.timelineFilterChevron}>▾</Text>
                  </TouchableOpacity>
                  {timelineAvailableMonths.length > 0 && (
                    <TouchableOpacity style={styles.timelineFilterBtn} onPress={() => setOpenTimelineFilter('period')} activeOpacity={0.75}>
                      <Text style={styles.timelineFilterBtnLabel}>{t('clients.timeline_filter_period')}</Text>
                      <Text style={styles.timelineFilterBtnValue} numberOfLines={1}>
                        {timelinePeriodFilter ? monthYearLabel(timelinePeriodFilter, locale) : t('clients.timeline_filter_period_all')}
                      </Text>
                      <Text style={styles.timelineFilterChevron}>▾</Text>
                    </TouchableOpacity>
                  )}
                  {(timelineKindFilter !== 'all' || timelineStatusFilter !== 'all' || timelinePeriodFilter !== null) && (
                    <TouchableOpacity
                      style={styles.timelineFilterResetBtn}
                      onPress={() => { setTimelineKindFilter('all'); setTimelineStatusFilter('all'); setTimelinePeriodFilter(null) }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.timelineFilterResetText}>{t('clients.timeline_filter_reset')}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* ── Fil chronologique ──────────────────────────────────── */}
                {filteredTimelineEntries.length === 0
                  ? <Text style={styles.emptyText}>{t(timelineEntries.length === 0 ? 'clients.timeline_empty' : 'clients.timeline_filtered_empty')}</Text>
                  : (() => {
                      let lastMonth = ''
                      return filteredTimelineEntries.map((entry, idx) => {
                        const monthKey = entry.date.slice(0, 7)
                        const showHeader = monthKey !== lastMonth
                        lastMonth = monthKey
                        const kindColor = TIMELINE_KIND_COLOR[entry.kind]
                        const KindIcon = KIND_ICON[entry.kind]
                        const statusColor = entry.statusCategory ? TIMELINE_STATUS_COLOR[entry.statusCategory] : null
                        const isLast = idx === filteredTimelineEntries.length - 1
                        const isNote = entry.kind === 'note'
                        const isConfirmingNoteDelete = isNote && noteDeleteConfirmId === entry.id
                        const content = (
                          <View style={styles.timelineContent}>
                            <View style={styles.timelineContentTop}>
                              <Text style={[styles.timelineTitle, entry.done && styles.timelineTitleDone]} numberOfLines={isNote ? undefined : 2}>
                                {entry.title}
                              </Text>
                              <Text style={styles.timelineRelative}>{relativeDayLabel(entry.date, t)}</Text>
                            </View>
                            <View style={styles.timelineMetaRow}>
                              <Text style={styles.timelineDate}>{formatDate(entry.date, locale)}</Text>
                              {entry.sub ? (
                                statusColor ? (
                                  <View style={[styles.timelineStatusPill, { backgroundColor: statusColor + '1A' }]}>
                                    <Text style={[styles.timelineStatusPillText, { color: statusColor }]} numberOfLines={1}>{entry.sub}</Text>
                                  </View>
                                ) : (
                                  <Text style={styles.timelineSubText} numberOfLines={1}>{entry.sub}</Text>
                                )
                              ) : null}
                            </View>
                            {entry.noteTags && entry.noteTags.length > 0 && (
                              <View style={styles.timelineNoteTagsRow}>
                                {entry.noteTags.map(tag => {
                                  const TagIcon = NOTE_TAG_META[tag].icon
                                  return (
                                    <View key={tag} style={styles.timelineNoteTag}>
                                      <TagIcon size={11} color={colors.textSecondary} strokeWidth={2} />
                                      <Text style={styles.timelineNoteTagText}>{t(NOTE_TAG_META[tag].labelKey as any)}</Text>
                                    </View>
                                  )
                                })}
                              </View>
                            )}
                          </View>
                        )
                        return (
                          <View key={entry.id}>
                            {showHeader && (
                              <Text style={styles.timelineMonthHeader}>{monthYearLabel(monthKey, locale)}</Text>
                            )}
                            <View style={styles.timelineRow}>
                              <View style={styles.timelineRail}>
                                <View style={[styles.timelineDot, { backgroundColor: kindColor.bg }]}>
                                  <KindIcon size={15} color={kindColor.text} strokeWidth={2} />
                                </View>
                                {!isLast && <View style={styles.timelineLine} />}
                              </View>
                              {isNote ? content : (
                                <TouchableOpacity style={styles.timelineContentTouchable} onPress={entry.onPress} activeOpacity={0.8}>
                                  {content}
                                </TouchableOpacity>
                              )}
                              {isNote && (
                                isConfirmingNoteDelete ? (
                                  <View style={styles.timelineNoteConfirm}>
                                    <TouchableOpacity style={styles.timelineConfirmCancelBtn} onPress={() => setNoteDeleteConfirmId(null)}>
                                      <Text style={styles.timelineConfirmCancelText}>{t('common.cancel')}</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={styles.timelineConfirmDeleteBtn} onPress={() => handleDeleteNote(entry.id.slice(5))}>
                                      <Text style={styles.timelineConfirmDeleteText}>{t('common.delete')}</Text>
                                    </TouchableOpacity>
                                  </View>
                                ) : (
                                  <TouchableOpacity
                                    style={styles.timelineNoteDeleteBtn}
                                    onPress={() => setNoteDeleteConfirmId(entry.id)}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <Trash2 size={15} color={colors.textTertiary} strokeWidth={2} />
                                  </TouchableOpacity>
                                )
                              )}
                            </View>
                          </View>
                        )
                      })
                    })()
                }

                {/* ── Sélecteur de filtre (feuille inférieure) ──────────── */}
                <Modal visible={openTimelineFilter !== null} transparent animationType="fade" onRequestClose={() => setOpenTimelineFilter(null)}>
                  <TouchableOpacity style={styles.timelineFilterOverlay} activeOpacity={1} onPress={(e) => { if (e.target === e.currentTarget) setOpenTimelineFilter(null) }}>
                    <View style={styles.timelineFilterSheet} onStartShouldSetResponder={() => true}>
                      <View style={styles.timelineFilterSheetHandle} />
                      {openTimelineFilter === 'type' && (
                        <>
                          <Text style={styles.timelineFilterSheetTitle}>{t('clients.timeline_filter_type')}</Text>
                          <TouchableOpacity style={styles.timelineFilterOption} onPress={() => { setTimelineKindFilter('all'); setOpenTimelineFilter(null) }} activeOpacity={0.7}>
                            <Text style={[styles.timelineFilterOptionText, timelineKindFilter === 'all' && styles.timelineFilterOptionTextActive]}>{t('clients.filter_all')}</Text>
                            {timelineKindFilter === 'all' && <Check size={16} color={colors.primaryAction} strokeWidth={2.5} />}
                          </TouchableOpacity>
                          {timelineAvailableKinds.map(kind => (
                            <TouchableOpacity key={kind} style={styles.timelineFilterOption} onPress={() => { setTimelineKindFilter(kind); setOpenTimelineFilter(null) }} activeOpacity={0.7}>
                              <Text style={[styles.timelineFilterOptionText, timelineKindFilter === kind && styles.timelineFilterOptionTextActive]}>{t(TIMELINE_KIND_LABEL_KEY[kind])}</Text>
                              {timelineKindFilter === kind && <Check size={16} color={colors.primaryAction} strokeWidth={2.5} />}
                            </TouchableOpacity>
                          ))}
                        </>
                      )}
                      {openTimelineFilter === 'status' && (
                        <>
                          <Text style={styles.timelineFilterSheetTitle}>{t('clients.timeline_filter_status')}</Text>
                          {(['all', 'pending', 'done', 'cancelled'] as TimelineStatusFilter[]).map(status => (
                            <TouchableOpacity key={status} style={styles.timelineFilterOption} onPress={() => { setTimelineStatusFilter(status); setOpenTimelineFilter(null) }} activeOpacity={0.7}>
                              <Text style={[styles.timelineFilterOptionText, timelineStatusFilter === status && styles.timelineFilterOptionTextActive]}>
                                {t(`clients.timeline_filter_status_${status}`)}
                              </Text>
                              {timelineStatusFilter === status && <Check size={16} color={colors.primaryAction} strokeWidth={2.5} />}
                            </TouchableOpacity>
                          ))}
                        </>
                      )}
                      {openTimelineFilter === 'period' && (
                        <>
                          <Text style={styles.timelineFilterSheetTitle}>{t('clients.timeline_filter_period')}</Text>
                          <TouchableOpacity style={styles.timelineFilterOption} onPress={() => { setTimelinePeriodFilter(null); setOpenTimelineFilter(null) }} activeOpacity={0.7}>
                            <Text style={[styles.timelineFilterOptionText, timelinePeriodFilter === null && styles.timelineFilterOptionTextActive]}>{t('clients.timeline_filter_period_all')}</Text>
                            {timelinePeriodFilter === null && <Check size={16} color={colors.primaryAction} strokeWidth={2.5} />}
                          </TouchableOpacity>
                          {timelineAvailableMonths.map(month => (
                            <TouchableOpacity key={month} style={styles.timelineFilterOption} onPress={() => { setTimelinePeriodFilter(month); setOpenTimelineFilter(null) }} activeOpacity={0.7}>
                              <Text style={[styles.timelineFilterOptionText, timelinePeriodFilter === month && styles.timelineFilterOptionTextActive]}>{monthYearLabel(month, locale)}</Text>
                              {timelinePeriodFilter === month && <Check size={16} color={colors.primaryAction} strokeWidth={2.5} />}
                            </TouchableOpacity>
                          ))}
                        </>
                      )}
                    </View>
                  </TouchableOpacity>
                </Modal>
              </View>
            )}

            {/* ─ Suivi ─ */}
            {activeTab === 'suivi' && (
              <View style={[styles.tabColumns, isDesktopWeb && styles.tabColumnsDesktop]}>
                {/* RDV */}
                <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}><Calendar size={14} color={colors.primary} strokeWidth={2} /></View>
                    <Text style={styles.cardTitle}>{t('clients.tab_rdv')}</Text>
                    {appointments.length > 0 ? (
                      <View style={styles.sectionCountBadge}><Text style={styles.sectionCountBadgeText}>{appointments.length}</Text></View>
                    ) : null}
                    <TouchableOpacity onPress={() => router.push(`/(app)/clients/${id}/appointments`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                    </TouchableOpacity>
                  </View>
                  {appointments.length === 0
                    ? <Text style={styles.suiviEmptyText}>{t('appointments.empty')}</Text>
                    : appointments
                        .slice()
                        .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
                        .slice(0, 3)
                        .map(appt => {
                          const biz = appt.business_context
                          const contextParts: string[] = []
                          if (biz?.prospect_temperature) {
                            contextParts.push(t(`prospect_temperatures.${biz.prospect_temperature}` as any))
                          }
                          if (biz?.commercial_intent?.length) {
                            contextParts.push(biz.commercial_intent.map(i => t(`commercial_intents.${i}` as any)).join(', '))
                          }
                          if (biz?.pipeline_stage) {
                            contextParts.push(t(`pipeline_stages.${biz.pipeline_stage}` as any))
                          }
                          return (
                            <TouchableOpacity
                              key={appt.id}
                              style={styles.listCard}
                              onPress={() => router.push(`/(app)/appointments/${appt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                              activeOpacity={0.8}
                            >
                              <View style={styles.listCardLeft}>
                                <View style={styles.apptRowHeader}>
                                  <Text style={styles.listCardDate}>
                                    {formatDate(appt.start_at, locale)}
                                  </Text>
                                  <View style={[styles.apptStatusPill, { backgroundColor: (APPT_STATUS_COLOR[appt.status] ?? colors.textSecondary) + '22' }]}>
                                    <Text style={[styles.apptStatusPillText, { color: APPT_STATUS_COLOR[appt.status] ?? colors.textSecondary }]}>
                                      {t(`appointment_statuses.${appt.status}` as any)}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.listCardSub} numberOfLines={1}>{appt.title}</Text>
                                {contextParts.length > 0 && (
                                  <Text style={styles.listCardContext} numberOfLines={1}>{contextParts.join(' · ')}</Text>
                                )}
                              </View>
                              <View style={styles.listCardBadge}>
                                <Text style={styles.listCardBadgeText}>{new Date(appt.start_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</Text>
                              </View>
                            </TouchableOpacity>
                          )
                        })
                  }
                  <TouchableOpacity
                    style={styles.addRowBtn}
                    onPress={() => router.push(`/(app)/appointments/new?clientId=${id}&returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.addRowBtnText}>+ {t('appointments.add')}</Text>
                  </TouchableOpacity>
                </View>

                {/* Relances */}
                <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconBox, { backgroundColor: colors.warningLight }]}><Bell size={14} color={colors.warning} strokeWidth={2} /></View>
                    <Text style={styles.cardTitle}>{t('clients.tab_followups')}</Text>
                    {followups.length > 0 ? (
                      <View style={styles.sectionCountBadge}><Text style={styles.sectionCountBadgeText}>{followups.length}</Text></View>
                    ) : null}
                    <TouchableOpacity onPress={() => router.push(`/(app)/clients/${id}/followups`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                    </TouchableOpacity>
                  </View>
                  {followups.length === 0
                    ? <Text style={styles.suiviEmptyText}>{t('followups.none')}</Text>
                    : followups
                        .slice()
                        .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
                        .slice(0, 3)
                        .map(f => (
                          <TouchableOpacity
                            key={f.id}
                            style={[styles.listCard, f.done && styles.listCardDone]}
                            onPress={() => router.push(`/(app)/clients/${id}/followups`)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.listCardLeft}>
                              <Text style={[styles.listCardDate, f.done && styles.listCardDateStrike]}>
                                {fmtShort(f.due_date, locale)}
                              </Text>
                              <Text style={styles.listCardSub} numberOfLines={2}>{f.title ?? f.content}</Text>
                            </View>
                            {f.done && (
                              <View style={styles.doneBadge}>
                                <Text style={styles.doneBadgeText}>{t('followups.done')}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        ))
                  }
                  <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/followups`)} activeOpacity={0.7}>
                    <Text style={styles.addRowBtnText}>+ {t('followups.add')}</Text>
                  </TouchableOpacity>
                </View>

                {/* Reco */}
                {isModuleActive('products') && (
                  <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.successLight }]}><Leaf size={14} color={colors.success} strokeWidth={2} /></View>
                      <Text style={styles.cardTitle}>{t('clients.tab_reco')}</Text>
                      {recommendations.length > 0 ? (
                        <View style={styles.sectionCountBadge}><Text style={styles.sectionCountBadgeText}>{recommendations.length}</Text></View>
                      ) : null}
                      <TouchableOpacity onPress={() => router.push(`/(app)/clients/${id}/recommendations`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                      </TouchableOpacity>
                    </View>
                    {recommendations.length === 0
                      ? <Text style={styles.suiviEmptyText}>{t('recommendations.empty')}</Text>
                      : recommendations.slice(0, 3).map(r => (
                          <TouchableOpacity
                            key={r.id}
                            style={styles.listCard}
                            onPress={() => router.push(`/(app)/clients/${id}/recommendations`)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.listCardLeft}>
                              <Text style={styles.listCardTitle}>{r.product_name}</Text>
                              {r.reason ? <Text style={styles.listCardSub} numberOfLines={2}>{r.reason}</Text> : null}
                            </View>
                            <View style={[styles.listCardBadge, r.status !== 'advised' && styles.listCardBadgeGreen]}>
                              <Text style={[styles.listCardBadgeText, r.status !== 'advised' && styles.listCardBadgeTextGreen]}>
                                {t(`recommendations.${r.status}`)}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                    }
                    <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/recommendations`)} activeOpacity={0.7}>
                      <Text style={styles.addRowBtnText}>+ {t('recommendations.add')}</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Interactions */}
                <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconBox, { backgroundColor: colors.secondaryLight }]}><MessageCircle size={14} color={colors.secondary} strokeWidth={2} /></View>
                    <Text style={styles.cardTitle}>{t('clients.tab_interactions')}</Text>
                    {interactions.length > 0 ? (
                      <View style={styles.sectionCountBadge}><Text style={styles.sectionCountBadgeText}>{interactions.length}</Text></View>
                    ) : null}
                    <TouchableOpacity onPress={() => router.push(`/(app)/clients/${id}/interactions`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                    </TouchableOpacity>
                  </View>
                  {interactions.length === 0
                    ? <Text style={styles.suiviEmptyText}>{t('interactions.empty')}</Text>
                    : interactions
                        .slice()
                        .sort((a, b) => new Date(b.scheduled_at ?? 0).getTime() - new Date(a.scheduled_at ?? 0).getTime())
                        .slice(0, 3)
                        .map(item => (
                          <TouchableOpacity
                            key={item.id}
                            style={[styles.listCard, !!item.completed_at && styles.listCardDone]}
                            onPress={() => router.push(`/(app)/clients/${id}/interactions`)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.listCardLeft}>
                              <Text style={styles.listCardDate}>
                                {item.scheduled_at
                                  ? formatDate(item.scheduled_at, locale)
                                  : '—'}
                              </Text>
                              {item.subject ? <Text style={styles.listCardSub} numberOfLines={2}>{item.subject}</Text> : null}
                            </View>
                            <View style={styles.listCardBadge}>
                              <Text style={styles.listCardBadgeText}>{t(`interaction_types.${item.interaction_type}`)}</Text>
                            </View>
                          </TouchableOpacity>
                        ))
                  }
                  <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/interactions`)} activeOpacity={0.7}>
                    <Text style={styles.addRowBtnText}>+ {t('interactions.add')}</Text>
                  </TouchableOpacity>
                </View>

                {/* Commandes */}
                <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.iconBox, { backgroundColor: colors.tertiaryLight }]}><ShoppingCart size={14} color={colors.tertiary} strokeWidth={2} /></View>
                    <Text style={styles.cardTitle}>{t('clients.tab_orders')}</Text>
                    {orders.length > 0 ? (
                      <View style={styles.sectionCountBadge}><Text style={styles.sectionCountBadgeText}>{orders.length}</Text></View>
                    ) : null}
                    <TouchableOpacity onPress={() => router.push(`/(app)/clients/${id}/orders`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                    </TouchableOpacity>
                  </View>
                  {orders.length === 0
                    ? <Text style={styles.suiviEmptyText}>{t('orders.empty')}</Text>
                    : orders
                        .slice()
                        .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())
                        .slice(0, 3)
                        .map(o => (
                          <TouchableOpacity
                            key={o.id}
                            style={styles.listCard}
                            onPress={() => router.push(`/(app)/clients/${id}/orders`)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.listCardLeft}>
                              <Text style={styles.listCardDate}>
                                {formatDate(o.order_date, locale)}
                              </Text>
                              <Text style={styles.listCardSub} numberOfLines={1}>{o.product_name}</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                              {o.is_lrp ? (
                                <View style={[styles.listCardBadge, { backgroundColor: colors.secondaryLight }]}>
                                  <Text style={[styles.listCardBadgeText, { color: colors.secondary }]}>{t('orders.lrp')}</Text>
                                </View>
                              ) : null}
                              {o.amount != null ? (
                                <View style={styles.listCardBadge}>
                                  <Text style={styles.listCardBadgeText}>{o.amount.toFixed(0)}€</Text>
                                </View>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        ))
                  }
                  <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/orders`)} activeOpacity={0.7}>
                    <Text style={styles.addRowBtnText}>+ {t('orders.add')}</Text>
                  </TouchableOpacity>
                </View>

                {/* Réseau */}
                {((client.referral_count ?? 0) > 0 || client.network_potential) ? (
                  <View style={[styles.card, isDesktopWeb && styles.tabColumnItem]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.tertiaryLight }]}>
                        <Globe size={14} color={colors.tertiary} strokeWidth={2} />
                      </View>
                      <Text style={styles.cardTitle}>{t('clients.sections.network')}</Text>
                    </View>
                    {(client.referral_count ?? 0) > 0 ? (
                      <View style={styles.fieldBlock}>
                        <Text style={styles.fieldLabel}>{t('clients.fields.referral_count').toUpperCase()}</Text>
                        <Text style={styles.fieldValue}>{client.referral_count}</Text>
                      </View>
                    ) : null}
                    {client.network_potential ? (
                      <View style={styles.fieldBlock}>
                        <Text style={styles.fieldLabel}>{t('clients.fields.network_potential').toUpperCase()}</Text>
                        <Text style={styles.fieldValue}>{t(`network_potentials.${client.network_potential}`)}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* Équipe */}
                {isNetworkRole && (
                  <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                    <View style={styles.cardHeader}>
                      <View style={styles.iconBox}><Users size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                      <Text style={styles.cardTitle}>{t('clients.tab_team')}</Text>
                      {team.length > 0 ? (
                        <View style={styles.sectionCountBadge}><Text style={styles.sectionCountBadgeText}>{team.length}</Text></View>
                      ) : null}
                      <TouchableOpacity onPress={() => router.push(`/(app)/clients/${id}/team` as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                      </TouchableOpacity>
                    </View>
                    {team.length === 0
                      ? <Text style={styles.suiviEmptyText}>{t('network.empty')}</Text>
                      : team.slice(0, 3).map(m => (
                          <TouchableOpacity
                            key={m.id}
                            style={styles.listCard}
                            onPress={() => router.push(`/(app)/clients/${m.id}` as any)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.listCardLeft}>
                              <Text style={styles.listCardTitle}>{m.full_name}</Text>
                              {m.email ? <Text style={styles.listCardSub} numberOfLines={1}>{m.email}</Text> : null}
                            </View>
                            <View style={styles.listCardBadge}>
                              <Text style={styles.listCardBadgeText}>
                                {m.contact_role.map(r => getRoleLabel(r)).join(' · ')}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))
                    }
                  </View>
                )}
              </View>
            )}

            {/* ─ Profil ─ */}
            {activeTab === 'profil' && (
              <View style={[styles.tabColumns, isDesktopWeb && styles.tabColumnsDesktop]}>
                {/* Informations personnelles */}
                <View style={[styles.card, isDesktopWeb && styles.tabColumnItem]}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{t('clients.sections.personal')}</Text>
                    <TouchableOpacity onPress={() => router.push(`/(app)/clients/${id}/edit`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.cardMenu}>⋮</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.fieldGrid}>
                    {client.email ? (
                      <TouchableOpacity
                        style={styles.fieldGridItem}
                        onPress={() => Linking.openURL(`mailto:${client.email}`)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.fieldIconBox}><Mail size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.email').toUpperCase()}</Text>
                          <Text style={[styles.fieldValue, styles.fieldValueLink]}>{client.email}</Text>
                        </View>
                      </TouchableOpacity>
                    ) : null}
                    {client.phone ? (
                      <TouchableOpacity
                        style={styles.fieldGridItem}
                        onPress={() => isDesktopWeb ? copyPhone(client.phone!) : callContact(client.phone!)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.fieldIconBox}><Phone size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.phone').toUpperCase()}</Text>
                          <Text style={[styles.fieldValue, styles.fieldValueLink]}>
                            {isDesktopWeb && phoneCopied ? t('clients.phone_copied') : client.phone}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ) : null}
                    {client.birth_date ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Cake size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.birth_date').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>
                            {formatDate(client.birth_date, locale, { day: '2-digit', month: 'long', year: 'numeric' })}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                    {client.profession ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Briefcase size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.profession').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.profession}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.children ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Baby size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.children').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.children}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.country ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Globe size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.country').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.country}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.source ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><LinkIcon size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.source').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.source}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.inscription_date ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><CalendarCheck size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.inscription_date').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>
                            {formatDate(client.inscription_date, locale)}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                  </View>

                  {client.address ? (
                    <TouchableOpacity
                      style={styles.addressRow}
                      onPress={() => openAddressInMaps(client.address!)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.fieldIconBox}><MapPin size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                      <View style={styles.addressTextBlock}>
                        <Text style={styles.fieldLabel}>{t('clients.fields.address').toUpperCase()}</Text>
                        <Text style={styles.fieldValue}>{client.address}</Text>
                      </View>
                      <Text style={styles.addressChevron}>›</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Programme fidélité */}
                {isModuleActive('renewals_lrp') && (client.doterra_id || client.loyalty_notes || client.next_lrp_date || client.lrp_status !== 'not_enrolled') ? (
                  <View style={[styles.card, isDesktopWeb && styles.tabColumnItem]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.warningLight }]}>
                        <Star size={14} color={colors.warning} strokeWidth={2} />
                      </View>
                      <Text style={styles.cardTitle}>{t('clients.sections.doterra')}</Text>
                      {(() => {
                        const lrpColor = client.lrp_status === 'active' ? { bg: colors.successLight, text: colors.success }
                          : client.lrp_status === 'paused' ? { bg: colors.warningLight, text: colors.warning }
                          : client.lrp_status === 'cancelled' ? { bg: colors.dangerLight, text: colors.danger }
                          : { bg: colors.surfaceContainerHigh, text: colors.textTertiary }
                        return (
                          <View style={[styles.lrpStatusPill, { backgroundColor: lrpColor.bg }]}>
                            <Text style={[styles.lrpStatusPillText, { color: lrpColor.text }]}>
                              {t(`lrp_statuses.${client.lrp_status}`)}
                            </Text>
                          </View>
                        )
                      })()}
                    </View>
                    <View style={styles.fieldGrid}>
                      {client.doterra_id ? (
                        <View style={styles.fieldGridItem}>
                          <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>{t('clients.fields.doterra_id').toUpperCase()}</Text>
                            <Text style={styles.fieldValue}>{client.doterra_id}</Text>
                          </View>
                        </View>
                      ) : null}
                      {client.next_lrp_date ? (
                        <View style={styles.fieldGridItem}>
                          <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>{t('clients.fields.next_lrp_date', { name: getLrpName() }).toUpperCase()}</Text>
                            <Text style={styles.fieldValue}>
                              {formatDate(client.next_lrp_date, locale)}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                      {client.lrp_loyalty_percent != null ? (
                        <View style={styles.fieldGridItem}>
                          <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>{t('clients.fields.lrp_loyalty_percent').toUpperCase()}</Text>
                            <Text style={styles.fieldValue}>{client.lrp_loyalty_percent}%</Text>
                          </View>
                        </View>
                      ) : null}
                      {client.lrp_start_date ? (
                        <View style={styles.fieldGridItem}>
                          <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>{t('clients.fields.lrp_start_date').toUpperCase()}</Text>
                            <Text style={styles.fieldValue}>
                              {formatDate(client.lrp_start_date, locale)}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                    </View>
                    {client.loyalty_notes ? (
                      <Text style={styles.bodyText}>{client.loyalty_notes}</Text>
                    ) : null}
                  </View>
                ) : null}

                {/* Zone sensible — antécédents médicaux + particularités : accès explicite,
                    jamais affichée par défaut (décision #7 de la refonte). */}
                {(client.medical_notes || particularityItems.length > 0) ? (
                  <View style={[styles.card, isDesktopWeb && styles.tabColumnItem]}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.dangerLight }]}>
                        <Lock size={14} color={colors.danger} strokeWidth={2} />
                      </View>
                      <Text style={styles.cardTitle}>{t('clients.section_sensitive')}</Text>
                    </View>
                    {sensitiveRevealed ? (
                      <>
                        {client.medical_notes ? (
                          <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>{t('clients.section_medical').toUpperCase()}</Text>
                            <Text style={styles.bodyText}>{client.medical_notes}</Text>
                          </View>
                        ) : null}
                        {particularityItems.length > 0 ? (
                          <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>{t('clients.section_particularities').toUpperCase()}</Text>
                            {particularityItems.map((item, i) => (
                              <View key={i} style={styles.bulletRow}>
                                <Text style={styles.bullet}>•</Text>
                                <Text style={styles.bulletText}>{item}</Text>
                              </View>
                            ))}
                          </View>
                        ) : null}
                        <TouchableOpacity onPress={() => setSensitiveRevealed(false)} activeOpacity={0.7}>
                          <Text style={styles.sensitiveToggleText}>{t('clients.sensitive_hide')}</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity style={styles.sensitiveRevealBtn} onPress={() => setSensitiveRevealed(true)} activeOpacity={0.75}>
                        <Lock size={14} color={colors.danger} strokeWidth={2} />
                        <Text style={styles.sensitiveRevealText}>{t('clients.sensitive_reveal')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}

                {/* Centres d'intérêt */}
                <View style={[styles.interestsSection, isDesktopWeb && styles.tabColumnItem]}>
                  <Text style={styles.interestsTitle}>{t('clients.section_interests')}</Text>
                  <View style={styles.pillsWrap}>
                    {(client.interests ?? []).map((interest, i) => (
                      <View key={i} style={styles.interestPill}>
                        <Text style={styles.interestPillText}>{interest}</Text>
                      </View>
                    ))}
                    <TouchableOpacity
                      style={styles.addPillBtn}
                      onPress={() => router.push(`/(app)/clients/${id}/edit`)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.addPillText}>{t('clients.add_interest')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}

          </View>
          </ScrollView>
        </View>
      </View>

      <MessageModal
        visible={messageOpen}
        onClose={() => setMessageOpen(false)}
        client={client ?? null}
        advisorName={session?.user?.user_metadata?.full_name ?? session?.user?.email ?? ''}
        lastProduct={recommendations[0]?.product_name}
      />

      <MessageModal
        visible={showShareProfile}
        onClose={() => setShowShareProfile(false)}
        client={client ?? null}
        advisorName={session?.user?.user_metadata?.full_name ?? session?.user?.email ?? ''}
        initialTemplate={shareProfileTemplate}
      />
    </>
  )
}

const CARD_SHADOW = {
  boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 12, color: 'rgba(28, 26, 23, 0.04)' }],
  elevation: 1,
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.bgDim },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 100, maxWidth: 900, alignSelf: 'center', width: '100%' },

  // ── Layout deux colonnes (desktop web) ────────────────────────────────────
  bodyRow: { flex: 1 },
  bodyRowDesktop: {
    flexDirection: 'row',
    maxWidth: 1180,
    alignSelf: 'center',
    width: '100%',
    gap: 28,
    paddingHorizontal: 24,
  },
  desktopSidebar: { width: 300, flexShrink: 0, paddingTop: 24 },
  scrollContentDesktop: { maxWidth: '100%', alignSelf: 'stretch', paddingHorizontal: 0 },

  // ── Nav bar ────────────────────────────────────────────────────────────────
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 52,
    paddingBottom: 12,
    backgroundColor: colors.bg,
  },
  backRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backArrow:    { fontSize: 22, color: colors.text, lineHeight: 26 },
  navTitle:     { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
  navIconBtn:   { padding: 4 },
  navIconText:  { fontSize: 18 },

  // ── Hero ───────────────────────────────────────────────────────────────────
  hero:          { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 4, gap: 14 },
  heroTopRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bigAvatar:     { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bigAvatarText: { fontSize: 24, fontFamily: fonts.bold },
  avatarWrap:    { position: 'relative', flexShrink: 0 },
  avatarRing:    { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  avatarRingImg: { width: 62, height: 62, borderRadius: 31 },
  avatarEditBadge: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  heroIdentity:  { flex: 1, gap: 6 },
  heroName:      { fontSize: 19, fontFamily: fonts.display, color: colors.text },
  heroBadges:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroPill:      { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9999 },
  heroPillText:  { fontSize: 10, fontFamily: fonts.bold, letterSpacing: 0.5 },
  lrpStatusPill:     { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9999 },
  lrpStatusPillText: { fontSize: 10, fontFamily: fonts.bold, letterSpacing: 0.5 },
  heroMoreBtn:   { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexShrink: 0 },
  heroMoreIcon:  { fontSize: 18, color: colors.textSecondary, lineHeight: 20 },

  kpiStrip:  { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 8, width: '100%', ...CARD_SHADOW },
  kpiCol:    { flex: 1, alignItems: 'center', gap: 5 },
  kpiDivider:{ width: 1, height: 32, backgroundColor: colors.border },
  kpiLabel:  { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },
  kpiValue:  { fontSize: 17, fontFamily: fonts.bold, color: colors.text },

  // ── Prochaine action — bloc principal du hero ───────────────────────────────
  nextActionBlock:        { width: '100%', borderRadius: 16, borderWidth: 1.5, padding: 14, gap: 12 },
  nextActionTopRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextActionIconBox:      { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  nextActionTextBlock:    { flex: 1, gap: 2 },
  nextActionLabel:        { fontSize: 11, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  nextActionMainText:     { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  nextActionMeta:         { fontSize: 12.5, fontFamily: fonts.medium, color: colors.textSecondary },
  nextActionBtnRow:       { flexDirection: 'row', gap: 10 },
  nextActionBtnPrimary:      { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 12 },
  nextActionBtnPrimaryText:  { fontSize: 14, fontFamily: fonts.semibold, color: '#fff', textAlign: 'center' },
  nextActionBtnSecondary:     { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 12, borderWidth: 1.5, backgroundColor: colors.card },
  nextActionBtnSecondaryText: { fontSize: 14, fontFamily: fonts.semibold, textAlign: 'center' },
  nextActionEmpty:        { width: '100%', borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, padding: 16, alignItems: 'center', gap: 10 },
  nextActionEmptyText:    { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  nextActionEmptyBtn:     { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9999, backgroundColor: colors.primaryLight },
  nextActionEmptyBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },

  // ── Actions secondaires (contact rapide) ────────────────────────────────────
  secondaryActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 14 },
  saBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.card, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.border, ...CARD_SHADOW },
  saLabel:    { fontSize: 13, fontFamily: fonts.semibold, color: colors.textSecondary },

  // ── Menu "Plus" (feuille inférieure) ────────────────────────────────────────
  moreMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  moreMenuSheet:   { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 12, paddingBottom: 24, paddingTop: 10 },
  moreMenuHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 10 },
  moreMenuOption:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 10 },
  moreMenuOptionText:  { fontSize: 15, fontFamily: fonts.medium, color: colors.text },

  // ── Photo de contact (feuilles inférieures) ─────────────────────────────────
  photoSheetTitle:   { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, textAlign: 'center', marginBottom: 6 },
  photoUrlInput:     { backgroundColor: colors.bgDim, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: fonts.body, color: colors.text, marginTop: 4, marginBottom: 12 },
  photoUrlError:       { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, marginTop: -6, marginBottom: 12 },
  photoUrlSaveBtn:     { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  photoUrlSaveBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },

  // ── Tab bar ────────────────────────────────────────────────────────────────
  tabScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border, marginTop: 20 },
  tabRow:    { flexDirection: 'row', paddingHorizontal: 12 },
  tabBtn:    { paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: 'transparent', marginRight: 2 },
  tabBtnActive:   { borderBottomColor: colors.primaryAction },
  tabLabel:       { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  tabLabelActive: { color: colors.primaryAction, fontFamily: fonts.semibold },

  // ── Tab content ────────────────────────────────────────────────────────────
  tabContent: { padding: 16, gap: 12 },

  // ── Deux colonnes sur desktop (Synthèse/Suivi/Profil) — reste en une seule
  // colonne sur mobile (flexDirection par défaut = column, items en largeur pleine).
  tabColumns:        { gap: 12 },
  tabColumnsDesktop: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
  tabColumnItem:     { flexBasis: '48%', flexGrow: 1, minWidth: 0 },

  // Section cards
  card:       { backgroundColor: colors.card, borderRadius: 16, padding: 20, gap: 14, ...CARD_SHADOW },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle:  { fontSize: 16, fontFamily: fonts.semibold, color: colors.text, flex: 1 },
  cardMenu:   { fontSize: 20, color: colors.textTertiary, lineHeight: 24 },
  iconBox:    { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },

  // Field rows
  fieldBlock: { gap: 3, flex: 1 },
  fieldLabel: { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 0.8 },
  fieldValue: { fontSize: 14, fontFamily: fonts.body, color: colors.text, lineHeight: 20 },
  fieldValueLink: { color: colors.primary, fontFamily: fonts.medium },

  // Field grid (2 columns, icon + label/value)
  fieldGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  fieldGridItem:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start', width: '44%', minWidth: 150 },
  fieldIconBox:   { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // Address row (tappable → opens maps)
  addressRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, padding: 10, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  addressTextBlock: { flex: 1, gap: 3 },
  addressChevron:   { fontSize: 20, color: colors.textTertiary, lineHeight: 22 },

  // Body text
  bodyText: { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 22 },

  // Bullet list
  bulletRow:  { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  bullet:     { fontSize: 14, color: colors.primaryAction, lineHeight: 22 },
  bulletText: { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary, flex: 1, lineHeight: 22 },

  // ── Zone sensible (Profil) — accès explicite aux données de santé ──────────
  sensitiveRevealBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.danger },
  sensitiveRevealText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.danger },
  sensitiveToggleText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },

  // Interests
  interestsSection: { gap: 10 },
  interestsTitle:   { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
  pillsWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  interestPill:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  interestPillText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  addPillBtn:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9999, borderWidth: 1.5, borderColor: colors.primaryAction },
  addPillText:      { fontSize: 13, fontFamily: fonts.medium, color: colors.primaryAction },

  // List tabs
  listTab:   { gap: 10 },
  emptyText: { textAlign: 'center', color: colors.textTertiary, fontFamily: fonts.body, fontSize: 14, marginTop: 32, marginBottom: 16 },
  suiviEmptyText: { textAlign: 'center', color: colors.textTertiary, fontFamily: fonts.body, fontSize: 13, marginVertical: 6 },

  // ── Suivi — sections groupées par domaine (RDV, Relances, Reco...) ─────────
  suiviSection: { gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14 },
  suiviViewAll: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },
  sectionCountBadge:     { backgroundColor: colors.bgDim, borderRadius: 9999, paddingHorizontal: 7, paddingVertical: 2 },
  sectionCountBadgeText: { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary },

  // ── Activité — barre de filtres compacte ──────────────────────────────────
  timelineFilterBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  timelineFilterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, maxWidth: 190,
  },
  timelineFilterBtnLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },
  timelineFilterBtnValue: { fontSize: 12, fontFamily: fonts.semibold, color: colors.text, flexShrink: 1 },
  timelineFilterChevron:  { fontSize: 10, color: colors.textTertiary },
  timelineFilterResetBtn:  { justifyContent: 'center', paddingHorizontal: 4 },
  timelineFilterResetText: { fontSize: 12, fontFamily: fonts.medium, color: colors.primary },

  // ── Activité — feuille de sélection (bottom sheet) ────────────────────────
  timelineFilterOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  timelineFilterSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32, gap: 2,
  },
  timelineFilterSheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 },
  timelineFilterSheetTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, paddingHorizontal: 4 },
  timelineFilterOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 4 },
  timelineFilterOptionText:       { fontSize: 15, fontFamily: fonts.medium, color: colors.text },
  timelineFilterOptionTextActive: { color: colors.primary, fontFamily: fonts.semibold },

  // ── Activité — fil d'événements ────────────────────────────────────────────
  timelineMonthHeader: {
    fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 6,
  },
  timelineRow:  { flexDirection: 'row', gap: 12 },
  timelineRail: { alignItems: 'center', width: 32 },
  timelineDot:  { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2, minHeight: 14 },
  timelineContent: { flex: 1, paddingBottom: 18, gap: 3 },
  timelineContentTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  timelineTitle:     { flex: 1, fontSize: 14, fontFamily: fonts.semibold, color: colors.text, lineHeight: 19 },
  timelineTitleDone: { color: colors.textTertiary, textDecorationLine: 'line-through' },
  timelineRelative:  { fontSize: 11, fontFamily: fonts.semibold, color: colors.textTertiary, flexShrink: 0 },
  timelineMetaRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timelineDate:      { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  timelineSubText:   { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, flexShrink: 1 },
  timelineStatusPill:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999 },
  timelineStatusPillText: { fontSize: 11, fontFamily: fonts.semibold },
  timelineContentTouchable: { flex: 1 },
  timelineNoteTagsRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  timelineNoteTag:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgDim, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  timelineNoteTagText:  { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary },

  // ── Composeur de note libre (en tête de l'onglet Activité) ─────────────────
  noteComposer:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: colors.card, borderRadius: 14, padding: 10, ...CARD_SHADOW },
  noteComposerInput:   { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, fontFamily: fonts.body, color: colors.text, maxHeight: 100 },
  noteComposerBtn:     { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  noteComposerBtnDisabled: { backgroundColor: colors.textTertiary },
  noteComposerBtnText: { color: '#fff', fontSize: 20, fontFamily: fonts.bold },
  noteComposerHint:    { fontSize: 11.5, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 6, marginLeft: 4 },

  // ── Suppression inline d'une note libre dans le fil Activité ───────────────
  timelineNoteDeleteBtn:     { paddingTop: 2 },
  timelineNoteConfirm:       { flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 },
  timelineConfirmCancelBtn:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  timelineConfirmCancelText: { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  timelineConfirmDeleteBtn:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.danger },
  timelineConfirmDeleteText: { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

  listCard:       { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 6, flexDirection: 'row', alignItems: 'flex-start', ...CARD_SHADOW },
  listCardDone:   { opacity: 0.55 },
  listCardLeft:   { flex: 1, gap: 4 },
  listCardTitle:  { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  listCardDate:   { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },
  listCardDateStrike: { textDecorationLine: 'line-through', color: colors.textTertiary },
  listCardSub:    { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  listCardContext: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 16 },
  apptRowHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  apptStatusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999 },
  apptStatusPillText: { fontSize: 11, fontFamily: fonts.semibold },
  listCardBadge:  { backgroundColor: colors.surfaceContainerHigh, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999 },
  listCardBadgeGreen: { backgroundColor: colors.primaryLight },
  listCardBadgeText:  { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary },
  listCardBadgeTextGreen: { color: colors.primaryAction },
  doneBadge:      { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999 },
  doneBadgeText:  { fontSize: 11, fontFamily: fonts.bold, color: colors.primaryAction },

  addRowBtn:     { marginTop: 4, paddingVertical: 13, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  addRowBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primaryAction },
  })
}
