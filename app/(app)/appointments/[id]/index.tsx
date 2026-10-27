import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Platform, Modal, useWindowDimensions, Switch,
} from 'react-native'
import { Stack, router, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Lock, Snowflake, CloudSun, Flame, Check, X, TriangleAlert, ArrowDown } from 'lucide-react-native'
import { supabase } from '@/shared/lib/supabase'
import { useAppointmentDetail } from '@/features/appointments/useAppointments'
import { createAppointment, deleteAppointment } from '@/features/appointments/appointmentService'
import { createFollowup } from '@/features/followups/followupService'
import { useRecommendations } from '@/features/recommendations/useRecommendations'
import { createRecommendation } from '@/features/recommendations/recommendationService'
import { createOrder } from '@/features/orders/orderService'
import { logClientEvent } from '@/features/clients/clientEventService'
import { AppointmentCompletionError, APPOINTMENT_TYPE_COLORS as TYPE_COLORS } from '@/features/appointments/appointmentTypes'
import type {
  AppointmentStatus, AppointmentTask, ProspectTemperature, CommercialIntent, AppointmentOutcome,
  AppointmentOutcomeDetails, OutcomeSaleProduct, OutcomeInterestKind, NotInterestedReason, OutcomeRevisionReason,
  SaleCompletedDetails, InterestedDetails, NotInterestedDetails, PartnerPotentialDetails, PartnerRecruitedDetails,
  PostCompletionWarningCode, PostCompletionPlan, PostCompletionPlanKey, AppointmentOutcomeActionPlan,
  DiscussedProduct, ClientFacingNextAppointment,
} from '@/features/appointments/appointmentTypes'
import { ACTIVE_OUTCOMES } from '@/features/appointments/appointmentTypes'
import {
  getApplicableAutomationRules, isFirstOrderForClient, fetchUpcomingAppointmentsForClient,
  detectFollowupConflict,
  buildOutcomeRevisionPlan, reviseAppointmentOutcome, applyOutcomePlanActions, OutcomeRevisionConflictError,
  resolveClientFacingNextAppointment, mergeSaleOrderItemIds,
} from '@/features/appointments/appointmentOutcomeService'
import type { FollowupConflict, UpcomingAppointmentOption, OutcomeRevisionPlan, OutcomeSnapshot, OutcomePlanWarnings } from '@/features/appointments/appointmentOutcomeService'
import { AUTOMATION_RULES, renderRuleTitle, renderRuleDescription } from '@/features/automations/automationService'
import { FOLLOWUP_DATE_PRESETS, followupPresetDate, followupPresetDays } from '@/features/followups/followupDatePresets'
import { CatalogProductPicker } from '@/features/catalogs/CatalogProductPicker'
import type { CatalogPickerResult } from '@/features/catalogs/CatalogProductPicker'
import { PIPELINE_STAGES, type PipelineStage, type ContactRole, type NextActionType, type Order } from '@/shared/lib/types'
import { getOrdersForAppointment } from '@/features/orders/orderService'
import { generateOrderItemId, fetchOrderItemsForOrders, hybridLinesFromItems, getNetQuantity, getOrderReturnStatus, computeOrderNetAmount } from '@/features/orders/orderItemService'
import type { OrderItem } from '@/shared/lib/types'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate, formatTime } from '@/shared/lib/dateFormat'
import { formatMoney, formatMoneyAmount } from '@/shared/lib/moneyFormat'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import { TextArea } from '@/shared/components/ui/TextArea'
import { OpenActionLink } from '@/shared/components/ui/OpenActionLink'
import type { ExternalShareInitiatedPayload } from '@/shared/components/ui/MessageModal'
import { logRecapShare, getLatestRecapShareForAppointment } from '@/features/appointments/recapShareService'
import type { AppointmentRecapShare } from '@/features/appointments/appointmentTypes'
import { CalendarPickerModal } from '@/shared/components/ui/CalendarPickerModal'
import { DateInput } from '@/shared/components/ui/DateInput'
import type { CalendarBusyAppointment } from '@/shared/components/ui/CalendarPickerModal'
import { TimePickerModal } from '@/shared/components/ui/TimePickerModal'
import { buildAppointmentRecapTemplate } from '@/features/messages/templates'
import { formatDiscussedProductsForRecap, formatOrderProductsForRecap } from '@/features/appointments/recapProducts'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { LrpProgramFields } from '@/features/clients/LrpProgramFields'
import { initialLrpProgramValue } from '@/features/clients/lrpProgramService'
import { fetchProgramsForClient } from '@/features/clients/recurringProgramService'
import type { RecurringProgram } from '@/shared/lib/types'
import type { LrpProgramValue } from '@/features/clients/lrpProgramService'

// ── Constants ─────────────────────────────────────────────────────────────────

const TEMP_COLOR: Record<string, string> = {
  cold: '#3B82F6', warm: '#F59E0B', hot: '#F97316', very_hot: '#EF4444',
}
const TEMP_ICON: Record<string, typeof Snowflake> = {
  cold: Snowflake, warm: CloudSun, hot: Flame, very_hot: Flame,
}

function TempIcon({ temp, size = 12, color }: { temp: string; size?: number; color: string }) {
  const Icon = TEMP_ICON[temp]
  return <Icon size={size} color={color} strokeWidth={2} />
}

// RDV-FOLLOWUP-1/P0 §6-7 — même formule que automationService.dueDateStr (délai + date du
// jour), nécessaire ici pour prérempli la relance après RDV à partir du délai effectif de la
// règle appt_j7 sans dupliquer une deuxième logique de presets (voir FOLLOWUP_DATE_PRESETS).
function dueDateStr(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0]
}

// RDV-1 §3 — 'completed' retiré : ce n'est pas une simple bascule de statut (elle ouvre le
// débrief), elle est désormais déclenchée par le CTA "Terminer le rendez-vous" en bas de page,
// via handleStatusChange('completed') — même fonction, aucune logique dupliquée.
const STATUS_PILLS: AppointmentStatus[] = ['scheduled', 'no_show', 'rescheduled']
const TEMPERATURE_PILLS: ProspectTemperature[] = ['cold', 'warm', 'hot', 'very_hot']
const INTENT_PILLS: CommercialIntent[] = ['buy_product', 'become_customer', 'become_distributor', 'build_team', 'training', 'support', 'other']
// become_customer/become_distributor sont résolues séparément via getRoleLabel (voir
// getIntentLabel) — ce mapping ne couvre que les intentions sans équivalent ContactRole,
// chacune vers sa clé i18n statique existante (pas de construction dynamique de clé).
type GenericCommercialIntent = Exclude<CommercialIntent, 'become_customer' | 'become_distributor'>
const GENERIC_INTENT_I18N_KEYS: Record<GenericCommercialIntent, string> = {
  buy_product: 'commercial_intents.buy_product',
  build_team:  'commercial_intents.build_team',
  training:    'commercial_intents.training',
  support:     'commercial_intents.support',
  other:       'commercial_intents.other',
}
// Lot 1.2 — 'follow_up_required' n'est plus un choix actif (Principe 1) : "à relancer" est une
// prochaine action, pas un résultat. Reste dans OUTCOME_COLOR pour l'affichage historique.
const OUTCOME_PILLS: AppointmentOutcome[] = ACTIVE_OUTCOMES
// "Autres retombées" — mêmes valeurs que le résultat principal, à l'exception de 'other' (qui
// nécessite un libellé libre propre au résultat principal, hors périmètre d'un simple tag).
// Le résultat actuellement sélectionné comme principal (outcomeDraft) est retiré au rendu.
const OTHER_OUTCOME_TAG_OPTIONS: AppointmentOutcome[] = ACTIVE_OUTCOMES.filter(o => o !== 'other')
const INTEREST_KIND_PILLS: OutcomeInterestKind[] = ['product', 'product_range', 'offer', 'subscription', 'sample', 'business_opportunity', 'other']
// RDV-CLOSURE-PRODUCTS/P0 — sous-ensemble de OutcomeInterestKind qui concerne réellement un ou
// plusieurs produits (mockup §3/§17 du brief) : 'business_opportunity' (opportunité d'affaires,
// jamais un produit) et 'other' (générique, non qualifiable) en sont explicitement exclus.
const PRODUCT_RELATED_INTEREST_KINDS: OutcomeInterestKind[] = ['product', 'product_range', 'offer', 'subscription', 'sample']

// RDV-CLOSURE-PRODUCTS/P1.1 — clé locale ÉPHÉMÈRE, jamais persistée, jamais un lineId ajouté au
// type DiscussedProduct. Une propriété à clé Symbol survit intacte à `{...p, patch}` (le spread
// objet copie les propriétés Symbol comme les propriétés string) — contrairement à l'identité
// de référence de l'objet lui-même (cassée par le moindre `{...p}`) ou à l'index dans le
// tableau (faussé par un ajout/suppression avant l'élément suivi). Elle ne fuite jamais vers la
// base : JSON.stringify (utilisé par le client Supabase pour sérialiser le payload) ignore
// nativement les clés Symbol, aucun filtrage manuel n'est donc nécessaire dans
// sanitizeDiscussedProducts. Seule utilité : permettre à getMissingConsideredProducts de
// reconnaître un produit LIBRE déjà importé dans saleProducts même après une modification de
// discussed_products (toggle considered, édition quantité/prix) qui recrée l'objet.
const DISCUSSED_LOCAL_ID = Symbol('discussedProductLocalId')
const NOT_INTERESTED_REASON_PILLS: NotInterestedReason[] = ['price', 'bad_timing', 'no_need', 'not_a_fit', 'lack_of_trust', 'already_equipped', 'mlm_opposition', 'other']
const OUTCOME_COLOR: Record<AppointmentOutcome, string> = {
  sale_completed: '#10B981', interested: '#3B82F6', follow_up_required: '#F59E0B',
  not_interested: '#94A3B8', partner_potential: '#8B5CF6', partner_recruited: '#8B5CF6',
  other: '#64748B',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0') }

function toISO(date: string, time: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).toISOString()
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function abbreviateName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  return parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : full
}

// ── Local types ───────────────────────────────────────────────────────────────

// RÉCAP-4 §3 — `email` ajouté à la colonne déjà sélectionnée pour ce même flux (aucune requête
// Supabase supplémentaire), pour que le bouton E-mail du récap sache si le contact en a une.
type ClientInfo = {
  id: string; full_name: string; status: string; first_name: string | null; phone: string | null; email: string | null
  next_lrp_date: string | null
  contact_role: ContactRole[]
}
type HistoryItem = { id: string; title: string; status: string; start_at: string }
// RDV-HISTORY-NAV-1 — RDV d'origine consulté depuis "Historique RDV" : mêmes champs d'affichage
// que HistoryItem + client_id, nécessaire UNIQUEMENT pour le garde-fou §22 (ne jamais afficher un
// "RDV actuel" appartenant à un autre contact que celui réellement affiché).
type OriginItem = HistoryItem & { client_id: string }

// ── Sub-components ────────────────────────────────────────────────────────────

function NoteCard({ title, value, onChange, colors, styles, internal }: {
  title: string
  value: string
  onChange: (v: string) => void
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
  // Décision #7 / règle de confiance de la refonte : ce contenu n'est jamais
  // repris automatiquement dans un récap ou message destiné au contact.
  internal?: boolean
}) {
  const { t } = useTranslation()
  return (
    <View style={styles.noteCard}>
      <View style={styles.noteCardTitleRow}>
        <Text style={styles.noteCardTitle}>{title}</Text>
        {internal ? (
          <View style={styles.noteCardInternalBadge}>
            <Lock size={10} color={colors.danger} strokeWidth={2} />
            <Text style={styles.noteCardInternalBadgeText}>{t('appointments.internal_only')}</Text>
          </View>
        ) : null}
      </View>
      <TextInput
        style={styles.noteInput}
        value={value}
        onChangeText={onChange}
        multiline
        placeholder="—"
        placeholderTextColor={colors.textTertiary}
      />
    </View>
  )
}

