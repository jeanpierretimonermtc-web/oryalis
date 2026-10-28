import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, Image, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native'
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClients, useClientSearch, useActionAvailability, type ClientActionResource } from '@/features/clients/useClients'
import { archiveClient, deleteClient } from '@/features/clients/clientService'
import { useContactQuota } from '@/features/clients/useContactQuota'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { LinearGradient } from 'expo-linear-gradient'
import { EmptyState } from '@/shared/components/ui/EmptyState'
import { AnchoredMenu } from '@/shared/components/ui/AnchoredMenu'
import { LineIcon } from '@/shared/components/ui/LineIcon'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { colors as brandColors, hexToRgba, type ThemeColors } from '@/shared/theme/colors'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { gravatarUrl } from '@/shared/lib/gravatar'
import { fonts } from '@/shared/theme/fonts'
import type { ClientListItem, ContactRole, PipelineStage } from '@/shared/lib/types'
import { computeRelationshipHealth, type RelationshipHealthInput } from '@/features/clients/relationshipHealth'
import { URGENCY_WINDOWS, isInUrgencyWindow, clientHasActionInWindow, type UrgencyWindow } from '@/features/clients/actionWindows'
import { findDuplicates, type DuplicateReason } from '@/features/clients/duplicates'
import { ContactsExamplePreview } from '@/features/clients/ContactsExamplePreview'

// CONTACTS-SEGMENTS-1 — 3 populations lisibles en un clic au lieu de 7 rôles techniques.
// "Partenaires" regroupe distributeur/leader/membre d'équipe (sous-filtres conservés). Un
// contact multi-rôles (client ET distributeur) apparaît dans chaque segment concerné : rien ne se
// perd, contrairement à des cases étanches.
type Segment = 'all' | 'prospect' | 'customer' | 'partner'
const SEGMENTS: Segment[] = ['all', 'prospect', 'customer', 'partner']
const PARTNER_ROLES: ContactRole[] = ['distributor', 'leader', 'team_member']
const SEGMENT_LABEL_KEY: Record<Segment, string> = {
  all: 'clients.filter_all', prospect: 'clients.segment_prospects',
  customer: 'clients.segment_customers', partner: 'clients.segment_partners',
}

function inSegment(c: ClientListItem, s: Segment): boolean {
  if (s === 'all') return true
  if (s === 'partner') return c.contact_role.some(r => PARTNER_ROLES.includes(r))
  return c.contact_role.includes(s)
}

// Filtres rapides, choix unique : chacun pilote les états existants (actionFilter/horizon) ou
// un filtre ponctuel (prospects chauds, VIP) — jamais un second moteur de filtrage.
type QuickFilter = 'all' | 'overdue' | 'todo' | 'none' | 'hot' | 'vip' | 'inactive' | 'duplicates'
const QUICK_FILTERS: QuickFilter[] = ['all', 'overdue', 'todo', 'none', 'hot', 'vip', 'inactive', 'duplicates']
type ExtraFilter = 'hot' | 'vip' | 'inactive' | 'duplicates' | null

// ACTION-3.2 — filtre "ce qui nécessite mon attention", dérivé uniquement de next_action_at
// (déjà calculé côté DB, voir clients.next_action_* / migration 20260712_contact_activity_
// summary.sql). Aucun nouveau moteur de priorité : "À traiter" = a une prochaine action
// programmée ; "Sans action" = son exact complément (lecture seule, ne crée jamais de relance).
type ActionFilter = 'all' | 'todo' | 'none'
const ACTION_FILTERS: ActionFilter[] = ['all', 'todo', 'none']

// ACTION-3.3 — filtres secondaires de "À traiter", visibles seulement quand ce filtre est
// actif. Horizon : borne SUPÉRIEURE uniquement sur next_action_at (jamais de borne inférieure
// >= maintenant, pour ne jamais exclure les retards — audit next-action-filters §7/§2).
type CumulativeHorizon = 'today' | '3d' | '7d' | '14d' | '30d' | 'all'
// DASH-URGENCY-1 — fenêtres strictes, atteintes uniquement depuis les compteurs d'urgence du
// dashboard (paramètre d'URL `horizon`), jamais proposées dans le sélecteur ci-dessous : le
// sélecteur garde ses horizons cumulatifs, l'utilisateur peut y revenir à tout moment.
type HorizonFilter = CumulativeHorizon | UrgencyWindow
const HORIZON_OPTIONS: CumulativeHorizon[] = ['today', '3d', '7d', '14d', '30d', 'all']
const HORIZON_DAYS: Record<CumulativeHorizon, number | null> = { today: 0, '3d': 3, '7d': 7, '14d': 14, '30d': 30, all: null }
const HORIZON_LABEL_KEY: Record<HorizonFilter, string> = {
  today: 'clients.timeline_today', '3d': 'clients.horizon_3d', '7d': 'clients.horizon_7d',
  '14d': 'clients.horizon_14d', '30d': 'clients.horizon_30d', all: 'clients.horizon_all',
  overdue: 'clients.horizon_overdue', due_today: 'clients.horizon_due_today', next_7d: 'clients.horizon_next_7d',
}

function isUrgencyWindow(h: HorizonFilter): h is UrgencyWindow {
  return (URGENCY_WINDOWS as string[]).includes(h)
}

// Type d'action : exclusivement next_action_source (jamais next_action_type — l'audit a
// confirmé que next_action_type='rdv' peut aussi représenter certaines interactions, ce qui
// mélangerait silencieusement deux catégories différentes).
type SourceFilter = 'all' | 'appointment' | 'followup' | 'interaction'
const SOURCE_OPTIONS: SourceFilter[] = ['all', 'appointment', 'followup', 'interaction']
const SOURCE_LABEL_KEY: Record<SourceFilter, string> = {
  all: 'clients.source_filter_all', appointment: 'clients.next_action_source_appointment',
  followup: 'clients.next_action_source_followup', interaction: 'clients.next_action_source_interaction',
}

// Borne supérieure en millisecondes, ou null pour "Toutes les échéances" (aucune borne).
// ACTION-3.4 — journée calendaire complète (fin de J+N à 23:59:59.999), jamais une fenêtre
// glissante en heures : "7 jours" un vendredi 18h doit inclure un RDV vendredi suivant 20h,
// pas seulement jusqu'à vendredi suivant 18h. "Aujourd'hui" = N=0, même formule.
function horizonUpperBoundMs(h: CumulativeHorizon): number | null {
  if (h === 'all') return null
  const end = new Date()
  end.setDate(end.getDate() + (HORIZON_DAYS[h] as number))
  end.setHours(23, 59, 59, 999)
  return end.getTime()
}

function matchesHorizon(at: string, h: HorizonFilter): boolean {
  if (isUrgencyWindow(h)) return isInUrgencyWindow(at, h)
  const upperBound = horizonUpperBoundMs(h)
  return upperBound === null || new Date(at).getTime() <= upperBound
}

// Dimensions du petit menu ancré desktop web (ACTION-3.3) — même principe de bornage écran
// que le menu "+" de la fiche contact (ACTION-2.1), écrit ici indépendamment pour ne pas
// toucher à ce fichier hors périmètre.
const PICKER_W      = 220
const PICKER_EST_H  = 280

// Mêmes règles/notation que la fiche contact (relativeDayLabel/daysUntil/nextActionUrgency de
// clients/[id]/index.tsx) — dupliquées ici à l'identique plutôt que factorisées, pour ne pas
// toucher à ce fichier hors périmètre (ACTION-3 ne modifie ni la fiche contact ni son moteur).
function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86400000)
}

