import { useState, useMemo, useEffect } from 'react'
import { View, Text, TouchableOpacity, TextInput, Modal, Switch, StyleSheet, ActivityIndicator } from 'react-native'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react-native'
import type { OrderListItem, OrderType, OrderProduct, RecurringProgram, OrderItemMetricSnapshot } from '@/shared/lib/types'
import type { OrderEditInput } from './orderService'
import { computeOrderProductsTotal, dissociateOrderFromProgram, updateOrderRecurringProgram, updateOrderStatus } from './orderService'
import { getOrderItemsHybrid, generateOrderItemId, getNetQuantity } from './orderItemService'
import { fetchMetricSnapshotsForOrderItems, computeMlmTotals } from '@/features/catalogs/mlmMetricService'
import { CatalogProductPicker } from '@/features/catalogs/CatalogProductPicker'
import { OrderItemReturnModal } from './OrderItemReturnModal'
import { formatProgramTitle } from '@/features/clients/lrpProgramService'
import { fetchProgramsForClient } from '@/features/clients/recurringProgramService'
import { recordHistoricalOccurrence } from '@/features/clients/recurringOccurrenceService'
import { Input } from '@/shared/components/ui/Input'
import { DateInput } from '@/shared/components/ui/DateInput'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { formatDate } from '@/shared/lib/dateFormat'

const ORDER_TYPES: OrderType[] = ['customer', 'personal']

// ORDER-BUSINESS-2.2 §4/§6 — garantit l'invariant "toute ligne dans productLines porte un id
// stable", quelle que soit son origine (order_items déjà en base, repli JSON legacy, ligne tout
// juste ajoutée) : élimine le scénario où une ligne sans id survivrait à un échec de
// sauvegarde puis serait réinsérée en double lors d'un nouvel essai (voir saveOrderItems).
function ensureLineIds(lines: OrderProduct[]): OrderProduct[] {
  return lines.map(line => line.id ? line : { ...line, id: generateOrderItemId() })
}

interface OrderEditModalProps {
  order: OrderListItem
  onClose: () => void
  onSave: (id: string, input: OrderEditInput) => Promise<boolean>
}

