import { useState, useMemo, useEffect, useCallback } from 'react'
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Platform, useWindowDimensions, Modal, TextInput } from 'react-native'
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as Clipboard from 'expo-clipboard'
import * as ImagePicker from 'expo-image-picker'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClient } from '@/features/clients/useClient'
import { updateClient } from '@/features/clients/clientService'
import { getLrpFrequencyLabel, formatProgramTitle, getOrderProgramBadge } from '@/features/clients/lrpProgramService'
import { fetchProgramsForClient, isProgramEligibleForNextOccurrence } from '@/features/clients/recurringProgramService'
import { deriveOccurrenceDisplayStatus } from '@/features/clients/recurringOccurrenceService'
import type { RecurringProgram } from '@/shared/lib/types'
import { useClientAppointmentsWithContext, useClientTasks } from '@/features/appointments/useAppointments'
import { useNotes } from '@/features/notes/useNotes'
import { createNote, deleteNote } from '@/features/notes/noteService'
import { useClientFollowups } from '@/features/followups/useFollowups'
import { FollowupCompletionModal } from '@/features/followups/FollowupCompletionModal'
import { FollowupActionFlow, awaitingReplyLabel, followupActionKind, followupActionLabel } from '@/features/followups/FollowupActionFlow'
import { useCareJourney } from '@/features/care/useCareJourney'
import { CareJourneyCard } from '@/features/care/CareJourneyCard'
import { ContactSynthesis } from '@/features/clients/ContactSynthesis'
import { ContactExpectationsCard } from '@/features/clients/ContactExpectationsCard'
import { ContactSensitiveCard } from '@/features/clients/ContactSensitiveCard'
import { useClientBrands } from '@/features/brands/useBrands'
import { BrandAvatar, BrandPill } from '@/features/brands/BrandPill'
import { ContactBrandsCard } from '@/features/brands/ContactBrandsCard'
import { BrandLoyaltySection } from '@/features/brands/BrandLoyaltySection'
import type { Followup } from '@/shared/lib/types'
import { useRecommendations } from '@/features/recommendations/useRecommendations'
import { useClientInteractions } from '@/features/interactions/useInteractions'
import { useClientOrders } from '@/features/orders/useOrders'
import { isOrderNetRevenue } from '@/features/orders/orderService'
import { fetchOrderItemsForOrders, hybridLinesFromItems } from '@/features/orders/orderItemService'
import type { OrderItem } from '@/shared/lib/types'
import { useDirectTeam, useSponsorGraph } from '@/features/network/useNetwork'
import { setClientSponsor, SponsorCycleError, NETWORK_ROLES } from '@/features/network/networkService'
import { brandRoleLabel } from '@/features/brands/brandRoleLabels'
import { timeZoneCity, timeZoneOffsetMinutes, formatUtcOffset } from '@/features/clients/timezones'
import { RemoteTimeBadge } from '@/features/clients/RemoteTimeBadge'
import { useContactLocalTime } from '@/features/clients/useContactLocalTime'
import { ContactHoursGuard } from '@/features/clients/ContactHoursGuard'
import type { GuardedAction } from '@/features/clients/ContactHoursGuard'
import { MEETING_MODE_ICON, meetingActionUrl } from '@/features/appointments/meetingMode'
import { attachToBrandSponsor, fetchBrandMembers, BrandSponsorError } from '@/features/brands/brandService'
import type { BrandMember } from '@/features/brands/brandService'
import { ContactPickerModal } from '@/features/network/ContactPickerModal'
import { useClientEvents } from '@/features/clients/useClientEvents'
import { useClientRecapShares } from '@/features/appointments/useRecapShares'
import type { AppointmentRecapShare } from '@/features/appointments/appointmentTypes'
import { callContact, completeNextAction, openWhatsApp, rescheduleNextAction } from '@/features/clients/nextActionService'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { supabase } from '@/shared/lib/supabase'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import { CalendarPickerModal } from '@/shared/components/ui/CalendarPickerModal'
import { AnchoredMenu } from '@/shared/components/ui/AnchoredMenu'
import { OpenActionLink } from '@/shared/components/ui/OpenActionLink'
import type { CalendarBusyAppointment } from '@/shared/components/ui/CalendarPickerModal'
import { fetchBusyAppointments, fetchAppointmentById, setAppointmentTaskDone, fetchDoneTasksByClient, countDoneTasksByClient } from '@/features/appointments/appointmentService'
import type { AppointmentTask } from '@/features/appointments/appointmentTypes'
import { CompleteToggle } from '@/shared/components/ui/CompleteToggle'
import { buildClientSummaryTemplate } from '@/features/messages/templates'
import { formatOrdersForClientSummary } from '@/features/orders/orderSummary'
import { fetchUpcomingAppointmentsForClient } from '@/features/appointments/appointmentOutcomeService'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import {
  Calendar, FileText, Bell, Leaf, ShoppingCart, MessageCircle, Users, Globe, Hourglass,
  Star, Lock, Phone, Mail, Cake, Briefcase, Baby, Link as LinkIcon, CalendarCheck, MapPin,
  Clock, Target, TriangleAlert, Trash2, Check, History, Camera, Image as ImageIcon, ChevronRight,
  Send, RefreshCw,
} from 'lucide-react-native'
import type { ThemeColors } from '@/shared/theme/colors'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { gravatarUrl } from '@/shared/lib/gravatar'
import { fonts } from '@/shared/theme/fonts'
import { formatDate, formatTime, isoToLocalParts } from '@/shared/lib/dateFormat'
import { computeRelationshipHealth } from '@/features/clients/relationshipHealth'
import { PIPELINE_STAGES } from '@/shared/lib/types'
import { BackButton } from '@/shared/components/ui/BackButton'
import { useStackBack } from '@/shared/lib/useStackBack'

type Tab = 'synthese' | 'chrono' | 'suivi' | 'profil'

type TimelineKind = 'rdv' | 'note' | 'relance' | 'reco' | 'commande' | 'interaction' | 'changement' | 'recap_share' | 'lrp'
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
  recap_share: 'clients.tab_recap_shares',
  // N'apparaît jamais dans le filtre "type" (timelineAvailableKinds ne dérive que de
  // timelineEntries, jamais de upcomingItems) — clé fournie uniquement pour satisfaire
  // l'exhaustivité du Record<TimelineKind, string>.
  lrp:         'clients.sections.doterra',
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
  // ACTION-OUTCOME-1 / P0 §22 — extrait du compte-rendu (notes_brutes), uniquement pour une
  // interaction terminée qui en possède un ; jamais un texte vide affiché (§23/§24).
  preview?: string
  // Changement de statut (rôle / étape) : regroupé pour ne garder que l'état final.
  isStatus?: boolean
  onPress: () => void
}

// Icône linéaire par domaine — réutilisée par l'Activité, Synthèse et Suivi pour que
// le même type d'événement soit toujours identifiable par la même forme.
type IconComp = typeof Calendar
const KIND_ICON: Record<TimelineKind, IconComp> = {
  rdv: Calendar, note: FileText, relance: Bell, reco: Leaf, commande: ShoppingCart, interaction: MessageCircle,
  changement: History, recap_share: Send, lrp: RefreshCw,
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

// ACTIVITY-HISTORY-1 — repère pour l'historique (uniquement du passé).
function pastRelativeLabel(dateStr: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const target = new Date(dateStr)
  const now = new Date()
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    - new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()) / 86400000)
  if (days <= 0) return t('clients.timeline_today')
  if (days === 1) return t('clients.history_yesterday')
  if (days < 31) return t('clients.history_days_ago', { count: days })
  return t('clients.history_months_ago', { count: Math.round(days / 30) })
}

