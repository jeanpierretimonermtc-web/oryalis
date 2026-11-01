import { useMemo, useState } from 'react'
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput } from 'react-native'
import { useTranslation } from 'react-i18next'
import * as ImagePicker from 'expo-image-picker'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { BrandAvatar, BrandPill } from './BrandPill'
import { BrandInput } from './BrandInput'
import { BRAND_PALETTES, brandPalette } from './brandColors'
import { useBrands } from './useBrands'
import { updateBrand, uploadBrandLogo, mergeBrands, deleteBrand, BrandExistsError } from './brandService'
import type { BrandWithCounts } from './brandService'

// BRANDS-1 — "Mes marques" (écran Ma marque, mode multi-marques) : liste, ajout assisté,
// couleur, logo privé, renommage et fusion de doublons.
export function BrandsManager({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { brands, loading, refresh } = useBrands()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [programDraft, setProgramDraft] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const editing = brands.find(b => b.id === editingId) ?? null

  async function run(action: () => Promise<void>, errorKey = 'brands.error') {
    setBusy(true)
    setErrorMsg('')
    try {
      await action()
      await refresh()
    } catch (e) {
      console.error('[brands.manager]', e)
      setErrorMsg(e instanceof BrandExistsError ? t('brands.error_exists') : t(errorKey))
    } finally {
      setBusy(false)
    }
  }

  function openEdit(brand: BrandWithCounts) {
    setEditingId(brand.id === editingId ? null : brand.id)
    setNameDraft(brand.name)
    setProgramDraft(brand.program_name ?? '')
    setMergeOpen(false)
    setErrorMsg('')
  }

  async function pickLogo(brand: BrandWithCounts) {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7 })
    if (result.canceled || !result.assets?.[0]) return
    await run(async () => { await uploadBrandLogo(userId, brand.id, result.assets[0].uri) }, 'brands.error_logo')
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('brands.my_brands')}</Text>
        <Text style={styles.muted}>{t('brands.count', { count: brands.length })}</Text>
      </View>

      {loading ? <ActivityIndicator color={colors.primary} /> : null}

      {brands.map(brand => (
        <View key={brand.id}>
          <View style={styles.row}>
            <BrandAvatar brand={brand} />
            <View style={styles.rowMain}>
              <Text style={styles.brandName}>{brand.name}</Text>
              <Text style={styles.muted}>
                {brand.catalog_id ? t('brands.with_catalog') : t('brands.without_catalog')} · {t('brands.contacts_count', { count: brand.contactCount })}
              </Text>
            </View>
            <BrandPill brand={brand} size="sm" />
            <TouchableOpacity onPress={() => openEdit(brand)} activeOpacity={0.7}>
              <Text style={styles.link}>{editingId === brand.id ? t('brands.close') : `${t('common.edit')} ›`}</Text>
            </TouchableOpacity>
          </View>

          {editing?.id === brand.id ? (
            <View style={styles.editBox}>
              <Text style={styles.fieldLabel}>{t('brands.name_label')}</Text>
              <View style={styles.inlineRow}>
                <TextInput style={styles.nameInput} value={nameDraft} onChangeText={setNameDraft} maxLength={80} accessibilityLabel={t('brands.name_label')} />
                <TouchableOpacity
                  style={[styles.smallBtn, (!nameDraft.trim() || nameDraft.trim() === brand.name || busy) && { opacity: 0.5 }]}
                  onPress={() => run(() => updateBrand(brand.id, { name: nameDraft.trim() }))}
                  disabled={!nameDraft.trim() || nameDraft.trim() === brand.name || busy}
                  activeOpacity={0.85}
                >
                  <Text style={styles.smallBtnText}>{t('common.save')}</Text>
                </TouchableOpacity>
              </View>

              {/* PROGRAM-BRAND-1 — nom du programme de fidélité de cette marque. */}
              <Text style={styles.fieldLabel}>{t('brands.program_name_label')}</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  style={styles.nameInput}
                  value={programDraft}
                  onChangeText={setProgramDraft}
                  placeholder={t('brands.program_name_placeholder')}
                  placeholderTextColor={colors.textTertiary}
                  maxLength={40}
                  accessibilityLabel={t('brands.program_name_label')}
                />
                <TouchableOpacity
                  style={[styles.smallBtn, (programDraft.trim() === (brand.program_name ?? '') || busy) && { opacity: 0.5 }]}
                  onPress={() => run(() => updateBrand(brand.id, { program_name: programDraft.trim() || null }))}
                  disabled={programDraft.trim() === (brand.program_name ?? '') || busy}
                  activeOpacity={0.85}
                >
                  <Text style={styles.smallBtnText}>{t('common.save')}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>{t('brands.color_label')}</Text>
              <View style={styles.swatches}>
                {BRAND_PALETTES.map(p => {
                  const selected = brandPalette(brand).key === p.key
                  return (
                    <TouchableOpacity
                      key={p.key}
                      onPress={() => run(() => updateBrand(brand.id, { color: p.key }))}
                      disabled={busy}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={p.key}
                      style={[styles.swatch, { backgroundColor: p.text }, selected && { borderColor: colors.text }]}
                    />
                  )
                })}
              </View>

              <Text style={styles.fieldLabel}>{t('brands.logo_label')}</Text>
              <View style={styles.inlineRow}>
                <BrandAvatar brand={brand} size={44} />
                <TouchableOpacity style={styles.outlineBtn} onPress={() => pickLogo(brand)} disabled={busy} activeOpacity={0.8}>
                  <Text style={styles.outlineBtnText}>{brand.logo_url ? t('brands.logo_replace') : t('brands.logo_import')}</Text>
                </TouchableOpacity>
                {brand.logo_url ? (
                  <TouchableOpacity onPress={() => run(() => updateBrand(brand.id, { logo_url: null }))} disabled={busy} activeOpacity={0.7}>
                    <Text style={styles.removeText}>{t('brands.logo_remove')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <Text style={styles.hint}>{t('brands.logo_hint')}</Text>

              {brands.length > 1 ? (
                !mergeOpen ? (
                  <TouchableOpacity onPress={() => setMergeOpen(true)} activeOpacity={0.7}>
                    <Text style={styles.link}>{t('brands.merge_cta')}</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.mergeBox}>
                    <Text style={styles.muted}>{t('brands.merge_hint', { name: brand.name })}</Text>
                    <View style={styles.swatches}>
                      {brands.filter(b => b.id !== brand.id).map(target => (
                        <TouchableOpacity
                          key={target.id}
                          style={styles.outlineBtn}
                          onPress={() => run(async () => { await mergeBrands(brand.id, target.id); setEditingId(null) })}
                          disabled={busy}
                          activeOpacity={0.8}
                        >
                          <Text style={styles.outlineBtnText}>→ {target.name}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity onPress={() => setMergeOpen(false)} activeOpacity={0.7}>
                      <Text style={styles.muted}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                  </View>
                )
              ) : null}
              {/* Suppression : confirmation obligatoire (clic par erreur). */}
              {confirmDeleteId === brand.id ? (
                <View style={styles.deleteBox}>
                  <Text style={styles.deleteTitle}>{t('brands.delete_confirm_title', { name: brand.name })}</Text>
                  <Text style={styles.muted}>
                    {t('brands.delete_confirm_contacts', { count: brand.contactCount })}{' '}
                    {t('brands.delete_confirm_programs', { count: brand.programCount })}
                    {brand.catalog_id ? ` ${t('brands.delete_confirm_catalog')}` : ''}
                  </Text>
                  <View style={styles.inlineRow}>
                    <TouchableOpacity style={styles.outlineBtn} onPress={() => setConfirmDeleteId(null)} disabled={busy} activeOpacity={0.8}>
                      <Text style={styles.outlineBtnText}>{t('common.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.dangerBtn}
                      onPress={() => run(async () => { await deleteBrand(brand.id); setEditingId(null); setConfirmDeleteId(null) })}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.smallBtnText}>{t('brands.delete_confirm_cta')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <TouchableOpacity onPress={() => setConfirmDeleteId(brand.id)} activeOpacity={0.7}>
                  <Text style={styles.removeText}>🗑 {t('brands.delete_cta')}</Text>
                </TouchableOpacity>
              )}
              {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
            </View>
          ) : null}
        </View>
      ))}

      <View style={styles.addSection}>
        <Text style={styles.fieldLabel}>+ {t('brands.add_cta_long')}</Text>
        <BrandInput userId={userId} brands={brands} onSelect={() => refresh()} />
        <Text style={styles.hint}>{t('brands.reference_hint')}</Text>
      </View>
      {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
    </View>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.cardBorder, padding: 20, gap: 12, ...SOFT_CARD_SHADOW },
    header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    title: { fontSize: 17, fontFamily: fonts.bold, color: colors.text },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    rowMain: { flex: 1, gap: 2 },
    brandName: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    muted: { fontSize: 12.5, fontFamily: fonts.body, color: colors.textSecondary },
    link: { fontSize: 13, fontFamily: fonts.semibold, color: colors.primary },
    editBox: { gap: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginVertical: 6 },
    fieldLabel: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.textSecondary },
    inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    nameInput: { flex: 1, minWidth: 160, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontFamily: fonts.body, fontSize: 14, color: colors.text, backgroundColor: colors.card },
    smallBtn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.primaryAction },
    smallBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.onPrimary },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 3, borderColor: 'transparent' },
    outlineBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    outlineBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.text },
    removeText: { fontSize: 12.5, fontFamily: fonts.semibold, color: colors.danger },
    mergeBox: { gap: 8 },
    deleteBox: { gap: 8, marginTop: 4, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.dangerLight },
    deleteTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    dangerBtn: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.danger },
    addSection: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
    hint: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary },
    errorText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.danger },
  })
}
