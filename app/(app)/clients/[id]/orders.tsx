import { useState, useMemo, useCallback, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, TextInput, Switch, Modal, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClient } from '@/features/clients/useClient'
import { useClientOrders } from '@/features/orders/useOrders'
import { updateOrderStatus, confirmOrderFollowups } from '@/features/orders/orderService'
import { fetchOrderItemsForOrders, getOrderReturnStatus } from '@/features/orders/orderItemService'
import { OrderEditModal } from '@/features/orders/OrderEditModal'
import { LrpProgramFields } from '@/features/clients/LrpProgramFields'
import { initialLrpProgramValue, buildProgramActivationPatch, getOrderProgramBadge } from '@/features/clients/lrpProgramService'
import type { LrpProgramValue } from '@/features/clients/lrpProgramService'
import { fetchProgramsForClient, createProgram, updateProgram, completeIfDurationReached } from '@/features/clients/recurringProgramService'
import { linkOrderToOccurrenceForConfirmation } from '@/features/clients/recurringOccurrenceService'
import type { RecurringProgram } from '@/shared/lib/types'
import { OpenActionLink } from '@/shared/components/ui/OpenActionLink'
import { getSuggestedRules, renderRuleTitle, renderRuleDescription } from '@/features/automations/automationService'
import type { AutomationPlan } from '@/features/automations/automationService'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'
import type { OrderType, ModuleKey, OrderListItem, OrderItem } from '@/shared/lib/types'

const ORDER_TYPES: OrderType[] = ['customer', 'personal']

interface PendingOrderContext {
  orderId: string
  clientId: string
  isFirstOrder: boolean
  clientFirstName: string
}