// ACTIVITY-HISTORY-1 — à appliquer sur une liste triée du plus récent au plus ancien.
function statusDedupe() {
  const daysKept = new Set<string>()
  return (e: { date: string; title: string; isStatus?: boolean }, i: number, all: { date: string; title: string; isStatus?: boolean }[]) => {
    if (!e.isStatus) return true
    const d = new Date(e.date)
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (daysKept.has(day)) return false
    // Statut précédent (plus ancien) retenu : même jour exclu, on cherche le dernier état d'un jour antérieur.
    const older = all.slice(i + 1).find(o => {
      if (!o.isStatus) return false
      const od = new Date(o.date)
      return `${od.getFullYear()}-${od.getMonth()}-${od.getDate()}` !== day
    })
    daysKept.add(day)
    return !older || older.title !== e.title
  }
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

// CONTACT-4 — action concrète (RDV/relance/interaction active) en retard ou due aujourd'hui,
// jamais une action future (null dans ce cas) : borne à "fin du jour actuel" en comparant des
// dates calendaires, comme le reste de la fiche (relativeDayLabel/daysUntil ci-dessus).
type TodoUrgency = 'overdue' | 'today'
function urgencyOf(dateStr: string): TodoUrgency | null {
  const d = daysUntil(dateStr)
  return d < 0 ? 'overdue' : d === 0 ? 'today' : null
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

function pluralS(n: number) { return n > 1 ? 's' : '' }

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
    relance:     { bg: colors.successLight,   text: colors.success },
    reco:        { bg: colors.successLight,   text: colors.success },
    commande:    { bg: colors.tertiaryLight,  text: colors.tertiary },
    interaction: { bg: colors.secondaryLight, text: colors.secondary },
    // Gris neutre — événement système automatique, pas un contenu créé par l'utilisateur.
    changement:  { bg: colors.bgDim,          text: colors.textTertiary },
    // RÉCAP-5D §15 — même traitement neutre que `changement` : un partage initié est une
    // information secondaire de traçabilité, jamais un contenu métier au même niveau qu'un RDV/
    // une commande/une interaction.
    recap_share: { bg: colors.bgDim,          text: colors.textTertiary },
    lrp:         { bg: colors.secondaryLight, text: colors.secondary },
  }
  // Statut générique -> couleur, cohérent avec APPT_STATUS_COLOR (pending≈scheduled).
  const TIMELINE_STATUS_COLOR: Record<'done' | 'pending' | 'cancelled', string> = {
    done: colors.success, pending: colors.primary, cancelled: colors.danger,
  }
  const { id } = useLocalSearchParams<{ id: string }>()
  const goBack = useStackBack('/(app)/clients')
  const { session } = useAuth()
  const { client, loading, refresh } = useClient(id)
  const { appointments, refresh: refreshAppointments } = useClientAppointmentsWithContext(id)
  const [guardAction, setGuardAction] = useState<GuardedAction | null>(null)
  const [pastApptsOpen, setPastApptsOpen] = useState(false)
  const [doneFollowupsOpen, setDoneFollowupsOpen] = useState(false)
  const contactLocalTime = useContactLocalTime(client?.timezone)
  const { notes, refresh: refreshNotes } = useNotes(id)
  const { followups, refresh: refreshFollowups } = useClientFollowups(id)
  const { journey: careJourney, steps: careSteps, refresh: refreshCare } = useCareJourney(id)
  const { links: brandLinks, refresh: refreshBrandLinks } = useClientBrands(id)
  const { recommendations, refresh: refreshRecommendations } = useRecommendations(id)
  const { interactions, refresh: refreshInteractions } = useClientInteractions(id)
  const { orders, reload: reloadOrders } = useClientOrders(id)
  // ORDER-BUSINESS-4.2.1 §1/§2/§3 — source STRUCTURÉE pour le résumé "copie de mes données" :
  // lecture GROUPÉE (1 requête pour toutes les commandes récentes du contact, jamais une par
  // commande) des order_items réels, pour que `returnedQty` reflète un vrai retour partiel
  // enregistré via OrderEditModal — le repli JSON legacy (deriveOrderLines, returnedQty=0)
  // reste utilisé pour toute commande sans order_items structurés (hybridLinesFromItems).
  // Reclenché à chaque changement de `orders` (chargement initial ET reload au focus, §10 —
  // même mécanisme déjà en place sur cet écran, aucune synchronisation temps réel ajoutée).
  // `Map` (classe native) est masqué dans ce fichier par l'icône lucide-react-native du même nom
  // (import ligne 47, voir précédent identique §497) : objet indexé simple à la place, converti
  // depuis le Map retourné par fetchOrderItemsForOrders (défini dans un autre fichier, non
  // affecté par ce masquage — seule la CONSTRUCTION/le TYPE `Map` ici pose problème, pas l'usage
  // d'une instance déjà créée ailleurs).
  const [orderItemsByOrderId, setOrderItemsByOrderId] = useState<Record<string, OrderItem[]>>({})
  useEffect(() => {
    let cancelled = false
    const recentOrderIds = orders
      .slice().sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())
      .slice(0, 5).map(o => o.id)
    fetchOrderItemsForOrders(recentOrderIds).then(itemsMap => {
      if (cancelled) return
      const record: Record<string, OrderItem[]> = {}
      itemsMap.forEach((items, orderId) => { record[orderId] = items })
      setOrderItemsByOrderId(record)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [orders])
  const { team, reload: reloadTeam } = useDirectTeam(id)
  // SPONSOR-1 — "Ajouter un filleul" : rattacher un contact existant ou en créer un nouveau.
  const [downlinePickerOpen, setDownlinePickerOpen] = useState(false)
  const [downlineError, setDownlineError] = useState<string | null>(null)
  // BRAND-NETWORK-1 — avec des marques, le filleul est rattaché dans le réseau d'une marque :
  // choix de la marque d'abord s'il y en a plusieurs.
  const [downlineBrandId, setDownlineBrandId] = useState<string | null>(null)
  const [downlineBrandPickerOpen, setDownlineBrandPickerOpen] = useState(false)
  const [downlineBrandMembers, setDownlineBrandMembers] = useState<BrandMember[]>([])
  const { graph: sponsorGraph, reload: reloadSponsorGraph } = useSponsorGraph(downlinePickerOpen)
  function openAddDownline() {
    setDownlineError(null)
    if (brandLinks.length === 0) { setDownlineBrandId(null); setDownlinePickerOpen(true); return }
    if (brandLinks.length === 1) { chooseDownlineBrand(brandLinks[0].brand_id); return }
    setDownlineBrandPickerOpen(true)
  }
  function chooseDownlineBrand(brandId: string) {
    setDownlineBrandPickerOpen(false)
    setDownlineBrandId(brandId)
    setDownlineBrandMembers([])
    fetchBrandMembers(brandId).then(setDownlineBrandMembers).catch(e => console.error('[addDownline.members]', e))
    setDownlinePickerOpen(true)
  }
  const downlineOptions = useMemo(() => {
    if (!id) return []
    const names = new Map(sponsorGraph.map(n => [n.id, n.full_name]))
    // Parrain de chaque contact dans le réseau concerné (marque choisie, sinon hors marque).
    const sponsorOf = new Map<string, string | null>(downlineBrandId
      ? downlineBrandMembers.map(m => [m.client_id, m.sponsor_client_id])
      : sponsorGraph.map(n => [n.id, n.sponsor_id]))
    // Exclus : le contact, ses ancêtres (boucle) et ses filleuls directs actuels.
    const ancestors = new Set<string>([id])
    let cursor = sponsorOf.get(id) ?? null
    while (cursor && !ancestors.has(cursor)) { ancestors.add(cursor); cursor = sponsorOf.get(cursor) ?? null }
    return sponsorGraph
      .filter(n => !ancestors.has(n.id) && sponsorOf.get(n.id) !== id)
      .map(n => {
        const current = sponsorOf.get(n.id)
        return {
          id: n.id,
          label: n.full_name,
          sub: current && names.get(current) ? t('network.currently_under', { name: names.get(current)! }) : undefined,
        }
      })
  }, [id, sponsorGraph, downlineBrandId, downlineBrandMembers, t])
  const downlineBrandName = brandLinks.find(l => l.brand_id === downlineBrandId)?.brand.name ?? null
  const { events: clientEvents, refresh: refreshClientEvents } = useClientEvents(id)
  // RÉCAP-5D — même convention que useClientEvents ci-dessus (hook dédié + refresh au focus).
  const { shares: recapShares, refresh: refreshRecapShares } = useClientRecapShares(id)
  // CONTACT-RDV-TASKS/P3 — audit : aucune donnée appointment_tasks n'était chargée sur cette
  // fiche (confirmé, seul le sous-onglet Relances les charge déjà pour son propre usage). Même
  // convention que les autres ressources ci-dessus : hook dédié + refresh au focus (§20 du
  // brief — jamais de polling, uniquement le mécanisme déjà en place sur cette page).
  const { tasks: clientTasks, refresh: refreshClientTasks } = useClientTasks(id)
  // TASK-RDV-1 §10/§12 — traçabilité des tâches terminées, secondaire et repliée par défaut.
  // Seul un compteur léger (head:true) est chargé tant que la section n'est pas dépliée ; les
  // lignes complètes ne sont récupérées qu'au premier dépliement (evite une requête inutile pour
  // une section que la majorité des visites ne consultent jamais).
  const [doneTasksCount, setDoneTasksCount] = useState(0)
  const [showDoneTasks, setShowDoneTasks] = useState(false)
  const [doneClientTasks, setDoneClientTasks] = useState<AppointmentTask[]>([])
  const [doneTasksLoading, setDoneTasksLoading] = useState(false)
  const refreshDoneTasksCount = useCallback(() => {
    countDoneTasksByClient(id).then(setDoneTasksCount).catch(() => {})
  }, [id])
  // LRP-4 — tous les programmes récurrents du contact (source de vérité, remplace
  // client.lrp_status/next_lrp_date pour Synthèse/Profil). Un contact peut en porter plusieurs.
  const [recurringPrograms, setRecurringPrograms] = useState<RecurringProgram[]>([])
  const refreshRecurringPrograms = useCallback(() => {
    fetchProgramsForClient(id).then(setRecurringPrograms).catch(() => {})
  }, [id])
  function toggleDoneTasksSection() {
    const next = !showDoneTasks
    setShowDoneTasks(next)
    if (next) {
      setDoneTasksLoading(true)
      fetchDoneTasksByClient(id).then(setDoneClientTasks).catch(() => {}).finally(() => setDoneTasksLoading(false))
    }
  }
  // §7/§9/§11 — même fonction de bascule que la fiche RDV (setAppointmentTaskDone), jamais une
  // logique séparée. Rouvrir depuis "Terminées" la retire immédiatement de cette liste et
  // rafraîchit "Tâches à faire" (elle y réapparaît sans attendre un focus ultérieur, §9).
  async function handleReopenClientTask(taskId: string) {
    await setAppointmentTaskDone(taskId, false)
    setDoneClientTasks(prev => prev.filter(t => t.id !== taskId))
    setDoneTasksCount(c => Math.max(0, c - 1))
    refreshClientTasks()
  }
  // Fix — si "Terminées" est actuellement dépliée, la rafraîchir aussi (pas seulement son
  // compteur) pour que la tâche tout juste terminée y apparaisse immédiatement, sans attendre un
  // nouveau dépliement manuel.
  async function handleCompleteClientTask(taskId: string) {
    await setAppointmentTaskDone(taskId, true)
    refreshClientTasks()
    refreshDoneTasksCount()
    if (showDoneTasks) fetchDoneTasksByClient(id).then(setDoneClientTasks).catch(() => {})
  }
  // Sans ça, revenir de "Ajouter un RDV / une relance / une recommandation / une interaction /
  // une commande / un contact réseau" (ou de "Modifier") affiche des données périmées tant que
  // l'utilisateur ne quitte pas et ne revient pas sur la fiche — chaque section de l'onglet
  // Suivi a sa propre source de données, il faut toutes les rafraîchir, pas seulement le client.
  useFocusEffect(useCallback(() => {
    refresh()
    refreshAppointments()
    refreshNotes()
    refreshFollowups()
    refreshRecommendations()
    refreshInteractions()
    reloadOrders()
    reloadTeam()
    refreshClientEvents()
    refreshClientTasks()
    refreshRecapShares()
    refreshDoneTasksCount()
    refreshRecurringPrograms()
    refreshCare()
    refreshBrandLinks()
  }, [refresh, refreshAppointments, refreshNotes, refreshFollowups, refreshRecommendations, refreshInteractions, reloadOrders, reloadTeam, refreshClientEvents, refreshClientTasks, refreshRecapShares, refreshDoneTasksCount, refreshRecurringPrograms, refreshCare, refreshBrandLinks]))
  const [activeTab, setActiveTab]       = useState<Tab>('synthese')
  const [messageOpen, setMessageOpen]   = useState(false)
  // RÉCAP-5D §5 — vue de détail strictement lecture seule (jamais MessageModal, voir audit) :
  // le partage sélectionné pour consultation, ou null si aucune modale ouverte.
  const [recapShareDetail, setRecapShareDetail] = useState<AppointmentRecapShare | null>(null)
  const [actionBusy, setActionBusy]     = useState(false)
  const [actionError, setActionError]   = useState<string | null>(null)
  // ACTION-OUTCOME-1 / P1.1 — relance ciblée par "Action prioritaire" en cours de clôture :
  // ouvre le même FollowupCompletionModal que les pages Relances (contact/globale), jamais un
  // second chemin de clôture direct pour cette action.
  const [completingFollowup, setCompletingFollowup] = useState<Followup | null>(null)
  const [actingFollowup, setActingFollowup] = useState<Followup | null>(null)
  const [showRescheduleCal, setShowRescheduleCal]   = useState(false)
  const [rescheduleBusyDays, setRescheduleBusyDays] = useState<CalendarBusyAppointment[]>([])
  const [rescheduleDuration, setRescheduleDuration] = useState(60)
  const [phoneCopied, setPhoneCopied]   = useState(false)
  const [timelineKindFilter,   setTimelineKindFilter]   = useState<'all' | TimelineKind>('all')
  const [timelineStatusFilter, setTimelineStatusFilter] = useState<TimelineStatusFilter>('all')
  const [timelinePeriodFilter, setTimelinePeriodFilter] = useState<string | null>(null) // 'YYYY-MM' ou null = toute période
  const [openTimelineFilter, setOpenTimelineFilter] = useState<'type' | 'status' | 'period' | null>(null)
  const [timelineFilterPos, setTimelineFilterPos] = useState<{ x: number; y: number } | null>(null)
  const [noteDraft, setNoteDraft]                 = useState('')
  const [noteSaving, setNoteSaving]                 = useState(false)
  const [noteDeleteConfirmId, setNoteDeleteConfirmId] = useState<string | null>(null)
  const [apptNoteTags, setApptNoteTags] = useState<Record<string, string[]>>({})
  // Décision #7 "Protéger les données sensibles" : masqué par défaut, jamais révélé
  // automatiquement — remis à zéro à chaque montage de l'écran (pas de persistance).
  const [expectationsEditing, setExpectationsEditing] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  // UI-POPOVER-2 — position capturée au clic sur "⋮" (même mécanisme que quickMorePos
  // ci-dessous), pour ancrer le menu au lieu de l'ancienne feuille inférieure systématique.
  const [moreMenuPos, setMoreMenuPos] = useState({ x: 0, y: 0 })
  const [quickMoreOpen, setQuickMoreOpen] = useState(false)
  // ACTION-2.1 — position d'ancrage du menu compact web, capturée au clic sur "+" (mêmes
  // pageX/pageY que le Hover Preview de l'agenda, jamais utilisée sur mobile).
  const [quickMorePos, setQuickMorePos] = useState({ x: 0, y: 0 })
  const [showShareProfile, setShowShareProfile] = useState(false)
  // PROFILE-SHARE-1 — composeur "Partager ma fiche" : sélection temporaire des sections
  // (jamais persistée). `null` = pas encore touché par l'utilisateur → sélection par défaut
  // (§4), devient un booléen concret dès le premier clic — même idiome que RÉCAP-3/6.
  const [shareIncludeAppointmentsOverride, setShareIncludeAppointmentsOverride] = useState<boolean | null>(null)
  const [shareIncludeOrdersOverride, setShareIncludeOrdersOverride] = useState<boolean | null>(null)
  const [shareIncludeNextAppointmentOverride, setShareIncludeNextAppointmentOverride] = useState<boolean | null>(null)
  // Vrai prochain RDV du contact (réutilise la brique "tier 2" de RÉCAP-6 —
  // fetchUpcomingAppointmentsForClient — puisqu'il n'existe aucun RDV "source" à ce niveau
  // fiche contact ; jamais une relance/tâche/date proposée non enregistrée).
  const [shareNextAppointment, setShareNextAppointment] = useState<{ startAt: string; appointmentType: string } | null>(null)
  useEffect(() => {
    if (!showShareProfile) {
      // §17 — reset complet à la fermeture, aucune persistance temporaire ne survit.
      setShareIncludeAppointmentsOverride(null)
      setShareIncludeOrdersOverride(null)
      setShareIncludeNextAppointmentOverride(null)
      setShareNextAppointment(null)
      return
    }
    fetchUpcomingAppointmentsForClient(id, '').then(list => {
      const soonest = list[0]
      setShareNextAppointment(soonest ? { startAt: soonest.start_at, appointmentType: soonest.appointment_type } : null)
    }).catch(() => setShareNextAppointment(null))
  }, [showShareProfile, id])
  const [showPhotoSheet, setShowPhotoSheet] = useState(false)
  const [photoSheetPos, setPhotoSheetPos] = useState({ x: 0, y: 0 })
  const [showPhotoUrl, setShowPhotoUrl]     = useState(false)
  const [photoUrlDraft, setPhotoUrlDraft]   = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [gravatarFailed, setGravatarFailed] = useState(false)
  const { isModuleActive, getRoleLabel, getPipelineStageLabel, getLrpName, profile: businessProfile } = useAppConfig()
  const showBrandName = businessProfile.activity_type === 'multi'
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { width: screenW, height: screenH } = useWindowDimensions()
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

  // Ressource exacte représentée par le bandeau "Prochaine action"/"Action prioritaire" —
  // comparaison sur (source, id réel de la ligne gagnante en base), jamais sur le type seul :
  // next_action_source_id est l'id exact de la ligne appointments/followups/interactions
  // choisie par le trigger refresh_client_activity (migration 20260712_contact_activity_summary,
  // vérifié par audit avant CONTACT-4.1) — deux RDV en retard existent, un seul est prioritaire.
  const isCurrentNextAction = (source: 'appointment' | 'followup' | 'interaction', sourceId: string) =>
    client.next_action_source === source && client.next_action_source_id === sourceId

  // CONTACT-4 — bloc "Autres actions" (CONTACT-4.1 : anciennement "À traiter") : actions
  // concrètes (RDV/relance/interaction) en retard ou dues aujourd'hui, lues directement dans
  // les données déjà chargées par la fiche (jamais next_action_* comme filtre d'inclusion, qui
  // ne retient qu'UNE seule action gagnante et masquerait les autres — voir audit
  // DASH-1.1/CONTACT-4). Dédupliquée par ressource, jamais par type : deux RDV en retard pour
  // ce même contact doivent apparaître comme deux lignes distinctes — CONTACT-4.1 exclut
  // uniquement LA ressource déjà représentée par "Action prioritaire" (isCurrentNextAction),
  // jamais tout un type.
  type TodoKind = 'rdv' | 'relance' | 'interaction'
  interface TodoItem { id: string; kind: TodoKind; urgency: TodoUrgency; date: string; onPress: () => void }
  const todoItems: TodoItem[] = []
  for (const appt of appointments) {
    if (appt.status !== 'scheduled' && appt.status !== 'rescheduled') continue
    if (isCurrentNextAction('appointment', appt.id)) continue
    const urgency = urgencyOf(appt.start_at)
    if (!urgency) continue
    todoItems.push({
      id: `rdv-${appt.id}`, kind: 'rdv', urgency, date: appt.start_at,
      onPress: () => router.push(`/(app)/appointments/${appt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any),
    })
  }
  for (const f of followups) {
    if (f.done || f.cancelled_at) continue
    if (isCurrentNextAction('followup', f.id)) continue
    const urgency = urgencyOf(f.due_date)
    if (!urgency) continue
    todoItems.push({
      // CONTACT-4.2 — focus=<id exact> pour que la page Relances mette en évidence CETTE
      // ressource précise, jamais une simple ouverture de la liste générale.
      id: `relance-${f.id}`, kind: 'relance', urgency, date: f.due_date,
      onPress: () => router.push(`/(app)/clients/${id}/followups?focus=${f.id}`),
    })
  }
  for (const item of interactions) {
    if (item.completed_at || !item.scheduled_at) continue
    if (isCurrentNextAction('interaction', item.id)) continue
    const urgency = urgencyOf(item.scheduled_at)
    if (!urgency) continue
    todoItems.push({
      id: `interaction-${item.id}`, kind: 'interaction', urgency, date: item.scheduled_at,
      onPress: () => router.push(`/(app)/clients/${id}/interactions?focus=${item.id}`),
    })
  }
  // Plus ancien/plus urgent d'abord — un retard est toujours chronologiquement avant tout
  // élément "aujourd'hui", donc un simple tri par date suffit (pas de score de priorité).
  todoItems.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // CONTACT-RDV-TASKS/P3 — délibérément SÉPARÉ de todoItems ci-dessus plutôt qu'un 4ᵉ TodoKind :
  // todoItems/urgencyOf ne retient que retard/aujourd'hui (§ audit, TodoUrgency = 'overdue'|
  // 'today'), alors qu'une tâche prévue demain doit rester visible ici (§16 du brief — jamais
  // perdue simplement parce qu'elle n'est pas encore due, ni parce qu'elle n'a pas de due_at).
  // next_action_* n'inclut jamais les tâches (audit confirmé) : aucune exclusion de type
  // isCurrentNextAction n'est donc nécessaire ici, une tâche ne peut jamais déjà être
  // représentée par "Action prioritaire".
  // Origine RDV résolue via les RDV déjà chargés sur cette page (appointments) — jamais une
  // requête par tâche (§13 du brief, 0 N+1).
  // `Map` (classe native) est masqué dans ce fichier par l'icône lucide-react-native du même
  // nom (import ligne 35) : objet indexé simple à la place, même effet, aucune ambiguïté.
  const apptStartById: Record<string, string> = {}
  for (const a of appointments) apptStartById[a.id] = a.start_at
  const activeClientTaskItems = clientTasks
    .map(tk => ({
      id: tk.id,
      title: tk.title,
      dueAt: tk.due_at,
      appointmentId: tk.appointment_id,
      appointmentDate: tk.appointment_id ? apptStartById[tk.appointment_id] ?? null : null,
      overdue: !!tk.due_at && urgencyOf(tk.due_at) === 'overdue',
      today: !!tk.due_at && urgencyOf(tk.due_at) === 'today',
    }))
    // En retard/dates croissantes d'abord (§14/§15) ; les tâches sans due_at (§16, jamais
    // perdues) se retrouvent en dernier plutôt que de fausser le tri par une date inventée.
    .sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0
      if (!a.dueAt) return 1
      if (!b.dueAt) return -1
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
    })

  const TODO_KIND_LABEL_KEY: Record<TodoKind, string> = {
    rdv: 'clients.next_action_source_appointment',
    relance: 'clients.next_action_source_followup',
    interaction: 'clients.next_action_source_interaction',
  }

  // ── Activité = historique : uniquement ce qui s'est passé (ACTIVITY-HISTORY-1) ──
  // Le prévu (RDV à venir, relances à faire) vit dans l'onglet Suivi.
  const endOfToday = (() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime() })()
  const isPast = (iso: string | null | undefined) => !!iso && new Date(iso).getTime() <= endOfToday
  // Libellé d'un rôle dans le vocabulaire de ses marques ("Partenaire · Zinzino").
  const eventRoleLabel = (role: string) => {
    const brandRole = role === 'distributor' ? 'partner' : role === 'leader' ? 'leader' : role === 'customer' ? 'customer' : role === 'prospect' ? 'prospect' : null
    const matches = brandRole ? brandLinks.filter(l => l.network_role === brandRole) : []
    if (matches.length === 0) return getRoleLabel(role as any)
    return matches.map(l => `${brandRoleLabel(l.brand, l.network_role, getRoleLabel)}${showBrandName ? ` · ${l.brand.name}` : ''}`).join(', ')
  }
  const timelineEntries: TimelineEntry[] = [
    ...appointments.filter(appt => appt.status !== 'scheduled' && appt.status !== 'rescheduled' ? true : isPast(appt.start_at)).map(appt => ({
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
    ...followups.filter(f => f.done).map(f => ({
      id: `relance-${f.id}`,
      date: f.updated_at ?? f.due_date,
      title: f.title ?? f.content ?? t('followups.title'),
      // Relance faite : date de réalisation visible (c'est elle qui compte comme "dernier contact"
      // dans la Synthèse), la ligne restant classée à son échéance.
      sub: t('followups.done'),
      kind: 'relance' as const,
      statusCategory: (f.done ? 'done' : 'pending') as 'done' | 'pending',
      // NAV-FOCUS-1 — chaque ligne d'Activité représente une relance précise (f.id déjà
      // disponible), jamais une simple ouverture générique de la liste.
      onPress: () => router.push(`/(app)/clients/${id}/followups?focus=${f.id}`),
    })),
    ...recommendations.filter(r => isPast(r.recommendation_date ?? r.created_at)).map(r => ({
      id: `reco-${r.id}`,
      date: r.recommendation_date ?? r.created_at,
      title: r.product_name,
      // Une recommandation annulée reste visible dans l'historique (Activité raconte ce qui
      // s'est réellement passé) mais ne doit jamais apparaître comme "en attente".
      sub: r.cancelled_at ? t('recommendations.cancelled') : (r.reason ?? t(`recommendations.${r.status}`)),
      // ACTION-OUTCOME-1 / P2 §16 — même liste déjà chargée (select('*')), aucune requête
      // supplémentaire ; extrait affiché uniquement si un retour existe réellement (§15).
      preview: !r.cancelled_at && r.client_feedback ? r.client_feedback : undefined,
      kind: 'reco' as const,
      statusCategory: (r.cancelled_at ? 'cancelled' : r.status === 'advised' ? 'pending' : 'done') as 'done' | 'pending' | 'cancelled',
      onPress: () => router.push(`/(app)/clients/${id}/recommendations`),
    })),
    ...orders.filter(o => isPast(o.order_date)).map(o => ({
      id: `commande-${o.id}`,
      date: o.order_date,
      title: o.product_name,
      sub: o.amount != null ? `${o.amount.toFixed(0)}€` : undefined,
      kind: 'commande' as const,
      onPress: () => router.push(`/(app)/clients/${id}/orders`),
    })),
    ...interactions.filter(item => !!item.completed_at || isPast(item.scheduled_at ?? item.created_at)).map(item => ({
      id: `interaction-${item.id}`,
      date: item.completed_at ?? item.scheduled_at ?? item.created_at,
      title: item.subject ?? t(`interaction_types.${item.interaction_type}`),
      // ACTION-OUTCOME-1 / P0 §22 — le résultat rejoint le type dans le même badge existant
      // (jamais un nouvel élément visuel) uniquement s'il existe réellement.
      sub: item.completed_at && item.completion_result
        ? `${t(`interaction_types.${item.interaction_type}`)} · ${t(`interaction_outcomes.${item.completion_result}`)}`
        : t(`interaction_types.${item.interaction_type}`),
      preview: item.completed_at && item.notes_brutes ? item.notes_brutes : undefined,
      kind: 'interaction' as const,
      statusCategory: (item.completed_at ? 'done' : 'pending') as 'done' | 'pending',
      // NAV-FOCUS-1 — chaque ligne d'Activité représente une interaction précise (item.id
      // déjà disponible), jamais une simple ouverture générique de la liste.
      onPress: () => router.push(`/(app)/clients/${id}/interactions?focus=${item.id}`),
    })),
    // Traçabilité (refonte) — automatique et non modifiable : jamais cliquable.
    ...clientEvents.filter(ev => ev.event_type !== 'pipeline_change'
      || ev.new_value === 'lost'
      || (!!ev.new_value && PIPELINE_STAGES.indexOf(ev.new_value as any) < PIPELINE_STAGES.indexOf('customer'))).map(ev => {
      let title = ''
      let sub: string | undefined
      if (ev.event_type === 'pipeline_change') {
        title = t('clients.history_status_now', { status: getPipelineStageLabel(ev.new_value as any) })
      } else if (ev.event_type === 'role_change') {
        const roles = (ev.new_value ?? '').split(',').filter(Boolean)
        const main = roles.includes('leader') ? 'leader' : roles.includes('distributor') ? 'distributor' : roles.includes('customer') ? 'customer' : roles[0] ?? 'prospect'
        title = t('clients.history_status_now', { status: eventRoleLabel(main) })
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
        isStatus: ev.event_type === 'pipeline_change' || ev.event_type === 'role_change',
        kind: 'changement' as const,
        onPress: () => {},
      }
    }),
    // RÉCAP-5D — "partage initié" uniquement (jamais "envoyé"/"livré"/"reçu", voir la migration
    // append-only 20260824_appointment_recap_shares.sql). Participe au même tri chronologique
    // que le reste (pas de section séparée). preview = début du message_snapshot, cohérent avec
    // le même mécanisme déjà utilisé pour interactions/recommandations ci-dessus. appointment_id
    // peut être null (RDV supprimé, §9) : le snapshot texte reste affichable tel quel, jamais de
    // tentative de navigation vers un RDV disparu — onPress ouvre uniquement la vue de détail
    // lecture seule, jamais une navigation vers le RDV.
    ...recapShares.map(share => ({
      id: `recap_share-${share.id}`,
      date: share.created_at,
      title: t('clients.recap_share_title', { channel: t(`clients.recap_share_channel_${share.channel}`) }),
      sub: t('clients.recap_share_sub', { date: formatDate(share.created_at, locale), time: formatTime(share.created_at) }),
      preview: share.message_snapshot,
      kind: 'recap_share' as const,
      onPress: () => setRecapShareDetail(share),
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .filter(statusDedupe())

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

  function openReschedule() {
    setShowRescheduleCal(true)
    setRescheduleDuration(60)
    const from = new Date().toISOString()
    const to = new Date(Date.now() + 90 * 86400000).toISOString()
    fetchBusyAppointments(from, to).then(setRescheduleBusyDays).catch(() => setRescheduleBusyDays([]))
    if (client?.next_action_source === 'appointment' && client.next_action_source_id) {
      fetchAppointmentById(client.next_action_source_id).then(appt => {
        if (appt) setRescheduleDuration(Math.round((new Date(appt.end_at).getTime() - new Date(appt.start_at).getTime()) / 60000))
      }).catch(() => {})
    }
  }

  function handleRescheduleConfirm(dateStr: string, time?: string, durationMinutes?: number) {
    if (!client) return
    const [y, m, d] = dateStr.split('-').map(Number)
    const [hh, mm] = (time ?? '09:00').split(':').map(Number)
    const newDateTime = new Date(y, m - 1, d, hh, mm, 0, 0)
    runNextAction(() => rescheduleNextAction(client, newDateTime, durationMinutes))
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

  function openEmail(email: string) {
    Linking.openURL(`mailto:${email}`)
  }

  // CLIENT-TZ-1 (point 1) — appeler / écrire la nuit chez le contact : prévenir avant.
  function guarded(label: string, run: () => void) {
    if (contactLocalTime?.unsocial) setGuardAction({ label, run })
    else run()
  }

  // Réutilise le bucket Storage "avatars" déjà en place pour les photos de profil
  // praticien (voir settings-identity.tsx), avec un préfixe distinct pour ne pas
  // entrer en collision avec "<user_id>.jpg".
  async function uploadAvatarImage(uri: string) {
    setUploadingAvatar(true)
    setActionError(null)
    try {
      if (!session) return
      const blob = await (await fetch(uri)).blob()
      const path = `${session.user.id}/clients/${id}.jpg`
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


  // ── Bloc "Prochaine action" du hero — priorité visuelle maximale (décision refonte
  // Écran 3 : "Action primaire... bouton le plus visible") ────────────────────────
  const nextActionDays = client.next_action_at ? daysUntil(client.next_action_at) : null
  // NEXT-ACTION-URGENCY-1 — "prioritaire" seulement si en retard ou aujourd'hui ; une action
  // dans 3 jours est "bientôt", au-delà c'est simplement "la prochaine action", affichée au calme.
  const nextActionUrgency: 'overdue' | 'today' | 'soon' | 'later' =
    nextActionDays === null ? 'later'
      : nextActionDays < 0 ? 'overdue'
      : nextActionDays === 0 ? 'today'
      : nextActionDays <= 3 ? 'soon'
      : 'later'
  const NEXT_ACTION_COLOR = {
    overdue: { fg: colors.danger,  bg: colors.dangerLight,  border: colors.danger },
    today:   { fg: colors.warning, bg: colors.warningLight + '66', border: colors.warning },
    soon:    { fg: colors.primary, bg: colors.primaryLight, border: colors.primary },
    later:   { fg: colors.primary, bg: colors.card,         border: colors.border },
  }
  const nextActionColor = NEXT_ACTION_COLOR[nextActionUrgency]
  // COLOR-RULE-1 — les boutons restent bleus ; seul le retard les passe en rouge.
  const nextActionBtnColor = nextActionUrgency === 'overdue' ? colors.danger : colors.primary
  // SUIVI-GROUPS-1 — RDV : passé non clôturé (à débriefer), à venir, passés/clôturés.
  const apptGroups = (() => {
    const nowMs = Date.now()
    const isOpen = (a: typeof appointments[number]) => a.status === 'scheduled' || a.status === 'rescheduled'
    const byStartAsc = (a: typeof appointments[number], b: typeof appointments[number]) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    return {
      toDebrief: appointments.filter(a => isOpen(a) && new Date(a.end_at).getTime() < nowMs).sort(byStartAsc),
      upcoming: appointments.filter(a => isOpen(a) && new Date(a.end_at).getTime() >= nowMs).sort(byStartAsc),
      past: appointments.filter(a => !isOpen(a)).sort((a, b) => byStartAsc(b, a)),
    }
  })()
  // Relances : à faire (échéance la plus proche d'abord), terminées ou annulées (récentes d'abord).
  const followupGroups = {
    todo: followups.filter(f => !f.done && !f.cancelled_at).sort((a, b) => a.due_date.localeCompare(b.due_date)),
    done: followups.filter(f => f.done || f.cancelled_at).sort((a, b) => b.due_date.localeCompare(a.due_date)),
  }
  // RDV-PHASE-1 — moment du RDV mis en avant : avant / en cours (30 min avant → fin) / passé.
  const nextActionAppt = client.next_action_source === 'appointment'
    ? appointments.find(a => a.id === client.next_action_source_id) ?? null
    : null
  // refresh_client_activity remplit next_action_type par 'call' pour une relance sans type :
  // pour une relance, seule la relance elle-même fait foi.
  const nextActionFollowup = client.next_action_source === 'followup'
    ? followups.find(f => f.id === client.next_action_source_id) ?? null
    : null
  const nextActionType = client.next_action_source === 'followup' ? nextActionFollowup?.action_type ?? null : client.next_action_type
  const nextActionSubtitle = nextActionAppt?.title ?? nextActionFollowup?.title ?? null
  const contactFirstName = client.first_name ?? client.full_name
  const nextFollowupKind = nextActionFollowup ? followupActionKind(nextActionFollowup) : null
  const nextFollowupAwaiting = nextActionFollowup ? awaitingReplyLabel(nextActionFollowup, contactFirstName, t) : null
  const appointmentPhase: 'before' | 'live' | 'after' | null = nextActionAppt
    ? (() => {
        const nowMs = Date.now()
        const startMs = new Date(nextActionAppt.start_at).getTime()
        const endMs = new Date(nextActionAppt.end_at).getTime()
        if (nowMs > endMs) return 'after'
        if (nowMs >= startMs - 30 * 60000) return 'live'
        return 'before'
      })()
    : null
  const meetingUrl = nextActionAppt
    ? meetingActionUrl(nextActionAppt.meeting_mode, { location: nextActionAppt.location, meetingUrl: nextActionAppt.meeting_url, phone: client.phone })
    : null
  const NEXT_ACTION_HEADING_KEY = {
    overdue: 'clients.action_heading_overdue',
    today:   'clients.action_heading_today',
    soon:    'clients.action_heading_soon',
    later:   'clients.action_heading_later',
  } as const
  const NEXT_ACTION_LABEL_KEY = {
    overdue: 'clients.next_action_overdue',
    today:   'clients.next_action_today_label',
    soon:    'clients.next_action_title',
    later:   'clients.next_action_planned',
  } as const

  // ── Synthèse : jusqu'à 3 échéances les plus proches, tous domaines confondus ──
  // Exclut l'élément déjà mis en avant dans le bandeau "Prochaine action" (colonne gauche)
  // pour ne pas le répéter ici — isCurrentNextAction déclarée plus haut (réutilisée par
  // CONTACT-4.1 pour "Autres actions"). Une recommandation ne peut jamais être la "prochaine
  // action" (NextActionSource ne contient pas 'recommendation'), donc openReco n'a pas besoin
  // de cette exclusion.
  const upcomingItems: { key: string; kind: TimelineKind; categoryLabel: string; title: string; date: string; onPress: () => void }[] = []
  if (future[0] && !isCurrentNextAction('appointment', future[0].id)) {
    upcomingItems.push({
      key: 'rdv', kind: 'rdv', categoryLabel: t('clients.next_rdv'),
      title: future[0].title, date: future[0].start_at,
      onPress: () => router.push(`/(app)/appointments/${future[0].id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any),
    })
  }
  const nextFollowup = followups
    .filter(f => !f.done && !f.cancelled_at)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0]
  if (nextFollowup && !isCurrentNextAction('followup', nextFollowup.id)) {
    upcomingItems.push({
      key: 'relance', kind: 'relance', categoryLabel: t('clients.tab_followups'),
      title: nextFollowup.title ?? nextFollowup.content ?? t('followups.title'), date: nextFollowup.due_date,
      // NAV-FOCUS-1 — ressource précise cliquée : transmet l'id exact (contrat CONTACT-4.2),
      // jamais une simple ouverture générique de la liste.
      onPress: () => router.push(`/(app)/clients/${id}/followups?focus=${nextFollowup.id}`),
    })
  }
  // Recommandation "active" = convention déjà utilisée ailleurs dans l'app (voir la même
  // règle dans appointments/[id]/index.tsx pour la révision de clôture) : status === 'advised'
  // ET jamais annulée. Une recommandation annulée ne doit jamais redevenir "à venir".
  const activeRecommendations = recommendations.filter(r => r.status === 'advised' && !r.cancelled_at)
  const openReco = activeRecommendations
    .slice()
    .sort((a, b) => new Date(b.recommendation_date ?? b.created_at).getTime() - new Date(a.recommendation_date ?? a.created_at).getTime())[0]
  if (openReco) {
    upcomingItems.push({
      key: 'reco', kind: 'reco', categoryLabel: t('clients.tab_reco'),
      title: openReco.product_name, date: openReco.recommendation_date ?? openReco.created_at,
      onPress: () => router.push(`/(app)/clients/${id}/recommendations`),
    })
  }
  // LRP-4 — une entrée PAR programme récurrent réellement actif (recurring_programs, source de
  // vérité), jamais sur une ancienne next_lrp_date de client. Un contact avec plusieurs
  // programmes actifs voit chacune de ses échéances, jamais une seule fusionnée arbitrairement.
  // LRP-4.2 §5/§6 — même règle métier unique qu'alertService/useDashboard/network, jamais
  // redupliquée : exclut un programme end_date dépassée même si son statut DB n'a pas encore
  // été normalisé à 'completed'.
  const todayIso = new Date().toISOString().split('T')[0]
  if (isModuleActive('renewals_lrp')) {
    for (const program of recurringPrograms.filter(p => isProgramEligibleForNextOccurrence(p, todayIso))) {
      // LRP-4.1 §12 — 2+ programmes actifs doivent rester distinguables ("Abonnement —
      // Nutrition" vs "Abonnement — Sport"), jamais deux entrées identiques "Abonnement".
      const programLabel = formatProgramTitle(getLrpName(), program.label)
      // LRP-5 §22 — le titre affiche le statut de l'ÉCHÉANCE (prévue/à confirmer), jamais une
      // commande future qui n'existe pas encore : program.next_occurrence_date reflète
      // désormais la table recurring_program_occurrences, à ce stade toujours 'scheduled' côté
      // DB (sinon le calendrier aurait déjà avancé) — seule la date suffit à dériver l'affichage.
      const occurrenceStatusLabel = t(`recurring_program.occurrence_status_${deriveOccurrenceDisplayStatus(
        { status: 'scheduled', scheduled_date: program.next_occurrence_date as string }, program.status, todayIso,
      )}`)
      upcomingItems.push({
        key: `lrp-${program.id}`, kind: 'lrp', categoryLabel: programLabel,
        title: occurrenceStatusLabel, date: program.next_occurrence_date as string,
        onPress: () => router.push(`/(app)/recurring-programs/${program.id}` as any),
      })
    }
  }

  // Résumé "copie de mes données" (RGPD) — uniquement des informations client-facing par
  // nature, jamais les notes internes/objections/santé (Décision #7). Une recommandation
  // annulée est devenue caduque : elle ne doit jamais être proposée au contact.
  // PROFILE-SHARE-1 §5 — aucune limite n'existait auparavant sur les RDV (audit confirmé) :
  // résumé court retenu (5 derniers RDV terminés), cohérent avec §7 (5 dernières commandes).
  const shareRecentAppointments = appointments
    .filter(a => a.status === 'completed')
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
    .slice(0, 5)
  const shareHasAppointments = shareRecentAppointments.length > 0
  // §6/§7 — source exclusive : orders (déjà chargées sur cette fiche via useClientOrders, aucune
  // requête supplémentaire). 5 plus récentes par date, cancelled/returned inclus dans la fenêtre
  // (§10/§11) mais jamais présentées comme actives.
  const shareRecentOrders = orders
    .slice()
    .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())
    .slice(0, 5)
  const shareHasOrders = shareRecentOrders.length > 0
  const shareHasNextAppointment = !!shareNextAppointment

  const shareIncludeAppointments = shareIncludeAppointmentsOverride ?? true
  const shareIncludeOrders = shareIncludeOrdersOverride ?? shareHasOrders
  const shareIncludeNextAppointment = shareIncludeNextAppointmentOverride ?? shareHasNextAppointment

  const shareOrdersText = (shareIncludeOrders && shareHasOrders)
    ? formatOrdersForClientSummary(shareRecentOrders.map(o => ({
        dateLabel: formatDate(o.order_date, locale),
        isCancelled: !!o.cancelled_at,
        isReturned: o.status === 'returned',
        // ORDER-BUSINESS-4.2.1 §1/§4 — order_items réels en priorité (lecture groupée ci-dessus,
        // returnedQty exact) ; repli deriveOrderLines centralisé pour une commande sans lignes
        // structurées (returnedQty=0, jamais deviné) — même fonction hybride officielle que
        // partout ailleurs, jamais reconstruite ici.
        lines: hybridLinesFromItems(o, orderItemsByOrderId[o.id]).map(p => ({ label: p.name, quantity: p.qty, returnedQty: p.returnedQty })),
        total: o.amount,
      })))
    : null

  const shareProfileTemplate = buildClientSummaryTemplate({
    interests: client.interests ?? [],
    appointments: shareIncludeAppointments
      ? shareRecentAppointments.map(a => ({ dateLabel: formatDate(a.start_at, locale), typeLabel: t(`appointment_types.${a.appointment_type}` as any) }))
      : [],
    recommendations: recommendations.filter(r => !r.cancelled_at).map(r => ({ productName: r.product_name })),
    ordersText: shareOrdersText,
    nextAppointment: (shareIncludeNextAppointment && shareNextAppointment)
      ? {
          dateLabel: formatDate(shareNextAppointment.startAt, locale),
          timeLabel: formatTime(shareNextAppointment.startAt),
          typeLabel: t(`appointment_types.${shareNextAppointment.appointmentType}` as any),
        }
      : null,
  })

  // §3/§19 — bloc compact, une case par section, jamais affichée si aucune donnée correspondante
  // n'existe (§3). Aucune checkbox pour une donnée interne (§20 — ce composant ne lit que
  // appointments/orders/shareNextAppointment, jamais notes/pipeline/relances/tâches).
  const shareProfileSelector = (
    <View style={styles.shareOptionsCard}>
      <Text style={styles.shareOptionsTitle}>{t('clients.share_profile_options_title')}</Text>
      {shareHasAppointments ? (
        <TouchableOpacity style={styles.shareOptionRow} onPress={() => setShareIncludeAppointmentsOverride(!shareIncludeAppointments)} activeOpacity={0.75}>
          <View style={[styles.shareOptionCheckbox, shareIncludeAppointments && { backgroundColor: colors.success, borderColor: colors.success }]}>
            {shareIncludeAppointments && <Check size={12} color="#fff" strokeWidth={3} />}
          </View>
          <Text style={styles.shareOptionLabel}>{t('clients.share_profile_option_appointments')}</Text>
        </TouchableOpacity>
      ) : null}
      {shareHasOrders ? (
        <TouchableOpacity style={styles.shareOptionRow} onPress={() => setShareIncludeOrdersOverride(!shareIncludeOrders)} activeOpacity={0.75}>
          <View style={[styles.shareOptionCheckbox, shareIncludeOrders && { backgroundColor: colors.success, borderColor: colors.success }]}>
            {shareIncludeOrders && <Check size={12} color="#fff" strokeWidth={3} />}
          </View>
          <Text style={styles.shareOptionLabel}>{t('clients.share_profile_option_orders')}</Text>
        </TouchableOpacity>
      ) : null}
      {shareHasNextAppointment ? (
        <TouchableOpacity style={styles.shareOptionRow} onPress={() => setShareIncludeNextAppointmentOverride(!shareIncludeNextAppointment)} activeOpacity={0.75}>
          <View style={[styles.shareOptionCheckbox, shareIncludeNextAppointment && { backgroundColor: colors.success, borderColor: colors.success }]}>
            {shareIncludeNextAppointment && <Check size={12} color="#fff" strokeWidth={3} />}
          </View>
          <Text style={styles.shareOptionLabel}>{t('clients.share_profile_option_next_appointment')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )

  // ── Métriques Suivi — une seule donnée fiable mise en avant par carte ────────
  // Interactions : uniquement complétées, jamais une interaction future présentée comme
  // "dernière" (scheduled_at seul est ambigu — voir audit métier).
  const lastCompletedInteraction = interactions
    .filter(i => i.completed_at != null)
    .slice()
    .sort((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime())[0]
  // LRP-4.6 §6 — même définition officielle que useOrders.totalAmount/useMonthlyRevenue
  // (isOrderNetRevenue), jamais une variante locale redupliquée : exclut commandes
  // personnelles (auto-consommation MLM), annulées et retournées du périmètre net.
  const validCustomerOrders = orders.filter(isOrderNetRevenue)
  const validOrdersWithAmount = validCustomerOrders.filter(o => o.amount != null)
  const validOrdersTotal = validOrdersWithAmount.reduce((sum, o) => sum + (o.amount ?? 0), 0)
  const validOrdersMissingAmount = validCustomerOrders.length - validOrdersWithAmount.length

  // DESIGN-B — taux de remplissage du profil (incitation douce, jamais bloquant).
  const profileChecks = [
    client.phone, client.email, client.birth_date, client.profession, client.address, client.source,
    (client.interests ?? []).length > 0 ? 'x' : null,
    client.expectation_goals, client.expectation_habits, client.contact_preference,
  ]
  const profileCompletion = Math.round((profileChecks.filter(Boolean).length / profileChecks.length) * 100)

  // Identité, prochaine action, KPI, actions rapides — regroupés une seule fois ici pour
  // pouvoir être rendus soit dans la colonne latérale persistante (desktop), soit en tête
  // du fil unique (mobile), sans dupliquer le JSX.
  const heroSection = (
    <>
          {/* ── Hero (compact) ───────────────────────────────────── */}
          <View style={styles.hero}>
            <View style={styles.heroTopRow}>
              <TouchableOpacity
                onPress={(e) => { setPhotoSheetPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); setShowPhotoSheet(true) }}
                activeOpacity={0.85}
                style={styles.avatarWrap}
                accessibilityLabel={t('clients.change_photo')}
              >
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
                <View style={styles.heroNameRow}>
                  <Text style={styles.heroName} numberOfLines={1}>{client.full_name}</Text>
                  {showBrandName && brandLinks.length > 0 ? (
                    <View style={styles.heroBrandMarks}>
                      {brandLinks.map(link => <BrandAvatar key={link.id} brand={link.brand} size={20} />)}
                    </View>
                  ) : null}
                </View>
                <View style={styles.heroBadges}>
                  {/* DESIGN-A — même règle que la liste : l'état du suivi ne s'affiche que s'il
                      appelle une attention ("À jour" se confondait avec le vert du rôle Client). */}
                  {health.tier !== 'up_to_date' ? (
                    <View style={[styles.heroPill, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.heroPillText, { color: sc.text }]}>
                        {t(`relationship_health.${health.tier}`).toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                  {client.is_vip ? (
                    <View style={[styles.heroPill, { backgroundColor: statusColors.vip.bg }]}>
                      <Text style={[styles.heroPillText, { color: statusColors.vip.text }]}>
                        {t('clients.vip_badge').toUpperCase()}
                      </Text>
                    </View>
                  ) : null}
                  {/* Le rôle "customer" (Client) doit s'afficher comme n'importe quel autre
                      rôle (Prospect, Distributeur...) — il était auparavant exclu ici, laissant
                      un contact purement "Client" sans aucune pastille de rôle à côté de la
                      santé relationnelle ("À JOUR"), contrairement à tous les autres profils. */}
                  {/* BRAND-ROLES-1 — avec des marques, les rôles réseau s'affichent par marque
                      ("Conseillère · doTERRA") au lieu d'un rôle global unique. */}
                  {client.contact_role
                    .filter(role => brandLinks.length === 0 || (role !== 'customer' && role !== 'prospect' && !(NETWORK_ROLES as readonly string[]).includes(role)))
                    .map(role => {
                      const rc = getRoleColors(role, colors)
                      return (
                        <View key={role} style={[styles.heroPill, { backgroundColor: rc.bg }]}>
                          <Text style={[styles.heroPillText, { color: rc.text }]}>
                            {getRoleLabel(role).toUpperCase()}
                          </Text>
                        </View>
                      )
                    })}
                  {brandLinks.map(l => {
                    const rc = getRoleColors(l.network_role === 'leader' ? 'leader' : l.network_role === 'partner' ? 'distributor' : l.network_role === 'prospect' ? 'prospect' : 'customer', colors)
                    return (
                      <View key={l.id} style={[styles.heroPill, { backgroundColor: rc.bg }]}>
                        <Text style={[styles.heroPillText, { color: rc.text }]}>
                          {`${brandRoleLabel(l.brand, l.network_role, getRoleLabel)}${showBrandName ? ` · ${l.brand.name}` : ''}`.toUpperCase()}
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
                  {/* DESIGN-B — l'étape du parcours commercial remplace l'ancienne carte "Parcours"
                      de la Synthèse : une pastille neutre suffit. */}
                  {/* STATUS-1 — l'étape ne s'affiche que pour un prospect (ou un contact perdu) :
                      pour un client ou un partenaire, elle doublonnerait le rôle. */}
                  {client.pipeline_stage && (client.pipeline_stage === 'lost'
                    || PIPELINE_STAGES.indexOf(client.pipeline_stage) < PIPELINE_STAGES.indexOf('customer')) ? (
                    <View style={[styles.heroPill, { backgroundColor: colors.surfaceContainerHighest, maxWidth: 160 }]}>
                      <Text style={[styles.heroPillText, { color: colors.textSecondary }]} numberOfLines={1}>
                        {getPipelineStageLabel(client.pipeline_stage).toUpperCase()}
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
                onPress={(e) => { setMoreMenuPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); setMoreMenuOpen(true) }}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={t('common.more_options')}
              >
                <Text style={styles.heroMoreIcon}>⋮</Text>
              </TouchableOpacity>
            </View>

            {/* DESIGN-B — coordonnées essentielles sans changer d'onglet. */}
            {/* CONTACT-BLOCK-1 — mini bloc coordonnées : téléphone et email sur leur ligne,
                l'heure chez le contact en dessous, séparée. */}
            {client.phone || client.email || contactLocalTime ? (
              <View style={styles.contactBlock}>
                {client.phone ? (
                  <TouchableOpacity style={styles.contactLine} onPress={() => Linking.openURL(`tel:${client.phone!.replace(/\s+/g, '')}`).catch(e => console.error('[hero.tel]', e))} activeOpacity={0.7}>
                    <Text style={styles.contactIcon}>📞</Text>
                    <Text style={styles.contactText} numberOfLines={1}>{client.phone}</Text>
                  </TouchableOpacity>
                ) : null}
                {client.email ? (
                  <TouchableOpacity style={styles.contactLine} onPress={() => Linking.openURL(`mailto:${client.email}`).catch(e => console.error('[hero.mail]', e))} activeOpacity={0.7}>
                    <Text style={styles.contactIcon}>✉️</Text>
                    <Text style={styles.contactText} numberOfLines={1}>{client.email}</Text>
                  </TouchableOpacity>
                ) : null}
                {contactLocalTime ? (
                  <View style={[styles.contactLine, (client.phone || client.email) ? styles.contactTimeLine : null]}>
                    <Text style={styles.contactIcon}>{contactLocalTime.unsocial ? '🌙' : '🕒'}</Text>
                    <Text style={styles.contactTime} numberOfLines={1}>
                      {t('clients.tz_live', {
                        time: contactLocalTime.time,
                        name: client.first_name || client.full_name.split(' ')[0],
                        city: contactLocalTime.city,
                      })}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}
            <Text style={styles.heroAddedOn} numberOfLines={1}>
              {t('clients.added_on', { date: formatDate(client.created_at, locale) })}
            </Text>

            {/* ── Prochaine action — priorité visuelle maximale ────── */}
            {/* CONTACT-4.1 §3 — sur-titre discret rendant explicite que cette carte représente
                LA ressource prioritaire (distincte de "Autres actions" plus bas) ; réutilise la
                typographie existante (même famille que todoBlockTitle), aucun nouveau header. */}
            {client.next_action_source && (
              <Text style={[styles.priorityActionTitle, (nextActionUrgency === 'overdue' || nextActionUrgency === 'today') && { color: nextActionColor.fg }]}>
                {t(NEXT_ACTION_HEADING_KEY[nextActionUrgency])}
              </Text>
            )}
            {client.next_action_source ? (
              <View style={[styles.nextActionBlock, { backgroundColor: nextActionColor.bg, borderColor: nextActionColor.border }]}>
                <TouchableOpacity
                  style={styles.nextActionTopRow}
                  disabled={!nextActionAppt}
                  onPress={() => nextActionAppt && router.push(`/(app)/appointments/${nextActionAppt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.nextActionIconBox, { backgroundColor: nextActionUrgency === 'later' ? colors.primaryLight : colors.card, borderColor: nextActionColor.border + '55' }]}>
                    {(() => {
                      const NextIcon = nextActionType ? NEXT_ACTION_ICON[nextActionType] : client.next_action_source === 'followup' ? Bell : Clock
                      return <NextIcon size={19} color={nextActionColor.fg} strokeWidth={2} />
                    })()}
                  </View>
                  <View style={styles.nextActionTextBlock}>
                    {nextActionUrgency === 'soon' || nextActionUrgency === 'later' ? (
                      <Text style={[styles.nextActionLabel, { color: nextActionColor.fg }]}>
                        {t(NEXT_ACTION_LABEL_KEY[nextActionUrgency])}
                      </Text>
                    ) : null}
                    <Text style={styles.nextActionMainText} numberOfLines={2}>
                      {nextActionType ? t(`next_action_types.${nextActionType}`) : t(`clients.next_action_source_${client.next_action_source}`)}
                      {nextActionSubtitle ? <Text style={styles.nextActionSubTitle}> · {nextActionSubtitle}</Text> : null}
                    </Text>
                    {client.next_action_at ? (
                      <Text style={styles.nextActionMeta}>
                        {nextActionAppt ? <Text style={styles.nextActionTime}>{formatTime(nextActionAppt.start_at)}</Text> : null}
                        {nextActionAppt ? '  ' : ''}
                        {nextActionUrgency === 'today'
                          ? relativeDayLabel(client.next_action_at, t)
                          : `${formatDate(client.next_action_at, locale)} · ${relativeDayLabel(client.next_action_at, t)}`}
                      </Text>
                    ) : null}
                    {nextActionAppt ? (
                      <View style={{ marginTop: 4 }}>
                        <RemoteTimeBadge at={new Date(nextActionAppt.start_at)} contactTz={client.timezone} showCity />
                      </View>
                    ) : null}
                  </View>
                </TouchableOpacity>
                {nextActionAppt && appointmentPhase !== 'after' ? (
                  // RDV-PHASE-1 — avant le RDV : on l'ouvre pour le préparer ; le jour J (30 min
                  // avant → fin) : l'action du mode en un geste. "Terminer et débriefer" n'arrive
                  // qu'une fois l'heure de fin passée.
                  <View style={styles.nextActionBtnRow}>
                    {appointmentPhase === 'live' && meetingUrl ? (
                      <TouchableOpacity
                        style={[styles.nextActionBtnPrimary, { backgroundColor: nextActionBtnColor }]}
                        onPress={() => guarded(t(`appointments.meeting_action_${nextActionAppt.meeting_mode}`), () => {
                          Linking.openURL(meetingUrl).catch(e => console.error('[nextAction.meeting]', e))
                        })}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.nextActionBtnPrimaryText}>
                          {MEETING_MODE_ICON[nextActionAppt.meeting_mode!]} {t(`appointments.meeting_action_${nextActionAppt.meeting_mode}`)}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.nextActionBtnPrimary, { backgroundColor: nextActionBtnColor }]}
                        onPress={() => router.push(`/(app)/appointments/${nextActionAppt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.nextActionBtnPrimaryText}>{t('appointments.open_appointment')}</Text>
                      </TouchableOpacity>
                    )}
                    {appointmentPhase === 'live' && meetingUrl ? (
                      <TouchableOpacity
                        style={[styles.nextActionBtnSecondary, { borderColor: nextActionBtnColor }]}
                        onPress={() => router.push(`/(app)/appointments/${nextActionAppt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.nextActionBtnSecondaryText, { color: nextActionBtnColor }]}>{t('appointments.open_appointment')}</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        disabled={actionBusy}
                        style={[styles.nextActionBtnSecondary, { borderColor: nextActionBtnColor }]}
                        onPress={openReschedule}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.nextActionBtnSecondaryText, { color: nextActionBtnColor }]}>{t('clients.postpone_action')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : nextActionAppt ? (
                  <>
                    <View style={styles.nextActionBtnRow}>
                      <TouchableOpacity
                        style={[styles.nextActionBtnPrimary, { backgroundColor: nextActionBtnColor }]}
                        onPress={() => router.push(`/(app)/appointments/${nextActionAppt.id}?debrief=1&returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.nextActionBtnPrimaryText}>{t('clients.debrief_action')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.nextActionBtnSecondary, { borderColor: nextActionBtnColor }]}
                        onPress={() => router.push(`/(app)/appointments/${nextActionAppt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.nextActionBtnSecondaryText, { color: nextActionBtnColor }]}>{t('appointments.open_appointment')}</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity disabled={actionBusy} onPress={openReschedule} style={styles.nextActionLink} hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}>
                      <Text style={styles.nextActionLinkText}>{t('clients.postpone_action')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                <>
                {nextFollowupAwaiting ? <Text style={styles.nextActionMeta}>{nextFollowupAwaiting}</Text> : null}
                {nextActionFollowup && nextFollowupKind ? (
                  <View style={styles.nextActionBtnRow}>
                    <TouchableOpacity
                      disabled={actionBusy}
                      style={[styles.nextActionBtnPrimary, { backgroundColor: nextActionBtnColor }, actionBusy && { opacity: 0.6 }]}
                      onPress={() => setActingFollowup(nextActionFollowup)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.nextActionBtnPrimaryText}>{followupActionLabel(nextActionFollowup, t)}</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                <View style={styles.nextActionBtnRow}>
                  {nextFollowupKind !== 'reply' ? (
                  <TouchableOpacity
                    disabled={actionBusy}
                    style={[
                      nextFollowupKind ? styles.nextActionBtnSecondary : styles.nextActionBtnPrimary,
                      nextFollowupKind ? { borderColor: nextActionBtnColor } : { backgroundColor: nextActionBtnColor },
                      actionBusy && { opacity: 0.6 },
                    ]}
                    onPress={() => {
                      // ACTION-OUTCOME-1 / P1.1 — une action prioritaire "relance" ouvre
                      // désormais le même FollowupCompletionModal que les pages Relances
                      // (contact/globale), jamais une clôture directe. La relance exacte est
                      // retrouvée via next_action_source_id dans les followups déjà chargés
                      // par useClientFollowups (aucun nouvel appel réseau nécessaire).
                      if (client.next_action_source === 'followup') {
                        // Aucun repli vers completeNextAction pour une relance (P1.1) : si la
                        // relance ciblée est introuvable dans les données déjà chargées (état
                        // incohérent), on affiche une erreur plutôt que de clôturer en silence
                        // hors modale.
                        const targetFollowup = client.next_action_source_id
                          ? followups.find(f => f.id === client.next_action_source_id)
                          : undefined
                        if (targetFollowup) setCompletingFollowup(targetFollowup)
                        else setActionError(t('common.error'))
                        return
                      }
                      // Pour un rendez-vous : jamais de complétion directe depuis la fiche
                      // Contact — navigation vers la fiche RDV, où le débrief est confirmé
                      // PUIS le RDV complété (RDV déjà completed : débrief affiché en lecture,
                      // aucune nouvelle complétion tentée). Pour une interaction : comportement
                      // P0 inchangé (complétion rapide sans modale, hors périmètre P1/P1.1).
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
                      : <Text style={nextFollowupKind ? [styles.nextActionBtnSecondaryText, { color: nextActionBtnColor }] : styles.nextActionBtnPrimaryText}>
                          {client.next_action_source === 'appointment' ? t('clients.finish_action_debrief') : t('clients.finish_action')}
                        </Text>}
                  </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    disabled={actionBusy}
                    style={[styles.nextActionBtnSecondary, { borderColor: nextActionBtnColor }]}
                    onPress={openReschedule}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.nextActionBtnSecondaryText, { color: nextActionBtnColor }]}>{t('clients.postpone_action')}</Text>
                  </TouchableOpacity>
                </View>
                </>
                )}
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

          </View>

          {/* ── Actions rapides (ACTION-2) ───────────────────────── */}
          {/* Appeler n'a de sens que sur mobile (isDesktopWeb masqué) ; Email seulement sur
              desktop web (un numéro décroché n'a pas d'équivalent web fiable — voir audit). Le
              reste (WhatsApp, RDV, Relance) est commun aux deux plateformes. Tous les handlers
              réutilisent des mécanismes déjà existants sur cette fiche (nextActionService,
              openEmail, routes appointments/new et clients/[id]/followups déjà utilisées
              ailleurs sur cet écran) — aucune nouvelle logique de communication ou de création. */}
          <View style={styles.secondaryActions}>
            {client.phone && !isDesktopWeb ? (
              <TouchableOpacity style={styles.saBtn} onPress={() => guarded(t('clients.call_action'), () => callContact(client.phone!))} activeOpacity={0.8}>
                <LineIcon name="phone" size={16} color={colors.text} strokeWidth={2} />
                <Text style={styles.saLabel}>{t('clients.call_action')}</Text>
              </TouchableOpacity>
            ) : null}
            {client.phone ? (
              <TouchableOpacity style={styles.saBtn} onPress={() => guarded('WhatsApp', () => openWhatsApp(client.phone!))} activeOpacity={0.8}>
                <LineIcon name="whatsapp" size={16} color={colors.text} strokeWidth={2} />
                <Text style={styles.saLabel}>WhatsApp</Text>
              </TouchableOpacity>
            ) : null}
            {client.email && isDesktopWeb ? (
              <TouchableOpacity style={styles.saBtn} onPress={() => guarded(t('clients.fields.email'), () => openEmail(client.email!))} activeOpacity={0.8}>
                <Mail size={16} color={colors.text} strokeWidth={2} />
                <Text style={styles.saLabel}>{t('clients.fields.email')}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.saBtn}
              onPress={() => router.push(`/(app)/appointments/new?clientId=${id}&returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
              activeOpacity={0.8}
            >
              <Calendar size={16} color={colors.text} strokeWidth={2} />
              <Text style={styles.saLabel}>{t('clients.tab_rdv')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saBtn}
              onPress={() => router.push(`/(app)/clients/${id}/followups` as any)}
              activeOpacity={0.8}
            >
              <Bell size={16} color={colors.text} strokeWidth={2} />
              <Text style={styles.saLabel}>{t('clients.tab_followups')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saBtn}
              onPress={(e) => {
                // UI-POPOVER-2.1 — position désormais capturée sur toutes les plateformes
                // (plus seulement desktop web) : le menu est ancré partout, jamais une feuille.
                setQuickMorePos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })
                setQuickMoreOpen(true)
              }}
              activeOpacity={0.8}
            >
              <LineIcon name="plus" size={16} color={colors.text} strokeWidth={2} />
              <Text style={styles.saLabel}>{t('clients.quick_more')}</Text>
            </TouchableOpacity>
          </View>

          {/* ── CARE-JOURNEY-1 : accompagnement (étapes = relances, voir features/care) ── */}
          <CareJourneyCard
            client={client}
            userId={session?.user.id ?? ''}
            advisorName={session?.user?.user_metadata?.full_name ?? session?.user?.email ?? ''}
            journey={careJourney}
            steps={careSteps}
            onCompleteStep={setCompletingFollowup}
            onChanged={() => { refreshCare(); refresh(); refreshFollowups() }}
          />

          {/* ── CONTACT-4.1 : "Autres actions" — le reste des actions concrètes en
              retard/aujourd'hui, hors ressource déjà représentée par "Action prioritaire"
              ci-dessus (isCurrentNextAction) ── */}
          {todoItems.length > 0 ? (
            <View style={styles.todoBlockWrap}>
              <View style={styles.todoBlock}>
                <Text style={styles.todoBlockTitle}>{t('clients.other_actions_title')} · {todoItems.length}</Text>
                {todoItems.slice(0, 3).map(item => {
                  const urgColor = item.urgency === 'overdue' ? NEXT_ACTION_COLOR.overdue : NEXT_ACTION_COLOR.today
                  const kindLabel = t(TODO_KIND_LABEL_KEY[item.kind])
                  const text = item.urgency === 'overdue'
                    ? `${kindLabel} ${t('clients.next_action_overdue').toLowerCase()} · ${relativeDayLabel(item.date, t)}`
                    : `${kindLabel} ${t('clients.timeline_today').toLowerCase()}`
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.todoRow}
                      onPress={item.onPress}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('common.open')} ${text}`}
                    >
                      <Text style={styles.todoRowEmoji}>{item.urgency === 'overdue' ? '🔴' : '🟠'}</Text>
                      <Text style={[styles.todoRowText, { color: urgColor.fg }]} numberOfLines={1}>{text}</Text>
                      <OpenActionLink label={t('common.open')} interactive={false} />
                    </TouchableOpacity>
                  )
                })}
                {todoItems.length > 3 ? (
                  <Text style={styles.todoMore}>+{todoItems.length - 3} {t('dashboard.other_actions')}</Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* ── CONTACT-RDV-TASKS/P3 : "Tâches à faire" — appointment_tasks actives liées à ce
              contact, visibles et actionnables sans retrouver le RDV source. Section distincte
              de "Autres actions" (Option B retenue après audit, cf. rapport) : les tâches ne
              partagent ni le filtre strict retard/aujourd'hui, ni next_action_* (qui ne les
              inclut jamais). Masquée si aucune tâche active (§34 — pas de section vide). ── */}
          {activeClientTaskItems.length > 0 ? (
            <View style={styles.todoBlockWrap}>
              <View style={styles.todoBlock}>
                <Text style={styles.todoBlockTitle}>{t('clients.tasks_todo_title')} · {activeClientTaskItems.length}</Text>
                {activeClientTaskItems.map(item => {
                  const metaParts: string[] = []
                  if (item.overdue) metaParts.push(t('clients.next_action_overdue'))
                  else if (item.today) metaParts.push(t('clients.timeline_today'))
                  else if (item.dueAt) metaParts.push(relativeDayLabel(item.dueAt, t))
                  if (item.appointmentDate) {
                    metaParts.push(`${t('clients.tab_rdv')} ${formatDate(item.appointmentDate, locale, { day: '2-digit', month: 'short' })}`)
                  }
                  return (
                    <View key={item.id} style={styles.clientTaskRow}>
                      <CompleteToggle
                        done={false}
                        onPress={() => handleCompleteClientTask(item.id)}
                        activeLabel={t('clients.finish_action')}
                        doneLabel={t('followups.done')}
                        accessibilityLabel={`${t('clients.finish_action')} — ${item.title}`}
                        accentColor={item.overdue ? colors.danger : undefined}
                      />
                      <View style={styles.clientTaskInfo}>
                        <Text style={styles.clientTaskTitle} numberOfLines={2}>{item.title}</Text>
                        {metaParts.length > 0 ? (
                          <Text style={[styles.clientTaskMeta, item.overdue && { color: colors.danger }]} numberOfLines={1}>
                            {metaParts.join(' · ')}
                          </Text>
                        ) : null}
                      </View>
                      {item.appointmentId ? (
                        <OpenActionLink
                          label={t('common.open')}
                          onPress={() => router.push(`/(app)/appointments/${item.appointmentId}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                          accessibilityLabel={`${t('common.open')} ${item.title}`}
                        />
                      ) : null}
                    </View>
                  )
                })}
              </View>
            </View>
          ) : null}

          {/* TASK-RDV-1 §10/§11 — traçabilité des tâches terminées : secondaire, repliée par
              défaut, jamais affichée si aucune tâche terminée n'existe (§10 — pas de section
              vide). Un clic sur une tâche terminée la rouvre via la même fonction métier que la
              fiche RDV (§11 — aucune logique séparée). */}
          {doneTasksCount > 0 ? (
            <View style={styles.todoBlockWrap}>
              <TouchableOpacity style={styles.doneTasksToggle} onPress={toggleDoneTasksSection} activeOpacity={0.75}>
                <Text style={styles.doneTasksToggleText}>
                  {t('clients.tasks_done_title')} ({doneTasksCount}) {showDoneTasks ? '▴' : '▾'}
                </Text>
              </TouchableOpacity>
              {showDoneTasks ? (
                <View style={styles.todoBlock}>
                  {doneTasksLoading ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    doneClientTasks.map(tk => {
                      const appointmentDate = tk.appointment_id ? apptStartById[tk.appointment_id] ?? null : null
                      return (
                        <View key={tk.id} style={styles.clientTaskRow}>
                          <CompleteToggle
                            done
                            onPress={() => handleReopenClientTask(tk.id)}
                            activeLabel={t('clients.finish_action')}
                            doneLabel={t('followups.done')}
                            accessibilityLabel={`${t('appointments.task_reopen_action')} — ${tk.title}`}
                            accessibilityHint={t('appointments.task_reopen_action')}
                          />
                          <View style={styles.clientTaskInfo}>
                            <Text style={[styles.clientTaskTitle, styles.timelineTitleDone]} numberOfLines={2}>{tk.title}</Text>
                            {appointmentDate ? (
                              <Text style={styles.clientTaskMeta} numberOfLines={1}>
                                {t('clients.tab_rdv')} {formatDate(appointmentDate, locale, { day: '2-digit', month: 'short' })}
                              </Text>
                            ) : null}
                          </View>
                          {tk.appointment_id ? (
                            <OpenActionLink
                              label={t('common.open')}
                              onPress={() => router.push(`/(app)/appointments/${tk.appointment_id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                              accessibilityLabel={`${t('common.open')} ${tk.title}`}
                            />
                          ) : null}
                        </View>
                      )
                    })
                  )}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ── Actions rapides — menu "+" (ACTION-2 / ACTION-2.1 / UI-POPOVER-2.1) ─── */}
          {/* UI-POPOVER-2.1 — même conteneur ancré sur toutes les plateformes désormais (plus
              de feuille inférieure spécifique mobile) ; seul le CONTENU reste conditionnel par
              plateforme (SMS/Email n'ont de sens que sur mobile, "Copier le téléphone" remplace
              ces intents natifs absents sur desktop web) — logique métier inchangée. */}
          <AnchoredMenu
            visible={quickMoreOpen}
            onClose={() => setQuickMoreOpen(false)}
            anchor={quickMorePos}
            width={QUICK_MENU_W}
            estimatedHeight={QUICK_MENU_EST_H}
            items={[
              ...(!isDesktopWeb && client.phone ? [{
                key: 'sms', label: t('clients.quickbar_sms'),
                icon: <LineIcon name="message" size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => setMessageOpen(true),
              }] : []),
              ...(!isDesktopWeb && client.email ? [{
                key: 'email', label: t('clients.fields.email'),
                icon: <Mail size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => openEmail(client.email!),
              }] : []),
              ...(isDesktopWeb && client.phone ? [{
                key: 'copy-phone', label: t('clients.copy_phone'),
                icon: <LineIcon name="copy" size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => copyPhone(client.phone!),
              }] : []),
              {
                key: 'note', label: t('clients.quickbar_add_note'),
                icon: <FileText size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => setActiveTab('chrono'),
              },
              {
                key: 'reco', label: t('clients.tab_reco'),
                icon: <Leaf size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => router.push(`/(app)/clients/${id}/recommendations` as any),
              },
              {
                key: 'orders', label: t('clients.tab_orders'),
                icon: <ShoppingCart size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => router.push(`/(app)/clients/${id}/orders` as any),
              },
              {
                key: 'edit', label: t('clients.edit_action'),
                icon: <LineIcon name="edit" size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => router.push(`/(app)/clients/${id}/edit` as any),
              },
            ]}
          />

          {/* ── Menu "Plus" (feuille inférieure) ─────────────────── */}
          <AnchoredMenu
            visible={moreMenuOpen}
            onClose={() => setMoreMenuOpen(false)}
            anchor={moreMenuPos}
            items={[
              {
                key: 'edit', label: t('clients.edit_action'),
                icon: <LineIcon name="edit" size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => router.push(`/(app)/clients/${id}/edit` as any),
              },
              {
                key: 'share', label: t('clients.share_profile_action'),
                icon: <LineIcon name="shield" size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => setShowShareProfile(true),
              },
              ...(isDesktopWeb && client.phone ? [{
                key: 'meet', label: 'Meet',
                icon: <LineIcon name="video" size={18} color={colors.text} strokeWidth={2} />,
                onPress: openMeet,
              }] : []),
            ]}
          />

          {/* ── Photo de contact (feuille inférieure) ────────────── */}
          <AnchoredMenu
            visible={showPhotoSheet}
            onClose={() => setShowPhotoSheet(false)}
            anchor={photoSheetPos}
            title={t('clients.change_photo')}
            items={[
              ...(Platform.OS !== 'web' ? [{
                key: 'camera', label: t('clients.photo_camera'),
                icon: <Camera size={18} color={colors.text} strokeWidth={2} />,
                onPress: pickCamera,
              }] : []),
              {
                key: 'library', label: t('clients.photo_library'),
                icon: <ImageIcon size={18} color={colors.text} strokeWidth={2} />,
                onPress: pickLibrary,
              },
              {
                key: 'url', label: t('clients.photo_url'),
                icon: <LinkIcon size={18} color={colors.text} strokeWidth={2} />,
                onPress: () => { setActionError(null); setShowPhotoUrl(true) },
              },
            ]}
          />

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
          <BackButton onPress={goBack} label={t('clients.profile_title')} />
        </View>

        <View style={[styles.bodyRow, isDesktopWeb && styles.bodyRowDesktop]}>

          {/* ── Colonne latérale persistante (desktop uniquement) ─── */}
          {isDesktopWeb && (
            // Colonne défilante indépendante : son contenu (accompagnement déplié, tâches…) peut
            // dépasser la hauteur de l'écran.
            <ScrollView
              style={styles.desktopSidebar}
              contentContainerStyle={styles.desktopSidebarContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.sidebarPanel}>
                {heroSection}
              </View>
            </ScrollView>
          )}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.scrollContent, isDesktopWeb && styles.scrollContentDesktop]}
            showsVerticalScrollIndicator={false}
            // DESIGN-B — barre d'onglets figée en haut au défilement. Toujours l'index 1 : sur
            // mobile l'en-tête du contact la précède ; sur desktop web, react-native-web compte
            // aussi l'enfant `false` de `{!isDesktopWeb && heroSection}` (React.Children.map).
            stickyHeaderIndices={[1]}
          >

          {!isDesktopWeb && heroSection}
          {/* ── Tab bar ──────────────────────────────────────────── */}
          <View style={styles.tabStickyWrap}>
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
                {tab.key === 'profil' && profileCompletion < 100 ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{t('clients.profile_completion', { percent: profileCompletion })}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
          </View>

          {/* ── Tab content ──────────────────────────────────────── */}
          <View style={styles.tabContent}>

            {/* ─ Synthèse ─ */}
            {/* DESIGN-B — Synthèse : "où en est cette personne ?" en un coup d'œil. L'étape du
                parcours commercial est désormais une pastille de l'en-tête. */}
            {activeTab === 'synthese' && (
              <ContactSynthesis
                client={client}
                orders={validCustomerOrders}
                orderItemsByOrderId={orderItemsByOrderId}
                recommendations={recommendations}
                notes={notes}
                interactions={interactions}
                appointments={appointments}
                recurringPrograms={recurringPrograms}
                followups={followups}
                brandNames={Object.fromEntries(brandLinks.map(l => [l.brand_id, l.brand.name]))}
                showPrograms={isModuleActive('renewals_lrp')}
                isDesktop={isDesktopWeb}
                onEditExpectations={() => { setActiveTab('profil'); setExpectationsEditing(true) }}
                onAddOrder={() => router.push(`/(app)/clients/${id}/orders` as any)}
                onPlanAppointment={() => router.push(`/(app)/appointments/new?clientId=${id}&returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                onAddNote={() => setActiveTab('chrono')}
                onOpenHistory={() => setActiveTab('chrono')}
                upcoming={upcomingItems.length > 0 ? (
                  <View style={styles.card}>
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
                      <TouchableOpacity
                        key={item.key}
                        style={styles.addressRow}
                        onPress={item.onPress}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('common.open')} ${item.title}`}
                      >
                        <View style={[styles.fieldIconBox, { backgroundColor: itemColor.bg }]}><ItemIcon size={15} color={itemColor.text} strokeWidth={2} /></View>
                        <View style={styles.addressTextBlock}>
                          <Text style={styles.fieldLabel}>{item.categoryLabel.toUpperCase()}</Text>
                          <Text style={styles.fieldValue} numberOfLines={1}>{item.title} · {fmtShort(item.date, locale)}</Text>
                        </View>
                        <OpenActionLink label={t('common.open')} interactive={false} />
                      </TouchableOpacity>
                      )
                    })}
                  </View>
                ) : null}
              />
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
                <Text style={styles.noteComposerHint}>{t('clients.history_note_hint')}</Text>

                {/* ── Barre de filtres compacte ─────────────────────────── */}
                <View style={styles.timelineFilterBar}>
                  <TouchableOpacity style={styles.timelineFilterBtn} onPress={(e) => { setTimelineFilterPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); setOpenTimelineFilter('type') }} activeOpacity={0.75}>
                    <Text style={styles.timelineFilterBtnLabel}>{t('clients.timeline_filter_type')}</Text>
                    <Text style={styles.timelineFilterBtnValue} numberOfLines={1}>
                      {timelineKindFilter === 'all' ? t('clients.filter_all') : t(TIMELINE_KIND_LABEL_KEY[timelineKindFilter])}
                    </Text>
                    <Text style={styles.timelineFilterChevron}>▾</Text>
                  </TouchableOpacity>
                  {timelineAvailableMonths.length > 0 && (
                    <TouchableOpacity style={styles.timelineFilterBtn} onPress={(e) => { setTimelineFilterPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }); setOpenTimelineFilter('period') }} activeOpacity={0.75}>
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

                {/* Le prévu est dans Suivi : un simple raccourci ici. */}
                {(() => {
                  const upcoming = apptGroups.upcoming.length + followupGroups.todo.length
                  return upcoming > 0 ? (
                    <TouchableOpacity style={styles.historyUpcomingLink} onPress={() => setActiveTab('suivi')} activeOpacity={0.75}>
                      <Text style={styles.historyUpcomingText}>{t('clients.history_upcoming', { count: upcoming })}</Text>
                      <Text style={styles.historyUpcomingCta}>{t('clients.history_upcoming_cta')} ›</Text>
                    </TouchableOpacity>
                  ) : null
                })()}

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
                        const isSystem = entry.kind === 'changement'
                        const isConfirmingNoteDelete = isNote && noteDeleteConfirmId === entry.id
                        const content = (
                          <View style={styles.timelineContent}>
                            <View style={styles.timelineContentTop}>
                              <Text style={[styles.timelineTitle, isSystem && styles.timelineTitleSystem]} numberOfLines={isNote ? undefined : 2}>
                                {entry.title}
                              </Text>
                              <Text style={styles.timelineRelative}>{pastRelativeLabel(entry.date, t)}</Text>
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
                            {entry.preview ? (
                              <Text style={styles.timelinePreview} numberOfLines={2}>{entry.preview}</Text>
                            ) : null}
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
                              {isNote || isSystem ? content : (
                                // UI-AFFORDANCE-1 §14 — Activité est déjà dense (titre + date relative,
                                // date + statut, parfois extrait + tags) : un chevron discret avec un
                                // accessibilityLabel explicite est préféré à un "Ouvrir ›" textuel complet
                                // sur chaque ligne, pour ne pas surcharger visuellement le fil.
                                <TouchableOpacity
                                  style={styles.timelineContentTouchable}
                                  onPress={entry.onPress}
                                  activeOpacity={0.8}
                                  accessibilityRole="button"
                                  accessibilityLabel={`${t('common.open')} ${entry.title}`}
                                >
                                  <View style={{ flex: 1 }}>{content}</View>
                                  <ChevronRight size={16} color={colors.textTertiary} strokeWidth={2} style={styles.timelineChevron} />
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

                {/* ── Sélecteur de filtre : menu ancré, comme le reste de l'app (UI-POPOVER-2.1) ── */}
                {(() => {
                  const check = <Check size={16} color={colors.primaryAction} strokeWidth={2.5} />
                  const items = openTimelineFilter === 'type'
                    ? [
                        { key: 'all', label: t('clients.filter_all'), icon: timelineKindFilter === 'all' ? check : undefined, onPress: () => setTimelineKindFilter('all') },
                        ...timelineAvailableKinds.map(kind => ({
                          key: kind, label: t(TIMELINE_KIND_LABEL_KEY[kind]), icon: timelineKindFilter === kind ? check : undefined, onPress: () => setTimelineKindFilter(kind),
                        })),
                      ]
                    : openTimelineFilter === 'period'
                      ? [
                          { key: 'all', label: t('clients.timeline_filter_period_all'), icon: timelinePeriodFilter === null ? check : undefined, onPress: () => setTimelinePeriodFilter(null) },
                          ...timelineAvailableMonths.map(month => ({
                            key: month, label: monthYearLabel(month, locale), icon: timelinePeriodFilter === month ? check : undefined, onPress: () => setTimelinePeriodFilter(month),
                          })),
                        ]
                      : []
                  return (
                    <AnchoredMenu
                      visible={openTimelineFilter !== null}
                      onClose={() => setOpenTimelineFilter(null)}
                      anchor={timelineFilterPos}
                      width={240}
                      estimatedHeight={Math.min(420, 52 + items.length * 44)}
                      minLeft={isDesktopWeb ? 248 : 8}
                      title={openTimelineFilter === 'period' ? t('clients.timeline_filter_period') : t('clients.timeline_filter_type')}
                      items={items}
                    />
                  )
                })()}
              </View>
            )}

            {/* ─ Suivi ─ */}
            {activeTab === 'suivi' && (
              <View style={styles.suiviGroupsWrap}>
                {/* ── Groupe : À faire ─────────────────────────────────────── */}
                <View style={styles.suiviGroup}>
                  <Text style={styles.suiviGroupTitle}>{t('clients.suivi_group_todo')}</Text>
                  <View style={[styles.tabColumns, isDesktopWeb && styles.tabColumnsDesktop]}>
                    {/* SUIVI-GROUPS-1 — RDV : à débriefer + à venir en cartes pleines ; passés repliés,
                        sur une ligne grisée. Le statut se lit d'un coup d'œil. */}
                    <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                      <View style={styles.cardHeader}>
                        <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}><Calendar size={14} color={colors.primary} strokeWidth={2} /></View>
                        <Text style={styles.cardTitle}>{t('clients.tab_rdv')}</Text>
                        <TouchableOpacity style={styles.suiviViewAllBtn} onPress={() => router.push(`/(app)/clients/${id}/appointments`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                        </TouchableOpacity>
                      </View>
                      {appointments.length > 0 ? (
                        <Text style={styles.suiviCounts}>
                          {[
                            apptGroups.toDebrief.length ? t('clients.suivi_count_debrief', { count: apptGroups.toDebrief.length }) : null,
                            t('clients.suivi_count_upcoming', { count: apptGroups.upcoming.length }),
                            t('clients.suivi_count_past', { count: apptGroups.past.length }),
                          ].filter(Boolean).join(' · ')}
                        </Text>
                      ) : null}
                      {apptGroups.toDebrief.map(appt => {
                        const late = daysUntil(appt.start_at) < 0
                        const tone = late ? colors.danger : colors.warning
                        return (
                        <TouchableOpacity
                          key={appt.id}
                          style={[styles.listCard, styles.listCardAccent, { borderLeftColor: tone }]}
                          onPress={() => router.push(`/(app)/appointments/${appt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                          activeOpacity={0.8}
                        >
                          <View style={styles.listCardLeft}>
                            <View style={styles.apptRowHeader}>
                              <Text style={styles.listCardDate}>{formatDate(appt.start_at, locale)}</Text>
                              <View style={[styles.apptStatusPill, { backgroundColor: tone + '22' }]}>
                                <Text style={[styles.apptStatusPillText, { color: tone }]}>{t('clients.suivi_to_debrief')}</Text>
                              </View>
                            </View>
                            <Text style={styles.listCardSub} numberOfLines={1}>{appt.title}</Text>
                            <TouchableOpacity
                              onPress={() => router.push(`/(app)/appointments/${appt.id}?debrief=1&returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                              hitSlop={{ top: 6, bottom: 6, left: 4, right: 8 }}
                            >
                              <Text style={[styles.debriefCta, { color: tone }]}>{t('clients.debrief_action')} ›</Text>
                            </TouchableOpacity>
                          </View>
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <View style={styles.listCardBadge}>
                              <Text style={styles.listCardBadgeText}>{formatTime(appt.start_at)}</Text>
                            </View>
                            <RemoteTimeBadge at={new Date(appt.start_at)} contactTz={client.timezone} size="xs" />
                          </View>
                        </TouchableOpacity>
                        )
                      })}
                      {apptGroups.upcoming.slice(0, 3).map(appt => {
                        const days = daysUntil(appt.start_at)
                        const rel = days === 0 ? t('clients.rel_today') : days === 1 ? t('clients.rel_tomorrow') : t('clients.rel_in_days', { count: days })
                        return (
                          <TouchableOpacity
                            key={appt.id}
                            style={[styles.listCard, styles.listCardAccent, days === 0 && styles.listCardToday]}
                            onPress={() => router.push(`/(app)/appointments/${appt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.listCardLeft}>
                              <View style={styles.apptRowHeader}>
                                <Text style={styles.listCardDate}>{formatDate(appt.start_at, locale)}</Text>
                                <Text style={styles.relLabel}>{rel}</Text>
                                {/* APPT-BRAND-1 — marque du RDV. */}
                                {(() => { const b = brandLinks.find(l => l.brand_id === appt.brand_id)?.brand; return b ? <BrandPill brand={b} size="sm" /> : null })()}
                              </View>
                              <Text style={styles.listCardSub} numberOfLines={1}>{appt.title}</Text>
                              <Text style={styles.listCardContext} numberOfLines={1}>{t(`appointment_types.${appt.appointment_type}` as any)}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 4 }}>
                              <View style={styles.listCardBadge}>
                                <Text style={styles.listCardBadgeText}>{formatTime(appt.start_at)}</Text>
                              </View>
                              <RemoteTimeBadge at={new Date(appt.start_at)} contactTz={client.timezone} size="xs" />
                            </View>
                          </TouchableOpacity>
                        )
                      })}
                      {appointments.length > 0 && apptGroups.toDebrief.length === 0 && apptGroups.upcoming.length === 0 ? (
                        <Text style={styles.suiviNone}>{t('clients.suivi_no_upcoming_appt')}</Text>
                      ) : null}
                      {apptGroups.past.length > 0 ? (
                        <>
                          <TouchableOpacity style={styles.collapseToggle} onPress={() => setPastApptsOpen(v => !v)} activeOpacity={0.7}>
                            <Text style={styles.collapseToggleText}>{t('clients.suivi_past_toggle', { count: apptGroups.past.length })} {pastApptsOpen ? '▴' : '▾'}</Text>
                          </TouchableOpacity>
                          {pastApptsOpen ? apptGroups.past.slice(0, 8).map(appt => {
                            const icon = appt.status === 'completed' ? '✓' : appt.status === 'cancelled' ? '✕' : appt.status === 'no_show' ? '!' : '•'
                            return (
                              <TouchableOpacity
                                key={appt.id}
                                style={styles.compactRow}
                                onPress={() => router.push(`/(app)/appointments/${appt.id}?returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.compactIcon, appt.status === 'no_show' && { color: colors.warning }]}>{icon}</Text>
                                <Text style={[styles.compactText, appt.status === 'cancelled' && styles.listCardDateStrike]} numberOfLines={1}>
                                  {fmtShort(appt.start_at, locale)} · {appt.title}
                                </Text>
                                <Text style={[styles.compactStatus, appt.status === 'no_show' && { color: colors.warning }]}>{t(`appointment_statuses.${appt.status}` as any)}</Text>
                              </TouchableOpacity>
                            )
                          }) : null}
                        </>
                      ) : null}
                      <TouchableOpacity
                        style={styles.addRowBtn}
                        onPress={() => router.push(`/(app)/appointments/new?clientId=${id}&returnTo=${encodeURIComponent(`/(app)/clients/${id}`)}` as any)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.addRowBtnText}>+ {t('appointments.add')}</Text>
                      </TouchableOpacity>
                    </View>

                    {/* SUIVI-GROUPS-1 — Relances : à faire en haut, terminées repliées en dessous. */}
                    <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                      <View style={styles.cardHeader}>
                        <View style={[styles.iconBox, { backgroundColor: colors.warningLight }]}><Bell size={14} color={colors.warning} strokeWidth={2} /></View>
                        <Text style={styles.cardTitle}>{t('clients.tab_followups')}</Text>
                        <TouchableOpacity style={styles.suiviViewAllBtn} onPress={() => router.push(`/(app)/clients/${id}/followups`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                        </TouchableOpacity>
                      </View>
                      {followups.length > 0 ? (
                        <Text style={styles.suiviCounts}>
                          {t('clients.suivi_count_todo', { count: followupGroups.todo.length })} · {t('clients.suivi_count_done', { count: followupGroups.done.length })}
                        </Text>
                      ) : null}
                      {followupGroups.todo.slice(0, 3).map(f => {
                        const followupUrgency = urgencyOf(f.due_date)
                        return (
                          <TouchableOpacity
                            key={f.id}
                            style={[
                              styles.listCard,
                              styles.listCardAccent,
                              { borderLeftColor: followupUrgency === 'overdue' ? colors.danger : followupUrgency === 'today' ? colors.warning : colors.primary },
                              followupUrgency === 'overdue' && styles.listCardOverdue,
                              followupUrgency === 'today' && styles.listCardToday,
                            ]}
                            // NAV-FOCUS-1 — carte d'une relance précise (f.id), pas "Voir tout".
                            onPress={() => router.push(`/(app)/clients/${id}/followups?focus=${f.id}`)}
                            activeOpacity={0.8}
                          >
                            <View style={styles.listCardLeft}>
                              <Text style={styles.listCardDate}>{fmtShort(f.due_date, locale)}</Text>
                              <Text style={styles.listCardSub} numberOfLines={2}>{f.title ?? f.content}</Text>
                              {f.awaiting_reply_since ? <Text style={styles.listCardSub} numberOfLines={1}>{awaitingReplyLabel(f, contactFirstName, t)}</Text> : null}
                            </View>
                            {followupUrgency ? (
                              <View style={styles.urgencyBadge}>
                                <Text style={[styles.urgencyBadgeText, { color: followupUrgency === 'overdue' ? colors.danger : colors.warning }]}>
                                  {t(followupUrgency === 'overdue' ? 'followups.overdue_badge' : 'followups.today_badge')}
                                </Text>
                              </View>
                            ) : (
                              <Text style={styles.relLabel}>{relativeDayLabel(f.due_date, t)}</Text>
                            )}
                          </TouchableOpacity>
                        )
                      })}
                      {followups.length === 0 || followupGroups.todo.length === 0 ? (
                        <Text style={styles.suiviNone}>{t('followups.none')}</Text>
                      ) : null}
                      {followupGroups.done.length > 0 ? (
                        <>
                          <TouchableOpacity style={styles.collapseToggle} onPress={() => setDoneFollowupsOpen(v => !v)} activeOpacity={0.7}>
                            <Text style={styles.collapseToggleText}>{t('clients.suivi_done_toggle', { count: followupGroups.done.length })} {doneFollowupsOpen ? '▴' : '▾'}</Text>
                          </TouchableOpacity>
                          {doneFollowupsOpen ? followupGroups.done.slice(0, 8).map(f => (
                            <TouchableOpacity key={f.id} style={styles.compactRow} onPress={() => router.push(`/(app)/clients/${id}/followups?focus=${f.id}`)} activeOpacity={0.7}>
                              <Text style={styles.compactIcon}>{f.cancelled_at ? '✕' : '✓'}</Text>
                              <Text style={[styles.compactText, styles.listCardDateStrike]} numberOfLines={1}>
                                {fmtShort(f.due_date, locale)} · {f.title ?? f.content}
                              </Text>
                            </TouchableOpacity>
                          )) : null}
                        </>
                      ) : null}
                      <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/followups`)} activeOpacity={0.7}>
                        <Text style={styles.addRowBtnText}>+ {t('followups.add')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

                {/* ── Groupe : Activité commerciale ────────────────────────── */}
                <View style={styles.suiviGroup}>
                  <Text style={styles.suiviGroupTitle}>{t('clients.suivi_group_activity')}</Text>
                  <View style={[styles.tabColumns, isDesktopWeb && styles.tabColumnsDesktop]}>
                    {/* Interactions */}
                    <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItemThird]}>
                      <View style={styles.cardHeader}>
                        <View style={[styles.iconBox, { backgroundColor: colors.secondaryLight }]}><MessageCircle size={14} color={colors.secondary} strokeWidth={2} /></View>
                        <Text style={styles.cardTitle} numberOfLines={1}>{t('clients.tab_interactions')}</Text>
                        {interactions.length > 0 ? (
                          <View style={styles.sectionCountBadge}><Text style={styles.sectionCountBadgeText}>{interactions.length}</Text></View>
                        ) : null}
                        <TouchableOpacity style={styles.suiviViewAllBtn} onPress={() => router.push(`/(app)/clients/${id}/interactions`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.suiviViewAll} numberOfLines={1}>{t('clients.view_all')}</Text>
                        </TouchableOpacity>
                      </View>
                      {/* Métrique fiable : dernière interaction COMPLÉTÉE uniquement (scheduled_at
                          seul est ambigu — peut être future, passée, ou absent). Toujours affichée,
                          valeur d'abord (date ou "0"), libellé ensuite, pour une hiérarchie homogène
                          avec les autres cartes de ce groupe. */}
                      <View style={styles.suiviMetricBlock}>
                        {lastCompletedInteraction ? (
                          <>
                            <Text style={styles.suiviMetricValue}>{formatDate(lastCompletedInteraction.completed_at!, locale)}</Text>
                            <Text style={styles.suiviMetricLabel}>{t('clients.metric_interactions_label')}</Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.suiviMetricValue}>0</Text>
                            <Text style={styles.suiviMetricLabel}>{t('clients.metric_interactions_zero_label')}</Text>
                          </>
                        )}
                        {interactions.length === 0 ? (
                          <Text style={styles.suiviMetricNote}>{t('clients.metric_interactions_empty_desc')}</Text>
                        ) : null}
                      </View>
                      {interactions.length === 0
                        ? (
                          <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/interactions`)} activeOpacity={0.7}>
                            <Text style={styles.addRowBtnText}>+ {t('interactions.add')}</Text>
                          </TouchableOpacity>
                        )
                        : <>
                          {interactions
                            .slice()
                            .sort((a, b) => new Date(b.scheduled_at ?? 0).getTime() - new Date(a.scheduled_at ?? 0).getTime())
                            .slice(0, 3)
                            .map(item => {
                              const interactionUrgency = (!item.completed_at && item.scheduled_at) ? urgencyOf(item.scheduled_at) : null
                              return (
                                <TouchableOpacity
                                  key={item.id}
                                  style={[
                                    styles.listCard,
                                    !!item.completed_at && styles.listCardDone,
                                    interactionUrgency === 'overdue' && styles.listCardOverdue,
                                    interactionUrgency === 'today' && styles.listCardToday,
                                  ]}
                                  // NAV-FOCUS-1 — carte d'une interaction précise (item.id), pas "Voir tout".
                                  onPress={() => router.push(`/(app)/clients/${id}/interactions?focus=${item.id}`)}
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
                                  {interactionUrgency ? (
                                    <View style={styles.urgencyBadge}>
                                      <Text style={[styles.urgencyBadgeText, { color: interactionUrgency === 'overdue' ? colors.danger : colors.warning }]}>
                                        {t(interactionUrgency === 'overdue' ? 'followups.overdue_badge' : 'followups.today_badge')}
                                      </Text>
                                    </View>
                                  ) : (
                                    <View style={styles.listCardBadge}>
                                      <Text style={styles.listCardBadgeText}>{t(`interaction_types.${item.interaction_type}`)}</Text>
                                    </View>
                                  )}
                                </TouchableOpacity>
                              )
                            })}
                          <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/interactions`)} activeOpacity={0.7}>
                            <Text style={styles.addRowBtnText}>+ {t('interactions.add')}</Text>
                          </TouchableOpacity>
                        </>
                      }
                    </View>

                    {/* Reco */}
                    {isModuleActive('products') && (
                      <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItemThird]}>
                        <View style={styles.cardHeader}>
                          <View style={[styles.iconBox, { backgroundColor: colors.successLight }]}><Leaf size={14} color={colors.success} strokeWidth={2} /></View>
                          <Text style={styles.cardTitle} numberOfLines={1}>{t('clients.tab_reco_short')}</Text>
                          <TouchableOpacity style={styles.suiviViewAllBtn} onPress={() => router.push(`/(app)/clients/${id}/recommendations`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Text style={styles.suiviViewAll} numberOfLines={1}>{t('clients.view_all')}</Text>
                          </TouchableOpacity>
                        </View>
                        {/* Métrique fiable : recommandations actives (status 'advised' ET non
                            annulées) — recommendations.length mélangerait actives/terminées/annulées.
                            Toujours affichée, valeur d'abord (y compris "0"), pour rester homogène
                            avec les autres cartes de ce groupe (jamais masquée derrière un texte à part). */}
                        <View style={styles.suiviMetricBlock}>
                          <Text style={styles.suiviMetricValue}>{activeRecommendations.length}</Text>
                          <Text style={styles.suiviMetricLabel}>{t('clients.metric_pending_label')}</Text>
                          {activeRecommendations.length === 0 ? (
                            <Text style={styles.suiviMetricNote}>{t('clients.metric_recos_empty_desc')}</Text>
                          ) : null}
                        </View>
                        {activeRecommendations.length === 0
                          ? (
                            <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/recommendations`)} activeOpacity={0.7}>
                              <Text style={styles.addRowBtnText}>+ {t('recommendations.add')}</Text>
                            </TouchableOpacity>
                          )
                          : <>
                            {activeRecommendations.slice(0, 3).map(r => (
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
                                <View style={styles.listCardBadge}>
                                  <Text style={styles.listCardBadgeText}>
                                    {t(`recommendations.${r.status}`)}
                                  </Text>
                                </View>
                              </TouchableOpacity>
                            ))}
                            <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/recommendations`)} activeOpacity={0.7}>
                              <Text style={styles.addRowBtnText}>+ {t('recommendations.add')}</Text>
                            </TouchableOpacity>
                          </>
                        }
                      </View>
                    )}

                    {/* Commandes */}
                    <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItemThird]}>
                      <View style={styles.cardHeader}>
                        <View style={[styles.iconBox, { backgroundColor: colors.tertiaryLight }]}><ShoppingCart size={14} color={colors.tertiary} strokeWidth={2} /></View>
                        <Text style={styles.cardTitle} numberOfLines={1}>{t('clients.tab_orders')}</Text>
                        {orders.length > 0 ? (
                          <View style={styles.sectionCountBadge}><Text style={styles.sectionCountBadgeText}>{orders.length}</Text></View>
                        ) : null}
                        <TouchableOpacity style={styles.suiviViewAllBtn} onPress={() => router.push(`/(app)/clients/${id}/orders`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.suiviViewAll} numberOfLines={1}>{t('clients.view_all')}</Text>
                        </TouchableOpacity>
                      </View>
                      {/* LRP-4.6 §5 — la pastille d'en-tête (orders.length, TOUTES les commandes
                          visibles, retour inclus — jamais masqué) et le nombre principal ici
                          affichaient deux totaux différents (ex. "2" vs "1 commande") sans
                          aucune explication : incompréhensible pour l'utilisateur. Le nombre
                          principal est désormais le même total (orders.length) ; seul le
                          montant reste "net" (isOrderNetRevenue), et son libellé le précise
                          explicitement plutôt que de le laisser ambigu. */}
                      <View style={styles.suiviMetricBlock}>
                        <Text style={styles.suiviMetricValue}>{orders.length}</Text>
                        <Text style={styles.suiviMetricLabel}>{t('clients.metric_orders_unit', { plural: pluralS(orders.length) })}</Text>
                        {validCustomerOrders.length > 0 ? (
                          validOrdersMissingAmount > 0 ? (
                            <Text style={styles.suiviMetricNote}>
                              {t('clients.metric_orders_amount_partial', { amount: validOrdersTotal.toFixed(0), count: validOrdersMissingAmount })}
                            </Text>
                          ) : (
                            <Text style={styles.suiviMetricNote}>{t('clients.metric_orders_amount', { amount: validOrdersTotal.toFixed(0) })}</Text>
                          )
                        ) : (
                          <Text style={styles.suiviMetricNote}>{t('clients.metric_orders_empty_desc')}</Text>
                        )}
                      </View>
                      {orders.length === 0
                        ? (
                          <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/orders`)} activeOpacity={0.7}>
                            <Text style={styles.addRowBtnText}>+ {t('orders.add')}</Text>
                          </TouchableOpacity>
                        )
                        : <>
                          {orders
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
                                {/* LRP-4.8 — le badge programme ("LRP — Nutrition"/"LRP historique") a une
                                    longueur variable et imprévisible : le garder dans la même ligne que
                                    la date+le montant (comme avant) réduisait la largeur dispo pour la
                                    date au point de la faire wrapper caractère par caractère dans cette
                                    carte à 3 colonnes, étroite. Il passe donc sous le produit, dans la
                                    colonne gauche (listCardLeft) qui gère déjà l'empilement vertical ;
                                    seul le montant (toujours court) reste sur la colonne de droite. */}
                                <View style={styles.listCardLeft}>
                                  <Text style={styles.listCardDate} numberOfLines={1}>
                                    {formatDate(o.order_date, locale)}
                                  </Text>
                                  <Text style={styles.listCardSub} numberOfLines={1}>{o.product_name}</Text>
                                  {(() => {
                                    const badge = getOrderProgramBadge(o, getLrpName())
                                    if (!badge) return null
                                    return (
                                      <View style={[styles.listCardBadge, { alignSelf: 'flex-start', backgroundColor: badge.kind === 'linked' ? colors.secondaryLight : colors.bgDim }]}>
                                        <Text style={[styles.listCardBadgeText, { color: badge.kind === 'linked' ? colors.secondary : colors.textTertiary }]} numberOfLines={1}>
                                          {badge.kind === 'linked' ? badge.label : t('orders.legacy_program_badge', { name: badge.label })}
                                        </Text>
                                      </View>
                                    )
                                  })()}
                                </View>
                                {o.amount != null ? (
                                  <View style={[styles.listCardBadge, { flexShrink: 0 }]}>
                                    <Text style={styles.listCardBadgeText} numberOfLines={1}>{o.amount.toFixed(0)}€</Text>
                                  </View>
                                ) : null}
                              </TouchableOpacity>
                            ))}
                          <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/orders`)} activeOpacity={0.7}>
                            <Text style={styles.addRowBtnText}>+ {t('orders.add')}</Text>
                          </TouchableOpacity>
                        </>
                      }
                    </View>
                  </View>
                </View>

                {/* ── Groupe : Réseau ──────────────────────────────────────── */}
                {/* referral_count/referrals_count exclus : champs inertes, jamais incrémentés
                    (audit métier) — ne jamais les réintroduire comme KPI. */}
                {(client.network_potential || isNetworkRole) && (
                  <View style={styles.suiviGroup}>
                    <Text style={styles.suiviGroupTitle}>{t('clients.suivi_group_network')}</Text>
                    <View style={[styles.tabColumns, isDesktopWeb && styles.tabColumnsDesktop]}>
                      {/* Équipe — seulement pour un rôle réseau (distributor/leader) */}
                      {isNetworkRole && (
                        <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                          <View style={styles.cardHeader}>
                            <View style={styles.iconBox}><Users size={14} color={colors.textSecondary} strokeWidth={2} /></View>
                            <Text style={styles.cardTitle}>{t('clients.tab_team')}</Text>
                            <TouchableOpacity style={styles.suiviViewAllBtn} onPress={() => router.push(`/(app)/clients/${id}/team` as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                              <Text style={styles.suiviViewAll}>{t('clients.view_all')}</Text>
                            </TouchableOpacity>
                          </View>
                          {/* Métrique fiable : team.length (useDirectTeam), donnée réelle et
                              vivante — jamais referral_count/referrals_count (inertes). Toujours
                              affichée, y compris "0 direct". */}
                          <View style={styles.suiviMetricBlock}>
                            <Text style={styles.suiviMetricValue}>{team.length}</Text>
                            <Text style={styles.suiviMetricLabel}>{t('clients.metric_team_unit', { plural: pluralS(team.length) })}</Text>
                            {team.length === 0 ? (
                              <Text style={styles.suiviMetricNote}>{t('clients.metric_team_empty_desc')}</Text>
                            ) : null}
                          </View>
                          {team.length === 0
                            ? null
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
                          {isModuleActive('downline') ? (
                            <TouchableOpacity
                              style={styles.addRowBtn}
                              onPress={openAddDownline}
                              activeOpacity={0.75}
                            >
                              <Text style={styles.addRowBtnText}>+ {t('network.add_downline')}</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      )}

                      {/* Potentiel réseau — appréciation qualitative volontaire, jamais un score.
                          Affiché aux côtés d'Équipe dès qu'un rôle réseau existe (même non
                          renseigné, état compact dédié) pour éviter la carte Équipe seule en
                          pleine largeur ; affiché seul si network_potential existe sans rôle
                          réseau (contact non distributeur/leader mais noté malgré tout). */}
                      {(isNetworkRole || client.network_potential) ? (
                        <View style={[styles.suiviSection, isDesktopWeb && styles.tabColumnItem]}>
                          <View style={styles.cardHeader}>
                            <View style={[styles.iconBox, { backgroundColor: colors.tertiaryLight }]}>
                              <Globe size={14} color={colors.tertiary} strokeWidth={2} />
                            </View>
                            <Text style={styles.cardTitle}>{t('clients.sections.network')}</Text>
                          </View>
                          <View style={styles.fieldBlock}>
                            <Text style={styles.fieldLabel}>{t('clients.fields.network_potential').toUpperCase()}</Text>
                            <Text style={styles.fieldValue}>
                              {client.network_potential ? t(`network_potentials.${client.network_potential}`) : t('clients.network_potential_unset')}
                            </Text>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* ─ Profil ─ */}
            {activeTab === 'profil' && (
              <View style={[styles.tabColumns, isDesktopWeb && styles.tabColumnsDesktop]}>
                {/* PROFILE-ORDER-1 — ordre : identité, centres d'intérêt, zone sensible, marques,
                    attentes, programme fidélité (pleine largeur, une colonne). */}
                {/* Informations personnelles */}
                <View style={[styles.card, { width: '100%' }]}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{t('clients.sections.personal')}</Text>
                    <TouchableOpacity style={styles.heroMoreBtn} onPress={() => router.push(`/(app)/clients/${id}/edit`)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                      <Text style={styles.heroMoreIcon}>⋮</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.fieldGrid}>
                    {client.email ? (
                      <TouchableOpacity
                        style={styles.fieldGridItem}
                        onPress={() => openEmail(client.email!)}
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
                    {client.timezone ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Text style={{ fontSize: 13 }}>🌍</Text></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.timezone').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>
                            {t('clients.tz_now_there', {
                              city: timeZoneCity(client.timezone),
                              offset: formatUtcOffset(timeZoneOffsetMinutes(client.timezone)),
                              time: new Intl.DateTimeFormat(locale, { timeZone: client.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()),
                            })}
                          </Text>
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

                {/* Centres d'intérêt */}
                <View style={[styles.interestsSection, { width: '100%' }]}>
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

                {/* Zone sensible — antécédents médicaux + particularités : accès explicite,
                    jamais affichée par défaut (décision #7 de la refonte). */}
                <ContactSensitiveCard client={client} onSaved={refresh} />

                {/* BRANDS-1 — Ses marques (origine, numéro de membre par marque). */}
                <View style={{ width: '100%' }}>
                  <ContactBrandsCard
                    clientId={id}
                    userId={session?.user.id ?? ''}
                    links={brandLinks}
                    onChanged={() => { refreshBrandLinks(); refresh() }}
                  />
                </View>

                {/* CONTACT-EXPECTATIONS-1 — Ses attentes. */}
                <View style={{ width: '100%' }}>
                  <ContactExpectationsCard
                    client={client}
                    editing={expectationsEditing}
                    onEditingChange={setExpectationsEditing}
                    onSaved={refresh}
                  />
                </View>

                {/* PROGRAM-BRAND-1 — un bloc par marque (N° membre + programmes, % et notes par
                    programme), programmes sans marque à rattacher, ancien numéro à attribuer. */}
                {isModuleActive('renewals_lrp') || brandLinks.length > 0 ? (
                  <View style={{ width: '100%' }}>
                    <BrandLoyaltySection
                      client={client}
                      links={brandLinks}
                      programs={recurringPrograms}
                      globalProgramName={getLrpName()}
                      onChanged={() => { refresh(); refreshBrandLinks(); refreshRecurringPrograms() }}
                    />
                  </View>
                ) : null}
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
        // EMAIL-EVERYWHERE-1 — le canal E-mail est proposé partout où le contact a une adresse.
        enableEmail
      />

      <MessageModal
        visible={showShareProfile}
        onClose={() => setShowShareProfile(false)}
        client={client ?? null}
        advisorName={session?.user?.user_metadata?.full_name ?? session?.user?.email ?? ''}
        initialTemplate={shareProfileTemplate}
        // PROFILE-SHARE-1 §14/§15 — seul ce point d'entrée devient éditable avec un titre dédié ;
        // les autres usages de MessageModal (message générique, réseau) sont inchangés.
        editable
        enableEmail
        title={t('messages.title_prepare_summary')}
        beforeMessageContent={shareProfileSelector}
      />

      {/* RÉCAP-5D §5/§6 — vue de détail strictement lecture seule, jamais MessageModal (qui
          exposerait des boutons WhatsApp/SMS/E-mail réels et créerait de nouveaux partages en
          consultant un ancien). */}
      {recapShareDetail ? (
        <RecapShareDetailModal share={recapShareDetail} onClose={() => setRecapShareDetail(null)} />
      ) : null}

      <CalendarPickerModal
        visible={showRescheduleCal}
        value={isoToLocalParts(client.next_action_at ?? new Date()).date}
        locale={locale}
        dayAppointments={rescheduleBusyDays}
        showTime
        initialTime={client.next_action_at ? isoToLocalParts(client.next_action_at).time : '09:00'}
        showDuration={client.next_action_source === 'appointment'}
        initialDurationMinutes={rescheduleDuration}
        onClose={() => setShowRescheduleCal(false)}
        onConfirm={handleRescheduleConfirm}
      />

      <ContactHoursGuard
        action={guardAction}
        contact={client}
        userId={session?.user.id ?? ''}
        locale={locale}
        onClose={() => setGuardAction(null)}
        onFollowupCreated={() => { refresh(); refreshFollowups() }}
      />

      <ContactPickerModal
        visible={downlineBrandPickerOpen}
        title={t('network.add_downline_pick_brand')}
        options={brandLinks.map(l => ({ id: l.brand_id, label: l.brand.name }))}
        onPick={brandId => { if (brandId) chooseDownlineBrand(brandId) }}
        onClose={() => setDownlineBrandPickerOpen(false)}
      />

      <ContactPickerModal
        visible={downlinePickerOpen}
        title={downlineBrandName
          ? t('network.add_downline_title_brand', { name: client.full_name, brand: downlineBrandName })
          : t('network.add_downline_title', { name: client.full_name })}
        options={downlineOptions}
        errorMsg={downlineError}
        createLabel={t('network.create_downline')}
        onCreate={() => {
          setDownlinePickerOpen(false)
          router.push({
            pathname: '/(app)/clients/new',
            params: { sponsorId: id, sponsorName: client.full_name, ...(downlineBrandId ? { brandId: downlineBrandId } : {}) },
          } as any)
        }}
        onPick={async pickedId => {
          if (!pickedId || !session) return
          setDownlineError(null)
          try {
            if (downlineBrandId) await attachToBrandSponsor(session.user.id, pickedId, downlineBrandId, id)
            else await setClientSponsor(session.user.id, pickedId, id)
            setDownlinePickerOpen(false)
            reloadTeam()
            reloadSponsorGraph()
            refreshBrandLinks()
          } catch (e) {
            console.error('[addDownline]', e)
            const cycle = e instanceof SponsorCycleError || e instanceof BrandSponsorError
            setDownlineError(t(cycle ? 'network.cycle_error' : 'network.attach_error'))
          }
        }}
        onClose={() => setDownlinePickerOpen(false)}
      />

      {completingFollowup && (
        <FollowupCompletionModal
          followup={completingFollowup}
          userId={session?.user.id ?? ''}
          onClose={() => setCompletingFollowup(null)}
          onSaved={() => { setCompletingFollowup(null); refresh(); refreshFollowups(); refreshCare() }}
        />
      )}

      {actingFollowup && (
        <FollowupActionFlow
          followup={actingFollowup}
          client={client}
          userId={session?.user.id ?? ''}
          advisorName={session?.user?.user_metadata?.full_name ?? session?.user?.email ?? ''}
          onClose={() => setActingFollowup(null)}
          onSaved={() => { setActingFollowup(null); refresh(); refreshFollowups(); refreshCare() }}
        />
      )}
    </>
  )
}

// RÉCAP-5D §5/§6 — composant neutre dédié, strictement lecture seule : aucun bouton modifier/
// supprimer/régénérer/renvoyer, conforme à la sémantique append-only de appointment_recap_shares.
// Volontairement pas MessageModal (audit §6 du brief) : MessageModal expose des actions réelles
// (WhatsApp/SMS/E-mail) qui créeraient de nouveaux partages simplement en consultant un ancien
// snapshot — une ambiguïté inacceptable pour une vue d'historique.
function RecapShareDetailModal({ share, onClose }: { share: AppointmentRecapShare; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeRecapShareDetailStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const channelLabel = t(`clients.recap_share_channel_${share.channel}`)

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('clients.recap_share_detail_title')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.meta}>
            {channelLabel} · {formatDate(share.created_at, locale)} {formatTime(share.created_at)}
          </Text>
          <ScrollView style={styles.body}>
            {/* §14 — objet affiché uniquement pour le canal email avec un sujet réellement
                snapshoté ; jamais un champ "Objet" vide pour WhatsApp/SMS. */}
            {share.channel === 'email' && share.subject_snapshot ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t('interactions.subject')}</Text>
                <Text style={styles.fieldValue}>{share.subject_snapshot}</Text>
              </View>
            ) : null}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('clients.recap_share_message_label')}</Text>
              <Text style={styles.fieldValue}>{share.message_snapshot}</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

function makeRecapShareDetailStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, maxHeight: '80%', gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
    closeIcon: { fontSize: 16, color: colors.textTertiary, padding: 4 },
    meta: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    body: { flexGrow: 0 },
    field: { gap: 4, marginBottom: 12 },
    fieldLabel: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    fieldValue: { fontSize: 14, fontFamily: fonts.body, color: colors.text, lineHeight: 20 },
  })
}

const CARD_SHADOW = {
  boxShadow: [
    { offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(27, 36, 51, 0.05)' },
    { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(27, 36, 51, 0.06)' },
  ],
  elevation: 2,
}

// ACTION-2.1 — dimensions du menu "+" compact (desktop web uniquement). Largeur dans la
// fourchette demandée (260-300px) ; hauteur estimée pour le cas le plus large (5 items),
// utilisée uniquement pour le bornage écran (Math.max/Math.min), jamais pour un layout réel.
const QUICK_MENU_W      = 280
const QUICK_MENU_EST_H  = 260

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  root:   { flex: 1, backgroundColor: colors.bg },
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
  desktopSidebar: { width: 340, flexShrink: 0, flexGrow: 0 },
  desktopSidebarContent: { paddingTop: 24, paddingBottom: 40 },
  // DESIGN-B — toute la colonne dans un seul panneau, plutôt que des blocs flottants.
  sidebarPanel:   { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, paddingTop: 18, paddingBottom: 4, ...CARD_SHADOW },
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
  bigAvatar:     { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  bigAvatarText: { fontSize: 19, fontFamily: fonts.bold },
  avatarWrap:    { position: 'relative', flexShrink: 0 },
  avatarRing:    { width: 56, height: 56, borderRadius: 28, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  avatarRingImg: { width: 48, height: 48, borderRadius: 24 },
  avatarEditBadge: { position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  heroIdentity:  { flex: 1, gap: 6 },
  heroNameRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  heroBrandMarks: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroName:      { fontSize: 20, lineHeight: 26, fontFamily: fonts.display, color: colors.text, letterSpacing: -0.3 },
  heroMeta:      { gap: 3, marginTop: -4 },
  contactBlock:  { width: '100%', backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  contactLine:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  contactTimeLine: { marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  contactIcon:   { fontSize: 14, width: 18, textAlign: 'center' },
  contactText:   { flex: 1, fontSize: 13.5, fontFamily: fonts.medium, color: colors.text },
  contactTime:   { flex: 1, fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
  heroAddedOn:   { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: -6 },
  heroMetaText:  { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
  heroLocalTime: { fontFamily: fonts.semibold, color: colors.text },
  heroBadges:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heroPill:      { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9999 },
  heroPillText:  { fontSize: 10, fontFamily: fonts.bold, letterSpacing: 0.5 },
  lrpStatusPill:     { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9999 },
  lrpStatusPillText: { fontSize: 10, fontFamily: fonts.bold, letterSpacing: 0.5 },
  programsListBlock: { gap: 8, marginTop: 10 },
  programSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, backgroundColor: colors.bgDim },
  // LRP-4.5 §11 — jamais de textTransform:'uppercase' ici : le label saisi par l'utilisateur
  // ("Nutrition bio", "Sport") doit rester affiché tel quel, pas visuellement forcé en capitales.
  programSummaryTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  programViewLink:   { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
  heroMoreBtn:   { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexShrink: 0 },
  heroMoreIcon:  { fontSize: 18, color: colors.textSecondary, lineHeight: 20 },


  // ── Prochaine action — bloc principal du hero ───────────────────────────────
  // CONTACT-4.1 — même famille typographique que todoBlockTitle (Autres actions), discret.
  priorityActionTitle:    { fontSize: 12.5, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: -4 },
  nextActionBlock:        { width: '100%', borderRadius: 16, borderWidth: 1, borderLeftWidth: 4, padding: 14, gap: 12 },
  nextActionTopRow:       { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nextActionIconBox:      { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  nextActionTextBlock:    { flex: 1, gap: 2 },
  nextActionLabel:        { fontSize: 11, fontFamily: fonts.bold, textTransform: 'uppercase', letterSpacing: 0.6 },
  nextActionMainText:     { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  nextActionSubTitle:     { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  nextActionMeta:         { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
  nextActionTime:         { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  nextActionBtnRow:       { flexDirection: 'row', gap: 10 },
  nextActionLink:         { alignSelf: 'center', marginTop: -4 },
  nextActionLinkText:     { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, textDecorationLine: 'underline' },
  nextActionBtnPrimary:      { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 10 },
  nextActionBtnPrimaryText:  { fontSize: 13.5, fontFamily: fonts.semibold, color: '#fff', textAlign: 'center' },
  nextActionBtnSecondary:     { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 10, borderWidth: 1, backgroundColor: colors.card },
  nextActionBtnSecondaryText: { fontSize: 13.5, fontFamily: fonts.medium, textAlign: 'center' },
  nextActionEmpty:        { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  nextActionEmptyText:    { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  nextActionEmptyBtn:     { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 9999, backgroundColor: colors.primaryLight },
  nextActionEmptyBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },

  // ── Actions secondaires (contact rapide) ────────────────────────────────────
  // DESIGN-B — une seule rangée de boutons de même largeur (icône au-dessus du libellé).
  secondaryActions: { flexDirection: 'row', alignItems: 'stretch', gap: 6, paddingHorizontal: 20, paddingVertical: 14 },

  // ── CONTACT-4 — bloc "À traiter" (raccourci compact, pas un second Dashboard) ───────────
  todoBlockWrap:  { width: '100%', paddingHorizontal: 20, marginTop: -6, marginBottom: 6 },
  todoBlock:      { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 12, gap: 4, ...CARD_SHADOW },
  todoBlockTitle: { fontSize: 12.5, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  // TASK-RDV-1 — affordance secondaire et compacte, jamais une grosse carte (§10).
  doneTasksToggle:     { paddingVertical: 8 },
  doneTasksToggleText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.textSecondary },
  todoRow:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  todoRowEmoji:   { fontSize: 13 },
  todoRowText:    { flex: 1, fontSize: 13.5, fontFamily: fonts.semibold },
  todoMore:       { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary, marginTop: 2 },
  // CONTACT-RDV-TASKS/P3 — rangée frères (CompleteToggle / infos / OpenActionLink), jamais
  // imbriqués (même règle UI-AFFORDANCE-1.3 que followups.tsx/interactions.tsx).
  clientTaskRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  clientTaskInfo: { flex: 1, gap: 2 },
  clientTaskTitle:{ fontSize: 13.5, fontFamily: fonts.semibold, color: colors.text },
  clientTaskMeta: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  saBtn:      { flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.card, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 2, borderWidth: 1, borderColor: colors.border },
  saLabel:    { fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary },

  // ── Menu "Plus" (feuille inférieure) ────────────────────────────────────────
  moreMenuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  moreMenuSheet:   { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 12, paddingBottom: 24, paddingTop: 10 },
  moreMenuHandle:  { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 10 },
  moreMenuOption:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 10 },
  moreMenuOptionText:  { fontSize: 15, fontFamily: fonts.medium, color: colors.text },

  // Menu "+" — conteneur devenu AnchoredMenu (UI-POPOVER-2.1), styles propres retirés.

  // ── Photo de contact (feuilles inférieures) ─────────────────────────────────
  photoSheetTitle:   { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, textAlign: 'center', marginBottom: 6 },
  photoUrlInput:     { backgroundColor: colors.bgDim, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: fonts.body, color: colors.text, marginTop: 4, marginBottom: 12 },
  photoUrlError:       { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, marginTop: -6, marginBottom: 12 },
  photoUrlSaveBtn:     { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  photoUrlSaveBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },

  // ── Tab bar ────────────────────────────────────────────────────────────────
  // Fond opaque : le contenu défile dessous sans transparaître quand la barre est figée.
  tabStickyWrap: { backgroundColor: colors.bg, paddingTop: 20, zIndex: 10 },
  tabScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabRow:    { flexDirection: 'row', paddingHorizontal: 12 },
  tabBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: 'transparent', marginRight: 2 },
  tabBadge:     { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.warningLight },
  tabBadgeText: { fontSize: 10.5, fontFamily: fonts.bold, color: colors.warning },
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
  // 3 colonnes sur grand écran ; minWidth (pas un nouveau breakpoint JS) fait replier la
  // grille à 2 puis 1 colonne dès que l'espace réel disponible devient trop étroit — y
  // compris juste après le seuil isDesktopWeb (768px), où la colonne latérale de 300px
  // laisse moins de place qu'il n'y paraît. Repose sur le flex-wrap déjà en place.
  tabColumnItemThird: { flexBasis: '31%', flexGrow: 1, minWidth: 230 },

  // Section cards
  card:       { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, gap: 14, ...CARD_SHADOW },
  // flexWrap : quand le titre + le badge + "Voir tout" ne tiennent pas sur une ligne (colonnes
  // étroites, ex. Interactions/Recommandations/Commandes sur 3 colonnes), "Voir tout" passe
  // à la ligne suivante plutôt que de forcer le titre à se réduire jusqu'à couper le mot en
  // plein milieu (bug remonté : "Interactio/ns", "Recommand/ations").
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  // minWidth non nul : le titre refuse de rétrécir sous une largeur lisible — c'est ce qui
  // déclenche le flexWrap ci-dessus au lieu d'un rétrécissement infini du texte.
  cardTitle:  { fontSize: 16, fontFamily: fonts.semibold, color: colors.text, flex: 1, minWidth: 90 },
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


  // Interests
  interestsSection: { gap: 10 },
  interestsTitle:   { fontSize: 16, fontFamily: fonts.semibold, color: colors.text },
  pillsWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  interestPill:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  interestPillText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  addPillBtn:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9999, borderWidth: 1.5, borderColor: colors.primaryAction },
  addPillText:      { fontSize: 13, fontFamily: fonts.medium, color: colors.primaryAction },

  // PROFILE-SHARE-1 — bloc compact "Contenu à inclure" du composeur "Partager ma fiche" ;
  // volontairement léger (pas de grosse carte), même langage visuel que les cases à cocher
  // déjà utilisées côté RDV (case + libellé).
  shareOptionsCard:    { backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, padding: 12, gap: 2, marginBottom: 12 },
  shareOptionsTitle:   { fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  shareOptionRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  shareOptionCheckbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  shareOptionLabel:    { fontSize: 13, fontFamily: fonts.medium, color: colors.text },

  // List tabs
  listTab:   { gap: 10 },
  emptyText: { textAlign: 'center', color: colors.textTertiary, fontFamily: fonts.body, fontSize: 14, marginTop: 32, marginBottom: 16 },
  suiviEmptyText: { textAlign: 'center', color: colors.textTertiary, fontFamily: fonts.body, fontSize: 13, marginVertical: 6 },

  // ── Suivi — 3 groupes (À faire / Activité commerciale / Réseau), chacun avec ses
  // propres cartes de section (RDV, Relances, Reco...) ────────────────────────────
  suiviGroupsWrap: { gap: 22 },
  suiviGroup:      { gap: 10 },
  suiviGroupTitle: { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary, letterSpacing: 1, textTransform: 'uppercase', paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  suiviSection: { gap: 10, backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 16, ...CARD_SHADOW },
  suiviViewAll: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  // Toujours collé à droite, y compris quand il passe à la ligne sous le titre (cardHeader
  // flexWrap ci-dessus) — jamais coincé entre le titre et le badge.
  suiviViewAllBtn: { marginLeft: 'auto' },
  sectionCountBadge:     { backgroundColor: colors.bgDim, borderRadius: 9999, paddingHorizontal: 7, paddingVertical: 2 },
  sectionCountBadgeText: { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary },
  // État vide compact : un seul rang cliquable au lieu d'un texte centré + bouton pleine largeur.
  suiviEmptyRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  suiviEmptyRowText: { fontSize: 13, fontFamily: fonts.body, color: colors.textTertiary },
  suiviEmptyRowAdd:  { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },
  // Une seule donnée mise en avant par carte Suivi — saut d'échelle typographique modéré
  // (16px bold, contre 13-14px pour le reste du contenu de carte), pas de couleur ajoutée.
  suiviMetricBlock: { gap: 2, marginBottom: 8 },
  suiviMetricValue: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },
  suiviMetricLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  suiviMetricNote:  { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 2 },

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
  // ACTION-OUTCOME-1 / P0 — extrait de compte-rendu (interaction terminée uniquement), même
  // famille que les autres textes secondaires du fil, jamais affiché s'il est vide.
  timelinePreview:   { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18, marginTop: 2 },
  timelineStatusPill:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999 },
  timelineStatusPillText: { fontSize: 11, fontFamily: fonts.semibold },
  timelineContentTouchable: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  timelineChevron: { marginTop: 2, flexShrink: 0 },
  timelineNoteTagsRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  timelineNoteTag:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.bgDim, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  timelineNoteTagText:  { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary },

  // ── Composeur de note libre (en tête de l'onglet Activité) ─────────────────
  noteComposer:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, padding: 10, ...CARD_SHADOW },
  noteComposerInput:   { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, fontFamily: fonts.body, color: colors.text, maxHeight: 100 },
  noteComposerBtn:     { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  noteComposerBtnDisabled: { backgroundColor: colors.textTertiary },
  noteComposerBtnText: { color: '#fff', fontSize: 20, fontFamily: fonts.bold },
  historyUpcomingLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, backgroundColor: colors.primaryLight },
  historyUpcomingText: { fontSize: 13.5, fontFamily: fonts.medium, color: colors.text },
  historyUpcomingCta:  { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
  timelineTitleSystem: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  noteComposerHint:    { fontSize: 11.5, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 6, marginLeft: 4 },

  // ── Suppression inline d'une note libre dans le fil Activité ───────────────
  timelineNoteDeleteBtn:     { paddingTop: 2 },
  timelineNoteConfirm:       { flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 },
  timelineConfirmCancelBtn:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: colors.border },
  timelineConfirmCancelText: { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  timelineConfirmDeleteBtn:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: colors.danger },
  timelineConfirmDeleteText: { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

  listCard:       { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.cardBorder, padding: 16, gap: 6, flexDirection: 'row', alignItems: 'flex-start', ...CARD_SHADOW },
  listCardDone:   { opacity: 0.55 },
  listCardAccent: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  listCardDebrief: { borderLeftColor: colors.warning, backgroundColor: colors.warningLight },
  debriefCta:     { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.warning, marginTop: 2 },
  relLabel:       { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
  suiviCounts:    { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: -4 },
  suiviNone:      { fontSize: 12.5, fontFamily: fonts.body, color: colors.textTertiary },
  collapseToggle: { paddingVertical: 4 },
  collapseToggleText: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.textSecondary },
  compactRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 4 },
  compactIcon:    { width: 14, fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary, textAlign: 'center' },
  compactText:    { flex: 1, fontSize: 12.5, fontFamily: fonts.body, color: colors.textTertiary },
  compactStatus:  { fontSize: 11.5, fontFamily: fonts.medium, color: colors.textTertiary },
  // CONTACT-4 §9 — accent très léger (jamais un aplat agressif), lisible en light/dark.
  listCardOverdue: { borderLeftColor: colors.danger },
  listCardToday:   { borderLeftColor: colors.warning },
  urgencyBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999, backgroundColor: colors.card },
  urgencyBadgeText: { fontSize: 10.5, fontFamily: fonts.bold, letterSpacing: 0.4 },
  listCardLeft:   { flex: 1, gap: 4 },
  listCardTitle:  { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  // LRP-4.8 §21 — flexShrink:0 défensif : une date ne doit jamais se compresser caractère par
  // caractère quelle que soit la largeur de la carte (voir bug Commandes corrigé ce lot).
  listCardDate:   { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction, flexShrink: 0 },
  listCardDateStrike: { textDecorationLine: 'line-through', color: colors.textTertiary },
  listCardSub:    { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  listCardContext: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 16 },
  apptRowHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  apptStatusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 9999 },
  apptStatusPillText: { fontSize: 11, fontFamily: fonts.semibold },
  listCardBadge:  { backgroundColor: colors.surfaceContainerHigh, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999 },
  listCardBadgeText:  { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary },
  doneBadge:      { backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999 },
  doneBadgeText:  { fontSize: 11, fontFamily: fonts.bold, color: colors.primaryAction },

  addRowBtn:     { marginTop: 4, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center' },
  addRowBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },
  })
}
