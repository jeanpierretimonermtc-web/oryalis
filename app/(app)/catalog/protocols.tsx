import { useState, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Modal, FlatList, ActivityIndicator,
} from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { useClients } from '@/features/clients/useClients'
import { createRecommendation } from '@/features/recommendations/recommendationService'
import { useTheme } from '@/shared/theme/ThemeProvider'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import {
  PROTOCOLS, CATEGORIES_BY_BRAND, ROLE_LABELS, ROLE_COLORS,
} from '@/features/protocols/protocols'
import type { Protocol, ProtocolProduct, ProtocolBrand } from '@/features/protocols/protocols'
import type { ClientListItem } from '@/shared/lib/types'

const BRAND_LABELS: Record<string, string> = {
  doterra: 'doTERRA',
  zinzino: 'Zinzino',
}

// ── Product row ───────────────────────────────────────────────────────────────

function ProductRow({ product, selected, onToggle }: { product: ProtocolProduct; selected: boolean; onToggle: () => void }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const rc = ROLE_COLORS[product.role]

  return (
    <TouchableOpacity
      style={[styles.productRow, selected && styles.productRowSelected]}
      onPress={onToggle}
      activeOpacity={0.75}
    >
      <View style={[styles.productCheck, selected && styles.productCheckActive]}>
        {selected && <Text style={styles.productCheckMark}>✓</Text>}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.productName}>{product.name}</Text>
          <View style={[styles.roleBadge, { backgroundColor: rc.bg }]}>
            <Text style={[styles.roleText, { color: rc.text }]}>{ROLE_LABELS[product.role]}</Text>
          </View>
        </View>
        <Text style={styles.productUsage}>{product.usage}</Text>
        <Text style={styles.productFreq}>🕐 {product.frequency}</Text>
      </View>
    </TouchableOpacity>
  )
}

// ── Protocol card ─────────────────────────────────────────────────────────────

function ProtocolCard({ protocol, onRecommend }: { protocol: Protocol; onRecommend: (p: Protocol) => void }) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [expanded, setExpanded] = useState(false)

  return (
    <View style={styles.card}>
      {/* Header */}
      <TouchableOpacity style={styles.cardHeader} onPress={() => setExpanded(e => !e)} activeOpacity={0.75}>
        <Text style={styles.cardEmoji}>{protocol.emoji}</Text>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.cardTitle}>{protocol.title}</Text>
          <Text style={styles.cardSubtitle} numberOfLines={expanded ? undefined : 1}>{protocol.subtitle}</Text>
          <View style={styles.cardMeta}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{protocol.category}</Text>
            </View>
            <Text style={styles.durationText}>⏱ {protocol.duration}</Text>
            <Text style={styles.productCountText}>💊 {protocol.products.length} produits</Text>
          </View>
        </View>
        <Text style={[styles.chevron, expanded && { transform: [{ rotate: '90deg' }] }]}>▶</Text>
      </TouchableOpacity>

      {/* Expanded detail */}
      {expanded && (
        <View style={styles.cardDetail}>
          {/* Products */}
          <Text style={styles.sectionLabel}>PRODUITS</Text>
          {protocol.products.map((p, i) => (
            <View key={i} style={styles.detailProductRow}>
              <View style={[styles.roleDot, { backgroundColor: ROLE_COLORS[p.role].bg }]}>
                <Text style={{ fontSize: 9, color: ROLE_COLORS[p.role].text, fontFamily: fonts.bold }}>
                  {p.role === 'principal' ? 'P' : p.role === 'complémentaire' ? 'C' : 'O'}
                </Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.detailProductName}>{p.name}</Text>
                <Text style={styles.detailProductUsage}>{p.usage}</Text>
                <Text style={styles.detailProductFreq}>🕐 {p.frequency}</Text>
              </View>
            </View>
          ))}

          {/* Tips */}
          {protocol.tips.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 14 }]}>CONSEILS</Text>
              {protocol.tips.map((tip, i) => (
                <View key={i} style={styles.tipRow}>
                  <Text style={styles.tipBullet}>•</Text>
                  <Text style={styles.tipText}>{tip}</Text>
                </View>
              ))}
            </>
          )}

          {/* CTA */}
          <TouchableOpacity style={styles.recommendBtn} onPress={() => onRecommend(protocol)} activeOpacity={0.85}>
            <Text style={styles.recommendBtnText}>✚ Recommander ce protocole à un client</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

