import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { formatDate } from '@/shared/lib/dateFormat'
import { formatMoney } from '@/shared/lib/moneyFormat'
import type { Client, Followup, Interaction, Note, OrderItem, OrderListItem, Recommendation, RecurringProgram } from '@/shared/lib/types'
import type { AppointmentWithContext } from '@/features/appointments/appointmentTypes'
import { hybridLinesFromItems } from '@/features/orders/orderItemService'

interface Props {
  client: Client
  // Commandes déjà filtrées sur le périmètre net (isOrderNetRevenue) par l'appelant.
  orders: OrderListItem[]
  orderItemsByOrderId: Record<string, OrderItem[]>
  recommendations: Recommendation[]
  notes: Note[]
  interactions: Interaction[]
  appointments: AppointmentWithContext[]
  recurringPrograms: RecurringProgram[]
  followups: Followup[]
  // Nom des marques par id (pour le détail des abonnements par marque).
  brandNames: Record<string, string>
  showPrograms: boolean
  // Bloc "À venir" existant de la fiche, rendu tel quel (null s'il n'y a rien).
  upcoming: ReactNode
  isDesktop: boolean
  onEditExpectations: () => void
  onAddOrder: () => void
  onPlanAppointment: () => void
  onAddNote: () => void
  onOpenHistory: () => void
}

const MAX_PRODUCTS = 3

