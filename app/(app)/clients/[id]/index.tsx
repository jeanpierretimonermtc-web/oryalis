import { useState, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Platform, useWindowDimensions } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as Clipboard from 'expo-clipboard'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClient } from '@/features/clients/useClient'
import { useClientAppointments } from '@/features/appointments/useAppointments'
import { useNotes } from '@/features/notes/useNotes'
import { useClientFollowups } from '@/features/followups/useFollowups'
import { useRecommendations } from '@/features/recommendations/useRecommendations'
import { useClientInteractions } from '@/features/interactions/useInteractions'
import { useClientOrders } from '@/features/orders/useOrders'
import { useDirectTeam } from '@/features/network/useNetwork'
import { computeProspectScore } from '@/features/clients/clientService'
import { callContact, completeNextAction, openWhatsApp, postponeNextAction } from '@/features/clients/nextActionService'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { ClientStatus, ContactRole } from '@/shared/lib/types'
import { formatDate } from '@/shared/lib/dateFormat'

type Tab = 'apercu' | 'chrono' | 'rdv' | 'notes' | 'relances' | 'reco' | 'interactions' | 'orders' | 'team'

interface TimelineEntry {
  id: string
  date: string
  icon: string
  title: string
  sub?: string
  done?: boolean
  onPress: () => void
}

const BASE_TABS: { key: Tab; labelKey: string }[] = [
  { key: 'apercu',       labelKey: 'clients.tab_overview' },
  { key: 'chrono',       labelKey: 'clients.tab_timeline' },
  { key: 'rdv',          labelKey: 'clients.tab_rdv' },
  { key: 'notes',        labelKey: 'clients.tab_notes' },
  { key: 'relances',     labelKey: 'clients.tab_followups' },
  { key: 'reco',         labelKey: 'clients.tab_reco' },
  { key: 'interactions', labelKey: 'clients.tab_interactions' },
  { key: 'orders',       labelKey: 'clients.tab_orders' },
]

