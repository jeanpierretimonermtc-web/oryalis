import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, useWindowDimensions } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { router, Stack, useFocusEffect } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useNetworkTree } from '@/features/network/useNetwork'
import { useUpline } from '@/features/network/useUpline'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { NetworkNode, Client } from '@/shared/lib/types'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { getDaysUntilLrp } from '@/features/clients/clientService'
import { NetworkOrgChart, isPartnerNode } from '@/features/network/NetworkOrgChart'
import type { BrandNetwork } from '@/features/network/networkService'
import { BrandAvatar } from '@/features/brands/BrandPill'
import { brandRoleLabel } from '@/features/brands/brandRoleLabels'
import type { Brand } from '@/shared/lib/types'

const INDENT = 22

type RoleFilter = 'all' | 'network' | 'customers'
type ViewMode = 'tree' | 'list'
const VIEW_MODE_KEY = 'oryalis.networkViewMode'

// ── Helpers ───────────────────────────────────────────────────────────────────

function activityColor(updatedAt: string | null, colors: ThemeColors): string {
  if (!updatedAt) return colors.textTertiary
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days < 15) return colors.success
  if (days < 30) return colors.warning
  return colors.danger
}

// DFS flatten en sautant les enfants des nœuds collapsed
function flattenVisible(nodes: NetworkNode[], collapsed: Set<string>): NetworkNode[] {
  const result: NetworkNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (!collapsed.has(node.id) && node.children.length > 0) {
      result.push(...flattenVisible(node.children, collapsed))
    }
  }
  return result
}

function filterTree(nodes: NetworkNode[], filter: RoleFilter): NetworkNode[] {
  if (filter === 'all') return nodes
  return nodes
    .map(node => ({
      ...node,
      children: filterTree(node.children, filter),
    }))
    .filter(node => {
      if (filter === 'network') return isPartnerNode(node)
      if (filter === 'customers') return !isPartnerNode(node)
      return true
    })
}

// ── NodeRow ───────────────────────────────────────────────────────────────────

interface NodeRowProps {
  brand?:     Brand | null
  node:       NetworkNode
  collapsed:  Set<string>
  onToggle:   (id: string) => void
  onMessage:  (node: NetworkNode) => void
}

