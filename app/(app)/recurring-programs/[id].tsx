import { useState, useCallback, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/shared/lib/supabase'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { fetchProgramById, updateProgram, completeIfDurationReached } from '@/features/clients/recurringProgramService'
import {
  fetchOccurrencesForProgram, deriveOccurrenceDisplayStatus, confirmOccurrence, skipOccurrence,
  reactivateProgram, computeReactivationCandidateDate, isReactivationDateWithinEnd,
} from '@/features/clients/recurringOccurrenceService'
import type { OccurrenceDisplayStatus, ReactivationMode, ReactivationChoice } from '@/features/clients/recurringOccurrenceService'
import { getDaysUntilLrp } from '@/features/clients/clientService'
import { getLrpFrequencyLabel, programToEditValue, buildProgramEditPatch, formatProgramTitle } from '@/features/clients/lrpProgramService'
import type { LrpProgramValue } from '@/features/clients/lrpProgramService'
import { LrpProgramFields } from '@/features/clients/LrpProgramFields'
import { getOrdersByRecurringProgram, getOrderById, updateOrder } from '@/features/orders/orderService'
import { OrderEditModal } from '@/features/orders/OrderEditModal'
import { DateInput } from '@/shared/components/ui/DateInput'
import { formatDate } from '@/shared/lib/dateFormat'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { RecurringProgram, RecurringProgramOccurrence, OrderListItem } from '@/shared/lib/types'

type ProgramClient = { id: string; full_name: string }
type PendingAction = 'pause' | 'cancel' | 'reactivate' | null

// LRP-5 — couleurs de la pastille de statut d'ÉCHÉANCE, distinctes du statut de commande
// (Livrée/Retournée/Annulée, inchangé) — jamais les mêmes teintes que statusColor (programme)
// pour ne pas laisser croire qu'une échéance "à confirmer" est un problème du programme lui-même.
function getOccurrenceStatusColors(status: OccurrenceDisplayStatus, colors: ThemeColors) {
  if (status === 'due') return { bg: colors.warningLight, text: colors.warning }
  if (status === 'confirmed') return { bg: colors.successLight, text: colors.success }
  if (status === 'skipped') return { bg: colors.bgDim, text: colors.textTertiary }
  return { bg: colors.bgDim, text: colors.textSecondary }
}

// LRP-4 §16 — vue détail d'UN programme récurrent précis (ouverte depuis "Prochaines
// échéances"/le profil/OrderEditModal), remplace le renvoi générique vers l'onglet Profil.
// LRP-5 — le programme, ses ÉCHÉANCES (recurring_program_occurrences) et ses COMMANDES réelles
// sont maintenant 3 notions distinctes : occurrence ≠ order. Une échéance "prévue"/"à confirmer"
// est une vraie ligne de la table occurrences, jamais un simple texte, mais confirmer une
// échéance ne crée jamais automatiquement de commande — c'est toujours une action distincte,
// explicite, optionnelle ("Ajouter les détails").
export default function RecurringProgramScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { getLrpName } = useAppConfig()
  const { id } = useLocalSearchParams<{ id: string }>()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const [program, setProgram]   = useState<RecurringProgram | null>(null)
  const [client,  setClient]    = useState<ProgramClient | null>(null)
  const [orders,  setOrders]    = useState<OrderListItem[]>([])
  // LRP-5 — remplace `realized` (nombre de commandes) : la progression et l'affichage
  // ÉCHÉANCES reposent désormais sur recurring_program_occurrences, jamais sur les commandes.
  const [occurrences, setOccurrences] = useState<RecurringProgramOccurrence[]>([])
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [editingOrder, setEditingOrder] = useState<OrderListItem | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [actionBusy, setActionBusy] = useState(false)
  // LRP-5.3 §2 — "conserver le calendrier prévu" présélectionné par défaut : une pause suspend
  // le programme, elle ne doit jamais déplacer silencieusement son calendrier. L'utilisateur
  // choisit explicitement une autre option s'il le souhaite.
  const [reactivationMode, setReactivationMode] = useState<ReactivationMode>('preserve_schedule')
  const [reactivationCustomDate, setReactivationCustomDate] = useState('')
  const [resolvingOccurrenceId, setResolvingOccurrenceId] = useState<string | null>(null)
  // LRP-4.2 §1 — édition du programme existant (label/fréquence/durée) via LrpProgramFields,
  // le même composant que la création — aucune deuxième logique de formulaire. Ne touche jamais
  // status/start_date/orders : historique, recurring_program_id des commandes et occurrences
  // réalisées restent strictement inchangés (buildProgramEditPatch ne porte que
  // label/frequency_*/end_mode/occurrence_limit/end_date/next_occurrence_date).
  const [editingProgram, setEditingProgram] = useState(false)
  const [editValue, setEditValue] = useState<LrpProgramValue | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let p = await fetchProgramById(id)
      if (!p) { setNotFound(true); return }
      // LRP-4.1 §7 — vérification défensive à chaque ouverture : un programme actif dont la
      // durée est en réalité déjà atteinte (occurrence_limit ou end_date dépassée) ne doit
      // jamais rester visible comme "actif" plus longtemps que nécessaire.
      p = await completeIfDurationReached(p)
      setProgram(p)
      const [clientRes, ordersRes, occurrencesRes] = await Promise.all([
        supabase.from('clients').select('id, full_name').eq('id', p.client_id).single(),
        getOrdersByRecurringProgram(p.id),
        fetchOccurrencesForProgram(p.id),
      ])
      setClient(clientRes.data ?? null)
      setOrders(ordersRes)
      setOccurrences(occurrencesRes)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  function openEditProgram() {
    if (!program) return
    setEditValue(programToEditValue(program))
    setEditingProgram(true)
  }

  async function saveEditProgram() {
    if (!program || !editValue) return
    setSavingEdit(true)
    try {
      let updated = await updateProgram(program.id, buildProgramEditPatch(editValue))
      // Défensif : si la nouvelle durée choisie (occurrence_limit réduit, end_date reculée)
      // rend le programme déjà terminé, on le normalise immédiatement plutôt que d'attendre la
      // prochaine commande/ouverture.
      updated = await completeIfDurationReached(updated)
      setProgram(updated)
      setEditingProgram(false)
      // La progression (X/Y) peut changer d'affichage si occurrence_limit a été modifié —
      // recalcule tout depuis la base plutôt que de bricoler l'état local.
      await load()
    } finally {
      setSavingEdit(false)
    }
  }

  useFocusEffect(useCallback(() => { load() }, [load]))

  // LRP-5.1 §7/§8/§11 — pause/annulation ne touchent plus jamais l'échéance 'scheduled' en cours
  // (ni son statut, ni next_occurrence_date, qui reste synchronisé avec elle). `skipped` reste
  // réservé au seul clic explicite "Non réalisée" : la progression affichée ne doit pas avancer
  // sous prétexte que le programme est mis en pause ou annulé. La neutralisation (aucune alerte,
  // aucun "à confirmer") vient uniquement de status !== 'active' (deriveOccurrenceDisplayStatus/
  // isProgramEligibleForNextOccurrence).
  async function handlePauseOrCancel(nextStatus: 'paused' | 'cancelled') {
    if (!program) return
    setActionBusy(true)
    try {
      await updateProgram(program.id, { status: nextStatus })
      await load()
    } finally {
      setActionBusy(false)
      setPendingAction(null)
    }
  }

  // LRP-5.3 §8/§9/§10/§19 — applique le choix de reprise VALIDÉ par l'utilisateur (jamais choisi
  // à sa place — la validation de la date personnalisée a déjà eu lieu côté rendu avant que ce
  // bouton soit activable). reactivateProgram gère elle-même la protection occurrence_limit/
  // end_date : si le programme n'est plus réactivable, il devient 'completed' plutôt que
  // 'active' — visible immédiatement après `load()` via la pastille de statut.
  async function handleReactivate(choice: ReactivationChoice) {
    if (!program) return
    setActionBusy(true)
    try {
      const currentScheduled = occurrences.find(o => o.status === 'scheduled') ?? null
      const todayForReactivation = new Date().toISOString().split('T')[0]
      await reactivateProgram(program, currentScheduled, todayForReactivation, choice)
      await load()
    } finally {
      setActionBusy(false)
      setPendingAction(null)
    }
  }

  async function openOrder(orderId: string) {
    const found = await getOrderById(orderId)
    if (found) setEditingOrder(found)
  }

  // LRP-5 §6/§15 — SEULES actions utilisateur qui résolvent une échéance : jamais un effet de
  // bord d'une autre action. confirmOccurrence/skipOccurrence gèrent elles-mêmes l'avancement du
  // calendrier (ancré sur occurrence.scheduled_date, jamais sur la date du jour).
  async function handleConfirmOccurrence(occurrence: RecurringProgramOccurrence) {
    if (!program) return
    setResolvingOccurrenceId(occurrence.id)
    try {
      await confirmOccurrence(occurrence, program)
      await load()
    } finally {
      setResolvingOccurrenceId(null)
    }
  }

  async function handleSkipOccurrence(occurrence: RecurringProgramOccurrence) {
    if (!program) return
    setResolvingOccurrenceId(occurrence.id)
    try {
      await skipOccurrence(occurrence, program)
      await load()
    } finally {
      setResolvingOccurrenceId(null)
    }
  }

  // LRP-4.7 — corrige LRP-4.5 §2 : le header natif (Stack.Screen headerLeft) ne s'affiche
  // jamais dans cette app, ni sur mobile ni sur web (screenOptions={{headerShown:false}} du
  // <Tabs> racine dans app/(app)/_layout.tsx s'applique par défaut à TOUTES les routes, y
  // compris celle-ci, qui n'avait jamais redéclaré headerShown explicitement) — même pattern
  // déjà utilisé par clients/[id]/index.tsx (navBar/backRow en page, jamais le header natif).
  // Défini ici (avant les retours conditionnels) pour être réutilisable dans les 3 branches de
  // rendu (loading/notFound/chargé) sans dupliquer la logique de fallback.
  function goBack() {
    if (router.canGoBack()) router.back()
    else if (client) router.replace(`/(app)/clients/${client.id}` as any)
    else router.replace('/(app)/clients' as any)
  }
  const backLabel = client?.full_name ?? t('common.back')
  const navBar = (
    <View style={styles.navBar}>
      <TouchableOpacity style={styles.backRow} onPress={goBack} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.backArrow}>←</Text>
        <Text style={styles.navTitle} numberOfLines={1}>{backLabel}</Text>
      </TouchableOpacity>
    </View>
  )

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        {navBar}
        <ActivityIndicator style={{ marginTop: 48 }} color={colors.primary} />
      </>
    )
  }

  if (notFound || !program) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        {navBar}
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>{t('recurring_program.not_found')}</Text>
        </View>
      </>
    )
  }

  // LRP-4.1 §1 — libellé propre à cette instance en plus du nom global du concept, jamais un
  // remplacement : "Abonnement — Nutrition", pas juste "Nutrition".
  const programTitle = formatProgramTitle(getLrpName(), program.label)
  const frequencyLabel = getLrpFrequencyLabel(program.frequency_value, program.frequency_unit, t)
  const daysUntilNext = program.next_occurrence_date ? getDaysUntilLrp(program.next_occurrence_date) : null
  const todayIso = new Date().toISOString().split('T')[0]
  // LRP-5 §9 — progression basée sur les ÉCHÉANCES (confirmed + skipped consomment toutes deux
  // un cycle), plus sur le nombre de commandes — voir countConsumedOccurrences côté service,
  // dérivée ici directement depuis la liste déjà chargée (aucune requête supplémentaire).
  const confirmedOccurrenceCount = occurrences.filter(o => o.status === 'confirmed').length
  const skippedOccurrenceCount = occurrences.filter(o => o.status === 'skipped').length
  const consumedOccurrenceCount = confirmedOccurrenceCount + skippedOccurrenceCount
  // LRP-5 §19 — commandes non rattachées à une échéance identifiée : la toute première commande
  // d'un programme tout juste créé (occurrenceDate encore inconnue, voir
  // linkOrderToOccurrenceForConfirmation) ou une commande legacy jamais rattachée manuellement.
  const unmatchedOrders = orders.filter(o => !o.recurring_occurrence_id)
  // LRP-5.3 §1/§14 — le choix de reprise est désormais présenté SYSTÉMATIQUEMENT à chaque
  // réactivation (plus de "réactivation directe invisible" même si l'échéance est encore
  // future) — sauf si le programme a déjà atteint son occurrence_limit, auquel cas aucune
  // réactivation normale n'est proposée (§12). Dérivations pures, calculées uniquement pendant
  // la confirmation d'une réactivation.
  const currentScheduledOccurrence = occurrences.find(o => o.status === 'scheduled') ?? null
  const reactivationBlockedByLimit = program.end_mode === 'occurrence_limit'
    && program.occurrence_limit != null && consumedOccurrenceCount >= program.occurrence_limit
  const preserveScheduleDate = pendingAction === 'reactivate' ? computeReactivationCandidateDate(program, currentScheduledOccurrence, todayIso, { mode: 'preserve_schedule' }) : null
  const freshStartDate = pendingAction === 'reactivate' ? computeReactivationCandidateDate(program, currentScheduledOccurrence, todayIso, { mode: 'fresh_start' }) : null
  const preserveExceedsEnd = !isReactivationDateWithinEnd(program, preserveScheduleDate)
  const freshExceedsEnd = !isReactivationDateWithinEnd(program, freshStartDate)
  // LRP-5.3 §6/§11 — contraintes de la date personnalisée : jamais avant aujourd'hui, jamais
  // après end_date. Validée au fil de la saisie, jamais seulement à la confirmation.
  const customDateTrimmed = reactivationCustomDate.trim()
  const customDateError = reactivationMode !== 'custom_date' ? null
    : !customDateTrimmed ? t('recurring_program.reactivate_error_required')
    : customDateTrimmed < todayIso ? t('recurring_program.reactivate_error_past_date')
    : !isReactivationDateWithinEnd(program, customDateTrimmed) ? t('recurring_program.reactivate_error_exceeds_end')
    : null
  const reactivationConfirmDisabled = reactivationMode === 'custom_date'
    ? !!customDateError
    : (reactivationMode === 'preserve_schedule' && preserveExceedsEnd) || (reactivationMode === 'fresh_start' && freshExceedsEnd)

  const statusColor = program.status === 'active' ? { bg: colors.successLight, text: colors.success }
    : program.status === 'paused' ? { bg: colors.warningLight, text: colors.warning }
    : program.status === 'cancelled' ? { bg: colors.dangerLight, text: colors.danger }
    : { bg: colors.bgDim, text: colors.textSecondary }

  // LRP-5 §19 — une seule implémentation de ligne "commande", réutilisée sous une échéance
  // confirmée/non réalisée ET dans le groupe des commandes non rattachées : jamais dupliquée.
  function renderOrderRow(order: OrderListItem) {
    const isCancelled = !!order.cancelled_at
    const isReturned = order.status === 'returned'
    const statusLabel = isCancelled ? t('orders.status_cancelled') : isReturned ? t('orders.status_returned') : t('appointments.order_status_completed')
    const statusColorForOrder = isCancelled ? colors.textTertiary : isReturned ? colors.danger : colors.success
    return (
      <TouchableOpacity key={order.id} style={styles.orderRow} onPress={() => openOrder(order.id)} activeOpacity={0.75}>
        <View style={{ flex: 1 }}>
          <Text style={styles.orderDate}>{t('recurring_program.order_date_prefix', { date: formatDate(order.order_date, locale) })}</Text>
          <Text style={[styles.orderProduct, (isCancelled || isReturned) && styles.orderProductMuted]} numberOfLines={1}>
            {order.product_name}
          </Text>
          <Text style={[styles.orderStatus, { color: statusColorForOrder }]}>{statusLabel}</Text>
        </View>
        {order.amount != null ? <Text style={styles.orderAmount}>{order.amount.toFixed(2)}€</Text> : null}
        <Text style={styles.orderOpen}>{t('common.open')} ›</Text>
      </TouchableOpacity>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {navBar}
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{programTitle}</Text>
              {client ? (
                <TouchableOpacity onPress={() => router.push(`/(app)/clients/${client.id}` as any)}>
                  <Text style={styles.clientLink}>{client.full_name}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={[styles.statusPill, { backgroundColor: statusColor.bg }]}>
              <Text style={[styles.statusPillText, { color: statusColor.text }]}>{t(`lrp_statuses.${program.status}`)}</Text>
            </View>
          </View>
          {editingProgram && editValue ? (
            <View style={styles.editPanel}>
              <LrpProgramFields
                candidatePrograms={[program]}
                orderDate={new Date().toISOString().split('T')[0]}
                value={editValue}
                onChange={setEditValue}
                forceExpanded
              />
              <View style={styles.editPanelActions}>
                <TouchableOpacity onPress={() => setEditingProgram(false)} disabled={savingEdit}>
                  <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveEditProgram} disabled={savingEdit}>
                  {savingEdit
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Text style={styles.confirmConfirmText}>{t('common.save')}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.line}>{frequencyLabel}</Text>
              {program.start_date ? (
                <Text style={styles.lineSecondary}>{t('recurring_program.since', { date: formatDate(program.start_date, locale) })}</Text>
              ) : null}

              {program.end_mode === 'occurrence_limit' && program.occurrence_limit != null ? (
                <Text style={styles.lineSecondary}>
                  {t('recurring_program.occurrences_progress', { done: consumedOccurrenceCount, total: program.occurrence_limit })}
                  {' · '}
                  {t('recurring_program.occurrences_remaining', { count: Math.max(0, program.occurrence_limit - consumedOccurrenceCount) })}
                </Text>
              ) : null}
              {/* LRP-5 §9 — détail confirmées/non réalisées seulement quand pertinent (au moins
                  une échéance non réalisée) : sinon "X/Y échéances" seul suffit, pas besoin de
                  surcharger l'affichage d'un programme sans historique de ce genre. */}
              {skippedOccurrenceCount > 0 ? (
                <Text style={styles.lineSecondary}>
                  {t('recurring_program.occurrences_breakdown', { confirmed: confirmedOccurrenceCount, skipped: skippedOccurrenceCount })}
                </Text>
              ) : null}
              {program.end_mode === 'end_date' && program.end_date ? (
                <Text style={styles.lineSecondary}>{t('recurring_program.until', { date: formatDate(program.end_date, locale) })}</Text>
              ) : null}

              {program.status === 'active' ? (
                <Text style={styles.nextOccurrence}>
                  {t('lrp.next_order_label')} {program.next_occurrence_date ? formatDate(program.next_occurrence_date, locale) : t('lrp.frequency_undefined')}
                  {daysUntilNext != null ? ` (${daysUntilNext >= 0 ? `J-${daysUntilNext}` : `J+${Math.abs(daysUntilNext)}`})` : ''}
                </Text>
              ) : null}

              <View style={styles.actionsRow}>
                {/* Demande utilisateur — "Modifier" déplacé du lien texte en haut de carte vers
                    ce groupe de boutons, même design pilule que pause/réactiver/annuler plutôt
                    qu'un simple lien isolé. */}
                <TouchableOpacity style={styles.actionBtn} onPress={openEditProgram} activeOpacity={0.75}>
                  <Text style={styles.actionBtnText}>{t('common.edit')}</Text>
                </TouchableOpacity>
                {program.status === 'active' ? (
                  <TouchableOpacity style={styles.actionBtn} onPress={() => setPendingAction('pause')} activeOpacity={0.75}>
                    <Text style={styles.actionBtnText}>{t('recurring_program.action_pause')}</Text>
                  </TouchableOpacity>
                ) : null}
                {(program.status === 'paused' || program.status === 'cancelled') ? (
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => { setReactivationMode('preserve_schedule'); setReactivationCustomDate(''); setPendingAction('reactivate') }}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.actionBtnText}>{t('recurring_program.action_reactivate')}</Text>
                  </TouchableOpacity>
                ) : null}
                {program.status !== 'cancelled' && program.status !== 'completed' ? (
                  <TouchableOpacity style={styles.actionBtnDanger} onPress={() => setPendingAction('cancel')} activeOpacity={0.75}>
                    <Text style={styles.actionBtnDangerText}>{t('recurring_program.action_cancel')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </>
          )}

          {pendingAction ? (
            <View style={styles.confirmRow}>
              {pendingAction === 'reactivate' && reactivationBlockedByLimit ? (
                // LRP-5.3 §12 — occurrence_limit déjà consommé : pas de réactivation "comme si
                // de rien n'était". Seule sortie : modifier le programme (bouton déjà présent
                // dans actionsRow, jamais dupliqué ici).
                <Text style={styles.confirmText}>
                  {t('recurring_program.reactivate_limit_reached_title')} {t('recurring_program.reactivate_limit_reached_hint')}
                </Text>
              ) : pendingAction === 'reactivate' ? (
                // LRP-5.3 §1/§14 — choix affiché SYSTÉMATIQUEMENT (même si l'échéance
                // programmée est encore future) : le programme a pu être mis en pause
                // précisément parce que la date devait changer. Réutilise confirmRow/
                // confirmActions existants — aucune nouvelle modal.
                <>
                  <Text style={styles.confirmText}>{t('recurring_program.reactivate_choice_title')}</Text>
                  <TouchableOpacity
                    style={[styles.reactivationOption, reactivationMode === 'preserve_schedule' && styles.reactivationOptionActive]}
                    onPress={() => setReactivationMode('preserve_schedule')}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.radioDot, reactivationMode === 'preserve_schedule' && styles.radioDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reactivationOptionTitle}>{t('recurring_program.reactivate_option_preserve')}</Text>
                      <Text style={styles.reactivationOptionHint}>{t('recurring_program.reactivate_option_preserve_hint')}</Text>
                      <Text style={styles.reactivationOptionDate}>
                        {preserveExceedsEnd
                          ? t('recurring_program.reactivate_option_exceeds_end')
                          : preserveScheduleDate ? t('recurring_program.reactivate_next_date', { date: formatDate(preserveScheduleDate, locale) }) : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reactivationOption, reactivationMode === 'fresh_start' && styles.reactivationOptionActive]}
                    onPress={() => setReactivationMode('fresh_start')}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.radioDot, reactivationMode === 'fresh_start' && styles.radioDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reactivationOptionTitle}>{t('recurring_program.reactivate_option_fresh')}</Text>
                      <Text style={styles.reactivationOptionHint}>{t('recurring_program.reactivate_option_fresh_hint')}</Text>
                      <Text style={styles.reactivationOptionDate}>
                        {freshExceedsEnd
                          ? t('recurring_program.reactivate_option_exceeds_end')
                          : freshStartDate ? t('recurring_program.reactivate_next_date', { date: formatDate(freshStartDate, locale) }) : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reactivationOption, reactivationMode === 'custom_date' && styles.reactivationOptionActive]}
                    onPress={() => setReactivationMode('custom_date')}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.radioDot, reactivationMode === 'custom_date' && styles.radioDotActive]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reactivationOptionTitle}>{t('recurring_program.reactivate_option_custom')}</Text>
                      <Text style={styles.reactivationOptionHint}>{t('recurring_program.reactivate_option_custom_hint')}</Text>
                      {reactivationMode === 'custom_date' ? (
                        <View style={{ marginTop: 8 }}>
                          <DateInput
                            label={t('recurring_program.reactivate_custom_date_label')}
                            value={reactivationCustomDate}
                            onChangeValue={setReactivationCustomDate}
                          />
                          {customDateError ? <Text style={styles.reactivationErrorText}>{customDateError}</Text> : null}
                        </View>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                </>
              ) : (
                <Text style={styles.confirmText}>
                  {pendingAction === 'pause' ? t('recurring_program.confirm_pause') : t('recurring_program.confirm_cancel')}
                </Text>
              )}
              <View style={styles.confirmActions}>
                <TouchableOpacity onPress={() => setPendingAction(null)} disabled={actionBusy}>
                  <Text style={styles.confirmCancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                {pendingAction === 'reactivate' && reactivationBlockedByLimit ? null : (
                  <TouchableOpacity
                    onPress={() => {
                      if (pendingAction === 'reactivate') {
                        const choice: ReactivationChoice = reactivationMode === 'custom_date'
                          ? { mode: 'custom_date', date: customDateTrimmed }
                          : { mode: reactivationMode }
                        handleReactivate(choice)
                      } else {
                        handlePauseOrCancel(pendingAction === 'pause' ? 'paused' : 'cancelled')
                      }
                    }}
                    disabled={actionBusy || reactivationConfirmDisabled}
                  >
                    {actionBusy
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Text style={[styles.confirmConfirmText, reactivationConfirmDisabled && styles.confirmConfirmTextDisabled]}>{t('common.confirm')}</Text>}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>{t('recurring_program.orders_section_title')}</Text>

        {/* LRP-5 §19/§21 — une ÉCHÉANCE (recurring_program_occurrences) n'est PAS une commande :
            "prévue"/"à confirmer" sont désormais des lignes réelles de cette table, jamais un
            simple texte "à venir" comme avant LRP-5. Chaque échéance affiche ses commandes
            réelles éventuelles (0, 1 ou plusieurs), jamais l'inverse. */}
        {occurrences.length === 0 && unmatchedOrders.length === 0 ? (
          <Text style={styles.emptyText}>{t('recurring_program.no_orders')}</Text>
        ) : (
          <>
            {occurrences.map(occurrence => {
              // LRP-5.1 §9/§14/§23 — le statut du PROGRAMME neutralise l'échéance : paused/
              // cancelled/completed → toujours 'scheduled' (jamais 'due'), même si la date est
              // dépassée. Aucune action Confirmer/Non réalisée, un indice contextuel remplace
              // l'ambiguïté ("Prévue — programme en pause").
              const displayStatus = deriveOccurrenceDisplayStatus(occurrence, program.status, todayIso)
              const occurrenceColors = getOccurrenceStatusColors(displayStatus, colors)
              const linkedOrders = orders.filter(o => o.recurring_occurrence_id === occurrence.id)
              const isResolving = resolvingOccurrenceId === occurrence.id
              const inactiveHint = displayStatus === 'scheduled' && program.status !== 'active'
                ? t(`recurring_program.occurrence_inactive_hint_${program.status}`)
                : null
              return (
                <View key={occurrence.id} style={styles.occurrenceCard}>
                  <View style={styles.occurrenceHeaderRow}>
                    <Text style={styles.occurrenceDate}>{formatDate(occurrence.scheduled_date, locale)}</Text>
                    <View style={[styles.occurrenceStatusPill, { backgroundColor: occurrenceColors.bg }]}>
                      <Text style={[styles.occurrenceStatusPillText, { color: occurrenceColors.text }]}>
                        {t(`recurring_program.occurrence_status_${displayStatus}`)}
                      </Text>
                    </View>
                  </View>

                  {inactiveHint ? <Text style={styles.occurrenceHint}>{inactiveHint}</Text> : null}

                  {displayStatus === 'due' ? (
                    <>
                      {/* LRP-5 §5 — jamais "Commande envoyée"/"Commande reçue" : Oryalis n'est
                          connecté à aucun système officiel de l'entreprise, cette échéance n'est
                          qu'une prévision tant qu'elle n'est pas confirmée explicitement. */}
                      <Text style={styles.occurrenceHint}>{t('recurring_program.automatic_order_expected')}</Text>
                      <View style={styles.actionsRow}>
                        <TouchableOpacity style={styles.actionBtn} onPress={() => handleConfirmOccurrence(occurrence)} disabled={isResolving} activeOpacity={0.75}>
                          {isResolving
                            ? <ActivityIndicator size="small" color={colors.text} />
                            : <Text style={styles.actionBtnText}>{t('recurring_program.action_confirm_occurrence')}</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionBtnDanger} onPress={() => handleSkipOccurrence(occurrence)} disabled={isResolving} activeOpacity={0.75}>
                          <Text style={styles.actionBtnDangerText}>{t('recurring_program.action_skip_occurrence')}</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : null}

                  {displayStatus === 'confirmed' || displayStatus === 'skipped' ? (
                    linkedOrders.length > 0 ? (
                      <View style={{ gap: 8 }}>{linkedOrders.map(renderOrderRow)}</View>
                    ) : (
                      // LRP-5 §6/§20 — parfaitement valide : confirmer une échéance ne doit
                      // jamais obliger à renseigner immédiatement produits/prix/quantité.
                      <>
                        <Text style={styles.occurrenceHint}>{t('recurring_program.no_order_details')}</Text>
                        {client ? (
                          <TouchableOpacity onPress={() => router.push(`/(app)/clients/${client.id}/orders` as any)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Text style={styles.addDetailsLink}>{t('recurring_program.add_order_details')}</Text>
                          </TouchableOpacity>
                        ) : null}
                      </>
                    )
                  ) : null}
                </View>
              )
            })}

            {unmatchedOrders.length > 0 ? (
              <View style={styles.occurrenceCard}>
                <Text style={styles.occurrenceGroupTitle}>{t('recurring_program.occurrence_group_unmatched')}</Text>
                <View style={{ gap: 8, marginTop: 8 }}>{unmatchedOrders.map(renderOrderRow)}</View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {editingOrder ? (
        <OrderEditModal
          order={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSave={async (orderId, input) => {
            try {
              await updateOrder(orderId, input)
              await load()
              return true
            } catch {
              return false
            }
          }}
        />
      ) : null}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bgDim },
    content:   { padding: 16, gap: 14, maxWidth: 720, alignSelf: 'center', width: '100%' },

    // LRP-4.7 — même pattern que clients/[id]/index.tsx (navBar/backRow) : le header natif
    // (Stack.Screen) ne s'affiche jamais dans cette app (headerShown:false hérité du <Tabs>
    // racine), la navigation retour doit donc toujours être un élément de page.
    navBar:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12, backgroundColor: colors.bgDim },
    backRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '100%' },
    backArrow: { fontSize: 20, color: colors.text, lineHeight: 24 },
    navTitle:  { fontSize: 15, fontFamily: fonts.semibold, color: colors.text, flexShrink: 1 },

    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 6, borderWidth: 1, borderColor: colors.border },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    title: { fontSize: 18, fontFamily: fonts.bold, color: colors.text },
    clientLink: { fontSize: 13, fontFamily: fonts.medium, color: colors.primary, marginTop: 2 },
    editPanel: { marginTop: 10, gap: 10 },
    editPanelActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 4 },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999 },
    statusPillText: { fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.4 },

    line: { fontSize: 14, fontFamily: fonts.medium, color: colors.text, marginTop: 8 },
    lineSecondary: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
    nextOccurrence: { fontSize: 14, fontFamily: fonts.semibold, color: colors.secondary, marginTop: 8 },

    actionsRow: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap' },
    actionBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.bgDim },
    actionBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    actionBtnDanger: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, backgroundColor: colors.dangerLight },
    actionBtnDangerText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.danger },

    confirmRow: { marginTop: 12, gap: 8, padding: 12, borderRadius: 10, backgroundColor: colors.bgDim },
    confirmText: { fontSize: 13, fontFamily: fonts.body, color: colors.text },
    confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 },
    confirmCancelText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
    confirmConfirmText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    confirmConfirmTextDisabled: { color: colors.textTertiary },

    // LRP-5.2 §13/§14 — choix de reprise : réutilise le style "chip"/radio déjà établi ailleurs
    // dans Oryalis (LrpProgramFields), juste étendu en ligne complète avec un sous-texte — pas
    // une nouvelle architecture de composant, responsive nativement (View/Text empilables).
    reactivationOption: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    reactivationOptionActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    radioDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.border, marginTop: 2 },
    radioDotActive: { borderColor: colors.primary, borderWidth: 5 },
    reactivationOptionTitle: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
    reactivationOptionHint: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 1 },
    reactivationOptionDate: { fontSize: 12, fontFamily: fonts.semibold, color: colors.secondary, marginTop: 4 },
    reactivationErrorText: { fontSize: 12, fontFamily: fonts.medium, color: colors.danger, marginTop: 6 },

    sectionTitle: { fontSize: 12, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },

    // LRP-5 §19 — carte d'ÉCHÉANCE (recurring_program_occurrences), remplace l'ancien groupe
    // "Échéance du..." construit à partir des commandes : la date/statut de l'échéance elle-même
    // est désormais l'élément principal de la carte, les commandes réelles (s'il y en a) sont
    // secondaires, à l'intérieur.
    occurrenceCard: { backgroundColor: colors.card, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 8 },
    occurrenceHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    occurrenceDate: { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
    occurrenceStatusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999 },
    occurrenceStatusPillText: { fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.3 },
    occurrenceHint: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
    addDetailsLink: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
    occurrenceGroupTitle: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },

    orderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.bgDim, borderRadius: 12, padding: 12 },
    orderDate: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    orderProduct: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text, marginTop: 2 },
    orderProductMuted: { color: colors.textTertiary, textDecorationLine: 'line-through' },
    orderStatus: { fontSize: 11, fontFamily: fonts.semibold, marginTop: 2 },
    orderAmount: { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
    orderOpen: { fontSize: 12, fontFamily: fonts.medium, color: colors.primary },

    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
    emptyText: { fontSize: 14, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center', marginTop: 12 },
  })
}