function getRoleColors(role: ContactRole, colors: ThemeColors) {
  switch (role) {
    case 'distributor': return { bg: colors.secondaryLight, text: colors.secondary }
    case 'leader':      return { bg: colors.tertiaryLight,  text: colors.tertiary  }
    case 'customer':    return { bg: colors.successLight,   text: colors.success   }
    case 'team_member': return { bg: colors.bgDim,          text: colors.textSecondary }
    case 'inactive':    return { bg: colors.warningLight,   text: colors.warning   }
    default:            return { bg: colors.primaryLight,   text: colors.primary   }
  }
}

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
  const { id } = useLocalSearchParams<{ id: string }>()
  const { session } = useAuth()
  const { client, loading, refresh } = useClient(id)
  const { appointments } = useClientAppointments(id)
  const { notes } = useNotes(id)
  const { followups } = useClientFollowups(id)
  const { recommendations } = useRecommendations(id)
  const { interactions } = useClientInteractions(id)
  const { orders } = useClientOrders(id)
  const { team } = useDirectTeam(id)
  const [activeTab, setActiveTab]       = useState<Tab>('apercu')
  const [messageOpen, setMessageOpen]   = useState(false)
  const [actionBusy, setActionBusy]     = useState(false)
  const [actionError, setActionError]   = useState<string | null>(null)
  const [phoneCopied, setPhoneCopied]   = useState(false)
  const { getStatusLabel, isModuleActive } = useAppConfig()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const { width: screenW } = useWindowDimensions()
  const isDesktopWeb = Platform.OS === 'web' && screenW >= 768

  const TABS = useMemo(() => {
    const isNetworkRole = client?.contact_role === 'distributor' || client?.contact_role === 'leader'
    let tabs = [...BASE_TABS]
    if (!isModuleActive('products')) tabs = tabs.filter(t => t.key !== 'reco')
    if (isNetworkRole) tabs.push({ key: 'team' as Tab, labelKey: 'clients.tab_team' })
    return tabs
  }, [client?.contact_role, isModuleActive])

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
  const nextDate = client.next_action_at

  // ── Chronologie relationnelle : fusion de tous les événements par date ──────
  const timelineEntries: TimelineEntry[] = [
    ...appointments.map(appt => ({
      id: `rdv-${appt.id}`,
      date: appt.start_at,
      icon: '📅',
      title: appt.title,
      sub: t(`appointment_statuses.${appt.status}` as any),
      onPress: () => router.push(`/(app)/clients/${id}/appointments`),
    })),
    ...notes.map(note => ({
      id: `note-${note.id}`,
      date: note.created_at,
      icon: '📝',
      title: note.content,
      onPress: () => router.push(`/(app)/clients/${id}/notes`),
    })),
    ...followups.map(f => ({
      id: `relance-${f.id}`,
      date: f.due_date,
      icon: '🔔',
      title: f.title ?? f.content ?? t('followups.title'),
      sub: f.done ? t('followups.done') : undefined,
      done: f.done,
      onPress: () => router.push(`/(app)/clients/${id}/followups`),
    })),
    ...recommendations.map(r => ({
      id: `reco-${r.id}`,
      date: r.recommendation_date ?? r.created_at,
      icon: '🌿',
      title: r.product_name,
      sub: r.reason ?? t(`recommendations.${r.status}`),
      onPress: () => router.push(`/(app)/clients/${id}/recommendations`),
    })),
    ...orders.map(o => ({
      id: `commande-${o.id}`,
      date: o.order_date,
      icon: '🛒',
      title: o.product_name,
      sub: o.amount != null ? `${o.amount.toFixed(0)}€` : undefined,
      onPress: () => router.push(`/(app)/clients/${id}/orders`),
    })),
    ...interactions.map(item => ({
      id: `interaction-${item.id}`,
      date: item.scheduled_at ?? item.completed_at ?? item.created_at,
      icon: '💬',
      title: item.subject ?? t(`interaction_types.${item.interaction_type}`),
      sub: t(`interaction_types.${item.interaction_type}`),
      done: !!item.completed_at,
      onPress: () => router.push(`/(app)/clients/${id}/interactions`),
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

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

  async function copyPhone(phone: string) {
    await Clipboard.setStringAsync(phone)
    setPhoneCopied(true)
    setTimeout(() => setPhoneCopied(false), 2000)
  }

  function openMeet() {
    Linking.openURL('https://meet.google.com/new')
  }

  const sc = statusColors[client.status as ClientStatus] ?? { bg: colors.surfaceContainerHigh, text: colors.textSecondary }

  // Prospect score — uses full data available in this screen
  const bestFollowup = followups.reduce<typeof followups[0] | null>((best, f) => {
    if (!f.prospect_temperature) return best
    const order = { very_hot: 4, hot: 3, warm: 2, cold: 1 }
    if (!best?.prospect_temperature) return f
    return (order[f.prospect_temperature] ?? 0) > (order[best.prospect_temperature!] ?? 0) ? f : best
  }, null)

  const prospectScore = computeProspectScore({
    client,
    lastRdvDate: lastDate ?? null,
    totalRdv: appointments.length,
    followupTemperature: bestFollowup?.prospect_temperature ?? null,
    pipelineStage: client.pipeline_stage,
  })

  const scoreBg   = prospectScore >= 70 ? colors.dangerLight  : prospectScore >= 40 ? colors.warningLight : colors.bgDim
  const scoreText = prospectScore >= 70 ? colors.danger        : prospectScore >= 40 ? colors.warning      : colors.textSecondary

  const particularityItems = client.particularities
    ? client.particularities.split('\n').map(s => s.trim()).filter(Boolean)
    : []

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

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* ── Hero ─────────────────────────────────────────────── */}
          <View style={styles.hero}>
            <View style={[styles.bigAvatar, { backgroundColor: sc.bg }]}>
              <Text style={[styles.bigAvatarText, { color: sc.text }]}>{nameInitials(client.full_name)}</Text>
            </View>
            <Text style={styles.heroName}>{client.full_name}</Text>
            <View style={styles.heroBadges}>
              <View style={[styles.heroPill, { backgroundColor: sc.bg }]}>
                <Text style={[styles.heroPillText, { color: sc.text }]}>
                  {getStatusLabel(client.status as ClientStatus).toUpperCase()}
                </Text>
              </View>
              {client.contact_role && client.contact_role !== 'customer' ? (() => {
                const rc = getRoleColors(client.contact_role as ContactRole, colors)
                return (
                  <View style={[styles.heroPill, { backgroundColor: rc.bg }]}>
                    <Text style={[styles.heroPillText, { color: rc.text }]}>
                      {t(`clients.contact_role.${client.contact_role}`).toUpperCase()}
                    </Text>
                  </View>
                )
              })() : null}
              {client.client_type ? (
                <View style={[styles.heroPill, { backgroundColor: colors.surfaceContainerHighest, maxWidth: 200 }]}>
                  <Text style={[styles.heroPillText, { color: colors.textSecondary }]} numberOfLines={1}>
                    {client.client_type.toUpperCase()}
                  </Text>
                </View>
              ) : null}
              {prospectScore > 0 ? (
                <View style={[styles.heroPill, { backgroundColor: scoreBg }]}>
                  <Text style={[styles.heroPillText, { color: scoreText }]}>
                    {t('clients.score')} {prospectScore}
                  </Text>
                </View>
              ) : null}
            </View>
            {/* KPI strip */}
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
              <View style={styles.kpiDivider} />
              <View style={styles.kpiCol}>
                <Text style={styles.kpiLabel}>{t('clients.kpi_next')}</Text>
                <Text style={styles.kpiValue}>{fmtShort(nextDate, locale)}</Text>
                {client.next_action_source && (
                  <Text style={styles.kpiSourceLabel}>
                    {t(`clients.next_action_source_${client.next_action_source}`)}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* ── Quick actions ────────────────────────────────────── */}
          <View style={styles.quickActions}>
            {client.next_action_source ? (
              <>
                <TouchableOpacity
                  disabled={actionBusy}
                  style={[styles.qaBtn, actionBusy && { opacity: 0.6 }]}
                  onPress={() => {
                    runNextAction(() => completeNextAction(client)).then(result => {
                      if (result?.needsDebrief) {
                        router.push(`/(app)/appointments/${result.appointmentId}?debrief=1` as any)
                      }
                    })
                  }}
                  activeOpacity={0.8}
                >
                  {actionBusy
                    ? <ActivityIndicator size="small" color={colors.text} />
                    : <Text style={styles.qaIcon}>✓</Text>}
                  <Text style={styles.qaLabel}>Terminer</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={actionBusy} style={styles.qaBtn} onPress={() => runNextAction(() => postponeNextAction(client))} activeOpacity={0.8}>
                  <Text style={styles.qaIcon}>＋1</Text><Text style={styles.qaLabel}>Reporter</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {client.phone ? (
              <>
                {isDesktopWeb ? (
                  <>
                    <TouchableOpacity style={styles.qaBtn} onPress={() => copyPhone(client.phone!)} activeOpacity={0.8}>
                      <LineIcon name="copy" size={18} color={colors.text} strokeWidth={2} />
                      <Text style={styles.qaLabel}>{phoneCopied ? t('clients.phone_copied') : t('clients.copy_phone')}</Text>
                      <Text style={styles.qaSubLabel}>Numéro de tél.</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.qaBtn} onPress={openMeet} activeOpacity={0.8}>
                      <LineIcon name="video" size={18} color={colors.text} strokeWidth={2} />
                      <Text style={styles.qaLabel}>Meet</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <TouchableOpacity style={styles.qaBtn} onPress={() => callContact(client.phone!)} activeOpacity={0.8}>
                    <LineIcon name="phone" size={18} color={colors.text} strokeWidth={2} />
                    <Text style={styles.qaLabel}>Appeler</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.qaBtn} onPress={() => openWhatsApp(client.phone!)} activeOpacity={0.8}>
                  <LineIcon name="whatsapp" size={20} color={colors.text} strokeWidth={2} />
                  <Text style={styles.qaLabel}>WhatsApp</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity style={styles.qaBtn} onPress={() => setMessageOpen(true)} activeOpacity={0.8}>
              <LineIcon name="message" size={18} color={colors.text} strokeWidth={2} />
              <Text style={styles.qaLabel}>Message</Text>
              <Text style={styles.qaSubLabel}>Modèles à envoyer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.qaBtn} onPress={() => router.push(`/(app)/clients/${id}/appointments` as any)} activeOpacity={0.8}>
              <LineIcon name="calendarPlus" size={18} color={colors.text} strokeWidth={2} />
              <Text style={styles.qaLabel}>RDV</Text>
              <Text style={styles.qaSubLabel}>Créer, voir, historique</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.qaBtn} onPress={() => router.push(`/(app)/clients/${id}/edit` as any)} activeOpacity={0.8}>
              <LineIcon name="edit" size={18} color={colors.text} strokeWidth={2} />
              <Text style={styles.qaLabel}>Modifier</Text>
            </TouchableOpacity>
          </View>
          {actionError && (
            <Text style={{ color: colors.danger, fontSize: 12, fontFamily: fonts.medium, marginTop: 8 }}>
              {actionError}
            </Text>
          )}

          {/* ── Tab bar ──────────────────────────────────────────── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
            {TABS.map(tab => (
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

            {/* ─ Aperçu ─ */}
            {activeTab === 'apercu' && (
              <>
                {/* Informations personnelles */}
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{t('clients.sections.personal')}</Text>
                    <TouchableOpacity onPress={() => router.push(`/(app)/clients/${id}/edit`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={styles.cardMenu}>⋮</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.fieldGrid}>
                    {client.email ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>✉️</Text></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.email').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.email}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.phone ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>📞</Text></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.phone').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.phone}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.birth_date ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>🎂</Text></View>
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
                        <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>💼</Text></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.profession').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.profession}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.children ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>👶</Text></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.children').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.children}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.country ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>🌍</Text></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.country').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.country}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.source ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>🔗</Text></View>
                        <View style={styles.fieldBlock}>
                          <Text style={styles.fieldLabel}>{t('clients.fields.source').toUpperCase()}</Text>
                          <Text style={styles.fieldValue}>{client.source}</Text>
                        </View>
                      </View>
                    ) : null}
                    {client.inscription_date ? (
                      <View style={styles.fieldGridItem}>
                        <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>🗓</Text></View>
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
                      <View style={styles.fieldIconBox}><Text style={styles.fieldIconEmoji}>📍</Text></View>
                      <View style={styles.addressTextBlock}>
                        <Text style={styles.fieldLabel}>{t('clients.fields.address').toUpperCase()}</Text>
                        <Text style={styles.fieldValue}>{client.address}</Text>
                      </View>
                      <Text style={styles.addressChevron}>›</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Programme fidélité */}
                {isModuleActive('renewals_lrp') && (client.doterra_id || client.loyalty_notes || client.next_lrp_date) ? (
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.warningLight }]}>
                        <Text style={styles.iconBoxEmoji}>⭐</Text>
                      </View>
                      <Text style={styles.cardTitle}>{t('clients.sections.doterra')}</Text>
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
                            <Text style={styles.fieldLabel}>{t('clients.fields.next_lrp_date').toUpperCase()}</Text>
                            <Text style={styles.fieldValue}>
                              {formatDate(client.next_lrp_date, locale)}
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

                {/* Antécédents & Notes */}
                {client.medical_notes ? (
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={styles.iconBox}>
                        <Text style={styles.iconBoxEmoji}>📋</Text>
                      </View>
                      <Text style={styles.cardTitle}>{t('clients.section_medical')}</Text>
                    </View>
                    <Text style={styles.bodyText}>{client.medical_notes}</Text>
                  </View>
                ) : null}

                {/* Particularités */}
                {particularityItems.length > 0 ? (
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.warningLight }]}>
                        <Text style={[styles.iconBoxEmoji, { color: colors.warning }]}>!</Text>
                      </View>
                      <Text style={styles.cardTitle}>{t('clients.section_particularities')}</Text>
                    </View>
                    {particularityItems.map((item, i) => (
                      <View key={i} style={styles.bulletRow}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.bulletText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                {/* Centres d'intérêt */}
                <View style={styles.interestsSection}>
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

                {/* Parcours */}
                {(client.pipeline_stage || client.next_action_type || client.next_action_date) ? (
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
                        <Text style={styles.iconBoxEmoji}>🗺</Text>
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

                {/* Réseau */}
                {((client.referral_count ?? 0) > 0 || client.network_potential) ? (
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <View style={[styles.iconBox, { backgroundColor: colors.tertiaryLight }]}>
                        <Text style={styles.iconBoxEmoji}>🌐</Text>
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
              </>
            )}

            {/* ─ Chronologie ─ */}
            {activeTab === 'chrono' && (
              <View style={styles.listTab}>
                {timelineEntries.length === 0
                  ? <Text style={styles.emptyText}>{t('clients.timeline_empty')}</Text>
                  : timelineEntries.map(entry => (
                      <TouchableOpacity
                        key={entry.id}
                        style={[styles.listCard, entry.done && styles.listCardDone]}
                        onPress={entry.onPress}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.timelineIcon}>{entry.icon}</Text>
                        <View style={styles.listCardLeft}>
                          <Text style={[styles.listCardDate, entry.done && styles.listCardDateStrike]}>
                            {formatDate(entry.date, locale)}
                          </Text>
                          <Text style={styles.listCardSub} numberOfLines={2}>{entry.title}</Text>
                        </View>
                        {entry.sub ? (
                          <View style={styles.listCardBadge}>
                            <Text style={styles.listCardBadgeText} numberOfLines={1}>{entry.sub}</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    ))
                }
              </View>
            )}

            {/* ─ RDV ─ */}
            {activeTab === 'rdv' && (
              <View style={styles.listTab}>
                {appointments.length === 0
                  ? <Text style={styles.emptyText}>{t('appointments.empty')}</Text>
                  : appointments
                      .slice()
                      .slice().sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
                      .map(appt => (
                        <TouchableOpacity
                          key={appt.id}
                          style={styles.listCard}
                          onPress={() => router.push(`/(app)/clients/${id}/appointments`)}
                          activeOpacity={0.8}
                        >
                          <View style={styles.listCardLeft}>
                            <Text style={styles.listCardDate}>
                              {formatDate(appt.start_at, locale)}
                            </Text>
                            <Text style={styles.listCardSub} numberOfLines={1}>{appt.title}</Text>
                          </View>
                          <View style={styles.listCardBadge}>
                            <Text style={styles.listCardBadgeText}>{new Date(appt.start_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</Text>
                          </View>
                        </TouchableOpacity>
                      ))
                }
                <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/appointments`)} activeOpacity={0.7}>
                  <Text style={styles.addRowBtnText}>+ {t('appointments.add')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ─ Notes ─ */}
            {activeTab === 'notes' && (
              <View style={styles.listTab}>
                {notes.length === 0
                  ? <Text style={styles.emptyText}>{t('notes.empty')}</Text>
                  : notes.map(note => (
                      <TouchableOpacity
                        key={note.id}
                        style={styles.listCard}
                        onPress={() => router.push(`/(app)/clients/${id}/notes`)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.listCardDate}>
                          {formatDate(note.created_at, locale)}
                        </Text>
                        <Text style={styles.listCardSub} numberOfLines={4}>{note.content}</Text>
                      </TouchableOpacity>
                    ))
                }
                <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/notes`)} activeOpacity={0.7}>
                  <Text style={styles.addRowBtnText}>+ {t('notes.add')}</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ─ Relances ─ */}
            {activeTab === 'relances' && (
              <View style={styles.listTab}>
                {followups.length === 0
                  ? <Text style={styles.emptyText}>{t('followups.none')}</Text>
                  : followups
                      .slice()
                      .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
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
            )}

            {/* ─ Reco ─ */}
            {activeTab === 'reco' && (
              <View style={styles.listTab}>
                {recommendations.length === 0
                  ? <Text style={styles.emptyText}>{t('recommendations.empty')}</Text>
                  : recommendations.map(r => (
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

            {/* ─ Commandes ─ */}
            {activeTab === 'orders' && (
              <View style={styles.listTab}>
                {orders.length === 0
                  ? <Text style={styles.emptyText}>{t('orders.empty')}</Text>
                  : orders
                      .slice()
                      .sort((a, b) => new Date(b.order_date).getTime() - new Date(a.order_date).getTime())
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
            )}

            {/* ─ Interactions ─ */}
            {activeTab === 'interactions' && (
              <View style={styles.listTab}>
                {interactions.length === 0
                  ? <Text style={styles.emptyText}>{t('interactions.empty')}</Text>
                  : interactions
                      .slice()
                      .sort((a, b) => new Date(b.scheduled_at ?? 0).getTime() - new Date(a.scheduled_at ?? 0).getTime())
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
            )}

            {/* ─ Équipe ─ */}
            {activeTab === 'team' && (
              <View style={styles.listTab}>
                {team.length === 0
                  ? <Text style={styles.emptyText}>{t('network.empty')}</Text>
                  : team.map(m => (
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
                            {t(`clients.contact_role.${m.contact_role}`)}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))
                }
                <TouchableOpacity style={styles.addRowBtn} onPress={() => router.push(`/(app)/clients/${id}/team` as any)} activeOpacity={0.7}>
                  <Text style={styles.addRowBtnText}>→ {t('clients.tab_team')}</Text>
                </TouchableOpacity>
              </View>
            )}

          </View>
        </ScrollView>
      </View>

      <MessageModal
        visible={messageOpen}
        onClose={() => setMessageOpen(false)}
        client={client ?? null}
        advisorName={session?.user?.user_metadata?.full_name ?? session?.user?.email ?? ''}
        lastProduct={recommendations[0]?.product_name}
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
  hero:          { alignItems: 'center', paddingHorizontal: 24, paddingBottom: 4 },
  bigAvatar:     { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  bigAvatarText: { fontSize: 28, fontFamily: fonts.bold },
  heroName:      { fontSize: 26, fontFamily: fonts.display, color: colors.text, textAlign: 'center', marginBottom: 10 },
  heroBadges:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  heroPill:      { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 9999 },
  heroPillText:  { fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.8 },

  kpiStrip:  { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 8, width: '100%', ...CARD_SHADOW },
  kpiCol:    { flex: 1, alignItems: 'center', gap: 5 },
  kpiDivider:{ width: 1, height: 32, backgroundColor: colors.border },
  kpiLabel:  { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },
  kpiValue:  { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  kpiSourceLabel: { fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary, marginTop: 1 },

  // ── Quick actions ──────────────────────────────────────────────────────────
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 12 },
  qaBtn:  { flexGrow: 1, flexBasis: 112, minWidth: 100, maxWidth: 160, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: colors.card, borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: colors.border },
  qaIcon: { fontSize: 20 },
  qaLabel:{ fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
  qaSubLabel: { fontSize: 9.5, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'center' },

  // ── Tab bar ────────────────────────────────────────────────────────────────
  tabScroll: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border, marginTop: 20 },
  tabRow:    { flexDirection: 'row', paddingHorizontal: 12 },
  tabBtn:    { paddingHorizontal: 14, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: 'transparent', marginRight: 2 },
  tabBtnActive:   { borderBottomColor: colors.primaryAction },
  tabLabel:       { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },
  tabLabelActive: { color: colors.primaryAction, fontFamily: fonts.semibold },

  // ── Tab content ────────────────────────────────────────────────────────────
  tabContent: { padding: 16, gap: 12 },

  // Section cards
  card:       { backgroundColor: colors.card, borderRadius: 16, padding: 20, gap: 14, ...CARD_SHADOW },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardTitle:  { fontSize: 16, fontFamily: fonts.semibold, color: colors.text, flex: 1 },
  cardMenu:   { fontSize: 20, color: colors.textTertiary, lineHeight: 24 },
  iconBox:    { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  iconBoxEmoji: { fontSize: 14 },

  // Field rows
  fieldBlock: { gap: 3, flex: 1 },
  fieldLabel: { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 0.8 },
  fieldValue: { fontSize: 14, fontFamily: fonts.body, color: colors.text, lineHeight: 20 },

  // Field grid (2 columns, icon + label/value)
  fieldGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  fieldGridItem:  { flexDirection: 'row', gap: 10, alignItems: 'flex-start', width: '44%', minWidth: 150 },
  fieldIconBox:   { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.surfaceContainer, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  fieldIconEmoji: { fontSize: 14 },

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

  listCard:       { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 6, flexDirection: 'row', alignItems: 'flex-start', ...CARD_SHADOW },
  listCardDone:   { opacity: 0.55 },
  listCardLeft:   { flex: 1, gap: 4 },
  timelineIcon:   { fontSize: 18, lineHeight: 22 },
  listCardTitle:  { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  listCardDate:   { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },
  listCardDateStrike: { textDecorationLine: 'line-through', color: colors.textTertiary },
  listCardSub:    { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
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
