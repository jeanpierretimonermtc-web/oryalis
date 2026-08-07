import { useState, useEffect, useMemo, useRef } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Platform, Modal, useWindowDimensions,
} from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Lock, Snowflake, CloudSun, Flame, Check, X, TriangleAlert } from 'lucide-react-native'
import { supabase } from '@/shared/lib/supabase'
import { useAppointmentDetail } from '@/features/appointments/useAppointments'
import { createAppointment, deleteAppointment } from '@/features/appointments/appointmentService'
import { createFollowup } from '@/features/followups/followupService'
import { useRecommendations } from '@/features/recommendations/useRecommendations'
import { createRecommendation } from '@/features/recommendations/recommendationService'
import { createOrder } from '@/features/orders/orderService'
import { logClientEvent } from '@/features/clients/clientEventService'
import { AppointmentCompletionError } from '@/features/appointments/appointmentTypes'
import type {
  AppointmentStatus, AppointmentTask, ProspectTemperature, CommercialIntent, AppointmentOutcome,
  AppointmentOutcomeDetails, OutcomeSaleProduct, OutcomeInterestKind, NotInterestedReason, OutcomeRevisionReason,
  SaleCompletedDetails, InterestedDetails, NotInterestedDetails, PartnerPotentialDetails, PartnerRecruitedDetails,
  PostCompletionWarningCode, PostCompletionPlan, PostCompletionPlanKey, AppointmentOutcomeActionPlan,
} from '@/features/appointments/appointmentTypes'
import { ACTIVE_OUTCOMES } from '@/features/appointments/appointmentTypes'
import {
  getApplicableAutomationRules, isFirstOrderForClient, fetchUpcomingAppointmentsForClient,
  detectFollowupConflict,
  buildOutcomeRevisionPlan, reviseAppointmentOutcome, applyOutcomePlanActions, OutcomeRevisionConflictError,
} from '@/features/appointments/appointmentOutcomeService'
import type { FollowupConflict, UpcomingAppointmentOption, OutcomeRevisionPlan, OutcomeSnapshot, OutcomePlanWarnings } from '@/features/appointments/appointmentOutcomeService'
import { AUTOMATION_RULES, renderRuleTitle, renderRuleDescription } from '@/features/automations/automationService'
import { CatalogProductPicker } from '@/features/catalogs/CatalogProductPicker'
import type { CatalogPickerResult } from '@/features/catalogs/CatalogProductPicker'
import { PIPELINE_STAGES, type PipelineStage, type ContactRole, type NextActionType } from '@/shared/lib/types'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import { CalendarPickerModal } from '@/shared/components/ui/CalendarPickerModal'
import type { CalendarBusyAppointment } from '@/shared/components/ui/CalendarPickerModal'
import { TimePickerModal } from '@/shared/components/ui/TimePickerModal'
import { buildAppointmentRecapTemplate } from '@/features/messages/templates'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { useAppConfig } from '@/features/settings/AppConfigProvider'

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
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

const STATUS_PILLS: AppointmentStatus[] = ['scheduled', 'completed', 'no_show', 'rescheduled']
const TEMPERATURE_PILLS: ProspectTemperature[] = ['cold', 'warm', 'hot', 'very_hot']
const INTENT_PILLS: CommercialIntent[] = ['buy_product', 'become_customer', 'become_distributor', 'build_team', 'training', 'support', 'other']
// Lot 1.2 — 'follow_up_required' n'est plus un choix actif (Principe 1) : "à relancer" est une
// prochaine action, pas un résultat. Reste dans OUTCOME_COLOR pour l'affichage historique.
const OUTCOME_PILLS: AppointmentOutcome[] = ACTIVE_OUTCOMES
const INTEREST_KIND_PILLS: OutcomeInterestKind[] = ['product', 'product_range', 'offer', 'subscription', 'sample', 'business_opportunity', 'other']
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

