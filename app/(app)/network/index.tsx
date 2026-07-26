import { useMemo, useState } from 'react'
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useNetworkTree } from '@/features/network/useNetwork'
import { useUpline } from '@/features/network/useUpline'
import { MessageModal } from '@/shared/components/ui/MessageModal'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { NetworkNode, ContactRole, Client } from '@/shared/lib/types'

const INDENT = 22

type RoleFilter = 'all' | 'network' | 'customers'

// ── Helpers ───────────────────────────────────────────────────────────────────

function activityColor(updatedAt: string | null, colors: ThemeColors): string {
  if (!updatedAt) return colors.textTertiary
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days < 15) return colors.success
  if (days < 30) return colors.warning
  return colors.danger
}

function rolePalette(role: ContactRole, colors: ThemeColors) {
  switch (role) {
    case 'leader':      return { bg: colors.tertiaryLight,  text: colors.tertiary  }
    case 'distributor': return { bg: colors.secondaryLight, text: colors.secondary }
    case 'customer':    return { bg: colors.successLight,   text: colors.success   }
    case 'team_member': return { bg: colors.bgDim,          text: colors.textSecondary }
    case 'inactive':    return { bg: colors.warningLight,   text: colors.warning   }
    default:            return { bg: colors.primaryLight,   text: colors.primary   }
  }
}

function lrpDaysLeft(nextLrpDate: string | null | undefined): number | null {
  if (!nextLrpDate) return null
  return Math.ceil((new Date(nextLrpDate).getTime() - Date.now()) / 86400000)
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
      if (filter === 'network') return node.contact_role === 'distributor' || node.contact_role === 'leader' || node.children.length > 0
      if (filter === 'customers') return node.contact_role === 'customer' || node.contact_role === 'prospect'
      return true
    })
}

// ── NodeRow ───────────────────────────────────────────────────────────────────

interface NodeRowProps {
  node:       NetworkNode
  collapsed:  Set<string>
  onToggle:   (id: string) => void
  onMessage:  (node: NetworkNode) => void
}

function NodeRow({ node, collapsed, onToggle, onMessage }: NodeRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])

  const rp          = rolePalette(node.contact_role, colors)
  const dot         = activityColor(node.updated_at, colors)
  const isNetwork   = node.contact_role === 'distributor' || node.contact_role === 'leader'
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  const lrpDays     = lrpDaysLeft(node.next_lrp_date)
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
            LRP {lrpDays}j
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
          {t(`clients.contact_role.${node.contact_role}`)}
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