function relativeDayLabel(dateStr: string, t: (key: string) => string): string {
  const diffDays = daysUntil(dateStr)
  if (diffDays === 0) return t('clients.timeline_today')
  return diffDays > 0 ? `${t('clients.timeline_day_plus')}${diffDays}` : `${t('clients.timeline_day_minus')}${Math.abs(diffDays)}`
}

const NEXT_ACTION_SOURCE_EMOJI: Record<string, string> = {
  appointment: '📅', followup: '🔔', interaction: '💬',
}

type NextActionTier = 'overdue' | 'today' | 'tomorrow' | 'later'

// ACTION-3.5 — quand un type précis est sélectionné (À traiter → RDV/Relance/Interaction), la
// carte doit refléter L'ACTION DE CE TYPE (issue des maps groupées), pas systématiquement la
// prochaine action GLOBALE du contact (next_action_*) — sinon le filtre serait correct mais
// l'interface semblerait incohérente (audit dédié, §8).
// ACTION-3.6 — "Tous types" utilise désormais lui aussi un override : l'UNION des 3 familles
// (allTypeActionsByClient), jamais next_action_* seul, qui masquait relances/interactions
// derrière un RDV concurrent plus urgent au sens du trigger (audit dédié).
type ActionOverride = { source: Exclude<SourceFilter, 'all'>; at: string } | null

// CONTACTS-3.6 — une ressource réelle (id inclus, pas seulement sa date) : nécessaire pour que
// le dépliage "+N autres actions" puisse naviguer vers CHAQUE ressource exacte (fiche RDV,
// ?focus=<id> relance/interaction — réutilise CONTACT-4.2, aucune nouvelle route).
type ContactAction = { source: Exclude<SourceFilter, 'all'>; id: string; at: string }

// Une seule information : source de l'action + échéance — jamais le détail (raison, notes...),
// qui reste dans la fiche contact. Le tri "à échéance identique" de ACTION-3.2 réutilise
// directement next_action_at (ordre chronologique croissant), sans score parallèle.
function nextActionSummary(
  client: ClientListItem,
  t: (key: string) => string,
  override?: ActionOverride,
): { text: string; emoji: string; tier: NextActionTier } | null {
  const source = override ? override.source : client.next_action_source
  const at     = override ? override.at     : client.next_action_at
  if (!at) return null
  const diffDays = daysUntil(at)
  const tier: NextActionTier = diffDays < 0 ? 'overdue' : diffDays === 0 ? 'today' : diffDays === 1 ? 'tomorrow' : 'later'
  const sourceLabel = source
    ? t(`clients.next_action_source_${source}`)
    : client.next_action_type
    ? t(`next_action_types.${client.next_action_type}`)
    : ''
  const dayLabel = relativeDayLabel(at, t)
  const emoji = tier === 'overdue' ? '🔴' : tier === 'today' ? '🟠' : (NEXT_ACTION_SOURCE_EMOJI[source ?? ''] ?? '📅')
  const text = tier === 'overdue'
    ? `${sourceLabel} ${t('clients.next_action_overdue').toLowerCase()} · ${dayLabel}`
    : tier === 'today'
    ? `${sourceLabel} ${t('clients.timeline_today').toLowerCase()}`
    : `${sourceLabel} · ${dayLabel}`
  return { text, emoji, tier }
}