type ClientInfo = { id: string; full_name: string; status: string; first_name: string | null; phone: string | null; next_lrp_date: string | null; contact_role: ContactRole[] }
type HistoryItem = { id: string; title: string; status: string; start_at: string }

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

function TaskRow({ task, colors, styles, onDone, onRemove, locale }: {
  task: AppointmentTask
  colors: ThemeColors
  styles: ReturnType<typeof makeStyles>
  onDone: () => void
  onRemove: () => void
  locale: string
}) {
  const { t } = useTranslation()
  const isDone = task.status === 'done'
  const isOverdue = !isDone && !!task.due_at && new Date(task.due_at) < new Date()
  const dueStr = task.due_at
    ? formatDate(task.due_at, locale, { day: '2-digit', month: 'short' })
    : null

  return (
    <View style={[styles.taskRow, isDone && styles.taskRowDone]}>
      <TouchableOpacity
        style={styles.taskCheck}
        onPress={!isDone ? onDone : undefined}
        disabled={isDone}
      >
        <View style={[styles.taskCheckBox, isDone && { backgroundColor: colors.success, borderColor: colors.success }]}>
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
        <View style={styles.taskTypeBadge}>
          <Text style={styles.taskTypeBadgeText}>{t(`task_types.${task.task_type}` as any)}</Text>
        </View>
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
  const { id, returnTo, debrief } = useLocalSearchParams<{ id: string; returnTo?: string; debrief?: string }>()
  const { colors } = useTheme()
  const { getRoleLabel, isModuleActive, getAutomationDelay } = useAppConfig()
  const styles = useMemo(() => makeStyles(colors), [colors])

  function goBack() {
    if (returnTo) router.replace(decodeURIComponent(returnTo) as any)
    else router.back()
  }

  const {
    appointment, loading, reload,
    saveNotes, saveBusinessContext, addTask, doneTask, removeTask, update, complete, retryPostCompletion, cancel,
  } = useAppointmentDetail(id ?? null)

  const [clientNotes,       setClientNotes]       = useState('')
  const [internalNotes,     setInternalNotes]      = useState('')
  const [needsIdentified,   setNeedsIdentified]    = useState('')
  const [objections,        setObjections]         = useState('')
  const [productsDiscussed, setProductsDiscussed]  = useState('')
  const [notesDirty,        setNotesDirty]         = useState(false)
  const [saving,            setSaving]             = useState(false)
  const [showRecap,         setShowRecap]          = useState(false)
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
  // Vente réalisée — lignes de produits en brouillon (créent une vraie commande à la confirmation
  // finale uniquement — clôture ou révision, jamais au clic, Lot 1.2.1 §2).
  const [saleProducts,      setSaleProducts]      = useState<OutcomeSaleProduct[]>([])
  const [showSalePicker,    setShowSalePicker]    = useState(false)
  const [saleListExpanded,  setSaleListExpanded]  = useState(false)
  const [isFirstOrderFlag,  setIsFirstOrderFlag]  = useState(false)
  // Intéressé — recommandation ajoutée au plan seulement sur choix explicite (§6), créée
  // uniquement à la confirmation finale, jamais automatique.
  const [recommendationPlanned, setRecommendationPlanned] = useState(false)
  // Relance automatique prévisualisée (lecture seule, §11) et relance personnelle (§12-14) —
  // ajoutée au plan, créée uniquement à la confirmation finale (Lot 1.2.1 §2).
  const [personalFollowupType,    setPersonalFollowupType]    = useState<NextActionType>('call')
  const [personalFollowupDate,    setPersonalFollowupDate]    = useState('')
  const [personalFollowupTitle,   setPersonalFollowupTitle]   = useState('')
  const [personalFollowupComment, setPersonalFollowupComment] = useState('')
  const [personalFollowupPlanned, setPersonalFollowupPlanned] = useState(false)
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
  const [clientHistory,     setClientHistory]      = useState<HistoryItem[]>([])
  const [clientPendingTasks, setClientPendingTasks] = useState<AppointmentTask[]>([])
  const { recommendations: clientRecommendations }  = useRecommendations(appointment?.client_id ?? '')
  const [estValue,          setEstValue]           = useState('')
  const [bizValueDirty,     setBizValueDirty]      = useState(false)
  const [savingBizValue,    setSavingBizValue]     = useState(false)

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
  }, [appointment?.notes])

  useEffect(() => {
    const biz = appointment?.business_context
    setEstValue(biz?.estimated_value != null ? String(biz.estimated_value) : '')
    setBizValueDirty(false)
  }, [appointment?.business_context])

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
      setSaleProducts(persistedDetails?.kind === 'sale_completed' ? persistedDetails.products : [])
      setRecommendationPlanned(false)
      setPersonalFollowupPlanned(false)
      setPersonalFollowupTitle('')
      setPersonalFollowupComment('')
      setPersonalFollowupDate('')
      setFollowupConflict(null)
      setConfirmConflict(false)
      setSelectedUpcomingId(null)
      if (appointment?.client_id) {
        fetchUpcomingAppointmentsForClient(appointment.client_id, id).then(setUpcomingAppts).catch(() => setUpcomingAppts([]))
      }
    }
  }, [showDebrief])

  useEffect(() => {
    const cid = appointment?.client_id
    if (!cid) return
    supabase.from('clients').select('id, full_name, status, first_name, phone, next_lrp_date, contact_role').eq('id', cid).single()
      .then(({ data }) => { if (data) setClientInfo(data as ClientInfo) })
    supabase.from('appointments')
      .select('id, title, status, start_at')
      .eq('client_id', cid)
      .neq('id', appointment!.id)
      .order('start_at', { ascending: false })
      .limit(5)
      .then(({ data }) => { if (data) setClientHistory(data as HistoryItem[]) })
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
  }, [appointment?.client_id, appointment?.id])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function noteChanger(setter: (v: string) => void) {
    return (v: string) => { setter(v); setNotesDirty(true) }
  }

  async function handleSaveNotes(): Promise<boolean> {
    if (!notesDirty) return true
    setSaving(true)
    setInlineError(null)
    const ok = await saveNotes({
      client_notes:       clientNotes || undefined,
      internal_notes:     internalNotes || undefined,
      needs_identified:   needsIdentified || undefined,
      objections:         objections || undefined,
      products_discussed: productsDiscussed || undefined,
    })
    setSaving(false)
    if (!ok) { setInlineError(t('appointments.error_save_notes')); return false }
    setNotesDirty(false)
    return true
  }

  async function handleStatusChange(status: AppointmentStatus) {
    if (isCompleting) return // garde anti-double-clic

    setInlineError(null)

    if (status === 'completed') {
      // Un RDV cancelled/no_show ne peut jamais être complété — refus immédiat côté UI,
      // en plus du rejet contrôlé côté service (défense en profondeur).
      if (appointment?.status === 'cancelled') { setInlineError(t('appointments.error_cannot_complete_cancelled')); return }
      if (appointment?.status === 'no_show')   { setInlineError(t('appointments.error_cannot_complete_no_show'));   return }

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
    if (!proposeNextDate || !proposeNextTime || !proposeNextPurpose.trim() || !appointment || creatingNextRdv) return
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
      })
      setNextRdvCreated(true)
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
        const warnings = await applyOutcomePlanActions(appointment.user_id, id, appointment.client_id, actionPlan, `${id}:closure`)
        setPlanActionWarnings(warnings.order || warnings.recommendation || warnings.personalFollowup || warnings.appointmentLink ? warnings : null)
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
    setSaleProducts(prev => [...prev, { productId: result.productId, catalogId: result.catalogId, label: result.productName, quantity: 1 }])
    setShowSalePicker(false)
  }
  function handleAddFreeSaleProduct() {
    setSaleProducts(prev => [...prev, { label: '', quantity: 1 }])
  }
  function updateSaleProduct(index: number, patch: Partial<OutcomeSaleProduct>) {
    setSaleProducts(prev => prev.map((p, i) => i === index ? { ...p, ...patch } : p))
  }
  function removeSaleProduct(index: number) {
    setSaleProducts(prev => prev.filter((_, i) => i !== index))
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

  // Lot 1.2.1 §2 — idem : ajoute au plan, ne crée rien avant la confirmation finale.
  function togglePersonalFollowupPlanned() {
    if (!personalFollowupPlanned) {
      if (!personalFollowupDate || !personalFollowupTitle.trim()) return
      if (followupConflict && !confirmConflict) return
    }
    setPersonalFollowupPlanned(v => !v)
  }

  // Construit le plan d'actions unique (§3) à partir des brouillons actuels — utilisé
  // identiquement par la clôture initiale et par la révision (aucune logique dupliquée).
  function buildActionPlanFromDrafts(): AppointmentOutcomeActionPlan {
    return {
      saleOrder: outcomeDraft === 'sale_completed' && saleProducts.length > 0 ? { products: saleProducts } : null,
      recommendation: recommendationPlanned && outcomeDetailsDraft?.kind === 'interested' ? {
        productName: outcomeDetailsDraft.freeText?.trim()
          || outcomeDetailsDraft.interests.map(k => t(`outcome_interest_kinds.${k}` as any)).join(', ')
          || t('appointments.outcome_sale_unnamed_product'),
        reason: outcomeDetailsDraft.comment?.trim() || null,
      } : null,
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
      setSaleProducts(plan.previous.outcomeDetails?.kind === 'sale_completed' ? plan.previous.outcomeDetails.products : [])
      setRecommendationPlanned(false)
      setPersonalFollowupPlanned(false)
      setPersonalFollowupTitle('')
      setPersonalFollowupComment('')
      setPersonalFollowupDate('')
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
      const newRevision = await reviseAppointmentOutcome({
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
      const warnings = await applyOutcomePlanActions(appointment.user_id, id, appointment.client_id, lastActionPlanRef.current, `${id}:closure`)
      setPlanActionWarnings(warnings.order || warnings.recommendation || warnings.personalFollowup || warnings.appointmentLink ? warnings : null)
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
    const next = current.includes(intent) ? current.filter(i => i !== intent) : [...current, intent]
    const ok = await saveBusinessContext({ commercial_intent: next })
    if (!ok) setInlineError(t('appointments.error_save_business'))
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

  async function handleDoneTask(taskId: string) {
    const ok = await doneTask(taskId)
    if (!ok) setInlineError(t('appointments.error_done_task'))
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
                  {t(`pipeline_stages.${biz.pipeline_stage}` as any)}
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
                  <Text style={styles.metaValue}>{biz.commercial_intent.map(i => t(`commercial_intents.${i}` as any)).join(', ')}</Text>
                </View>
              ) : null}
              {biz?.estimated_value != null ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>{t('appointments.field_value')}</Text>
                  <Text style={styles.metaValue}>{biz.estimated_value} {biz.currency}</Text>
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
                {t(`pipeline_stages.${stage}` as any)}
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
                {t(`commercial_intents.${intent}` as any)}
              </Text>
            </TouchableOpacity>
          )
        })}
      </View>

      <Text style={styles.commercialSubLabel}>{t('appointments.field_value')}</Text>
      <TextInput
        style={styles.bizValueInput}
        value={estValue}
        onChangeText={(v) => { setEstValue(v); setBizValueDirty(true) }}
        placeholder="0.00"
        placeholderTextColor={colors.textTertiary}
        keyboardType="decimal-pad"
      />
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

      {/* ── Détails conditionnels — un seul résultat visible à la fois (Principe 4) ── */}
      {outcomeDraft === 'sale_completed' && outcomeDetailsDraft?.kind === 'sale_completed' ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.commercialSubLabel}>{t('appointments.outcome_sale_products')}</Text>
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
                style={[styles.bizValueInput, { width: 48 }]}
                value={String(p.quantity)}
                onChangeText={(v) => updateSaleProduct(i, { quantity: Math.max(1, parseInt(v.replace(/\D/g, ''), 10) || 1) })}
                keyboardType="number-pad"
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
          <TextInput
            style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
            value={outcomeDetailsDraft.freeText ?? ''}
            onChangeText={(v) => setOutcomeDetailsDraft(prev => prev?.kind === 'interested' ? { ...prev, freeText: v } : prev)}
            placeholder={t('appointments.outcome_interested_free_text_placeholder')}
            placeholderTextColor={colors.textTertiary}
          />
          <TouchableOpacity
            style={[styles.debriefSecondaryBtn, (!outcomeDetailsDraft.interests.length && !outcomeDetailsDraft.freeText?.trim()) && styles.saveBtnDisabled]}
            onPress={toggleRecommendationPlanned}
            disabled={!recommendationPlanned && !outcomeDetailsDraft.interests.length && !outcomeDetailsDraft.freeText?.trim()}
            activeOpacity={0.8}
          >
            <Text style={styles.debriefSecondaryBtnText}>
              {recommendationPlanned ? t('appointments.outcome_interested_reco_remove_plan') : t('appointments.outcome_interested_create_reco')}
            </Text>
          </TouchableOpacity>
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

      {/* ── Relances automatiques prévues — lecture seule, aucune création ici (§11) ──
          Lot 1.2.1 §12 : la relance "RDV complété" n'est jamais prévue si le praticien a
          choisi "aucune suite nécessaire" (clôture ou révision) — l'aperçu ne doit jamais
          montrer une relance que le moteur ne créera pas réellement. Les automatismes de
          commande restent, eux, toujours affichés (indépendants de cette décision). */}
      {outcomeDraft ? (() => {
        const appointmentNoFollowup = showRevision ? revisionNoFollowupRequired : noFollowupRequired
        const rules = [
          ...(appointmentNoFollowup ? [] : getApplicableAutomationRules('appointment')),
          ...(outcomeDraft === 'sale_completed' && saleProducts.length > 0
            ? getApplicableAutomationRules(isFirstOrderFlag ? 'first_order' : 'order')
            : []),
        ].filter(r => isModuleActive(r.moduleKey as any))
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

      {/* ── Relance personnelle (§12-14) ─────────────────────────────────────── */}
      {outcomeDraft && appointment.client_id ? (
        <View style={styles.debriefRecap}>
          <Text style={styles.commercialSubLabel}>{t('appointments.outcome_personal_followup_title')}</Text>
          <View style={styles.statusPills}>
            {(['call', 'whatsapp', 'sms', 'email', 'other'] as NextActionType[]).map(type => (
              <TouchableOpacity key={type} disabled={personalFollowupPlanned} onPress={() => setPersonalFollowupType(type)} style={[styles.statusPill, personalFollowupType === type && { backgroundColor: colors.primaryLight, borderColor: colors.primary }]} activeOpacity={0.75}>
                <Text style={[styles.statusPillText, { color: personalFollowupType === type ? colors.primary : colors.textSecondary }]}>{t(`next_action_types.${type}` as any)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
            value={personalFollowupTitle}
            editable={!personalFollowupPlanned}
            onChangeText={setPersonalFollowupTitle}
            placeholder={t('appointments.outcome_personal_followup_title_placeholder')}
            placeholderTextColor={colors.textTertiary}
          />
          <TextInput
            style={[styles.bizValueInput, { maxWidth: 160 }]}
            value={personalFollowupDate}
            editable={!personalFollowupPlanned}
            onChangeText={(v) => { setPersonalFollowupDate(v); setFollowupConflict(null) }}
            onBlur={handleCheckFollowupConflict}
            placeholder={t('appointments.date_placeholder_iso')}
            placeholderTextColor={colors.textTertiary}
          />
          <TextInput
            style={[styles.bizValueInput, { maxWidth: undefined, width: '100%' }]}
            value={personalFollowupComment}
            editable={!personalFollowupPlanned}
            onChangeText={setPersonalFollowupComment}
            placeholder={t('appointments.outcome_personal_followup_comment_placeholder')}
            placeholderTextColor={colors.textTertiary}
          />
          {followupConflict && !personalFollowupPlanned ? (
            <View style={styles.noFollowupRow}>
              <TouchableOpacity style={styles.taskCheck} onPress={() => setConfirmConflict(v => !v)}>
                <View style={[styles.taskCheckBox, confirmConflict && { backgroundColor: colors.warning, borderColor: colors.warning }]}>
                  {confirmConflict && <Check size={12} color="#fff" strokeWidth={3} />}
                </View>
              </TouchableOpacity>
              <Text style={styles.noFollowupHint}>{t('appointments.outcome_followup_conflict_warning')}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={[styles.saveBtn, (!personalFollowupPlanned && (!personalFollowupDate || !personalFollowupTitle.trim() || (!!followupConflict && !confirmConflict))) && styles.saveBtnDisabled]}
            onPress={togglePersonalFollowupPlanned}
            disabled={!personalFollowupPlanned && (!personalFollowupDate || !personalFollowupTitle.trim() || (!!followupConflict && !confirmConflict))}
            activeOpacity={0.8}
          >
            <Text style={styles.saveBtnText}>
              {personalFollowupPlanned ? t('appointments.outcome_personal_followup_remove_plan') : t('appointments.outcome_personal_followup_create')}
            </Text>
          </TouchableOpacity>
          {personalFollowupPlanned ? (
            <Text style={styles.noFollowupHint}>{t('appointments.outcome_personal_followup_planned')}</Text>
          ) : null}
        </View>
      ) : null}

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
                    <Text style={styles.debriefRecapValue}>{t(`pipeline_stages.${biz.pipeline_stage}` as any)}</Text>
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
                    <Text style={styles.debriefRecapValue}>{biz.commercial_intent.map(i => t(`commercial_intents.${i}` as any)).join(', ')}</Text>
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
          <TouchableOpacity onPress={() => router.push(`/(app)/appointments/${lastPastActivity.id}?returnTo=${encodeURIComponent(`/(app)/appointments/${id}`)}` as any)} activeOpacity={0.75}>
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

  // Récap partageable — décision #7 de la refonte : jamais les notes internes ni
  // les objections, uniquement date/type du RDV + besoins identifiés + produits
  // discutés. Disponible seulement une fois le RDV terminé et un minimum rempli.
  const recapTemplate = (appointment.status === 'completed' && (needsIdentified.trim() || productsDiscussed.trim()))
    ? buildAppointmentRecapTemplate({
        dateLabel: formatDate(appointment.start_at, locale),
        typeLabel: t(`appointment_types.${appointment.appointment_type}` as any),
        needsIdentified,
        productsDiscussed,
        nextAppointment: (nextRdvCreated && proposeNextDate && proposeNextTime && proposeNextPurpose.trim())
          ? { dateLabel: `${formatDate(toISO(proposeNextDate, proposeNextTime), locale)} à ${proposeNextTime}`, purpose: proposeNextPurpose.trim() }
          : null,
      })
    : null

  const notesSection = (
    <>
      <Text style={styles.notesSectionTitle}>{t('appointments.section_report')}</Text>
      <View style={isWeb ? styles.notesRow : styles.notesStack}>
        <NoteCard title={t('appointments.field_client_notes')}   value={clientNotes}      onChange={noteChanger(setClientNotes)}      colors={colors} styles={styles} />
        <NoteCard title={t('appointments.field_needs')}          value={needsIdentified}  onChange={noteChanger(setNeedsIdentified)}  colors={colors} styles={styles} />
      </View>
      <View style={isWeb ? styles.notesRow : styles.notesStack}>
        <NoteCard title={t('appointments.field_internal_notes')} value={internalNotes}    onChange={noteChanger(setInternalNotes)}    colors={colors} styles={styles} internal />
        <NoteCard title={t('appointments.field_objections')}     value={objections}       onChange={noteChanger(setObjections)}       colors={colors} styles={styles} internal />
      </View>
      <NoteCard title={t('appointments.field_products')} value={productsDiscussed} onChange={noteChanger(setProductsDiscussed)} colors={colors} styles={styles} />
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
    </>
  )

  const recapModal = (
    <MessageModal
      visible={showRecap}
      onClose={() => setShowRecap(false)}
      client={clientInfo}
      advisorName={practitionerName}
      initialTemplate={recapTemplate}
    />
  )

  const tasksSection = (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{t('appointments.section_tasks')}</Text>
      {appointment.tasks.length === 0 ? (
        <Text style={styles.emptyTaskText}>{t('appointments.no_tasks_appt')}</Text>
      ) : (
        appointment.tasks.map(task => (
          <TaskRow
            key={task.id}
            task={task}
            colors={colors}
            styles={styles}
            locale={locale}
            onDone={() => handleDoneTask(task.id)}
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
          <Text style={styles.warningBannerText}>{t('appointments.warning_plan_actions_partial')}</Text>
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
              {clientInfo.contact_role.filter(r => r !== 'customer').length > 0 && (
                <View style={styles.sideRoleRow}>
                  {clientInfo.contact_role.filter(r => r !== 'customer').map(role => {
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

      {clientHistory.length > 0 ? (
        <View style={styles.sideSection}>
          <Text style={styles.sideSectionTitle}>{t('appointments.historique_rdv')}</Text>
          <View style={styles.sideHistory}>
            {clientHistory.map(h => (
              <TouchableOpacity
                key={h.id}
                style={styles.sideHistoryItem}
                onPress={() => router.push(`/(app)/appointments/${h.id}?returnTo=${encodeURIComponent(`/(app)/appointments/${id}`)}` as any)}
                activeOpacity={0.8}
              >
                <Text style={styles.sideHistoryTitle} numberOfLines={1}>{h.title}</Text>
                <Text style={styles.sideHistoryDate}>
                  {formatDate(h.start_at, locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}{t(`appointment_statuses.${h.status}` as any)}
                </Text>
              </TouchableOpacity>
            ))}
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
            <TouchableOpacity onPress={goBack} style={styles.headerBackBtn}>
              <Text style={styles.headerBackText}>‹ {t('appointments.back_agenda')}</Text>
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
            {nextStepSection}
            {tasksSection}
          </ScrollView>
          {sidebar}
        </View>
        {debriefModal}
        {salePickerModal}
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
          <TouchableOpacity onPress={goBack} style={styles.headerBackBtnMobile} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.headerBackArrowMobile}>‹</Text>
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
              {clientInfo.contact_role.filter(r => r !== 'customer').length > 0 && (
                <View style={styles.sideRoleRow}>
                  {clientInfo.contact_role.filter(r => r !== 'customer').map(role => {
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
        {nextStepSection}
        {tasksSection}
      </ScrollView>
      {debriefModal}
      {salePickerModal}
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
    notesSectionTitle: { fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12, marginTop: 4 },
    outcomeBadge:     { alignSelf: 'flex-start', borderRadius: 8, borderWidth: 1, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 14 },
    outcomeBadgeText: { fontSize: 12, fontFamily: fonts.semibold },
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
    outcomeLinkText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary, marginBottom: 8 },
    debriefFieldError: { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, marginTop: -4, marginBottom: 8 },
    debriefNoClientRow: { flexDirection: 'row', gap: 10 },
    debriefSecondaryBtn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16, borderWidth: 1, borderColor: colors.border },
    debriefSecondaryBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },

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
    emptyTaskText:     { fontSize: 13, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', paddingVertical: 8 },
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
    sideOverdue:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.danger + '18', borderRadius: 8, padding: 10 },
    sideOverdueText:  { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  })
}
