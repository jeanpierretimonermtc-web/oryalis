import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, Pressable,
  StyleSheet, ActivityIndicator, useWindowDimensions, Modal, Platform,
} from 'react-native'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { LinearGradient } from 'expo-linear-gradient'
import { useAuth } from '@/features/auth/AuthProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, type ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useGoogleCalendar } from '@/features/appointments/useGoogleCalendar'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import { AnchoredMenu } from '@/shared/components/ui/AnchoredMenu'
import { deleteAppointment } from '@/features/appointments/appointmentService'
import { useCalendarAppointments } from '@/features/appointments/useAppointments'
import { layoutCalendarAppointments } from '@/features/appointments/calendarLayout'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { CalendarAppointment } from '@/features/appointments/appointmentTypes'
import type { ContactRole } from '@/shared/lib/types'

type ViewMode = 'month' | 'week' | 'day'

// ── Constants ──────────────────────────────────────────────────────────────────
const DAY_HOUR_H   = 64
// CAL-4.4 : 38 → 44 (+16%). Les événements semaine paraissaient écrasés par rapport à l'espace
// disponible. GRID_H (= (END_HOUR-START_HOUR)*WEEK_HOUR_H) passe de 456 à 528px — la grille
// Semaine est déjà dans un ScrollView (voir viewMode==='week' plus bas), donc un défilement
// vertical existait déjà dans la plupart des viewports ; ce gain modéré ne le rend pas excessif.
// apptTopPx/apptHeightPx/GRID_H/timeCol s'ajustent automatiquement (paramétrés par WEEK_HOUR_H,
// aucun recalcul manuel nécessaire). weekColW (horizontal) n'est pas concerné.
const WEEK_HOUR_H  = 44
const TIME_COL_W   = 44
const MIN_WEEK_COL = 72
const MONTH_ROWS   = 6
const START_HOUR   = 8
const END_HOUR     = 20
const DURATION_MIN = 60

// Seuils d'affichage de la 3e ligne (type de RDV) — calculés à partir du budget vertical réel
// des styles dayApptBlock/weekApptBlock (padding + lineHeight des 3 lignes), pas des valeurs
// arbitraires. apptHeightPx(DAY_HOUR_H=64, minH=56) plafonne tout RDV ≤ ~58 min à 56px — le
// budget resserré de dayApptBlock (~56px pour 3 lignes, voir ses styles) y tient tout juste,
// mais DAY_TYPE_MIN_H=57 exclut volontairement ce plancher : en dessous d'~1h, seuls
// heure+nom s'affichent (RDV réellement court, pas de place à forcer une 3e ligne).
// Objectif explicite CAL-4.1 : un RDV de 60 min seul en vue Jour (58px, > 57) doit afficher
// son type. En vue Semaine (WEEK_HOUR_H=38, budget carte ~39px), un RDV de 60 min reste
// physiquement trop court (32px) pour 3 lignes lisibles — le type n'y apparaît donc que pour
// des RDV plus longs, ce qui est le comportement attendu (vue plus dense).
const DAY_TYPE_MIN_H  = 57
const DAY_TYPE_MIN_W  = 90
const WEEK_TYPE_MIN_H = 40
const WEEK_TYPE_MIN_W = 55

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
function firstWord(s: string | null | undefined) {
  return (s ?? '').split(' ')[0] ?? ''
}
// Accent calendrier (CAL-4.5) = couleur du rôle principal du contact — source unique :
// shared/theme/roleColors.ts, réutilisée telle quelle (même getPrimaryRole/getRoleColors,
// même ROLE_PRIORITY que l'avatar et les pills de l'écran Contacts, aucune palette locale).
// .text (couleur forte) sert d'accent ponctuel (barre/point), .bg (teinte claire) n'est pas
// utilisé ici — le fond des cartes reste neutre (colors.card/colors.bgDim, CAL-4/4.4).
// client === null (aucun contact rattaché) : accent neutre dédié (colors.textTertiary),
// jamais une couleur de rôle réelle — getPrimaryRole([]) retomberait sur 'customer'/vert, ce
// qui laisserait croire à tort qu'un contact "Client" est rattaché à ce RDV.
// contact_role vide MAIS client existant : délégué tel quel à getPrimaryRole, qui retombe déjà
// sur 'customer' (son propre fallback existant, non dupliqué ici).
function apptAccent(client: CalendarAppointment['client'], colors: ThemeColors): string {
  if (!client) return colors.textTertiary
  return getRoleColors(getPrimaryRole(client.contact_role), colors).text
}

// Constante partagée pour l'atténuation de carte (completed/cancelled) — reprend telle quelle
// la valeur déjà utilisée dans ce fichier pour un état "traité/désactivé"
// (apptMenuDangerBtn + deletingAppt, plus bas), pas un nombre choisi arbitrairement pour CAL-5.
const MUTED_CARD_OPACITY = 0.6

interface StatusPresentation {
  label: string | null       // null pour 'scheduled' — aucun texte de statut affiché
  symbol: string | null      // '↻' / '✓' / '×' / '!' / null
  mutedCard: boolean         // légère atténuation de la carte entière (completed/cancelled)
  strikeName: boolean        // nom barré (cancelled uniquement)
  statusBeforeType: boolean  // priorité statut > type de RDV (cancelled/no_show)
}