// ── Client picker modal ────────────────────────────────────────────────────────

function ClientPicker({
  visible,
  protocol,
  onClose,
}: {
  visible: boolean
  protocol: Protocol | null
  onClose: () => void
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { clients, loading } = useClients()
  const [query, setQuery]           = useState('')
  const [selectedClient, setSelectedClient] = useState<ClientListItem | null>(null)
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set())
  const [saving, setSaving]         = useState(false)
  const [done, setDone]             = useState(false)

  const filtered = query
    ? clients.filter(c => c.full_name.toLowerCase().includes(query.toLowerCase()))
    : clients

  function handleReset() {
    setQuery('')
    setSelectedClient(null)
    setSelectedProducts(new Set())
    setDone(false)
    onClose()
  }

  function initProducts(p: Protocol) {
    // Pre-select principal + complémentaire
    const sel = new Set<number>()
    p.products.forEach((prod, i) => { if (prod.role !== 'optionnel') sel.add(i) })
    setSelectedProducts(sel)
  }

  async function handleSave() {
    if (!selectedClient || !protocol || !session) return
    setSaving(true)
    try {
      for (const idx of selectedProducts) {
        const prod = protocol.products[idx]
        await createRecommendation(
          session.user.id,
          selectedClient.id,
          prod.name,
          `Protocole ${protocol.title} — ${prod.usage} (${prod.frequency})`,
          'advised',
          null,
          null,
          1,
          null,
        )
      }
      setDone(true)
    } catch (e) {
      console.error('[protocols.save]', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleReset}>
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHandle} />

          {done ? (
            <View style={styles.doneWrap}>
              <Text style={styles.doneEmoji}>✅</Text>
              <Text style={styles.doneTitle}>Recommandations créées !</Text>
              <Text style={styles.doneSub}>
                {selectedProducts.size} produit(s) ajouté(s) à la fiche de {selectedClient?.full_name}
              </Text>
              <TouchableOpacity
                style={[styles.recommendBtn, { marginTop: 16 }]}
                onPress={() => { handleReset(); router.push(`/(app)/clients/${selectedClient?.id}` as any) }}
              >
                <Text style={styles.recommendBtnText}>Voir la fiche client →</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeLink} onPress={handleReset}>
                <Text style={styles.closeLinkText}>Fermer</Text>
              </TouchableOpacity>
            </View>
          ) : !selectedClient ? (
            <>
              <Text style={styles.pickerTitle}>Choisir un client</Text>
              <TextInput
                style={styles.pickerSearch}
                placeholder="Rechercher..."
                value={query}
                onChangeText={setQuery}
                placeholderTextColor={colors.textTertiary}
              />
              {loading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
              ) : (
                <FlatList
                  data={filtered}
                  keyExtractor={c => c.id}
                  style={{ maxHeight: 340 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.clientItem}
                      onPress={() => { setSelectedClient(item); initProducts(protocol!) }}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.clientAvatar, { backgroundColor: colors.primaryLight }]}>
                        <Text style={[styles.clientAvatarText, { color: colors.primary }]}>
                          {item.full_name[0].toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.clientName}>{item.full_name}</Text>
                    </TouchableOpacity>
                  )}
                  ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
                />
              )}
              <TouchableOpacity style={styles.closeLink} onPress={handleReset}>
                <Text style={styles.closeLinkText}>Annuler</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.pickerTitle}>
                {protocol?.emoji} {protocol?.title}
              </Text>
              <Text style={styles.pickerSub}>
                Sélectionner les produits pour <Text style={{ fontFamily: fonts.bold }}>{selectedClient.full_name}</Text>
              </Text>
              <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                {protocol?.products.map((p, i) => (
                  <ProductRow
                    key={i}
                    product={p}
                    selected={selectedProducts.has(i)}
                    onToggle={() => {
                      setSelectedProducts(prev => {
                        const next = new Set(prev)
                        next.has(i) ? next.delete(i) : next.add(i)
                        return next
                      })
                    }}
                  />
                ))}
              </ScrollView>
              <TouchableOpacity
                style={[styles.recommendBtn, (saving || selectedProducts.size === 0) && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving || selectedProducts.size === 0}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.recommendBtnText}>
                      Créer {selectedProducts.size} recommandation{selectedProducts.size > 1 ? 's' : ''}
                    </Text>
                }
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeLink} onPress={() => setSelectedClient(null)}>
                <Text style={styles.closeLinkText}>← Changer de client</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ProtocolsScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { catalog } = useLocalSearchParams<{ catalog?: string }>()

  const brand = (catalog as ProtocolBrand) ?? 'all'
  const brandLabel  = BRAND_LABELS[brand] ?? ''
  const screenTitle = brand !== 'all' ? `🌿 Protocoles ${brandLabel}` : '🌿 Protocoles bien-être'

  const [search,          setSearch]          = useState('')
  const [categoryFilter,  setCategoryFilter]  = useState<string | null>(null)
  const [pickerProtocol,  setPickerProtocol]  = useState<Protocol | null>(null)

  const brandProtocols      = useMemo(
    () => brand === 'all' ? PROTOCOLS : PROTOCOLS.filter(p => p.brand === brand),
    [brand]
  )
  const availableCategories = useMemo(
    () => CATEGORIES_BY_BRAND[brand] ?? CATEGORIES_BY_BRAND['all'],
    [brand]
  )

  const displayed = useMemo(() => brandProtocols.filter(p => {
    const matchesCategory = !categoryFilter || p.category === categoryFilter
    const matchesSearch   = !search
      || p.title.toLowerCase().includes(search.toLowerCase())
      || p.subtitle.toLowerCase().includes(search.toLowerCase())
      || p.products.some(prod => prod.name.toLowerCase().includes(search.toLowerCase()))
    return matchesCategory && matchesSearch
  }), [brandProtocols, search, categoryFilter])

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(screenTitle)} />

      <View style={styles.container}>
        {/* Search */}
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Problématique, produit..."
            value={search}
            onChangeText={setSearch}
            placeholderTextColor={colors.textTertiary}
            clearButtonMode="while-editing"
          />
        </View>

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, !categoryFilter && styles.filterChipActive]}
            onPress={() => setCategoryFilter(null)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterText, !categoryFilter && styles.filterTextActive]}>Toutes</Text>
          </TouchableOpacity>
          {availableCategories.map(cat => (
            <TouchableOpacity
              key={cat}
              style={[styles.filterChip, categoryFilter === cat && styles.filterChipActive]}
              onPress={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterText, categoryFilter === cat && styles.filterTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Legend */}
        <View style={styles.legend}>
          {Object.entries(ROLE_COLORS).map(([role, c]) => (
            <View key={role} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: c.bg, borderColor: c.text }]} />
              <Text style={styles.legendLabel}>{ROLE_LABELS[role as keyof typeof ROLE_LABELS]}</Text>
            </View>
          ))}
          <Text style={styles.legendHint}>Appuyer pour développer</Text>
        </View>

        {/* List */}
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {displayed.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>🌿</Text>
              <Text style={styles.emptyText}>Aucun protocole trouvé</Text>
            </View>
          ) : (
            displayed.map(protocol => (
              <ProtocolCard
                key={protocol.id}
                protocol={protocol}
                onRecommend={setPickerProtocol}
              />
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      <ClientPicker
        visible={!!pickerProtocol}
        protocol={pickerProtocol}
        onClose={() => setPickerProtocol(null)}
      />
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bgDim },

  searchWrap:  { flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 8, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 },
  searchIcon:  { fontSize: 14, marginRight: 8, opacity: 0.6 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: fonts.body, color: colors.text, paddingVertical: 11 },

  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow:   { paddingHorizontal: 16, paddingBottom: 10, gap: 8, alignItems: 'center' },
  filterChip:  { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterText:  { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  filterTextActive: { color: colors.primary, fontFamily: fonts.semibold },

  legend:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:  { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  legendLabel:{ fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary },
  legendHint: { flex: 1, fontSize: 10, fontFamily: fonts.body, color: colors.textTertiary, textAlign: 'right' },

  list:        { flex: 1 },
  listContent: { padding: 16, gap: 12 },

  // ── Protocol card ──────────────────────────────────────────────────────────
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 8, color: 'rgba(0, 0, 0, 0.04)' }],
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
  },
  cardEmoji:    { fontSize: 28 },
  cardTitle:    { fontSize: 16, fontFamily: fonts.bold, color: colors.text },
  cardSubtitle: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  cardMeta:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  categoryBadge:{ backgroundColor: colors.bgDim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  categoryBadgeText: { fontSize: 10, fontFamily: fonts.bold, color: colors.textSecondary },
  durationText:  { fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary },
  productCountText: { fontSize: 10, fontFamily: fonts.medium, color: colors.textTertiary },
  chevron: { fontSize: 11, color: colors.textTertiary, marginTop: 4 },

  cardDetail: { paddingHorizontal: 16, paddingBottom: 16, gap: 0 },
  sectionLabel: { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },

  detailProductRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  roleDot:  { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  detailProductName:  { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
  detailProductUsage: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17 },
  detailProductFreq:  { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },

  tipRow:   { flexDirection: 'row', gap: 8, marginBottom: 6 },
  tipBullet:{ fontSize: 14, color: colors.primary },
  tipText:  { flex: 1, fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },

  recommendBtn: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  recommendBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: '#fff' },

  // ── Client picker modal ────────────────────────────────────────────────────
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    maxHeight: '85%',
    gap: 12,
  },
  pickerHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 4 },
  pickerTitle: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
  pickerSub:   { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary },
  pickerSearch: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: fonts.body,
    color: colors.text,
  },
  clientItem:       { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  clientAvatar:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  clientAvatarText: { fontSize: 14, fontFamily: fonts.bold },
  clientName:       { fontSize: 15, fontFamily: fonts.medium, color: colors.text, flex: 1 },

  // ── Product row (in picker) ────────────────────────────────────────────────
  productRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  productRowSelected: { backgroundColor: colors.primaryLight + '55' },
  productCheck:       { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0 },
  productCheckActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  productCheckMark:   { fontSize: 12, color: '#fff', fontFamily: fonts.bold },
  productName:        { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
  productUsage:       { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17 },
  productFreq:        { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary },
  roleBadge:          { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  roleText:           { fontSize: 10, fontFamily: fonts.bold },

  // ── Done state ─────────────────────────────────────────────────────────────
  doneWrap:  { alignItems: 'center', gap: 8, paddingVertical: 24 },
  doneEmoji: { fontSize: 48 },
  doneTitle: { fontSize: 20, fontFamily: fonts.bold, color: colors.text },
  doneSub:   { fontSize: 14, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center' },

  closeLink:    { alignItems: 'center', paddingVertical: 10 },
  closeLinkText:{ fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },

  emptyWrap: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyEmoji:{ fontSize: 40 },
  emptyText: { fontSize: 16, fontFamily: fonts.medium, color: colors.textSecondary },
  })
}
