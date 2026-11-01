import { useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { getRoleColors, getPrimaryRole } from '@/shared/theme/roleColors'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { Brand, NetworkNode, UplineNode } from '@/shared/lib/types'
import { brandRoleLabel } from '@/features/brands/brandRoleLabels'
import { NETWORK_ROLES } from './networkService'

// Partenaire = rôle réseau ou déjà parrain de quelqu'un : il a sa propre branche.
// Client = feuille : listé les uns sous les autres dans la colonne de son propriétaire.
// Dans le réseau d'une marque, c'est le rôle propre à la marque qui compte (networkRole).
export function isPartnerNode(n: NetworkNode): boolean {
  if (n.children.length > 0) return true
  if (n.networkRole) return n.networkRole !== 'customer'
  return n.contact_role.some(r => (NETWORK_ROLES as readonly string[]).includes(r))
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')
}

function activityColor(updatedAt: string | null, colors: ThemeColors): string {
  if (!updatedAt) return colors.textTertiary
  const days = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000)
  if (days < 15) return colors.success
  if (days < 30) return colors.warning
  return colors.danger
}

interface Props {
  roots: NetworkNode[]
  meLabel: string
  upline: UplineNode[]
  onOpen: (id: string) => void
  onManageUpline: () => void
  // BRAND-ROLES-1 — marque de l'arbre affiché : son vocabulaire pour les rôles.
  brand?: Brand | null
}

export function NetworkOrgChart({ roots, meLabel, upline, onOpen, onManageUpline, brand = null }: Props) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const ctx = { styles, colors, collapsed, toggle, onOpen, brand }

  return (
    <ScrollView horizontal contentContainerStyle={styles.scrollH} showsHorizontalScrollIndicator>
        <View style={styles.canvas}>
          {/* Ligne ascendante : du plus loin au sponsor direct, en pointillé. */}
          {upline.length === 0 ? (
            <TouchableOpacity style={styles.uplineEmpty} onPress={onManageUpline} activeOpacity={0.75}>
              <Text style={styles.uplineEmptyText}>+ {t('network.upline_add')}</Text>
            </TouchableOpacity>
          ) : (
            upline.map(u => (
              <View key={u.id} style={styles.column}>
                <TouchableOpacity style={styles.uplineCard} onPress={onManageUpline} activeOpacity={0.75}>
                  <Text style={styles.cardName} numberOfLines={1}>{u.name}</Text>
                  {u.member_id ? <Text style={styles.cardSub}>#{u.member_id}</Text> : null}
                </TouchableOpacity>
                <View style={styles.stemDashed} />
              </View>
            ))
          )}
          {upline.length === 0 ? <View style={styles.stemDashed} /> : null}

          <Branch
            ctx={ctx}
            card={
              <View style={[styles.card, styles.meCard]}>
                <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.avatarText, { color: colors.onPrimary }]}>🙋</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.cardName, { color: colors.primary }]} numberOfLines={1}>{meLabel}</Text>
                  <Text style={styles.cardSub}>{t('network.you')}</Text>
                </View>
              </View>
            }
            id="__me__"
            nodes={roots}
            clientsTitle={t('network.my_clients')}
          />
        </View>
    </ScrollView>
  )
}

type Ctx = {
  brand: Brand | null
  styles: ReturnType<typeof makeStyles>
  colors: ThemeColors
  collapsed: Set<string>
  toggle: (id: string) => void
  onOpen: (id: string) => void
}

function Branch({ ctx, card, id, nodes, clientsTitle }: { ctx: Ctx; card: React.ReactNode; id: string; nodes: NetworkNode[]; clientsTitle: string }) {
  const { styles } = ctx
  const partners = nodes.filter(isPartnerNode)
  const clients = nodes.filter(n => !isPartnerNode(n))
  const isCollapsed = ctx.collapsed.has(id)
  const groups = (clients.length > 0 ? 1 : 0) + partners.length

  return (
    <View style={styles.column}>
      {card}
      {groups > 0 ? (
        <TouchableOpacity style={styles.toggleBtn} onPress={() => ctx.toggle(id)} activeOpacity={0.7}>
          <Text style={styles.toggleText}>{isCollapsed ? `▸ ${nodes.length}` : '▾'}</Text>
        </TouchableOpacity>
      ) : null}
      {groups > 0 && !isCollapsed ? (
        <>
          <View style={styles.stem} />
          <View style={styles.childrenRow}>
            {clients.length > 0 ? (
              <ChildSlot ctx={ctx} first last={partners.length === 0}>
                <ClientsColumn ctx={ctx} title={clientsTitle} clients={clients} />
              </ChildSlot>
            ) : null}
            {partners.map((p, i) => (
              <ChildSlot key={p.id} ctx={ctx} first={clients.length === 0 && i === 0} last={i === partners.length - 1}>
                <PartnerBranch ctx={ctx} node={p} />
              </ChildSlot>
            ))}
          </View>
        </>
      ) : null}
    </View>
  )
}