export default function ClientOrdersScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  // LRP-4.6 §9 — le titre doit rendre évident de quel contact il s'agit (page déjà filtrée sur
  // un seul contact) : réutilise le hook déjà existant, aucune nouvelle requête dédiée.
  const { client } = useClient(id)
  const { orders, loading, add, remove, update, cancel, reload, totalAmount } = useClientOrders(id)
  const [editingOrder, setEditingOrder] = useState<OrderListItem | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ id: string; type: 'cancel' | 'delete' } | null>(null)
  useFocusEffect(useCallback(() => { reload() }, [reload]))

  // ORDER-BUSINESS-4.2.1 §6/§7/§8/§10/§12 — même indicateur de retour partiel que la liste
  // globale (app/(app)/orders/index.tsx), même doctrine : lecture GROUPÉE, jamais un fetch par
  // commande, statut dérivé jamais écrit en base. Reclenchée à la fermeture d'OrderEditModal
  // (modale, aucune navigation/focus à intercepter ici) en plus du reload naturel via `orders`.
  const [orderItemsByOrderId, setOrderItemsByOrderId] = useState<Map<string, OrderItem[]>>(new Map())
  const loadOrderItems = useCallback(() => {
    let cancelled = false
    fetchOrderItemsForOrders(orders.map(o => o.id)).then(map => { if (!cancelled) setOrderItemsByOrderId(map) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders])
  useEffect(() => loadOrderItems(), [loadOrderItems])
  // LRP-4.1 §3 — TOUS les programmes actifs du contact (pas "le" programme le plus proche) :
  // 0/1/2+ n'ont pas le même comportement, décidé dans LrpProgramFields et handleToggleLrp.
  const [activePrograms, setActivePrograms] = useState<RecurringProgram[]>([])
  const refreshActivePrograms = useCallback(() => {
    fetchProgramsForClient(id).then(all => setActivePrograms(all.filter(p => p.status === 'active'))).catch(() => setActivePrograms([]))
  }, [id])
  useFocusEffect(useCallback(() => { refreshActivePrograms() }, [refreshActivePrograms]))
  // LRP-4.1 §9 — récupération explicite si la commande a été enregistrée mais le rattachement
  // au programme a échoué : ne recrée jamais une seconde commande, ne retente que la partie
  // manquante (création/mise à jour du programme + pose du lien).
  const [programLinkError, setProgramLinkError] = useState<{ orderId: string; value: LrpProgramValue; orderDate: string } | null>(null)
  const [retryingProgramLink, setRetryingProgramLink] = useState(false)

  async function linkOrderToProgram(orderId: string, targetValue: LrpProgramValue, orderDate: string): Promise<void> {
    const targetProgram = activePrograms.find(p => p.id === targetValue.programId) ?? null
    const patch = buildProgramActivationPatch(targetProgram?.start_date ?? null, targetValue, orderDate)
    // LRP-4.2 §8 — closure_action_key déterministe par commande : un réessai (retryProgramLink)
    // pour CETTE même commande retrouve le programme déjà créé au 1er essai au lieu d'en créer
    // un second, si l'échec s'est produit après la création du programme mais avant la pose du
    // lien orders.recurring_program_id.
    const program = targetProgram
      ? await updateProgram(targetProgram.id, patch)
      : await createProgram(session!.user.id, { client_id: id, ...patch, closure_action_key: `${orderId}:recurring_program` })
    // LRP-5.1 §3 — orchestration UNIQUE : trouve/crée puis confirme l'échéance réellement
    // consommée, ancrée sur orderDate seulement si c'est le tout premier cycle du programme
    // (aucune échéance connue avant) — jamais l'avancement recalculé ici séparément.
    const updatedProgram = await linkOrderToOccurrenceForConfirmation(orderId, program, targetValue, orderDate)
    await completeIfDurationReached(updatedProgram)
    refreshActivePrograms()
  }

  async function retryProgramLink() {
    if (!programLinkError) return
    setRetryingProgramLink(true)
    try {
      await linkOrderToProgram(programLinkError.orderId, programLinkError.value, programLinkError.orderDate)
      setProgramLinkError(null)
    } catch (e) {
      console.error('[orders.retryProgramLink]', e)
    } finally {
      setRetryingProgramLink(false)
    }
  }
  const { isModuleActive, getAutomationDelay, getLrpName } = useAppConfig()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const [showForm, setShowForm]       = useState(false)
  const [date, setDate]               = useState(new Date().toISOString().split('T')[0])
  const [productName, setProductName] = useState('')
  const [amount, setAmount]           = useState('')
  const [isLrp, setIsLrp]             = useState(false)
  const [orderType, setOrderType]     = useState<OrderType>('customer')
  const [notes, setNotes]             = useState('')
  const [saving, setSaving]           = useState(false)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)
  // LRP-3 §9/§12 — jamais pré-coché ni pré-rempli tant que l'utilisateur n'a pas explicitement
  // activé "Commande LRP" : évite tout faux historique et respecte la préférence V1 du brief.
  const [lrpProgramValue, setLrpProgramValue] = useState<LrpProgramValue | null>(null)

  function handleToggleLrp(v: boolean) {
    setIsLrp(v)
    // LRP-4.1 §3 — présélection automatique seulement si exactement 1 programme actif ; sinon
    // (0 ou 2+) le brouillon démarre sur "nouveau programme", l'utilisateur choisit explicitement
    // dans le sélecteur de LrpProgramFields s'il y a 2+ candidats.
    setLrpProgramValue(v ? initialLrpProgramValue(activePrograms.length === 1 ? activePrograms[0] : null, date) : null)
  }

  const [pendingOrder, setPendingOrder]     = useState<PendingOrderContext | null>(null)
  const [followupPlan, setFollowupPlan]     = useState<Record<string, { create: boolean; delayDays: number }>>({})
  const [confirmingPlan, setConfirmingPlan] = useState(false)

  async function handleSave() {
    setErrorMsg(null)
    if (!date.trim()) { setErrorMsg(t('orders.error_date')); return }
    if (!session?.user) return
    setSaving(true)
    try {
      const result = await add(session.user.id, {
        client_id: id,
        product_name: productName.trim() || '—',
        amount: amount ? parseFloat(amount) : null,
        order_date: date,
        is_lrp: isLrp,
        order_type: orderType,
        notes: notes.trim() || null,
        status: 'delivered',
      })
      // LRP-4 — écritures séquentielles, jamais transactionnelles : la commande (source de
      // vérité du chiffre d'affaires) est déjà enregistrée à ce stade quoi qu'il arrive ensuite ;
      // le programme (créé ou mis à jour) et le lien orders.recurring_program_id sont secondaires
      // et best-effort (même doctrine que LRP-3 §22/§25). LRP-4.1 §9 — un échec ici n'est jamais
      // silencieux : mémorisé pour affichage d'un message explicite + retry ciblé (jamais une
      // seconde commande recréée).
      if (result && isLrp && lrpProgramValue && session?.user) {
        try {
          await linkOrderToProgram(result.order.id, lrpProgramValue, date)
        } catch (e) {
          console.error('[orders.recurringProgramUpdate]', e)
          setProgramLinkError({ orderId: result.order.id, value: lrpProgramValue, orderDate: date })
        }
      }

      setShowForm(false)
      setDate(new Date().toISOString().split('T')[0])
      setProductName('')
      setAmount('')
      setIsLrp(false)
      setLrpProgramValue(null)
      setOrderType('customer')
      setNotes('')

      if (result) {
        const rules = getSuggestedRules(result.isFirstOrder).filter(r => isModuleActive(r.moduleKey as ModuleKey))
        if (rules.length > 0) {
          const plan: Record<string, { create: boolean; delayDays: number }> = {}
          rules.forEach(r => { plan[r.id] = { create: true, delayDays: getAutomationDelay(r.id, r.delayDays) } })
          setFollowupPlan(plan)
          setPendingOrder({ orderId: result.order.id, clientId: id, isFirstOrder: result.isFirstOrder, clientFirstName: result.clientFirstName })
        }
      }
    } catch {
      setErrorMsg(t('orders.error_save'))
    } finally {
      setSaving(false)
    }
  }

  function closeFollowupPlan() {
    setPendingOrder(null)
  }

  async function handleConfirmFollowupPlan() {
    if (!pendingOrder || !session?.user) { closeFollowupPlan(); return }
    setConfirmingPlan(true)
    try {
      const plan: AutomationPlan = Object.entries(followupPlan).map(([ruleId, v]) => ({
        ruleId, create: v.create, delayDays: v.delayDays,
      }))
      await confirmOrderFollowups(session.user.id, pendingOrder.clientId, pendingOrder.clientFirstName, pendingOrder.isFirstOrder, plan, null, pendingOrder.orderId)
    } catch (e) {
      console.error('[orders.confirmFollowupPlan]', e)
    } finally {
      setConfirmingPlan(false)
      setPendingOrder(null)
    }
  }

  return (
    <>
      <Stack.Screen options={{
        title: client?.full_name ? `${client.full_name} — ${t('orders.title')}` : t('orders.title'),
        headerBackTitle: '',
      }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── KPI total ──────────────────────────────────────────── */}
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>{t('orders.total_month')}</Text>
          <Text style={styles.kpiValue}>{totalAmount.toFixed(2)}€</Text>
        </View>

        {/* ── LRP-4.1 §9 — commande enregistrée, rattachement au programme en échec ─ */}
        {programLinkError ? (
          <View style={styles.programErrorBanner}>
            <Text style={styles.programErrorText}>{t('lrp.link_failed_warning')}</Text>
            <TouchableOpacity onPress={retryProgramLink} disabled={retryingProgramLink} activeOpacity={0.75}>
              {retryingProgramLink
                ? <ActivityIndicator size="small" color={colors.warning} />
                : <Text style={styles.programErrorRetry}>{t('common.retry')}</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {/* ── Formulaire ajout ───────────────────────────────────── */}
        {!showForm ? (
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)} activeOpacity={0.8}>
            <Text style={styles.addBtnText}>+ {t('orders.add')}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.form}>
            <Text style={styles.formTitle}>{t('orders.add')}</Text>
            <DateInput
              label={t('orders.fields.date')}
              value={date}
              onChangeValue={setDate}
            />
            <Input
              label={t('orders.fields.product_name')}
              value={productName}
              onChangeText={setProductName}
              placeholder="doTERRA Copaiba, kit démarrage…"
            />
            <Input
              label={t('orders.fields.amount')}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t('orders.fields.is_lrp')}</Text>
              <Switch value={isLrp} onValueChange={handleToggleLrp} trackColor={{ true: colors.secondary }} />
            </View>
            {isLrp && isModuleActive('renewals_lrp') && lrpProgramValue ? (
              <LrpProgramFields candidatePrograms={activePrograms} orderDate={date} value={lrpProgramValue} onChange={setLrpProgramValue} />
            ) : null}
            <View style={styles.typeRow}>
              <Text style={styles.switchLabel}>{t('orders.fields.order_type')}</Text>
              <View style={styles.typePicker}>
                {ORDER_TYPES.map(ot => (
                  <TouchableOpacity
                    key={ot}
                    style={[styles.typeChip, orderType === ot && styles.typeChipActive]}
                    onPress={() => setOrderType(ot)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.typeChipText, orderType === ot && styles.typeChipTextActive]}>
                      {t(`orders.order_types.${ot}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TextArea label={t('orders.fields.notes')} value={notes} onChangeText={setNotes} />
            {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); setErrorMsg(null) }}>
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Button label={t('common.save')} onPress={handleSave} loading={saving} />
              </View>
            </View>
          </View>
        )}

        {/* ── Liste ──────────────────────────────────────────────── */}
        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} color={colors.primary} />
        ) : orders.length === 0 ? (
          <Text style={styles.empty}>{t('orders.empty')}</Text>
        ) : (
          orders
            .slice()
            .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())
            .map(order => {
              const isCancelled = !!order.cancelled_at
              const programBadge = getOrderProgramBadge(order, getLrpName())
              // ORDER-BUSINESS-4.2.1 §7/§9 — même priorité que la liste globale : status='returned'
              // toujours prioritaire sur le statut dérivé des lignes.
              const returnStatus = order.status === 'returned' ? 'none' : getOrderReturnStatus(orderItemsByOrderId.get(order.id))
              const hasBadges = isCancelled || order.order_type === 'personal' || order.status === 'returned' || returnStatus !== 'none' || !!programBadge || !!order.appointment_id
              return (
                <TouchableOpacity
                  key={order.id}
                  style={[styles.card, isCancelled && styles.cardCancelled]}
                  onPress={() => { if (!isCancelled) setEditingOrder(order) }}
                  activeOpacity={isCancelled ? 1 : 0.7}
                >
                  {/* LRP-4.6 §2/§3 — la date et le montant vivent désormais sur leur PROPRE ligne,
                      sans partager de conteneur flex avec les badges (l'ancien cardRight
                      empilait verticalement jusqu'à 4 badges, dont un texte long
                      "Abonnement historique" depuis LRP-4.5 : sur une carte étroite, ça
                      réduisait la largeur disponible pour cardLeft au point de faire wrapper la
                      date caractère par caractère). flexShrink:0 sur les deux textes empêche
                      toute compression, quelle que soit la largeur des badges en dessous. */}
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardDate} numberOfLines={1}>
                      {formatDate(order.order_date, locale, { day: '2-digit', month: 'long', year: 'numeric' })}
                    </Text>
                    {order.amount != null ? (
                      <Text style={[styles.cardAmount, isCancelled && styles.cardTextCancelled]} numberOfLines={1}>{order.amount.toFixed(2)}€</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.cardProduct, isCancelled && styles.cardTextCancelled]} numberOfLines={1}>{order.product_name}</Text>
                  {hasBadges ? (
                    <View style={styles.badgeRow}>
                      {isCancelled ? (
                        <View style={[styles.badge, { backgroundColor: colors.bgDim }]}>
                          <Text style={[styles.badgeText, { color: colors.textTertiary }]}>{t('orders.status_cancelled')}</Text>
                        </View>
                      ) : null}
                      {order.order_type === 'personal' ? (
                        <View style={[styles.badge, { backgroundColor: colors.bgDim }]}>
                          <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{t('orders.order_types.personal')}</Text>
                        </View>
                      ) : null}
                      {order.status === 'returned' ? (
                        <View style={[styles.badge, { backgroundColor: colors.dangerLight }]}>
                          <Text style={[styles.badgeText, { color: colors.danger }]}>{t('orders.status_returned')}</Text>
                        </View>
                      ) : returnStatus === 'partial' ? (
                        <View style={[styles.badge, { backgroundColor: colors.dangerLight }]}>
                          <Text style={[styles.badgeText, { color: colors.danger }]}>{t('orders.status_partial_return')}</Text>
                        </View>
                      ) : returnStatus === 'full_pending' ? (
                        <View style={[styles.badge, { backgroundColor: colors.dangerLight }]}>
                          <Text style={[styles.badgeText, { color: colors.danger }]}>{t('orders.status_full_return_pending')}</Text>
                        </View>
                      ) : null}
                      {programBadge ? (
                        <View style={[styles.badge, { backgroundColor: programBadge.kind === 'linked' ? colors.secondaryLight : colors.bgDim }]}>
                          <Text style={[styles.badgeText, { color: programBadge.kind === 'linked' ? colors.secondary : colors.textTertiary }]}>
                            {programBadge.kind === 'linked' ? programBadge.label : t('orders.legacy_program_badge', { name: programBadge.label })}
                          </Text>
                        </View>
                      ) : null}
                      {/* ORDER-APPOINTMENT-TRACE-1 §6/§7 — indicateur discret seulement, jamais
                          un second CTA sur une carte déjà dense : la carte entière ouvre déjà
                          OrderEditModal (onPress ci-dessus), où vit le vrai lien navigable vers
                          le RDV source. */}
                      {order.appointment_id ? (
                        <View style={[styles.badge, { backgroundColor: colors.bgDim }]}>
                          <Text style={[styles.badgeText, { color: colors.textSecondary }]}>{t('orders.from_appointment_badge')}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {order.notes ? <Text style={styles.cardNotes}>{order.notes}</Text> : null}
                  {confirmAction?.id === order.id ? (
                    <View style={styles.inlineConfirmRow}>
                      <Text style={styles.inlineConfirmText}>
                        {confirmAction.type === 'cancel' ? t('orders.cancel_confirm') : t('orders.delete_confirm')}
                      </Text>
                      <View style={styles.cardActions}>
                        <TouchableOpacity onPress={() => setConfirmAction(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Text style={styles.returnBtnText}>{t('common.cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => {
                            if (confirmAction.type === 'cancel') cancel(order.id)
                            else remove(order.id)
                            setConfirmAction(null)
                          }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.deleteBtnText}>{t('common.confirm')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.cardActions}>
                      {/* UI-AFFORDANCE-1 §12/§13 — la carte entière ouvre déjà OrderEditModal
                          (formulaire d'édition direct) au clic : "Modifier", décoratif puisque
                          déjà à l'intérieur de la zone cliquable (interactive=false). Absent si
                          annulée, comme le clic de la carte lui-même (§20 : rien de métier
                          changé, seule l'affordance visuelle). */}
                      {!isCancelled ? (
                        <OpenActionLink label={t('common.edit')} interactive={false} style={styles.orderEditLink} />
                      ) : null}
                      {!isCancelled && order.status !== 'returned' ? (
                        <TouchableOpacity
                          onPress={() => updateOrderStatus(order.id, 'returned').then(reload)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.returnBtnText}>{t('orders.mark_returned')}</Text>
                        </TouchableOpacity>
                      ) : null}
                      {!isCancelled ? (
                        <TouchableOpacity
                          onPress={() => setConfirmAction({ id: order.id, type: 'cancel' })}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.returnBtnText}>{t('orders.cancel_order')}</Text>
                        </TouchableOpacity>
                      ) : null}
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => setConfirmAction({ id: order.id, type: 'delete' })}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={styles.deleteBtnText}>{t('common.delete')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </TouchableOpacity>
              )
            })
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ── Relances à créer suite à la commande ────────────────────── */}
      <Modal visible={!!pendingOrder} transparent animationType="slide" onRequestClose={() => { if (!confirmingPlan) closeFollowupPlan() }}>
        <View style={styles.debriefOverlay}>
          <View style={styles.debriefSheet}>
            <View style={styles.debriefHandle} />
            <View style={styles.debriefHeader}>
              <Text style={styles.debriefTitle}>{t('orders.followups_title')}</Text>
              <TouchableOpacity
                onPress={() => { if (!confirmingPlan) closeFollowupPlan() }}
                disabled={confirmingPlan}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.debriefClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {pendingOrder && getSuggestedRules(pendingOrder.isFirstOrder)
                .filter(rule => followupPlan[rule.id] !== undefined)
                .map(rule => {
                  const item = followupPlan[rule.id]
                  return (
                    <View key={rule.id} style={styles.followupPlanRow}>
                      <TouchableOpacity
                        style={styles.taskCheck}
                        onPress={() => setFollowupPlan(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], create: !prev[rule.id].create } }))}
                      >
                        <View style={[styles.taskCheckBox, item.create && { backgroundColor: colors.success, borderColor: colors.success }]}>
                          {item.create && <Text style={styles.taskCheckMark}>✓</Text>}
                        </View>
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.followupPlanLabel, !item.create && { color: colors.textTertiary }]}>
                          {renderRuleTitle(rule, pendingOrder.clientFirstName, item.delayDays)}
                        </Text>
                        <Text style={styles.followupPlanDesc}>{renderRuleDescription(rule, item.delayDays)}</Text>
                      </View>
                      {item.create && (
                        <View style={styles.followupPlanDelay}>
                          <Text style={styles.followupPlanDelayLabel}>{t('orders.followup_days_label')}</Text>
                          <TextInput
                            style={styles.followupPlanDelayInput}
                            value={String(item.delayDays)}
                            onChangeText={(v) => {
                              const n = parseInt(v, 10)
                              setFollowupPlan(prev => ({ ...prev, [rule.id]: { ...prev[rule.id], delayDays: Number.isFinite(n) && n >= 0 ? n : 0 } }))
                            }}
                            keyboardType="number-pad"
                          />
                        </View>
                      )}
                    </View>
                  )
                })}
            </ScrollView>

            <TouchableOpacity
              style={[styles.debriefDoneBtn, confirmingPlan && { opacity: 0.6 }]}
              onPress={handleConfirmFollowupPlan}
              disabled={confirmingPlan}
              activeOpacity={0.85}
            >
              {confirmingPlan
                ? <ActivityIndicator color="#ffffff" size="small" />
                : <Text style={styles.debriefDoneBtnText}>{t('orders.followups_confirm')}</Text>
              }
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {editingOrder ? (
        <OrderEditModal
          order={editingOrder}
          onClose={() => { setEditingOrder(null); loadOrderItems() }}
          onSave={update}
        />
      ) : null}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },
  content:   { padding: 16, gap: 12, maxWidth: 720, alignSelf: 'center', width: '100%' },

  kpiCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiLabel: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  kpiValue: { fontSize: 22, fontFamily: fonts.bold, color: colors.primary },

  programErrorBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: colors.warningLight, borderRadius: 12, padding: 12 },
  programErrorText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.warning },
  programErrorRetry: { fontSize: 13, fontFamily: fonts.bold, color: colors.warning },

  addBtn: {
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.primary },

  form: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  formTitle:   { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  switchRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  switchLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.text, flex: 1 },
  typeRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  typePicker:  { flexDirection: 'row', gap: 8 },
  typeChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  typeChipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  typeChipText:       { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  typeChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
  error:       { fontSize: 13, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
  formBtns:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:   { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },

  empty: { textAlign: 'center', color: colors.textTertiary, fontSize: 14, fontFamily: fonts.body, marginTop: 32 },

  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  cardCancelled: { opacity: 0.55 },
  // LRP-4.6 §3/§21 — date et montant sur une ligne dédiée, jamais partagée avec des badges de
  // largeur variable : flexShrink:0 sur les deux textes interdit toute compression, quelle que
  // soit la largeur de la carte (desktop large → mobile étroit).
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  cardDate:   { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, flexShrink: 0 },
  cardProduct:{ fontSize: 14, fontFamily: fonts.semibold, color: colors.text, marginTop: 2 },
  cardTextCancelled: { textDecorationLine: 'line-through' },
  cardAmount: { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flexShrink: 0 },
  cardNotes:  { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 18 },

  badgeRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  badge:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontFamily: fonts.bold },

  cardActions:   { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 },
  orderEditLink: { marginRight: 'auto' },
  deleteBtn:     { alignSelf: 'flex-end' },
  deleteBtnText: { fontSize: 11, fontFamily: fonts.medium, color: colors.danger },
  returnBtnText: { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary },
  inlineConfirmRow:  { gap: 6, alignItems: 'flex-end' },
  inlineConfirmText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, alignSelf: 'stretch' },

  // ── Modale "Relances à créer" ─────────────────────────────────────────────
  debriefOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  debriefSheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 32, maxHeight: '85%',
  },
  debriefHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
  debriefHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  debriefTitle:  { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
  debriefClose:  { fontSize: 16, color: colors.textTertiary, padding: 4 },
  debriefDoneBtn:     { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  debriefDoneBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#ffffff' },

  taskCheck:    { padding: 2, marginTop: 2 },
  taskCheckBox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  taskCheckMark:{ fontSize: 11, color: '#ffffff', fontFamily: fonts.bold },

  followupPlanRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  followupPlanLabel:      { fontSize: 13, fontFamily: fonts.medium, color: colors.text },
  followupPlanDesc:       { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 1 },
  followupPlanDelay:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  followupPlanDelayLabel: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  followupPlanDelayInput: { fontSize: 13, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bgDim, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, width: 48, textAlign: 'center' },
  })
}