function initials(name: string) {
  const parts = name.trim().split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Couleur par rôle (pas par santé relationnelle, déjà visible via HealthPill à côté) —
// même palette que les filtres de rôle et la fiche contact (getRoleColors/getPrimaryRole).
// Ordre de priorité de la photo : upload manuel → Gravatar (si un email existe) → initiales.
function ClientAvatar({ name, avatarUrl, contactRole, email }: { name: string; avatarUrl: string | null; contactRole: ContactRole[]; email: string | null }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const rc = getRoleColors(getPrimaryRole(contactRole), colors)
  const [gravatarFailed, setGravatarFailed] = useState(false)
  const photoUrl = avatarUrl ?? (email && !gravatarFailed ? gravatarUrl(email) : null)
  if (photoUrl) {
    return (
      <View style={[styles.avatarRing, { borderColor: rc.text }]}>
        <Image
          source={{ uri: photoUrl }}
          style={styles.avatarRingImg}
          onError={() => { if (!avatarUrl) setGravatarFailed(true) }}
        />
      </View>
    )
  }
  return (
    <View style={[styles.avatar, { backgroundColor: rc.bg }]}>
      <Text style={[styles.avatarText, { color: rc.text }]}>{initials(name)}</Text>
    </View>
  )
}

function HealthPill({ health }: { health: RelationshipHealthInput }) {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { tier } = computeRelationshipHealth(health)
  // DESIGN-A — l'état du suivi ne s'affiche que s'il appelle une attention (en retard, à
  // relancer, dormant) : "À jour" n'a pas besoin de badge, et son vert se confondait avec la
  // couleur du rôle Client juste à côté.
  if (tier === 'up_to_date') return null
  const sc = statusColors[tier] ?? { bg: colors.surfaceContainerHighest, text: colors.textTertiary }
  return (
    <View style={[styles.pill, { backgroundColor: sc.bg }]}>
      <Text style={[styles.pillText, { color: sc.text }]}>{t(`relationship_health.${tier}`)}</Text>
    </View>
  )
}

function RolePill({ role }: { role: ContactRole }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { getRoleLabel } = useAppConfig()
  const rc = getRoleColors(role, colors)
  return (
    <View style={[styles.pill, { backgroundColor: rc.bg }]}>
      <Text style={[styles.pillText, { color: rc.text }]}>{getRoleLabel(role)}</Text>
    </View>
  )
}

function VipTag() {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  return (
    <View style={[styles.pill, { backgroundColor: statusColors.vip.bg }]}>
      <Text style={[styles.pillText, { color: statusColors.vip.text }]}>{t('clients.vip_badge')}</Text>
    </View>
  )
}

// CONTACTS-3.6 §13-14 — route existante par famille, jamais une nouvelle : RDV a sa propre
// fiche ; relance/interaction réutilisent ?focus=<id> (CONTACT-4.2, déjà géré par ces écrans).
function actionHref(clientId: string, action: ContactAction): string {
  if (action.source === 'appointment') {
    return `/(app)/appointments/${action.id}?returnTo=${encodeURIComponent('/(app)/clients')}`
  }
  if (action.source === 'followup') return `/(app)/clients/${clientId}/followups?focus=${action.id}`
  return `/(app)/clients/${clientId}/interactions?focus=${action.id}`
}

// ACTION-3.1 — ligne compacte "prochaine action" : une seule information (source + échéance),
// jamais plusieurs lignes de détail (le détail reste dans la fiche contact). Remplace l'ancien
// indicateur RDV-seul (nextRdvMap/lastRdvMap) qu'elle généralise : next_action_* couvre déjà
// RDV, relance et interaction, les deux affichages auraient fait doublon.
// CONTACTS-3.6 — otherActions/isExpanded/onToggleExpanded : "Tous types" uniquement (toujours
// vide pour les filtres spécifiques, donc rien de nouveau ne s'affiche pour eux, §11).
function NextActionRow({
  client, override, otherActions = [], isExpanded = false, onToggleExpanded,
}: {
  client: ClientListItem
  override?: ActionOverride
  otherActions?: ContactAction[]
  isExpanded?: boolean
  onToggleExpanded?: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const summary = nextActionSummary(client, t, override)

  if (!summary) {
    return (
      <View style={styles.infoRow}>
        <Text style={[styles.infoText, styles.infoMuted]}>{t('clients.next_action_empty')}</Text>
      </View>
    )
  }

  const color = summary.tier === 'overdue' ? colors.danger
    : summary.tier === 'today'   ? colors.warning
    : summary.tier === 'tomorrow' ? colors.text
    : colors.textTertiary
  const weight = summary.tier === 'overdue' || summary.tier === 'today' ? fonts.semibold : fonts.medium

  return (
    <View>
      <View style={styles.infoRow}>
        <Text style={styles.infoIcon}>{summary.emoji}</Text>
        <Text style={[styles.infoText, { color, fontFamily: weight }]} numberOfLines={1}>{summary.text}</Text>
      </View>
      {/* CONTACTS-3.6 §1-2 — le texte devient une zone cliquable qui déplie/replie localement,
          compteur EXACT de ressources restantes (jamais un nombre de types, jamais affiché pour
          les filtres RDV/Relance/Interaction spécifiques — une seule action déjà sans
          ambiguïté). */}
      {otherActions.length > 0 ? (
        <TouchableOpacity onPress={onToggleExpanded} style={styles.othersToggleRow} activeOpacity={0.7}>
          <Text style={styles.othersCountText}>
            {isExpanded ? t('clients.hide_other_actions') : `+${otherActions.length} ${t('dashboard.other_actions')}`}
          </Text>
          <Text style={styles.othersToggleChevron}>{isExpanded ? '⌃' : '›'}</Text>
        </TouchableOpacity>
      ) : null}
      {/* §5-6-15 — tri chronologique déjà garanti en amont (allTypeActionsByClient), action
          principale déjà exclue (otherActions = actions.slice(1)) ; réutilise nextActionSummary
          pour un libellé/couleur strictement identiques à la ligne principale (§6-7). */}
      {isExpanded && otherActions.length > 0 ? (
        <View style={styles.otherActionsList}>
          {otherActions.map(action => {
            const actionSummary = nextActionSummary(client, t, { source: action.source, at: action.at })
            if (!actionSummary) return null
            const actionColor = actionSummary.tier === 'overdue' ? colors.danger
              : actionSummary.tier === 'today' ? colors.warning
              : actionSummary.tier === 'tomorrow' ? colors.text
              : colors.textTertiary
            return (
              <TouchableOpacity
                key={`${action.source}-${action.id}`}
                style={styles.otherActionRow}
                onPress={() => router.push(actionHref(client.id, action) as any)}
                activeOpacity={0.7}
              >
                <Text style={styles.infoIcon}>{actionSummary.emoji}</Text>
                <Text style={[styles.infoText, { color: actionColor }]} numberOfLines={1}>{actionSummary.text}</Text>
                <Text style={styles.otherActionChevron}>›</Text>
              </TouchableOpacity>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

function ClientCard({
  client, actionOverride, otherActions = [], isActionsExpanded = false, onToggleActionsExpanded, onMenuPress, duplicateReasons,
}: {
  client: ClientListItem
  actionOverride?: ActionOverride
  otherActions?: ContactAction[]
  isActionsExpanded?: boolean
  onToggleActionsExpanded?: () => void
  onMenuPress: (c: ClientListItem, pos: { x: number; y: number }) => void
  duplicateReasons?: DuplicateReason[]
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { getPipelineStageLabel } = useAppConfig()

  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        {/* Top: avatar + name/badge + score + menu */}
        <View style={styles.cardTop}>
          <ClientAvatar name={client.full_name} avatarUrl={client.avatar_url} contactRole={client.contact_role} email={client.email} />
          <View style={styles.cardTitle}>
            <Text style={styles.cardName}>{client.full_name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <HealthPill health={client} />
              {client.is_vip ? <VipTag /> : null}
              {/* "customer" (Client) doit s'afficher comme n'importe quel autre rôle — voir
                  fiche contact (clients/[id]/index.tsx) où le même correctif a été appliqué. */}
              {client.contact_role.map(role => <RolePill key={role} role={role} />)}
            </View>
            {/* Distincte des pills de rôle ci-dessus (même libellé possible pour customer/
                distributor — voir getPipelineStageLabel) : un libellé de contexte + un texte
                simple, sans fond coloré, pour ne jamais se confondre visuellement avec un
                badge de rôle (audit libellés/pipeline). */}
            <View style={styles.pipelineContextRow}>
              <Text style={styles.pipelineContextLabel}>{t('clients.fields.pipeline_stage')}</Text>
              <Text style={styles.pipelineContextValue}>{getPipelineStageLabel(client.pipeline_stage)}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.menuBtn}
            onPress={(e) => onMenuPress(client, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('common.more_options')}
          >
            <Text style={styles.menuDots}>⋮</Text>
          </TouchableOpacity>
        </View>

        {duplicateReasons && duplicateReasons.length > 0 ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>⚠</Text>
            <Text style={[styles.infoText, { color: colors.tertiary, fontFamily: fonts.semibold }]} numberOfLines={1}>
              {t('clients.duplicate_reasons', { reasons: duplicateReasons.map(r => t(`clients.duplicate_reason_${r}`)).join(', ') })}
            </Text>
          </View>
        ) : null}

        {/* Info rows */}
        {client.email ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>✉</Text>
            <Text style={styles.infoText} numberOfLines={1}>{client.email}</Text>
          </View>
        ) : null}
        {client.phone ? (
          <View style={styles.infoRow}>
            <Text style={styles.infoIcon}>📞</Text>
            <Text style={styles.infoText}>{client.phone}</Text>
          </View>
        ) : null}
        <NextActionRow
          client={client}
          override={actionOverride}
          otherActions={otherActions}
          isExpanded={isActionsExpanded}
          onToggleExpanded={onToggleActionsExpanded}
        />
      </View>

      {/* Actions */}
      <View style={styles.cardActions}>
        <TouchableOpacity
          style={styles.btnOutline}
          onPress={() => router.push(`/(app)/clients/${client.id}`)}
          activeOpacity={0.7}
        >
          <LineIcon name="eye" size={15} color={colors.text} strokeWidth={2} />
          <Text style={styles.btnOutlineText}>{t('clients.view')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnFill}
          onPress={() => router.push(`/(app)/appointments/new?clientId=${client.id}&returnTo=${encodeURIComponent('/(app)/clients')}` as any)}
          activeOpacity={0.8}
        >
          <LineIcon name="calendarPlus" size={15} color={colors.textInverse} strokeWidth={2} />
          <Text style={styles.btnFillText}>{t('clients.add_appt')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

export default function ClientsScreen() {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { status: statusParam, pipeline: pipelineParam, action: actionParam, horizon: horizonParam } =
    useLocalSearchParams<{ status?: ContactRole | 'all' | 'vip'; pipeline?: PipelineStage; action?: ActionFilter; horizon?: HorizonFilter }>()
  const [query, setQuery] = useState('')
  // Debounce local (P2.2.1) : évite une requête Supabase à chaque frappe ("martin" tapé vite
  // ne doit produire qu'1 recherche, pas 6). L'effacement du champ (query === '') contourne
  // volontairement le délai — c'est une action délibérée, pas une frappe à tempériser.
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    if (query.length === 0) { setDebouncedQuery(''); return }
    const timer = setTimeout(() => setDebouncedQuery(query), 350)
    return () => clearTimeout(timer)
  }, [query])
  const [segment, setSegment] = useState<Segment>('all')
  const [partnerRole, setPartnerRole] = useState<ContactRole | null>(null)
  const [extraFilter, setExtraFilter] = useState<ExtraFilter>(null)
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStage | null>(pipelineParam ?? null)
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  // ACTION-3.3 — pas de persistance (§13) : simples useState, valeurs par défaut à chaque
  // ouverture de l'écran, jamais lues/écrites dans AsyncStorage.
  const [horizonFilter, setHorizonFilter] = useState<HorizonFilter>('7d')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [openPicker, setOpenPicker] = useState<'horizon' | 'source' | null>(null)
  const [pickerPos, setPickerPos] = useState({ x: 0, y: 0 })
  // CONTACTS-3.6 — dépliage "+N autres actions" (Tous types uniquement) : état purement local
  // au rendu de l'écran, jamais persisté. Un contact ouvert n'ouvre pas les autres (Set, pas un
  // simple id). Réinitialisé au changement de filtre/horizon pour ne jamais laisser une carte
  // dépliée « polluer » une autre vue (§10) — voir l'effet juste après le mémo des actions.
  const [expandedActionClientIds, setExpandedActionClientIds] = useState<Set<string>>(new Set())
  const { session } = useAuth()
  const { clients, loading, refresh } = useClients()
  const { quota, refresh: refreshQuota } = useContactQuota()
  const { results, search } = useClientSearch()
  // ACTION-3.5 — 3 requêtes groupées par utilisateur (jamais une par contact), chargées une
  // fois pour toute la session de cet écran puis filtrées localement : changer d'horizon ou de
  // type ne redéclenche aucune requête réseau (voir todoFiltered plus bas).
  const {
    appointmentMap, followupMap, interactionMap,
    appointmentAllMap, followupAllMap, interactionAllMap,
    hotClientIds,
    loading: actionsLoading, refresh: refreshActions,
  } = useActionAvailability(session?.user?.id)
  const { labels: statusLabels, getRoleLabel, getPipelineStageLabel } = useAppConfig()
  const { width } = useWindowDimensions()
  const isWide = width >= 768

  const [menuClient, setMenuClient]       = useState<ClientListItem | null>(null)
  const [menuPos, setMenuPos]             = useState({ x: 0, y: 0 })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [deleting, setDeleting]           = useState(false)

  function closeMenu() { setMenuClient(null); setConfirmDelete(false); setConfirmArchive(false) }

  async function handleArchive() {
    if (!menuClient) return
    setDeleting(true)
    try {
      await archiveClient(menuClient.id)
      closeMenu()
      await Promise.all([refresh(), refreshQuota()])
    } catch (e) {
      console.error('[archiveClient]', e)
    } finally {
      setDeleting(false)
    }
  }

  async function handleDelete() {
    if (!menuClient) return
    setDeleting(true)
    try {
      await deleteClient(menuClient.id)
      closeMenu()
      refresh()
    } catch (e) {
      console.error('[deleteClient]', e)
    } finally {
      setDeleting(false)
    }
  }

  useFocusEffect(useCallback(() => { refresh(); refreshActions() }, []))

  // Paramètre `status` historique (dashboard, autres écrans) : traduit vers segment / sous-rôle
  // partenaire / filtre VIP, pour que les anciens liens continuent d'ouvrir la même population.
  useEffect(() => {
    if (!statusParam) return
    setPartnerRole(null)
    setExtraFilter(null)
    if (statusParam === 'all') setSegment('all')
    else if (statusParam === 'vip') { setSegment('all'); setExtraFilter('vip'); setActionFilter('all') }
    else if (statusParam === 'prospect' || statusParam === 'customer') setSegment(statusParam)
    else if (PARTNER_ROLES.includes(statusParam)) { setSegment('partner'); setPartnerRole(statusParam) }
  }, [statusParam])

  useEffect(() => { setPipelineFilter(pipelineParam ?? null) }, [pipelineParam])

  // DASH-URGENCY-1 — arrivée depuis un compteur d'urgence du dashboard : applique exactement le
  // filtre du compteur (type "Tous types", sinon la liste ne correspondrait plus au chiffre).
  useEffect(() => {
    // Lien explicite vers une population sans filtre d'action (ex. "Total contacts") : repart de
    // "Tous", jamais du dernier filtre rapide resté actif sur cet écran réutilisé.
    if (!actionParam && !horizonParam && statusParam && statusParam !== 'vip') setActionFilter('all')
    if (actionParam && ACTION_FILTERS.includes(actionParam)) setActionFilter(actionParam)
    if (horizonParam && (HORIZON_OPTIONS as string[]).concat(URGENCY_WINDOWS).includes(horizonParam)) {
      setHorizonFilter(horizonParam)
      setSourceFilter('all')
    }
  }, [actionParam, horizonParam])

  useEffect(() => {
    // Seuil de 2 caractères : cohérent avec searchClientsForPicker() (même codebase), un
    // seul caractère est trop peu sélectif pour une recherche serveur sur full_name.
    // Recherche serveur toujours tous rôles : le segment (y compris "Partenaires", qui couvre 3
    // rôles) est appliqué localement ci-dessous, comme pour la liste complète.
    if (debouncedQuery.length >= 2) search(debouncedQuery)
  }, [debouncedQuery])


  const baseDisplayed: ClientListItem[] = debouncedQuery.length >= 2 ? results : clients
  const actionMaps = useMemo(
    () => ({ appointment: appointmentAllMap, followup: followupAllMap, interaction: interactionAllMap }),
    [appointmentAllMap, followupAllMap, interactionAllMap],
  )

  // Compteurs par segment (total + contacts en retard), calculés sur la même base que la liste.
  const segmentCounts = useMemo(() => {
    const counts = {} as Record<Segment, { total: number; overdue: number }>
    for (const s of SEGMENTS) {
      const members = baseDisplayed.filter(c => inSegment(c, s))
      counts[s] = { total: members.length, overdue: members.filter(c => clientHasActionInWindow(c.id, actionMaps, 'overdue')).length }
    }
    return counts
  }, [baseDisplayed, actionMaps])

  const segmentFiltered = baseDisplayed
    .filter(c => inSegment(c, segment))
    .filter(c => !partnerRole || c.contact_role.includes(partnerRole))
  const displayed = pipelineFilter ? segmentFiltered.filter(c => c.pipeline_stage === pipelineFilter) : segmentFiltered

  const noActionContacts = useMemo(() => displayed.filter(c => !c.next_action_at), [displayed])
  const hotContacts = useMemo(() => displayed.filter(c => hotClientIds.has(c.id)), [displayed, hotClientIds])
  const vipContacts = useMemo(() => displayed.filter(c => c.is_vip), [displayed])
  // Inactifs = rôle Inactif OU marqué inactif à la main dans la fiche (manually_inactive) —
  // jamais "Dormant", qui décrit seulement l'absence de contact récent avec un contact actif.
  const inactiveContacts = useMemo(() => displayed.filter(c => c.manually_inactive || c.contact_role.includes('inactive')), [displayed])
  // CONTACTS-DUPLICATES-1 — détection sur TOUS les contacts actifs (un doublon peut être rangé
  // dans un autre segment), puis restreinte aux contacts affichés ; groupes côte à côte.
  const duplicateInfo = useMemo(() => findDuplicates(clients), [clients])
  const duplicateContacts = useMemo(
    () => displayed
      .filter(c => duplicateInfo.has(c.id))
      .sort((a, b) => duplicateInfo.get(a.id)!.groupId.localeCompare(duplicateInfo.get(b.id)!.groupId) || a.full_name.localeCompare(b.full_name)),
    [displayed, duplicateInfo],
  )
  const overdueCount = useMemo(
    () => displayed.filter(c => clientHasActionInWindow(c.id, actionMaps, 'overdue')).length,
    [displayed, actionMaps],
  )
  // "À traiter" : horizon choisi si ce filtre est actif, sinon horizon par défaut (7 jours).
  const defaultTodoCount = useMemo(
    () => displayed.filter(c => (['appointment', 'followup', 'interaction'] as const)
      .some(src => (actionMaps[src][c.id] ?? []).some(r => matchesHorizon(r.at, '7d')))).length,
    [displayed, actionMaps],
  )

  // ACTION-3.5 — l'audit dédié a confirmé que next_action_source ne répond pas à "ce contact
  // a-t-il une action de CE type ?" mais seulement à "quelle est SA prochaine action, tous
  // types confondus ?" (LA valeur unique choisie par le trigger DB). RDV/Relance/Interaction
  // utilisent les maps groupées ci-dessus (une entrée par contact = sa date la plus proche de
  // ce type), purement en mémoire — aucune requête supplémentaire à ce stade.
  const TYPE_MAP: Record<Exclude<SourceFilter, 'all'>, Record<string, string>> =
    { appointment: appointmentMap, followup: followupMap, interaction: interactionMap }
  const TYPE_ALL_MAP: Record<Exclude<SourceFilter, 'all'>, Record<string, ClientActionResource[]>> =
    { appointment: appointmentAllMap, followup: followupAllMap, interaction: interactionAllMap }

  // CONTACTS-3.6 — "Tous types" devient l'UNION réelle des 3 familles (audit dédié) : un
  // contact apparaît s'il a au moins une ressource active (RDV, relance OU interaction) dans
  // l'horizon, jamais seulement s'il "gagne" au sens next_action_*. Construit en filtrant
  // `displayed` (déjà 1 ligne par contact) — jamais en concaténant/flatMap-ant les 3 familles —
  // donc un contact ne peut mécaniquement apparaître qu'une seule fois. Utilise les *AllMap
  // (id + date de CHAQUE ressource par type, pas seulement la plus proche) pour que le
  // compteur "+N autres actions" corresponde au nombre RÉEL de ressources, jamais au nombre de
  // types présents, et pour pouvoir cibler exactement chaque ressource au clic (§13-14).
  const allTypeActionsByClient = useMemo(() => {
    const inHorizon = (at: string) => matchesHorizon(at, horizonFilter)
    const map: Record<string, ContactAction[]> = {}
    for (const c of displayed) {
      const actions: ContactAction[] = []
      for (const source of ['appointment', 'followup', 'interaction'] as const) {
        for (const res of TYPE_ALL_MAP[source][c.id] ?? []) {
          if (inHorizon(res.at)) actions.push({ source, id: res.id, at: res.at })
        }
      }
      actions.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      map[c.id] = actions
    }
    return map
  }, [displayed, horizonFilter, appointmentAllMap, followupAllMap, interactionAllMap])

  // CONTACTS-3.6 §10 — un changement de filtre type/horizon referme toutes les cartes dépliées :
  // les "autres actions" affichées dépendaient de l'ancien filtre, jamais reportées sur le nouveau.
  useEffect(() => { setExpandedActionClientIds(new Set()) }, [sourceFilter, horizonFilter])

  function toggleActionExpanded(clientId: string) {
    setExpandedActionClientIds(prev => {
      const next = new Set(prev)
      next.has(clientId) ? next.delete(clientId) : next.add(clientId)
      return next
    })
  }

  const todoFiltered = useMemo(() => {
    if (sourceFilter === 'all') {
      return displayed
        .filter(c => allTypeActionsByClient[c.id]?.length > 0)
        .sort((a, b) => new Date(allTypeActionsByClient[a.id][0].at).getTime() - new Date(allTypeActionsByClient[b.id][0].at).getTime())
    }
    const map = TYPE_MAP[sourceFilter]
    // Fenêtre stricte : "a au moins une action de ce type dans la fenêtre" (toutes les dates),
    // jamais la seule plus proche — sinon une relance en retard masquerait celle d'aujourd'hui.
    const allMap = TYPE_ALL_MAP[sourceFilter]
    return displayed
      .filter(c => {
        if (isUrgencyWindow(horizonFilter)) return (allMap[c.id] ?? []).some(r => matchesHorizon(r.at, horizonFilter))
        const at = map[c.id]
        return !!at && matchesHorizon(at, horizonFilter)
      })
      .sort((a, b) => new Date(map[a.id]).getTime() - new Date(map[b.id]).getTime())
  }, [displayed, sourceFilter, horizonFilter, allTypeActionsByClient, appointmentMap, followupMap, interactionMap, appointmentAllMap, followupAllMap, interactionAllMap])

  const actionFiltered = actionFilter === 'todo' ? todoFiltered
    : actionFilter === 'none' ? noActionContacts
    : extraFilter === 'hot' ? hotContacts
    : extraFilter === 'vip' ? vipContacts
    : extraFilter === 'inactive' ? inactiveContacts
    : extraFilter === 'duplicates' ? duplicateContacts
    : displayed

  const activeQuick: QuickFilter =
    actionFilter === 'todo' ? (horizonFilter === 'overdue' ? 'overdue' : 'todo')
    : actionFilter === 'none' ? 'none'
    : extraFilter ?? 'all'

  function applyQuick(q: QuickFilter) {
    setExtraFilter(q === 'hot' || q === 'vip' || q === 'inactive' || q === 'duplicates' ? q : null)
    if (q === 'overdue') { setActionFilter('todo'); setHorizonFilter('overdue'); setSourceFilter('all') }
    else if (q === 'todo') { setActionFilter('todo'); if (isUrgencyWindow(horizonFilter)) setHorizonFilter('7d') }
    else if (q === 'none') setActionFilter('none')
    else setActionFilter('all')
  }

  const quickCount: Record<QuickFilter, number> = {
    all: displayed.length,
    overdue: overdueCount,
    todo: activeQuick === 'todo' ? todoFiltered.length : defaultTodoCount,
    none: noActionContacts.length,
    hot: hotContacts.length,
    vip: vipContacts.length,
    inactive: inactiveContacts.length,
    duplicates: duplicateContacts.length,
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <View style={[styles.inner, isWide && styles.innerWide]}>

        {/* Page header */}
        <View style={styles.pageHeader}>
          {/* DESIGN-A — en-tête d'écran : étiquette + grand titre + synthèse en une ligne. */}
          <View style={styles.pageHeading}>
            <Text style={styles.pageEyebrow}>{t('clients.header_eyebrow')}</Text>
            <Text style={styles.pageTitle}>{t('clients.title')}</Text>
            {clients.length > 0 && (
              <Text style={styles.pageSub}>
                {t('clients.header_count', { count: clients.length })}
                {segmentCounts.all.overdue > 0 ? ` · ${t('clients.segment_overdue', { count: segmentCounts.all.overdue })}` : ''}
              </Text>
            )}
          </View>
          <TouchableOpacity style={styles.archiveLink} onPress={() => router.push('/(app)/clients/archived' as any)}>
            <Text style={styles.archiveLinkText}>{t('clients.archived_title')}</Text>
          </TouchableOpacity>
          {isWide && (
            <TouchableOpacity
              onPress={() => router.push(quota?.reached ? '/(app)/settings-display' : '/(app)/clients/new')}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={brandColors.gradients.brand}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.newClientBtn}
              >
                <LineIcon name="plus" size={16} color="#fff" strokeWidth={2.5} />
                <Text style={styles.newClientBtnText}>{t('clients.add')}</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
        </View>

        {/* CONTACTS-SEGMENTS-1 — niveau 1 : la population (Prospects / Clients / Partenaires),
            avec le nombre de contacts en retard par segment. */}
        <View style={styles.segmentRow}>
          {SEGMENTS.map(s => {
            const active = segment === s
            const { total, overdue } = segmentCounts[s]
            // Couleur d'identité de la population = celle de son badge de rôle sur les cartes
            // (Partenaires = Conseillère, son rôle principal) ; "Tous" reste neutre (bleu nuit).
            const segmentColor = s === 'all' ? null : getRoleColors(s === 'partner' ? 'distributor' : s, colors)
            return (
              <TouchableOpacity
                key={s}
                style={[
                  styles.segmentTab,
                  active && (segmentColor ? { backgroundColor: segmentColor.bg, borderColor: segmentColor.text } : styles.segmentTabActive),
                ]}
                onPress={() => { setSegment(s); setPartnerRole(null); setPipelineFilter(null) }}
                activeOpacity={0.75}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.segmentTabText,
                    segmentColor ? { color: segmentColor.text } : active && styles.segmentTabTextActive,
                    active && { fontFamily: fonts.bold },
                  ]}
                  numberOfLines={1}
                >
                  {t(SEGMENT_LABEL_KEY[s])} · {total}
                </Text>
                {overdue > 0 ? (
                  <Text style={styles.segmentOverdue} numberOfLines={1}>{t('clients.segment_overdue', { count: overdue })}</Text>
                ) : null}
              </TouchableOpacity>
            )
          })}
        </View>

        {segment === 'partner' && (
          <View style={styles.miniFilterRow}>
            {[null, ...PARTNER_ROLES].map(r => {
              const active = partnerRole === r
              // Même code couleur que les badges de rôle des cartes (getRoleColors) : chaque
              // sous-filtre se reconnaît à sa couleur, actif = contour plein de cette couleur.
              const rc = r ? getRoleColors(r, colors) : null
              return (
                <TouchableOpacity
                  key={r ?? 'all'}
                  style={[
                    styles.miniFilterBtn,
                    rc
                      ? { backgroundColor: rc.bg, borderColor: active ? rc.text : rc.bg }
                      : active && styles.miniFilterBtnActive,
                  ]}
                  onPress={() => setPartnerRole(r)}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.miniFilterText,
                    rc ? { color: rc.text, fontFamily: active ? fonts.bold : fonts.semibold } : active && styles.miniFilterTextActive,
                  ]}>
                    {r ? getRoleLabel(r) : t('clients.segment_partners_all')}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
        )}

        {/* Niveau 2 : filtres rapides en un clic (choix unique). */}
        <View style={styles.actionFilterRow}>
          {QUICK_FILTERS.map(q => {
            const active = activeQuick === q
            // DESIGN-A — filtres neutres, actif en bleu adouci (fond teinté + contour, jamais un
            // aplat sombre) ; seul "En retard" garde sa couleur
            // d'alerte quand il existe réellement des retards.
            const idleColor = q === 'overdue' && quickCount.overdue > 0 ? colors.danger : colors.textSecondary
            return (
              <TouchableOpacity
                key={q}
                style={[styles.chip, { backgroundColor: active ? colors.primaryLight : colors.card, borderColor: active ? colors.primary : colors.border }]}
                onPress={() => applyQuick(q)}
                activeOpacity={0.7}
              >
                <Text style={[styles.chipText, { color: active ? colors.primary : idleColor, fontFamily: active ? fonts.bold : fonts.semibold }]}>
                  {t(`clients.quick_filter_${q}`)} · {quickCount[q]}
                </Text>
              </TouchableOpacity>
            )
          })}
        </View>

        {extraFilter === 'duplicates' && (
          <Text style={styles.duplicatesHint}>{t('clients.duplicates_hint')}</Text>
        )}

        {/* ACTION-3.3 — filtres secondaires de "À traiter" uniquement, volontairement plus
            discrets (fond neutre, texte plus petit) que Tous/À traiter/Sans action pour ne pas
            lire comme un second niveau de navigation principal. */}
        {actionFilter === 'todo' && (
          <View style={styles.miniFilterRow}>
            <TouchableOpacity
              style={styles.miniFilterBtn}
              onPress={(e) => {
                setPickerPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })
                setOpenPicker('horizon')
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.miniFilterText}>{t(HORIZON_LABEL_KEY[horizonFilter])} ▾</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.miniFilterBtn}
              onPress={(e) => {
                setPickerPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })
                setOpenPicker('source')
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.miniFilterText}>{t(SOURCE_LABEL_KEY[sourceFilter])} ▾</Text>
            </TouchableOpacity>
          </View>
        )}

        {quota?.limit != null && (
          <TouchableOpacity
            style={[styles.quotaBanner, quota.reached && styles.quotaBannerReached]}
            onPress={() => quota.reached && router.push('/(app)/settings-display')}
            activeOpacity={quota.reached ? 0.8 : 1}
          >
            <Text style={styles.quotaBannerText}>{t('clients.quota_count', { count: quota.activeCount, limit: quota.limit })}</Text>
            {quota.reached && <Text style={styles.quotaBannerAction}>{t('clients.quota_upgrade')}</Text>}
          </TouchableOpacity>
        )}

        {pipelineFilter && (
          <TouchableOpacity style={styles.pipelineFilterBanner} onPress={() => setPipelineFilter(null)}>
            <Text style={styles.pipelineFilterText}>{t('clients.pipeline_filter', { stage: getPipelineStageLabel(pipelineFilter) })}</Text>
            <Text style={styles.pipelineFilterClear}>×</Text>
          </TouchableOpacity>
        )}

        {/* Search */}
        <View style={styles.searchWrap}>
          <Text style={styles.searchEmoji}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t('clients.search')}
            value={query}
            onChangeText={setQuery}
            placeholderTextColor={colors.textTertiary}
            clearButtonMode="while-editing"
          />
        </View>

        {/* List */}
        {/* ACTION-3.5 — les 3 requêtes groupées ne se rechargent qu'une fois par ouverture de
            l'écran (useActionAvailability), jamais au changement d'horizon/type ; ce loading ne
            s'affiche donc qu'à l'ouverture initiale de "À traiter" avec un type précis, pas à
            chaque bascule ensuite — pour ne jamais présenter un ancien résultat comme s'il
            correspondait déjà au nouveau filtre (§15). */}
        {/* ACTION-3.6 — "Tous types" dépend désormais aussi des mêmes maps groupées (union),
            donc ce garde-fou s'applique quel que soit sourceFilter, plus seulement aux filtres
            spécifiques (§15 inchangé : jamais un ancien résultat présenté comme le nouveau). */}
        {(loading || (actionFilter === 'todo' && actionsLoading))
          ? <ActivityIndicator style={styles.loader} color={colors.primaryAction} />
          : (
            <FlatList
              key={isWide ? '2-col' : '1-col'}
              numColumns={isWide ? 2 : 1}
              columnWrapperStyle={isWide ? styles.columnWrapper : undefined}
              data={actionFiltered}
              keyExtractor={c => c.id}
              extraData={[statusLabels, actionFilter, sourceFilter, expandedActionClientIds, extraFilter]}
              renderItem={({ item }) => {
                let actionOverride: ActionOverride = null
                // CONTACTS-3.6 — ressources restantes (hors action principale), uniquement pour
                // "Tous types" : jamais calculé/affiché pour les filtres spécifiques (§11).
                let otherActions: ContactAction[] = []
                if (actionFilter === 'todo') {
                  if (sourceFilter === 'all') {
                    const actions = allTypeActionsByClient[item.id] ?? []
                    if (actions[0]) actionOverride = { source: actions[0].source, at: actions[0].at }
                    otherActions = actions.slice(1)
                  } else {
                    actionOverride = { source: sourceFilter, at: TYPE_MAP[sourceFilter][item.id] }
                  }
                }
                return (
                  <View style={isWide ? styles.colCard : undefined}>
                    <ClientCard
                      client={item}
                      actionOverride={actionOverride}
                      otherActions={otherActions}
                      isActionsExpanded={expandedActionClientIds.has(item.id)}
                      onToggleActionsExpanded={() => toggleActionExpanded(item.id)}
                      onMenuPress={(c, pos) => { setMenuClient(c); setMenuPos(pos) }}
                      duplicateReasons={extraFilter === 'duplicates' ? duplicateInfo.get(item.id)?.reasons : undefined}
                    />
                  </View>
                )
              }}
              ListEmptyComponent={clients.length === 0 && debouncedQuery.length < 2 ? (
                // EMPTY-EXAMPLES-1 — aucun contact du tout : aperçu d'exemple plutôt qu'un écran vide.
                <View style={styles.examplesWrap}>
                  <ContactsExamplePreview compact={!isWide} />
                </View>
              ) : (
                <EmptyState
                  message={extraFilter === 'duplicates' ? t('clients.duplicates_empty')
                    : activeQuick !== 'all' ? t('clients.action_filter_empty')
                    : t('clients.empty')}
                  icon="👥"
                  actionLabel={t('clients.add')}
                  actionVariant="gradient"
                  actionIcon="personPlus"
                  onAction={() => router.push('/(app)/clients/new')}
                />
              )}
              contentContainerStyle={[styles.list, isWide && styles.listWide, actionFiltered.length === 0 && styles.listEmpty]}
              onRefresh={refresh}
              refreshing={loading}
            />
          )
        }

        </View>

        {/* FAB (mobile uniquement — sur web la CTA est dans l'en-tête) */}
        {!isWide && (
          <TouchableOpacity
            style={styles.fab}
            onPress={() => router.push(quota?.reached ? '/(app)/settings-display' : '/(app)/clients/new')}
            activeOpacity={0.85}
            accessibilityLabel={t('clients.add')}
          >
            <LineIcon name="plus" size={26} color={colors.textInverse} strokeWidth={2.5} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── ACTION-3.3 / UI-POPOVER-2.1 — mini-sélecteur horizon/type : menu ancré
          identique sur toutes les plateformes (plus de feuille inférieure spécifique
          mobile), même conteneur partagé que les autres menus courts de l'app. */}
      <AnchoredMenu visible={openPicker !== null} onClose={() => setOpenPicker(null)} anchor={pickerPos} width={PICKER_W} estimatedHeight={PICKER_EST_H}>
        <>
            {openPicker === 'horizon' && HORIZON_OPTIONS.map(h => (
              <TouchableOpacity
                key={h}
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={() => { setHorizonFilter(h); setOpenPicker(null) }}
              >
                <Text style={[styles.menuItemText, h === horizonFilter && { color: colors.primary, fontFamily: fonts.bold }]}>
                  {t(HORIZON_LABEL_KEY[h])}
                </Text>
              </TouchableOpacity>
            ))}
            {openPicker === 'source' && SOURCE_OPTIONS.map(s => (
              <TouchableOpacity
                key={s}
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={() => { setSourceFilter(s); setOpenPicker(null) }}
              >
                <Text style={[styles.menuItemText, s === sourceFilter && { color: colors.primary, fontFamily: fonts.bold }]}>
                  {t(SOURCE_LABEL_KEY[s])}
                </Text>
              </TouchableOpacity>
            ))}
        </>
      </AnchoredMenu>

      {/* ── Context menu (UI-POPOVER-2 : anchored popover desktop / feuille compacte
          mobile, même famille visuelle que l'ensemble de l'app) ─────────────────── */}
      <AnchoredMenu visible={!!menuClient} onClose={closeMenu} anchor={menuPos} width={260}>
        <>
            <Text style={styles.menuSheetName} numberOfLines={1}>{menuClient?.full_name}</Text>

            {!confirmDelete && !confirmArchive ? (
              <>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => { closeMenu(); router.push(`/(app)/clients/${menuClient?.id}` as any) }}>
                  <Text style={styles.menuItemIcon}>👁</Text>
                  <Text style={styles.menuItemText}>{t('clients.view')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => { closeMenu(); router.push(`/(app)/clients/${menuClient?.id}/edit` as any) }}>
                  <Text style={styles.menuItemIcon}>✏️</Text>
                  <Text style={styles.menuItemText}>{t('clients.menu_edit')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => { closeMenu(); router.push(`/(app)/appointments/new?clientId=${menuClient?.id}&returnTo=${encodeURIComponent('/(app)/clients')}` as any) }}>
                  <Text style={styles.menuItemIcon}>📅</Text>
                  <Text style={styles.menuItemText}>{t('clients.menu_new_rdv')}</Text>
                </TouchableOpacity>
                <View style={styles.menuDivider} />
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => setConfirmArchive(true)}>
                  <Text style={styles.menuItemIcon}>📦</Text>
                  <Text style={styles.menuItemText}>{t('clients.menu_archive')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => setConfirmDelete(true)}>
                  <Text style={styles.menuItemIcon}>🗑️</Text>
                  <Text style={[styles.menuItemText, { color: colors.danger }]}>{t('clients.menu_delete')}</Text>
                </TouchableOpacity>
              </>
            ) : confirmArchive ? (
              <>
                <Text style={styles.menuConfirmText}>{t('clients.archive_confirm', { name: menuClient?.full_name })}</Text>
                <TouchableOpacity style={[styles.menuDangerBtn, { backgroundColor: colors.primary }, deleting && { opacity: 0.6 }]} onPress={handleArchive} disabled={deleting}>
                  {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.menuDangerBtnText}>{t('clients.menu_archive')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => setConfirmArchive(false)}>
                  <Text style={[styles.menuItemText, { textAlign: 'center', color: colors.textSecondary }]}>{t('clients.menu_cancel')}</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.menuConfirmText}>
                  {t('clients.menu_delete')} « {menuClient?.full_name} » ?
                </Text>
                <TouchableOpacity
                  style={[styles.menuDangerBtn, deleting && { opacity: 0.6 }]}
                  activeOpacity={0.8}
                  onPress={handleDelete}
                  disabled={deleting}
                >
                  {deleting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={styles.menuDangerBtnText}>{t('clients.menu_confirm_delete')}</Text>
                  }
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={() => setConfirmDelete(false)}>
                  <Text style={[styles.menuItemText, { textAlign: 'center', color: colors.textSecondary }]}>{t('clients.menu_cancel')}</Text>
                </TouchableOpacity>
              </>
            )}
        </>
      </AnchoredMenu>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bgDim },
  inner:      { flex: 1, width: '100%' },
  innerWide:  { maxWidth: 1100, alignSelf: 'center' },

  // ── Page header ────────────────────────────────────────────────────────────
  pageHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 14 },
  pageHeading: { flex: 1, minWidth: 0 },
  pageEyebrow: { fontSize: 11, fontFamily: fonts.bold, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4 },
  pageTitle:  { fontSize: 30, fontFamily: fonts.display, color: colors.text, letterSpacing: -0.6, lineHeight: 36 },
  pageSub:    { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary, marginTop: 4 },
  archiveLink: { marginLeft: 'auto', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7 },
  archiveLinkText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
  newClientBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 12, color: hexToRgba(colors.primary, 0.35) }],
    elevation: 3,
  },
  newClientBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: '#fff' },
  quotaBanner: { marginHorizontal: 16, marginBottom: 10, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  quotaBannerReached: { borderColor: colors.warning, backgroundColor: colors.warningLight },
  quotaBannerText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  quotaBannerAction: { fontSize: 12, fontFamily: fonts.bold, color: colors.primary },
  pipelineFilterBanner: { marginHorizontal: 16, marginBottom: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.tertiaryLight, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pipelineFilterText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.tertiary },
  pipelineFilterClear: { fontSize: 18, color: colors.tertiary },

  // ── Search ─────────────────────────────────────────────────────────────────
  searchEmoji: { fontSize: 14, marginRight: 8, opacity: 0.6 },
  searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: fonts.body, color: colors.text, paddingVertical: 11 },

  // ── Filter chips ───────────────────────────────────────────────────────────
  actionFilterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginBottom: 10 },
  filtersList:    { flexGrow: 0, flexShrink: 0 },
  filtersContent: { paddingHorizontal: 16, paddingBottom: 14, alignItems: 'center' },
  chip:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13 },

  // ── Filtres secondaires "À traiter" (ACTION-3.3) — volontairement plus discrets que .chip :
  // fond neutre non teinté, texte plus petit, jamais de couleur "active" pleine comme les
  // chips principales, pour ne pas lire comme un second niveau de navigation.
  miniFilterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: -2, marginBottom: 10 },
  miniFilterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.bgDim, borderWidth: 1, borderColor: colors.border },
  miniFilterText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  miniFilterBtnActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  miniFilterTextActive: { color: colors.primary, fontFamily: fonts.semibold },

  // CONTACTS-SEGMENTS-1 — onglets de population : plus marqués que les filtres rapides
  // (niveau 1 de navigation), répartis sur la largeur.
  examplesWrap: { width: '100%', alignSelf: 'stretch', paddingTop: 8 },
  duplicatesHint: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, paddingHorizontal: 16, marginTop: -2, marginBottom: 10, lineHeight: 17 },
  segmentRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginBottom: 10 },
  segmentTab: { flex: 1, paddingVertical: 9, paddingHorizontal: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.card, alignItems: 'center', gap: 2, boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, color: 'rgba(27, 36, 51, 0.06)' }] },
  segmentTabActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  segmentTabText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.text },
  segmentTabTextActive: { color: colors.primary },
  segmentOverdue: { fontSize: 10, fontFamily: fonts.semibold, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 6, paddingHorizontal: 5, overflow: 'hidden' },

  // Menu horizon/type — conteneur devenu AnchoredMenu (UI-POPOVER-2.1).

  // ── FlatList ───────────────────────────────────────────────────────────────
  list:          { padding: 16, gap: 14, paddingBottom: 100 },
  listWide:      { paddingHorizontal: 0 },
  listEmpty:     { flex: 1 },
  loader:        { marginTop: 48 },
  columnWrapper: { gap: 14, paddingHorizontal: 20 },
  colCard:       { flex: 1 },

  // ── Card ───────────────────────────────────────────────────────────────────
  card: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 16,
    gap: 14,
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.cardBorder,
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(27, 36, 51, 0.05)' },
      { offsetX: 0, offsetY: 6, blurRadius: 18, color: 'rgba(27, 36, 51, 0.06)' },
    ],
    elevation: 2,
  },
  cardBody:  { gap: 10 },
  cardTop:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTitle: { flex: 1, gap: 5 },
  cardName:  { fontSize: 16, fontFamily: fonts.semibold, color: colors.text, lineHeight: 20 },
  pipelineContextRow:   { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' },
  pipelineContextLabel: { fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary },
  pipelineContextValue: { fontSize: 10, fontFamily: fonts.semibold, color: colors.textSecondary },

  // ── Avatar ─────────────────────────────────────────────────────────────────
  avatar:     { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 17, fontFamily: fonts.bold },
  avatarRing:    { width: 46, height: 46, borderRadius: 23, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  avatarRingImg: { width: 38, height: 38, borderRadius: 19 },

  // ── Status pill ────────────────────────────────────────────────────────────
  pill:     { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 9999 },
  pillText: { fontSize: 11, fontFamily: fonts.bold, letterSpacing: 0.3 },

  // ── Three-dot menu ─────────────────────────────────────────────────────────
  menuBtn:  { paddingTop: 2 },
  menuDots: { fontSize: 20, color: colors.textTertiary, lineHeight: 24 },

  // ── Info rows ──────────────────────────────────────────────────────────────
  infoRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoIcon: { fontSize: 13, width: 18, textAlign: 'center' },
  infoText: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, flex: 1 },
  infoMuted: { color: colors.textTertiary, fontStyle: 'italic' },
  // CONTACTS-3.6 §1 — compteur "+N autres actions" (Tous types uniquement) : couleur d'action
  // (colors.primaryAction) + poids semibold pour se lire clairement comme interactif, jamais un
  // badge coloré (pas une urgence en soi — reste sous la ligne d'action principale).
  othersToggleRow:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 26, marginTop: 2, paddingVertical: 2 },
  othersCountText:     { fontSize: 12, fontFamily: fonts.semibold, color: colors.primaryAction },
  othersToggleChevron: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primaryAction },
  // Liste dépliée : même famille visuelle que infoRow, légèrement indentée pour rester rattachée
  // à la ligne principale, jamais une fiche complète (§8).
  otherActionsList:  { marginTop: 4, marginLeft: 26, gap: 6 },
  otherActionRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  otherActionChevron: { fontSize: 14, color: colors.textTertiary },

  // ── Action buttons ─────────────────────────────────────────────────────────
  cardActions:    { flexDirection: 'row', gap: 10, marginTop: 2 },
  btnOutline:     {
    flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.bgDim,
    alignItems: 'center', justifyContent: 'center',
  },
  btnOutlineText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  btnFill:        {
    flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 10, borderRadius: 10,
    backgroundColor: colors.primaryAction, alignItems: 'center', justifyContent: 'center',
    boxShadow: [{ offsetX: 0, offsetY: 3, blurRadius: 8, color: 'rgba(37, 99, 235, 0.3)' }],
    elevation: 2,
  },
  btnFillText:    { fontSize: 14, fontFamily: fonts.semibold, color: colors.textInverse },

  // ── Context menu (conteneur devenu AnchoredMenu, UI-POPOVER-2.1) ────────────
  menuSheetName: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: colors.text,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  menuItemIcon: { fontSize: 18, width: 24, textAlign: 'center' },
  menuItemText: { fontSize: 15, fontFamily: fonts.medium, color: colors.text },
  menuDivider:  { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  menuConfirmText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: colors.text,
    paddingHorizontal: 4,
    paddingVertical: 12,
    lineHeight: 20,
  },
  menuDangerBtn: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginVertical: 4,
  },
  menuDangerBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },

  // ── FAB ────────────────────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryAction,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: [{ offsetX: 0, offsetY: 6, blurRadius: 14, color: hexToRgba(colors.primaryAction, 0.4) }],
    elevation: 8,
  },
  })
}