function TaskRow({ task, colors, styles, onToggle, onRemove, locale, saving }: {
  task: AppointmentTask
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
  onToggle: () => void
  onRemove: () => void
  locale: string
  saving?: boolean
}) {
  const { t } = useTranslation()
  const isDone = task.status === 'done'
  const isOverdue = !isDone && !!task.due_at && new Date(task.due_at) < new Date()
  const dueStr = task.due_at
    ? formatDate(task.due_at, locale, { day: '2-digit', month: 'short' })
    : null

  return (
    <View style={[styles.taskRow, isDone && styles.taskRowDone]}>
      {/* TASK-RDV-1 §4 — bascule réversible : le clic fonctionne dans les deux sens (terminer
          puis rouvrir), jamais désactivé une fois terminée. Seule une écriture réellement en
          cours pour CETTE tâche désactive temporairement le contrôle (§18). */}
      <TouchableOpacity
        style={styles.taskCheck}
        onPress={onToggle}
        disabled={saving}
        accessibilityRole="button"
        accessibilityLabel={isDone ? t('appointments.task_reopen_action') : t('appointments.task_done_action')}
      >
        <View style={[styles.taskCheckBox, isDone && { backgroundColor: colors.success, borderColor: colors.success }, saving && { opacity: 0.5 }]}>
          {isDone && <Check size={12} color="#fff" strokeWidth={3} />}
        </View>
      </TouchableOpacity>
      <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]} numberOfLines={2}>
        {task.title}
      </Text>
      <View style={styles.taskMeta}>
        {dueStr && (
          <Text style={[styles.taskDue, isOverdue && { color: colors.danger }]}>{dueStr}</Text>
        )}
        {/* P4 — audit : task_type n'est jamais écrit qu'à 'follow_up' dans tout le code (champ
            rapide + tâche objection auto-générée, les 2 seuls points d'écriture), donc ce badge
            affichait invariablement "Suivi" sur 100% des tâches — aucune valeur informative,
            source de confusion avec le mécanisme de relance. Masqué ici uniquement (affichage) :
            la donnée/colonne/enum et les clés task_types.* restent inchangées, réutilisables si
            une vraie distinction de type est introduite un jour. */}
        {!isDone && (
          <TouchableOpacity onPress={onRemove} style={styles.taskRemove}>
            <Text style={{ color: colors.textTertiary, fontSize: 18 }}>×</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function AppointmentDetailScreen() {
  const { t, i18n } = useTranslation()
  const { id, returnTo, debrief, originAppointmentId } = useLocalSearchParams<{ id: string; returnTo?: string; debrief?: string; originAppointmentId?: string }>()
  const { colors } = useTheme()
  const { getRoleLabel, getPipelineStageLabel, isModuleActive, getAutomationDelay, getLrpName } = useAppConfig()
  const styles = useMemo(() => makeStyles(colors), [colors])

  function goBack() {
    if (returnTo) router.replace(decodeURIComponent(returnTo) as any)
    else router.back()
  }

  // Le libellé doit refléter la destination réelle : sans returnTo, on vient bien de
  // l'agenda ; avec un returnTo vers une fiche contact (le cas le plus fréquent), "Agenda"
  // serait faux — on précise "Fiche contact" ; pour toute autre destination (ex. un autre
  // RDV via le fil d'activité), un libellé générique reste correct dans tous les cas.
  const backLabel = !returnTo
    ? t('appointments.back_agenda')
    : decodeURIComponent(returnTo).includes('/clients/')
      ? t('appointments.back_contact')
      : t('common.back')

  // RDV-HISTORY-NAV-1 §2/§3 — `originAppointmentId` n'existe QUE lorsqu'on consulte l'historique
  // depuis un RDV de travail ; jamais inventé sur une navigation normale (ouverture directe
  // Calendrier/Contact/Relances, §3/§36). `hasOriginParam` ignore un `originAppointmentId` égal à
  // `id` (cas dégénéré : on est revenu à l'origine mais le paramètre traînerait encore) — §9
  // préfère de toute façon le nettoyer explicitement dans l'URL au retour (voir handleReturnToOrigin).
  const hasOriginParam = !!originAppointmentId && originAppointmentId !== id
  const [originItem, setOriginItem] = useState<OriginItem | null>(null)
  // §21 — 'missing' dégrade explicitement vers le comportement de retour standard (goBack), jamais
  // une navigation vers un id devenu invalide. 'loading'/'idle' sont traités comme "en consultation"
  // de façon optimiste (l'origine vient d'être quittée à l'instant, elle est presque toujours valide)
  // — seul un 'missing' confirmé bascule le bouton en mode normal.
  const [originStatus, setOriginStatus] = useState<'idle' | 'loading' | 'found' | 'missing'>('idle')

  const isConsultingHistory = hasOriginParam && originStatus !== 'missing'

  // RDV-HISTORY-NAV-1 §6/§7 — construit l'URL de navigation historique : `replace` (jamais
  // `push`, §6 — pas de pile B/C/D) et report VERBATIM de `returnTo` (déjà encodé une fois, tel
  // que reçu par useLocalSearchParams — jamais ré-encodé ni décodé ici, cohérent avec goBack()
  // ci-dessus qui fait le seul decodeURIComponent nécessaire au moment de l'utiliser réellement).
  function buildAppointmentNavUrl(targetId: string, keepOriginId: string | undefined): string {
    const qp: string[] = []
    if (keepOriginId) qp.push(`originAppointmentId=${keepOriginId}`)
    if (returnTo) qp.push(`returnTo=${returnTo}`)
    return `/(app)/appointments/${targetId}${qp.length ? `?${qp.join('&')}` : ''}`
  }

  // §4/§5 — l'origine est établie UNE SEULE FOIS (au premier clic depuis un RDV normal) puis
  // JAMAIS réécrasée par les clics suivants : `originAppointmentId ?? id`, jamais `id` seul.
  function goToHistoryAppointment(targetId: string) {
    const origin = originAppointmentId ?? id
    router.replace(buildAppointmentNavUrl(targetId, origin) as any)
  }

  // §8/§9/§21 — retour DIRECT au RDV de travail : `replace` vers l'origine SANS
  // originAppointmentId (sortie propre du mode consultation, §9) ; fallback vers le comportement
  // de retour standard si l'origine s'est révélée invalide/inaccessible entre-temps (§21).
  function handleReturnToOrigin() {
    if (!originAppointmentId) return
    if (originStatus === 'missing') { goBack(); return }
    router.replace(buildAppointmentNavUrl(originAppointmentId, undefined) as any)
  }

  const {
    appointment, loading, reload,
    saveNotes, saveBusinessContext, addTask, setTaskDone, refreshTasks, removeTask, update, complete, retryPostCompletion, cancel,
  } = useAppointmentDetail(id ?? null)

  // RDV-HISTORY-NAV-1 §21/§22 — résolution de l'origine (titre/date/statut pour le bloc "RDV
  // actuel", §12) APRÈS `appointment` (garde de contact §22 ci-dessous) : une seule ligne, jamais
  // un N+1 (une seule requête, déclenchée uniquement en mode consultation, §39).
  useEffect(() => {
    if (!hasOriginParam) { setOriginItem(null); setOriginStatus('idle'); return }
    let cancelled = false
    setOriginStatus('loading')
    ;(async () => {
      try {
        const { data } = await supabase.from('appointments').select('id, title, status, start_at, client_id').eq('id', originAppointmentId!).maybeSingle()
        if (cancelled) return
        // §22 — garde de contact : un originAppointmentId d'un AUTRE contact (anormal) ne doit
        // jamais produire un faux bloc "RDV actuel" dans l'historique du contact affiché ici.
        if (data && (!appointment?.client_id || data.client_id === appointment.client_id)) {
          setOriginItem(data as OriginItem)
          setOriginStatus('found')
        } else {
          setOriginItem(null)
          setOriginStatus('missing')
        }
      } catch {
        if (!cancelled) { setOriginItem(null); setOriginStatus('missing') }
      }
    })()
    return () => { cancelled = true }
  }, [hasOriginParam, originAppointmentId, appointment?.client_id])

  // RDV-HISTORY-DATE-1 §2/§7 — ancre temporelle de "Historique RDV" : TOUJOURS le RDV DE TRAVAIL
  // (origine si en consultation, sinon le RDV affiché lui-même), JAMAIS le RDV historique
  // actuellement consulté (B/C/D) — sinon on recrée exactement le problème corrigé par
  // RDV-HISTORY-NAV-1 (la liste se recalculerait à chaque clic historique). §8 — tant que
  // l'origine est en cours de résolution (`originStatus==='loading'`), l'ancre reste `undefined`
  // (jamais un repli temporaire sur `appointment.start_at`, qui serait alors la date du RDV
  // historique affiché, pas celle du RDV de travail) : le useEffect ci-dessous lit cette valeur
  // et n'interroge `clientHistory` qu'une fois l'ancre réellement connue. `originStatus==='missing'`
  // (§21 NAV-1) désactive déjà `isConsultingHistory` — l'ancre retombe alors naturellement sur le
  // RDV affiché lui-même, cohérent avec le retour au mode "fiche normale".
  const historyAnchorStartAt: string | undefined = !hasOriginParam || originStatus === 'missing'
    ? appointment?.start_at
    : (originStatus === 'found' ? originItem?.start_at : undefined)

  const [clientNotes,       setClientNotes]       = useState('')
  const [internalNotes,     setInternalNotes]      = useState('')
  const [needsIdentified,   setNeedsIdentified]    = useState('')
  const [objections,        setObjections]         = useState('')
  const [productsDiscussed, setProductsDiscussed]  = useState('')
  // RDV-PRODUCTS-1 / Lot C — liste structurée, indépendante de productsDiscussed (texte libre
  // conservé tel quel). Chargée une seule fois par RDV (voir effet ci-dessous), jamais
  // re-synchronisée depuis appointment.business_context ensuite : ce state local reste la
  // seule source de vérité affichée, pour ne jamais faire régresser l'UI vers une réponse
  // réseau obsolète pendant une édition rapide (ajout/suppression/quantité/prix successifs).
  const [discussedProducts,  setDiscussedProducts]  = useState<DiscussedProduct[]>([])
  const [showDiscussedPicker, setShowDiscussedPicker] = useState(false)
  const discussedProductsInitRef     = useRef<string | null>(null)
  const discussedProductsInFlightRef = useRef<Promise<void> | null>(null)
  const discussedProductsPendingRef  = useRef<DiscussedProduct[] | null>(null)
  // Lot D — valeur estimée à écrire avec le prochain payload "en attente" (voir persistDiscussedProducts).
  const discussedProductsPendingEstimatedValueRef = useRef<number | undefined>(undefined)
  const discussedProductsTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  // RDV-CLOSURE-PRODUCTS/P1.1 — produits libres (sans productId) déjà importés dans saleProducts
  // via "Reprendre les produits envisagés", suivis par clé locale éphémère DISCUSSED_LOCAL_ID
  // (jamais persistée, jamais un id ajouté au type DiscussedProduct) pour qu'un second clic ne
  // les réimporte pas — stable même si l'objet est recréé par un {...p} ultérieur.
  const importedFreeConsideredRef = useRef<Set<number>>(new Set())
  const discussedLocalIdCounterRef = useRef(0)
  const [notesDirty,        setNotesDirty]         = useState(false)
  const [saving,            setSaving]             = useState(false)
  // RDV-2 — autosauvegarde du compte-rendu, réutilisant exclusivement handleSaveNotes (aucun
  // second mécanisme de persistance). notesVersionRef s'incrémente à chaque frappe (noteChanger)
  // et sert de garde anti-obsolescence (§4) : une réponse réseau en retard ne doit jamais
  // marquer "propre" un contenu déjà remplacé par une saisie plus récente.
  const [notesSaveState, setNotesSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle')
  const notesVersionRef  = useRef(0)
  // RDV-2.1 — sérialisation : au plus une requête réseau de sauvegarde des notes en vol à la
  // fois. saveInFlightRef porte la promesse en cours (les appelants bloqués l'attendent au lieu
  // d'en déclencher une seconde) ; savePendingRef signale qu'un rattrapage est nécessaire dès
  // que la requête en cours se termine. notesLatestRef reflète toujours la valeur React la plus
  // récente des 5 champs, pour que ce rattrapage n'envoie jamais une copie figée.
  const saveInFlightRef = useRef<Promise<boolean> | null>(null)
  const savePendingRef  = useRef(false)
  const notesLatestRef  = useRef({ client_notes: '', internal_notes: '', needs_identified: '', objections: '', products_discussed: '' })
  const [showRecap,         setShowRecap]          = useState(false)
  // RÉCAP-3 — sélection temporaire de composition du récap : jamais persistée, jamais une
  // requête Supabase (§18). `null` = pas encore touché par l'utilisateur → sélection par défaut
  // dérivée de `considered` (§8) ; devient un Set concret dès le premier clic sur une case.
  // Réinitialisés à la fermeture (§19, voir recapModal) et au changement de RDV (voir l'effet
  // d'initialisation de discussedProducts ci-dessous).
  const [recapSelectedOverride, setRecapSelectedOverride] = useState<Set<number> | null>(null)
  const [recapShowPrices,   setRecapShowPrices]      = useState(false)
  // RÉCAP-5D — dernier partage réellement initié pour CE RDV (lecture seule, jamais "envoyé"/
  // "livré"). Une seule lecture par chargement de RDV (§11), plus un refetch ciblé après un
  // nouveau logRecapShare réussi (§12) — jamais de polling.
  const [latestRecapShare,  setLatestRecapShare]     = useState<AppointmentRecapShare | null>(null)
  // RÉCAP-6 — source unique et fiable du "vrai prochain RDV" (voir
  // resolveClientFacingNextAppointment), quelle que soit la manière dont il a été associé.
  // Composeur : `recapIncludeNextAppointmentOverride` suit le même idiome que
  // recapSelectedOverride (RÉCAP-3) — null tant que l'utilisateur n'a rien touché (défaut dérivé
  // de `source`, §7), devient un booléen concret dès le premier clic manuel. `recapNextStepText`
  // est un texte temporaire du compositeur, jamais persisté hors du message final (§12).
  const [clientFacingNextAppointment, setClientFacingNextAppointment] = useState<ClientFacingNextAppointment | null>(null)
  const [recapIncludeNextAppointmentOverride, setRecapIncludeNextAppointmentOverride] = useState<boolean | null>(null)
  const [recapNextStepText, setRecapNextStepText] = useState('')
  // RÉCAP-6.1 — vraies commandes persistées et réellement liées à CE RDV (orders.appointment_id),
  // jamais déduites du résultat "Vente réalisée"/considered/valeur estimée (§ règle absolue).
  // Toutes les commandes sont chargées (y compris annulées, pour la traçabilité sur la fiche RDV,
  // §11 Option B) ; seules les non-annulées sont éligibles au récap (voir recapEligibleOrders).
  const [appointmentOrders, setAppointmentOrders] = useState<Order[]>([])
  // ORDER-BUSINESS-4.2.1 §5 — lignes STRUCTURÉES des commandes liées à ce RDV, pour que le récap
  // partagé (formatOrderProductsForRecap) reflète un vrai retour partiel enregistré depuis
  // OrderEditModal — jamais formatDiscussedProductsForRecap (produits envisagés au RDV, aucune
  // notion de retour, §33 inchangé). Lecture GROUPÉE (une seule requête pour toutes les commandes
  // de CE RDV, en pratique 1 ou 2) — reclenchée à chaque rechargement de `appointmentOrders`.
  const [orderItemsByOrderId, setOrderItemsByOrderId] = useState<Map<string, OrderItem[]>>(new Map())
  useEffect(() => {
    let cancelled = false
    fetchOrderItemsForOrders(appointmentOrders.map(o => o.id)).then(map => { if (!cancelled) setOrderItemsByOrderId(map) }).catch(() => {})
    return () => { cancelled = true }
  }, [appointmentOrders])
  const [recapIncludeOrderOverride, setRecapIncludeOrderOverride] = useState<boolean | null>(null)
  // TASK-RDV-1 §18 — id des tâches dont la bascule terminer/rouvrir est en cours d'écriture,
  // pour désactiver uniquement CETTE ligne pendant l'appel (jamais toute la page).
  const [savingTaskIds,     setSavingTaskIds]      = useState<Set<string>>(new Set())
  const [newTaskTitle,      setNewTaskTitle]       = useState('')
  const [addingTask,        setAddingTask]         = useState(false)
  const [taskError,         setTaskError]          = useState<string | null>(null)
  const [showDebrief,       setShowDebrief]        = useState(false)
  const [isCompleting,      setIsCompleting]       = useState(false)
  const [postWarnings,      setPostWarnings]       = useState<PostCompletionWarningCode[]>([])
  const [retrying,          setRetrying]           = useState(false)
  // Lot 1.2.1 §13 — échec partiel du plan d'actions (commande/recommandation/relance
  // personnelle/lien RDV), distinct des avertissements de complétion (postWarnings) : rejeu
  // idempotent via la même clé, jamais de doublon (index unique partiel en base).
  const [planActionWarnings, setPlanActionWarnings] = useState<OutcomePlanWarnings | null>(null)
  const [retryingPlanActions, setRetryingPlanActions] = useState(false)
  const debriefParamHandled = useRef(false)
  // Lot 1.1 — décision explicite et persistée (jamais vraie par défaut), et flag local pour
  // n'afficher les erreurs de validation qu'après une première tentative de confirmation.
  const [noFollowupRequired, setNoFollowupRequired] = useState(false)
  const [debriefAttempted,   setDebriefAttempted]   = useState(false)
  // Lot 1.2 — brouillon local du résultat : plus d'écriture immédiate au clic (§4). Persisté
  // uniquement à la confirmation de clôture ou de révision. `outcomePendingSwitch` porte le
  // résultat visé quand l'ancien avait déjà des détails saisis, en attente de confirmation
  // explicite d'abandon (jamais silencieux).
  const [outcomeDraft,          setOutcomeDraft]          = useState<AppointmentOutcome | null>(null)
  const [outcomeDetailsDraft,   setOutcomeDetailsDraft]   = useState<AppointmentOutcomeDetails | null>(null)
  const [outcomeOtherLabelDraft, setOutcomeOtherLabelDraft] = useState('')
  const [outcomePendingSwitch,  setOutcomePendingSwitch]  = useState<AppointmentOutcome | null>(null)
  // "Autres retombées" — tags secondaires optionnels, indépendants du résultat principal
  // (outcomeDraft). Jamais leur propre outcome_details, jamais suivis par la révision/
  // client_events — persistés via un simple saveBusinessContext, comme pipeline_stage.
  const [otherOutcomesDraft,    setOtherOutcomesDraft]    = useState<AppointmentOutcome[]>([])
  // Vente réalisée — lignes de produits en brouillon (créent une vraie commande à la confirmation
  // finale uniquement — clôture ou révision, jamais au clic, Lot 1.2.1 §2).
  const [saleProducts,      setSaleProducts]      = useState<OutcomeSaleProduct[]>([])
  const [showSalePicker,    setShowSalePicker]    = useState(false)
  const [saleListExpanded,  setSaleListExpanded]  = useState(false)
  const [isFirstOrderFlag,  setIsFirstOrderFlag]  = useState(false)
  // LRP-3 §22 — mêmes règles/même composant qu'une commande créée hors RDV (jamais une logique
  // spécifique au RDV). isLrpSaleDraft reflète l'état réel de la commande déjà créée (revision) ;
  // lrpProgramValueDraft n'est renseigné que par une interaction explicite (jamais préremplie
  // automatiquement) et n'est utilisé qu'à la clôture initiale (jamais en révision, §19).
  const [isLrpSaleDraft,       setIsLrpSaleDraft]       = useState(false)
  const [lrpProgramValueDraft, setLrpProgramValueDraft] = useState<LrpProgramValue | null>(null)
  // Intéressé — recommandation ajoutée au plan seulement sur choix explicite (§6), créée
  // uniquement à la confirmation finale, jamais automatique.
  const [recommendationPlanned, setRecommendationPlanned] = useState(false)
  // RDV-CLOSURE-PRODUCTS/P2.1 — sélection ÉPHÉMÈRE (jamais persistée séparément) d'AU PLUS UN
  // produit déjà envisagé (discussed_products, considered=true) pour CETTE recommandation —
  // recommendations.product_id/catalog_id sont singuliers (1 ligne = 1 produit, audit P2),
  // jamais une multi-sélection jointe dans product_name. Index dans discussedProducts, jamais
  // présélectionné (§4 : aucune sélection automatique depuis considered=true).
  const [recommendationProductIndex, setRecommendationProductIndex] = useState<number | null>(null)
  // Relance automatique prévisualisée (lecture seule, §11) et relance personnelle (§12-14) —
  // ajoutée au plan, créée uniquement à la confirmation finale (Lot 1.2.1 §2).
  const [personalFollowupType,    setPersonalFollowupType]    = useState<NextActionType>('call')
  const [personalFollowupDate,    setPersonalFollowupDate]    = useState('')
  // RDV-FOLLOWUP-1/P0 (suite) — nombre de jours éditable (« J+ »), même pattern que
  // followupPlanDelayInput plus bas (relances suite à l'intention commerciale) : reste
  // synchronisé avec personalFollowupDate (source de vérité pour l'enregistrement), permet de
  // personnaliser le délai sans avoir à taper une date ISO exacte.
  const [personalFollowupDelayDays, setPersonalFollowupDelayDays] = useState('7')
  const [personalFollowupTitle,   setPersonalFollowupTitle]   = useState('')
  const [personalFollowupComment, setPersonalFollowupComment] = useState('')
  const [personalFollowupPlanned, setPersonalFollowupPlanned] = useState(false)
  // RDV-FOLLOWUP-1/P0 §11-14 — tant que l'utilisateur n'a pas lui-même touché la case "Créer
  // une relance" (ou l'un de ses champs) pour ce débrief/cette révision, son état par défaut
  // continue à suivre automatiquement la présence d'un prochain RDV réel (selectedUpcomingId).
  // Dès qu'il la modifie explicitement, cette valeur par défaut ne doit plus jamais l'écraser.
  const personalFollowupUserTouchedRef = useRef(false)
  const [followupConflict,        setFollowupConflict]        = useState<FollowupConflict | null>(null)
  const [confirmConflict,         setConfirmConflict]         = useState(false)
  // RDV futurs existants du contact — réutiliser comme suite plutôt que dupliquer (§13).
  const [upcomingAppts,       setUpcomingAppts]       = useState<UpcomingAppointmentOption[]>([])
  const [selectedUpcomingId,  setSelectedUpcomingId]  = useState<string | null>(null)
  // Modification après clôture (§15-16) — plan de révision chargé depuis la base réelle. La
  // révision réutilise les mêmes brouillons que la clôture (outcomeDraft, outcomeDetailsDraft,
  // saleProducts, recommendationPlanned, personalFollowup*, selectedUpcomingId) — une seule
  // implémentation des formulaires conditionnels, jamais deux qui dériveraient (Lot 1.2.1 §5).
  const [showRevision,        setShowRevision]        = useState(false)
  const [revisionPlan,        setRevisionPlan]        = useState<OutcomeRevisionPlan | null>(null)
  const [revisionExpectedRevision, setRevisionExpectedRevision] = useState<number | null>(null)
  const [revisionConflict,    setRevisionConflict]    = useState(false)
  const [revisionReason,      setRevisionReason]      = useState<OutcomeRevisionReason | ''>('')
  const [revisionCancelFollowups, setRevisionCancelFollowups] = useState<Set<string>>(new Set())
  const [revisionCancelTasks,     setRevisionCancelTasks]     = useState<Set<string>>(new Set())
  const [revisionCancelRecos,     setRevisionCancelRecos]     = useState<Set<string>>(new Set())
  const [revisionSaving,      setRevisionSaving]      = useState(false)
  const [revisionError,       setRevisionError]       = useState<string | null>(null)
  const [revisionReasonOtherText, setRevisionReasonOtherText] = useState('')
  // Choix explicite (§7) — jamais déduit des annulations. Forcé à false (et désactivé) dès
  // qu'une action est créée ou conservée ; sinon doit être coché explicitement pour confirmer.
  const [revisionNoFollowupRequired, setRevisionNoFollowupRequired] = useState(false)
  const [followupPlan, setFollowupPlan] = useState<Record<PostCompletionPlanKey, { create: boolean; delayDays: number }>>({
    buy_product:       { create: true, delayDays: 3 },
    become_distributor: { create: true, delayDays: 2 },
    objection_task:     { create: true, delayDays: 1 },
  })
  // Relancer ce RDV — section autonome sur la fiche (pas liée à la complétion), deux
  // chemins : relance sans date connue (followup), ou RDV précis (date/heure/but connus).
  // Le RDV précis créé ici est repris automatiquement dans le récap.
  const [nextStepMode,       setNextStepMode]       = useState<'unknown' | 'known' | null>(null)
  const [relanceDays,        setRelanceDays]        = useState('14')
  const [relanceNote,        setRelanceNote]        = useState('')
  const [creatingRelance,    setCreatingRelance]    = useState(false)
  const [relanceCreated,     setRelanceCreated]     = useState(false)
  const [proposeNextDate,    setProposeNextDate]    = useState('')
  const [proposeNextTime,    setProposeNextTime]    = useState('')
  const [proposeNextEndTime, setProposeNextEndTime] = useState('')
  const [proposeNextPurpose, setProposeNextPurpose] = useState('')
  const [showNextCal,        setShowNextCal]        = useState(false)
  const [showNextStartTime,  setShowNextStartTime]  = useState(false)
  const [showNextEndTime,    setShowNextEndTime]    = useState(false)
  const [nextRdvDayAppointments, setNextRdvDayAppointments] = useState<CalendarBusyAppointment[]>([])
  const [creatingNextRdv,    setCreatingNextRdv]    = useState(false)
  const [nextRdvCreated,     setNextRdvCreated]     = useState(false)
  const [nextStepError,      setNextStepError]      = useState<string | null>(null)
  const lastPlanRef = useRef<PostCompletionPlan | undefined>(undefined)
  const lastActionPlanRef = useRef<AppointmentOutcomeActionPlan | null>(null)
  const [showCancelConfirm, setShowCancelConfirm]  = useState(false)
  const [cancelling,        setCancelling]         = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm]  = useState(false)
  const [deletingAppointment, setDeletingAppointment] = useState(false)
  const [inlineError,       setInlineError]        = useState<string | null>(null)
  const [practitionerName,  setPractitionerName]   = useState('')
  const [clientInfo,        setClientInfo]         = useState<ClientInfo | null>(null)
  // LRP-4.1 §3 — tous les programmes actifs du contact (pas "le" plus proche) : 2+ candidats
  // imposent un choix explicite dans LrpProgramFields, jamais un rattachement silencieux.
  const [activePrograms, setActivePrograms] = useState<RecurringProgram[]>([])
  const [clientHistory,     setClientHistory]      = useState<HistoryItem[]>([])
  const [clientPendingTasks, setClientPendingTasks] = useState<AppointmentTask[]>([])
  const { recommendations: clientRecommendations }  = useRecommendations(appointment?.client_id ?? '')
  const [estValue,          setEstValue]           = useState('')
  const [bizValueDirty,     setBizValueDirty]      = useState(false)
  const [savingBizValue,    setSavingBizValue]     = useState(false)
  // RDV-PRODUCTS-1 / Lot D — même principe que personalFollowupUserTouchedRef (RDV-FOLLOWUP-1) :
  // tant que l'utilisateur n'a jamais modifié "Valeur estimée" à la main pour CE RDV, elle reste
  // pilotée automatiquement par le total des produits envisagés. Dès qu'il la touche, plus aucun
  // recalcul automatique ne l'écrase — jamais réinitialisé sauf changement de RDV.
  const estimatedValueUserTouchedRef = useRef(false)
  // RDV-1 §9 — même famille que estValue/bizValueDirty (champ de appointment_business_context
  // sauvegardé immédiatement sur la page principale, pas un brouillon de débrief).
  const [intentOtherLabel,        setIntentOtherLabel]        = useState('')
  const [intentOtherLabelDirty,   setIntentOtherLabelDirty]   = useState(false)
  const [savingIntentOtherLabel,  setSavingIntentOtherLabel]  = useState(false)

  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { width: screenW } = useWindowDimensions()
  const isWeb  = Platform.OS === 'web' && screenW >= 768

  // ── Effects ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const n = appointment?.notes
    if (!n) return
    setClientNotes(n.client_notes ?? '')
    setInternalNotes(n.internal_notes ?? '')
    setNeedsIdentified(n.needs_identified ?? '')
    setObjections(n.objections ?? '')
    setProductsDiscussed(n.products_discussed ?? '')
    setNotesDirty(false)
    // RDV-2 §9 — chargement depuis Supabase, jamais une saisie utilisateur : ne doit jamais
    // déclencher l'autosave ni laisser un indicateur d'un RDV précédent (§10, cet écran peut
    // être réutilisé d'un RDV à l'autre sans démontage — même route dynamique).
    setNotesSaveState('idle')
  }, [appointment?.notes])

  useEffect(() => {
    const biz = appointment?.business_context
    setEstValue(biz?.estimated_value != null ? String(biz.estimated_value) : '')
    setBizValueDirty(false)
    setIntentOtherLabel(biz?.commercial_intent_other_label ?? '')
    setIntentOtherLabelDirty(false)
  }, [appointment?.business_context])

  // RDV-PRODUCTS-1 / Lot C — initialise discussedProducts une seule fois par RDV (jamais à
  // chaque mutation de business_context, contrairement à estValue/intentOtherLabel ci-dessus :
  // une sauvegarde en vol y réinitialiserait à tort le brouillon en cours d'édition). La porte
  // de sauvegarde (in-flight/pending/timer) est aussi réinitialisée ici — jamais partagée entre
  // deux RDV différents de cet écran réutilisé sans démontage (même principe que RDV-2.1 §10).
  useEffect(() => {
    if (!appointment) return
    if (discussedProductsInitRef.current === appointment.id) return
    discussedProductsInitRef.current = appointment.id
    discussedLocalIdCounterRef.current = 0
    setDiscussedProducts((appointment.business_context?.discussed_products ?? []).map(tagWithDiscussedLocalId))
    discussedProductsInFlightRef.current = null
    discussedProductsPendingRef.current = null
    discussedProductsPendingEstimatedValueRef.current = undefined
    if (discussedProductsTimerRef.current) { clearTimeout(discussedProductsTimerRef.current); discussedProductsTimerRef.current = null }
    importedFreeConsideredRef.current = new Set()
    // RÉCAP-3 — le composeur de récap ne doit jamais garder la sélection/l'affichage des prix
    // d'un RDV précédent quand cet écran est réutilisé sans démontage (même principe que le
    // reste de ce bloc).
    setShowRecap(false)
    setRecapSelectedOverride(null)
    setRecapShowPrices(false)
    setLatestRecapShare(null)
    // RÉCAP-5D §11 — une seule lecture par chargement de ce RDV (gardée par
    // discussedProductsInitRef comme le reste de ce bloc), jamais dans le render.
    getLatestRecapShareForAppointment(appointment.id).then(setLatestRecapShare).catch(() => {})
    // RÉCAP-6 §19 — même porte "une fois par RDV" ; le composeur (inclusion/texte) repart
    // toujours de zéro pour un nouveau RDV.
    setRecapIncludeNextAppointmentOverride(null)
    setRecapNextStepText('')
    if (appointment.client_id) {
      resolveClientFacingNextAppointment(appointment.id, appointment.client_id)
        .then(setClientFacingNextAppointment)
        .catch(() => setClientFacingNextAppointment(null))
    } else {
      setClientFacingNextAppointment(null)
    }
    // RÉCAP-6.1 §29 — même porte "une fois par RDV" : un changement de RDV charge uniquement les
    // commandes du nouveau RDV, sans résidu du composeur précédent.
    setAppointmentOrders([])
    setRecapIncludeOrderOverride(null)
    getOrdersForAppointment(appointment.id).then(setAppointmentOrders).catch(() => setAppointmentOrders([]))
    // Lot D.1 — toute valeur déjà présente au chargement (y compris ancienne/manuelle, y
    // compris 0 — une vraie valeur métier, distincte de "absente") est traitée par prudence
    // comme manuelle dès le départ : jamais écrasée par un recalcul automatique tant que
    // l'utilisateur n'a pas explicitement choisi "Utiliser X €" (seule action qui repasse en
    // mode automatique). Seule l'absence de valeur (null) laisse l'auto-calcul actif d'emblée.
    estimatedValueUserTouchedRef.current = appointment.business_context?.estimated_value != null
  }, [appointment])

  // ORDER-SYNC-1 §12 — la commande liée au RDV peut être modifiée depuis un autre écran
  // ("Voir la commande" → page Commandes → OrderEditModal → Enregistrer, puis retour arrière).
  // Refetch ciblé à chaque reprise de focus sur cet écran, jamais un polling ni un realtime :
  // même pattern déjà utilisé sur la fiche contact (clients/[id]/index.tsx). En cas d'échec,
  // conserve l'état déjà affiché plutôt que de le vider.
  useFocusEffect(useCallback(() => {
    if (!appointment) return
    getOrdersForAppointment(appointment.id).then(setAppointmentOrders).catch(() => {})
  }, [appointment?.id]))

  // TASK-RDV-1 (fix) — une tâche liée à ce RDV peut être terminée/rouverte depuis la fiche
  // Contact ("Tâches à faire"/"Terminées") pendant que cette fiche RDV reste montée (retour
  // arrière dans la navigation, jamais un remount). Même principe que le refresh des commandes
  // ci-dessus : refetch ciblé au focus, jamais de polling.
  useFocusEffect(useCallback(() => {
    if (!appointment) return
    refreshTasks()
  }, [appointment?.id, refreshTasks]))

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('full_name').eq('id', user.id).single()
        .then(({ data }) => { if (data?.full_name) setPractitionerName(abbreviateName(data.full_name as string)) })
    })
  }, [])

  // RDV déjà planifiés (tous contacts confondus), pour les voir sur le calendrier avant
  // de fixer une nouvelle date — fenêtre large mais bornée (90 jours) pour rester léger.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      const from = new Date().toISOString()
      const to = new Date(Date.now() + 90 * 86400000).toISOString()
      supabase.from('appointments').select('start_at, end_at, title')
        .eq('user_id', user.id)
        .in('status', ['scheduled', 'rescheduled'])
        .gte('start_at', from)
        .lte('start_at', to)
        .then(({ data }) => {
          if (data) setNextRdvDayAppointments(data)
        })
    })
  }, [])

  // Navigation depuis la fiche Contact ("Terminer et débriefer") : ouvre la modale de
  // débrief, que le RDV soit déjà completed (lecture/édition) ou pas encore (confirmation
  // puis complétion). Le paramètre est consommé une seule fois (ref) puis neutralisé via
  // router.setParams, pour éviter toute réouverture en boucle et permettre une réouverture
  // volontaire ultérieure depuis l'interface (pill "Completed").
  useEffect(() => {
    if (debrief === '1' && appointment && !debriefParamHandled.current) {
      debriefParamHandled.current = true
      setShowDebrief(true)
      router.setParams({ debrief: undefined } as any)
    }
  }, [debrief, appointment])

  // RDV-NEXT-STEP hotfix — relanceCreated/nextRdvCreated (section "Suite du rendez-vous") sont
  // de purs états locaux, jamais persistés : sans cette relecture au chargement, revenir sur la
  // fiche (ou recharger la page) réaffichait le formulaire vide comme si rien n'avait été créé,
  // avec un risque réel de doublon si l'utilisateur cliquait à nouveau. On relit ici les deux
  // ressources déjà liées à ce RDV (lien structurel followup_of_appointment_id pour le RDV,
  // closure_action_key dédiée pour la relance) pour reconstituer l'état affiché.
  useEffect(() => {
    if (!id) return
    supabase
      .from('appointments')
      .select('title, start_at, end_at')
      .eq('followup_of_appointment_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        const start = new Date(data.start_at)
        const end = new Date(data.end_at)
        setProposeNextDate(`${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`)
        setProposeNextTime(`${pad2(start.getHours())}:${pad2(start.getMinutes())}`)
        setProposeNextEndTime(`${pad2(end.getHours())}:${pad2(end.getMinutes())}`)
        setProposeNextPurpose(data.title)
        setNextStepMode('known')
        setNextRdvCreated(true)
      })
    supabase
      .from('followups')
      .select('id')
      .eq('appointment_id', id)
      .eq('closure_action_key', `${id}:next_step_relance`)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setNextStepMode('unknown')
        setRelanceCreated(true)
      })
  }, [id])

  // Réinitialise les choix de relances à chaque ouverture de la modale (valeurs par défaut
  // cochées, délais historiques) — évite qu'un choix d'un débrief précédent ne fuite sur le suivant.
  useEffect(() => {
    if (showDebrief) {
      setFollowupPlan({
        buy_product:        { create: true, delayDays: 3 },
        become_distributor:  { create: true, delayDays: 2 },
        objection_task:      { create: true, delayDays: 1 },
      })
      setNoFollowupRequired(biz?.no_followup_required ?? false)
      setDebriefAttempted(false)
      // Lot 1.2 — brouillon initialisé depuis l'état persisté (jamais 'follow_up_required',
      // qui n'est plus un choix actif — voir §3).
      const persisted = biz?.outcome && biz.outcome !== 'follow_up_required' ? biz.outcome : null
      const persistedDetails = persisted ? (biz?.outcome_details ?? defaultDetailsFor(persisted)) : null
      setOutcomeDraft(persisted)
      setOutcomeDetailsDraft(persistedDetails)
      setOutcomeOtherLabelDraft(biz?.outcome_other_label ?? '')
      setOutcomePendingSwitch(null)
      setOtherOutcomesDraft(biz?.other_outcomes ?? [])
      // LRP-3 — reflète l'état réel de la commande déjà liée à ce RDV (jamais présumé) ; le bloc
      // "Programme récurrent" lui-même n'est jamais préaffiché ici (uniquement à la clôture
      // initiale, §19) — voir rendu conditionné par !showRevision.
      setIsLrpSaleDraft(appointmentOrders.find(o => !o.cancelled_at)?.is_lrp ?? false)
      setLrpProgramValueDraft(null)
      setSaleProducts(persistedDetails?.kind === 'sale_completed' ? persistedDetails.products : [])
      setRecommendationPlanned(false)
      setRecommendationProductIndex(null)
      // RDV-FOLLOWUP-1/P0 §6-12 — relance après RDV préremplie par défaut à partir de la règle
      // appt_j7 (type/délai/titre, délai global respecté via getAutomationDelay) plutôt que
      // laissée vide : suggestion modifiable/décochable, jamais une valeur imposée.
      personalFollowupUserTouchedRef.current = false
      const apptRule = AUTOMATION_RULES.find(r => r.id === 'appt_j7')
      const firstNameForRule = clientInfo?.first_name || clientInfo?.full_name?.split(' ')[0] || ''
      setPersonalFollowupPlanned(true)
      setPersonalFollowupType(apptRule?.actionType ?? 'whatsapp')
      setPersonalFollowupTitle(apptRule ? apptRule.title.replace(/\{prénom\}/g, firstNameForRule) : '')
      setPersonalFollowupComment('')
      {
        const delayDays = apptRule ? getAutomationDelay(apptRule.id, apptRule.delayDays) : 7
        setPersonalFollowupDelayDays(String(delayDays))
        setPersonalFollowupDate(dueDateStr(delayDays))
      }
      setFollowupConflict(null)
      setConfirmConflict(false)
      setSelectedUpcomingId(null)
      if (appointment?.client_id) {
        fetchUpcomingAppointmentsForClient(appointment.client_id, id).then(setUpcomingAppts).catch(() => setUpcomingAppts([]))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDebrief])

  // RDV-FOLLOWUP-1/P0 §12-14 — décochée par défaut dès qu'un prochain RDV réel est sélectionné
  // (un vrai engagement, pas une simple proposition textuelle de récap), mais seulement tant
  // que l'utilisateur n'a pas lui-même déjà modifié la case : jamais de règle dure, jamais
  // d'écrasement d'un choix déjà fait manuellement.
  useEffect(() => {
    if (!showDebrief && !showRevision) return
    if (personalFollowupUserTouchedRef.current) return
    setPersonalFollowupPlanned(!selectedUpcomingId)
  }, [selectedUpcomingId, showDebrief, showRevision])

  useEffect(() => {
    const cid = appointment?.client_id
    if (!cid) return
    supabase.from('clients').select('id, full_name, status, first_name, phone, email, next_lrp_date, contact_role').eq('id', cid).single()
      .then(({ data }) => { if (data) setClientInfo(data as ClientInfo) })
    // LRP-4.1 §3 — tous les programmes actifs, source pour le sélecteur "Commande {nom du
    // programme}" de la section vente (remplace clientInfo.lrp_*).
    fetchProgramsForClient(cid).then(all => setActivePrograms(all.filter(p => p.status === 'active'))).catch(() => setActivePrograms([]))
    // RDV-HISTORY-DATE-1 §2/§9/§10 — "Historique RDV" = uniquement les RDV ANTÉRIEURS au RDV de
    // travail (historyAnchorStartAt, défini plus haut) : filtre temporel strict `start_at <
    // ancre`, jamais `appointment!.id` (le RDV historique consulté B/C/D changeait à chaque
    // navigation, ce qui recalculait toute la liste — bug corrigé par RDV-HISTORY-NAV-1 pour
    // l'exclusion par id, puis ici pour la dimension temporelle). `.neq('id', ...)` devient
    // redondant et est supprimé (§10) : un RDV ne peut jamais satisfaire `start_at < son propre
    // start_at`, l'ancre s'exclut donc déjà elle-même par la seule comparaison de date — jamais le
    // RDV historique consulté, dont le start_at reste antérieur à l'ancre tout du long (§5).
    // §8 — tant que l'ancre n'est pas encore connue (origine en cours de résolution), on
    // n'interroge PAS avec la date du RDV historique affiché : `clientHistory` garde son dernier
    // état correct (celui du RDV de travail) jusqu'à ce que l'ancre réelle soit résolue.
    if (historyAnchorStartAt !== undefined) {
      supabase.from('appointments')
        .select('id, title, status, start_at')
        .eq('client_id', cid)
        .lt('start_at', historyAnchorStartAt)
        .order('start_at', { ascending: false })
        .limit(5)
        .then(({ data }) => { if (data) setClientHistory(data as HistoryItem[]) })
    }
    // Tâches en attente issues d'autres RDV (ou non rattachées à un RDV précis) —
    // "éléments à ne pas oublier" avant celui-ci. `.neq` exclurait à tort les tâches sans
    // appointment_id (NULL) en SQL à 3 valeurs — on les inclut explicitement via `.or`.
    supabase.from('appointment_tasks')
      .select('*')
      .eq('client_id', cid)
      .in('status', ['pending', 'in_progress'])
      .or(`appointment_id.is.null,appointment_id.neq.${appointment!.id}`)
      .order('due_at', { ascending: true })
      .then(({ data }) => { if (data) setClientPendingTasks(data as AppointmentTask[]) })
  }, [appointment?.client_id, appointment?.id, historyAnchorStartAt])

  // RDV-2 §3/§9/§10 — autosave débattu (~1200 ms d'inactivité), rebranché sur handleSaveNotes.
  // Se réarme à chaque frappe (dépendances = les 5 champs + notesDirty) ; ne programme rien
  // tant que notesDirty est faux (donc jamais au chargement initial, §9). `id` en dépendance :
  // un changement de RDV annule tout timer en attente via le nettoyage de l'effet précédent,
  // avant même que le nouveau RDV ne soit chargé — jamais d'écriture croisée entre deux RDV (§10).
  useEffect(() => {
    if (!notesDirty) return
    const timer = setTimeout(() => { void handleSaveNotes() }, 1200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientNotes, internalNotes, needsIdentified, objections, productsDiscussed, notesDirty, id])

  // RDV-2.1 — miroir toujours à jour des 5 champs, lu par le rattrapage interne de
  // handleSaveNotes (jamais une copie figée d'un ancien rendu — voir §5).
  useEffect(() => {
    notesLatestRef.current = {
      client_notes: clientNotes, internal_notes: internalNotes, needs_identified: needsIdentified,
      objections, products_discussed: productsDiscussed,
    }
  }, [clientNotes, internalNotes, needsIdentified, objections, productsDiscussed])

  // RDV-2.1 §10 — changement de RDV : la garde de sérialisation ne doit jamais retenir la
  // sauvegarde du nouveau RDV derrière une requête en vol de l'ancien. La requête déjà en vol
  // continue de résoudre indépendamment (elle cible toujours son RDV d'origine via son propre
  // saveNotes fermé sur l'ancien id) ; on ne fait que réinitialiser la porte pour le nouveau RDV.
  // notesVersionRef est aussi avancé (jamais réinitialisé à 0, pour ne jamais réutiliser un
  // numéro déjà attribué) : sans ça, une réponse tardive de l'ancien RDV pourrait coïncider
  // avec la version courante du nouveau si l'utilisateur n'a encore rien tapé dessus, et lui
  // faire afficher à tort "✓ Enregistré".
  useEffect(() => {
    saveInFlightRef.current = null
    savePendingRef.current = false
    notesVersionRef.current += 1
  }, [id])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function noteChanger(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setNotesDirty(true)
      // RDV-2 §4 — une frappe = une nouvelle version ; toute réponse de sauvegarde antérieure
      // à cette version ne devra plus marquer le compte-rendu "propre" (voir handleSaveNotes).
      notesVersionRef.current += 1
      setNotesSaveState('dirty')
    }
  }

  // RDV-2 / RDV-2.1 — fonction de sauvegarde UNIQUE, appelée aussi bien par le bouton manuel,
  // par l'autosave (debounce ci-dessus), que par les filets de sécurité déjà existants avant
  // clôture (handleStatusChange/handleConfirmDebrief) — aucun second mécanisme. RDV-2.1 y
  // ajoute uniquement la sérialisation réseau (§2-5) : jamais deux requêtes en vol, un appelant
  // "bloqué" attend la fin réelle de toute la chaîne (y compris un éventuel rattrapage), jamais
  // seulement le début — condition nécessaire à §9 (clôture pendant une sauvegarde en cours).
  async function handleSaveNotes(): Promise<boolean> {
    if (!notesDirty) return true

    if (saveInFlightRef.current) {
      // Une sauvegarde est déjà en vol : ne jamais en démarrer une seconde en parallèle.
      // On demande seulement un rattrapage (avec les valeurs les plus récentes, lues au moment
      // où il s'exécutera réellement — notesLatestRef, jamais une copie figée de cet appel-ci),
      // et on attend la MÊME promesse que la requête en cours pour ne rendre la main qu'une
      // fois toute la chaîne réellement terminée.
      savePendingRef.current = true
      return saveInFlightRef.current
    }

    const run = async (): Promise<boolean> => {
      const requestVersion = notesVersionRef.current
      setSaving(true)
      setNotesSaveState('saving')
      setInlineError(null)
      const ok = await saveNotes({
        client_notes:       notesLatestRef.current.client_notes || undefined,
        internal_notes:     notesLatestRef.current.internal_notes || undefined,
        needs_identified:   notesLatestRef.current.needs_identified || undefined,
        objections:         notesLatestRef.current.objections || undefined,
        products_discussed: notesLatestRef.current.products_discussed || undefined,
      })
      setSaving(false)
      if (!ok) {
        setInlineError(t('appointments.error_save_notes'))
        setNotesSaveState('error')
        // §8 — pas de boucle de retry automatique : une éventuelle version plus récente reste
        // simplement non sauvegardée, jusqu'à une nouvelle frappe ou une action manuelle.
        savePendingRef.current = false
        return false
      }
      // §4/§6 — ne marque "propre" que si aucune frappe plus récente n'a eu lieu pendant
      // l'appel réseau (notesVersionRef inchangé depuis le déclenchement de CETTE requête).
      if (notesVersionRef.current === requestVersion) {
        setNotesDirty(false)
        setNotesSaveState('saved')
      }
      if (savePendingRef.current) {
        savePendingRef.current = false
        return run()
      }
      return true
    }

    const promise = run()
    saveInFlightRef.current = promise
    const result = await promise
    // Ne libère la porte que si elle nous appartient toujours (jamais reprise entre-temps par
    // un changement de RDV, §10) — évite qu'une résolution tardive n'efface une garde plus
    // récente légitimement posée pour un autre RDV.
    if (saveInFlightRef.current === promise) saveInFlightRef.current = null
    return result
  }

  async function handleStatusChange(status: AppointmentStatus) {
    if (isCompleting) return // garde anti-double-clic

    setInlineError(null)

    if (status === 'completed') {
      // Un RDV cancelled/no_show ne peut jamais être complété — refus immédiat côté UI,
      // en plus du rejet contrôlé côté service (défense en profondeur).
      if (appointment?.status === 'cancelled') { setInlineError(t('appointments.error_cannot_complete_cancelled')); return }
      if (appointment?.status === 'no_show')   { setInlineError(t('appointments.error_cannot_complete_no_show'));   return }

      // RDV-1 §9 — validation UI uniquement (n'écrit rien, ne touche pas au moteur de
      // clôture) : une intention "Autre" non précisée bloque l'ouverture du débrief.
      // `appointment.business_context` directement (et non la const `biz`, calculée plus bas
      // dans le rendu, hors de portée ici).
      const bizCtx = appointment?.business_context
      if (bizCtx?.commercial_intent?.includes('other') && !bizCtx.commercial_intent_other_label?.trim()) {
        setInlineError(t('appointments.error_intent_other_required'))
        return
      }

      // On ne complète JAMAIS directement au clic : le débrief doit être confirmé d'abord.
      // Les notes déjà saisies (objections incluses) sont sauvegardées avant d'ouvrir la
      // modale, pour que la confirmation du débrief parte d'un état à jour.
      if (notesDirty) {
        const ok = await handleSaveNotes()
        if (!ok) return
      }
      setPostWarnings([])
      setShowDebrief(true)
      return
    }

    const ok = await update({ status })
    if (!ok) { setInlineError(t('appointments.error_update_status')); return }
  }

  // Confirmation du débrief : sauvegarde déjà faite (notes + contexte commercial, ce
  // dernier pill par pill au fur et à mesure) → seulement ensuite completeAppointment().
  // Idempotent pour un RDV déjà completed (alreadyCompleted, aucune erreur).
  // Ne construit une entrée de plan que pour les relances effectivement suggérées (mêmes
  // conditions que l'affichage dans la modale) — un item absent du plan retombe, côté
  // service, sur la dérivation automatique historique si le plan complet n'existait pas,
  // mais ici le plan est toujours construit explicitement dès que la modale est confirmée.
  function buildFollowupPlan(): PostCompletionPlan {
    const plan: PostCompletionPlan = []
    if (biz?.commercial_intent?.includes('buy_product')) {
      plan.push({ key: 'buy_product', ...followupPlan.buy_product })
    }
    if (biz?.commercial_intent?.includes('become_distributor')) {
      plan.push({ key: 'become_distributor', ...followupPlan.become_distributor })
    }
    if (objections.trim()) {
      plan.push({ key: 'objection_task', ...followupPlan.objection_task })
    }
    return plan
  }

  // Relance sans date connue — le client ne sait pas encore quand, on se contente de se
  // rappeler de le recontacter dans N jours.
  async function handleCreateRelance() {
    if (!appointment?.client_id || creatingRelance) return
    setCreatingRelance(true)
    setNextStepError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('not authenticated')
      const days = Math.max(1, parseInt(relanceDays, 10) || 14)
      const due = new Date(Date.now() + days * 86400000)
      await createFollowup(user.id, {
        client_id: appointment.client_id,
        title: t('appointments.next_step_relance_title'),
        content: relanceNote.trim() || null,
        due_date: `${due.getFullYear()}-${pad2(due.getMonth() + 1)}-${pad2(due.getDate())}`,
        done: false,
        action_type: null,
        // RDV-NEXT-STEP hotfix — même correctif que handleCreateNextRdv : lien + clé
        // d'idempotence pour retrouver cette relance après un rechargement (sinon la case
        // "Relance créée" repasse à l'état initial et un second clic recrée un doublon).
        appointment_id: id,
        closure_action_key: `${id}:next_step_relance`,
      })
      setRelanceCreated(true)
    } catch (err) {
      console.error('[handleCreateRelance]', err)
      setNextStepError(t('appointments.next_step_error'))
    } finally {
      setCreatingRelance(false)
    }
  }

  // RDV précis — date/heure/but déjà connus, on planifie directement le prochain RDV.
  async function handleCreateNextRdv() {
    if (creatingNextRdv) return
    if (!proposeNextDate || !proposeNextTime || !proposeNextPurpose.trim() || !appointment) {
      setNextStepError(t('appointments.error_next_rdv_fields_required'))
      return
    }
    setNextStepError(null)
    const start_at = toISO(proposeNextDate, proposeNextTime)
    const end_at = proposeNextEndTime
      ? toISO(proposeNextDate, proposeNextEndTime)
      : new Date(new Date(start_at).getTime() + 60 * 60000).toISOString()
    if (new Date(end_at) <= new Date(start_at)) {
      setNextStepError(t('appointments.error_end_before_start'))
      return
    }
    setCreatingNextRdv(true)
    setNextStepError(null)
    try {
      await createAppointment({
        client_id: appointment.client_id ?? undefined,
        title: proposeNextPurpose.trim(),
        appointment_type: 'follow_up',
        start_at,
        end_at,
        // RDV-NEXT-STEP hotfix — lien structurel vers ce RDV source (déjà utilisé ailleurs par
        // linkAppointmentAsFollowup) : sans lui, impossible de savoir après un rechargement
        // qu'un prochain RDV a déjà été planifié depuis cette fiche, au risque d'en recréer un
        // second en pensant que rien n'avait été créé (§ signalé par l'utilisateur).
        followup_of_appointment_id: id,
      })
      setNextRdvCreated(true)
      // RÉCAP-6 — mise à jour optimiste immédiate (même donnée que ce qui vient d'être créé),
      // sans requête supplémentaire : ce RDV est structurellement lié (followup_of_appointment_id)
      // donc resolveClientFacingNextAppointment le retrouverait de toute façon en priorité 1.
      setClientFacingNextAppointment({ startAt: start_at, purpose: proposeNextPurpose.trim(), source: 'linked' })
    } catch (err) {
      console.error('[handleCreateNextRdv]', err)
      setNextStepError(t('appointments.next_step_error'))
    } finally {
      setCreatingNextRdv(false)
    }
  }

  async function handleConfirmDebrief() {
    if (isCompleting) return // empêche une double soumission
    setDebriefAttempted(true)
    // Lot 1.2 §19 — validations dans l'ordre : résultat, détails conditionnels, décision de
    // suite. Revérifiées aussi côté service (defense in depth), voir completeAppointment().
    if (!outcomeDraft) { setInlineError(t('appointments.error_outcome_required')); return }
    if (outcomeDraft === 'other' && !outcomeOtherLabelDraft.trim()) { setInlineError(t('appointments.error_outcome_other_required')); return }
    // RDV-FOLLOWUP-1/P0 — la case "Créer une relance" peut être cochée avec des champs vidés
    // par l'utilisateur après le préremplissage : vérifié ici (confirmation), plus jamais au
    // niveau du simple togglePersonalFollowupPlanned (§17).
    if (personalFollowupPlanned && (!personalFollowupDate || !personalFollowupTitle.trim() || (followupConflict && !confirmConflict))) {
      setInlineError(t('appointments.error_followup_incomplete')); return
    }
    if (!hasAnyNextStep && !noFollowupRequired) { setInlineError(t('appointments.error_next_step_required')); return }
    if (notesDirty) {
      const ok = await handleSaveNotes()
      if (!ok) return // erreur déjà affichée, modale conservée avec la saisie
    }
    setIsCompleting(true)
    setInlineError(null)
    try {
      // Enregistrer le contexte de clôture avant la transition (§19, étape 6).
      const savedContext = await saveBusinessContext({
        outcome: outcomeDraft,
        outcome_details: outcomeDetailsDraft,
        outcome_other_label: outcomeDraft === 'other' ? outcomeOtherLabelDraft.trim() : null,
        other_outcomes: otherOutcomesDraft,
      })
      if (!savedContext) { setInlineError(t('appointments.error_save_business')); setIsCompleting(false); return }

      const plan = buildFollowupPlan()
      lastPlanRef.current = plan
      const result = await complete({ noFollowupRequired }, plan)
      if (result.postCompletion && !result.postCompletion.success) {
        setPostWarnings(result.postCompletion.warnings)
      } else {
        setPostWarnings([])
      }

      // §13 Lot 1.2.1 — actions idempotentes (commande/recommandation/relance personnelle/lien
      // RDV) créées après le noyau de clôture, jamais avant : le RDV doit être réellement
      // complété avant qu'une ressource ne lui soit rattachée.
      if (appointment?.client_id) {
        const actionPlan = buildActionPlanFromDrafts()
        lastActionPlanRef.current = actionPlan
        const { warnings, savedSaleOrderItems } = await applyOutcomePlanActions(appointment.user_id, id, appointment.client_id, actionPlan, `${id}:closure`)
        setPlanActionWarnings(warnings.order || warnings.recommendation || warnings.personalFollowup || warnings.appointmentLink || warnings.recurringProgram ? warnings : null)
        // ORDER-BUSINESS-3.1 §3/§4 — reporte les id order_items appris à l'instant vers l'état
        // local ET vers outcome_details déjà persisté juste avant (§19 étape 6, ligne ~1035),
        // pour qu'une future révision de CE RDV les relise au lieu de tout recréer.
        const mergedDetails = mergeSaleOrderItemIds(outcomeDetailsDraft, savedSaleOrderItems)
        if (mergedDetails && mergedDetails !== outcomeDetailsDraft) {
          setOutcomeDetailsDraft(mergedDetails)
          if (mergedDetails.kind === 'sale_completed') setSaleProducts(mergedDetails.products)
          await saveBusinessContext({ outcome_details: mergedDetails })
        }
        // RÉCAP-6 — la clôture peut avoir lié un RDV futur existant (selectedUpcomingId →
        // linkExistingAppointmentId ci-dessus) : refetch ciblé, jamais optimiste ici puisque la
        // donnée exacte (source unique) est déjà connue côté service, pas dupliquée localement.
        resolveClientFacingNextAppointment(id, appointment.client_id)
          .then(setClientFacingNextAppointment)
          .catch(() => {})
        // RÉCAP-6.1 §35 — la clôture peut avoir créé/mis à jour une commande (upsertOrderForAppointment
        // dans applyOutcomePlanActions ci-dessus) : refetch ciblé, jamais un reload complet de page.
        getOrdersForAppointment(id).then(setAppointmentOrders).catch(() => {})
      }

      setShowDebrief(false) // fermeture uniquement si la complétion principale réussit
    } catch (err) {
      if (err instanceof AppointmentCompletionError) {
        const errorKeyByCode: Record<string, string> = {
          cannot_complete_cancelled:   'appointments.error_cannot_complete_cancelled',
          cannot_complete_no_show:     'appointments.error_cannot_complete_no_show',
          outcome_required:            'appointments.error_outcome_required',
          next_step_decision_required: 'appointments.error_next_step_required',
        }
        setInlineError(t(errorKeyByCode[err.code] as any))
      } else {
        setInlineError(t('appointments.error_update_status'))
      }
      // Statut inchangé, modale conservée, saisie déjà persistée (pills/notes) → nouvel essai possible.
    } finally {
      setIsCompleting(false)
    }
  }

  // ── Lot 1.2 — actions déclenchées explicitement depuis le débrief ────────────────

  function handleAddSaleProduct(result: CatalogPickerResult) {
    // PRODUCT-VALUE-1 — préremplit le prix depuis le catalogue quand il est renseigné (snapshot,
    // jamais relu plus tard), sans empêcher l'ancien comportement (saisie manuelle) quand il
    // ne l'est pas (Zinzino, catalogues personnalisés) — amount reste éditable dans les 2 cas.
    // ORDER-BUSINESS-3.4.2 §2/§3 — id STABLE généré ICI, dès la création de la ligne (même
    // principe qu'OrderEditModal.addCatalogLine) : sans lui, un retry de la clôture/révision
    // après un échec partiel enverrait à nouveau une ligne SANS id, provoquant une nouvelle
    // insertion (churn/duplication) au lieu de reconnaître la ligne déjà créée avec succès.
    setSaleProducts(prev => [...prev, {
      id: generateOrderItemId(),
      productId: result.productId,
      catalogId: result.catalogId,
      label: result.productName,
      quantity: 1,
      amount: result.retailPriceEur ?? undefined,
    }])
    setShowSalePicker(false)
  }
  function handleAddFreeSaleProduct() {
    setSaleProducts(prev => [...prev, { id: generateOrderItemId(), label: '', quantity: 1 }])
  }
  function updateSaleProduct(index: number, patch: Partial<OutcomeSaleProduct>) {
    setSaleProducts(prev => prev.map((p, i) => i === index ? { ...p, ...patch } : p))
  }
  function removeSaleProduct(index: number) {
    setSaleProducts(prev => prev.filter((_, i) => i !== index))
  }
  // LRP-3 §22 — même comportement que la case "Commande LRP" d'une commande créée hors RDV
  // (§12 : jamais pré-cochée, jamais pré-remplie tant que non explicitement activée ici).
  function handleToggleSaleIsLrp(v: boolean) {
    setIsLrpSaleDraft(v)
    setLrpProgramValueDraft(v ? initialLrpProgramValue(activePrograms.length === 1 ? activePrograms[0] : null, new Date().toISOString().split('T')[0]) : null)
  }

  // RDV-CLOSURE-PRODUCTS/P1 — produits déjà envisagés (discussed_products, considered=true)
  // pas encore présents dans saleProducts. Dédoublonnage par productId pour un produit
  // catalogue (§11, jamais par le texte de son nom). Un produit LIBRE (productId absent) n'a
  // pas d'identifiant stable en base : P1.1 le retient localement via DISCUSSED_LOCAL_ID (clé
  // Symbol éphémère posée à la création, survit à un {...p} ultérieur — contrairement à une
  // référence d'objet directe, cassée par le moindre toggle considered ou édition
  // quantité/prix) dès qu'il a été importé une première fois par CETTE action — jamais
  // persisté, jamais un lineId ajouté à DiscussedProduct/DB. Ne pas confondre avec
  // handleAddFreeSaleProduct ("+ Produit libre" du flux normal) : ce dernier crée une entrée
  // saleProducts totalement nouvelle, indépendante de discussedProducts, jamais suivie ici —
  // l'utilisateur reste libre d'ajouter volontairement deux produits de même nom via ce chemin.
  // "Envisagé" ≠ "vendu" (§4/§23) — ce calcul ne modifie jamais discussed_products/considered,
  // il ne fait qu'identifier ce qui manque encore à saleProducts.
  function getMissingConsideredProducts(): DiscussedProduct[] {
    return discussedProducts.filter(p => {
      if (!p.considered) return false
      if (p.productId != null) return !saleProducts.some(sp => sp.productId === p.productId)
      const localId = (p as unknown as Record<symbol, number>)[DISCUSSED_LOCAL_ID]
      return !importedFreeConsideredRef.current.has(localId)
    })
  }

  // Action explicite (§3-4) : n'ajoute que ce qui manque, ne touche jamais une ligne saleProducts
  // déjà présente (quantité/montant déjà saisis manuellement restent intacts, §10). Le prix
  // repris est le snapshot du RDV (DiscussedProduct.unitPriceEur), jamais relu du catalogue —
  // amount est un prix UNITAIRE (confirmé par le calcul du total dans applyOutcomePlanActions :
  // `sum + (p.amount ?? 0) * p.quantity`), donc unitPriceEur s'y transpose directement sans
  // conversion. Absent → amount reste absent, jamais 0 (§8).
  function handleReuseConsideredProducts() {
    const missing = getMissingConsideredProducts()
    if (missing.length === 0) return
    for (const p of missing) {
      if (p.productId == null) importedFreeConsideredRef.current.add((p as unknown as Record<symbol, number>)[DISCUSSED_LOCAL_ID])
    }
    // ORDER-BUSINESS-3.4.2 §2/§3 — même raison que handleAddSaleProduct : id stable dès la
    // création, avant tout appel saveOrderItems.
    setSaleProducts(prev => [...prev, ...missing.map(p => ({
      id: generateOrderItemId(),
      productId: p.productId,
      catalogId: p.catalogId,
      label: p.label,
      quantity: p.quantity,
      amount: p.unitPriceEur,
    }))])
  }

  // ── RDV-PRODUCTS-1 / Lot C — produits discutés (structurés) ──────────────────────
  // Distinct de saleProducts (produit effectivement vendu, uniquement au moment de la
  // clôture) : ici la liste est visible et sauvegardée en continu, dès l'ouverture du RDV.

  // Un produit sans nom (ligne libre tout juste ajoutée, pas encore renseignée) n'est jamais
  // envoyé au serveur — il reste visible localement le temps que l'utilisateur le complète.
  // Quantité/prix invalides sont corrigés silencieusement plutôt que de bloquer l'enregistrement
  // des autres lignes (§21) : jamais 0 pour un prix absent (voir DiscussedProduct), une quantité
  // invalide retombe sur 1 (même règle que updateSaleProduct/OutcomeSaleProduct.quantity).
  // RDV-CLOSURE-PRODUCTS/P1.1 — assigne la clé locale éphémère à un produit fraîchement chargé
  // ou créé (jamais à un produit déjà en state, qui la porte déjà via le spread). Mutation en
  // place plutôt qu'un nouvel objet : l'objet est déjà "neuf" à cet instant (venant du réseau ou
  // d'un littéral tout juste créé), inutile d'en recréer un second.
  function tagWithDiscussedLocalId(p: DiscussedProduct): DiscussedProduct {
    ;(p as unknown as Record<symbol, number>)[DISCUSSED_LOCAL_ID] = ++discussedLocalIdCounterRef.current
    return p
  }

  function sanitizeDiscussedProducts(products: DiscussedProduct[]): DiscussedProduct[] {
    return products
      .filter(p => p.label.trim().length > 0)
      .map(p => ({
        ...p,
        label: p.label.trim(),
        quantity: Number.isFinite(p.quantity) && p.quantity > 0 ? p.quantity : 1,
        unitPriceEur: p.unitPriceEur != null && Number.isFinite(p.unitPriceEur) && p.unitPriceEur >= 0 ? p.unitPriceEur : undefined,
      }))
  }

  // Un seul enregistrement en vol à la fois : toute mutation survenant pendant qu'une
  // sauvegarde est en cours devient la seule valeur "en attente", rejouée juste après —
  // jamais deux requêtes concurrentes qui pourraient résoudre dans le désordre et faire
  // regresser discussed_products vers un état plus ancien en base (§14).
  // `estimatedValue` (Lot D) : inclus dans le MÊME upsert que discussed_products quand un
  // recalcul automatique doit être écrit — un seul appel réseau, jamais deux systèmes de
  // sauvegarde séparés pour deux champs qui changent ensemble (brief §5/§24).
  function persistDiscussedProducts(products: DiscussedProduct[], estimatedValue?: number) {
    const toSave = sanitizeDiscussedProducts(products)
    if (discussedProductsInFlightRef.current) {
      discussedProductsPendingRef.current = toSave
      discussedProductsPendingEstimatedValueRef.current = estimatedValue
      return
    }
    const run = async (payload: DiscussedProduct[], estValuePayload?: number): Promise<void> => {
      await saveBusinessContext({
        discussed_products: payload,
        ...(estValuePayload != null ? { estimated_value: estValuePayload } : {}),
      })
      const pending = discussedProductsPendingRef.current
      if (pending) {
        discussedProductsPendingRef.current = null
        const pendingEstValue = discussedProductsPendingEstimatedValueRef.current
        discussedProductsPendingEstimatedValueRef.current = undefined
        await run(pending, pendingEstValue)
      }
    }
    discussedProductsInFlightRef.current = run(toSave, estimatedValue).finally(() => {
      discussedProductsInFlightRef.current = null
    })
  }

  // RDV-PRODUCTS-1 / Lot D §8-11 — somme quantity × unitPriceEur des produits considered=true
  // ET dont le prix est connu (jamais 0 pour un prix absent, §9). hasUnpriced signale qu'au
  // moins un produit envisagé n'a pas de prix, pour avertir sans jamais fausser silencieusement
  // le total affiché.
  function computeConsideredTotal(products: DiscussedProduct[]): { sum: number; hasConsidered: boolean; hasUnpriced: boolean } {
    let sum = 0, hasConsidered = false, hasUnpriced = false
    for (const p of products) {
      if (!p.considered) continue
      hasConsidered = true
      if (p.unitPriceEur != null) sum += p.quantity * p.unitPriceEur
      else hasUnpriced = true
    }
    return { sum, hasConsidered, hasUnpriced }
  }

  // P4 §11/§13 — AFFICHAGE uniquement (Total en lecture seule dans "Vente réalisée") : même
  // formule élémentaire (quantity × amount, amount = prix unitaire, doctrine confirmée en
  // ORDER-BUSINESS-3.1) que celle qui alimente déjà la commande créée par applyOutcomePlanActions
  // à partir de ce même tableau saleProducts — jamais une seconde formule métier indépendante,
  // seulement sa réplique en lecture pour ne pas laisser un total invisible avant la clôture réelle.
  function computeSaleTotal(products: OutcomeSaleProduct[]): { sum: number; hasUnpriced: boolean } {
    let sum = 0, hasUnpriced = false
    for (const p of products) {
      if (p.amount != null) sum += p.quantity * p.amount
      else hasUnpriced = true
    }
    return { sum, hasUnpriced }
  }

  // §11/§16 — ne recalcule et n'écrase "Valeur estimée" que si l'utilisateur ne l'a jamais
  // modifiée à la main pour ce RDV, et seulement s'il existe au moins un produit envisagé avec
  // un prix connu (§10 : jamais forcé à 0 quand rien n'est calculable — un ancien RDV garde
  // alors sa valeur historique intacte, §14-15). Retourne la valeur à inclure dans la sauvegarde
  // (undefined = rien à écrire cette fois).
  // Lot D.1 — un sous-total partiel (au moins un produit envisagé sans prix connu) n'est
  // jamais auto-écrit dans estimated_value : ce ne serait pas le total réel, seulement ce qui
  // est calculable pour l'instant. L'utilisateur reste informé du sous-total et de son
  // caractère incomplet (voir affichage), mais seul un total où tous les prix sont connus peut
  // être auto-appliqué.
  function autoApplyEstimatedValue(next: DiscussedProduct[]): number | undefined {
    if (estimatedValueUserTouchedRef.current) return undefined
    const { sum, hasConsidered, hasUnpriced } = computeConsideredTotal(next)
    if (!hasConsidered || sum <= 0 || hasUnpriced) return undefined
    setEstValue(String(sum))
    setBizValueDirty(false)
    return sum
  }

  // Sauvegarde immédiate — actions discrètes et déjà valides (ajout catalogue, suppression,
  // incrément de doublon, bascule "envisagé") : pas de raison d'attendre, contrairement à la
  // frappe continue.
  function commitDiscussedProducts(next: DiscussedProduct[]) {
    setDiscussedProducts(next)
    if (discussedProductsTimerRef.current) { clearTimeout(discussedProductsTimerRef.current); discussedProductsTimerRef.current = null }
    persistDiscussedProducts(next, autoApplyEstimatedValue(next))
  }

  // Sauvegarde différée (~700 ms d'inactivité) — édition continue (quantité, prix, nom libre) :
  // évite un aller-retour réseau par frappe, sans risque de doublon grâce à persistDiscussedProducts.
  // La valeur estimée, elle, est recalculée et affichée immédiatement (pas de délai visuel) —
  // seule l'écriture réseau attend le debounce, comme discussed_products.
  function scheduleDiscussedProductsSave(next: DiscussedProduct[]) {
    const estimatedValue = autoApplyEstimatedValue(next)
    if (discussedProductsTimerRef.current) clearTimeout(discussedProductsTimerRef.current)
    discussedProductsTimerRef.current = setTimeout(() => persistDiscussedProducts(next, estimatedValue), 700)
  }

  // §12 — un même produit catalogue déjà présent voit sa quantité augmenter plutôt que de
  // créer une deuxième ligne identique (cohérent avec l'intention "un produit = une ligne").
  // Les produits libres ne sont jamais dédupliqués par le texte (aucune heuristique fiable).
  function handleAddDiscussedCatalogProduct(result: CatalogPickerResult) {
    setShowDiscussedPicker(false)
    const existingIndex = discussedProducts.findIndex(p => p.productId === result.productId)
    if (existingIndex >= 0) {
      commitDiscussedProducts(discussedProducts.map((p, i) => i === existingIndex ? { ...p, quantity: p.quantity + 1 } : p))
      return
    }
    commitDiscussedProducts([...discussedProducts, tagWithDiscussedLocalId({
      productId: result.productId,
      catalogId: result.catalogId,
      label: result.productName,
      quantity: 1,
      unitPriceEur: result.retailPriceEur ?? undefined,
      considered: false,
    })])
  }

  // Produit libre : ajouté immédiatement en local (visible pour être complété), mais jamais
  // envoyé tant que son nom est vide (sanitizeDiscussedProducts) — pas de ligne fantôme en base.
  function handleAddFreeDiscussedProduct() {
    setDiscussedProducts(prev => [...prev, tagWithDiscussedLocalId({ label: '', quantity: 1, considered: false })])
  }

  function updateDiscussedProduct(index: number, patch: Partial<DiscussedProduct>) {
    const next = discussedProducts.map((p, i) => i === index ? { ...p, ...patch } : p)
    setDiscussedProducts(next)
    scheduleDiscussedProductsSave(next)
  }

  function removeDiscussedProduct(index: number) {
    commitDiscussedProducts(discussedProducts.filter((_, i) => i !== index))
  }

  // ── RDV-PRODUCTS-1 / Lot D — produits envisagés → valeur estimée ─────────────────
  // Aucune deuxième liste : considered vit directement sur discussedProducts (§1). Bascule
  // discrète → sauvegarde immédiate, comme les autres actions de commitDiscussedProducts.
  function toggleDiscussedProductConsidered(index: number) {
    commitDiscussedProducts(discussedProducts.map((p, i) => i === index ? { ...p, considered: !p.considered } : p))
  }

  // §18 — reprend le calcul en main : redevient piloté automatiquement (touched=false) plutôt
  // que de figer une valeur ponctuelle, cohérent avec "revenir au calcul" plutôt que "coller
  // une valeur une fois". N'importe quelle édition future des produits reprendra le suivi.
  function handleUseCalculatedEstimatedValue() {
    const { sum } = computeConsideredTotal(discussedProducts)
    estimatedValueUserTouchedRef.current = false
    setEstValue(String(sum))
    setBizValueDirty(false)
    void saveBusinessContext({ estimated_value: sum })
  }
  // Garde le brouillon synchronisé avec les lignes produits à chaque changement.
  useEffect(() => {
    if (outcomeDraft === 'sale_completed') {
      setOutcomeDetailsDraft({ kind: 'sale_completed', products: saleProducts })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleProducts])

  // Aperçu "première commande" fiable seulement si on sait vraiment si c'est la première.
  useEffect(() => {
    if (outcomeDraft === 'sale_completed' && appointment?.client_id) {
      isFirstOrderForClient(appointment.client_id).then(setIsFirstOrderFlag).catch(() => setIsFirstOrderFlag(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeDraft, appointment?.client_id])

  function toggleInterestChip(kind: OutcomeInterestKind) {
    setOutcomeDetailsDraft(prev => {
      if (prev?.kind !== 'interested') return prev
      const has = prev.interests.includes(kind)
      return { ...prev, interests: has ? prev.interests.filter(k => k !== kind) : [...prev.interests, kind] }
    })
  }

  // Lot 1.2.1 §2 — n'ajoute qu'au brouillon local, aucune écriture en base : la recommandation
  // n'est réellement créée qu'à la confirmation finale (clôture ou révision), via le plan
  // unique exécuté par applyOutcomePlanActions.
  function toggleRecommendationPlanned() {
    setRecommendationPlanned(v => !v)
  }

  // RDV-CLOSURE-PRODUCTS/P2.1 — sélection UNIQUE (comportement radio malgré le même habillage
  // visuel "case à cocher" que le reste de la modale, §1 : pas de nouveau composant générique
  // pour un simple changement de règle de sélection). Sélectionner un produit désélectionne
  // implicitement tout autre choix précédent ; re-cliquer le produit déjà choisi le désélectionne
  // (aucune sélection n'est une valeur valide, §4/Test D). Indépendant de considered
  // (discussed_products) et de saleProducts (P1) — ne modifie jamais discussed_products.
  function selectRecommendationProductIndex(index: number) {
    setRecommendationProductIndex(prev => prev === index ? null : index)
  }

  async function handleCheckFollowupConflict() {
    if (!appointment || !appointment.client_id || !personalFollowupDate) return
    try {
      const conflict = await detectFollowupConflict(appointment.client_id, personalFollowupDate, personalFollowupType)
      setFollowupConflict(conflict)
      setConfirmConflict(false)
    } catch (e) {
      console.error('[handleCheckFollowupConflict]', e)
    }
  }

  // Correctif affichage — DateInput (JJ/MM/AAAA) ne propage pas d'onBlur comme l'ancien
  // TextInput ISO brut ; la vérification de conflit devient réactive à la date effective
  // plutôt que liée à un événement de focus précis, et couvre du même coup les presets/J+
  // (qui ne déclenchaient déjà pas onBlur puisqu'ils ne donnent jamais le focus au champ).
  useEffect(() => {
    if (!showDebrief && !showRevision) return
    if (!personalFollowupPlanned || !personalFollowupDate) return
    handleCheckFollowupConflict()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalFollowupDate, personalFollowupPlanned, showDebrief, showRevision])

  // RDV-FOLLOWUP-1/P0 §11-17 — simple case à cocher "Créer une relance" : ajoute/retire l'item
  // du plan (aucune écriture avant la confirmation finale), sans condition de validité — la
  // complétude des champs n'est vérifiée qu'à la confirmation (handleConfirmDebrief/Revision),
  // pas ici, pour ne jamais bloquer un simple décochage/recochage de la case.
  function togglePersonalFollowupPlanned() {
    personalFollowupUserTouchedRef.current = true
    setPersonalFollowupPlanned(v => !v)
  }

  function markPersonalFollowupTouched() {
    personalFollowupUserTouchedRef.current = true
  }

  // Construit le plan d'actions unique (§3) à partir des brouillons actuels — utilisé
  // identiquement par la clôture initiale et par la révision (aucune logique dupliquée).
  function buildActionPlanFromDrafts(): AppointmentOutcomeActionPlan {
    return {
      saleOrder: outcomeDraft === 'sale_completed' && saleProducts.length > 0
        ? { products: saleProducts, isLrp: isLrpSaleDraft, lrpProgram: !showRevision ? lrpProgramValueDraft : null }
        : null,
      // RDV-CLOSURE-PRODUCTS/P2.1 — 1 recommandation = 1 produit (audit P2, product_id/
      // catalog_id sont singuliers sur recommendations) : au plus UN produit envisagé peut être
      // choisi via ce raccourci, jamais un product_name joint pour plusieurs. Sans sélection,
      // retombe sur le chemin générique (freeText/intitulés d'intérêt) uniquement s'il y a
      // réellement quelque chose à décrire — jamais un placeholder "produit sans nom" créé
      // simplement parce que le raccourci produits envisagés a été activé sans choix (Test D).
      recommendation: recommendationPlanned && outcomeDetailsDraft?.kind === 'interested' ? (() => {
        const selected = recommendationProductIndex != null ? discussedProducts[recommendationProductIndex] : null
        if (selected) {
          return {
            productName: selected.label,
            reason: outcomeDetailsDraft.comment?.trim() || null,
            productId: selected.productId ?? null,
            catalogId: selected.catalogId ?? null,
          }
        }
        if (outcomeDetailsDraft.freeText?.trim() || outcomeDetailsDraft.interests.length > 0) {
          return {
            productName: outcomeDetailsDraft.freeText?.trim()
              || outcomeDetailsDraft.interests.map(k => t(`outcome_interest_kinds.${k}` as any)).join(', '),
            reason: outcomeDetailsDraft.comment?.trim() || null,
          }
        }
        return null
      })() : null,
      personalFollowup: personalFollowupPlanned ? {
        actionType: personalFollowupType,
        title: personalFollowupTitle.trim(),
        dueDate: personalFollowupDate,
        comment: personalFollowupComment.trim() || null,
      } : null,
      linkExistingAppointmentId: selectedUpcomingId,
    }
  }

  function hasPlannedOrKeptAction(cancelFollowupIds: Set<string>, cancelTaskIds: Set<string>): boolean {
    const plan = buildActionPlanFromDrafts()
    if (plan.saleOrder || plan.recommendation || plan.personalFollowup || plan.linkExistingAppointmentId) return true
    if (revisionPlan) {
      const activeFollowups = revisionPlan.linkedFollowups.filter(f => !f.done && !f.cancelled_at)
      const activeTasks = revisionPlan.linkedTasks.filter(t2 => t2.status !== 'done' && t2.status !== 'cancelled')
      if (activeFollowups.some(f => !cancelFollowupIds.has(f.id))) return true
      if (activeTasks.some(t2 => !cancelTaskIds.has(t2.id))) return true
    }
    return false
  }

  // ── Lot 1.2 §15-16 — modification d'un résultat déjà clôturé ────────────────────
  // Service métier dédié (reviseAppointmentOutcome), ne détourne jamais completeAppointment().

  // Lot 1.2.1 §5 — la révision réutilise exactement les mêmes brouillons que la clôture
  // (outcomeDraft, outcomeDetailsDraft, saleProducts, recommendationPlanned, personalFollowup*,
  // selectedUpcomingId) : une seule implémentation des formulaires conditionnels, jamais deux.
  async function handleOpenRevision() {
    setRevisionError(null)
    setRevisionSaving(false)
    setRevisionConflict(false)
    try {
      const plan = await buildOutcomeRevisionPlan(id)
      setRevisionPlan(plan)
      setRevisionExpectedRevision(plan.previousRevision)
      const persisted = plan.previous.outcome === 'follow_up_required' ? null : plan.previous.outcome
      setOutcomeDraft(persisted)
      setOutcomeDetailsDraft(persisted ? (plan.previous.outcomeDetails ?? defaultDetailsFor(persisted)) : null)
      setOutcomeOtherLabelDraft(plan.previous.outcomeOtherLabel ?? '')
      setOutcomePendingSwitch(null)
      // OutcomeSnapshot (plan.previous) ne porte pas other_outcomes (hors du périmètre suivi par
      // la révision/client_events, §voir migration) — relu directement depuis biz, seule source
      // pour ce champ, comme à la clôture initiale.
      setOtherOutcomesDraft(biz?.other_outcomes ?? [])
      setIsLrpSaleDraft(appointmentOrders.find(o => !o.cancelled_at)?.is_lrp ?? false)
      setLrpProgramValueDraft(null)
      setSaleProducts(plan.previous.outcomeDetails?.kind === 'sale_completed' ? plan.previous.outcomeDetails.products : [])
      setRecommendationPlanned(false)
      setRecommendationProductIndex(null)
      // RDV-FOLLOWUP-1/P0 — même préremplissage que la clôture initiale (§5 : la révision
      // réutilise toujours les mêmes brouillons, aucune logique dupliquée).
      personalFollowupUserTouchedRef.current = false
      {
        const apptRule = AUTOMATION_RULES.find(r => r.id === 'appt_j7')
        const firstNameForRule = clientInfo?.first_name || clientInfo?.full_name?.split(' ')[0] || ''
        const delayDays = apptRule ? getAutomationDelay(apptRule.id, apptRule.delayDays) : 7
        setPersonalFollowupPlanned(true)
        setPersonalFollowupType(apptRule?.actionType ?? 'whatsapp')
        setPersonalFollowupTitle(apptRule ? apptRule.title.replace(/\{prénom\}/g, firstNameForRule) : '')
        setPersonalFollowupDelayDays(String(delayDays))
        setPersonalFollowupDate(dueDateStr(delayDays))
      }
      setPersonalFollowupComment('')
      setFollowupConflict(null)
      setConfirmConflict(false)
      setSelectedUpcomingId(null)
      setRevisionReason('')
      setRevisionReasonOtherText('')
      setRevisionCancelFollowups(new Set())
      setRevisionCancelTasks(new Set())
      setRevisionCancelRecos(new Set())
      setRevisionNoFollowupRequired(false)
      if (plan.clientId) {
        fetchUpcomingAppointmentsForClient(plan.clientId, id).then(setUpcomingAppts).catch(() => setUpcomingAppts([]))
      }
      setShowRevision(true)
    } catch (e) {
      console.error('[handleOpenRevision]', e)
      setInlineError(t('appointments.error_update_status'))
    }
  }

  function toggleRevisionSet(set: Set<string>, setter: (s: Set<string>) => void, itemId: string) {
    const next = new Set(set)
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId)
    setter(next)
    // Exclusivité mutuelle (§7) : une action conservée/annulée modifie l'état "aucune suite".
    setRevisionNoFollowupRequired(false)
  }

  async function handleConfirmRevision() {
    if (!revisionPlan || !appointment?.client_id || revisionExpectedRevision === null) return
    if (!outcomeDraft) { setRevisionError(t('appointments.error_outcome_required')); return }
    if (outcomeDraft === 'other' && !outcomeOtherLabelDraft.trim()) { setRevisionError(t('appointments.error_outcome_other_required')); return }
    if (!revisionReason) { setRevisionError(t('appointments.error_revision_reason_required')); return }
    if (revisionReason === 'other' && !revisionReasonOtherText.trim()) { setRevisionError(t('appointments.error_revision_reason_other_required')); return }
    if (personalFollowupPlanned && (!personalFollowupDate || !personalFollowupTitle.trim() || (followupConflict && !confirmConflict))) {
      setRevisionError(t('appointments.error_followup_incomplete')); return
    }
    const hasNextStep = hasPlannedOrKeptAction(revisionCancelFollowups, revisionCancelTasks)
    if (!hasNextStep && !revisionNoFollowupRequired) { setRevisionError(t('appointments.error_next_step_required')); return }
    setRevisionSaving(true)
    setRevisionError(null)
    try {
      const nextSnapshot: OutcomeSnapshot = {
        outcome: outcomeDraft,
        outcomeDetails: outcomeDetailsDraft,
        outcomeOtherLabel: outcomeDraft === 'other' ? outcomeOtherLabelDraft.trim() : null,
      }
      const { newRevision, updatedOutcomeDetails } = await reviseAppointmentOutcome({
        userId: appointment.user_id,
        appointmentId: id,
        clientId: appointment.client_id,
        expectedRevision: revisionExpectedRevision,
        previous: revisionPlan.previous,
        next: nextSnapshot,
        reason: revisionReason,
        reasonOtherText: revisionReason === 'other' ? revisionReasonOtherText.trim() : null,
        decision: {
          cancelFollowupIds: [...revisionCancelFollowups],
          cancelTaskIds: [...revisionCancelTasks],
          cancelRecommendationIds: [...revisionCancelRecos],
        },
        noFollowupRequired: revisionNoFollowupRequired,
        newActions: buildActionPlanFromDrafts(),
        appointmentTitle: appointment.title ?? null,
        appointmentDate: appointment.start_at ?? null,
      })
      void newRevision
      // ORDER-BUSINESS-3.1 §3/§4 — reviseAppointmentOutcome a déjà persisté ces id dans
      // outcome_details ; resynchronise l'état local pour qu'une révision suivante DANS LA MÊME
      // session reparte des vrais id (jamais de ceux, sans id, du draft d'avant confirmation).
      if (updatedOutcomeDetails) {
        setOutcomeDetailsDraft(updatedOutcomeDetails)
        if (updatedOutcomeDetails.kind === 'sale_completed') setSaleProducts(updatedOutcomeDetails.products)
      }
      // "Autres retombées" — hors du périmètre suivi par revise_appointment_outcome (pas un
      // résultat, pas d'audit dédié) : persisté séparément, comme pipeline_stage/commercial_intent.
      await saveBusinessContext({ other_outcomes: otherOutcomesDraft })
      // RÉCAP-6 — même raison que handleConfirmDebrief : une révision peut avoir changé le RDV
      // explicitement lié (nouveau selectedUpcomingId, ou annulation d'un lien précédent).
      if (appointment.client_id) {
        resolveClientFacingNextAppointment(id, appointment.client_id)
          .then(setClientFacingNextAppointment)
          .catch(() => {})
      }
      // RÉCAP-6.1 §35 — même raison : une révision peut avoir créé/mis à jour/annulé une commande.
      getOrdersForAppointment(id).then(setAppointmentOrders).catch(() => {})
      setShowRevision(false)
      await reload()
    } catch (e) {
      if (e instanceof OutcomeRevisionConflictError) {
        setRevisionConflict(true)
        setRevisionError(t('appointments.error_revision_conflict'))
        setRevisionSaving(false)
        return
      }
      console.error('[handleConfirmRevision]', e)
      setRevisionError(t('appointments.error_update_status'))
    } finally {
      setRevisionSaving(false)
    }
  }

  // Réouverture du débrief d'un RDV déjà completed : on ne repasse jamais par complete()
  // (le RDV l'est déjà), mais un changement de sélection/délai de relance doit tout de
  // même être appliqué avant de fermer — via le même chemin idempotent que "Réessayer"
  // (les gardes anti-doublon du service s'appliquent donc à l'identique).
  async function handleUpdateFollowupsOnCompleted() {
    if (isCompleting) return
    setIsCompleting(true)
    setInlineError(null)
    try {
      // Le RDV est déjà completed — outcome/décision de suite ont déjà été validés lors de
      // la clôture initiale ; on persiste seulement un éventuel changement d'avis sur
      // « Aucune suite nécessaire » avant de rejouer les relances/tâches.
      if (biz?.no_followup_required !== noFollowupRequired) {
        await saveBusinessContext({ no_followup_required: noFollowupRequired })
      }
      const plan = buildFollowupPlan()
      lastPlanRef.current = plan
      const result = await retryPostCompletion(plan)
      if (result) setPostWarnings(result.warnings)
    } finally {
      setIsCompleting(false)
      setShowDebrief(false)
    }
  }

  // RDV sans contact — navigue vers la création rapide d'un contact, qui rattachera
  // automatiquement ce RDV une fois créé (voir clients/new.tsx?returnToAppointmentId=…).
  // Rien n'est perdu : notes, résultat et qualification sont déjà persistés au fil de l'eau.
  function handleCreateContactFromDebrief() {
    setShowDebrief(false)
    router.push(`/(app)/clients/new?returnToAppointmentId=${id}` as any)
  }

  async function handleRetryPostCompletion() {
    if (retrying) return
    setRetrying(true)
    try {
      const result = await retryPostCompletion(lastPlanRef.current)
      if (result) setPostWarnings(result.warnings)
    } finally {
      setRetrying(false)
    }
  }

  // Rejeu du plan d'actions Lot 1.2.1 §13 : clé d'idempotence identique (`${id}:closure`), les
  // actions déjà créées avec succès ne sont jamais recréées (index unique partiel en base).
  async function handleRetryPlanActions() {
    if (retryingPlanActions || !appointment?.client_id || !lastActionPlanRef.current) return
    setRetryingPlanActions(true)
    try {
      const { warnings, savedSaleOrderItems } = await applyOutcomePlanActions(appointment.user_id, id, appointment.client_id, lastActionPlanRef.current, `${id}:closure`)
      setPlanActionWarnings(warnings.order || warnings.recommendation || warnings.personalFollowup || warnings.appointmentLink || warnings.recurringProgram ? warnings : null)
      // ORDER-BUSINESS-3.1 §3/§4 — même report d'id qu'à la clôture initiale (§19), au cas où
      // le premier essai avait échoué avant d'apprendre les id order_items.
      const mergedDetails = mergeSaleOrderItemIds(outcomeDetailsDraft, savedSaleOrderItems)
      if (mergedDetails && mergedDetails !== outcomeDetailsDraft) {
        setOutcomeDetailsDraft(mergedDetails)
        if (mergedDetails.kind === 'sale_completed') setSaleProducts(mergedDetails.products)
        await saveBusinessContext({ outcome_details: mergedDetails })
      }
    } finally {
      setRetryingPlanActions(false)
    }
  }

  async function handlePipelineChange(stage: PipelineStage) {
    setInlineError(null)
    const ok = await saveBusinessContext({ pipeline_stage: stage })
    if (!ok) { setInlineError(t('appointments.error_save_business')); return }
    // Le statut du client doit refléter la dernière étape constatée en RDV.
    if (appointment?.client_id) {
      const previousStage = biz?.pipeline_stage ?? null
      await supabase.from('clients').update({ pipeline_stage: stage }).eq('id', appointment.client_id)
      if (previousStage !== stage) {
        try {
          await logClientEvent(appointment.user_id, appointment.client_id, 'pipeline_change', { old_value: previousStage, new_value: stage })
        } catch (logError) {
          console.error('[logClientEvent]', logError)
        }
      }
    }
  }

  async function handleTemperatureChange(temp: ProspectTemperature) {
    setInlineError(null)
    const ok = await saveBusinessContext({ prospect_temperature: temp })
    if (!ok) setInlineError(t('appointments.error_save_business'))
  }

  async function handleIntentToggle(intent: CommercialIntent) {
    setInlineError(null)
    const current = biz?.commercial_intent ?? []
    const removingOther = intent === 'other' && current.includes('other')
    const next = current.includes(intent) ? current.filter(i => i !== intent) : [...current, intent]
    // RDV-1 §9 — désélectionner "Autre" efface immédiatement sa précision, pour ne jamais
    // garder un texte devenu incohérent avec l'intention réellement sélectionnée.
    const payload = removingOther ? { commercial_intent: next, commercial_intent_other_label: null } : { commercial_intent: next }
    const ok = await saveBusinessContext(payload)
    if (!ok) setInlineError(t('appointments.error_save_business'))
    else if (removingOther) { setIntentOtherLabel(''); setIntentOtherLabelDirty(false) }
  }

  async function handleSaveIntentOtherLabel() {
    if (!intentOtherLabelDirty) return
    setSavingIntentOtherLabel(true)
    setInlineError(null)
    const ok = await saveBusinessContext({ commercial_intent_other_label: intentOtherLabel.trim() || null })
    setSavingIntentOtherLabel(false)
    if (ok) setIntentOtherLabelDirty(false)
    else setInlineError(t('appointments.error_save_business'))
  }

  // Lot 1.2 §4 — brouillon local uniquement, aucune écriture tant que la clôture/révision
  // n'est pas confirmée. Défauts distincts par résultat, jamais partagés entre eux.
  function defaultDetailsFor(outcome: AppointmentOutcome): AppointmentOutcomeDetails | null {
    switch (outcome) {
      case 'sale_completed':    return { kind: 'sale_completed', products: [] }
      case 'interested':        return { kind: 'interested', interests: [] }
      case 'not_interested':    return { kind: 'not_interested', canBeRecontacted: true }
      case 'partner_potential': return { kind: 'partner_potential' }
      case 'partner_recruited': return { kind: 'partner_recruited' }
      case 'other':              return { kind: 'other' }
      default:                   return null
    }
  }

  function hasMeaningfulDetails(details: AppointmentOutcomeDetails | null): boolean {
    if (!details) return false
    switch (details.kind) {
      case 'sale_completed':    return details.products.length > 0
      case 'interested':        return details.interests.length > 0 || !!details.freeText?.trim() || !!details.comment?.trim()
      case 'not_interested':    return !!details.reason || !!details.reasonOtherText?.trim()
      case 'partner_potential': return !!(details.interestArea || details.motivation || details.objective || details.availability || details.mainObjection || details.comment)?.toString().trim()
      case 'partner_recruited': return !!(details.startDate || details.initialObjective || details.mainNeed || details.comment)
      case 'other':              return false
    }
  }

  function applyOutcomeDraft(outcome: AppointmentOutcome) {
    setOutcomeDraft(outcome)
    setOutcomeDetailsDraft(defaultDetailsFor(outcome))
    setOutcomeOtherLabelDraft('')
    setSaleProducts([])
    setRecommendationPlanned(false)
    setRecommendationProductIndex(null)
    // Le résultat principal ne peut pas aussi apparaître comme une "autre retombée" secondaire.
    setOtherOutcomesDraft(prev => prev.filter(o => o !== outcome))
  }

  function toggleOtherOutcome(outcome: AppointmentOutcome) {
    setOtherOutcomesDraft(prev => prev.includes(outcome) ? prev.filter(o => o !== outcome) : [...prev, outcome])
  }

  function handleSelectOutcome(outcome: AppointmentOutcome) {
    if (outcome === outcomeDraft) return
    setInlineError(null)
    if (hasMeaningfulDetails(outcomeDetailsDraft)) {
      setOutcomePendingSwitch(outcome)
      return
    }
    applyOutcomeDraft(outcome)
  }

  function confirmOutcomeSwitch() {
    if (!outcomePendingSwitch) return
    applyOutcomeDraft(outcomePendingSwitch)
    setOutcomePendingSwitch(null)
  }

  function cancelOutcomeSwitch() {
    setOutcomePendingSwitch(null)
  }

  async function handleSaveBizValue() {
    if (!bizValueDirty) return
    setSavingBizValue(true)
    setInlineError(null)
    const trimmed = estValue.trim()
    const payload: { estimated_value?: number } = {}
    if (trimmed) payload.estimated_value = parseFloat(trimmed)
    const ok = await saveBusinessContext(payload)
    setSavingBizValue(false)
    if (ok) setBizValueDirty(false)
    else setInlineError(t('appointments.error_save_business'))
  }

  async function handleAddTask() {
    const title = newTaskTitle.trim()
    if (!title) { setTaskError(t('appointments.error_task_title_required')); return }
    setTaskError(null)
    setAddingTask(true)
    const ok = await addTask({ title, task_type: 'follow_up', client_id: appointment?.client_id ?? undefined })
    setAddingTask(false)
    if (ok) setNewTaskTitle('')
    else setTaskError(t('appointments.error_add_task'))
  }

  // TASK-RDV-1 §4/§18 — bascule réversible (terminer/rouvrir, même fonction). Protection contre
  // le double-clic limitée à LA tâche concernée (savingTaskIds), jamais toute la page. En cas
  // d'échec, l'état local n'a pas été modifié de façon optimiste avant confirmation du service
  // (setTaskDone ne met à jour le state qu'après le succès de l'UPDATE) — l'UI ne reste donc
  // jamais dans un état visuel qui ne correspond pas à la DB.
  async function handleToggleTask(taskId: string, done: boolean) {
    if (savingTaskIds.has(taskId)) return
    setSavingTaskIds(prev => new Set(prev).add(taskId))
    try {
      const ok = await setTaskDone(taskId, done)
      if (!ok) setInlineError(t('appointments.error_done_task'))
    } finally {
      setSavingTaskIds(prev => { const next = new Set(prev); next.delete(taskId); return next })
    }
  }

  async function handleRemoveTask(taskId: string) {
    const ok = await removeTask(taskId)
    if (!ok) setInlineError(t('appointments.error_remove_task'))
  }

  async function handleConfirmCancel() {
    setCancelling(true)
    setInlineError(null)
    const ok = await cancel()
    setCancelling(false)
    if (ok) {
      setShowCancelConfirm(false)
      goBack()
    } else {
      setShowCancelConfirm(false)
      setInlineError(t('appointments.error_update_status'))
    }
  }

  // Suppression définitive — distincte de l'annulation (changement de statut réversible en
  // apparence) : le RDV n'existe plus après coup, impossible de rester sur sa propre fiche.
  async function handleConfirmDelete() {
    if (!appointment) return
    setDeletingAppointment(true)
    setInlineError(null)
    try {
      await deleteAppointment(appointment.id)
      setShowDeleteConfirm(false)
      goBack()
    } catch (err) {
      setInlineError(t('appointments.error_update_status'))
    } finally {
      setDeletingAppointment(false)
    }
  }

  // ── Loading / Not found ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: '', headerShown: true }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </>
    )
  }

  if (!appointment) {
    return (
      <>
        <Stack.Screen options={{ title: t('appointments.title') }} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>{t('appointments.not_found')}</Text>
        </View>
      </>
    )
  }

  // ── Computed ──────────────────────────────────────────────────────────────────

  const biz         = appointment.business_context
  // Lignes du plan de relances RÉELLEMENT affichées dans le débrief (mêmes conditions que le
  // rendu dans debriefModal, calculées une seule fois ici pour ne jamais diverger). Le state
  // `followupPlan` initialise ses 3 clés à create:true par défaut même quand la ligne
  // correspondante n'est pas montrée à l'écran — ne jamais se fier à followupPlan seul.
  const relevantFollowupKeys: PostCompletionPlanKey[] = []
  if (biz?.commercial_intent?.includes('buy_product'))        relevantFollowupKeys.push('buy_product')
  if (biz?.commercial_intent?.includes('become_distributor')) relevantFollowupKeys.push('become_distributor')
  if (objections.trim())                                      relevantFollowupKeys.push('objection_task')
  // Lot 1.1 — une action de suivi existe si une relance/prochain RDV a déjà été créé
  // (nextStepSection, action indépendante) ou si au moins une case *réellement affichée* du
  // plan de relances du débrief est cochée. Sert à la fois à la validation de clôture et à
  // l'exclusivité mutuelle avec « Aucune suite nécessaire ».
  const hasAnyNextStep = relanceCreated || nextRdvCreated || relevantFollowupKeys.some(k => followupPlan[k].create)
    || personalFollowupPlanned || !!selectedUpcomingId
    || recommendationPlanned || (outcomeDraft === 'sale_completed' && saleProducts.length > 0)
  const startDate   = new Date(appointment.start_at)
  const endDate     = new Date(appointment.end_at)
  const accentColor = TYPE_COLORS[appointment.appointment_type] ?? '#94A3B8'
  const dateStr     = formatDate(startDate, locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  const startTime   = `${pad2(startDate.getHours())}h${pad2(startDate.getMinutes())}`
  const endTime     = `${pad2(endDate.getHours())}h${pad2(endDate.getMinutes())}`
  const isCancelled = appointment.status === 'cancelled'

  const tasksOverdue = appointment.tasks.filter(
    tk => tk.status !== 'done' && tk.status !== 'cancelled' && !!tk.due_at && new Date(tk.due_at) < new Date()
  )

  const STATUS_COLOR: Record<AppointmentStatus, string> = {
    scheduled:   colors.primary,
    completed:   colors.success,
    cancelled:   colors.danger,
    no_show:     colors.warning,
    rescheduled: colors.textSecondary,
  }

  // ── Sections ───────────────────────────────────────────────────────────────────

  const heroSection = (
    <View style={styles.heroCard}>
      <View style={styles.heroRow}>
        <View style={[styles.heroAccent, { backgroundColor: accentColor }]} />
        <View style={styles.heroBody}>
          <Text style={styles.heroTitle}>{appointment.title}</Text>
          <Text style={styles.heroSub}>
            {dateStr} · {startTime} → {endTime} · {appointment.duration_minutes} min
          </Text>

          <View style={styles.pillsRow}>
            {/* RDV-1 §5 — statut affiché ici uniquement sur mobile (pas de colonne latérale) ;
                sur web il figure déjà, en lecture seule, dans la colonne de droite (sidebar) —
                jamais les deux à la fois. isCancelled a déjà sa propre pill plus bas : on évite
                de répéter "Annulé" deux fois. */}
            {!isWeb && appointment.status !== 'cancelled' ? (
              <View style={[styles.pill, { backgroundColor: STATUS_COLOR[appointment.status] + '22' }]}>
                <Text style={[styles.pillText, { color: STATUS_COLOR[appointment.status] }]}>
                  ●  {t(`appointment_statuses.${appointment.status}` as any)}
                </Text>
              </View>
            ) : null}
            <View style={[styles.pill, { backgroundColor: accentColor + '22' }]}>
              <Text style={[styles.pillText, { color: accentColor }]}>
                {t(`appointment_types.${appointment.appointment_type}` as any)}
              </Text>
            </View>
            {biz?.prospect_temperature ? (
              <View style={[styles.pill, { backgroundColor: TEMP_COLOR[biz.prospect_temperature] + '22' }]}>
                <TempIcon temp={biz.prospect_temperature} size={12} color={TEMP_COLOR[biz.prospect_temperature]} />
                <Text style={[styles.pillText, { color: TEMP_COLOR[biz.prospect_temperature] }]}>
                  {t(`prospect_temperatures.${biz.prospect_temperature}` as any)}
                </Text>
              </View>
            ) : null}
            {biz?.pipeline_stage ? (
              <View style={[styles.pill, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.pillText, { color: colors.primary }]}>
                  {getPipelineStageLabel(biz.pipeline_stage)}
                </Text>
              </View>
            ) : null}
            {isCancelled ? (
              <View style={[styles.pill, { backgroundColor: colors.danger + '22' }]}>
                <Text style={[styles.pillText, { color: colors.danger }]}>
                  {t('appointment_statuses.cancelled')}
                </Text>
              </View>
            ) : null}
            {biz?.outcome ? (
              <View style={[styles.pill, { backgroundColor: OUTCOME_COLOR[biz.outcome] + '22' }]}>
                <Text style={[styles.pillText, { color: OUTCOME_COLOR[biz.outcome] }]}>
                  {t(`appointment_outcomes.${biz.outcome}` as any)}
                </Text>
              </View>
            ) : null}
          </View>

          {(biz?.commercial_intent?.length || biz?.estimated_value != null || appointment.location || practitionerName) ? (
            <View style={styles.metaGrid}>
              {biz?.commercial_intent?.length ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.meta_intent')}</Text>
                  <Text style={styles.metaValue}>{biz.commercial_intent.map(i => getIntentLabel(i)).join(', ')}</Text>
                </View>
              ) : null}
              {biz?.estimated_value != null ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.field_value')}</Text>
                  <Text style={styles.metaValue}>{formatMoney(biz.estimated_value, locale)}</Text>
                </View>
              ) : null}
              {!!appointment.location ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.field_location')}</Text>
                  <Text style={styles.metaValue}>{appointment.location}</Text>
                </View>
              ) : null}
              {!!practitionerName ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.meta_practitioner')}</Text>
                  <Text style={styles.metaValue}>{practitionerName}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )

  const statusSection = (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.status_label')}</Text>
      <View style={styles.statusPills}>
        {STATUS_PILLS.map(s => {
          const active = appointment.status === s
          const showSpinner = isCompleting && s === 'completed'
          return (
            <TouchableOpacity
              key={s}
              onPress={() => handleStatusChange(s)}
              disabled={isCompleting}
              style={[
                styles.statusPill,
                active && { backgroundColor: STATUS_COLOR[s] + '22', borderColor: STATUS_COLOR[s] },
                isCompleting && { opacity: 0.6 },
              ]}
              activeOpacity={0.75}
            >
              {showSpinner ? (
                <ActivityIndicator size="small" color={STATUS_COLOR[s]} />
              ) : (
                <Text style={[
                  styles.statusPillText,
                  { color: active ? STATUS_COLOR[s] : colors.textSecondary },
                  active && { fontFamily: fonts.semibold },
                ]}>
                  {t(`appointment_statuses.${s}` as any)}
                </Text>
              )}
            </TouchableOpacity>
          )
        })}
      </View>
    </View>
  )

  // Option A validée : au-delà de la conversion (Client/Distributeur), la température et les
  // intentions "Devenir…" déjà atteintes n'ont plus de sens — mais uniquement tant que le RDV
  // n'est pas déjà terminé, pour ne jamais réécrire rétroactivement un débrief passé.
  const applyConversionFilter = appointment.status !== 'completed'
  const isCustomerOrAbove = applyConversionFilter && (biz?.pipeline_stage === 'customer' || biz?.pipeline_stage === 'distributor')
  const isDistributorStage = applyConversionFilter && biz?.pipeline_stage === 'distributor'
  const visibleIntents = INTENT_PILLS.filter(intent =>
    !((intent === 'become_customer' && isCustomerOrAbove) || (intent === 'become_distributor' && isDistributorStage))
  )

  // become_customer/become_distributor désignent exactement les rôles système customer/
  // distributor (contrairement à build_team/training/support/other, qui n'ont pas
  // d'équivalent ContactRole) — leur libellé doit donc suivre la personnalisation utilisateur
  // (Mes libellés), jamais un mot d'entreprise en dur.
  function getIntentLabel(intent: CommercialIntent): string {
    if (intent === 'become_customer') return t('commercial_intents.become_role', { role: getRoleLabel('customer') })
    if (intent === 'become_distributor') return t('commercial_intents.become_role', { role: getRoleLabel('distributor') })
    return t(GENERIC_INTENT_I18N_KEYS[intent])
  }

  const commercialSection = (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.section_commercial')}</Text>

      {biz?.outcome ? (
        <View style={[styles.outcomeBadge, { backgroundColor: OUTCOME_COLOR[biz.outcome] + '22', borderColor: OUTCOME_COLOR[biz.outcome] }]}>
          <Text style={[styles.outcomeBadgeText, { color: OUTCOME_COLOR[biz.outcome] }]}>
            {t('appointments.field_outcome')} · {t(`appointment_outcomes.${biz.outcome}` as any)}
          </Text>
        </View>
      ) : null}

      {/* "Autres retombées" persistées — simple rappel informatif, jamais son propre badge de
          statut ni une donnée suivie par la révision. */}
      {biz?.other_outcomes && biz.other_outcomes.length > 0 ? (
        <Text style={styles.otherOutcomesText}>
          {t('appointments.field_other_outcomes')} : {biz.other_outcomes.map(o => t(`appointment_outcomes.${o}` as any)).join(', ')}
        </Text>
      ) : null}

      {appointment.status === 'completed' && biz?.outcome && biz.outcome !== 'follow_up_required' ? (
        <TouchableOpacity onPress={handleOpenRevision} style={styles.reviseOutcomeBtn} activeOpacity={0.75}>
          <Text style={styles.reviseOutcomeBtnText}>{t('appointments.revision_open_action')}</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.commercialSubLabel}>{t('appointments.field_pipeline')}</Text>
      <View style={styles.statusPills}>
        {PIPELINE_STAGES.map(stage => {
          const active = biz?.pipeline_stage === stage
          return (
            <TouchableOpacity
              key={stage}
              onPress={() => handlePipelineChange(stage)}
              style={[styles.statusPill, active && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
              activeOpacity={0.75}
            >
              <Text style={[styles.statusPillText, { color: active ? colors.primary : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                {getPipelineStageLabel(stage)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {!isCustomerOrAbove && (
        <>
          <Text style={styles.commercialSubLabel}>{t('appointments.field_temperature')}</Text>
          <View style={styles.statusPills}>
            {TEMPERATURE_PILLS.map(temp => {
              const active = biz?.prospect_temperature === temp
              return (
                <TouchableOpacity
                  key={temp}
                  onPress={() => handleTemperatureChange(temp)}
                  style={[styles.statusPill, active && { backgroundColor: TEMP_COLOR[temp] + '22', borderColor: TEMP_COLOR[temp] }]}
                  activeOpacity={0.75}
                >
                  <View style={styles.statusPillTempRow}>
                    <TempIcon temp={temp} size={13} color={active ? TEMP_COLOR[temp] : colors.textSecondary} />
                    <Text style={[styles.statusPillText, { color: active ? TEMP_COLOR[temp] : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                      {t(`prospect_temperatures.${temp}` as any)}
                    </Text>
                  </View>
                </TouchableOpacity>
              )
            })}
          </View>
        </>
      )}

      <Text style={styles.commercialSubLabel}>{t('appointments.field_intent')}</Text>
      <View style={styles.statusPills}>
        {visibleIntents.map(intent => {
          const active = !!biz?.commercial_intent?.includes(intent)
          return (
            <TouchableOpacity
              key={intent}
              onPress={() => handleIntentToggle(intent)}
              style={[styles.statusPill, active && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
              activeOpacity={0.75}
            >
              <Text style={[styles.statusPillText, { color: active ? colors.primary : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                {getIntentLabel(intent)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      {/* RDV-1 §9 — n'apparaît que si "Autre" est sélectionnée ; disparaît et efface sa
          valeur dès que l'intention est désélectionnée (handleIntentToggle). */}
      {biz?.commercial_intent?.includes('other') ? (
        <>
          <Text style={styles.commercialSubLabel}>{t('appointments.field_intent_other_label')}</Text>
          <TextInput
            style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
            value={intentOtherLabel}
            onChangeText={(v) => { setIntentOtherLabel(v.slice(0, 80)); setIntentOtherLabelDirty(true) }}
            placeholder={t('appointments.intent_other_placeholder')}
            placeholderTextColor={colors.textTertiary}
            maxLength={80}
          />
          {intentOtherLabelDirty ? (
            <TouchableOpacity
              style={[styles.saveBtn, savingIntentOtherLabel && styles.saveBtnDisabled]}
              onPress={handleSaveIntentOtherLabel}
              disabled={savingIntentOtherLabel}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>
                {savingIntentOtherLabel ? t('appointments.saving') : t('common.save')}
              </Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      {/* RDV-PRODUCTS-1 / Lot D — vue de sélection commerciale sur discussedProducts (aucune
          deuxième liste, §1). Pas de duplication de l'état vide de "Produits discutés" : rien
          n'est affiché ici si la liste est vide (§3). Édition produit/quantité/prix réservée à
          la section "Produits discutés" plus haut (§21) — ici uniquement la case à cocher et le
          résumé quantité/prix/montant. */}
      {discussedProducts.length > 0 ? (() => {
        const { sum, hasConsidered, hasUnpriced } = computeConsideredTotal(discussedProducts)
        const unpricedConsideredCount = discussedProducts.filter(p => p.considered && p.unitPriceEur == null).length
        return (
          <>
            <Text style={styles.commercialSubLabel}>{t('appointments.considered_products_title')}</Text>
            {discussedProducts.map((p, i) => (
              <TouchableOpacity key={i} style={styles.consideredProductRow} onPress={() => toggleDiscussedProductConsidered(i)} activeOpacity={0.75}>
                <View style={[styles.taskCheckBox, p.considered && { backgroundColor: colors.success, borderColor: colors.success }]}>
                  {p.considered && <Check size={12} color="#fff" strokeWidth={3} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.consideredProductLabel} numberOfLines={1}>{p.label || t('appointments.outcome_sale_product_placeholder')}</Text>
                  <Text style={styles.consideredProductDetail}>
                    {p.unitPriceEur != null
                      ? `${p.quantity} × ${formatMoney(p.unitPriceEur, locale)} = ${formatMoney(p.quantity * p.unitPriceEur, locale)}`
                      : t('catalog.price_not_set')}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
            {/* Lot D.1 — un sous-total partiel est affiché mais jamais présenté comme le total :
                formulation dédiée ("Sous-total connu"), distincte de "Valeur estimée" plus bas,
                qu'elle ne remplace jamais automatiquement. */}
            {hasUnpriced && hasConsidered && sum > 0 ? (
              <Text style={styles.noFollowupHint}>
                {t('appointments.considered_products_known_subtotal', { amount: formatMoneyAmount(sum, locale) })}
              </Text>
            ) : null}
            {/* P4 §5 — mise en avant discrète (⚠ + couleur warning), jamais présenté comme une
                simple information neutre : l'utilisateur doit remarquer que la valeur estimée
                peut être incomplète. */}
            {hasUnpriced ? (
              <Text style={styles.priceWarningText}>
                ⚠ {t('appointments.considered_products_price_warning', { count: unpricedConsideredCount })}
              </Text>
            ) : null}
          </>
        )
      })() : null}

      <Text style={styles.commercialSubLabel}>{t('appointments.field_value')}</Text>
      <TextInput
        style={styles.bizValueInput}
        value={estValue}
        onChangeText={(v) => { estimatedValueUserTouchedRef.current = true; setEstValue(v); setBizValueDirty(true) }}
        placeholder="0.00"
        placeholderTextColor={colors.textTertiary}
        keyboardType="decimal-pad"
      />
      {(() => {
        // Lot D.1 — jamais proposé comme "le total" tant qu'un produit envisagé n'a pas de
        // prix connu : le bouton ne doit jamais faire passer un sous-total partiel pour complet.
        const { sum, hasConsidered, hasUnpriced } = computeConsideredTotal(discussedProducts)
        if (!hasConsidered || sum <= 0 || hasUnpriced) return null
        if (estValue.trim() && parseFloat(estValue.trim()) === sum) return null
        return (
          <TouchableOpacity onPress={handleUseCalculatedEstimatedValue} activeOpacity={0.7}>
            <Text style={styles.outcomeLinkText}>
              {t('appointments.considered_products_use_calculated', { amount: formatMoneyAmount(sum, locale) })}
            </Text>
          </TouchableOpacity>
        )
      })()}
      {bizValueDirty ? (
        <TouchableOpacity
          style={[styles.saveBtn, savingBizValue && styles.saveBtnDisabled]}
          onPress={handleSaveBizValue}
          disabled={savingBizValue}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>
            {savingBizValue ? t('appointments.saving') : t('common.save')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )

  // Lot 1.2.1 §5 — formulaires conditionnels du résultat, aperçu des automatismes, relance
  // personnelle et RDV futurs : une seule implémentation, rendue identiquement par la clôture
  // et par la révision (toutes deux pilotent les mêmes brouillons partagés ci-dessus).
  const outcomePlanSections = (
    <>
      <Text style={styles.commercialSubLabel}>{t('appointments.field_outcome')}</Text>
      {biz?.outcome === 'follow_up_required' && !outcomeDraft ? (
        <Text style={styles.noFollowupHint}>{t('appointments.outcome_historical_notice')}</Text>
      ) : null}
      <View style={styles.statusPills}>
        {OUTCOME_PILLS.map(outcome => {
          const active = outcomeDraft === outcome
          return (
            <TouchableOpacity
              key={outcome}
              onPress={() => handleSelectOutcome(outcome)}
              style={[styles.statusPill, active && { backgroundColor: OUTCOME_COLOR[outcome] + '22', borderColor: OUTCOME_COLOR[outcome] }]}
              activeOpacity={0.75}
            >
              <Text style={[styles.statusPillText, { color: active ? OUTCOME_COLOR[outcome] : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                {t(`appointment_outcomes.${outcome}` as any)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>
      {debriefAttempted && !outcomeDraft ? (
        <Text style={styles.debriefFieldError}>{t('appointments.error_outcome_required')}</Text>
      ) : null}

      {outcomePendingSwitch ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.debriefRecapLabel}>{t('appointments.outcome_switch_confirm')}</Text>
          <View style={styles.debriefNoClientRow}>
            <TouchableOpacity style={styles.debriefSecondaryBtn} onPress={cancelOutcomeSwitch} activeOpacity={0.8}>
              <Text style={styles.debriefSecondaryBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.debriefDoneBtn, { flex: 1, marginTop: 0 }]} onPress={confirmOutcomeSwitch} activeOpacity={0.85}>
              <Text style={styles.debriefDoneBtnText}>{t('appointments.outcome_switch_confirm_action')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* "Autres retombées" — multi-choix optionnel, indépendant du résultat principal (pas de
          formulaire de détails propre, jamais suivi par la révision). Affiché seulement une fois
          un résultat principal choisi ; le résultat principal lui-même n'est jamais proposé ici. */}
      {outcomeDraft ? (
        <>
          <Text style={styles.commercialSubLabel}>{t('appointments.field_other_outcomes')}</Text>
          <View style={styles.statusPills}>
            {OTHER_OUTCOME_TAG_OPTIONS.filter(outcome => outcome !== outcomeDraft).map(outcome => {
              const active = otherOutcomesDraft.includes(outcome)
              return (
                <TouchableOpacity
                  key={outcome}
                  onPress={() => toggleOtherOutcome(outcome)}
                  style={[styles.statusPill, active && { backgroundColor: OUTCOME_COLOR[outcome] + '22', borderColor: OUTCOME_COLOR[outcome] }]}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.statusPillText, { color: active ? OUTCOME_COLOR[outcome] : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                    {t(`appointment_outcomes.${outcome}` as any)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </>
      ) : null}

      {/* ── Détails conditionnels — un seul résultat visible à la fois (Principe 4) ── */}
      {/* RDV-CLOSURE-PRODUCTS/P1 — suggestion explicite, jamais une vente automatique (§3-4) :
          masquée en révision (§18) — les produits considered ont pu être modifiés après la
          vente d'origine, les reprendre rétroactivement risquerait un décalage temporel avec
          ce qui a réellement été discuté au moment de CETTE clôture. Les boutons manuels
          "+ Catalogue"/"+ Produit libre" restent inchangés et disponibles dans les deux cas. */}
      {outcomeDraft === 'sale_completed' && !showRevision ? (() => {
        const missing = getMissingConsideredProducts()
        if (missing.length === 0) return null
        const allMissing = missing.length === discussedProducts.filter(p => p.considered).length
        return (
          <View style={styles.debriefRecap}>
            <Text style={styles.commercialSubLabel}>{t('appointments.outcome_sale_considered_title')}</Text>
            {missing.map((p, i) => (
              <View key={i} style={styles.consideredProductRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.consideredProductLabel} numberOfLines={1}>{p.label}</Text>
                  <Text style={styles.consideredProductDetail}>
                    {p.unitPriceEur != null
                      ? `${p.quantity} × ${formatMoney(p.unitPriceEur, locale)}`
                      : t('catalog.price_not_set')}
                  </Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={styles.debriefSuggestBtn} onPress={handleReuseConsideredProducts} activeOpacity={0.8}>
              <ArrowDown size={16} color={colors.primary} strokeWidth={2.5} />
              <Text style={styles.debriefSuggestBtnText}>
                {allMissing
                  ? t('appointments.outcome_sale_considered_reuse_all', { count: missing.length })
                  : t('appointments.outcome_sale_considered_reuse_missing', { count: missing.length })}
              </Text>
            </TouchableOpacity>
          </View>
        )
      })() : null}

      {outcomeDraft === 'sale_completed' && outcomeDetailsDraft?.kind === 'sale_completed' ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.commercialSubLabel}>{t('appointments.outcome_sale_products')}</Text>
          {/* P4 §11/§12 — amount (= prix unitaire, doctrine P1) est écrit dans outcome_details
              depuis toujours, mais n'avait jamais de champ pour le voir/l'éditer ici : ajouté ci-
              dessous, même schéma flex/largeurs et mêmes en-têtes que "Produits discutés" plus
              haut (§2 — une seule convention visuelle pour ce type de ligne dans tout l'écran). */}
          {saleProducts.length > 0 ? (
            <View style={styles.productColumnHeaderRow}>
              <Text style={[styles.productColumnHeaderText, { flex: 1 }]}>{t('appointments.column_product')}</Text>
              <Text style={[styles.productColumnHeaderText, { width: 48, textAlign: 'center' }]}>{t('appointments.column_quantity')}</Text>
              <Text style={[styles.productColumnHeaderText, { width: 88, textAlign: 'center' }]}>{t('appointments.column_unit_price')}</Text>
              <View style={{ width: 16 }} />
            </View>
          ) : null}
          {(saleListExpanded ? saleProducts : saleProducts.slice(0, 3)).map((p, i) => (
            <View key={i} style={styles.saleProductRow}>
              <TextInput
                style={[styles.bizValueInput, { flex: 1, maxWidth: undefined }]}
                value={p.label}
                onChangeText={(v) => updateSaleProduct(i, { label: v })}
                placeholder={t('appointments.outcome_sale_product_placeholder')}
                placeholderTextColor={colors.textTertiary}
              />
              <TextInput
                style={[styles.bizValueInput, { width: 48, textAlign: 'center' }]}
                value={String(p.quantity)}
                onChangeText={(v) => updateSaleProduct(i, { quantity: Math.max(1, parseInt(v.replace(/\D/g, ''), 10) || 1) })}
                keyboardType="number-pad"
              />
              {/* §11 — prix absent = champ vide ("Prix non renseigné" en placeholder), jamais un
                  0 artificiel écrit à la place ; `undefined` explicite quand l'utilisateur vide
                  le champ, jamais silencieusement remplacé (même garde que Produits discutés). */}
              <TextInput
                style={[styles.bizValueInput, { width: 88, textAlign: 'center' }]}
                value={p.amount != null ? String(p.amount) : ''}
                onChangeText={(v) => {
                  const n = parseFloat(v.replace(',', '.'))
                  updateSaleProduct(i, { amount: v.trim() === '' ? undefined : (Number.isFinite(n) && n >= 0 ? n : p.amount) })
                }}
                placeholder={t('catalog.price_not_set')}
                placeholderTextColor={colors.textTertiary}
                keyboardType="decimal-pad"
              />
              <TouchableOpacity onPress={() => removeSaleProduct(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
          {saleProducts.length > 3 ? (
            <TouchableOpacity onPress={() => setSaleListExpanded(v => !v)} activeOpacity={0.7}>
              <Text style={styles.outcomeLinkText}>
                {saleListExpanded ? t('appointments.outcome_sale_collapse') : t('appointments.outcome_sale_expand', { count: saleProducts.length - 3 })}
              </Text>
            </TouchableOpacity>
          ) : null}
          {/* P4 §11/§13 — Total, affichage pur (computeSaleTotal, même formule que la commande
              réelle) ; masqué si aucun produit n'a encore de prix (jamais un "Total : 0,00 €"
              artificiel, même doctrine que "Sous-total connu" plus haut). */}
          {(() => {
            const { sum, hasUnpriced } = computeSaleTotal(saleProducts)
            if (saleProducts.length === 0 || sum <= 0) return null
            const unpricedSaleCount = saleProducts.filter(p => p.amount == null).length
            return (
              <>
                <View style={styles.saleTotalRow}>
                  <Text style={styles.saleTotalLabel}>{t('appointments.outcome_sale_total_label')}</Text>
                  <Text style={styles.saleTotalValue}>{formatMoney(sum, locale)}</Text>
                </View>
                {hasUnpriced ? (
                  <Text style={styles.priceWarningText}>
                    ⚠ {t('appointments.outcome_sale_price_warning', { count: unpricedSaleCount })}
                  </Text>
                ) : null}
              </>
            )
          })()}
          <View style={styles.debriefNoClientRow}>
            <TouchableOpacity style={styles.debriefSecondaryBtn} onPress={() => setShowSalePicker(true)} activeOpacity={0.8}>
              <Text style={styles.debriefSecondaryBtnText}>{t('appointments.outcome_sale_add_catalog')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.debriefSecondaryBtn} onPress={handleAddFreeSaleProduct} activeOpacity={0.8}>
              <Text style={styles.debriefSecondaryBtnText}>{t('appointments.outcome_sale_add_free')}</Text>
            </TouchableOpacity>
          </View>
          {saleProducts.length > 0 ? (
            <Text style={styles.noFollowupHint}>{t('appointments.outcome_sale_order_planned')}</Text>
          ) : null}
          {saleProducts.length > 0 ? (
            <View style={styles.lrpToggleRow}>
              <Text style={styles.switchLabel}>{t('appointments.outcome_sale_is_lrp', { name: getLrpName() })}</Text>
              <Switch value={isLrpSaleDraft} onValueChange={handleToggleSaleIsLrp} trackColor={{ true: colors.secondary }} />
            </View>
          ) : null}
          {/* LRP-3 §19 — jamais affiché en révision : la révision ne peut jamais avancer le
              programme contact (upsert = mise à jour, created=false), afficher ce bloc induirait
              l'utilisateur en erreur en laissant croire qu'une confirmation aurait un effet. */}
          {isLrpSaleDraft && !showRevision && isModuleActive('renewals_lrp') && lrpProgramValueDraft ? (
            <LrpProgramFields
              candidatePrograms={activePrograms}
              orderDate={new Date().toISOString().split('T')[0]}
              value={lrpProgramValueDraft}
              onChange={setLrpProgramValueDraft}
            />
          ) : null}
        </View>
      ) : null}

      {outcomeDraft === 'interested' && outcomeDetailsDraft?.kind === 'interested' ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.commercialSubLabel}>{t('appointments.outcome_interested_question')}</Text>
          <View style={styles.statusPills}>
            {INTEREST_KIND_PILLS.map(kind => {
              const active = outcomeDetailsDraft.interests.includes(kind)
              return (
                <TouchableOpacity key={kind} onPress={() => toggleInterestChip(kind)} style={[styles.statusPill, active && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]} activeOpacity={0.75}>
                  <Text style={[styles.statusPillText, { color: active ? colors.primary : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                    {t(`outcome_interest_kinds.${kind}` as any)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* RDV-CLOSURE-PRODUCTS/P0 — synthèse des produits déjà envisagés sur la fiche RDV
              (discussed_products, considered=true) : aucune nouvelle donnée, aucune nouvelle
              requête. Décochable (réutilise exactement toggleDiscussedProductConsidered/
              commitDiscussedProducts du Lot D) plutôt qu'une seconde logique de sélection propre
              à la clôture — décocher ici modifie réellement discussed_products, pas un état
              temporaire de la modale. */}
          {PRODUCT_RELATED_INTEREST_KINDS.some(k => outcomeDetailsDraft.interests.includes(k)) ? (() => {
            const consideredEntries = discussedProducts.map((p, i) => ({ p, i })).filter(({ p }) => p.considered)
            const { hasUnpriced } = computeConsideredTotal(discussedProducts)
            const unpricedCount = consideredEntries.filter(({ p }) => p.unitPriceEur == null).length
            return (
              <View style={styles.debriefRecap}>
                <Text style={styles.commercialSubLabel}>{t('appointments.closure_products_title')}</Text>
                {consideredEntries.length === 0 ? (
                  <Text style={styles.noFollowupHint}>{t('appointments.closure_products_empty')}</Text>
                ) : (
                  <>
                    {consideredEntries.map(({ p, i }) => (
                      <TouchableOpacity key={i} style={styles.consideredProductRow} onPress={() => toggleDiscussedProductConsidered(i)} activeOpacity={0.75}>
                        <View style={[styles.taskCheckBox, { backgroundColor: colors.success, borderColor: colors.success }]}>
                          <Check size={12} color="#fff" strokeWidth={3} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.consideredProductLabel} numberOfLines={1}>{p.label}</Text>
                          <Text style={styles.consideredProductDetail}>
                            {p.unitPriceEur != null
                              ? `${p.quantity} × ${formatMoney(p.unitPriceEur, locale)} = ${formatMoney(p.quantity * p.unitPriceEur, locale)}`
                              : t('catalog.price_not_set')}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                    {hasUnpriced ? (
                      <Text style={styles.priceWarningText}>
                        ⚠ {t('appointments.considered_products_price_warning', { count: unpricedCount })}
                      </Text>
                    ) : null}
                    {/* §8 — affiche la valeur déjà établie sur la fiche (manuelle ou auto-calculée
                        en amont), ne recalcule jamais une valeur propre à cette modale, n'invente
                        jamais 0 € si elle est absente. */}
                    {estValue.trim() ? (
                      <View style={styles.debriefRecapRow}>
                        <Text style={styles.debriefRecapLabel}>{t('appointments.field_value')}</Text>
                        <Text style={styles.debriefRecapValue}>{formatMoney(parseFloat(estValue), locale)}</Text>
                      </View>
                    ) : null}
                  </>
                )}
              </View>
            )
          })() : null}

          <TextInput
            style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
            value={outcomeDetailsDraft.freeText ?? ''}
            onChangeText={(v) => setOutcomeDetailsDraft(prev => prev?.kind === 'interested' ? { ...prev, freeText: v } : prev)}
            placeholder={t('appointments.outcome_interested_free_text_placeholder')}
            placeholderTextColor={colors.textTertiary}
          />
          {/* RDV-CLOSURE-PRODUCTS/P2 — masqué en révision (§13), comme la reprise Vente
              réalisée du P1 : les produits considered ont pu changer depuis la clôture
              d'origine, éviter tout raccourci ambigu sur un RDV déjà completed. Le bouton
              générique reste disponible à l'identique dans les deux modes. */}
          {(() => {
            const consideredForReco = !showRevision
              ? discussedProducts.map((p, i) => ({ p, i })).filter(({ p }) => p.considered)
              : []
            const contextualLabel = consideredForReco.length > 0
              ? t('appointments.outcome_interested_create_reco_from_considered', { count: consideredForReco.length })
              : t('appointments.outcome_interested_create_reco')
            const canEnable = !!outcomeDetailsDraft.interests.length || !!outcomeDetailsDraft.freeText?.trim() || consideredForReco.length > 0
            return (
              <>
                <TouchableOpacity
                  style={[styles.debriefSecondaryBtnStandalone, !recommendationPlanned && !canEnable && styles.saveBtnDisabled]}
                  onPress={toggleRecommendationPlanned}
                  disabled={!recommendationPlanned && !canEnable}
                  activeOpacity={0.8}
                >
                  <Text style={styles.debriefSecondaryBtnText}>
                    {recommendationPlanned ? t('appointments.outcome_interested_reco_remove_plan') : contextualLabel}
                  </Text>
                </TouchableOpacity>
                {recommendationPlanned && consideredForReco.length > 0 ? (
                  <View style={styles.debriefRecap}>
                    {/* RDV-CLOSURE-PRODUCTS/P2.1 — sélection UNIQUE (1 recommandation = 1
                        produit, audit P2) : choisir une ligne désélectionne implicitement
                        toute autre, re-cliquer la ligne déjà choisie désélectionne (aucun
                        choix reste une valeur valide, Test D). Même habillage visuel que les
                        cases à cocher du reste de la modale, comportement radio. */}
                    <Text style={styles.commercialSubLabel}>{t('appointments.outcome_interested_reco_choose_product_title')}</Text>
                    {consideredForReco.map(({ p, i }) => {
                      const active = recommendationProductIndex === i
                      return (
                        <TouchableOpacity key={i} style={styles.consideredProductRow} onPress={() => selectRecommendationProductIndex(i)} activeOpacity={0.75}>
                          <View style={[styles.taskCheckBox, active && { backgroundColor: colors.success, borderColor: colors.success }]}>
                            {active && <Check size={12} color="#fff" strokeWidth={3} />}
                          </View>
                          <Text style={styles.consideredProductLabel} numberOfLines={1}>{p.label}</Text>
                        </TouchableOpacity>
                      )
                    })}
                  </View>
                ) : null}
              </>
            )
          })()}
          {recommendationPlanned ? (
            <Text style={styles.noFollowupHint}>{t('appointments.outcome_interested_reco_planned')}</Text>
          ) : null}
        </View>
      ) : null}

      {outcomeDraft === 'not_interested' && outcomeDetailsDraft?.kind === 'not_interested' ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.commercialSubLabel}>{t('appointments.outcome_not_interested_reason')}</Text>
          <View style={styles.statusPills}>
            {NOT_INTERESTED_REASON_PILLS.map(reason => {
              const active = outcomeDetailsDraft.reason === reason
              return (
                <TouchableOpacity key={reason} onPress={() => setOutcomeDetailsDraft(prev => prev?.kind === 'not_interested' ? { ...prev, reason } : prev)} style={[styles.statusPill, active && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]} activeOpacity={0.75}>
                  <Text style={[styles.statusPillText, { color: active ? colors.primary : colors.textSecondary }, active && { fontFamily: fonts.semibold }]}>
                    {t(`not_interested_reasons.${reason}` as any)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          {outcomeDetailsDraft.reason === 'other' ? (
            <TextInput
              style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
              value={outcomeDetailsDraft.reasonOtherText ?? ''}
              onChangeText={(v) => setOutcomeDetailsDraft(prev => prev?.kind === 'not_interested' ? { ...prev, reasonOtherText: v } : prev)}
              placeholder={t('appointments.outcome_not_interested_other_placeholder')}
              placeholderTextColor={colors.textTertiary}
            />
          ) : null}
          <View style={styles.noFollowupRow}>
            <TouchableOpacity
              style={styles.taskCheck}
              onPress={() => setOutcomeDetailsDraft(prev => prev?.kind === 'not_interested' ? { ...prev, canBeRecontacted: !prev.canBeRecontacted } : prev)}
            >
              <View style={[styles.taskCheckBox, outcomeDetailsDraft.canBeRecontacted && { backgroundColor: colors.success, borderColor: colors.success }]}>
                {outcomeDetailsDraft.canBeRecontacted && <Check size={12} color="#fff" strokeWidth={3} />}
              </View>
            </TouchableOpacity>
            <Text style={styles.followupPlanLabel}>{t('appointments.outcome_not_interested_recontact')}</Text>
          </View>
        </View>
      ) : null}

      {outcomeDraft === 'partner_potential' && outcomeDetailsDraft?.kind === 'partner_potential' ? (
        <View style={styles.debriefRecap}>
          {([
            ['interestArea', 'outcome_partner_potential_interest_area'],
            ['motivation', 'outcome_partner_potential_motivation'],
            ['objective', 'outcome_partner_potential_objective'],
            ['availability', 'outcome_partner_potential_availability'],
            ['mainObjection', 'outcome_partner_potential_objection'],
            ['comment', 'outcome_partner_potential_comment'],
          ] as const).map(([field, key]) => (
            <View key={field} style={{ marginBottom: 8 }}>
              <Text style={styles.followupPlanDelayLabel}>{t(`appointments.${key}` as any)}</Text>
              <TextInput
                style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
                value={(outcomeDetailsDraft as PartnerPotentialDetails)[field] ?? ''}
                onChangeText={(v) => setOutcomeDetailsDraft(prev => prev?.kind === 'partner_potential' ? { ...prev, [field]: v } : prev)}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          ))}
        </View>
      ) : null}

      {outcomeDraft === 'partner_recruited' && outcomeDetailsDraft?.kind === 'partner_recruited' ? (
        <View style={styles.debriefRecap}>
          {([
            ['startDate', 'outcome_partner_recruited_start_date'],
            ['initialObjective', 'outcome_partner_recruited_objective'],
            ['mainNeed', 'outcome_partner_recruited_need'],
            ['comment', 'outcome_partner_recruited_comment'],
          ] as const).map(([field, key]) => (
            <View key={field} style={{ marginBottom: 8 }}>
              <Text style={styles.followupPlanDelayLabel}>{t(`appointments.${key}` as any)}</Text>
              <TextInput
                style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
                value={(outcomeDetailsDraft as PartnerRecruitedDetails)[field] ?? ''}
                onChangeText={(v) => setOutcomeDetailsDraft(prev => prev?.kind === 'partner_recruited' ? { ...prev, [field]: v } : prev)}
                placeholderTextColor={colors.textTertiary}
              />
            </View>
          ))}
          {clientInfo && !isDistributorStage ? (
            <Text style={styles.noFollowupHint}>{t('appointments.outcome_partner_recruited_role_hint')}</Text>
          ) : null}
        </View>
      ) : null}

      {outcomeDraft === 'other' ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.commercialSubLabel}>{t('appointments.outcome_other_label')}</Text>
          <TextInput
            style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
            value={outcomeOtherLabelDraft}
            onChangeText={(v) => setOutcomeOtherLabelDraft(v.slice(0, 80))}
            placeholder={t('appointments.outcome_other_placeholder')}
            placeholderTextColor={colors.textTertiary}
            maxLength={80}
          />
          {debriefAttempted && !outcomeOtherLabelDraft.trim() ? (
            <Text style={styles.debriefFieldError}>{t('appointments.error_outcome_other_required')}</Text>
          ) : null}
        </View>
      ) : null}

      {/* ── Automatismes de commande prévus — lecture seule, aucune création ici (§11) ──
          RDV-FOLLOWUP-1/P0 : le trigger 'appointment' (règle appt_j7) ne fait plus partie de
          cet aperçu — il est désormais représenté par la section éditable "Relance après ce
          RDV" plus bas. Les automatismes de commande (order/first_order) restent, eux,
          inchangés et toujours affichés indépendamment de la décision de suite du RDV. */}
      {outcomeDraft && outcomeDraft === 'sale_completed' && saleProducts.length > 0 ? (() => {
        const rules = getApplicableAutomationRules(isFirstOrderFlag ? 'first_order' : 'order')
          .filter(r => isModuleActive(r.moduleKey as any))
        if (rules.length === 0) return null
        const firstName = clientInfo?.first_name || clientInfo?.full_name?.split(' ')[0] || ''
        return (
          <View style={styles.debriefRecap}>
            <Text style={styles.commercialSubLabel}>{t('appointments.outcome_automations_title')}</Text>
            {rules.map(rule => {
              const delay = getAutomationDelay(rule.id, rule.delayDays)
              return (
                <View key={rule.id} style={styles.debriefRecapRow}>
                  <Text style={styles.debriefRecapLabel} numberOfLines={1}>{renderRuleTitle(rule, firstName, delay)}</Text>
                </View>
              )
            })}
          </View>
        )
      })() : null}

      {/* ── RDV futurs existants (§13) ───────────────────────────────────────── */}
      {outcomeDraft && upcomingAppts.length > 0 ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.commercialSubLabel}>{t('appointments.outcome_upcoming_appts_title')}</Text>
          {upcomingAppts.map(a => {
            const active = selectedUpcomingId === a.id
            return (
              <TouchableOpacity key={a.id} style={styles.debriefRecapRow} onPress={() => setSelectedUpcomingId(active ? null : a.id)} activeOpacity={0.75}>
                <Text style={styles.debriefRecapLabel} numberOfLines={1}>{a.title} · {formatDate(a.start_at, locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                <View style={[styles.taskCheckBox, active && { backgroundColor: colors.success, borderColor: colors.success }]}>
                  {active && <Check size={12} color="#fff" strokeWidth={3} />}
                </View>
              </TouchableOpacity>
            )
          })}
          {selectedUpcomingId ? <Text style={styles.noFollowupHint}>{t('appointments.outcome_upcoming_appt_selected')}</Text> : null}
        </View>
      ) : null}

      {/* ── Relance après ce RDV (RDV-FOLLOWUP-1/P0) ───────────────────────────
          Fusion de l'ancien aperçu automatique "appt_j7" et de la relance personnelle en une
          seule section : préremplie par la règle (§6) mais entièrement éditable/décochable
          (§4-5), protégée par closure_action_key comme n'importe quelle relance personnelle
          (§20) — plus de dédoublonnage fragile basé sur le titre. */}
      {outcomeDraft && appointment.client_id ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.commercialSubLabel}>{t('appointments.outcome_personal_followup_title')}</Text>
          <View style={styles.noFollowupRow}>
            <TouchableOpacity style={styles.taskCheck} onPress={togglePersonalFollowupPlanned}>
              <View style={[styles.taskCheckBox, personalFollowupPlanned && { backgroundColor: colors.success, borderColor: colors.success }]}>
                {personalFollowupPlanned && <Check size={12} color="#fff" strokeWidth={3} />}
              </View>
            </TouchableOpacity>
            <Text style={styles.followupPlanLabel}>{t('appointments.outcome_followup_after_appt_toggle')}</Text>
          </View>
          <View style={[styles.statusPills, !personalFollowupPlanned && { opacity: 0.4 }]}>
            {(['call', 'whatsapp', 'sms', 'email', 'rdv'] as NextActionType[]).map(type => (
              <TouchableOpacity
                key={type}
                disabled={!personalFollowupPlanned}
                onPress={() => { markPersonalFollowupTouched(); setPersonalFollowupType(type) }}
                style={[styles.statusPill, personalFollowupType === type && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
                activeOpacity={0.75}
              >
                <Text style={[styles.statusPillText, { color: personalFollowupType === type ? colors.primary : colors.textSecondary }]}>{t(`next_action_types.${type}` as any)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[styles.statusPills, !personalFollowupPlanned && { opacity: 0.4 }]}>
            {FOLLOWUP_DATE_PRESETS.map(preset => (
              <TouchableOpacity
                key={preset}
                disabled={!personalFollowupPlanned}
                onPress={() => {
                  markPersonalFollowupTouched()
                  setPersonalFollowupDelayDays(String(followupPresetDays(preset)))
                  setPersonalFollowupDate(followupPresetDate(preset))
                  setFollowupConflict(null)
                }}
                style={[styles.statusPill, personalFollowupDate === followupPresetDate(preset) && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
                activeOpacity={0.75}
              >
                <Text style={[styles.statusPillText, { color: personalFollowupDate === followupPresetDate(preset) ? colors.primary : colors.textSecondary }]}>{t(`followups.preset_${preset}` as any)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Personnalisation du délai en nombre de jours (§ demande utilisateur) — même pattern
              que le "J+" des relances liées à l'intention commerciale plus bas, synchronisé avec
              la date effectivement enregistrée (personalFollowupDate). */}
          <View style={[styles.followupPlanDelay, !personalFollowupPlanned && { opacity: 0.4 }]}>
            <Text style={styles.followupPlanDelayLabel}>{t('appointments.debrief_followup_days_label')}</Text>
            <TextInput
              style={styles.followupPlanDelayInput}
              value={personalFollowupDelayDays}
              editable={personalFollowupPlanned}
              onChangeText={(v) => {
                markPersonalFollowupTouched()
                setPersonalFollowupDelayDays(v)
                const n = parseInt(v, 10)
                if (Number.isFinite(n) && n >= 0) { setPersonalFollowupDate(dueDateStr(n)); setFollowupConflict(null) }
              }}
              onBlur={handleCheckFollowupConflict}
              keyboardType="number-pad"
            />
          </View>
          {/* Correctif affichage — date au format JJ/MM/AAAA (composant DateInput déjà utilisé
              ailleurs dans l'app, ex. commandes/fiche contact) au lieu du texte ISO brut ;
              conflict-check désormais réactif (voir useEffect dédié) plutôt que sur onBlur,
              DateInput ne l'exposant pas. pointerEvents/opacity reproduisent la désactivation
              visuelle des champs voisins tant que la relance n'est pas activée. */}
          <View style={!personalFollowupPlanned ? { opacity: 0.4 } : undefined} pointerEvents={personalFollowupPlanned ? 'auto' : 'none'}>
            <DateInput
              value={personalFollowupDate}
              onChangeValue={(iso) => { markPersonalFollowupTouched(); setPersonalFollowupDate(iso); setFollowupConflict(null) }}
            />
          </View>
          <TextInput
            style={[styles.bizValueInput, { maxWidth: '100%', width: '100%' }, !personalFollowupPlanned && { opacity: 0.4 }]}
            value={personalFollowupTitle}
            editable={personalFollowupPlanned}
            onChangeText={(v) => { markPersonalFollowupTouched(); setPersonalFollowupTitle(v) }}
            placeholder={t('appointments.outcome_personal_followup_title_placeholder')}
            placeholderTextColor={colors.textTertiary}
          />
          <TextInput
            style={[styles.bizValueInput, { maxWidth: '100%', width: '100%' }, !personalFollowupPlanned && { opacity: 0.4 }]}
            value={personalFollowupComment}
            editable={personalFollowupPlanned}
            onChangeText={setPersonalFollowupComment}
            placeholder={t('appointments.outcome_personal_followup_comment_placeholder')}
            placeholderTextColor={colors.textTertiary}
          />
          {personalFollowupPlanned && followupConflict ? (
            <View style={styles.noFollowupRow}>
              <TouchableOpacity style={styles.taskCheck} onPress={() => setConfirmConflict(v => !v)}>
                <View style={[styles.taskCheckBox, confirmConflict && { backgroundColor: colors.warning, borderColor: colors.warning }]}>
                  {confirmConflict && <Check size={12} color="#fff" strokeWidth={3} />}
                </View>
              </TouchableOpacity>
              <Text style={styles.noFollowupHint}>{t('appointments.outcome_followup_conflict_warning')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  )

  const debriefModal = (
    <Modal visible={showDebrief} transparent animationType="slide" onRequestClose={() => { if (!isCompleting) setShowDebrief(false) }}>
      <View style={styles.debriefOverlay}>
        <View style={styles.debriefSheet}>
          <View style={styles.debriefHandle} />
          <View style={styles.debriefHeader}>
            <Text style={styles.debriefTitle}>{t('appointments.debrief_title')}</Text>
            <TouchableOpacity
              onPress={() => { if (!isCompleting) setShowDebrief(false) }}
              disabled={isCompleting}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={18} color={colors.textTertiary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <Text style={styles.debriefSub}>{t('appointments.debrief_sub')}</Text>

          <ScrollView style={{ maxHeight: 420 }}>
            <Text style={styles.commercialSubLabel}>{t('appointments.debrief_recap_title')}</Text>
            {(biz?.pipeline_stage || biz?.prospect_temperature || biz?.commercial_intent?.length) ? (
              <View style={styles.debriefRecap}>
                {biz?.pipeline_stage ? (
                  <View style={styles.debriefRecapRow}>
                    <Text style={styles.debriefRecapLabel}>{t('appointments.field_pipeline')}</Text>
                    <Text style={styles.debriefRecapValue}>{getPipelineStageLabel(biz.pipeline_stage)}</Text>
                  </View>
                ) : null}
                {!isCustomerOrAbove && biz?.prospect_temperature ? (
                  <View style={styles.debriefRecapRow}>
                    <Text style={styles.debriefRecapLabel}>{t('appointments.field_temperature')}</Text>
                    <Text style={styles.debriefRecapValue}>{t(`prospect_temperatures.${biz.prospect_temperature}` as any)}</Text>
                  </View>
                ) : null}
                {biz?.commercial_intent?.length ? (
                  <View style={styles.debriefRecapRow}>
                    <Text style={styles.debriefRecapLabel}>{t('appointments.field_intent')}</Text>
                    <Text style={styles.debriefRecapValue}>{biz.commercial_intent.map(i => getIntentLabel(i)).join(', ')}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={styles.debriefSub}>{t('appointments.debrief_recap_empty')}</Text>
            )}

            {outcomePlanSections}

            <Text style={styles.commercialSubLabel}>{t('appointments.debrief_followups_title')}</Text>
            {(() => {
              const labelByKey: Record<PostCompletionPlanKey, string> = {
                buy_product: 'appointments.debrief_followup_buy_product',
                become_distributor: 'appointments.debrief_followup_become_distributor',
                objection_task: 'appointments.debrief_followup_objection_task',
              }
              const rows = relevantFollowupKeys.map(key => ({ key, labelKey: labelByKey[key] }))

              if (rows.length === 0) {
                return <Text style={styles.debriefSub}>{t('appointments.debrief_followups_empty')}</Text>
              }

              return rows.map(({ key, labelKey }) => {
                const item = followupPlan[key]
                return (
                  <View key={key} style={styles.followupPlanRow}>
                    <TouchableOpacity
                      style={styles.taskCheck}
                      onPress={() => {
                        const willCreate = !followupPlan[key].create
                        setFollowupPlan(prev => ({ ...prev, [key]: { ...prev[key], create: willCreate } }))
                        // Exclusivité mutuelle : sélectionner une action décoche « Aucune suite ».
                        if (willCreate) setNoFollowupRequired(false)
                      }}
                    >
                      <View style={[styles.taskCheckBox, item.create && { backgroundColor: colors.success, borderColor: colors.success }]}>
                        {item.create && <Check size={12} color="#fff" strokeWidth={3} />}
                      </View>
                    </TouchableOpacity>
                    <Text style={[styles.followupPlanLabel, !item.create && { color: colors.textTertiary }]}>{t(labelKey as any)}</Text>
                    {item.create && (
                      <View style={styles.followupPlanDelay}>
                        <Text style={styles.followupPlanDelayLabel}>{t('appointments.debrief_followup_days_label')}</Text>
                        <TextInput
                          style={styles.followupPlanDelayInput}
                          value={String(item.delayDays)}
                          onChangeText={(v) => {
                            const n = parseInt(v, 10)
                            setFollowupPlan(prev => ({ ...prev, [key]: { ...prev[key], delayDays: Number.isFinite(n) && n >= 0 ? n : 0 } }))
                          }}
                          keyboardType="number-pad"
                        />
                      </View>
                    )}
                  </View>
                )
              })
            })()}

            <View style={styles.noFollowupRow}>
              <TouchableOpacity
                style={styles.taskCheck}
                disabled={relanceCreated || nextRdvCreated}
                onPress={() => {
                  const next = !noFollowupRequired
                  setNoFollowupRequired(next)
                  // Exclusivité mutuelle : cocher « Aucune suite » décoche les cases du plan.
                  if (next) {
                    setFollowupPlan(prev => Object.fromEntries(
                      Object.entries(prev).map(([k, v]) => [k, { ...v, create: false }]),
                    ) as typeof prev)
                  }
                }}
              >
                <View style={[
                  styles.taskCheckBox,
                  noFollowupRequired && { backgroundColor: colors.success, borderColor: colors.success },
                  (relanceCreated || nextRdvCreated) && { opacity: 0.4 },
                ]}>
                  {noFollowupRequired && <Check size={12} color="#fff" strokeWidth={3} />}
                </View>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={[styles.followupPlanLabel, (relanceCreated || nextRdvCreated) && { color: colors.textTertiary }]}>
                  {t('appointments.no_followup_required_label')}
                </Text>
                {noFollowupRequired ? (
                  <Text style={styles.noFollowupHint}>{t('appointments.no_followup_required_hint')}</Text>
                ) : !hasAnyNextStep && relevantFollowupKeys.length === 0 ? (
                  <Text style={styles.noFollowupHint}>{t('appointments.no_followup_required_only_option')}</Text>
                ) : null}
              </View>
            </View>
            {debriefAttempted && !hasAnyNextStep && !noFollowupRequired ? (
              <Text style={styles.debriefFieldError}>{t('appointments.error_next_step_required')}</Text>
            ) : null}
          </ScrollView>

          {inlineError && showDebrief ? <Text style={styles.errorText}>{inlineError}</Text> : null}

          {!appointment.client_id && appointment.status !== 'completed' ? (
            <>
              <Text style={styles.debriefWarningText}>{t('appointments.debrief_no_client_warning')}</Text>
              <View style={styles.debriefNoClientRow}>
                <TouchableOpacity
                  style={styles.debriefSecondaryBtn}
                  onPress={handleCreateContactFromDebrief}
                  disabled={isCompleting}
                  activeOpacity={0.8}
                >
                  <Text style={styles.debriefSecondaryBtnText}>{t('appointments.debrief_create_contact')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.debriefDoneBtn, { flex: 1 }, isCompleting && { opacity: 0.6 }]}
                  onPress={handleConfirmDebrief}
                  disabled={isCompleting}
                  activeOpacity={0.85}
                >
                  {isCompleting
                    ? <ActivityIndicator color="#ffffff" size="small" />
                    : <Text style={styles.debriefDoneBtnText}>{t('appointments.debrief_finish_without_contact')}</Text>}
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity
              style={[styles.debriefDoneBtn, isCompleting && { opacity: 0.6 }]}
              onPress={appointment?.status === 'completed' ? handleUpdateFollowupsOnCompleted : handleConfirmDebrief}
              disabled={isCompleting}
              activeOpacity={0.85}
            >
              {isCompleting
                ? <ActivityIndicator color="#ffffff" size="small" />
                : (
                  <Text style={styles.debriefDoneBtnText}>
                    {appointment?.status === 'completed' ? t('appointments.debrief_done') : t('appointments.debrief_confirm_complete')}
                  </Text>
                )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  )

  const salePickerModal = showSalePicker ? (
    <CatalogProductPicker onSelect={handleAddSaleProduct} onClose={() => setShowSalePicker(false)} />
  ) : null

  const discussedPickerModal = showDiscussedPicker ? (
    <CatalogProductPicker onSelect={handleAddDiscussedCatalogProduct} onClose={() => setShowDiscussedPicker(false)} />
  ) : null

  // Lot 1.2 §15-16 — révision d'un résultat déjà clôturé, service dédié (ne détourne jamais
  // completeAppointment). Affiche les actions liées réelles (relues en base) avant tout choix.
  const revisionModal = (
    <Modal visible={showRevision} transparent animationType="slide" onRequestClose={() => { if (!revisionSaving) setShowRevision(false) }}>
      <View style={styles.debriefOverlay}>
        <View style={styles.debriefSheet}>
          <View style={styles.debriefHandle} />
          <View style={styles.debriefHeader}>
            <Text style={styles.debriefTitle}>{t('appointments.revision_title')}</Text>
            <TouchableOpacity onPress={() => { if (!revisionSaving) setShowRevision(false) }} disabled={revisionSaving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={18} color={colors.textTertiary} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <Text style={styles.debriefSub}>{t('appointments.revision_sub')}</Text>

          {revisionPlan ? (
            <ScrollView style={{ maxHeight: 420 }}>
              <View style={styles.debriefRecap}>
                <View style={styles.debriefRecapRow}>
                  <Text style={styles.debriefRecapLabel}>{t('appointments.revision_previous')}</Text>
                  <Text style={styles.debriefRecapValue}>{t(`appointment_outcomes.${revisionPlan.previous.outcome}` as any)}</Text>
                </View>
              </View>

              <Text style={styles.commercialSubLabel}>{t('appointments.revision_new_outcome')}</Text>
              {outcomePlanSections}

              {(revisionPlan.linkedFollowups.length || revisionPlan.linkedTasks.length || revisionPlan.linkedFollowupAppointments.length || revisionPlan.linkedRecommendations.length || revisionPlan.linkedOrders.length) ? (
                <>
                  <Text style={styles.commercialSubLabel}>{t('appointments.revision_linked_actions')}</Text>
                  {revisionPlan.linkedFollowups.filter(f => !f.done && !f.cancelled_at).map(f => (
                    <View key={f.id} style={styles.followupPlanRow}>
                      <TouchableOpacity style={styles.taskCheck} onPress={() => toggleRevisionSet(revisionCancelFollowups, setRevisionCancelFollowups, f.id)}>
                        <View style={[styles.taskCheckBox, revisionCancelFollowups.has(f.id) && { backgroundColor: colors.danger, borderColor: colors.danger }]}>
                          {revisionCancelFollowups.has(f.id) && <Check size={12} color="#fff" strokeWidth={3} />}
                        </View>
                      </TouchableOpacity>
                      <Text style={styles.followupPlanLabel} numberOfLines={1}>{f.title} · {f.due_date}</Text>
                      <Text style={styles.debriefRecapLabel}>{revisionCancelFollowups.has(f.id) ? t('appointments.revision_cancel') : t('appointments.revision_keep')}</Text>
                    </View>
                  ))}
                  {revisionPlan.linkedTasks.filter(t2 => t2.status !== 'done' && t2.status !== 'cancelled').map(t2 => (
                    <View key={t2.id} style={styles.followupPlanRow}>
                      <TouchableOpacity style={styles.taskCheck} onPress={() => toggleRevisionSet(revisionCancelTasks, setRevisionCancelTasks, t2.id)}>
                        <View style={[styles.taskCheckBox, revisionCancelTasks.has(t2.id) && { backgroundColor: colors.danger, borderColor: colors.danger }]}>
                          {revisionCancelTasks.has(t2.id) && <Check size={12} color="#fff" strokeWidth={3} />}
                        </View>
                      </TouchableOpacity>
                      <Text style={styles.followupPlanLabel} numberOfLines={1}>{t2.title}</Text>
                      <Text style={styles.debriefRecapLabel}>{revisionCancelTasks.has(t2.id) ? t('appointments.revision_cancel') : t('appointments.revision_keep')}</Text>
                    </View>
                  ))}
                  {revisionPlan.linkedRecommendations.filter(r => r.status === 'advised' && !r.cancelled_at).map(r => (
                    <View key={r.id} style={styles.followupPlanRow}>
                      <TouchableOpacity style={styles.taskCheck} onPress={() => toggleRevisionSet(revisionCancelRecos, setRevisionCancelRecos, r.id)}>
                        <View style={[styles.taskCheckBox, revisionCancelRecos.has(r.id) && { backgroundColor: colors.danger, borderColor: colors.danger }]}>
                          {revisionCancelRecos.has(r.id) && <Check size={12} color="#fff" strokeWidth={3} />}
                        </View>
                      </TouchableOpacity>
                      <Text style={styles.followupPlanLabel} numberOfLines={1}>{r.product_name}</Text>
                      <Text style={styles.debriefRecapLabel}>{revisionCancelRecos.has(r.id) ? t('appointments.revision_cancel') : t('appointments.revision_keep')}</Text>
                    </View>
                  ))}
                  {revisionPlan.linkedFollowupAppointments.length > 0 ? (
                    <Text style={styles.noFollowupHint}>{t('appointments.revision_linked_appointments_hint')}</Text>
                  ) : null}
                  {revisionPlan.linkedOrders.length > 0 ? (
                    <Text style={styles.debriefWarningText}>{t('appointments.revision_orders_warning')}</Text>
                  ) : null}
                </>
              ) : null}

              <Text style={styles.commercialSubLabel}>{t('appointments.revision_reason')}</Text>
              <View style={styles.statusPills}>
                {(['client_changed_mind', 'data_entry_error', 'order_confirmed_after', 'order_cancelled', 'other'] as OutcomeRevisionReason[]).map(reason => (
                  <TouchableOpacity key={reason} onPress={() => setRevisionReason(reason)} style={[styles.statusPill, revisionReason === reason && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]} activeOpacity={0.75}>
                    <Text style={[styles.statusPillText, { color: revisionReason === reason ? colors.primary : colors.textSecondary }]}>{t(`revision_reasons.${reason}` as any)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {revisionReason === 'other' ? (
                <TextInput
                  style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
                  value={revisionReasonOtherText}
                  onChangeText={setRevisionReasonOtherText}
                  placeholder={t('appointments.revision_reason_other_placeholder')}
                  placeholderTextColor={colors.textTertiary}
                />
              ) : null}

              {/* Lot 1.2.1 §7 — choix explicite, jamais déduit des annulations. Désactivé et
                  forcé à false dès qu'une action reste planifiée ou conservée. */}
              <View style={styles.noFollowupRow}>
                <TouchableOpacity
                  style={styles.taskCheck}
                  disabled={hasPlannedOrKeptAction(revisionCancelFollowups, revisionCancelTasks)}
                  onPress={() => setRevisionNoFollowupRequired(v => !v)}
                >
                  <View style={[
                    styles.taskCheckBox,
                    revisionNoFollowupRequired && { backgroundColor: colors.success, borderColor: colors.success },
                    hasPlannedOrKeptAction(revisionCancelFollowups, revisionCancelTasks) && { opacity: 0.4 },
                  ]}>
                    {revisionNoFollowupRequired && <Check size={12} color="#fff" strokeWidth={3} />}
                  </View>
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.followupPlanLabel, hasPlannedOrKeptAction(revisionCancelFollowups, revisionCancelTasks) && { color: colors.textTertiary }]}>
                    {t('appointments.no_followup_required_label')}
                  </Text>
                  {revisionNoFollowupRequired ? (
                    <Text style={styles.noFollowupHint}>{t('appointments.no_followup_required_hint')}</Text>
                  ) : null}
                </View>
              </View>
              {revisionConflict ? (
                <View style={styles.debriefRecap}>
                  <Text style={styles.debriefWarningText}>{t('appointments.error_revision_conflict')}</Text>
                  <TouchableOpacity style={styles.debriefSecondaryBtn} onPress={handleOpenRevision} activeOpacity={0.8}>
                    <Text style={styles.debriefSecondaryBtnText}>{t('appointments.revision_reload')}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}

          {revisionError && !revisionConflict ? <Text style={styles.errorText}>{revisionError}</Text> : null}

          <TouchableOpacity
            style={[styles.debriefDoneBtn, (revisionSaving || !revisionPlan || revisionConflict) && { opacity: 0.6 }]}
            onPress={handleConfirmRevision}
            disabled={revisionSaving || !revisionPlan || revisionConflict}
            activeOpacity={0.85}
          >
            {revisionSaving
              ? <ActivityIndicator color="#ffffff" size="small" />
              : <Text style={styles.debriefDoneBtnText}>{t('appointments.revision_confirm')}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )

  const cancelBanner = showCancelConfirm ? (
    <View style={styles.cancelBanner}>
      <Text style={styles.cancelBannerText}>{t('appointments.cancel_confirm_title')}</Text>
      <View style={styles.cancelBannerBtns}>
        <TouchableOpacity style={styles.cancelBannerNo} onPress={() => setShowCancelConfirm(false)} disabled={cancelling}>
          <Text style={[styles.cancelBannerNoText, { color: colors.text }]}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cancelBannerYes, cancelling && { opacity: 0.6 }]} onPress={handleConfirmCancel} disabled={cancelling}>
          <Text style={styles.cancelBannerYesText}>{t('appointments.cancel_rdv')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : null

  const deleteBanner = showDeleteConfirm ? (
    <View style={styles.cancelBanner}>
      <Text style={styles.cancelBannerText}>{t('appointments.confirm_delete_appt')}</Text>
      <View style={styles.cancelBannerBtns}>
        <TouchableOpacity style={styles.cancelBannerNo} onPress={() => setShowDeleteConfirm(false)} disabled={deletingAppointment}>
          <Text style={[styles.cancelBannerNoText, { color: colors.text }]}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.cancelBannerYes, deletingAppointment && { opacity: 0.6 }]} onPress={handleConfirmDelete} disabled={deletingAppointment}>
          <Text style={styles.cancelBannerYesText}>{t('common.delete')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  ) : null

  // ── Préparation (avant le RDV uniquement — cf. refonte "RDV en trois temps") ──
  const isBeforeRdv = appointment.status === 'scheduled' || appointment.status === 'rescheduled'
  const lastPastActivity = clientHistory.find(h => new Date(h.start_at).getTime() < Date.now())
  const openRecommendations = clientRecommendations.filter(r => r.status === 'advised' && !r.cancelled_at)

  const preparationSection = isBeforeRdv ? (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.section_preparation')}</Text>

      <View style={styles.prepRow}>
        <Text style={styles.prepRowLabel}>{t('appointments.prep_objective')}</Text>
        <Text style={styles.prepRowValue}>{appointment.title}</Text>
      </View>

      <View style={styles.prepRow}>
        <Text style={styles.prepRowLabel}>{t('appointments.prep_last_activity')}</Text>
        {lastPastActivity ? (
          <TouchableOpacity onPress={() => goToHistoryAppointment(lastPastActivity.id)} activeOpacity={0.75}>
            <Text style={[styles.prepRowValue, styles.prepRowLink]} numberOfLines={1}>
              {lastPastActivity.title} · {formatDate(lastPastActivity.start_at, locale, { day: '2-digit', month: 'short', year: 'numeric' })}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.prepRowEmpty}>{t('appointments.prep_last_activity_none')}</Text>
        )}
      </View>

      {openRecommendations.length > 0 && (
        <View style={styles.prepRow}>
          <Text style={styles.prepRowLabel}>{t('appointments.prep_open_recos')}</Text>
          {openRecommendations.slice(0, 3).map(r => (
            <Text key={r.id} style={styles.prepListItem} numberOfLines={1}>•  {r.product_name}</Text>
          ))}
        </View>
      )}

      {clientPendingTasks.length > 0 && (
        <View style={[styles.prepRow, { marginBottom: 0 }]}>
          <Text style={styles.prepRowLabel}>{t('appointments.prep_dont_forget')}</Text>
          {clientPendingTasks.slice(0, 3).map(task => (
            <Text key={task.id} style={styles.prepListItem} numberOfLines={1}>•  {task.title}</Text>
          ))}
        </View>
      )}
    </View>
  ) : null

  // Relancer ce RDV — visible uniquement avant complétion (décision explicite : cette
  // section ne doit plus apparaître une fois le RDV marqué "Complété").
  const nextStepSection = appointment.status !== 'completed' ? (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.next_step_title')}</Text>
      <View style={styles.statusPills}>
        <TouchableOpacity
          style={[styles.statusPill, nextStepMode === 'unknown' && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
          onPress={() => setNextStepMode('unknown')}
          activeOpacity={0.75}
        >
          <Text style={[styles.statusPillText, nextStepMode === 'unknown' && { color: colors.primary, fontFamily: fonts.semibold }]}>
            {t('appointments.next_step_unknown')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.statusPill, nextStepMode === 'known' && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
          onPress={() => setNextStepMode('known')}
          activeOpacity={0.75}
        >
          <Text style={[styles.statusPillText, nextStepMode === 'known' && { color: colors.primary, fontFamily: fonts.semibold }]}>
            {t('appointments.next_step_known')}
          </Text>
        </TouchableOpacity>
      </View>

      {nextStepMode === 'unknown' && (
        relanceCreated ? (
          <Text style={styles.nextStepConfirm}>{t('appointments.next_step_relance_created')}</Text>
        ) : (
          <>
            <Text style={styles.commercialSubLabel}>{t('appointments.next_step_relance_days_label')}</Text>
            <TextInput
              style={styles.bizValueInput}
              value={relanceDays}
              onChangeText={(v: string) => setRelanceDays(v.replace(/\D/g, '').slice(0, 3))}
              keyboardType="number-pad"
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.commercialSubLabel}>{`${t('appointments.next_step_relance_note')} (${t('common.optional')})`}</Text>
            <TextInput
              style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
              value={relanceNote}
              onChangeText={setRelanceNote}
              placeholder={t('appointments.next_step_relance_note_placeholder')}
              placeholderTextColor={colors.textTertiary}
            />
            <TouchableOpacity
              style={[styles.saveBtn, creatingRelance && styles.saveBtnDisabled]}
              onPress={handleCreateRelance}
              disabled={creatingRelance}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>{creatingRelance ? t('appointments.saving') : t('appointments.next_step_create_relance')}</Text>
            </TouchableOpacity>
          </>
        )
      )}

      {nextStepMode === 'known' && (
        nextRdvCreated ? (
          <Text style={styles.nextStepConfirm}>{t('appointments.next_step_rdv_created')}</Text>
        ) : (
          <>
            <Text style={styles.commercialSubLabel}>{t('appointments.propose_next_date')}</Text>
            <TouchableOpacity style={styles.nextStepPickerBtn} onPress={() => setShowNextCal(true)} activeOpacity={0.75}>
              <Text style={styles.nextStepPickerBtnText}>
                {proposeNextDate ? formatDate(proposeNextDate, locale) : t('appointments.propose_next_date_placeholder')}
              </Text>
            </TouchableOpacity>

            <Text style={styles.commercialSubLabel}>{t('appointments.propose_next_time')}</Text>
            <View style={styles.nextStepTimeRow}>
              <TouchableOpacity style={[styles.nextStepPickerBtn, { flex: 1 }]} onPress={() => setShowNextStartTime(true)} activeOpacity={0.75}>
                <Text style={styles.nextStepPickerBtnText}>{proposeNextTime || '--:--'}</Text>
              </TouchableOpacity>
              <Text style={styles.nextStepTimeSep}>→</Text>
              <TouchableOpacity style={[styles.nextStepPickerBtn, { flex: 1 }]} onPress={() => setShowNextEndTime(true)} activeOpacity={0.75}>
                <Text style={styles.nextStepPickerBtnText}>{proposeNextEndTime || '--:--'}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.commercialSubLabel}>{t('appointments.propose_next_purpose')}</Text>
            <TextInput
              style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
              value={proposeNextPurpose}
              onChangeText={setProposeNextPurpose}
              placeholder={t('appointments.propose_next_purpose_placeholder')}
              placeholderTextColor={colors.textTertiary}
            />
            <TouchableOpacity
              style={[styles.saveBtn, creatingNextRdv && styles.saveBtnDisabled]}
              onPress={handleCreateNextRdv}
              disabled={creatingNextRdv}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>{creatingNextRdv ? t('appointments.saving') : t('appointments.next_step_create_rdv')}</Text>
            </TouchableOpacity>
          </>
        )
      )}

      {nextStepError ? <Text style={styles.errorText}>{nextStepError}</Text> : null}

      <CalendarPickerModal
        visible={showNextCal}
        value={proposeNextDate}
        locale={locale}
        dayAppointments={nextRdvDayAppointments}
        onClose={() => setShowNextCal(false)}
        onConfirm={setProposeNextDate}
      />
      <TimePickerModal
        visible={showNextStartTime}
        value={proposeNextTime}
        onClose={() => setShowNextStartTime(false)}
        onConfirm={(time) => {
          setProposeNextTime(time)
          const [h, m] = time.split(':').map(Number)
          setProposeNextEndTime(`${pad2((h + 1) % 24)}:${pad2(m)}`)
        }}
      />
      <TimePickerModal
        visible={showNextEndTime}
        value={proposeNextEndTime}
        onClose={() => setShowNextEndTime(false)}
        onConfirm={setProposeNextEndTime}
      />
    </View>
  ) : null

  // RECAP-PRODUCTS-FIX-1 — sélection par défaut = produits envisagés (considered=true) QUAND il
  // en existe au moins un parmi les produits discutés éligibles (cohérent avec la sémantique
  // établie de `considered`, Lot D : "correspond réellement à une opportunité commerciale") ;
  // sinon repli sur TOUS les produits discutés éligibles. Avant ce lot, l'absence de tout produit
  // considered=true (cas très courant : un produit catalogue démarre à considered=false tant que
  // l'utilisateur ne l'a pas coché explicitement) produisait une présélection vide alors que de
  // vrais produits avaient été discutés — un récap pouvait alors partir sans aucune ligne produit
  // sans que personne ne le remarque (audit CATALOG-CRM-FLOW-1 §8.I). "Éligible" = non déjà
  // couvert par une commande réelle (isOrderMatchedProduct, RÉCAP-6.1 §22/§24, inchangé). Tous les
  // produits discutés restent proposables/décochables ensuite (§5), pas seulement la présélection.
  // `recapSelectedOverride` prime dès que l'utilisateur a coché/décoché manuellement — cette
  // règle ne s'applique qu'à l'état initial non touché.
  // P0 — pas de useMemo ici : ce bloc s'exécute après les `return` conditionnels de
  // loading/!appointment (plus bas dans le fichier), donc tout hook placé ici serait sauté sur
  // certains renders (violation des Rules of Hooks). Le calcul est léger et aucune identité
  // stable n'est requise par un effet/dépendance ailleurs (seulement lu dans un ??  et dans un
  // setState functional update) : une valeur dérivée simple suffit.
  // RÉCAP-6.1 §10/§11/§27 — seules les commandes NON annulées sont éligibles au récap : jamais
  // présenter au client une commande annulée comme "Commande effectuée". Les commandes annulées
  // restent visibles sur la fiche RDV (traçabilité, §11 Option B) mais jamais ici.
  const recapEligibleOrders = appointmentOrders.filter(o => !o.cancelled_at)
  // RÉCAP-6.1 §22/§23 — déduplication Produits abordés / Commande UNIQUEMENT par identifiant
  // stable (product_id de la ligne de commande vs DiscussedProduct.productId, même espace d'id
  // que catalog_products.id) — jamais par comparaison de label (interdiction absolue, §23). Un
  // produit sans productId des deux côtés n'est jamais dédupliqué : mieux vaut une répétition
  // qu'une suppression erronée.
  const recapOrderedProductIds = new Set(
    recapEligibleOrders.flatMap(o => (o.products ?? []).map(p => p.product_id).filter((pid): pid is string => !!pid))
  )
  function isOrderMatchedProduct(p: DiscussedProduct): boolean {
    return p.productId != null && recapOrderedProductIds.has(p.productId)
  }

  const recapEligibleDiscussedIndices = discussedProducts.reduce<number[]>((acc, p, i) => { if (!isOrderMatchedProduct(p)) acc.push(i); return acc }, [])
  const recapHasConsideredEligible = recapEligibleDiscussedIndices.some(i => discussedProducts[i].considered)
  const recapDefaultSelectedKeys = new Set(
    recapHasConsideredEligible
      ? recapEligibleDiscussedIndices.filter(i => discussedProducts[i].considered)
      : recapEligibleDiscussedIndices
  )
  const recapSelectedKeys = recapSelectedOverride ?? recapDefaultSelectedKeys

  function toggleRecapProductSelected(index: number) {
    setRecapSelectedOverride(prev => {
      const base = new Set(prev ?? recapDefaultSelectedKeys)
      if (base.has(index)) base.delete(index); else base.add(index)
      return base
    })
  }

  // RÉCAP-3 §4 — Cas A/C : dès qu'au moins un produit structuré existe, la section "produits" du
  // récap provient exclusivement de la sélection ci-dessus (jamais combinée avec le texte libre
  // legacy, pour ne jamais produire deux sections redondantes sur la même information). Cas B :
  // aucun produit structuré → comportement historique inchangé, le texte libre
  // `productsDiscussed` (notes.products_discussed) reste utilisé tel quel pour les anciens RDV.
  // RÉCAP-6.1 — un produit dont l'identifiant correspond à une ligne de commande est exclu ici
  // même s'il était sélectionné (garde-fou en plus de son exclusion du set par défaut ci-dessus).
  const recapStructuredProductsText = discussedProducts.length > 0
    ? formatDiscussedProductsForRecap(
        discussedProducts
          .filter((p, i) => recapSelectedKeys.has(i) && !isOrderMatchedProduct(p))
          .map(p => ({ label: p.label, quantity: p.quantity, unitPriceEur: p.unitPriceEur })),
        recapShowPrices,
      )
    : ''
  const recapProductsDiscussedText = discussedProducts.length > 0 ? recapStructuredProductsText : productsDiscussed

  // RÉCAP-6.1 §17/§20/§21 — total réutilisé tel quel depuis orders.amount (jamais recalculé) ;
  // header reflète le statut réel au moment de la génération (§12 — un ancien récap déjà partagé
  // reste inchangé grâce à RÉCAP-5, seul un NOUVEAU récap reflète l'état actuel). Sélection par
  // défaut ON dès qu'une vraie commande active existe (§20) — même toggle prix que les produits
  // abordés, aucun second toggle (§21).
  // ORDER-BUSINESS-4.2.1 §5 — order_items réels en priorité (returnedQty exact), repli
  // deriveOrderLines centralisé sinon (returnedQty=0) — même fonction hybride officielle que
  // partout ailleurs (hybridLinesFromItems), jamais reconstruite ici.
  const recapOrderLines = recapEligibleOrders.flatMap(o =>
    hybridLinesFromItems(o, orderItemsByOrderId.get(o.id)).map(p => ({ label: p.name, quantity: p.qty, unitPriceEur: p.price ?? undefined, returnedQty: p.returnedQty }))
  )
  const recapOrderTotal = (recapEligibleOrders.length > 0 && recapEligibleOrders.every(o => o.amount != null))
    ? recapEligibleOrders.reduce((sum, o) => sum + (o.amount ?? 0), 0)
    : null
  const recapOrderHeaderLabel = recapEligibleOrders.some(o => o.status === 'returned')
    ? t('appointments.order_header_returned')
    : t('appointments.order_status_completed')
  const recapIncludeOrderDefault = recapEligibleOrders.length > 0
  const recapIncludeOrder = recapIncludeOrderOverride ?? recapIncludeOrderDefault
  const recapOrderText = recapEligibleOrders.length > 0
    ? formatOrderProductsForRecap(recapOrderLines, recapShowPrices, recapOrderTotal)
    : ''
  const recapOrderForTemplate = (recapIncludeOrder && recapEligibleOrders.length > 0)
    ? { headerLabel: recapOrderHeaderLabel, bodyText: recapOrderText }
    : null

  // RÉCAP-6 §7 — sélection par défaut : ON uniquement quand le prochain RDV est explicitement
  // associé à CE RDV (source==='linked' : créé via "Suite du rendez-vous" ou choisi comme suite
  // au débrief/à la révision) ; un simple RDV futur détecté sans association explicite
  // (source==='fallback') pourrait être trompeur présenté par défaut — OFF, l'utilisateur coche
  // volontairement s'il le juge pertinent. Même idiome que recapSelectedOverride (RÉCAP-3).
  const recapIncludeNextAppointmentDefault = clientFacingNextAppointment?.source === 'linked'
  const recapIncludeNextAppointment = recapIncludeNextAppointmentOverride ?? recapIncludeNextAppointmentDefault
  const recapNextStepValue = recapNextStepText.trim() || null

  // RÉCAP-6 §16 — source unique (clientFacingNextAppointment, voir resolveClientFacingNextAppointment) :
  // l'ancienne condition basée sur nextRdvCreated/proposeNextDate/proposeNextTime/proposeNextPurpose
  // est retirée du récap (elle ne couvrait que le mécanisme A, jamais un RDV existant lié via
  // selectedUpcomingId sans rechargement de page — voir audit §4). `purpose` reprend le titre réel
  // du RDV trouvé, jamais recalculé ni reconstruit ailleurs.
  const recapNextAppointmentForTemplate = (clientFacingNextAppointment && recapIncludeNextAppointment)
    ? {
        dateLabel: `${formatDate(clientFacingNextAppointment.startAt, locale)} à ${formatTime(clientFacingNextAppointment.startAt)}`,
        purpose: clientFacingNextAppointment.purpose,
      }
    : null

  // Récap partageable — décision #7 de la refonte : jamais les notes internes ni
  // les objections, uniquement date/type du RDV + besoins identifiés + produits
  // discutés. Disponible seulement une fois le RDV terminé et un minimum rempli — désormais
  // aussi disponible si des produits structurés existent (RÉCAP-3), une prochaine étape ou un
  // prochain RDV sélectionné existent (RÉCAP-6), même sans texte legacy.
  const recapTemplate = (appointment.status === 'completed' && (
    needsIdentified.trim() || productsDiscussed.trim() || discussedProducts.length > 0
    || !!recapNextStepValue || !!recapNextAppointmentForTemplate || !!recapOrderForTemplate
  ))
    ? buildAppointmentRecapTemplate({
        dateLabel: formatDate(appointment.start_at, locale),
        typeLabel: t(`appointment_types.${appointment.appointment_type}` as any),
        needsIdentified,
        productsDiscussed: recapProductsDiscussedText,
        order: recapOrderForTemplate,
        nextStep: recapNextStepValue,
        nextAppointment: recapNextAppointmentForTemplate,
      })
    : null

  // RÉCAP-3 §6 — section compacte, uniquement quand au moins un produit structuré existe (jamais
  // affichée vide) ; masquée pour les anciens RDV sans produits structurés (Cas B, §4), qui
  // conservent leur texte libre historique sans aucun contrôle de sélection.
  // RÉCAP-6.1 §21 — le toggle "Afficher les prix" est partagé avec la commande (un seul toggle,
  // jamais deux) : il doit donc rester disponible même si tous les produits discutés sont
  // dédupliqués vers la commande (§22), voire si aucun produit n'a été discuté du tout mais
  // qu'une commande existe — d'où un déclenchement élargi à recapEligibleOrders, indépendant de
  // la présence de lignes de produits abordés visibles.
  const recapVisibleDiscussedProducts = discussedProducts.filter(p => !isOrderMatchedProduct(p))
  const recapProductsSelector = (recapVisibleDiscussedProducts.length > 0 || recapEligibleOrders.length > 0) ? (
    <View style={styles.discussedProductsCard}>
      {recapVisibleDiscussedProducts.length > 0 ? (
        <>
          <Text style={styles.commercialSubLabel}>{t('appointments.recap_products_title')}</Text>
          {discussedProducts.map((p, i) => (
            // RÉCAP-6.1 §22/§24 — un produit déjà présent dans la commande (identifiant stable)
            // n'est plus proposé ici : il reste réellement discuté mais sa mention client passe
            // désormais par la section Commande, jamais les deux à la fois. Un produit sans
            // correspondance fiable reste toujours proposé, même considered=false (§24).
            isOrderMatchedProduct(p) ? null : (
              <TouchableOpacity key={i} style={styles.consideredProductRow} onPress={() => toggleRecapProductSelected(i)} activeOpacity={0.75}>
                <View style={[styles.taskCheckBox, recapSelectedKeys.has(i) && { backgroundColor: colors.success, borderColor: colors.success }]}>
                  {recapSelectedKeys.has(i) && <Check size={12} color="#fff" strokeWidth={3} />}
                </View>
                <Text style={styles.consideredProductLabel} numberOfLines={1}>
                  {p.label || t('appointments.outcome_sale_product_placeholder')}{p.quantity > 1 ? ` ×${p.quantity}` : ''}
                </Text>
              </TouchableOpacity>
            )
          ))}
        </>
      ) : null}
      <TouchableOpacity style={styles.consideredProductRow} onPress={() => setRecapShowPrices(v => !v)} activeOpacity={0.75}>
        <View style={[styles.taskCheckBox, recapShowPrices && { backgroundColor: colors.success, borderColor: colors.success }]}>
          {recapShowPrices && <Check size={12} color="#fff" strokeWidth={3} />}
        </View>
        <Text style={styles.consideredProductLabel}>{t('appointments.recap_products_show_prices')}</Text>
      </TouchableOpacity>
    </View>
  ) : null

  // RÉCAP-6.1 §19/§20 — aperçu strictement lecture seule (§19 : "aucune modification de la
  // commande depuis le récap") — les lignes affichées ici sont les mêmes que celles utilisées
  // pour générer le texte (recapOrderLines), jamais une reconstruction séparée. Le header reflète
  // le statut réel (effectuée/retournée). Absente si aucune commande éligible (§10).
  const recapOrderSelector = recapEligibleOrders.length > 0 ? (
    <View style={styles.discussedProductsCard}>
      <Text style={styles.commercialSubLabel}>{t('appointments.recap_order_section_title')}</Text>
      <TouchableOpacity
        style={styles.consideredProductRow}
        onPress={() => setRecapIncludeOrderOverride(!recapIncludeOrder)}
        activeOpacity={0.75}
      >
        <View style={[styles.taskCheckBox, recapIncludeOrder && { backgroundColor: colors.success, borderColor: colors.success }]}>
          {recapIncludeOrder && <Check size={12} color="#fff" strokeWidth={3} />}
        </View>
        <Text style={styles.consideredProductLabel}>{t('appointments.recap_include_order')}</Text>
      </TouchableOpacity>
      <Text style={styles.consideredProductDetail}>{recapOrderHeaderLabel}</Text>
      {recapOrderLines.map((line, i) => (
        <Text key={i} style={styles.consideredProductDetail}>
          • {line.label}{line.quantity > 1 ? ` ×${line.quantity}` : ''}
        </Text>
      ))}
    </View>
  ) : null

  // RÉCAP-6 §9-13 — champ toujours disponible indépendamment d'un prochain RDV (§13), jamais
  // préremplie depuis une tâche/relance (§10/§11 — INTERDICTION ABSOLUE, ce composant ne lit
  // même pas appointment.tasks ni followups). Purement temporaire (§12), jamais persisté hors du
  // message final (voir message_snapshot si un partage est initié).
  // UX — libellé/texte pédagogique/taille uniquement (aucune logique touchée) : reste
  // recapNextStepText, mêmes reset/dirty/génération de message qu'avant. Réutilise le
  // TextArea partagé (largeur 100%, minHeight confortable) plutôt qu'un style isolé.
  const recapNextStepSelector = (
    <View style={styles.discussedProductsCard}>
      <Text style={styles.commercialSubLabel}>{t('appointments.recap_next_step_label')}</Text>
      <Text style={styles.consideredProductDetail}>{t('appointments.recap_next_step_hint')}</Text>
      <TextArea
        value={recapNextStepText}
        onChangeText={setRecapNextStepText}
        placeholder={t('appointments.recap_next_step_placeholder')}
        minHeight={80}
        style={{ marginTop: 8 }}
      />
    </View>
  )

  // RÉCAP-6 §6/§13 — absente si aucun vrai prochain RDV n'existe (jamais de ligne vide type
  // "Prochain rendez-vous : aucun"). Aucune information interne affichée (pipeline/statut/id) —
  // uniquement date/heure, réutilisant les helpers de date déjà existants.
  const recapNextAppointmentSelector = clientFacingNextAppointment ? (
    <View style={styles.discussedProductsCard}>
      <Text style={styles.commercialSubLabel}>{t('appointments.recap_next_appointment_section_title')}</Text>
      <TouchableOpacity
        style={styles.consideredProductRow}
        onPress={() => setRecapIncludeNextAppointmentOverride(!recapIncludeNextAppointment)}
        activeOpacity={0.75}
      >
        <View style={[styles.taskCheckBox, recapIncludeNextAppointment && { backgroundColor: colors.success, borderColor: colors.success }]}>
          {recapIncludeNextAppointment && <Check size={12} color="#fff" strokeWidth={3} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.consideredProductLabel}>{t('appointments.recap_include_next_appointment')}</Text>
          <Text style={styles.consideredProductDetail}>
            {formatDate(clientFacingNextAppointment.startAt, locale)} · {formatTime(clientFacingNextAppointment.startAt)}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  ) : null

  // RÉCAP-6 §15 — ordre : produits → prochaine étape → prochain RDV (avant le message), cohérent
  // avec l'ordre des sections dans le texte généré (buildAppointmentRecapTemplate). Un seul nœud
  // passé à MessageModal (beforeMessageContent), qui reste générique (§21 — aucune connaissance
  // d'Appointment/tasks/followups/prochain RDV).
  const recapBeforeMessageContent = (
    <>
      {recapProductsSelector}
      {recapOrderSelector}
      {recapNextStepSelector}
      {recapNextAppointmentSelector}
    </>
  )

  const notesSection = (
    <>
      {/* RDV-2 §5 — indicateur discret (jamais de toast), un seul texte statique à côté du
          titre. Reflète notesSaveState, alimenté uniquement par handleSaveNotes/noteChanger. */}
      <View style={styles.notesSectionTitleRow}>
        <Text style={styles.notesSectionTitle}>{t('appointments.section_report')}</Text>
        {notesSaveState !== 'idle' ? (
          <Text style={[
            styles.notesSaveStateText,
            notesSaveState === 'saved' && { color: colors.success },
            notesSaveState === 'error' && { color: colors.danger },
          ]}>
            {notesSaveState === 'dirty'  ? t('appointments.notes_save_dirty')
              : notesSaveState === 'saving' ? t('appointments.saving')
              : notesSaveState === 'saved'  ? t('appointments.notes_save_saved')
              : t('appointments.notes_save_error')}
          </Text>
        ) : null}
      </View>
      <View style={isWeb ? styles.notesRow : styles.notesStack}>
        <NoteCard title={t('appointments.field_client_notes')}   value={clientNotes}      onChange={noteChanger(setClientNotes)}      colors={colors} styles={styles} />
        <NoteCard title={t('appointments.field_needs')}          value={needsIdentified}  onChange={noteChanger(setNeedsIdentified)}  colors={colors} styles={styles} />
      </View>
      <View style={isWeb ? styles.notesRow : styles.notesStack}>
        <NoteCard title={t('appointments.field_internal_notes')} value={internalNotes}    onChange={noteChanger(setInternalNotes)}    colors={colors} styles={styles} internal />
        <NoteCard title={t('appointments.field_objections')}     value={objections}       onChange={noteChanger(setObjections)}       colors={colors} styles={styles} internal />
      </View>
      {/* RDV-PRODUCTS-1 / Lot C — remplace l'ancien champ libre par une liste structurée
          (catalogue + produit libre + quantité + prix snapshot). Pas encore de sélection
          "envisagé" ni de calcul de valeur estimée ici — voir Lot D. */}
      <View style={styles.discussedProductsCard}>
        <View style={styles.noteCardTitleRow}>
          <Text style={styles.noteCardTitle}>{t('appointments.field_products')}</Text>
        </View>
        {discussedProducts.length === 0 ? (
          <Text style={styles.discussedProductsEmpty}>{t('appointments.discussed_products_empty')}</Text>
        ) : (
          <>
            {/* P4 §2 — en-têtes de colonnes : le sens de "2"/"12" n'était pas évident sans elles
                (Produit/Qté/Prix unitaire). Même schéma flex/largeurs que la ligne ci-dessous
                pour un alignement exact, desktop ET mobile (§2 : "ne crée pas un tableau
                complexe" — un simple en-tête au-dessus de la liste existante suffit). */}
            <View style={styles.productColumnHeaderRow}>
              <Text style={[styles.productColumnHeaderText, { flex: 1 }]}>{t('appointments.column_product')}</Text>
              <Text style={[styles.productColumnHeaderText, { width: 48, textAlign: 'center' }]}>{t('appointments.column_quantity')}</Text>
              <Text style={[styles.productColumnHeaderText, { width: 88, textAlign: 'center' }]}>{t('appointments.column_unit_price')}</Text>
              <View style={{ width: 16 }} />
            </View>
            {discussedProducts.map((p, i) => (
              <View key={i} style={styles.saleProductRow}>
                <TextInput
                  style={[styles.bizValueInput, { flex: 1, maxWidth: undefined }]}
                  value={p.label}
                  onChangeText={(v) => updateDiscussedProduct(i, { label: v })}
                  placeholder={t('appointments.outcome_sale_product_placeholder')}
                  placeholderTextColor={colors.textTertiary}
                />
                <TextInput
                  style={[styles.bizValueInput, { width: 48, textAlign: 'center' }]}
                  value={p.quantity > 0 ? String(p.quantity) : ''}
                  onChangeText={(v) => updateDiscussedProduct(i, { quantity: parseInt(v.replace(/\D/g, ''), 10) || 0 })}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={[styles.bizValueInput, { width: 88, textAlign: 'center' }]}
                  value={p.unitPriceEur != null ? String(p.unitPriceEur) : ''}
                  onChangeText={(v) => {
                    const n = parseFloat(v.replace(',', '.'))
                    updateDiscussedProduct(i, { unitPriceEur: v.trim() === '' ? undefined : (Number.isFinite(n) && n >= 0 ? n : p.unitPriceEur) })
                  }}
                  placeholder={t('catalog.price_not_set')}
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="decimal-pad"
                />
                <TouchableOpacity onPress={() => removeDiscussedProduct(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <X size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
        <View style={styles.debriefNoClientRow}>
          <TouchableOpacity style={styles.discussedProductsAddBtn} onPress={() => setShowDiscussedPicker(true)} activeOpacity={0.8}>
            <Text style={styles.discussedProductsAddBtnText}>{t('appointments.discussed_products_add_catalog')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.discussedProductsAddBtn} onPress={handleAddFreeDiscussedProduct} activeOpacity={0.8}>
            <Text style={styles.discussedProductsAddBtnText}>{t('appointments.discussed_products_add_free')}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <NoteCard title={t('appointments.field_products_notes')} value={productsDiscussed} onChange={noteChanger(setProductsDiscussed)} colors={colors} styles={styles} />
      {notesDirty ? (
        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSaveNotes}
          disabled={saving}
          activeOpacity={0.8}
        >
          <Text style={styles.saveBtnText}>
            {saving ? t('appointments.saving') : t('appointments.save_notes')}
          </Text>
        </TouchableOpacity>
      ) : null}
      {appointment.status === 'completed' && !recapTemplate && (
        <Text style={styles.recapHint}>{t('appointments.share_recap_hint')}</Text>
      )}
      {/* RÉCAP-5D §7 — information discrète, jamais "envoyé"/"livré" : uniquement le dernier
          partage réellement initié pour ce RDV. Rien n'est affiché en l'absence de partage
          (§7 — pas de "jamais partagé"). Même style que le hint ci-dessus (recapHint), pour
          rester visuellement secondaire, aucune nouvelle carte. */}
      {latestRecapShare ? (
        <Text style={styles.recapHint}>
          {t('appointments.last_recap_share', {
            channel: t(`clients.recap_share_channel_${latestRecapShare.channel}`),
            date: formatDate(latestRecapShare.created_at, locale),
            time: formatTime(latestRecapShare.created_at),
          })}
        </Text>
      ) : null}
    </>
  )

  // RÉCAP-5C — signifie uniquement "l'utilisateur a initié depuis Oryalis un partage via ce
  // canal" (partage initié), jamais "envoyé"/"livré"/"reçu" (voir RÉCAP-5A §1, migration
  // 20260824_appointment_recap_shares.sql). Fire-and-forget explicite (`void ... .catch(...)`,
  // §11) : ne doit jamais retarder ni empêcher l'ouverture de WhatsApp/SMS/E-mail côté
  // MessageModal, qui appelle ce callback de façon strictement synchrone avant d'ouvrir le
  // canal externe. `appointment.user_id`/`client_id` sont déjà chargés avec le RDV — aucune
  // requête Supabase supplémentaire pour retrouver l'utilisateur (§7).
  function handleExternalShareInitiated(payload: ExternalShareInitiatedPayload) {
    if (!appointment || !appointment.client_id) return
    const appointmentId = appointment.id
    // RÉCAP-5D §12/§13 — "Dernier partage" n'est mis à jour QUE si l'écriture a réellement
    // réussi (chaîné après logRecapShare, jamais en optimiste) : si Supabase échoue, l'UI ne
    // doit jamais affirmer un partage qui n'existe pas en base. Ce refetch reste indépendant de
    // l'ouverture du canal externe (déjà lancée par MessageModal avant l'appel de ce callback),
    // jamais un `await` qui la retarderait.
    void logRecapShare(appointment.user_id, {
      clientId: appointment.client_id,
      appointmentId,
      channel: payload.channel,
      messageSnapshot: payload.message,
      subjectSnapshot: payload.subject ?? null,
    })
      .then(() => getLatestRecapShareForAppointment(appointmentId))
      .then(setLatestRecapShare)
      .catch(e => console.error('[logRecapShare]', e))
  }

  const recapModal = (
    <MessageModal
      visible={showRecap}
      onClose={() => {
        setShowRecap(false)
        // RÉCAP-3 §19 — aucun résidu du composeur précédent à la prochaine ouverture.
        setRecapSelectedOverride(null)
        setRecapShowPrices(false)
        // RÉCAP-6 §19 — même principe pour la prochaine étape/le prochain RDV du composeur.
        setRecapIncludeNextAppointmentOverride(null)
        setRecapNextStepText('')
        // RÉCAP-6.1 §29 — même principe pour l'inclusion de la commande.
        setRecapIncludeOrderOverride(null)
      }}
      client={clientInfo}
      advisorName={practitionerName}
      initialTemplate={recapTemplate}
      // RÉCAP-2 — seul ce point d'entrée active l'édition et le titre dédié ; les autres
      // usages de MessageModal (message générique, résumé de profil, réseau) sont inchangés.
      editable
      title={t('messages.title_prepare')}
      beforeMessageContent={recapBeforeMessageContent}
      // RÉCAP-4 §6 — locale/date déjà résolues ici (formatDate + locale du composant), jamais
      // recalculées côté MessageModal qui ignore tout du RDV.
      emailSubject={t('appointments.recap_email_subject', { date: formatDate(appointment.start_at, locale) })}
      // RÉCAP-4.1 — seul ce point d'entrée active le canal E-mail (opt-in explicite) ; les 3
      // autres usages de MessageModal ne passent pas cette prop et n'affichent jamais E-mail.
      enableEmail
      // RÉCAP-5C — idem : seul ce point d'entrée journalise un partage. Les 3 autres usages de
      // MessageModal ne passent pas ce callback, donc n'écrivent jamais dans
      // appointment_recap_shares, même si l'utilisateur y clique sur WhatsApp/SMS.
      onExternalShareInitiated={handleExternalShareInitiated}
    />
  )

  // RÉCAP-6.1 §8-13 — traçabilité RDV → commande : source unique appointmentOrders (chargée via
  // getOrdersForAppointment, jamais déduite du résultat/considered/valeur estimée). Toutes les
  // commandes liées sont affichées, y compris annulées (§11 Option B, cohérent avec le badge
  // "Annulée" déjà utilisé dans orders/index.tsx) — jamais un ✓ "Commande effectuée" pour une
  // commande annulée. §18 — pas de lien "Voir la commande" : le module Commandes n'a qu'un écran
  // liste + modale d'édition, aucune page détail par commande à cibler ; construire une
  // navigation dédiée uniquement pour ce lien aurait été hors périmètre (voir rapport).
  const orderSection = appointmentOrders.length > 0 ? (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.order_section_title')}</Text>
      {appointmentOrders.map(order => {
        const isCancelled = !!order.cancelled_at
        const isReturned = order.status === 'returned'
        // ORDER-BUSINESS-4.2.2 §2/§3/§12 — RÉUTILISE la lecture groupée déjà chargée pour le récap
        // partagé (orderItemsByOrderId, ORDER-BUSINESS-4.2.1 §5/§6) : aucune seconde requête,
        // aucun N+1. `hybridLinesFromItems` retombe sur deriveOrderLines (returnedQty=0) si cette
        // commande n'a pas encore d'order_items structurés — comportement inchangé dans ce cas.
        const orderItems = orderItemsByOrderId.get(order.id)
        const lines = hybridLinesFromItems(order, orderItems).map(p => ({ label: p.name, quantity: p.qty, returnedQty: p.returnedQty ?? 0 }))
        // §7/§8 — le statut historique (annulée/retournée) reste TOUJOURS prioritaire, jamais
        // recalculé depuis les lignes ; le statut dérivé (partiel/complet à confirmer) n'est
        // évalué QUE si la commande n'est ni annulée ni déjà marquée retournée — aucun second
        // badge, un seul état affiché à la fois (§6 : ne duplique pas une indication suffisante).
        const returnStatus = (isCancelled || isReturned) ? 'none' : getOrderReturnStatus(orderItems)
        const badgeColor = isCancelled ? colors.textTertiary : (isReturned || returnStatus !== 'none') ? colors.danger : colors.success
        const badgeLabel = isCancelled
          ? t('orders.status_cancelled')
          : isReturned
            ? t('orders.status_returned')
            : returnStatus === 'partial'
              ? t('orders.status_partial_return')
              : returnStatus === 'full_pending'
                ? t('orders.status_full_return_pending')
                : t('appointments.order_status_completed')
        // §9 — MONEY : cette carte reflète l'état ACTUEL de la commande (pas un texte figé/
        // historique comme le récap partagé, resté volontairement brut en 4.2.1) : le total
        // affiché devient donc le montant NET des retours quand des order_items structurés
        // existent (computeOrderNetAmount, réutilisée telle quelle depuis ORDER-BUSINESS-4.2,
        // aucune formule recréée) — repli sur order.amount brut si aucun order_items structuré
        // (comportement legacy inchangé, aucun retour n'existe à ce niveau de détail).
        const displayAmount = computeOrderNetAmount(order, orderItems)
        return (
          <View key={order.id} style={styles.orderCardRow}>
            <View style={[styles.outcomeBadge, { backgroundColor: badgeColor + '22', borderColor: badgeColor, marginBottom: 6 }]}>
              <Text style={[styles.outcomeBadgeText, { color: badgeColor }]}>
                {!isCancelled && !isReturned && returnStatus === 'none' ? `✓ ${badgeLabel}` : badgeLabel}
              </Text>
            </View>
            {/* §4/§5 — une ligne sans retour garde l'affichage compact existant (• nom ×qty) ;
                une ligne avec retour (partiel OU total) affiche le résumé "commandé/retourné/
                conservé" déjà utilisé dans OrderEditModal (même clé i18n, aucun second wording
                créé) — "0 conservé" apparaît naturellement pour un retour total (§5), sans
                supprimer la ligne. */}
            {lines.map((line, i) => (
              <View key={i}>
                <Text style={[styles.consideredProductDetail, isCancelled && styles.taskTitleDone]}>
                  • {line.label}{line.returnedQty === 0 && line.quantity > 1 ? ` ×${line.quantity}` : ''}
                </Text>
                {line.returnedQty > 0 ? (
                  <Text style={styles.orderReturnLineText}>
                    {t('orders.return_summary', { qty: line.quantity, returned: line.returnedQty, net: getNetQuantity(line.quantity, line.returnedQty) })}
                  </Text>
                ) : null}
              </View>
            ))}
            {order.amount != null ? (
              <Text style={styles.orderTotalText}>{t('appointments.order_total_label')} : {formatMoney(displayAmount, locale)}</Text>
            ) : null}
            {/* RÉCAP-6.1.1 §8/§9 — uniquement order.id (jamais client/date/montant) ; le module
                Commandes n'a pas de page détail dédiée, seule une modale d'édition sur l'écran
                liste (§8 de la P0) : /orders?orderId=<id> consomme ce paramètre pour l'ouvrir
                automatiquement, indépendamment du filtre mois de cet écran. */}
            <View style={{ alignItems: 'flex-start', marginTop: 4 }}>
              <OpenActionLink
                label={t('appointments.order_view_link')}
                onPress={() => router.push(`/(app)/orders?orderId=${order.id}` as any)}
                accessibilityLabel={`${t('appointments.order_view_link')} — ${order.product_name}`}
              />
            </View>
          </View>
        )
      })}
    </View>
  ) : null

  const tasksSection = (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.section_tasks')}</Text>
      {/* CONTACT-RDV-TASKS/P3.1 — micro-UX uniquement : l'explication pédagogique + les exemples
          ne s'affichent que sur l'état vide (§8 du brief, jamais répétés une fois des tâches
          présentes) — combinés en une seule phrase secondaire compacte plutôt que plusieurs
          lignes, pour rester sous 2-3 lignes même sur mobile (§11). */}
      {appointment.tasks.length === 0 ? (
        <View style={styles.emptyTaskBlock}>
          <Text style={styles.emptyTaskText}>{t('appointments.no_tasks_appt')}</Text>
          <Text style={styles.emptyTaskHint}>{t('appointments.no_tasks_appt_hint')}</Text>
        </View>
      ) : (
        appointment.tasks.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            colors={colors}
            styles={styles}
            locale={locale}
            saving={savingTaskIds.has(task.id)}
            onToggle={() => handleToggleTask(task.id, task.status !== 'done')}
            onRemove={() => handleRemoveTask(task.id)}
          />
        ))
      )}
      <View style={styles.addTaskRow}>
        <TextInput
          style={styles.addTaskInput}
          value={newTaskTitle}
          onChangeText={(v) => { setNewTaskTitle(v); if (taskError) setTaskError(null) }}
          placeholder={t('appointments.add_task_placeholder')}
          placeholderTextColor={colors.textTertiary}
          onSubmitEditing={handleAddTask}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.addTaskBtn, (addingTask || !newTaskTitle.trim()) && { opacity: 0.5 }]}
          onPress={handleAddTask}
          disabled={addingTask}
          activeOpacity={0.8}
        >
          {addingTask
            ? <ActivityIndicator size="small" color="#ffffff" />
            : <Text style={styles.addTaskBtnText}>+</Text>
          }
        </TouchableOpacity>
      </View>
      {taskError ? <Text style={styles.taskErrorText}>{taskError}</Text> : null}
    </View>
  )

  // RDV-1 §12 — CTA final du parcours (Préparer → Compte-rendu → Conclusion → Suite → Actions
  // à faire → Terminer). Appelle exactement handleStatusChange('completed'), le même handler
  // que la pill "Complété" déclenchait auparavant — aucune seconde implémentation de la
  // clôture. §13 : masqué une fois le RDV completed/cancelled/no_show (mêmes conditions que le
  // moteur refuse déjà — voir handleStatusChange).
  const finishSection = isBeforeRdv ? (
    <TouchableOpacity
      style={[styles.finishBtn, isCompleting && styles.saveBtnDisabled]}
      onPress={() => handleStatusChange('completed')}
      disabled={isCompleting}
      activeOpacity={0.85}
    >
      {isCompleting ? (
        <ActivityIndicator size="small" color="#ffffff" />
      ) : (
        <>
          <Check size={17} color="#ffffff" strokeWidth={2.5} />
          <Text style={styles.finishBtnText}>{t('appointments.finish_appointment_action')}</Text>
        </>
      )}
    </TouchableOpacity>
  ) : null

  const errorBanner = (
    <>
      {inlineError && !showDebrief ? <Text style={styles.errorText}>{inlineError}</Text> : null}
      {postWarnings.length > 0 ? (
        <View style={styles.warningBanner}>
          <Text style={styles.warningBannerText}>{t('appointments.warning_post_completion_partial')}</Text>
          <TouchableOpacity onPress={handleRetryPostCompletion} disabled={retrying} activeOpacity={0.75}>
            {retrying
              ? <ActivityIndicator size="small" color={colors.warning} />
              : <Text style={styles.warningBannerRetry}>{t('appointments.warning_post_completion_retry')}</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
      {planActionWarnings ? (
        <View style={styles.warningBanner}>
          {/* LRP-4.1 §9 — message précis si SEUL le rattachement au programme a échoué (la
              commande, elle, est bien enregistrée) ; message générique sinon. */}
          <Text style={styles.warningBannerText}>
            {planActionWarnings.recurringProgram && !planActionWarnings.order && !planActionWarnings.recommendation && !planActionWarnings.personalFollowup && !planActionWarnings.appointmentLink
              ? t('lrp.link_failed_warning')
              : t('appointments.warning_plan_actions_partial')}
          </Text>
          <TouchableOpacity onPress={handleRetryPlanActions} disabled={retryingPlanActions} activeOpacity={0.75}>
            {retryingPlanActions
              ? <ActivityIndicator size="small" color={colors.warning} />
              : <Text style={styles.warningBannerRetry}>{t('appointments.warning_post_completion_retry')}</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </>
  )

  const headerRight = () => (
    <View style={styles.headerBtns}>
      {recapTemplate ? (
        <TouchableOpacity
          style={styles.headerBtnSuccess}
          onPress={() => setShowRecap(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.headerBtnSuccessText}>{t('appointments.share_recap_header')}</Text>
        </TouchableOpacity>
      ) : null}
      {!isCancelled ? (
        <TouchableOpacity
          style={styles.headerBtnDanger}
          onPress={() => setShowCancelConfirm(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.headerBtnDangerText}>{t('appointments.cancel_rdv')}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity
        style={styles.headerBtnDanger}
        onPress={() => setShowDeleteConfirm(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.headerBtnDangerText}>{t('common.delete')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.headerBtnPrimary}
        onPress={() => router.push(`/(app)/appointments/new?id=${id}` as any)}
        activeOpacity={0.8}
      >
        <Text style={styles.headerBtnPrimaryText}>{t('common.edit')}</Text>
      </TouchableOpacity>
    </View>
  )

  // ── Web sidebar ────────────────────────────────────────────────────────────────

  const sidebar = (
    <View style={styles.webSidebar}>
      {/* RDV-1 §5 — statut en lecture seule (web desktop uniquement, colonne latérale).
          Les actions restent exclusivement dans la rangée de pills de la colonne principale
          (statusSection) : ce badge n'ajoute qu'une information, jamais un second contrôle. */}
      <View style={styles.sideSection}>
        <Text style={styles.sideSectionTitle}>{t('appointments.status_label')}</Text>
        <View style={styles.sideStatusRow}>
          <View style={[styles.sideStatusDot, { backgroundColor: STATUS_COLOR[appointment.status] }]} />
          <Text style={[styles.sideStatusText, { color: STATUS_COLOR[appointment.status] }]}>
            {t(`appointment_statuses.${appointment.status}` as any)}
          </Text>
        </View>
      </View>

      {clientInfo ? (
        <View style={styles.sideSection}>
          <Text style={styles.sideSectionTitle}>{t('appointments.client_section')}</Text>
          <TouchableOpacity
            style={styles.sideClientCard}
            onPress={() => router.push(`/(app)/clients/${clientInfo.id}` as any)}
            activeOpacity={0.8}
          >
            <View style={[styles.sideAvatar, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.sideAvatarText, { color: colors.primary }]}>
                {getInitials(clientInfo.full_name)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sideClientName}>{clientInfo.full_name}</Text>
              {clientInfo.contact_role.length > 0 && (
                <View style={styles.sideRoleRow}>
                  {clientInfo.contact_role.map(role => {
                    const rc = getRoleColors(role, colors)
                    return (
                      <View key={role} style={[styles.sideRolePill, { backgroundColor: rc.bg }]}>
                        <Text style={[styles.sideRolePillText, { color: rc.text }]}>{getRoleLabel(role)}</Text>
                      </View>
                    )
                  })}
                </View>
              )}
              <Text style={styles.sideClientSub}>{t('appointments.view_client_file')} →</Text>
            </View>
          </TouchableOpacity>
        </View>
      ) : !appointment.client_id ? (
        <View style={styles.sideSection}>
          <Text style={styles.sideSectionTitle}>{t('appointments.client_section')}</Text>
          <Text style={styles.prepRowEmpty}>{t('appointments.no_client_linked')}</Text>
        </View>
      ) : null}

      {/* RDV-HISTORY-NAV-1 §12 — bloc "RDV actuel" : uniquement en mode consultation ET une fois
          l'origine confirmée (même contact, toujours accessible, §22). Jamais affiché sur une
          navigation normale (§12 : "ne rajoute pas de bloc inutile"). Cliquable, même
          destination que "Revenir au RDV actuel" (§18) — pas de second chemin de navigation. */}
      {isConsultingHistory && originItem ? (
        <View style={styles.sideSection}>
          <Text style={styles.sideSectionTitle}>{t('appointments.current_appointment')}</Text>
          <TouchableOpacity
            style={[styles.sideHistoryItem, styles.sideHistoryItemOrigin]}
            onPress={handleReturnToOrigin}
            activeOpacity={0.8}
          >
            <Text style={styles.sideHistoryTitle} numberOfLines={1}>{originItem.title}</Text>
            <Text style={styles.sideHistoryDate}>
              {formatDate(originItem.start_at, locale, { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}{t(`appointment_statuses.${originItem.status}` as any)}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {clientHistory.length > 0 ? (
        <View style={styles.sideSection}>
          <Text style={styles.sideSectionTitle}>{t('appointments.historique_rdv')}</Text>
          <View style={styles.sideHistory}>
            {clientHistory.map(h => {
              // RDV-HISTORY-NAV-1 §11/§34 — le RDV COURAMMENT AFFICHÉ reste dans cette liste
              // (§10, corrigé ci-dessus) et y est simplement mis en évidence, jamais retiré.
              const isCurrentlyViewed = h.id === id
              return (
                <TouchableOpacity
                  key={h.id}
                  style={[styles.sideHistoryItem, isCurrentlyViewed && styles.sideHistoryItemActive]}
                  onPress={() => goToHistoryAppointment(h.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.sideHistoryTitle, isCurrentlyViewed && styles.sideHistoryTitleActive]} numberOfLines={1}>
                    {isCurrentlyViewed ? '▸ ' : ''}{h.title}
                  </Text>
                  <Text style={styles.sideHistoryDate}>
                    {formatDate(h.start_at, locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                    {' · '}{t(`appointment_statuses.${h.status}` as any)}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>
      ) : null}

      {tasksOverdue.length > 0 ? (
        <View style={styles.sideOverdue}>
          <TriangleAlert size={14} color={colors.danger} strokeWidth={2} />
          <Text style={styles.sideOverdueText}>{tasksOverdue.length} {t('appointments.tasks_overdue')}</Text>
        </View>
      ) : null}
    </View>
  )

  // ── Web layout ─────────────────────────────────────────────────────────────────
  if (isWeb) {
    return (
      <>
        <Stack.Screen options={{
          title: t('appointments.detail_title'),
          headerLeft: () => (
            // RDV-HISTORY-NAV-1 §8 — en mode consultation, ce bouton ne se comporte plus comme un
            // simple Retour (qui empilerait B→C→D à rebours) : il ramène DIRECTEMENT au RDV de
            // travail (handleReturnToOrigin, un seul replace). Hors consultation, comportement
            // 100% inchangé (goBack/backLabel existants).
            <TouchableOpacity onPress={isConsultingHistory ? handleReturnToOrigin : goBack} style={styles.headerBackBtn}>
              <Text style={styles.headerBackText}>‹ {isConsultingHistory ? t('appointments.return_to_current') : backLabel}</Text>
            </TouchableOpacity>
          ),
          headerRight,
        }} />
        <View style={styles.webLayout}>
          <ScrollView style={styles.webMain} contentContainerStyle={styles.scrollContent}>
            {heroSection}
            {cancelBanner}
            {deleteBanner}
            {errorBanner}
            {statusSection}
            {preparationSection}
            {notesSection}
            {commercialSection}
            {orderSection}
            {nextStepSection}
            {tasksSection}
            {finishSection}
          </ScrollView>
          {sidebar}
        </View>
        {debriefModal}
        {salePickerModal}
        {discussedPickerModal}
        {revisionModal}
        {recapModal}
      </>
    )
  }

  // ── Mobile layout ──────────────────────────────────────────────────────────────
  return (
    <>
      <Stack.Screen options={{
        title: t('appointments.detail_title'),
        headerBackTitle: '',
        headerLeft: () => (
          // RDV-HISTORY-NAV-1 §8/§25 — même bascule que desktop, mêmes deux mots courts pour ne
          // pas déborder l'en-tête natif (mode normal : flèche seule, comportement pixel-perfect
          // inchangé — le libellé n'apparaît que lorsqu'il y a réellement une action différente à
          // annoncer).
          <TouchableOpacity
            onPress={isConsultingHistory ? handleReturnToOrigin : goBack}
            style={styles.headerBackBtnMobile}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {isConsultingHistory ? (
              <Text style={styles.headerBackTextMobile} numberOfLines={1}>‹ {t('appointments.return_to_current')}</Text>
            ) : (
              <Text style={styles.headerBackArrowMobile}>‹</Text>
            )}
          </TouchableOpacity>
        ),
        headerRight,
      }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
        {heroSection}
        {cancelBanner}
        {deleteBanner}
        {errorBanner}
        {statusSection}
        {preparationSection}
        {clientInfo ? (
          <TouchableOpacity
            style={styles.mobileClientCard}
            onPress={() => router.push(`/(app)/clients/${clientInfo.id}` as any)}
            activeOpacity={0.8}
          >
            <View style={[styles.sideAvatar, { backgroundColor: colors.primaryLight }]}>
              <Text style={[styles.sideAvatarText, { color: colors.primary }]}>
                {getInitials(clientInfo.full_name)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sideClientName}>{clientInfo.full_name}</Text>
              {clientInfo.contact_role.length > 0 && (
                <View style={styles.sideRoleRow}>
                  {clientInfo.contact_role.map(role => {
                    const rc = getRoleColors(role, colors)
                    return (
                      <View key={role} style={[styles.sideRolePill, { backgroundColor: rc.bg }]}>
                        <Text style={[styles.sideRolePillText, { color: rc.text }]}>{getRoleLabel(role)}</Text>
                      </View>
                    )
                  })}
                </View>
              )}
              <Text style={styles.sideClientSub}>{t('appointments.view_client_file')} →</Text>
            </View>
          </TouchableOpacity>
        ) : !appointment.client_id ? (
          <View style={styles.mobileClientCard}>
            <Text style={styles.prepRowEmpty}>{t('appointments.no_client_linked')}</Text>
          </View>
        ) : null}
        {notesSection}
        {commercialSection}
        {orderSection}
        {nextStepSection}
        {tasksSection}
        {finishSection}
      </ScrollView>
      {debriefModal}
      {salePickerModal}
      {discussedPickerModal}
      {revisionModal}
      {recapModal}
    </>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container:     { flex: 1, backgroundColor: colors.bgDim },
    center:        { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgDim },
    scrollContent: { padding: 16, gap: 14, paddingBottom: 40 },
    emptyText:     { fontSize: 15, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },

    // Hero
    heroCard:    { backgroundColor: colors.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, overflow: 'hidden' },
    heroRow:     { flexDirection: 'row' },
    heroAccent:  { width: 4 },
    heroBody:    { flex: 1, padding: 16, gap: 8 },
    heroTitle:   { fontSize: 20, fontFamily: fonts.semibold, color: colors.text, lineHeight: 26 },
    heroSub:     { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },

    pillsRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    pill:        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
    pillText:    { fontSize: 11, fontFamily: fonts.semibold },

    metaGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    metaItem:    { minWidth: '45%', flex: 1 },
    metaLabel:   { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginBottom: 2 },
    metaValue:   { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },

    // Generic card
    card:      { backgroundColor: colors.card, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 16 },
    cardLabel: { fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },
    notesSectionTitle: { fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
    notesSectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 4 },
    notesSaveStateText: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },
    outcomeBadge:     { alignSelf: 'flex-start', borderRadius: 8, borderWidth: 1, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 14 },
    outcomeBadgeText: { fontSize: 12, fontFamily: fonts.semibold },
    otherOutcomesText: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: -8, marginBottom: 14 },
    reviseOutcomeBtn:     { alignSelf: 'flex-start', marginBottom: 14 },
    reviseOutcomeBtnText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },

    // Préparation (avant le RDV)
    prepRow:      { marginBottom: 12 },
    prepRowLabel: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
    prepRowValue: { fontSize: 14, fontFamily: fonts.medium, color: colors.text, lineHeight: 19 },
    prepRowLink:  { color: colors.primary },
    prepRowEmpty: { fontSize: 13, fontFamily: fonts.body, color: colors.textTertiary, fontStyle: 'italic' },
    prepListItem: { fontSize: 13, fontFamily: fonts.body, color: colors.text, lineHeight: 20 },

    // Status pills
    statusPills:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    statusPill:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    statusPillText: { fontSize: 12, fontFamily: fonts.medium },
    statusPillTempRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },

    // Commercial context
    commercialSubLabel: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary, marginTop: 14, marginBottom: 8 },
    bizValueInput: { fontSize: 14, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, padding: 10, maxWidth: 160 },

    // Débrief — choix des relances à créer
    followupPlanRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    followupPlanLabel:      { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    followupPlanDelay:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
    followupPlanDelayLabel: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    followupPlanDelayInput: { fontSize: 13, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, width: 48, textAlign: 'center' },
    noFollowupRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, marginTop: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    noFollowupHint: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 2 },
    saleProductRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    // P4 §2 — en-têtes de colonnes Produit/Qté/Prix unitaire, même schéma flex/largeurs que
    // saleProductRow pour un alignement exact.
    productColumnHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    productColumnHeaderText: { fontSize: 10.5, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
    // P4 §5 — mise en avant discrète du warning "prix manquant", distincte du hint neutre
    // (noFollowupHint, réutilisé ailleurs pour du texte purement informatif).
    priceWarningText: { fontSize: 12, fontFamily: fonts.medium, color: colors.warning, marginTop: 2 },
    // P4 §15 — variante non-flex de debriefSecondaryBtn : ce bouton est utilisé SEUL (jamais
    // apparié dans une rangée), il ne doit donc jamais s'étirer sur toute la largeur de la carte.
    debriefSecondaryBtnStandalone: { alignSelf: 'flex-start', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, marginTop: 16, borderWidth: 1, borderColor: colors.border },
    // P4 §11/§13 — total de vente, même style que debriefRecapValue (cohérent avec "Valeur
    // estimée" dans la synthèse de clôture juste au-dessus).
    saleTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    saleTotalLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    saleTotalValue: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
    lrpToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, marginTop: 4 },
    switchLabel:  { fontSize: 13, fontFamily: fonts.medium, color: colors.text, flex: 1 },
    // Correctif affichage — noteCard a `flex: 1`, pensé pour deux cartes côte à côte dans une
    // rangée (notesRow) : appliqué à cette carte seule (pleine largeur, hors rangée), il pouvait
    // fausser le calcul de hauteur sur web dès que le contenu grandissait (produits + boutons
    // coupés). Mêmes styles visuels que noteCard, sans flex.
    discussedProductsCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 12, gap: 6 },
    discussedProductsEmpty: { fontSize: 13, fontFamily: fonts.body, color: colors.textTertiary, marginBottom: 4 },
    discussedProductsAddBtn: {
      flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16,
      backgroundColor: colors.primaryLight,
    },
    discussedProductsAddBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },
    consideredProductRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    consideredProductLabel:  { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    consideredProductDetail: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 1 },
    // RÉCAP-6.1 — une commande par bloc, compact (§9/§29 : jamais une grosse fiche disproportionnée).
    orderCardRow:    { marginBottom: 14 },
    orderTotalText:  { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, marginTop: 4 },
    // ORDER-BUSINESS-4.2.2 §4 — résumé compact commandé/retourné/conservé, même ton neutre que
    // le reste de la carte (jamais un gros badge supplémentaire, §6).
    orderReturnLineText: { fontSize: 11, fontFamily: fonts.medium, color: colors.warning, marginTop: 1, marginLeft: 8 },
    outcomeLinkText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary, marginBottom: 8 },
    debriefFieldError: { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, marginTop: -4, marginBottom: 8 },
    debriefNoClientRow: { flexDirection: 'row', gap: 10 },
    debriefSecondaryBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16, borderWidth: 1, borderColor: colors.border },
    debriefSecondaryBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    // Distinct du bordé neutre ci-dessus : cette action fait passer des produits d'une section
    // ("Produits envisagés") à une autre ("Produits vendus") plus bas — teinté + icône directionnelle
    // pour que ce transfert entre sections soit visible, pas juste une ligne de plus dans la carte.
    debriefSuggestBtn: {
      flex: 1, borderRadius: 12, paddingVertical: 14, marginTop: 16,
      backgroundColor: colors.primaryLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    },
    debriefSuggestBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.primary },

    // Cancel banner
    cancelBanner:        { backgroundColor: colors.danger + '10', borderRadius: 12, borderWidth: 1, borderColor: colors.danger + '40', padding: 14, gap: 10 },
    cancelBannerText:    { fontSize: 14, fontFamily: fonts.medium, color: colors.text, textAlign: 'center' },
    cancelBannerBtns:    { flexDirection: 'row', gap: 10 },
    cancelBannerNo:      { flex: 1, paddingVertical: 9, borderRadius: 9, borderWidth: 0.5, borderColor: colors.border, alignItems: 'center' },
    cancelBannerNoText:  { fontSize: 13, fontFamily: fonts.medium },
    cancelBannerYes:     { flex: 1, paddingVertical: 9, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center' },
    cancelBannerYesText: { fontSize: 13, fontFamily: fonts.semibold, color: '#ffffff' },

    // Notes
    notesRow:      { flexDirection: 'row', gap: 12 },
    notesStack:    { flexDirection: 'column', gap: 12 },
    noteCard:      { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 12, gap: 6 },
    noteCardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
    noteCardTitle: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
    noteCardInternalBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    noteCardInternalBadgeText: { fontSize: 10, fontFamily: fonts.semibold, color: colors.danger },
    noteInput:     { fontSize: 13, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, padding: 8, minHeight: 64, textAlignVertical: 'top' },
    saveBtn:         { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    saveBtnDisabled: { opacity: 0.6 },
    saveBtnText:     { fontSize: 14, fontFamily: fonts.semibold, color: '#ffffff' },
    recapHint:       { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 6, textAlign: 'center' },

    // RDV-1 §12 — CTA final, même famille visuelle que debriefDoneBtn (le bouton de
    // confirmation du débrief qu'il ouvre), pour marquer que "Terminer" est l'aboutissement
    // naturel du parcours, nettement plus affirmé que les pills de statusSection.
    finishBtn:     { flexDirection: 'row', gap: 8, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 24 },
    finishBtnText: { fontSize: 16, fontFamily: fonts.semibold, color: '#ffffff' },

    // Debrief modal
    debriefOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    debriefSheet: {
      backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingHorizontal: 20, paddingBottom: 32, maxHeight: '85%',
    },
    debriefHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    debriefHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
    debriefTitle:  { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
    debriefSub:    { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, marginBottom: 12, lineHeight: 18 },
    debriefRecap:      { marginBottom: 14, borderRadius: 10, backgroundColor: colors.bgDim, paddingHorizontal: 10 },
    debriefRecapRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    debriefRecapLabel: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    debriefRecapValue: { fontSize: 12, fontFamily: fonts.semibold, color: colors.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
    debriefWarningText:{ fontSize: 12.5, fontFamily: fonts.medium, color: colors.warning, backgroundColor: colors.warning + '18', borderRadius: 8, padding: 10, marginBottom: 8, lineHeight: 17 },
    debriefDoneBtn:     { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
    debriefDoneBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#ffffff' },

    // Tasks
    // CONTACT-RDV-TASKS/P3.1 — bloc compact (padding partagé plutôt que deux fois 8px), pour ne
    // pas alourdir la hauteur de l'état vide malgré la ligne d'aide ajoutée (§10 du brief).
    emptyTaskBlock:    { alignItems: 'center', paddingVertical: 6, gap: 3 },
    emptyTaskText:     { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },
    emptyTaskHint:     { fontSize: 11.5, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', paddingHorizontal: 12, lineHeight: 16 },
    taskRow:           { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    taskRowDone:       { opacity: 0.5 },
    taskCheck:         { padding: 2 },
    taskCheckBox:      { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    taskTitle:         { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    taskTitleDone:     { fontFamily: fonts.body, textDecorationLine: 'line-through' },
    taskMeta:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
    taskDue:           { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },
    taskTypeBadge:     { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.bgDim },
    taskTypeBadgeText: { fontSize: 10, fontFamily: fonts.medium, color: colors.textSecondary },
    taskRemove:        { padding: 4 },
    addTaskRow:        { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
    addTaskInput:      { flex: 1, fontSize: 13, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
    addTaskBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    addTaskBtnText:    { fontSize: 20, fontFamily: fonts.bold, color: '#ffffff', lineHeight: 24 },
    taskErrorText:     { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, marginTop: 6 },

    errorText: { fontSize: 13, fontFamily: fonts.body, color: colors.danger, textAlign: 'center', paddingHorizontal: 4 },
    nextStepConfirm: { fontSize: 13, fontFamily: fonts.medium, color: colors.success, marginTop: 4 },
    nextStepPickerBtn:     { backgroundColor: colors.bgDim, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center' },
    nextStepPickerBtnText: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
    nextStepTimeRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
    nextStepTimeSep:       { fontSize: 14, color: colors.textTertiary },

    warningBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 4 },
    warningBannerText: { fontSize: 13, fontFamily: fonts.body, color: colors.warning, textAlign: 'center' },
    warningBannerRetry: { fontSize: 13, fontFamily: fonts.semibold, color: colors.warning, textDecorationLine: 'underline' },

    // Header
    headerBackBtn:        { paddingHorizontal: 12 },
    headerBackText:       { fontSize: 14, fontFamily: fonts.medium, color: colors.primary },
    headerBackBtnMobile:  { paddingHorizontal: 12, paddingVertical: 4 },
    headerBackTextMobile: { fontSize: 13, fontFamily: fonts.medium, color: colors.primary, maxWidth: 160 },
    headerBackArrowMobile:{ fontSize: 24, fontFamily: fonts.medium, color: colors.primary, lineHeight: 28 },
    headerBtns:           { flexDirection: 'row', gap: 8, marginRight: 4 },
    headerBtnDanger:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 0.5, borderColor: colors.danger },
    headerBtnDangerText:  { fontSize: 12, fontFamily: fonts.medium, color: colors.danger },
    headerBtnPrimary:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.primary },
    headerBtnPrimaryText: { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },
    headerBtnSuccess:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.success },
    headerBtnSuccessText: { fontSize: 12, fontFamily: fonts.semibold, color: '#ffffff' },

    // Mobile client card
    mobileClientCard: { backgroundColor: colors.card, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },

    // Web layout
    webLayout: { flex: 1, flexDirection: 'row', backgroundColor: colors.bgDim },
    webMain:   { flex: 1 },

    // Sidebar
    webSidebar:       { width: 260, backgroundColor: colors.surface, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border, padding: 16 },
    sideSection:      { marginBottom: 20 },
    sideSectionTitle: { fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
    sideClientCard:   { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, backgroundColor: colors.card, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    sideAvatar:       { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    sideAvatarText:   { fontSize: 13, fontFamily: fonts.semibold },
    sideClientName:   { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    sideRoleRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3, marginBottom: 2 },
    sideRolePill:     { flexShrink: 0, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 9999 },
    sideRolePillText: { fontSize: 10, fontFamily: fonts.bold, letterSpacing: 0.3 },
    sideClientSub:    { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },
    sideHistory:      { gap: 6 },
    sideHistoryItem:  { padding: 8, backgroundColor: colors.card, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    sideHistoryTitle: { fontSize: 12, fontFamily: fonts.semibold, color: colors.text },
    sideHistoryDate:  { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 2 },
    // RDV-HISTORY-NAV-1 §11/§27 — sélection sobre (fond léger + bordure accent, jamais une
    // couleur agressive), dark-mode compatible via colors.primaryLight/colors.primary.
    sideHistoryItemActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    sideHistoryTitleActive: { color: colors.primary },
    // §12 — même carte que sideHistoryItem, léger accent pour la distinguer visuellement du
    // bloc "Historique RDV" juste en dessous (même famille visuelle que sideHistoryItemActive,
    // sans être identique — "RDV actuel" n'est pas "l'élément sélectionné dans une liste").
    sideHistoryItemOrigin: { borderColor: colors.primary, borderWidth: 1.5 },
    sideOverdue:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.danger + '18', borderRadius: 8, padding: 10 },
    sideOverdueText:  { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    sideStatusRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sideStatusDot:    { width: 8, height: 8, borderRadius: 4 },
    sideStatusText:   { fontSize: 14, fontFamily: fonts.semibold },
  })
}