export default function NetworkScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { tree, totalSize, distributors, activeThisMonth, loading, error } = useNetworkTree()
  const { nodes: uplineNodes } = useUpline()
  const sortedUpline = useMemo(
    () => [...uplineNodes].sort((a, b) => b.position - a.position),
    [uplineNodes]
  )

  const [collapsed,     setCollapsed]     = useState<Set<string>>(new Set())
  const [roleFilter,    setRoleFilter]    = useState<RoleFilter>('all')
  const [messageTarget, setMessageTarget] = useState<NetworkNode | null>(null)

  const advisorName = session?.user?.user_metadata?.full_name ?? session?.user?.email ?? ''
  const firstName   = advisorName.split(' ')[0] || advisorName

  function toggleCollapse(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filteredTree = useMemo(() => filterTree(tree, roleFilter), [tree, roleFilter])
  const flat         = useMemo(() => flattenVisible(filteredTree, collapsed), [filteredTree, collapsed])

  const FILTERS: { key: RoleFilter; label: string }[] = [
    { key: 'all',       label: t('network.filter_all')       },
    { key: 'network',   label: t('network.filter_network')   },
    { key: 'customers', label: t('network.filter_customers') },
  ]

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>

        {/* ── Header ──────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.title}>{t('network.title')}</Text>
          <Text style={styles.subtitle}>{t('network.subtitle')}</Text>

          {totalSize > 0 && (
            <View style={styles.statsRow}>
              <View style={styles.statChip}>
                <Text style={styles.statNum}>{totalSize}</Text>
                <Text style={styles.statLabel}>{t('network.members')}</Text>
              </View>
              <View style={styles.statChip}>
                <Text style={[styles.statNum, { color: colors.secondary }]}>{distributors}</Text>
                <Text style={styles.statLabel}>{t('network.distributors')}</Text>
              </View>
              <View style={styles.statChip}>
                <Text style={[styles.statNum, { color: colors.success }]}>{activeThisMonth}</Text>
                <Text style={styles.statLabel}>{t('network.active_month')}</Text>
              </View>
            </View>
          )}

          {/* Filter tabs */}
          {totalSize > 0 && (
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
          )}
        </View>

        {/* ── Legend ──────────────────────────────────────── */}
        {flat.length > 0 && (
          <View style={styles.legend}>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.success }]} /><Text style={styles.legendLabel}>&lt; 15j</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.warning }]} /><Text style={styles.legendLabel}>15–30j</Text></View>
            <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.danger  }]} /><Text style={styles.legendLabel}>&gt; 30j</Text></View>
            <Text style={styles.legendHint}>{t('network.tap_expand')} · {t('network.long_press_open')}</Text>
          </View>
        )}

        {/* ── Content ─────────────────────────────────────── */}
        {loading ? (
          <ActivityIndicator style={styles.loader} color={colors.primary} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : flat.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyEmoji}>🌐</Text>
            <Text style={styles.emptyTitle}>{t('network.empty')}</Text>
            <Text style={styles.emptySub}>{t('network.empty_sub')}</Text>
          </View>
        ) : (
          <FlatList
            data={flat}
            keyExtractor={n => n.id}
            renderItem={({ item }) => (
              <NodeRow
                node={item}
                collapsed={collapsed}
                onToggle={toggleCollapse}
                onMessage={setMessageTarget}
              />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View>
                {/* ── Upline ──────────────────────────────── */}
                <View style={styles.uplineHeader}>
                  <Text style={styles.uplineTitle}>{t('network.upline_title')}</Text>
                  <TouchableOpacity
                    onPress={() => router.push('/(app)/network/upline' as any)}
                    hitSlop={8}
                  >
                    <Text style={styles.uplineManageBtn}>{t('network.upline_manage')}</Text>
                  </TouchableOpacity>
                </View>
                {sortedUpline.length === 0 ? (
                  <TouchableOpacity
                    style={styles.uplineEmpty}
                    onPress={() => router.push('/(app)/network/upline' as any)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.uplineEmptyText}>+ {t('network.upline_add')}</Text>
                  </TouchableOpacity>
                ) : (
                  sortedUpline.map((node, index) => (
                    <View key={node.id} style={styles.uplineRow}>
                      {index < sortedUpline.length && (
                        <View style={styles.uplineLine} />
                      )}
                      <View style={[styles.dot, { backgroundColor: colors.textSecondary }]} />
                      <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{node.name}</Text>
                      {node.member_id ? (
                        <Text style={styles.uplineMemberId}>#{node.member_id}</Text>
                      ) : null}
                    </View>
                  ))
                )}

                {/* ── Moi ─────────────────────────────────── */}
                <View style={styles.youRow}>
                  {sortedUpline.length > 0 && <View style={styles.uplineLine} />}
                  <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.name, styles.nameStrong, { color: colors.primary, flex: 1 }]} numberOfLines={1}>
                    {firstName ? `${firstName} · ` : ''}{t('network.you')}
                  </Text>
                </View>

                {/* Séparateur downline */}
                <View style={styles.downlineDivider}>
                  <Text style={styles.downlineDividerText}>{t('network.subtitle')}</Text>
                </View>
              </View>
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>

      {/* Message modal */}
      <MessageModal
        visible={!!messageTarget}
        onClose={() => setMessageTarget(null)}
        client={messageTarget as unknown as Client}
        advisorName={advisorName}
      />
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },

  header:    { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, gap: 3 },
  title:     { fontSize: 28, fontFamily: fonts.display, color: colors.text },
  subtitle:  { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, marginBottom: 4 },

  statsRow:  { flexDirection: 'row', gap: 10, marginTop: 4, marginBottom: 10 },
  statChip:  { flex: 1, backgroundColor: colors.card, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  statNum:   { fontSize: 22, fontFamily: fonts.display, color: colors.text },
  statLabel: { fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },

  filterRow:     { flexDirection: 'row', gap: 8 },
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
