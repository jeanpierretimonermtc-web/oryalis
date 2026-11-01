import { useState, useEffect, useMemo } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { ActivityType, BrandNetworkRole, ContactRole } from '@/shared/lib/types'
import { ROLE_KEYS, DEFAULT_ROLE_LABELS, ROLE_PRESETS } from '@/shared/lib/types'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { useBrands } from '@/features/brands/useBrands'
import { updateBrand } from '@/features/brands/brandService'
import { BrandAvatar } from '@/features/brands/BrandPill'
import { BRAND_ROLES, BRAND_ROLE_PRESETS, brandRoleLabel } from '@/features/brands/brandRoleLabels'

type Tab = 'general' | string
type BrandPresetKey = keyof typeof BRAND_ROLE_PRESETS

export default function LabelsSettingsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { labels, saveLabel, applyActivityPreset, resetLabels, getRoleLabel } = useAppConfig()
  const { brands, refresh: refreshBrands } = useBrands()
  const [tab, setTab] = useState<Tab>('general')
  const [draft, setDraft] = useState<Partial<Record<ContactRole, string>>>({})
  const [brandDraft, setBrandDraft] = useState<Partial<Record<BrandNetworkRole, string>>>({})
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const brand = brands.find(b => b.id === tab) ?? null

  useEffect(() => { setDraft({ ...labels }) }, [labels])
  useEffect(() => { setBrandDraft({ ...(brand?.role_labels ?? {}) }); setErrorMsg(null) }, [brand])

  const activePreset = useMemo((): ActivityType | null => {
    for (const [type, preset] of Object.entries(ROLE_PRESETS)) {
      if (!preset) continue
      const entries = Object.entries(preset)
      if (!entries.length) continue
      if (entries.every(([k, v]) => labels[k as ContactRole] === v)) return type as ActivityType
    }
    return null
  }, [labels])

  const activeBrandPreset = useMemo((): BrandPresetKey | null => {
    if (!brand) return null
    for (const [key, preset] of Object.entries(BRAND_ROLE_PRESETS)) {
      if (BRAND_ROLES.every(r => (brand.role_labels?.[r] ?? '') === preset[r])) return key as BrandPresetKey
    }
    return null
  }, [brand])

  async function handleSave() {
    setSaving(true)
    try { for (const [k, v] of Object.entries(draft)) { if (v?.trim()) await saveLabel(k as ContactRole, v.trim()) } }
    finally { setSaving(false) }
  }

  async function saveBrandLabels(next: Partial<Record<BrandNetworkRole, string>>) {
    if (!brand) return
    setSaving(true)
    setErrorMsg(null)
    try {
      const cleaned = Object.fromEntries(Object.entries(next).map(([k, v]) => [k, (v ?? '').trim()]).filter(([, v]) => v))
      await updateBrand(brand.id, { role_labels: cleaned })
      refreshBrands()
    } catch (e) {
      console.error('[settingsLabels.brand]', e)
      setErrorMsg(t('brands.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.section_labels'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>{t('settings.labels_hint')}</Text>

        {/* BRAND-ROLES-1 — un vocabulaire par marque, "Général" pour les contacts sans marque. */}
        {brands.length > 0 ? (
          <View style={styles.tabRow}>
            {[{ id: 'general', label: t('settings.labels_tab_general') }, ...brands.map(b => ({ id: b.id, label: b.name }))].map(item => {
              const active = tab === item.id
              const b = brands.find(x => x.id === item.id)
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.tabBtn, active && styles.tabBtnActive]}
                  onPress={() => setTab(item.id)}
                  activeOpacity={0.75}
                >
                  {b ? <BrandAvatar brand={b} size={18} /> : null}
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        ) : null}

        {brand ? (
          <>
            <Text style={styles.hint}>{t('settings.labels_brand_hint', { brand: brand.name })}</Text>
            <Text style={styles.currentPreset}>
              {t('settings.preset_current', {
                name: activeBrandPreset ? t(`settings.preset_${activeBrandPreset}`) : t('settings.preset_custom'),
              })}
            </Text>
            <View style={styles.presetRow}>
              {(Object.keys(BRAND_ROLE_PRESETS) as BrandPresetKey[]).map(key => {
                const isActive = activeBrandPreset === key
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.presetBtn, isActive && styles.presetBtnActive]}
                    onPress={() => { setBrandDraft(BRAND_ROLE_PRESETS[key]); saveBrandLabels(BRAND_ROLE_PRESETS[key]) }}
                    accessibilityState={{ selected: isActive }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.presetText, isActive && { color: colors.success }]}>
                      {isActive ? `✓ ${t(`settings.preset_${key}`)} · ${t('settings.preset_applied')}` : t(`settings.preset_${key}`)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
              <TouchableOpacity style={styles.resetBtn} onPress={() => { setBrandDraft({}); saveBrandLabels({}) }} activeOpacity={0.8}>
                <Text style={styles.resetText}>{t('settings.preset_reset')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              {BRAND_ROLES.map((role, idx) => (
                <View key={role} style={[styles.labelRow, idx > 0 && styles.labelRowBorder]}>
                  <Text style={styles.keyText}>{t(`brands.role_key_${role}`)}</Text>
                  <TextInput
                    style={styles.input}
                    value={brandDraft[role] ?? ''}
                    onChangeText={v => setBrandDraft(prev => ({ ...prev, [role]: v }))}
                    placeholder={brandRoleLabel(null, role, getRoleLabel)}
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
              ))}
            </View>

            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}
            <Button label={saving ? t('appointments.saving') : t('settings.save')} onPress={() => saveBrandLabels(brandDraft)} loading={saving} />
          </>
        ) : (
          <>
            {/* La sélection en cours est toujours écrite en clair (jamais seulement "Appliqué"). */}
            <Text style={styles.currentPreset}>
              {t('settings.preset_current', {
                name: activePreset ? t(`settings.preset_${activePreset}`) : t('settings.preset_custom'),
              })}
            </Text>

            <View style={styles.presetRow}>
              {(['doterra', 'zinzino'] as ActivityType[]).map(type => {
                const isActive = activePreset === type
                return (
                  <TouchableOpacity
                    key={type}
                    style={[styles.presetBtn, isActive && styles.presetBtnActive]}
                    onPress={() => applyActivityPreset(type)}
                    accessibilityState={{ selected: isActive }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.presetText, isActive && { color: colors.success }]}>
                      {isActive ? `✓ ${t(`settings.preset_${type}`)} · ${t('settings.preset_applied')}` : t(`settings.preset_${type}`)}
                    </Text>
                  </TouchableOpacity>
                )
              })}
              <TouchableOpacity style={styles.resetBtn} onPress={() => { resetLabels(); setDraft({}) }} activeOpacity={0.8}>
                <Text style={styles.resetText}>{t('settings.preset_reset')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              {ROLE_KEYS.map((key, idx) => (
                <View key={key} style={[styles.labelRow, idx > 0 && styles.labelRowBorder]}>
                  <Text style={styles.keyText}>{key}</Text>
                  <TextInput
                    style={styles.input}
                    value={draft[key] ?? DEFAULT_ROLE_LABELS[key]}
                    onChangeText={v => setDraft(prev => ({ ...prev, [key]: v }))}
                    placeholder={DEFAULT_ROLE_LABELS[key]}
                    placeholderTextColor={colors.textTertiary}
                  />
                </View>
              ))}
            </View>

            <Button label={saving ? t('appointments.saving') : t('settings.save')} onPress={handleSave} loading={saving} />
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12, maxWidth: 720, alignSelf: 'center', width: '100%' },
  hint: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 19 },
  currentPreset: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.primary },
  presetBtnActive: { backgroundColor: colors.successLight, borderColor: colors.success },
  presetText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
  resetBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  resetText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  labelRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  keyText: { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, width: 90, flexShrink: 0 },
  input: { flex: 1, fontSize: 14, fontFamily: fonts.medium, color: colors.text, backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8 },
  tabRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tabBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  tabBtnActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  tabText: { fontSize: 13, fontFamily: fonts.medium, color: colors.textSecondary },
  tabTextActive: { color: colors.primary, fontFamily: fonts.semibold },
  errorText: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
  })
}