function NodeRow({ node, collapsed, onToggle, onMessage, brand = null }: NodeRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { getRoleLabel, getLrpName, isModuleActive } = useAppConfig()

  const rp          = getRoleColors(getPrimaryRole(node.contact_role), colors)
  const dot         = activityColor(node.updated_at, colors)
  const isNetwork   = node.contact_role.includes('distributor') || node.contact_role.includes('leader')
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  // LRP-4 — activeProgramId/nextOccurrenceDate viennent de recurring_programs (déjà filtré
  // status='active' côté service, voir networkService.fetchActiveProgramsByClientId) : un
  // programme paused/cancelled/completed, ou le module renewals_lrp désactivé, ne doit plus
  // jamais afficher de badge d'alerte réseau — même règle que LRP-2 sur le nouveau modèle.
  const lrpProgramActive = isModuleActive('renewals_lrp') && node.activeProgramId != null && node.nextOccurrenceDate != null
  const lrpDays     = lrpProgramActive ? getDaysUntilLrp(node.nextOccurrenceDate as string) : null
  const lrpAlert    = lrpDays !== null && lrpDays <= 7

  return (
    <TouchableOpacity
      style={[styles.row, { paddingLeft: 16 + node.level * INDENT }]}
      onPress={() => hasChildren ? onToggle(node.id) : router.push(`/(app)/clients/${node.id}` as any)}
      onLongPress={() => router.push(`/(app)/clients/${node.id}` as any)}
      activeOpacity={0.75}
      delayLongPress={300}
    >
      {/* Connector line */}
      {node.level > 0 && (
        <View style={[styles.connector, { left: 16 + (node.level - 1) * INDENT + 9 }]} />
      )}

      {/* Expand / collapse chevron OR activity dot */}
      {hasChildren ? (
        <View style={[styles.chevronWrap, { backgroundColor: isNetwork ? colors.primaryLight : colors.bgDim }]}>
          <Text style={[styles.chevron, { color: isNetwork ? colors.primary : colors.textSecondary }]}>
            {isCollapsed ? '▶' : '▼'}
          </Text>
        </View>
      ) : (
        <View style={[styles.dot, { backgroundColor: dot }]} />
      )}

      {/* Name */}
      <Text style={[styles.name, isNetwork && styles.nameStrong]} numberOfLines={1}>
        {node.full_name}
      </Text>

      {/* LRP alert badge */}
      {lrpAlert && (
        <View style={[styles.lrpBadge, { backgroundColor: lrpDays! <= 3 ? colors.dangerLight : colors.warningLight }]}>
          <Text style={[styles.lrpText, { color: lrpDays! <= 3 ? colors.danger : colors.warning }]}>
            {getLrpName()} {lrpDays}j
          </Text>
        </View>
      )}

      {/* Children count when collapsed */}
      {hasChildren && isCollapsed && (
        <View style={[styles.countChip, { backgroundColor: colors.bgDim }]}>
          <Text style={[styles.countText, { color: colors.textSecondary }]}>
            {t('network.children_count', { n: node.children.length })}
          </Text>
        </View>
      )}

      {/* Role badge */}
      <View style={[styles.roleBadge, { backgroundColor: rp.bg }]}>
        <Text style={[styles.roleText, { color: rp.text }]}>
          {node.networkRole && brand
            ? brandRoleLabel(brand, node.networkRole, getRoleLabel)
            : node.contact_role.map(r => getRoleLabel(r)).join(' · ')}
        </Text>
      </View>

      {/* Message quick action */}
      <TouchableOpacity
        style={styles.msgBtn}
        onPress={() => onMessage(node)}
        hitSlop={8}
        activeOpacity={0.7}
      >
        <Text style={styles.msgIcon}>💬</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────

type BrandTab = 'all' | string
const NO_BRAND_TAB = '__none__'

function networkKey(n: BrandNetwork): string {
  return n.brand?.id ?? NO_BRAND_TAB
}

function flattenAll(nodes: NetworkNode[]): NetworkNode[] {
  return nodes.flatMap(n => [n, ...flattenAll(n.children)])
}

export default function NetworkScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { networks, loading, error, reload } = useNetworkTree()
  const { nodes: uplineNodes, reload: reloadUpline } = useUpline()
  // Retour sur l'écran (après "Modifier" un contact ou la ligne ascendante) : données à jour.
  const focusedOnce = useRef(false)
  useFocusEffect(useCallback(() => {
    if (!focusedOnce.current) { focusedOnce.current = true; return }
    reload()
    reloadUpline()
  }, [reload, reloadUpline]))

  const [collapsed,     setCollapsed]     = useState<Set<string>>(new Set())
  const [roleFilter,    setRoleFilter]    = useState<RoleFilter>('all')
  const [brandTab,      setBrandTab]      = useState<BrandTab>('all')
  const [messageTarget, setMessageTarget] = useState<NetworkNode | null>(null)
  // NETWORK-TREE-1 — organigramme par défaut sur grand écran, liste sur téléphone ; choix retenu.
  const { width } = useWindowDimensions()
  const [viewMode, setViewMode] = useState<ViewMode>(width >= 768 ? 'tree' : 'list')
  useEffect(() => {
    AsyncStorage.getItem(VIEW_MODE_KEY).then(v => { if (v === 'tree' || v === 'list') setViewMode(v) }).catch(() => {})
  }, [])
  function changeViewMode(mode: ViewMode) {
    setViewMode(mode)
    AsyncStorage.setItem(VIEW_MODE_KEY, mode).catch(() => {})
  }

  const advisorName = session?.user?.user_metadata?.full_name ?? session?.user?.email ?? ''
  const firstName   = advisorName.split(' ')[0] || advisorName

  function toggleCollapse(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // BRAND-NETWORK-1 — un réseau par marque ; "Toutes" les empile.
  const tabKeys = networks.map(networkKey)
  const activeTab = brandTab !== 'all' && !tabKeys.includes(brandTab) ? 'all' : brandTab
  const shown = useMemo(
    () => networks
      .filter(n => activeTab === 'all' || networkKey(n) === activeTab)
      .map(n => ({ ...n, roots: filterTree(n.roots, roleFilter) })),
    [networks, activeTab, roleFilter],
  )

  // Ligne ascendante d'une marque ; une personne sans marque reste visible partout tant
  // qu'elle n'est pas attribuée à une marque (écran "Gérer").
  const uplineFor = useCallback((brandId: string | null) =>
    [...uplineNodes]
      .filter(u => brandId === null ? u.brand_id === null : (u.brand_id === brandId || u.brand_id === null))
      .sort((a, b) => b.position - a.position),
  [uplineNodes])

  const stats = useMemo(() => {
    const unique = new Map<string, NetworkNode>()
    for (const n of networks.filter(nw => activeTab === 'all' || networkKey(nw) === activeTab)) {
      for (const node of flattenAll(n.roots)) if (!unique.has(node.id) || isPartnerNode(node)) unique.set(node.id, node)
    }
    const all = [...unique.values()]
    const cutoff = Date.now() - 30 * 86400000
    return {
      total: all.length,
      partners: all.filter(isPartnerNode).length,
      active: all.filter(n => n.updated_at && new Date(n.updated_at).getTime() >= cutoff).length,
    }
  }, [networks, activeTab])

  const hasContent = shown.some(n => n.roots.length > 0)
  const openUpline = (brandId: string | null) =>
    router.push({ pathname: '/(app)/network/upline', params: brandId ? { brandId } : {} } as any)

  const FILTERS: { key: RoleFilter; label: string }[] = [
    { key: 'all',       label: t('network.filter_all')       },
    { key: 'network',   label: t('network.filter_network')   },
    { key: 'customers', label: t('network.filter_customers') },
  ]

  function renderListHeader(n: BrandNetwork) {
    const upline = uplineFor(n.brand?.id ?? null)
    return (
      <View>
        <View style={styles.uplineHeader}>
          <Text style={styles.uplineTitle}>{t('network.upline_title')}</Text>
          <TouchableOpacity onPress={() => openUpline(n.brand?.id ?? null)} hitSlop={8}>
            <Text style={styles.uplineManageBtn}>{t('network.upline_manage')}</Text>
          </TouchableOpacity>
        </View>
        {upline.length === 0 ? (
          <TouchableOpacity style={styles.uplineEmpty} onPress={() => openUpline(n.brand?.id ?? null)} activeOpacity={0.7}>
            <Text style={styles.uplineEmptyText}>+ {t('network.upline_add')}</Text>
          </TouchableOpacity>
        ) : (
          upline.map(node => (
            <View key={node.id} style={styles.uplineRow}>
              <View style={styles.uplineLine} />
              <View style={[styles.dot, { backgroundColor: colors.textSecondary }]} />
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{node.name}</Text>
              {node.member_id ? <Text style={styles.uplineMemberId}>#{node.member_id}</Text> : null}
            </View>
          ))
        )}
        <View style={styles.youRow}>
          {upline.length > 0 && <View style={styles.uplineLine} />}
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <Text style={[styles.name, styles.nameStrong, { color: colors.primary, flex: 1 }]} numberOfLines={1}>
            {firstName ? `${firstName} · ` : ''}{t('network.you')}
          </Text>
        </View>
        <View style={styles.downlineDivider}>
          <Text style={styles.downlineDividerText}>{t('network.subtitle')}</Text>
        </View>
      </View>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>

        {/* ── Header ──────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{t('network.header_eyebrow')}</Text>
          <Text style={styles.title}>{t('network.title')}</Text>
          <Text style={styles.subtitle}>{t('network.subtitle')}</Text>

          {networks.length > 1 ? (
            <View style={styles.brandTabs}>
              {['all', ...tabKeys].map(key => {
                const n = networks.find(nw => networkKey(nw) === key)
                const active = activeTab === key
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.brandTab, active && styles.brandTabActive]}
                    onPress={() => setBrandTab(key)}
                    activeOpacity={0.75}
                  >
                    {n?.brand ? <BrandAvatar brand={n.brand} size={18} /> : null}
                    <Text style={[styles.brandTabText, active && styles.brandTabTextActive]}>
                      {key === 'all' ? t('network.brand_all') : n?.brand?.name ?? t('network.no_brand')}
                    </Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          ) : null}

          {stats.total > 0 && (
            <View style={styles.statsRow}>
              <View style={styles.statChip}>
                <Text style={styles.statNum}>{stats.total}</Text>
                <Text style={styles.statLabel}>{t('network.members')}</Text>
              </View>
              <View style={styles.statChip}>
                <Text style={[styles.statNum, { color: colors.secondary }]}>{stats.partners}</Text>
                <Text style={styles.statLabel}>{t('network.partners')}</Text>
              </View>
              <View style={styles.statChip}>
                <Text style={[styles.statNum, { color: colors.success }]}>{stats.active}</Text>
                <Text style={styles.statLabel}>{t('network.active_month')}</Text>
              </View>
            </View>
          )}

          {stats.total > 0 && (
            <View style={styles.filterBar}>
              <View style={styles.filterRow}>
                {FILTERS.map(f => (
                  <TouchableOpacity
                    key={f.key}
                    style={[styles.filterChip, roleFilter === f.key && styles.filterChipActive]}
                    onPress={() => setRoleFilter(f.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.filterText, roleFilter === f.key && styles.filterTextActive]}>
                      {f.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.viewToggle}>
                {(['tree', 'list'] as ViewMode[]).map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[styles.viewToggleBtn, viewMode === m && styles.viewToggleBtnActive]}
                    onPress={() => changeViewMode(m)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.viewToggleText, viewMode === m && styles.viewToggleTextActive]}>
                      {m === 'tree' ? `🌳 ${t('network.view_tree')}` : `☰ ${t('network.view_list')}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* ── Legend ──────────────────────────────────────── */}
        {hasContent && (
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.success }]} /><Text style={styles.legendLabel}>&lt; 15j</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.warning }]} /><Text style={styles.legendLabel}>15–30j</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.danger  }]} /><Text style={styles.legendLabel}>&gt; 30j</Text></View>
            <Text style={styles.legendHint}>
              {viewMode === 'tree' ? t('network.tree_hint') : `${t('network.tap_expand')} · ${t('network.long_press_open')}`}
            </Text>
          </View>
        )}

        {/* ── Content ─────────────────────────────────────── */}
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : !hasContent ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyEmoji}>🌐</Text>
            <Text style={styles.emptyTitle}>{t('network.empty')}</Text>
            <Text style={styles.emptySub}>{t('network.empty_sub')}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {shown.filter(n => n.roots.length > 0).map(n => (
              <View key={networkKey(n)} style={styles.brandSection}>
                {shown.length > 1 ? (
                  <View style={styles.brandSectionHeader}>
                    {n.brand ? <BrandAvatar brand={n.brand} size={22} /> : null}
                    <Text style={styles.brandSectionTitle}>
                      {n.brand ? t('network.brand_network', { brand: n.brand.name }) : t('network.no_brand')}
                    </Text>
                  </View>
                ) : null}
                {viewMode === 'tree' ? (
                  <NetworkOrgChart
                    roots={n.roots}
                    meLabel={firstName || t('network.you')}
                    upline={uplineFor(n.brand?.id ?? null)}
                    onOpen={cid => router.push(`/(app)/clients/${cid}` as any)}
                    onManageUpline={() => openUpline(n.brand?.id ?? null)}
                    brand={n.brand}
                  />
                ) : (
                  <>
                    {renderListHeader(n)}
                    {flattenVisible(n.roots, collapsed).map((item, i) => (
                      <View key={item.id}>
                        {i > 0 ? <View style={styles.separator} /> : null}
                        <NodeRow node={item} brand={n.brand} collapsed={collapsed} onToggle={toggleCollapse} onMessage={setMessageTarget} />
                      </View>
                    ))}
                  </>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Message modal */}
      <MessageModal
        visible={!!messageTarget}
        onClose={() => setMessageTarget(null)}
        client={messageTarget as unknown as Client}
        advisorName={advisorName}
        enableEmail
      />
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header:    { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 8, gap: 4 },
  eyebrow:   { fontSize: 11, fontFamily: fonts.bold, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1.2 },
  title:     { fontSize: 30, fontFamily: fonts.display, color: colors.text, letterSpacing: -0.6, lineHeight: 36 },
  subtitle:  { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary, marginBottom: 6 },

  statsRow:  { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 10 },
  statChip:  { flex: 1, backgroundColor: colors.card, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  statNum:   { fontSize: 22, fontFamily: fonts.display, color: colors.text },
  statLabel: { fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },

  filterBar:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  filterRow:     { flexDirection: 'row', gap: 8 },
  viewToggle:    { flexDirection: 'row', borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  viewToggleBtn: { paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.card },
  viewToggleBtnActive: { backgroundColor: colors.primaryLight },
  viewToggleText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.textSecondary },
  viewToggleTextActive: { color: colors.primary, fontFamily: fonts.semibold },
  filterChip:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterText:    { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  filterTextActive: { color: colors.primary, fontFamily: fonts.semibold },

  legend:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  legendItem:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:   { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },
  legendHint:  { flex: 1, fontSize: 10, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'right' },

  list:      { paddingBottom: 80 },
  brandTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 8 },
  brandTab:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  brandTabActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  brandTabText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  brandTabTextActive: { color: colors.primary, fontFamily: fonts.semibold },
  brandSection: { paddingBottom: 12 },
  brandSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  brandSectionTitle: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },

  // ── Upline ──────────────────────────────────────────────────────────────────
  uplineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  uplineTitle:     { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8 },
  uplineManageBtn: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
  uplineEmpty: {
    marginHorizontal: 16,
    marginBottom: 4,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed' as const,
    borderColor: colors.border,
    alignItems: 'center',
  },
  uplineEmptyText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textTertiary },
  uplineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: 'relative',
  },
  uplineLine: {
    position: 'absolute',
    left: 20,
    bottom: -10,
    width: 2,
    height: 20,
    backgroundColor: colors.border,
  },
  uplineMemberId: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },

  // ── Moi ─────────────────────────────────────────────────────────────────────
  youRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.primaryLight,
    position: 'relative',
  },

  // ── Séparateur downline ──────────────────────────────────────────────────────
  downlineDivider: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  downlineDividerText: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.8 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 11,
    paddingRight: 12,
    backgroundColor: colors.bg,
    minHeight: 46,
  },

  connector: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1.5,
    backgroundColor: colors.border,
  },

  chevronWrap: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chevron:     { fontSize: 9, fontFamily: fonts.bold },

  dot:  { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },

  name:       { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.text },
  nameStrong: { fontFamily: fonts.bold },

  lrpBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, flexShrink: 0 },
  lrpText:  { fontSize: 10, fontFamily: fonts.bold },

  countChip:  { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  countText:  { fontSize: 11, fontFamily: fonts.semibold },

  roleBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, flexShrink: 0 },
  roleText:   { fontSize: 10, fontFamily: fonts.bold },

  msgBtn:  { padding: 4, flexShrink: 0 },
  msgIcon: { fontSize: 16 },

  separator: { height: 1, backgroundColor: colors.border, marginLeft: 16 },

  loader:    { marginTop: 48 },
  errorText: { margin: 24, fontSize: 14, color: colors.danger, fontFamily: fonts.body, textAlign: 'center' },

  emptyWrap:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.semibold, color: colors.text, textAlign: 'center' },
  emptySub:   { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  })
}