// Composant partagé entre la vue commandes globale (orders/index.tsx) et la vue commandes
// d'un contact (clients/[id]/orders.tsx) — une seule implémentation d'édition, pas deux qui
// dériveraient (même principe que outcomePlanSections côté RDV).
export function OrderEditModal({ order, onClose, onSave }: OrderEditModalProps) {
  const { t, i18n } = useTranslation()
  const { getLrpName } = useAppConfig()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  const [date, setDate]               = useState(order.order_date.split('T')[0])
  const [productName, setProductName] = useState(order.product_name)
  const [amount, setAmount]           = useState(order.amount != null ? String(order.amount) : '')
  const [isLrp, setIsLrp]             = useState(order.is_lrp)
  const [orderType, setOrderType]     = useState<OrderType>(order.order_type)
  const [notes, setNotes]             = useState(order.notes ?? '')
  const [saving, setSaving]           = useState(false)
  const [errorMsg, setErrorMsg]       = useState<string | null>(null)
  // LRP-4.1 §4 — un lien programme ne se rompt jamais via le toggle is_lrp, uniquement via
  // cette action explicite et confirmée.
  const [confirmDissociate, setConfirmDissociate] = useState(false)
  const [dissociating, setDissociating] = useState(false)

  async function handleDissociate() {
    setDissociating(true)
    try {
      await dissociateOrderFromProgram(order.id)
      onClose()
    } catch {
      setErrorMsg(t('orders.error_save'))
      setDissociating(false)
      setConfirmDissociate(false)
    }
  }

  // LRP-4.6 §11/§12/§13/§14, étendu LRP-5 §24 — rattachement MANUEL d'une commande legacy
  // (is_lrp=true, recurring_program_id=null) à un programme EXISTANT du même contact.
  // Entièrement explicite : aucune présélection auto d'un programme "le plus proche", aucune
  // date d'échéance devinée silencieusement (order_date n'est qu'une SUGGESTION éditable,
  // jamais la vérité métier appliquée sans confirmation). recordHistoricalOccurrence
  // (recurringOccurrenceService.ts) enregistre l'échéance historique comme 'confirmed' SANS
  // jamais toucher le calendrier du programme (next_occurrence_date/occurrence_limit/status) —
  // généralise à LRP-5 la même doctrine déjà tranchée en LRP-4.6 pour completeIfDurationReached :
  // un rattachement historique ne doit jamais déclencher silencieusement l'avancement ou la
  // complétion d'un programme actif.
  const [attachOpen, setAttachOpen] = useState(false)
  const [attachLoading, setAttachLoading] = useState(false)
  const [attachPrograms, setAttachPrograms] = useState<RecurringProgram[]>([])
  const [attachProgramId, setAttachProgramId] = useState<string | null>(null)
  const [attachOccurrenceDate, setAttachOccurrenceDate] = useState(order.order_date.split('T')[0])
  const [attachSaving, setAttachSaving] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)

  async function openAttach() {
    setAttachOpen(true)
    setAttachLoading(true)
    setAttachError(null)
    try {
      const programs = await fetchProgramsForClient(order.client_id)
      setAttachPrograms(programs)
      // §12 — "si un seul programme : le proposer" = présélectionné mais toujours soumis à
      // confirmation explicite ci-dessous, jamais appliqué sans clic. 2+ programmes : aucune
      // présélection (l'utilisateur choisit).
      setAttachProgramId(programs.length === 1 ? programs[0].id : null)
    } catch {
      setAttachError(t('orders.error_save'))
    } finally {
      setAttachLoading(false)
    }
  }

  async function confirmAttach() {
    if (!attachProgramId || !attachOccurrenceDate.trim()) return
    const targetProgram = attachPrograms.find(p => p.id === attachProgramId)
    if (!targetProgram) return
    setAttachSaving(true)
    setAttachError(null)
    try {
      const scheduledDate = attachOccurrenceDate.trim()
      const occurrence = await recordHistoricalOccurrence(targetProgram, scheduledDate)
      await updateOrderRecurringProgram(order.id, attachProgramId, occurrence.id, scheduledDate)
      onClose()
    } catch {
      setAttachError(t('orders.error_save'))
      setAttachSaving(false)
    }
  }

  // ORDER-SYNC-1 §3/§4 — une commande créée avec des lignes structurées (product_id/name/qty/
  // price, ex. depuis la clôture "Vente réalisée" d'un RDV) doit rester éditable sans jamais
  // détruire cette structure : le champ "Produit / description" concaténé ne suffit pas comme
  // source d'édition dans ce cas (audit confirmé — voir rapport). Une commande sans lignes
  // (créée manuellement depuis Commandes) garde son comportement historique inchangé.
  const isStructured = (order.products?.length ?? 0) > 0
  // ORDER-BUSINESS-2.2 §4/§6 — ensureLineIds garantit qu'AUCUNE ligne n'entre jamais dans
  // productLines sans id stable, y compris celles chargées depuis le JSON legacy avant le
  // premier order_items — élimine le scénario "nouvelle ligne sans id, retry après échec,
  // second INSERT" dès la création de la ligne, pas seulement pour les lignes ajoutées par
  // l'utilisateur (voir generateOrderItemId, saveOrderItems).
  const [productLines, setProductLines] = useState<OrderProduct[]>(() => ensureLineIds(order.products ?? []))
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)
  const computedTotal = computeOrderProductsTotal(productLines)

  // ORDER-BUSINESS-3.4 §31 — affichage minimal de vérification, pas l'UX "Mes valeurs MLM".
  // Chargement groupé (1 requête), reclenché uniquement quand l'ENSEMBLE des id de lignes change
  // (ajout/suppression/chargement initial) — jamais à chaque frappe sur quantité/prix, qui ne
  // change ni les id ni les snapshots (§9/§10/§11).
  const [mlmSnapshotsByLineId, setMlmSnapshotsByLineId] = useState<Map<string, OrderItemMetricSnapshot[]>>(new Map())
  const lineIdsKey = productLines.map(p => p.id ?? '').join(',')
  useEffect(() => {
    const ids = productLines.map(p => p.id).filter((id): id is string => !!id)
    if (ids.length === 0) { setMlmSnapshotsByLineId(new Map()); return }
    let cancelled = false
    fetchMetricSnapshotsForOrderItems(ids).then(map => { if (!cancelled) setMlmSnapshotsByLineId(map) }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineIdsKey])
  const mlmTotals = useMemo(() => computeMlmTotals(productLines, mlmSnapshotsByLineId), [productLines, mlmSnapshotsByLineId])

  // ORDER-BUSINESS-4.2 §9 — un retour ne peut être enregistré que sur une ligne RÉELLEMENT déjà
  // en base (order_items existant) : impossible de retourner une ligne tout juste ajoutée dans
  // cette session d'édition et pas encore sauvegardée. Capturé à partir du résultat de
  // `getOrderItemsHybrid` AVANT `ensureLineIds` (qui assignerait un id à une ligne repli JSON
  // sans que cette ligne existe réellement dans order_items).
  const [persistedLineIds, setPersistedLineIds] = useState<Set<string>>(new Set())
  const [returnModalLine, setReturnModalLine] = useState<{ id: string; name: string; qty: number; returnedQty: number } | null>(null)
  const [allReturnedBannerDismissed, setAllReturnedBannerDismissed] = useState(false)
  const [markingReturned, setMarkingReturned] = useState(false)

  // ORDER-BUSINESS-2 §21/§22 — remplace les lignes (mêmes données, order.products déjà affiché
  // ci-dessus le temps du chargement) par leur équivalent order_items, PORTEUR d'un id stable :
  // sans cet id, chaque sauvegarde recréerait toutes les lignes (perte d'identité, contraire à
  // §22 — retours partiels/snapshots MLM futurs en dépendent). Pas d'effet pour une commande
  // simple (isStructured=false) : ce mode n'édite jamais `productLines`.
  useEffect(() => {
    if (!isStructured) return
    let cancelled = false
    getOrderItemsHybrid(order).then(lines => {
      if (cancelled) return
      setPersistedLineIds(new Set(lines.filter(l => l.id).map(l => l.id as string)))
      if (lines.length > 0) setProductLines(ensureLineIds(lines))
    }).catch(() => {})
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id])

  // ORDER-BUSINESS-4.2 §13/§14 — une quantité commandée ne peut jamais descendre sous la
  // quantité déjà retournée (la DB le refuserait de toute façon via son CHECK) : ne bloque PAS la
  // frappe elle-même (l'utilisateur reste libre de corriger la commande initiale, §14), mais
  // affiche une erreur claire sous la ligne concernée et bloque la sauvegarde tant qu'elle existe.
  const lineQuantityErrors = useMemo(() => {
    const map = new Map<number, string>()
    productLines.forEach((p, i) => {
      if ((p.returnedQty ?? 0) > p.qty) map.set(i, t('orders.return_error_qty_below_returned'))
    })
    return map
  }, [productLines, t])

  function updateLine(i: number, patch: Partial<OrderProduct>) {
    setProductLines(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p))
  }
  function removeLine(i: number) {
    setProductLines(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleReturnSaved(lineId: string, newReturnedQty: number) {
    setProductLines(prev => prev.map(p => p.id === lineId ? { ...p, returnedQty: newReturnedQty } : p))
    setAllReturnedBannerDismissed(false)
  }

  // ORDER-BUSINESS-4.2 §23 — proposition UI simple, JAMAIS un changement automatique de
  // `orders.status` : uniquement les lignes RÉELLEMENT persistées comptent (une ligne tout juste
  // ajoutée, non sauvegardée, n'a pas de sens ici), et il en faut au moins une pour proposer quoi
  // que ce soit (une commande sans ligne persistée n'est jamais "entièrement retournée").
  const persistedLines = productLines.filter(p => p.id && persistedLineIds.has(p.id))
  const allLinesReturned = persistedLines.length > 0
    && persistedLines.every(p => getNetQuantity(p.qty, p.returnedQty ?? 0) === 0)

  async function handleMarkOrderReturned() {
    setMarkingReturned(true)
    try {
      await updateOrderStatus(order.id, 'returned')
      onClose()
    } catch {
      setErrorMsg(t('orders.error_save'))
    } finally {
      setMarkingReturned(false)
    }
  }
  // §4 — product_id conservé tel quel pour une ligne catalogue existante (updateLine ne touche
  // jamais ce champ lors d'une édition de quantité/prix) ; §5 — nouvelle ligne catalogue avec
  // son product_id réel, jamais fabriqué. ORDER-BUSINESS-2.2 §4 — id généré immédiatement à la
  // création de la ligne, jamais laissé vide en attendant un aller-retour serveur : un retry
  // après échec de sauvegarde rejoue le même id, jamais un second INSERT (voir saveOrderItems).
  function addCatalogLine(result: { productId: string; productName: string; retailPriceEur: number | null }) {
    setProductLines(prev => [...prev, { id: generateOrderItemId(), product_id: result.productId, name: result.productName, qty: 1, price: result.retailPriceEur ?? undefined }])
    setShowCatalogPicker(false)
  }
  // §5 — produit libre : jamais de product_id fabriqué (comportement identique au flux RDV).
  function addFreeLine() {
    setProductLines(prev => [...prev, { id: generateOrderItemId(), name: '', qty: 1 }])
  }

  // LRP-4.1 §4 — une commande liée à un programme est TOUJOURS considérée récurrente : même si
  // le toggle est désactivé (donc figé) pendant l'édition, la sauvegarde ne peut jamais écrire
  // is_lrp=false tant que le lien existe encore (évite l'état contradictoire visé par le brief).
  const effectiveIsLrp = order.recurring_program_id ? true : isLrp

  async function handleSave() {
    setErrorMsg(null)
    if (!date.trim()) { setErrorMsg(t('orders.error_date')); return }
    if (isStructured && productLines.length === 0) { setErrorMsg(t('orders.error_products_required')); return }
    // ORDER-BUSINESS-4.2 §13 — filet de sécurité avant sauvegarde (en plus du CHECK DB) : jamais
    // une quantité commandée inférieure à sa quantité déjà retournée.
    if (isStructured && lineQuantityErrors.size > 0) { setErrorMsg(t('orders.return_error_qty_below_returned')); return }
    setSaving(true)
    try {
      const ok = isStructured
        ? await onSave(order.id, {
            // §9/§10 — amount/product_name ne sont jamais transmis ici : updateOrder() les
            // recalcule lui-même depuis `products`, seule logique officielle.
            order_date: date,
            is_lrp: effectiveIsLrp,
            order_type: orderType,
            notes: notes.trim() || null,
            products: productLines.map(p => ({ ...p, qty: Math.max(1, p.qty) })),
          })
        : await onSave(order.id, {
            product_name: productName.trim() || '—',
            amount: amount ? parseFloat(amount) : null,
            order_date: date,
            is_lrp: effectiveIsLrp,
            order_type: orderType,
            notes: notes.trim() || null,
          })
      if (ok) onClose()
      else setErrorMsg(t('orders.error_save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Modal visible transparent animationType="slide" onRequestClose={() => { if (!saving) onClose() }}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>{t('orders.edit_title')}</Text>
              <TouchableOpacity onPress={() => { if (!saving) onClose() }} disabled={saving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.close}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* LRP-4.5 §8 — contexte contact toujours visible en tête de modale (déjà chargé via
                la jointure client:clients(full_name) de ORDER_LIST_COLS, aucune requête
                supplémentaire) : évite de perdre de vue "à qui appartient cette commande" une
                fois dans le formulaire d'édition. */}
            {order.client?.full_name ? (
              <TouchableOpacity
                style={styles.contactBlock}
                onPress={() => { onClose(); router.push(`/(app)/clients/${order.client_id}` as any) }}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionCaption}>{t('orders.contact_section_title')}</Text>
                  <Text style={styles.contactName} numberOfLines={1}>{order.client.full_name}</Text>
                </View>
                <Text style={styles.contactOpenAction}>{t('common.open')} ›</Text>
              </TouchableOpacity>
            ) : null}

            {/* ORDER-APPOINTMENT-TRACE-1 — traçabilité du RDV source (appointment_id, Lot 1.2),
                déjà en base mais jamais exposée jusqu'ici. Lecture seule, aucune donnée de
                commande modifiée. `source_appointment` vient de la même jointure groupée que
                client/recurring_program ci-dessus (ORDER_LIST_COLS), aucune requête
                supplémentaire. Si le RDV est absent malgré appointment_id renseigné (cas
                structurellement rare : la FK est ON DELETE SET NULL), affichage honnête plutôt
                que de risquer un crash ou un lien mort — jamais de "undefined"/séparateur
                orphelin si le titre est vide (§3). */}
            {order.appointment_id ? (
              <View style={styles.programLinkBlock}>
                <Text style={styles.sectionCaption}>{t('orders.source_appointment_title')}</Text>
                {order.source_appointment ? (
                  <TouchableOpacity
                    style={styles.programLinkRow}
                    onPress={() => {
                      onClose()
                      router.push(`/(app)/appointments/${order.source_appointment!.id}?returnTo=${encodeURIComponent(`/(app)/clients/${order.client_id}/orders`)}` as any)
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.programLinkLabel} numberOfLines={1}>
                        {formatDate(order.source_appointment.start_at, locale)}
                      </Text>
                      {order.source_appointment.title ? (
                        <Text style={styles.programOccurrenceText} numberOfLines={1}>{order.source_appointment.title}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.programLinkAction}>{t('orders.view_appointment')} ›</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.legacyProgramSub}>{t('orders.source_appointment_unavailable')}</Text>
                )}
              </View>
            ) : null}

            <DateInput label={t('orders.fields.date')} value={date} onChangeValue={setDate} />

            {isStructured ? (
              <View style={styles.productLinesBlock}>
                <Text style={styles.sectionLabel}>{t('orders.fields.product_name')}</Text>
                {productLines.map((p, i) => {
                  const snapshots = p.id ? mlmSnapshotsByLineId.get(p.id) : undefined
                  return (
                  <View key={i} style={styles.productLineGroup}>
                    <View style={styles.productLineRow}>
                      <TextInput
                        style={[styles.lineInput, { flex: 1 }]}
                        value={p.name}
                        onChangeText={(v) => updateLine(i, { name: v })}
                        placeholder={t('appointments.outcome_sale_product_placeholder')}
                        placeholderTextColor={colors.textTertiary}
                      />
                      <TextInput
                        style={[styles.lineInput, { width: 48 }]}
                        value={p.qty > 0 ? String(p.qty) : ''}
                        onChangeText={(v) => updateLine(i, { qty: parseInt(v.replace(/\D/g, ''), 10) || 0 })}
                        keyboardType="number-pad"
                      />
                      <TextInput
                        style={[styles.lineInput, { width: 84 }]}
                        value={p.price != null ? String(p.price) : ''}
                        onChangeText={(v) => {
                          const n = parseFloat(v.replace(',', '.'))
                          updateLine(i, { price: v.trim() === '' ? undefined : (Number.isFinite(n) && n >= 0 ? n : p.price) })
                        }}
                        placeholder={t('catalog.price_not_set')}
                        placeholderTextColor={colors.textTertiary}
                        keyboardType="decimal-pad"
                      />
                      <TouchableOpacity onPress={() => removeLine(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <X size={16} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                    {lineQuantityErrors.has(i) ? <Text style={styles.rowErrorText}>{lineQuantityErrors.get(i)}</Text> : null}
                    {/* ORDER-BUSINESS-3.4 §31 — affichage minimal, pas l'UX "Mes valeurs MLM" :
                        une ligne compacte par métrique déjà snapshotée pour CETTE ligne (rien si
                        aucune, ex. ligne historique sans snapshot ou produit libre — §19).
                        ORDER-BUSINESS-4.2 §15/§17 — return-aware : gross/returned/net affichés
                        uniquement si un retour existe réellement sur CETTE ligne, sinon inchangé
                        (jamais "PV : 60 commandés · 0 retournés · 60 nets" pour le cas courant). */}
                    {snapshots && snapshots.length > 0 ? (
                      <View style={styles.mlmLineRow}>
                        {snapshots.map(s => {
                          const returnedQty = p.returnedQty ?? 0
                          if (returnedQty > 0) {
                            const gross = s.unit_value * p.qty
                            const returned = s.unit_value * returnedQty
                            const net = s.unit_value * getNetQuantity(p.qty, returnedQty)
                            return (
                              <Text key={s.id} style={styles.mlmLineText}>
                                {t('appointments.mlm_snapshot_line_return', {
                                  label: s.metric_label_snapshot, gross: gross.toString(), returned: returned.toString(), net: net.toString(),
                                })}
                              </Text>
                            )
                          }
                          return (
                            <Text key={s.id} style={styles.mlmLineText}>
                              {p.qty > 1
                                ? t('appointments.mlm_snapshot_line_breakdown', { label: s.metric_label_snapshot, total: (s.unit_value * p.qty).toString(), unit: s.unit_value.toString(), qty: p.qty })
                                : t('appointments.mlm_snapshot_line', { label: s.metric_label_snapshot, total: s.unit_value.toString() })}
                            </Text>
                          )
                        })}
                      </View>
                    ) : null}
                    {/* ORDER-BUSINESS-4.2 §9 — action de retour, disponible uniquement pour une
                        ligne RÉELLEMENT persistée (§ voir persistedLineIds ci-dessus). */}
                    {p.id && persistedLineIds.has(p.id) ? (
                      (p.returnedQty ?? 0) > 0 ? (
                        <View style={styles.returnRow}>
                          <Text style={styles.returnSummaryText}>
                            {t('orders.return_summary', { qty: p.qty, returned: p.returnedQty, net: getNetQuantity(p.qty, p.returnedQty ?? 0) })}
                          </Text>
                          <TouchableOpacity onPress={() => setReturnModalLine({ id: p.id as string, name: p.name, qty: p.qty, returnedQty: p.returnedQty ?? 0 })}>
                            <Text style={styles.returnLinkText}>{t('orders.return_edit_button')}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.returnBtn}
                          onPress={() => setReturnModalLine({ id: p.id as string, name: p.name, qty: p.qty, returnedQty: 0 })}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.returnBtnText}>{t('orders.return_button')}</Text>
                        </TouchableOpacity>
                      )
                    ) : null}
                  </View>
                  )
                })}
                <View style={styles.productLineActions}>
                  <TouchableOpacity style={styles.lineAddBtn} onPress={() => setShowCatalogPicker(true)} activeOpacity={0.8}>
                    <Text style={styles.lineAddBtnText}>{t('appointments.outcome_sale_add_catalog')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.lineAddBtn} onPress={addFreeLine} activeOpacity={0.8}>
                    <Text style={styles.lineAddBtnText}>{t('appointments.outcome_sale_add_free')}</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.totalText}>{t('appointments.order_total_label')} : {computedTotal.toFixed(2)} €</Text>
                {mlmTotals.length > 0 ? (
                  <View style={styles.mlmTotalsBlock}>
                    {mlmTotals.map(mt => (
                      <Text key={mt.key} style={styles.mlmTotalText}>
                        {mt.returned > 0
                          ? t('appointments.mlm_total_line_return', { label: mt.label, gross: mt.gross.toString(), returned: mt.returned.toString(), net: mt.net.toString() })
                          : t('appointments.mlm_total_line', { label: mt.label, total: mt.net.toString() })}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {/* ORDER-BUSINESS-4.2 §23 — proposition UI simple, jamais un changement
                    automatique de orders.status. Uniquement si la commande n'est pas déjà
                    marquée retournée (§25) et que l'utilisateur n'a pas déjà choisi "Plus tard"
                    dans cette session d'édition. */}
                {allLinesReturned && order.status !== 'returned' && !allReturnedBannerDismissed ? (
                  <View style={styles.allReturnedBanner}>
                    <Text style={styles.allReturnedText}>{t('orders.all_returned_banner')}</Text>
                    <View style={styles.allReturnedActions}>
                      <TouchableOpacity onPress={() => setAllReturnedBannerDismissed(true)} disabled={markingReturned}>
                        <Text style={styles.cancelBtnText}>{t('orders.all_returned_later')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleMarkOrderReturned} disabled={markingReturned}>
                        {markingReturned
                          ? <ActivityIndicator size="small" color={colors.danger} />
                          : <Text style={styles.allReturnedConfirmText}>{t('orders.all_returned_confirm')}</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}
              </View>
            ) : (
              <>
                <Input label={t('orders.fields.product_name')} value={productName} onChangeText={setProductName} />
                <Input label={t('orders.fields.amount')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
              </>
            )}

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>{t('orders.fields.is_lrp')}</Text>
              <Switch
                value={effectiveIsLrp}
                onValueChange={setIsLrp}
                disabled={!!order.recurring_program_id}
                trackColor={{ true: colors.secondary }}
              />
            </View>
            {/* LRP-4.1 §4 — le toggle ci-dessus est désactivé et figé sur "actif" tant que le
                lien existe : la seule façon de contredire la relation est cette action
                explicite et confirmée, jamais un simple appui sur le toggle. */}
            {order.recurring_program_id ? (
              <View style={styles.programLinkBlock}>
                <Text style={styles.sectionCaption}>{t('orders.recurring_program_section_title')}</Text>
                <TouchableOpacity
                  style={styles.programLinkRow}
                  onPress={() => { onClose(); router.push(`/(app)/recurring-programs/${order.recurring_program_id}` as any) }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.programLinkLabel} numberOfLines={1}>
                    {formatProgramTitle(getLrpName(), order.recurring_program?.label)}
                  </Text>
                  <Text style={styles.programLinkAction}>{t('common.open')} ›</Text>
                </TouchableOpacity>
                {/* LRP-4.5 §9 / LRP-OCCURRENCE-LINK-2 — échéance consommée par CETTE commande, si
                    connue (une commande complémentaire n'en pose pas forcément une nouvelle) :
                    distincte de la date de commande éditable ci-dessus. Source de vérité UNIQUE :
                    recurring_occurrence (jointure sur recurring_occurrence_id) — jamais
                    recurring_occurrence_date, snapshot legacy qui peut exister sans qu'aucune
                    échéance réelle ne soit rattachée (voir audit LRP-OCCURRENCE-LINK-1). Un
                    programme lié sans occurrence réelle affiche un message honnête plutôt que de
                    laisser croire à un rattachement qui n'existe pas. */}
                {order.recurring_occurrence?.scheduled_date ? (
                  <Text style={styles.programOccurrenceText}>
                    {t('orders.occurrence_label')} {formatDate(order.recurring_occurrence.scheduled_date, locale)}
                  </Text>
                ) : (
                  <Text style={styles.programOccurrenceText}>{t('orders.occurrence_not_linked')}</Text>
                )}
                {confirmDissociate ? (
                  <View style={styles.dissociateConfirmRow}>
                    <Text style={styles.dissociateConfirmText}>{t('orders.dissociate_confirm')}</Text>
                    <View style={styles.dissociateConfirmActions}>
                      <TouchableOpacity onPress={() => setConfirmDissociate(false)} disabled={dissociating}>
                        <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={handleDissociate} disabled={dissociating}>
                        <Text style={styles.dissociateConfirmBtn}>{t('common.confirm')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <TouchableOpacity onPress={() => setConfirmDissociate(true)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.dissociateLink}>{t('orders.dissociate_from_program')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : order.is_lrp ? (
              // LRP-4.5 §10 — commande legacy (is_lrp=true, jamais rattachée à un programme
              // identifié) : information compacte, JAMAIS de lien "Ouvrir le programme" (il
              // n'existe rien à ouvrir) et aucune action de dissociation (rien à dissocier).
              <View style={styles.programLinkBlock}>
                <Text style={styles.sectionCaption}>{t('orders.recurring_program_section_title')}</Text>
                <View style={styles.legacyProgramRow}>
                  <Text style={styles.legacyProgramLabel}>{t('orders.legacy_program_badge', { name: getLrpName() })}</Text>
                  <Text style={styles.legacyProgramSub}>{t('orders.legacy_program_no_link')}</Text>
                </View>
                {/* LRP-4.6 §11 — seule façon de rattacher une commande legacy à un programme
                    connu : entièrement explicite, jamais automatique (voir openAttach/
                    confirmAttach ci-dessus). */}
                {!attachOpen ? (
                  <TouchableOpacity onPress={openAttach} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.attachLink}>{t('orders.attach_to_program')}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.attachPanel}>
                    {attachLoading ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : attachPrograms.length === 0 ? (
                      // §12 — "si aucun programme : afficher une information claire" — jamais de
                      // création de programme depuis cet écran (hors doctrine : un programme ne
                      // naît que via un flux de commande ou d'édition dédiés).
                      <Text style={styles.attachEmptyText}>{t('orders.attach_no_program_available')}</Text>
                    ) : (
                      <>
                        <Text style={styles.attachFieldLabel}>{t('orders.attach_select_program_label')}</Text>
                        <View style={styles.attachChipRow}>
                          {attachPrograms.map(p => {
                            const active = attachProgramId === p.id
                            return (
                              <TouchableOpacity
                                key={p.id}
                                style={[styles.attachChip, active && styles.attachChipActive]}
                                onPress={() => setAttachProgramId(p.id)}
                                activeOpacity={0.7}
                              >
                                <Text style={[styles.attachChipText, active && styles.attachChipTextActive]}>
                                  {formatProgramTitle(getLrpName(), p.label)}
                                </Text>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                        {/* §13 — préremplie depuis order_date par pure commodité UX, mais
                            explicitement éditable AVANT confirmation : jamais une vérité métier
                            devinée silencieusement. */}
                        <DateInput
                          label={t('orders.attach_occurrence_date_label')}
                          value={attachOccurrenceDate}
                          onChangeValue={setAttachOccurrenceDate}
                        />
                      </>
                    )}
                    {attachError ? <Text style={styles.error}>{attachError}</Text> : null}
                    <View style={styles.dissociateConfirmActions}>
                      <TouchableOpacity onPress={() => setAttachOpen(false)} disabled={attachSaving}>
                        <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
                      </TouchableOpacity>
                      {attachPrograms.length > 0 ? (
                        <TouchableOpacity onPress={confirmAttach} disabled={attachSaving || !attachProgramId || !attachOccurrenceDate.trim()}>
                          {attachSaving
                            ? <ActivityIndicator size="small" color={colors.primary} />
                            : <Text style={styles.attachConfirmBtn}>{t('common.confirm')}</Text>}
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                )}
              </View>
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
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Button label={t('common.save')} onPress={handleSave} loading={saving} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rendue en sibling du Modal principal, comme dans app/(app)/appointments/[id]/index.tsx
          (salePickerModal) — pattern déjà éprouvé de deux <Modal> simultanées. */}
      {showCatalogPicker ? (
        <CatalogProductPicker onSelect={addCatalogLine} onClose={() => setShowCatalogPicker(false)} />
      ) : null}

      {returnModalLine ? (
        <OrderItemReturnModal
          orderItemId={returnModalLine.id}
          productName={returnModalLine.name}
          quantity={returnModalLine.qty}
          currentReturnedQty={returnModalLine.returnedQty}
          onClose={() => setReturnModalLine(null)}
          onSaved={(newReturnedQty) => handleReturnSaved(returnModalLine.id, newReturnedQty)}
        />
      ) : null}
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
      paddingHorizontal: 20, paddingBottom: 32, gap: 12,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 },
    title:  { fontSize: 16, fontFamily: fonts.bold, color: colors.text, flex: 1 },
    close:  { fontSize: 16, color: colors.textTertiary, padding: 4 },

    // ORDER-SYNC-1 — lignes produit d'une commande structurée : bordure/rayon/couleurs cohérents
    // avec Input/TextArea de cet écran (colors.border, colors.card), compact et responsive
    // (name en flex:1, qty/price en largeur fixe modeste) — jamais un tableau desktop illisible
    // sur mobile.
    productLinesBlock: { gap: 8 },
    sectionLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.text },
    productLineGroup: { gap: 2 },
    productLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    lineInput: {
      borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 10,
      paddingHorizontal: 10, fontSize: 14, fontFamily: fonts.body, color: colors.text, backgroundColor: colors.bg,
    },
    productLineActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    lineAddBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: colors.primaryLight },
    lineAddBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    totalText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text, marginTop: 2 },
    // ORDER-BUSINESS-3.4 §31/§34 — affichage minimal, ton neutre ("suivis", jamais "crédités"/
    // "officiels acquis" sans intégration entreprise, §37 du rapport ORDER-BUSINESS-3).
    mlmLineRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 2 },
    mlmLineText: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },
    mlmTotalsBlock: { gap: 2, marginTop: 2 },
    mlmTotalText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },

    // ORDER-BUSINESS-4.2 — retours partiels : action/résumé par ligne, bannière commande.
    rowErrorText: { fontSize: 11, fontFamily: fonts.medium, color: colors.danger },
    returnBtn: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.bgDim },
    returnBtnText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary },
    returnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
    returnSummaryText: { fontSize: 11, fontFamily: fonts.medium, color: colors.warning },
    returnLinkText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.primary },
    allReturnedBanner: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.dangerLight, marginTop: 4 },
    allReturnedText: { fontSize: 12, fontFamily: fonts.medium, color: colors.text },
    allReturnedActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 },
    allReturnedConfirmText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.danger },

    // LRP-4.5 §8/§9/§10 — légende de section compacte, réutilisée pour "CONTACT" et
    // "PROGRAMME RÉCURRENT" : cohérente avec les autres légendes de section d'Oryalis (petite,
    // majuscules, couleur tertiaire) sans jamais forcer le TEXTE UTILISATEUR (label) en capitales.
    sectionCaption: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
    contactBlock: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bgDim },
    contactName: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
    contactOpenAction: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },

    switchRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    switchLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.text, flex: 1 },
    programLinkBlock: { gap: 8 },
    programLinkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.secondaryLight },
    programLinkLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text, flex: 1 },
    programLinkAction: { fontSize: 12, fontFamily: fonts.semibold, color: colors.secondary },
    programOccurrenceText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    legacyProgramRow: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bgDim, gap: 2 },
    legacyProgramLabel: { fontSize: 13, fontFamily: fonts.semibold, color: colors.textSecondary },
    legacyProgramSub: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    // LRP-4.6 §11/§12/§13 — panneau de rattachement manuel, mêmes valeurs visuelles que les
    // chips de LrpProgramFields (cohérence design), dupliquées ici car chaque écran génère ses
    // styles localement via makeStyles(colors) (pattern déjà en place dans tout Oryalis).
    attachLink: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
    attachPanel: { gap: 10, padding: 12, borderRadius: 10, backgroundColor: colors.bgDim },
    attachEmptyText: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    attachFieldLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.text },
    attachChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    attachChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
    attachChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    attachChipText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    attachChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    attachConfirmBtn: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    dissociateLink: { fontSize: 12, fontFamily: fonts.medium, color: colors.textTertiary, textAlign: 'right' },
    dissociateConfirmRow: { gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.dangerLight },
    dissociateConfirmText: { fontSize: 12, fontFamily: fonts.body, color: colors.text },
    dissociateConfirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 },
    dissociateConfirmBtn: { fontSize: 13, fontFamily: fonts.semibold, color: colors.danger },

    typeRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
    typePicker:  { flexDirection: 'row', gap: 8 },
    typeChip:    { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
    typeChipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
    typeChipText:       { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
    typeChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },

    error: { fontSize: 13, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
    formBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
    cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    cancelBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.textSecondary },
  })
}