// Présentation du statut du RDV (CAL-5/CAL-5.1) — texte/symbole/atténuation UNIQUEMENT, jamais
// une nouvelle couleur : la seule couleur métier d'une carte reste apptAccent() (rôle du
// contact). Réutilise les libellés déjà existants (appointment_statuses.*, en.json/fr.json) —
// 'completed' reste "Complété" (traduction déjà en place), aucune clé i18n inventée pour CAL-5
// ni CAL-5.1 (× est un symbole typographique, pas un texte traduit).
function statusPresentation(status: CalendarAppointment['status'], t: (key: string) => string): StatusPresentation {
  switch (status) {
    case 'rescheduled':
      return { label: t('appointment_statuses.rescheduled'), symbol: '↻', mutedCard: false, strikeName: false, statusBeforeType: false }
    case 'completed':
      return { label: t('appointment_statuses.completed'), symbol: '✓', mutedCard: true, strikeName: false, statusBeforeType: false }
    case 'cancelled':
      // CAL-5.1 : × ajouté (absent en CAL-5) — sans lui, le statut disparaissait complètement
      // des cartes compactes vue Semaine dès que le nom tronquait la mention textuelle.
      return { label: t('appointment_statuses.cancelled'), symbol: '×', mutedCard: true, strikeName: true, statusBeforeType: true }
    case 'no_show':
      return { label: t('appointment_statuses.no_show'), symbol: '!', mutedCard: false, strikeName: false, statusBeforeType: true }
    default:
      // 'scheduled' — cas de référence, aucun bruit visuel ajouté (§5).
      return { label: null, symbol: null, mutedCard: false, strikeName: false, statusBeforeType: false }
  }
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

// ── CAL-6 : Hover Preview / Quick Preview ───────────────────────────────────────
// Délai avant ouverture du hover — évite les aperçus qui clignotent quand la souris traverse
// simplement le calendrier (§16). Valeur simple dans la fourchette demandée (300-400ms).
const HOVER_DELAY_MS   = 350
// Dimensions approximatives du panneau hover, utilisées uniquement pour le clamp aux bords de
// l'écran (§20) — pas une mesure DOM réelle (aucun moteur de positionnement générique, §21).
const HOVER_PANEL_W    = 240
const HOVER_PANEL_EST_H = 170

// Date complète pour le Quick Preview — même convention typographique que le header Jour
// (CAL-1.1 : FR minuscule sans virgule, EN capitalisé avec virgules). Dupliquée volontairement
// plutôt que de retoucher dayHeaderLabel (gelé depuis CAL-1.1 et plusieurs lots suivants) ;
// c'est la même logique appliquée à une date de RDV plutôt qu'au jour sélectionné du calendrier.
function formatFullDate(date: Date, isFr: boolean, daysLong: string[], monthsFull: string[]): string {
  return isFr
    ? `${daysLong[date.getDay()].toLowerCase()} ${date.getDate()} ${monthsFull[date.getMonth()].toLowerCase()} ${date.getFullYear()}`
    : `${daysLong[date.getDay()]}, ${monthsFull[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

// La forme exacte de l'événement hover diffère selon la plateforme (MouseEvent natif sur
// React Native Web) — lecture défensive de pageX/pageY plutôt qu'un cast "as any" sur
// l'événement complet, seule ambiguïté réellement multiplateforme de ce lot.
function extractHoverPageXY(e: unknown): { x: number; y: number } {
  const ev = e as { pageX?: number; pageY?: number; nativeEvent?: { pageX?: number; pageY?: number } }
  return { x: ev.pageX ?? ev.nativeEvent?.pageX ?? 0, y: ev.pageY ?? ev.nativeEvent?.pageY ?? 0 }
}

// Contenu partagé entre Hover Preview (compact, lecture seule) et Quick Preview (complet, dans
// le menu d'action existant) — évite de dupliquer format date/heure/type/statut/rôles/nom
// (§31). Ne contient aucune action : les boutons Voir/Modifier/Supprimer restent gérés par
// l'appelant (menu d'action existant, inchangé).
function AppointmentPreviewContent({
  appt, colors, styles, t, getRoleLabel, isFr, daysLong, monthsFull, compact,
}: {
  appt: CalendarAppointment
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
  t: (key: string) => string
  getRoleLabel: (role: ContactRole) => string
  isFr: boolean
  daysLong: string[]
  monthsFull: string[]
  compact: boolean
}) {
  const accent = apptAccent(appt.client, colors)
  const sp = statusPresentation(appt.status, t)
  const contactName = appt.client ? appt.client.full_name : appt.title
  // Rôles réels (pas seulement le rôle principal de la barre colorée) — même liste que les
  // pills de l'écran Contacts (app/(app)/clients/index.tsx), "customer" (Client) inclus comme
  // n'importe quel autre rôle (audit normalisation des pastilles de rôle).
  const roleLabels = appt.client ? appt.client.contact_role.map(getRoleLabel) : []
  const typeLabel = t(`appointment_types.${appt.appointment_type}`)
  const start = new Date(appt.start_at)
  const end   = new Date(appt.end_at)
  // scheduled : aucun texte sur la carte (CAL-5), mais le Quick Preview (non compact) peut
  // l'expliciter pour rester cohérent avec les 4 autres statuts (§14).
  const statusLine = sp.label
    ? `${sp.symbol ? `${sp.symbol} ` : ''}${sp.label}`
    : (!compact ? t('appointment_statuses.scheduled') : null)
  // title affiché seulement s'il diffère réellement du label du type (§15), et jamais si le
  // contact est absent (le title sert alors déjà de nom de repli ci-dessus, contactName).
  const showTitle = !!appt.client && appt.title.trim().toLowerCase() !== typeLabel.trim().toLowerCase()
  // DASH/CAL-2 §10 — un événement personnel remplace type/statut CRM (sans signification ici)
  // par un simple badge d'origine, jamais une couleur métier supplémentaire (§12).
  const isPersonal = appt.provider === 'google'

  return (
    <View>
      <View style={styles.previewNameRow}>
        <View style={[styles.previewDot, { backgroundColor: accent }]} />
        <Text style={styles.previewName} numberOfLines={1}>{contactName}</Text>
        {isPersonal && (
          <View style={styles.previewPersonalBadge}>
            <Text style={styles.previewPersonalBadgeText}>{t('appointments.personal_badge')}</Text>
          </View>
        )}
      </View>
      {roleLabels.length > 0 && (
        <Text style={styles.previewRoles} numberOfLines={1}>{roleLabels.join(' • ')}</Text>
      )}
      {!compact && (
        <Text style={styles.previewDate}>{formatFullDate(start, isFr, daysLong, monthsFull)}</Text>
      )}
      <Text style={styles.previewTime}>{formatTime(start)} → {formatTime(end)}</Text>
      {!isPersonal && <Text style={styles.previewType}>{typeLabel}</Text>}
      {!isPersonal && statusLine && <Text style={styles.previewStatus}>{statusLine}</Text>}
      {showTitle && (
        <Text style={styles.previewTitle} numberOfLines={compact ? 2 : 3}>{appt.title}</Text>
      )}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function AgendaScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { width: screenW, height: screenH } = useWindowDimensions()
  const isFr = i18n.language === 'fr'
  const { isConfigured: gcConfigured, isConnected: gcConnected, syncing: gcSyncing, syncResult: gcResult, error: gcError, syncAll: gcSyncAll } = useGoogleCalendar()
  // Rôles personnalisables (§11/§22) — même source que Contacts, jamais de libellé hardcodé.
  const { getRoleLabel } = useAppConfig()
  // Même mécanisme que app/(app)/appointments/[id]/index.tsx:338 pour distinguer "desktop web
  // avec souris" — le hover n'a de sens ni sur mobile natif ni sur une fenêtre web étroite.
  const isDesktopHover = Platform.OS === 'web' && screenW >= 768

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
  // Menu d'action rapide (Voir / Modifier / Supprimer) ouvert au clic sur un RDV du
  // calendrier, sans quitter la page — la suppression est irréversible, contrairement à
  // "Annuler" (statut) déjà disponible depuis la fiche détaillée.
  const [actionMenuAppt, setActionMenuAppt] = useState<CalendarAppointment | null>(null)
  // UI-POPOVER-2 — position capturée au clic (comme hoverPos ci-dessous), pour ancrer ce menu
  // près du RDV cliqué au lieu de l'ancienne Modal centrée à l'écran.
  const [actionMenuPos, setActionMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingAppt, setDeletingAppt] = useState(false)

  // CAL-6A — Hover Preview (desktop web uniquement). hoverPos capture pageX/pageY au moment du
  // survol (§20-21) : pas de mesure DOM ni de moteur de positionnement générique, seulement un
  // clamp aux bords de l'écran au rendu (voir plus bas). hoverTimerRef n'est jamais lu par le
  // render — une ref suffit, pas besoin d'état pour le minuteur lui-même.
  const [hoveredAppt, setHoveredAppt] = useState<CalendarAppointment | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const monthGridStart = useMemo(
    () => getMonday(new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1)),
    [monthAnchor]
  )
  const rangeStart = viewMode === 'month' ? monthGridStart : weekStart
  // addDays() renvoie un nouvel objet Date à chaque appel — mémoïsé sur des primitives
  // (.getTime()) pour que sa référence ne change QUE quand la période affichée change
  // réellement, jamais à cause d'un simple re-render (useCalendarAppointments reréduit ces
  // dates à leur valeur primitive en interne, mais cette mémoïsation reste nécessaire pour
  // stabiliser rangeDays/monthDays plus bas, qui en dépendent aussi).
  const rangeEnd = useMemo(
    () => (viewMode === 'month' ? addDays(monthGridStart, MONTH_ROWS * 7) : addDays(weekStart, 7)),
    [viewMode, monthGridStart.getTime(), weekStart.getTime()]
  )

  // ── Data ──────────────────────────────────────────────────────────────────
  const {
    rangeAppointments: rangeAppts,
    loadingRange,
    nextAppointment: nextAppt,
    reloadRange,
    reloadNextAppointment,
    reloadAll,
  } = useCalendarAppointments(rangeStart, rangeEnd, session?.user.id)

  useFocusEffect(useCallback(() => { reloadRange() }, [reloadRange]))
  useFocusEffect(useCallback(() => { reloadNextAppointment() }, [reloadNextAppointment]))

  function jumpToAppt(appt: CalendarAppointment) {
    const day = new Date(appt.start_at)
    day.setHours(0, 0, 0, 0)
    setSelectedDay(day)
    setWeekStart(getMonday(day))
    setMonthAnchor(new Date(day.getFullYear(), day.getMonth(), 1))
    setViewMode('day')
  }

  // CAL-6A — un seul minuteur actif à la fois : toujours annulé avant d'en programmer un
  // nouveau (changement de RDV survolé) ou de fermer explicitement (§34, pas de fuite).
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
  }, [])

  const hidePreviewHover = useCallback(() => {
    clearHoverTimer()
    setHoveredAppt(null)
    setHoverPos(null)
  }, [clearHoverTimer])

  const handleApptHoverIn = useCallback((appt: CalendarAppointment, e: unknown) => {
    if (!isDesktopHover) return
    clearHoverTimer()
    // Ferme immédiatement l'aperçu précédent (§17) plutôt que de le laisser affiché pendant
    // le nouveau délai — jamais deux RDV "affichés" en même temps, même brièvement.
    setHoveredAppt(null)
    setHoverPos(null)
    const { x, y } = extractHoverPageXY(e)
    hoverTimerRef.current = setTimeout(() => { setHoveredAppt(appt); setHoverPos({ x, y }) }, HOVER_DELAY_MS)
  }, [isDesktopHover, clearHoverTimer])

  function openApptMenu(appt: CalendarAppointment, e: unknown) {
    // CAL-6 §37 : un clic ferme immédiatement le Hover Preview avant d'ouvrir le Quick
    // Preview — jamais les deux visibles simultanément.
    hidePreviewHover()
    setActionMenuAppt(appt)
    setActionMenuPos(extractHoverPageXY(e))
    setConfirmingDelete(false)
  }

  function closeApptMenu() {
    if (deletingAppt) return
    setActionMenuAppt(null)
    setConfirmingDelete(false)
  }

  // Ferme le Hover Preview à chaque changement de vue/période (§17) — un seul endroit plutôt
  // que dans goPrev/goNext/jumpToToday/goToDayFromMonth/selectDay individuellement.
  useEffect(() => {
    hidePreviewHover()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, weekStart, monthAnchor])

  // Nettoyage du minuteur au démontage de l'écran (§34).
  useEffect(() => () => clearHoverTimer(), [clearHoverTimer])

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
      await reloadAll()
    } catch (e) {
      console.error('[Agenda.deleteAppointment]', e)
    } finally {
      setDeletingAppt(false)
    }
  }

  const handleGoogleSyncPress = useCallback(async () => {
    if (!gcConnected) { router.push('/(app)/settings-google' as any); return }
    await gcSyncAll()
    reloadRange()
  }, [gcConnected, gcSyncAll, reloadRange])

  // ── Responsive column widths ────────────────────────────────────────────────
  const sidebarW    = screenW >= 768 ? 240 : 0
  const weekColW    = Math.max(MIN_WEEK_COL, Math.floor((screenW - sidebarW - TIME_COL_W - 4) / 7))
  const totalGridW  = 7 * weekColW
  const monthColW   = Math.floor((screenW - sidebarW - 24) / 7)
  const monthCompact = monthColW < 92
  // Largeur numérique de la zone d'événements en vue Jour — reprend les mêmes insets que
  // l'ancien style dayApptBlock (left: TIME_COL_W + 4, right: 8), nécessaire pour subdiviser
  // en lanes au lieu du positionnement left/right purement flexible d'avant CAL-3.
  const dayColW = Math.max(0, screenW - sidebarW - TIME_COL_W - 4 - 8)

  // ── Derived ───────────────────────────────────────────────────────────────
  const weekDays  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const monthDays = Array.from({ length: MONTH_ROWS * 7 }, (_, i) => addDays(monthGridStart, i))
  const dayAppts  = rangeAppts.filter(a => isSameDay(new Date(a.start_at), selectedDay))
  // La grille Mois affiche aussi des jours du mois précédent/suivant (MONTH_ROWS fixe à 6
  // semaines) — rangeAppts couvre toute cette grille, donc filtré ici sur le mois réel de
  // monthAnchor pour que "Ce mois" ne compte pas les RDV des jours adjacents visibles.
  const monthAppts = rangeAppts.filter(a => {
    const d = new Date(a.start_at)
    return d.getFullYear() === monthAnchor.getFullYear() && d.getMonth() === monthAnchor.getMonth()
  })
  const isToday   = isSameDay(selectedDay, today)
  const weekEnd7  = addDays(weekStart, 6)
  const isCurrentPeriod = viewMode === 'month'
    ? (monthAnchor.getFullYear() === today.getFullYear() && monthAnchor.getMonth() === today.getMonth())
    : isToday

  const weekLabel = isFr
    ? `${weekStart.getDate()} ${months[weekStart.getMonth()]} – ${weekEnd7.getDate()} ${months[weekEnd7.getMonth()]} ${weekEnd7.getFullYear()}`
    : `${months[weekStart.getMonth()]} ${weekStart.getDate()} – ${months[weekEnd7.getMonth()]} ${weekEnd7.getDate()}, ${weekEnd7.getFullYear()}`

  const monthLabel = `${monthsFull[monthAnchor.getMonth()]} ${monthAnchor.getFullYear()}`

  // Date absolue (jamais "Aujourd'hui") : cette zone sert à naviguer entre les jours, une
  // date relative y serait moins utile qu'un repère fixe. Réutilise daysLong/monthsFull déjà
  // calculés plus haut (mêmes tableaux que monthLabel), aucune nouvelle logique de formatage.
  // FR : jour/mois en minuscule, sans virgule (typographie française) — EN : casse capitalisée
  // avec virgules, convention naturelle conservée telle quelle.
  const dayHeaderLabel = isFr
    ? `${daysLong[selectedDay.getDay()].toLowerCase()} ${selectedDay.getDate()} ${monthsFull[selectedDay.getMonth()].toLowerCase()} ${selectedDay.getFullYear()}`
    : `${daysLong[selectedDay.getDay()]}, ${monthsFull[selectedDay.getMonth()]} ${selectedDay.getDate()}, ${selectedDay.getFullYear()}`

  // 'day' réutilise dayHeaderLabel (déjà calculé ci-dessus) au lieu de retomber sur weekLabel —
  // la barre de navigation affichait sinon une plage hebdomadaire alors que la vue Jour ne
  // montre qu'une seule journée.
  const periodLabel = viewMode === 'month' ? monthLabel : viewMode === 'day' ? dayHeaderLabel : weekLabel

  // Source unique du footer bas de calendrier : le compte comme le libellé suivent viewMode,
  // à partir de collections déjà chargées (monthAppts/rangeAppts/dayAppts) — aucune requête
  // supplémentaire. week_appt_one/week_appt_other restent génériques malgré leur nom (déjà
  // réutilisées telles quelles, pas de nouvelle clé de pluralisation).
  const footerCount = viewMode === 'month' ? monthAppts.length : viewMode === 'day' ? dayAppts.length : rangeAppts.length
  const footerLabel = viewMode === 'month' ? t('appointments.this_month') : viewMode === 'day' ? t('appointments.this_day') : t('appointments.this_week')

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
  function apptTopPx(appt: CalendarAppointment, hourH: number) {
    const d = new Date(appt.start_at)
    const frac = d.getHours() + d.getMinutes() / 60
    return (Math.max(frac, START_HOUR) - START_HOUR) * hourH
  }
  function apptHeightPx(appt: CalendarAppointment, hourH: number, minH: number) {
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
                      // CAL-5 : couleur toujours = rôle (jamais le statut) ; seule une légère
                      // atténuation (completed/cancelled) est autorisée en mode compact — pas
                      // de symbole, un point n'a pas la place d'en porter un (§31).
                      <View style={styles.monthDotsRow}>
                        {events.slice(0, maxChips).map(appt => {
                          const accent = apptAccent(appt.client, colors)
                          const sp = statusPresentation(appt.status, t)
                          return <View key={appt.id} style={[styles.monthDot, { backgroundColor: accent, opacity: sp.mutedCard ? MUTED_CARD_OPACITY : 1 }]} />
                        })}
                        {events.length > maxChips && <Text style={styles.monthMoreText}>+{events.length - maxChips}</Text>}
                      </View>
                    ) : (
                      <View style={styles.monthEvents}>
                        {events.slice(0, maxChips).map(appt => {
                          const accent = apptAccent(appt.client, colors)
                          // Une seule ligne conservée (§25) : préfixe symbole optionnel avant
                          // l'heure (rescheduled/completed/no_show), légère atténuation +
                          // texte barré pour cancelled — jamais de deuxième ligne, jamais de
                          // couleur supplémentaire.
                          const sp = statusPresentation(appt.status, t)
                          // DASH/CAL-2 §10-11 — icône neutre à la place du symbole de statut,
                          // même logique que Jour/Semaine (aucune place pour un texte "Personnel"
                          // sur une seule ligne déjà dense en vue Mois).
                          const isPersonal = appt.provider === 'google'
                          const prefix = isPersonal ? '🗓 ' : sp.symbol ? `${sp.symbol} ` : ''
                          const isHovered = hoveredAppt?.id === appt.id
                          return (
                            // CAL-6 : chip individuellement cliquable/survolable — stopPropagation
                            // pour ne pas déclencher aussi goToDayFromMonth (onPress de la cellule
                            // parente) ; le reste de la cellule (badge date, espace vide, "+N")
                            // continue de naviguer vers la vue Jour comme avant.
                            <Pressable
                              key={appt.id}
                              onPress={(e) => { e.stopPropagation(); openApptMenu(appt, e) }}
                              onHoverIn={(e) => handleApptHoverIn(appt, e)}
                              onHoverOut={hidePreviewHover}
                              accessibilityLabel={t('appointments.view_detail_hint')}
                              style={[
                                styles.monthEventChip,
                                { backgroundColor: colors.bgDim, borderLeftColor: accent, opacity: sp.mutedCard ? MUTED_CARD_OPACITY : 1 },
                                isHovered && { borderColor: colors.borderStrong },
                              ]}
                            >
                              <Text style={[styles.monthEventText, { color: colors.text }, sp.strikeName && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                                {prefix}{formatTime(new Date(appt.start_at))} {appt.client ? firstWord(appt.client.full_name) : appt.title}
                              </Text>
                            </Pressable>
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
    // -1 si "aujourd'hui" n'appartient pas à la semaine affichée — un seul jour peut être
    // "aujourd'hui", donc une seule colonne à teinter, pas une boucle sur les 7 jours.
    const todayColIdx = weekDays.findIndex(day => isSameDay(day, today))
    return (
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: TIME_COL_W }}>
          <View style={{ height: WEEK_HEADER_H, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }} />
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
            {/* CAL-4.4 : fond neutre (colors.card) au lieu de colors.primaryLight — le bandeau
                bleu plein dominait visuellement toute la vue Semaine. "Aujourd'hui" reste
                identifiable via weekDayCircleToday/weekDayShortActive (déjà colorés primary),
                sans que tout le header ne rivalise avec les RDV. */}
            <View style={{ flexDirection: 'row', height: WEEK_HEADER_H, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' }}>
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
              {/* Rendue avant lignes/séparateurs/RDV (même zIndex par défaut) pour qu'ils
                  restent visibles par-dessus la teinte — non interactive (pointerEvents="none"),
                  la sélection du jour reste gérée par la zone de tap existante plus bas. */}
              {todayColIdx !== -1 && (
                <View
                  pointerEvents="none"
                  style={[styles.weekTodayCol, { left: todayColIdx * weekColW, width: weekColW, backgroundColor: colors.primaryLighter }]}
                />
              )}
              {GRID_HOURS.map(h => (
                <View key={h} style={[styles.weekHourLine, { top: (h - START_HOUR) * WEEK_HOUR_H }, h % 2 === 0 ? styles.weekHourLineMain : styles.weekHourLineMinor]} />
              ))}
              {weekDays.map((_, i) => (
                <View key={i} style={[styles.weekColDiv, { left: i * weekColW }]} />
              ))}

              {weekDays.map((day, dayIdx) => {
                const appts = rangeAppts.filter(a => isSameDay(new Date(a.start_at), day))
                // Collisions calculées jour par jour (§10) : les RDV du mercredi ne partagent
                // jamais de lane avec ceux du jeudi.
                return layoutCalendarAppointments(appts).map(({ appointment: appt, laneIndex, laneCount }) => {
                  // CAL-4.5 : accent = couleur du rôle principal du contact (même source que
                  // Contacts) — fond neutre inchangé (colors.card).
                  const accent = apptAccent(appt.client, colors)
                  const topPx  = apptTopPx(appt, WEEK_HOUR_H)
                  const hPx    = apptHeightPx(appt, WEEK_HOUR_H, 24)
                  const d      = new Date(appt.start_at)
                  // laneCount === 1 : gap nul, largeur identique au comportement d'avant CAL-3
                  // (colonne du jour moins 3px de marge de chaque côté).
                  const innerW  = weekColW - 6
                  const laneGap = laneCount > 1 ? 2 : 0
                  const laneW   = (innerW - laneGap * (laneCount - 1)) / laneCount
                  const left    = dayIdx * weekColW + 3 + laneIndex * (laneW + laneGap)
                  // Hauteur ET largeur (§7/§9) : la vue Semaine est dense, le type n'y apparaît
                  // que pour un RDV assez long ET une lane assez large (une carte de 3 lanes
                  // étroite ne l'affiche pas, cf. §10).
                  const showType = hPx > WEEK_TYPE_MIN_H && laneW > WEEK_TYPE_MIN_W
                  // CAL-5 : statut = texte/symbole uniquement, aucune nouvelle couleur. Réutilise
                  // le seuil showType existant (aucun nouveau seuil créé) comme unique décision
                  // "une 3e ligne tient-elle" — seul son contenu change selon le statut.
                  const sp = statusPresentation(appt.status, t)
                  const typeLabel   = t(`appointment_types.${appt.appointment_type}`)
                  const statusText  = sp.label ? [sp.symbol, sp.label].filter(Boolean).join(' ') : null
                  // DASH/CAL-2 §10-11 — un événement personnel n'a ni type de RDV commercial ni
                  // statut CRM pertinent : la 3e ligne devient "Personnel" au lieu de type/statut.
                  const isPersonal  = appt.provider === 'google'
                  const thirdLine   = isPersonal ? (showType ? t('appointments.personal_badge') : null)
                    : !showType ? null : (sp.statusBeforeType && statusText ? statusText : statusText ? `${typeLabel} · ${statusText}` : typeLabel)
                  // CAL-5.1 : carte compacte (pas de place pour une 3e ligne) — le SYMBOLE seul
                  // (jamais le texte complet) précède désormais le nom, pour tous les statuts
                  // qui en portent un (pas seulement cancelled/no_show). Remplace l'ancien
                  // suffixe " · Statut" (CAL-5) qui disparaissait avec le nom une fois tronqué
                  // par numberOfLines={1} — c'est le bug rapporté (ex. no_show invisible).
                  // Personnel : icône calendrier neutre à la place du symbole de statut.
                  const namePrefix  = isPersonal ? '🗓 ' : (!showType && sp.symbol) ? `${sp.symbol} ` : ''
                  const isHovered   = hoveredAppt?.id === appt.id
                  return (
                    <Pressable
                      key={appt.id}
                      style={[
                        styles.weekApptBlock,
                        { left, width: laneW, top: topPx + 2, height: hPx, backgroundColor: colors.card, borderLeftColor: accent, opacity: sp.mutedCard ? MUTED_CARD_OPACITY : 1 },
                        isHovered && { borderColor: colors.borderStrong },
                      ]}
                      onPress={(e) => openApptMenu(appt, e)}
                      onHoverIn={(e) => handleApptHoverIn(appt, e)}
                      onHoverOut={hidePreviewHover}
                      accessibilityLabel={t('appointments.view_detail_hint')}
                    >
                      {hPx > 30 && (
                        <Text style={[styles.weekApptTime, { color: colors.textSecondary }]}>{formatTime(d)}</Text>
                      )}
                      <Text style={[styles.weekApptName, { color: colors.text }, sp.strikeName && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                        {namePrefix}{appt.client ? firstWord(appt.client.full_name) : appt.title}
                      </Text>
                      {thirdLine && (
                        <Text style={[styles.weekApptType, { color: colors.textSecondary }]} numberOfLines={1}>
                          {thirdLine}
                        </Text>
                      )}
                    </Pressable>
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
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} onScroll={hidePreviewHover} scrollEventThrottle={32}>
        <View style={styles.dayInfoBar}>
          <View>
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

          {layoutCalendarAppointments(dayAppts).map(({ appointment: appt, laneIndex, laneCount }) => {
            const d      = new Date(appt.start_at)
            const end    = new Date(appt.end_at)
            const topPx  = apptTopPx(appt, DAY_HOUR_H) + 4
            const hPx    = apptHeightPx(appt, DAY_HOUR_H, 56)
            // CAL-4.5 : accent = couleur du rôle principal du contact (même source que
            // Contacts) — fond neutre inchangé (colors.card).
            const accent = apptAccent(appt.client, colors)
            const laneGap = laneCount > 1 ? 4 : 0
            const rawLaneW = (dayColW - laneGap * (laneCount - 1)) / laneCount
            // CAL-4.4 : uniquement pour laneCount === 1 (un RDV seul), plafonne la largeur pour
            // éviter une carte disproportionnée sur un très grand écran (un rectangle de
            // 1000px+ pour 3 lignes de texte). 640 reprend contentWide.maxWidth déjà utilisé
            // pour la même problématique — afficher un seul RDV sans l'étirer — dans
            // app/(app)/appointments/new.tsx, pas un nombre choisi arbitrairement pour ce lot.
            // laneCount > 1 : répartition des lanes CAL-3 strictement inchangée (rawLaneW telle
            // quelle). Sur mobile/fenêtre réduite, dayColW < 640 : Math.min ne change rien,
            // la largeur reste naturellement celle de l'écran disponible.
            const laneW = laneCount === 1 ? Math.min(rawLaneW, 640) : rawLaneW
            const left  = TIME_COL_W + 4 + laneIndex * (laneW + laneGap)
            // Hauteur ET largeur réellement disponibles, jamais laneCount seul (§7) — un RDV de
            // 60 min seul (hPx=58) passe désormais ce test ; en 3 lanes, seule une largeur
            // réellement suffisante (écran large) permet encore d'afficher le type.
            const showType = hPx > DAY_TYPE_MIN_H && laneW > DAY_TYPE_MIN_W
            // CAL-5 : statut = texte/symbole uniquement, aucune nouvelle couleur. Réutilise le
            // seuil showType existant (aucun nouveau seuil créé) comme unique décision "une 3e
            // ligne tient-elle" — pour cancelled/no_show, le statut prend la priorité sur le
            // type dans cette même ligne (§11 : STATUT > TYPE RDV).
            const sp = statusPresentation(appt.status, t)
            const typeLabel  = t(`appointment_types.${appt.appointment_type}`)
            const statusText = sp.label ? [sp.symbol, sp.label].filter(Boolean).join(' ') : null
            // DASH/CAL-2 §10-11 — même principe que la vue Semaine : "Personnel" remplace
            // type/statut, jamais mêlé aux deux (aucun sens commercial pour un événement externe).
            const isPersonal = appt.provider === 'google'
            const thirdLine  = isPersonal ? (showType ? t('appointments.personal_badge') : null)
              : !showType ? (sp.statusBeforeType && statusText ? statusText : null)
              : (sp.statusBeforeType && statusText ? statusText : statusText ? `${typeLabel} · ${statusText}` : typeLabel)
            const isHovered = hoveredAppt?.id === appt.id
            return (
              <Pressable
                key={appt.id}
                style={[
                  styles.dayApptBlock,
                  { left, width: laneW, top: topPx, height: hPx, backgroundColor: colors.card, borderLeftColor: accent, opacity: sp.mutedCard ? MUTED_CARD_OPACITY : 1, zIndex: 1 },
                  isHovered && { borderColor: colors.borderStrong },
                ]}
                onPress={(e) => openApptMenu(appt, e)}
                onHoverIn={(e) => handleApptHoverIn(appt, e)}
                onHoverOut={hidePreviewHover}
                accessibilityLabel={t('appointments.view_detail_hint')}
              >
                {/* Heure en colors.textSecondary (pas accent) — une seule utilisation forte de
                    la couleur de rôle par carte (la barre gauche), pour ne pas surcharger la
                    carte de la même teinte à plusieurs endroits. */}
                <View style={styles.dayApptHeaderRow}>
                  <Text style={[styles.dayApptTime, { color: colors.textSecondary }]}>
                    {formatTime(d)} – {formatTime(end)}
                  </Text>
                </View>
                <Text style={[styles.dayApptClient, { color: colors.text }, sp.strikeName && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                  {isPersonal ? '🗓 ' : ''}{appt.client ? appt.client.full_name : appt.title}
                </Text>
                {thirdLine ? (
                  <Text style={[styles.dayApptTheme, { color: colors.textSecondary }]} numberOfLines={1}>
                    {thirdLine}
                  </Text>
                ) : null}
              </Pressable>
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
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} onScroll={hidePreviewHover} scrollEventThrottle={32}>
            {renderMonthGrid()}
            <View style={{ height: 80 }} />
          </ScrollView>
        )}

        {viewMode === 'week' && (
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} onScroll={hidePreviewHover} scrollEventThrottle={32}>
            {renderWeekGrid()}
            <View style={{ height: 80 }} />
          </ScrollView>
        )}

        {viewMode === 'day' && renderDayView()}

        <View style={styles.bottomBar}>
          <View style={styles.bottomLeft}>
            <Text style={styles.bottomWeekLabel}>{footerLabel}</Text>
            <Text style={styles.bottomWeekCount}>
              {footerCount === 1
                ? t('appointments.week_appt_one')
                : t('appointments.week_appt_other', { count: footerCount })}
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
              {/* UI-CREATE-1 — page globale (Agenda) → "Nouveau RDV", distinct de
                  appointments.add ("Ajouter un RDV") réservé au contexte contact. */}
              <Text style={styles.newRdvText}>{t('appointments.new')}</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>

      {/* CAL-6A — rendu en dehors de tout ScrollView/conteneur clippé (contrairement aux
          grilles Mois/Semaine, qui ont un overflow:'hidden' sur leur bordure), pour ne jamais
          être rogné. pointerEvents="none" (§18) : ne capture jamais la souris, pour éviter
          toute boucle survol-carte → panneau → perte du survol → disparition. Position basée
          sur pageX/pageY capturés au survol (§20-21), simplement bornée aux limites de l'écran
          — pas de mesure DOM, pas de moteur de placement générique. */}
      {hoveredAppt && hoverPos && (
        <View
          pointerEvents="none"
          style={[
            styles.hoverPanel,
            {
              left: Math.max(8, Math.min(hoverPos.x + 14, screenW - HOVER_PANEL_W - 12)),
              top: Math.max(8, Math.min(hoverPos.y + 14, screenH - HOVER_PANEL_EST_H - 12)),
            },
          ]}
        >
          <AppointmentPreviewContent
            appt={hoveredAppt} colors={colors} styles={styles} t={t} getRoleLabel={getRoleLabel}
            isFr={isFr} daysLong={daysLong} monthsFull={monthsFull} compact
          />
        </View>
      )}

      {/* UI-POPOVER-2 — "Quick Preview" devient un vrai menu ancré près du RDV cliqué
          (§20 : ne transforme pas la fiche RDV en popover, seul ce menu court change). */}
      <AnchoredMenu visible={!!actionMenuAppt} onClose={closeApptMenu} anchor={actionMenuPos} width={300} estimatedHeight={340}>
            {actionMenuAppt ? (
              <>
                {/* CAL-6B — même contenu que le Hover Preview (AppointmentPreviewContent,
                    compact={false} : ajoute la date complète, explicite "Planifié" pour
                    scheduled) — le menu Voir/Modifier/Supprimer existant suit juste après,
                    inchangé. */}
                <View style={styles.apptMenuHeader}>
                  <AppointmentPreviewContent
                    appt={actionMenuAppt} colors={colors} styles={styles} t={t} getRoleLabel={getRoleLabel}
                    isFr={isFr} daysLong={daysLong} monthsFull={monthsFull} compact={false}
                  />
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
                    {/* DASH/CAL-2 §13 — un événement personnel (provider='google') n'a pas de
                        fiche RDV commerciale ni de formulaire d'édition Oryalis pertinents :
                        seul l'aperçu ci-dessus (déjà neutre) et la suppression restent proposés. */}
                    {actionMenuAppt.provider !== 'google' && (
                      <>
                        <TouchableOpacity style={styles.apptMenuRow} onPress={handleViewAppt} activeOpacity={0.7}>
                          <Text style={styles.apptMenuRowText}>{t('appointments.view_detail_hint')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.apptMenuRow} onPress={handleEditAppt} activeOpacity={0.7}>
                          <Text style={styles.apptMenuRowText}>{t('common.edit')}</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    <TouchableOpacity style={styles.apptMenuRow} onPress={() => setConfirmingDelete(true)} activeOpacity={0.7}>
                      <Text style={[styles.apptMenuRowText, { color: colors.danger }]}>{t('common.delete')}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </>
            ) : null}
      </AnchoredMenu>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },

  // Menu d'action rapide sur un RDV du calendrier — conteneur devenu AnchoredMenu
  // (UI-POPOVER-2), seul le contenu interne (header aperçu + lignes) reste ici.
  apptMenuHeader:  { marginBottom: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  apptMenuRow:     { paddingVertical: 12 },
  apptMenuRowText: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
  apptMenuConfirmText: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18, marginBottom: 14 },
  apptMenuConfirmRow:  { flexDirection: 'row', gap: 10 },
  apptMenuSecondaryBtn:     { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  apptMenuSecondaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  apptMenuDangerBtn:        { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: colors.danger },
  apptMenuDangerBtnText:    { fontSize: 14, fontFamily: fonts.semibold, color: '#ffffff' },

  // CAL-6 — Hover Preview : même famille visuelle que AnchoredMenu (fond colors.card, bordure
  // colors.border, ombre légère déjà utilisée dans ce fichier), en plus compact et non cliquable.
  hoverPanel: {
    position: 'absolute', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 12, padding: 12, minWidth: 190, maxWidth: 240,
    boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 20, color: 'rgba(0, 0, 0, 0.18)' }], elevation: 12,
    zIndex: 50,
  },
  // Contenu partagé Hover Preview / Quick Preview (AppointmentPreviewContent).
  previewNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  previewDot:     { width: 8, height: 8, borderRadius: 4 },
  // DASH/CAL-2 — badge neutre (jamais une couleur métier), gris cohérent avec le reste du thème.
  previewPersonalBadge:     { backgroundColor: colors.bgDim, borderRadius: 9999, paddingHorizontal: 7, paddingVertical: 2 },
  previewPersonalBadgeText: { fontSize: 9.5, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  previewName:    { fontSize: 14, fontFamily: fonts.semibold, color: colors.text, flexShrink: 1 },
  previewRoles:   { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 2 },
  previewDate:    { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 8 },
  previewTime:    { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 2 },
  previewType:    { fontSize: 13, fontFamily: fonts.medium, color: colors.text, marginTop: 6 },
  previewStatus:  { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 2 },
  previewTitle:   { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 6 },

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
  weekLabel:      { fontSize: 12, fontFamily: fonts.semibold, color: colors.text, textAlign: 'center', flexShrink: 1 },

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
  // CAL-4.2 avait aligné l'opacité sur weekHourLineMain, mais StyleSheet.hairlineWidth reste
  // insuffisant pour une frontière structurelle : sur le web, hairlineWidth vaut 1 / pixelRatio
  // (souvent 0.5px sur un écran retina/2x), un trait sub-pixel très difficile à percevoir quelle
  // que soit l'opacité. CAL-4.3 : largeur réelle de 1px logique pour les séparateurs de jours —
  // frontière structurelle, volontairement plus présente que les lignes d'heure (weekHourLine
  // reste en hairlineWidth, repère secondaire).
  weekColDiv:        { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: colors.border, opacity: 0.9 },
  weekTodayCol:      { position: 'absolute', top: 0, bottom: 0 },

  // CAL-4.4 : + bordure fine colors.border (définition contre la grille, surtout en dark mode
  // où card/bgDim sont plus proches), radius/padding légèrement augmentés (plus "fini") — pas
  // d'ombre ici (cartes nombreuses et petites, un flou par carte alourdirait la vue).
  weekApptBlock: { position: 'absolute', borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderLeftWidth: 2.5, paddingHorizontal: 4, paddingVertical: 3, overflow: 'hidden', zIndex: 2 },
  weekApptTime:  { fontSize: 9, fontFamily: fonts.medium, opacity: 0.85 },
  weekApptName:  { fontSize: 11, fontFamily: fonts.bold },
  weekApptType:  { fontSize: 9, fontFamily: fonts.medium, opacity: 0.85 },

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
  // CAL-4.4 : gap/padding/radius légèrement augmentés — chips mieux séparés entre eux (jamais
  // collés) et légèrement plus "finis", sans ajouter de ligne ni de texte (10:15 Emma inchangé).
  monthEvents:         { gap: 3 },
  // CAL-6 : borderWidth réservé en permanence (borderColor transparent par défaut) — le survol
  // ne change que la couleur, jamais la largeur, pour n'introduire aucun décalage de layout.
  monthEventChip:      { borderRadius: 5, borderLeftWidth: 3, borderWidth: 1, borderColor: 'transparent', paddingHorizontal: 5, paddingVertical: 2.5 },
  monthEventText:      { fontSize: 9.5, fontFamily: fonts.semibold },
  monthMoreText:       { fontSize: 9.5, fontFamily: fonts.medium, color: colors.textTertiary, paddingLeft: 3, marginTop: 1 },
  monthDotsRow:        { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 3, paddingLeft: 2 },
  monthDot:            { width: 5, height: 5, borderRadius: 2.5 },

  dot:            { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary },
  dotSel:         { backgroundColor: '#ffffff' },

  dayInfoBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  dayApptCount:   { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 1 },

  body:          { flex: 1 },
  timeGrid:      { position: 'relative', paddingTop: 4 },
  hourRow:       { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-start', height: DAY_HOUR_H },
  hourLabel:     { width: TIME_COL_W, fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary, textAlign: 'right', paddingRight: 10, lineHeight: 16 },
  hourLine:      { flex: 1, height: StyleSheet.hairlineWidth, marginTop: 8, marginRight: 8 },
  // CAL-4.4 : les heures principales (paires) passent à 1px réel (même diagnostic que CAL-4.3
  // pour les séparateurs de jours — hairlineWidth ≈ 0.5px sur un écran web retina, à peine
  // perceptible même à opacité pleine). Les heures secondaires (impaires) restent en
  // hairlineWidth + opacity 0.4, volontairement plus discrètes.
  hourLineMain:  { backgroundColor: colors.border, height: 1 },
  hourLineMinor: { backgroundColor: colors.border, opacity: 0.4 },

  dayTapZone:   { position: 'absolute', top: 0, left: TIME_COL_W, right: 0, bottom: 0, zIndex: 0 },

  // left/width toujours fournis en inline (voir renderDayView, layoutCalendarAppointments) —
  // plus de right fixe depuis CAL-3, pour permettre la subdivision en lanes.
  // Espacement resserré (CAL-4.1) pour que heure + nom + type tiennent réellement dans les
  // ~58px d'un RDV de 60 minutes (apptHeightPx(DAY_HOUR_H=64, 60min) = 58) — voir
  // DAY_TYPE_MIN_H. Le nom (dayApptClient) reste l'élément le plus grand/gras : seule sa marge
  // verticale a été réduite, pas sa taille de police.
  // CAL-4.4 : + bordure fine colors.border (définition contre la grille, cohérent avec
  // weekApptBlock) — pas d'ombre : overflow:'hidden' (nécessaire au radius/numberOfLines)
  // la découperait sur web, ce qui la rendrait invisible ou incohérente selon la plateforme.
  dayApptBlock:     { position: 'absolute', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderLeftWidth: 4, paddingHorizontal: 12, paddingVertical: 5, overflow: 'hidden' },
  dayApptHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' },
  dayApptTime:      { fontSize: 11, fontFamily: fonts.medium, opacity: 0.9, lineHeight: 12 },
  dayApptClient:    { fontSize: 16, fontFamily: fonts.bold, lineHeight: 18 },
  dayApptTheme:     { fontSize: 12, fontFamily: fonts.body, opacity: 0.72, marginTop: 1, lineHeight: 13 },

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
