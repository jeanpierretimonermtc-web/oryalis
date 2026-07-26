import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Modal, ActivityIndicator, useWindowDimensions, ScrollView,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useFocusEffect, router } from 'expo-router'
import { useCatalogs, useCatalogProducts } from '@/features/catalogs/useCatalog'
import { useCatalogPrefs } from '@/features/catalogs/CatalogPrefsProvider'
import { createRecommendation } from '@/features/recommendations/recommendationService'
import { supabase } from '@/shared/lib/supabase'
import { useAuth } from '@/features/auth/AuthProvider'
import { Input } from '@/shared/components/ui/Input'
import { TextArea } from '@/shared/components/ui/TextArea'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import type { Catalog, CatalogProduct, Client } from '@/shared/lib/types'

function initials(name: string | null | undefined) {
  const parts = (name ?? '').trim().split(' ').filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const CATEGORY_META: Record<string, { color: string; emoji: string }> = {
  'Huile essentielle': { color: '#2E7D32', emoji: '🌿' },
  'Mélange':           { color: '#3570B5', emoji: '⚗️' },
  'Mélange Kids':       { color: '#C2185B', emoji: '🧒' },
  'Complément':        { color: '#C9913D', emoji: '💊' },
  'Soin topique':      { color: '#7A8FAA', emoji: '🧴' },
  'Accessoire':        { color: '#B0A99E', emoji: '🧺' },
}

function categoryAccent(category: string | null, fallback: string): string {
  return (category && CATEGORY_META[category]?.color) ?? fallback
}

function fmt(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

interface RecommendState {
  product: CatalogProduct
  catalogColor: string
  catalogName: string
}

// ── Product card ─────────────────────────────────────────────────────────────

function ProductCard({
  product,
  catalog,
  onDetail,
  onRecommend,
}: {
  product: CatalogProduct
  catalog: Catalog | null
  onDetail: (p: CatalogProduct) => void
  onRecommend: (p: CatalogProduct) => void
}) {
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const accent  = categoryAccent(product.category, catalog?.color ?? colors.primaryAction)
  const catMeta = product.category ? CATEGORY_META[product.category] : null

  return (
    <TouchableOpacity style={styles.card} onPress={() => onDetail(product)} activeOpacity={0.82}>
      <View style={[styles.cardAccent, { backgroundColor: accent }]} />
      <View style={styles.cardBody}>
        <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
        <View style={styles.cardMeta}>
          {product.category ? (
            <View style={[styles.catBadge, { backgroundColor: accent + '22' }]}>
              {catMeta ? <Text style={styles.catBadgeEmoji}>{catMeta.emoji}</Text> : null}
              <Text style={[styles.catBadgeText, { color: accent }]} numberOfLines={1}>{product.category}</Text>
            </View>
          ) : null}
          {product.unit ? (
            <View style={styles.unitBadge}>
              <Text style={styles.unitText}>{product.unit}</Text>
            </View>
          ) : null}
        </View>
        {product.retail_price_eur != null ? (
          <Text style={styles.cardPrice}>{fmt(product.retail_price_eur)}</Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={[styles.addBtn, { backgroundColor: accent }]}
        onPress={() => onRecommend(product)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.addBtnText}>+</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  )
}

// ── Detail modal ─────────────────────────────────────────────────────────────

function DetailModal({
  product,
  catalogColor,
  isWide,
  onClose,
  onRecommend,
}: {
  product: CatalogProduct | null
  catalogColor: string
  isWide: boolean
  onClose: () => void
  onRecommend: () => void
}) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  if (!product) return null

  const accent  = categoryAccent(product.category, catalogColor)
  const catMeta = product.category ? CATEGORY_META[product.category] : null

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.modalOverlay, isWide && styles.modalOverlayWide]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={[styles.modalPanel, isWide && styles.modalPanelWide]}>

          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: accent + '40' }]}>
            <View style={[styles.detailAccentBar, { backgroundColor: accent }]} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.modalProductName, { color: colors.text }]} numberOfLines={2}>
                {product.name}
              </Text>
              {product.latin_name ? (
                <Text style={styles.latinName}>{product.latin_name}</Text>
              ) : null}
              <View style={styles.detailBadgeRow}>
                {product.category ? (
                  <View style={[styles.catBadge, { backgroundColor: accent + '22' }]}>
                    {catMeta ? <Text style={styles.catBadgeEmoji}>{catMeta.emoji}</Text> : null}
                    <Text style={[styles.catBadgeText, { color: accent }]}>{product.category}</Text>
                  </View>
                ) : null}
                {product.unit ? (
                  <View style={styles.unitBadge}>
                    <Text style={styles.unitText}>{product.unit}</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent}>

            {/* Prices */}
            {(product.retail_price_eur != null || product.wholesale_price_eur != null || product.pv != null) && (
              <View style={styles.priceTable}>
                {product.retail_price_eur != null && (
                  <View style={styles.priceCell}>
                    <Text style={styles.priceLabel}>{t('catalog.retail')}</Text>
                    <Text style={styles.priceValue}>{fmt(product.retail_price_eur)}</Text>
                  </View>
                )}
                {product.wholesale_price_eur != null && (
                  <View style={[styles.priceCell, styles.priceCellBorder]}>
                    <Text style={styles.priceLabel}>{t('catalog.wholesale')}</Text>
                    <Text style={[styles.priceValue, { color: colors.primaryAction }]}>
                      {fmt(product.wholesale_price_eur)}
                    </Text>
                  </View>
                )}
                {product.pv != null && (
                  <View style={[styles.priceCell, styles.priceCellBorder]}>
                    <Text style={styles.priceLabel}>{t('catalog.pv')}</Text>
                    <Text style={[styles.priceValue, { color: colors.secondary }]}>
                      {product.pv}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Description */}
            {product.description ? (
              <View style={styles.descBox}>
                <Text style={styles.descText}>{product.description}</Text>
              </View>
            ) : null}

            {/* SKU */}
            {product.sku ? (
              <Text style={styles.skuLine}>SKU : {product.sku}</Text>
            ) : null}

            <Button label={t('catalog.recommend')} onPress={onRecommend} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function CatalogScreen() {
  const { t } = useTranslation()
  const { colors, statusColors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { width } = useWindowDimensions()
  const isWide = width >= 768

  const { activeSlugs } = useCatalogPrefs()
  const [refreshKey, setRefreshKey] = useState(0)
  useFocusEffect(useCallback(() => { setRefreshKey(k => k + 1) }, []))

  const { catalogs, loading: catalogsLoading } = useCatalogs(activeSlugs, refreshKey)
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(null)
  const { products, loading: productsLoading } = useCatalogProducts(selectedCatalogId)

  const [searchQuery, setSearchQuery]           = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // Detail modal
  const [detailProduct, setDetailProduct] = useState<CatalogProduct | null>(null)

  // Recommend modal
  const [recommendState, setRecommendState] = useState<RecommendState | null>(null)
  const [clientQuery, setClientQuery]       = useState('')
  const [clientResults, setClientResults]   = useState<Client[]>([])
  const [clientLoading, setClientLoading]   = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [reason, setReason]                 = useState('')
  const [saving, setSaving]                 = useState(false)
  const [errorMsg, setErrorMsg]             = useState<string | null>(null)
  const [successMsg, setSuccessMsg]         = useState<string | null>(null)

  useEffect(() => {
    if (catalogs.length === 0) return
    const stillActive = catalogs.find(c => c.id === selectedCatalogId)
    if (!stillActive) setSelectedCatalogId(catalogs[0].id)
  }, [catalogs])

  useEffect(() => {
    setSearchQuery('')
    setSelectedCategory(null)
  }, [selectedCatalogId])

  const categories = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const p of products) {
      if (p.category && !seen.has(p.category)) { seen.add(p.category); result.push(p.category) }
    }
    return result.sort()
  }, [products])

  const filteredProducts = useMemo(() => {
    let list = products
    if (selectedCategory) list = list.filter(p => p.category === selectedCategory)
    if (searchQuery.trim().length >= 2) {
      const q = searchQuery.toLowerCase()
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
    }
    return list
  }, [products, selectedCategory, searchQuery])

  const selectedCatalog = catalogs.find(c => c.id === selectedCatalogId) ?? null

  // Live client search
  useEffect(() => {
    if (!recommendState || clientQuery.length < 2 || !session) { setClientResults([]); return }
    let cancelled = false
    setClientLoading(true)
    supabase
      .from('clients')
      .select('id, full_name, first_name, email, status')
      .eq('user_id', session.user.id)
      .ilike('full_name', `%${clientQuery}%`)
      .limit(8)
      .then(({ data }) => {
        if (!cancelled) { setClientResults((data ?? []) as Client[]); setClientLoading(false) }
      })
    return () => { cancelled = true }
  }, [clientQuery, session, recommendState])

  function openDetail(product: CatalogProduct) {
    setDetailProduct(product)
  }

  function openRecommend(product: CatalogProduct) {
    setDetailProduct(null)
    setRecommendState({
      product,
      catalogColor: selectedCatalog?.color ?? colors.primaryAction,
      catalogName:  selectedCatalog?.name  ?? '',
    })
    setSelectedClient(null)
    setClientQuery('')
    setClientResults([])
    setReason('')
    setErrorMsg(null)
    setSuccessMsg(null)
  }

  function closeRecommend() { setRecommendState(null) }

  async function handleRecommend() {
    if (!selectedClient || !recommendState || !session) {
      setErrorMsg(t('appointments.error_client_required'))
      return
    }
    setSaving(true)
    setErrorMsg(null)
    try {
      await createRecommendation(
        session.user.id,
        selectedClient.id,
        recommendState.product.name,
        reason.trim() || null,
        'advised',
        selectedCatalogId,
        recommendState.product.id,
      )
      setSuccessMsg(t('catalog.success'))
      setTimeout(() => closeRecommend(), 1400)
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : t('common.error'))
      console.error('[catalog.recommend]', e)
    } finally {
      setSaving(false)
    }
  }

  if (catalogsLoading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={colors.primaryAction} /></View>
  }

  const accent = selectedCatalog?.color ?? colors.primaryAction

  return (
    <View style={styles.container}>

      {/* ── Fixed header ─────────────────────────────────────────────────── */}
      <View style={[styles.headerOuter, isWide && styles.headerOuterWide]}>
        {catalogs.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catalogTabsContent}>
            {catalogs.map(cat => {
              const active = cat.id === selectedCatalogId
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.catalogTab, active && { backgroundColor: cat.color + '20', borderColor: cat.color }]}
                  onPress={() => setSelectedCatalogId(cat.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.catalogTabIcon}>{cat.icon}</Text>
                  <Text style={[styles.catalogTabText, active && { color: cat.color, fontFamily: fonts.semibold }]}>
                    {cat.name}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        )}

        {catalogs.length === 1 && selectedCatalog && (
          <View style={[styles.catalogHero, { backgroundColor: accent + '14', borderColor: accent + '30' }]}>
            <Text style={styles.catalogHeroIcon}>{selectedCatalog.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.catalogHeroName, { color: accent }]}>{selectedCatalog.name}</Text>
              <Text style={styles.catalogHeroCount}>{products.length} {t('catalog.products_count')}</Text>
            </View>
          </View>
        )}

        {/* Protocols shortcut */}
        <TouchableOpacity
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#D1FAE5', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8, alignSelf: 'flex-start' }}
          onPress={() => {
              const slug = selectedCatalog?.slug ?? null
              const path = slug
                ? `/(app)/catalog/protocols?catalog=${slug}`
                : '/(app)/catalog/protocols'
              router.push(path as any)
            }}
          activeOpacity={0.8}
        >
          <Text style={{ fontSize: 16 }}>🌿</Text>
          <Text style={{ fontSize: 13, fontFamily: fonts.semibold, color: '#059669' }}>{t('catalog.protocols')}</Text>
          <Text style={{ fontSize: 11, color: '#059669', opacity: 0.7 }}>→</Text>
        </TouchableOpacity>

        <Input label="" value={searchQuery} onChangeText={setSearchQuery} placeholder={t('catalog.search_placeholder')} />

        {categories.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryChips}>
            <TouchableOpacity
              style={[styles.categoryChip, !selectedCategory && styles.categoryChipActive]}
              onPress={() => setSelectedCategory(null)}
            >
              <Text style={[styles.categoryChipText, !selectedCategory && styles.categoryChipTextActive]}>
                {t('catalog.all_categories')}
              </Text>
            </TouchableOpacity>
            {categories.map(cat => {
              const active    = selectedCategory === cat
              const meta      = CATEGORY_META[cat]
              const chipColor = meta?.color ?? colors.primaryAction
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.categoryChip, active && { backgroundColor: chipColor + '20', borderColor: chipColor }]}
                  onPress={() => setSelectedCategory(active ? null : cat)}
                >
                  {meta ? <Text style={styles.categoryChipEmoji}>{meta.emoji}</Text> : null}
                  <Text style={[styles.categoryChipText, active && { color: chipColor, fontFamily: fonts.semibold }]}>{cat}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        )}
      </View>

      {/* ── Product grid ─────────────────────────────────────────────────── */}
      <FlatList
        data={filteredProducts}
        keyExtractor={item => item.id}
        numColumns={isWide ? 2 : 1}
        key={isWide ? '2col' : '1col'}
        columnWrapperStyle={isWide ? styles.columnWrapper : undefined}
        contentContainerStyle={[styles.list, isWide && styles.listWide]}
        renderItem={({ item }) => (
          <View style={[styles.cardWrap, isWide && styles.cardWrapWide]}>
            <ProductCard
              product={item}
              catalog={selectedCatalog}
              onDetail={openDetail}
              onRecommend={openRecommend}
            />
          </View>
        )}
        ListEmptyComponent={
          productsLoading
            ? <ActivityIndicator size="small" color={colors.primaryAction} style={styles.listLoader} />
            : <Text style={styles.empty}>
                {searchQuery || selectedCategory ? t('catalog.empty_search') : t('catalog.empty_products')}
              </Text>
        }
      />

      {/* ── Detail modal ─────────────────────────────────────────────────── */}
      {detailProduct && (
        <DetailModal
          product={detailProduct}
          catalogColor={selectedCatalog?.color ?? colors.primaryAction}
          isWide={isWide}
          onClose={() => setDetailProduct(null)}
          onRecommend={() => openRecommend(detailProduct)}
        />
      )}

      {/* ── Recommend modal ───────────────────────────────────────────────── */}
      <Modal
        visible={!!recommendState}
        animationType="slide"
        transparent
        onRequestClose={closeRecommend}
      >
        <View style={[styles.modalOverlay, isWide && styles.modalOverlayWide]}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={closeRecommend} />
          <View style={[styles.modalPanel, isWide && styles.modalPanelWide]}>

            <View style={[styles.modalHeader, { borderBottomColor: recommendState?.catalogColor ?? colors.border }]}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.modalLabel}>{t('catalog.recommend_title')}</Text>
                <Text
                  style={[styles.modalProductName, { color: recommendState?.catalogColor ?? colors.primaryAction }]}
                  numberOfLines={2}
                >
                  {recommendState?.product.name}
                </Text>
              </View>
              <TouchableOpacity onPress={closeRecommend} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} contentContainerStyle={styles.modalBodyContent} keyboardShouldPersistTaps="handled">
              {successMsg ? (
                <View style={styles.successBox}>
                  <Text style={styles.successText}>✓ {successMsg}</Text>
                </View>
              ) : (
                <>
                  <Text style={styles.sectionLabel}>{t('appointments.select_client')}</Text>

                  {selectedClient ? (
                    <View style={styles.selectedCard}>
                      {(() => {
                        const sc = statusColors[selectedClient.status] ?? null
                        return (
                          <>
                            <View style={[styles.avatar, { backgroundColor: sc?.bg ?? colors.primaryLight }]}>
                              <Text style={[styles.avatarText, { color: sc?.text ?? colors.primaryAction }]}>
                                {initials(selectedClient.full_name)}
                              </Text>
                            </View>
                            <View style={styles.selectedInfo}>
                              <Text style={styles.selectedName}>{selectedClient.full_name}</Text>
                              {selectedClient.email ? <Text style={styles.selectedEmail}>{selectedClient.email}</Text> : null}
                            </View>
                            <TouchableOpacity
                              onPress={() => { setSelectedClient(null); setClientQuery('') }}
                              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            >
                              <Text style={styles.clearBtn}>✕</Text>
                            </TouchableOpacity>
                          </>
                        )
                      })()}
                    </View>
                  ) : (
                    <>
                      <Input label="" value={clientQuery} onChangeText={setClientQuery} placeholder={t('clients.search')} />
                      {clientLoading ? <ActivityIndicator size="small" color={colors.primaryAction} style={{ marginTop: 4 }} /> : null}
                      {clientResults.length > 0 && (
                        <View style={styles.resultsBox}>
                          {clientResults.map((c, idx) => {
                            const csc = statusColors[c.status] ?? null
                            return (
                              <TouchableOpacity
                                key={c.id}
                                style={[styles.resultRow, idx > 0 && styles.resultRowDivider]}
                                onPress={() => { setSelectedClient(c); setClientQuery(''); setClientResults([]) }}
                                activeOpacity={0.7}
                              >
                                <View style={[styles.resultAvatar, { backgroundColor: csc?.bg ?? colors.primaryLight }]}>
                                  <Text style={[styles.resultAvatarText, { color: csc?.text ?? colors.primaryAction }]}>
                                    {initials(c.full_name)}
                                  </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.resultName}>{c.full_name}</Text>
                                  {c.email ? <Text style={styles.resultEmail}>{c.email}</Text> : null}
                                </View>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                      )}
                    </>
                  )}

                  <Text style={styles.sectionLabel}>{t('recommendations.reason')} ({t('common.optional')})</Text>
                  <TextArea label="" value={reason} onChangeText={setReason} placeholder={t('catalog.reason_placeholder')} minHeight={60} />

                  {errorMsg ? <Text style={styles.error}>{errorMsg}</Text> : null}
                  <Button label={t('catalog.recommend')} onPress={handleRecommend} loading={saving} />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container:  { flex: 1, backgroundColor: colors.bgDim },
  loader:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listLoader: { marginTop: 48 },
  list:       { paddingBottom: 80 },
  listWide:   { paddingHorizontal: 0 },

  // ── Header ──────────────────────────────────────────────────────────────────
  headerOuter:     { padding: 16, gap: 12 },
  headerOuterWide: { maxWidth: 1100, alignSelf: 'center', width: '100%', paddingHorizontal: 20 },

  catalogTabsContent: { gap: 8, paddingBottom: 2 },
  catalogTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.card,
  },
  catalogTabIcon: { fontSize: 16 },
  catalogTabText: { fontSize: 14, fontFamily: fonts.medium, color: colors.textSecondary },

  catalogHero: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 14, borderWidth: 1,
  },
  catalogHeroIcon:  { fontSize: 30 },
  catalogHeroName:  { fontSize: 18, fontFamily: fonts.bold },
  catalogHeroCount: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary, marginTop: 2 },

  categoryChips:          { gap: 8, paddingBottom: 2 },
  categoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
  },
  categoryChipActive:     { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  categoryChipEmoji:      { fontSize: 13 },
  categoryChipText:       { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  categoryChipTextActive: { color: colors.primary, fontFamily: fonts.semibold },

  // ── Product card ────────────────────────────────────────────────────────────
  columnWrapper: { gap: 12, paddingHorizontal: 20 },
  cardWrap:      { marginHorizontal: 16, marginBottom: 8 },
  cardWrapWide:  { flex: 1, marginHorizontal: 0, marginBottom: 12 },

  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 4, color: 'rgba(0, 0, 0, 0.04)' }], elevation: 1,
  },
  cardAccent:  { width: 4, alignSelf: 'stretch' },
  cardBody:    { flex: 1, padding: 12, gap: 5 },
  productName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text, lineHeight: 20 },
  cardPrice:   { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },

  cardMeta:      { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  catBadge:      { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  catBadgeEmoji: { fontSize: 10 },
  catBadgeText:  { fontSize: 11, fontFamily: fonts.semibold },
  unitBadge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.surfaceContainerHigh },
  unitText:      { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary },

  addBtn:     { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  addBtnText: { fontSize: 22, color: '#fff', lineHeight: 26 },

  empty: { textAlign: 'center', color: colors.textSecondary, fontFamily: fonts.body, fontSize: 15, marginTop: 56 },

  // ── Modals (shared) ─────────────────────────────────────────────────────────
  modalOverlay:     { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalOverlayWide: { justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 60 },
  modalPanel: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    maxHeight: '90%',
    boxShadow: [{ offsetX: 0, offsetY: -4, blurRadius: 20, color: 'rgba(0, 0, 0, 0.14)' }], elevation: 20,
  },
  modalPanelWide:   { borderRadius: 20, maxHeight: '100%' },
  modalHeader: {
    flexDirection: 'row', alignItems: 'flex-start',
    padding: 20, paddingBottom: 14, borderBottomWidth: 1, gap: 10,
  },
  modalLabel:       { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  modalProductName: { fontSize: 17, fontFamily: fonts.bold, lineHeight: 22, color: colors.text },
  modalClose:       { fontSize: 18, color: colors.textTertiary, paddingTop: 2 },
  modalBody:        {},
  modalBodyContent: { padding: 20, gap: 12, paddingBottom: 40 },
  sectionLabel: {
    fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },

  // ── Detail modal specific ───────────────────────────────────────────────────
  detailAccentBar:  { width: 4, borderRadius: 2, marginRight: 12, alignSelf: 'stretch' },
  latinName:        { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, fontStyle: 'italic' },
  detailBadgeRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },

  priceTable: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden',
  },
  priceCell:       { flex: 1, padding: 14, alignItems: 'center', gap: 4 },
  priceCellBorder: { borderLeftWidth: 1, borderLeftColor: colors.border },
  priceLabel:      { fontSize: 11, fontFamily: fonts.medium, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  priceValue:      { fontSize: 16, fontFamily: fonts.bold, color: colors.text },

  descBox:  {
    backgroundColor: colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border,
    padding: 14,
  },
  descText: { fontSize: 14, fontFamily: fonts.body, color: colors.text, lineHeight: 22 },
  skuLine:  { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },

  // ── Recommend modal specific ────────────────────────────────────────────────
  selectedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: 12, padding: 12,
    borderWidth: 1.5, borderColor: colors.primaryLighter,
  },
  avatar:       { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText:   { fontSize: 14, fontFamily: fonts.bold },
  selectedInfo: { flex: 1, gap: 2 },
  selectedName: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
  selectedEmail:{ fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
  clearBtn:     { fontSize: 16, color: colors.textTertiary, padding: 4 },

  resultsBox:       { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  resultRow:        { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  resultRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  resultAvatar:     { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  resultAvatarText: { fontSize: 12, fontFamily: fonts.bold },
  resultName:       { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  resultEmail:      { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },

  error:       { color: colors.danger, fontSize: 14, textAlign: 'center', padding: 10, backgroundColor: colors.dangerLight, borderRadius: 8 },
  successBox:  { backgroundColor: colors.successLight, borderRadius: 12, padding: 20, alignItems: 'center' },
  successText: { fontSize: 16, fontFamily: fonts.semibold, color: colors.success },
  })
}