export function ContactSynthesis(props: Props) {
  const { client, orders, orderItemsByOrderId, recommendations, notes, interactions, appointments, recurringPrograms, followups, brandNames, showPrograms, upcoming, isDesktop } = props
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const fmt = (d: string) => formatDate(d, locale)

  const sortedOrders = useMemo(() => [...orders].sort((a, b) => b.order_date.localeCompare(a.order_date)), [orders])
  const ordersTotal = orders.reduce((sum, o) => sum + (o.amount ?? 0), 0)
  const hasAmounts = orders.some(o => o.amount != null)

  // Dates courtes dans les cases "En bref" (jour/mois, + année si différente) : jamais tronquées.
  const fmtShort = (d: string) => {
    const date = new Date(d.length <= 10 ? `${d}T12:00:00` : d)
    const sameYear = date.getFullYear() === new Date().getFullYear()
    return date.toLocaleDateString(locale, sameYear ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', year: '2-digit' })
  }

  const activePrograms = recurringPrograms.filter(p => p.status === 'active')
  const nextProgramDate = activePrograms
    .filter(p => p.next_occurrence_date)
    .map(p => p.next_occurrence_date as string)
    .sort()[0] ?? null
  // Plusieurs abonnements : "Zinzino 1 · doTERRA 1" (marques du programme), "sans marque" sinon.
  const programsByBrandLabel = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of activePrograms) {
      const name = (p.brand_id && brandNames[p.brand_id]) || t('brands.filter_none')
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()].map(([name, n]) => `${name} ${n}`).join(' · ')
  }, [activePrograms, brandNames, t])

  // Même définition que refresh_client_activity (base) : RDV réalisé, échange terminé, relance faite.
  const lastContact = useMemo(() => {
    const candidates: { date: string; label: string }[] = []
    for (const i of interactions) {
      if (i.completed_at) candidates.push({ date: i.completed_at, label: t(`interaction_types.${i.interaction_type}`) })
    }
    for (const a of appointments) {
      if (a.status === 'completed') candidates.push({ date: a.start_at, label: t('clients.synthesis_contact_appointment') })
    }
    for (const f of followups) {
      if (f.done) candidates.push({ date: f.updated_at ?? f.created_at, label: t('clients.synthesis_contact_followup') })
    }
    return candidates.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  }, [interactions, appointments, followups, t])

  const nowIso = new Date().toISOString()
  const keptAppointments = appointments.filter(a => a.status !== 'cancelled')
  const lastPastAppointment = keptAppointments
    .filter(a => a.start_at <= nowIso)
    .sort((a, b) => b.start_at.localeCompare(a.start_at))[0] ?? null

  // Produits : lignes des commandes les plus récentes, complétées par les recommandations.
  const products = useMemo(() => {
    const seen = new Set<string>()
    const list: { name: string; meta: string }[] = []
    for (const order of sortedOrders) {
      for (const line of hybridLinesFromItems(order, orderItemsByOrderId[order.id])) {
        const key = line.name.trim().toLowerCase()
        if (!key || seen.has(key)) continue
        seen.add(key)
        list.push({ name: line.name, meta: t('clients.synthesis_product_ordered', { date: fmt(order.order_date) }) })
        if (list.length >= MAX_PRODUCTS) return list
      }
    }
    for (const rec of recommendations) {
      const key = rec.product_name.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      const date = rec.recommendation_date ?? rec.created_at
      list.push({ name: rec.product_name, meta: t('clients.synthesis_product_recommended', { date: fmt(date) }) })
      if (list.length >= MAX_PRODUCTS) break
    }
    return list
  }, [sortedOrders, orderItemsByOrderId, recommendations, t, locale])

  // Dernier échange : la plus récente entre une note et une interaction terminée.
  const lastExchange = useMemo(() => {
    const candidates: { date: string; text: string }[] = []
    const lastNote = [...notes].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    if (lastNote) candidates.push({ date: lastNote.created_at, text: lastNote.content })
    const lastInteraction = interactions
      .filter(i => i.completed_at && (i.summary || i.subject))
      .sort((a, b) => (b.completed_at as string).localeCompare(a.completed_at as string))[0]
    if (lastInteraction) candidates.push({ date: lastInteraction.completed_at as string, text: (lastInteraction.summary || lastInteraction.subject) as string })
    return candidates.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  }, [notes, interactions])

  const hasExpectations = !!(client.expectation_goals || client.contact_preference || client.expectation_habits || client.next_exchange_questions)
  const questions = (client.next_exchange_questions ?? '').split('\n').map(q => q.trim()).filter(Boolean)
  const firstName = client.first_name || client.full_name.split(' ')[0]

  const tile = (label: string, value: string, meta: ReactNode, empty: boolean) => (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, empty && styles.tileValueEmpty]} numberOfLines={1}>{value}</Text>
      {meta}
    </View>
  )
  const tileMeta = (text: string) => <Text style={styles.tileMeta} numberOfLines={2}>{text}</Text>
  const tileLink = (text: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}><Text style={styles.linkText}>+ {text}</Text></TouchableOpacity>
  )

  const emptyCard = (title: string, text: string, cta: string, onPress: () => void) => (
    <View style={[styles.card, styles.emptyCard]}>
      <View style={styles.emptyCardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.mutedText}>{text}</Text>
      </View>
      <TouchableOpacity style={styles.outlineBtn} onPress={onPress} activeOpacity={0.8}>
        <Text style={styles.outlineBtnText}>{cta}</Text>
      </TouchableOpacity>
    </View>
  )

  return (
    <View style={styles.root}>
      {/* ── En bref ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('clients.synthesis_overview')}</Text>
        <View style={styles.tilesRow}>
          {/* Dernier contact : la date ET ce que c'était (même calcul que la base : RDV réalisé,
              échange terminé ou relance faite), pour retrouver l'événement dans l'Activité. */}
          {tile(
            t('clients.synthesis_last_contact'),
            lastContact ? fmtShort(lastContact.date) : '—',
            tileMeta(lastContact ? lastContact.label : t('clients.synthesis_never_contacted')),
            !lastContact,
          )}
          {tile(
            t('clients.synthesis_orders'),
            orders.length > 0 && hasAmounts ? formatMoney(ordersTotal, locale) : String(orders.length),
            sortedOrders[0]
              ? tileMeta(t('clients.synthesis_orders_meta', { count: orders.length, date: fmtShort(sortedOrders[0].order_date) }))
              : tileLink(t('clients.synthesis_record'), props.onAddOrder),
            orders.length === 0,
          )}
          {/* Abonnements : nombre d'abonnements actifs ; détail par marque s'il y en a plusieurs,
              sinon la prochaine échéance. */}
          {showPrograms ? tile(
            t('clients.synthesis_subscriptions'),
            String(activePrograms.length),
            tileMeta(
              activePrograms.length === 0 ? t('clients.synthesis_none')
                : activePrograms.length === 1
                  ? (nextProgramDate ? t('clients.synthesis_next_on', { date: fmtShort(nextProgramDate) }) : '')
                  : programsByBrandLabel,
            ),
            activePrograms.length === 0,
          ) : null}
          {tile(
            t('clients.synthesis_appointments'),
            String(keptAppointments.length),
            lastPastAppointment
              ? tileMeta(t('clients.synthesis_last_on', { date: fmtShort(lastPastAppointment.start_at) }))
              : tileLink(t('clients.synthesis_plan'), props.onPlanAppointment),
            keptAppointments.length === 0,
          )}
          {tile(
            t('clients.synthesis_referrals'),
            String(client.referrals_count ?? 0),
            tileMeta(''),
            !client.referrals_count,
          )}
        </View>
      </View>

      <View style={[styles.columns, isDesktop && styles.columnsDesktop]}>
        {/* ── Ses attentes ── */}
        <View style={[styles.column, isDesktop && styles.columnDesktop]}>
          {hasExpectations ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>🎯 {t('clients.expectations_title')}</Text>
                <TouchableOpacity onPress={props.onEditExpectations} activeOpacity={0.7}>
                  <Text style={styles.linkText}>{t('common.edit')} ›</Text>
                </TouchableOpacity>
              </View>
              {client.expectation_goals ? <Text style={styles.quote}>« {client.expectation_goals} »</Text> : null}
              {client.contact_preference ? <Text style={styles.mutedText}>📞 {client.contact_preference}</Text> : null}
              {client.expectation_habits ? <Text style={styles.mutedText} numberOfLines={3}>⏱ {client.expectation_habits}</Text> : null}
              {questions.length > 0 ? (
                <View style={styles.questionsBox}>
                  <Text style={styles.questionsTitle}>{t('clients.expectations_questions_short')}</Text>
                  {questions.map((q, i) => <Text key={i} style={styles.questionText}>• {q}</Text>)}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🎯 {t('clients.expectations_title')}</Text>
              <Text style={styles.mutedText}>{t('clients.expectations_empty_hint', { name: firstName })}</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={props.onEditExpectations} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>+ {t('clients.expectations_add')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={[styles.column, isDesktop && styles.columnDesktop]}>
          {/* ── À venir ── */}
          {upcoming ?? emptyCard(`📆 ${t('clients.upcoming_title')}`, t('clients.synthesis_nothing_planned'), `📅 ${t('clients.synthesis_plan_appointment')}`, props.onPlanAppointment)}

          {/* ── Ses produits ── */}
          {products.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>🌿 {t('clients.synthesis_products')}</Text>
                <TouchableOpacity onPress={props.onAddOrder} activeOpacity={0.7}>
                  <Text style={styles.linkText}>{t('clients.synthesis_orders')} ›</Text>
                </TouchableOpacity>
              </View>
              {products.map((p, i) => (
                <View key={i} style={styles.listRow}>
                  <Text style={styles.listText} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.listMeta}>{p.meta}</Text>
                </View>
              ))}
            </View>
          ) : emptyCard(`🌿 ${t('clients.synthesis_products')}`, t('clients.synthesis_no_products'), `🛒 ${t('clients.synthesis_record_order')}`, props.onAddOrder)}
        </View>
      </View>

      {/* ── Dernier échange ── */}
      {lastExchange ? (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>📝 {t('clients.synthesis_last_exchange', { date: fmt(lastExchange.date) })}</Text>
            <TouchableOpacity onPress={props.onOpenHistory} activeOpacity={0.7}>
              <Text style={styles.linkText}>{t('clients.synthesis_history')} ›</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.mutedText} numberOfLines={3}>{lastExchange.text}</Text>
        </View>
      ) : emptyCard(`📝 ${t('clients.synthesis_last_exchange_empty')}`, t('clients.synthesis_no_note'), `📝 ${t('clients.synthesis_add_note')}`, props.onAddNote)}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { gap: 14 },
    card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 18, gap: 10, ...SOFT_CARD_SHADOW },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    cardTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text, flexShrink: 1 },
    emptyCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' },
    emptyCardText: { gap: 4, flexShrink: 1, minWidth: 160 },
    tilesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: { flexGrow: 1, flexBasis: 130, backgroundColor: colors.surface, borderRadius: 12, padding: 12, gap: 3 },
    tileLabel: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    tileValue: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
    tileValueEmpty: { color: colors.textTertiary },
    tileMeta: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, minHeight: 16 },
    columns: { gap: 14 },
    columnsDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
    column: { gap: 14 },
    columnDesktop: { flex: 1, minWidth: 0 },
    quote: { fontSize: 14, lineHeight: 21, fontFamily: fonts.body, fontStyle: 'italic', color: colors.text },
    mutedText: { fontSize: 13, lineHeight: 19, fontFamily: fonts.body, color: colors.textSecondary },
    questionsBox: { backgroundColor: colors.warningLight, borderRadius: 12, padding: 12, gap: 4 },
    questionsTitle: { fontSize: 11.5, fontFamily: fonts.bold, color: colors.warning, textTransform: 'uppercase', letterSpacing: 0.4 },
    questionText: { fontSize: 13, fontFamily: fonts.body, color: colors.text },
    listRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    listText: { fontSize: 13, fontFamily: fonts.medium, color: colors.text, flexShrink: 1 },
    listMeta: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    linkText: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.primary },
    primaryBtn: { alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.primaryAction },
    primaryBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.onPrimary },
    outlineBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    outlineBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  })
}