// Raccord horizontal au-dessus de chaque enfant : demi-trait à gauche/droite sauf aux extrémités.
function ChildSlot({ ctx, first, last, children }: { ctx: Ctx; first: boolean; last: boolean; children: React.ReactNode }) {
  const { styles } = ctx
  return (
    <View style={styles.slot}>
      {!(first && last) ? (
        <View style={[styles.hLine, { left: first ? '50%' : 0, right: last ? '50%' : 0 }]} />
      ) : null}
      <View style={styles.slotStem} />
      {children}
    </View>
  )
}

function PartnerBranch({ ctx, node }: { ctx: Ctx; node: NetworkNode }) {
  const { t } = useTranslation()
  const { getRoleLabel } = useAppConfig()
  const { styles, colors } = ctx
  const rc = getRoleColors(getPrimaryRole(node.contact_role), colors)
  const partnersCount = node.children.filter(isPartnerNode).length
  const clientsCount = node.children.length - partnersCount
  return (
    <Branch
      ctx={ctx}
      id={node.id}
      nodes={node.children}
      clientsTitle={t('network.clients_of', { name: node.first_name || node.full_name.split(' ')[0] })}
      card={
        <TouchableOpacity style={styles.card} onPress={() => ctx.onOpen(node.id)} activeOpacity={0.8}>
          <View style={[styles.avatar, { backgroundColor: rc.bg }]}>
            <Text style={[styles.avatarText, { color: rc.text }]}>{initials(node.full_name)}</Text>
          </View>
          <View style={styles.cardBody}>
            <View style={styles.nameRow}>
              <View style={[styles.dot, { backgroundColor: activityColor(node.updated_at, colors) }]} />
              <Text style={styles.cardName} numberOfLines={1}>{node.full_name}</Text>
            </View>
            <Text style={[styles.cardSub, { color: rc.text }]} numberOfLines={1}>{node.networkRole && ctx.brand ? brandRoleLabel(ctx.brand, node.networkRole, getRoleLabel) : getRoleLabel(getPrimaryRole(node.contact_role))}</Text>
            {node.children.length > 0 ? (
              <Text style={styles.cardMeta} numberOfLines={1}>
                {[
                  partnersCount ? t('network.count_partners', { count: partnersCount }) : null,
                  clientsCount ? t('network.count_clients', { count: clientsCount }) : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
      }
    />
  )
}

function ClientsColumn({ ctx, title, clients }: { ctx: Ctx; title: string; clients: NetworkNode[] }) {
  const { styles, colors } = ctx
  return (
    <View style={styles.clientsBox}>
      <Text style={styles.clientsTitle}>👤 {title} · {clients.length}</Text>
      {clients.map(c => (
        <TouchableOpacity key={c.id} style={styles.clientRow} onPress={() => ctx.onOpen(c.id)} activeOpacity={0.75}>
          <View style={[styles.dot, { backgroundColor: activityColor(c.updated_at, colors) }]} />
          <Text style={styles.clientName} numberOfLines={1}>{c.full_name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

const CARD_W = 200
const LINE = 1.5

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scrollH: { flexGrow: 1, justifyContent: 'center' },
    canvas: { alignItems: 'center', padding: 24, minWidth: '100%' },
    column: { alignItems: 'center' },
    card: { width: CARD_W, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    meCard: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 13, fontFamily: fonts.bold },
    cardBody: { flex: 1, gap: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cardName: { flexShrink: 1, fontSize: 13.5, fontFamily: fonts.semibold, color: colors.text },
    cardSub: { fontSize: 11.5, fontFamily: fonts.medium, color: colors.textSecondary },
    cardMeta: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary },
    dot: { width: 8, height: 8, borderRadius: 4 },
    toggleBtn: { marginTop: -1, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    toggleText: { fontSize: 11, fontFamily: fonts.semibold, color: colors.textSecondary },
    stem: { width: LINE, height: 14, backgroundColor: colors.border },
    stemDashed: { width: 0, height: 22, borderLeftWidth: LINE, borderStyle: 'dashed', borderColor: colors.textTertiary },
    childrenRow: { flexDirection: 'row', alignItems: 'flex-start' },
    slot: { alignItems: 'center', paddingHorizontal: 10, position: 'relative' },
    hLine: { position: 'absolute', top: 0, height: LINE, backgroundColor: colors.border },
    slotStem: { width: LINE, height: 14, backgroundColor: colors.border },
    clientsBox: { width: CARD_W, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 10, gap: 2 },
    clientsTitle: { fontSize: 11.5, fontFamily: fonts.semibold, color: colors.textSecondary, marginBottom: 4 },
    clientRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 4, borderRadius: 8 },
    clientName: { flex: 1, fontSize: 13, fontFamily: fonts.body, color: colors.text },
    uplineCard: { width: CARD_W, padding: 10, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.textTertiary, alignItems: 'center', gap: 1 },
    uplineEmpty: { width: CARD_W, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center' },
    uplineEmptyText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.textTertiary },
  })
}
