import { useState, useEffect, useMemo } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Switch } from 'react-native'
import { Stack, router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/components/ui/Button'
import { Input } from '@/shared/components/ui/Input'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { ActivityType, ModuleKey, ContactRole } from '@/shared/lib/types'
import { ROLE_KEYS, DEFAULT_ROLE_LABELS, ROLE_PRESETS } from '@/shared/lib/types'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'

const ACTIVITY_OPTIONS: { value: ActivityType; label: string; emoji: string }[] = [
  { value: 'generic',   label: 'Générique',    emoji: '🔵' },
  { value: 'doterra',   label: 'doTERRA',       emoji: '🌿' },
  { value: 'zinzino',   label: 'Zinzino',       emoji: '💊' },
  { value: 'herbalife', label: 'Herbalife',     emoji: '🏃' },
  { value: 'custom',    label: 'Autre marque',  emoji: '✏️' },
  { value: 'multi',     label: 'Multi-marques', emoji: '🌐' },
]

const MODULE_OPTIONS: { key: ModuleKey; label: string; desc: string; icon: string }[] = [
  { key: 'products',      icon: '📦', label: 'Catalogue produits',      desc: 'Fiches produits et recommandations' },
  { key: 'renewals_lrp',  icon: '🔄', label: 'Renouvellements / LRP',   desc: 'Commandes récurrentes et LRP' },
  { key: 'downline',      icon: '🌐', label: 'Réseau & Downline',        desc: 'Arbre réseau et équipe' },
  { key: 'goals',         icon: '🎯', label: 'Objectifs mensuels',       desc: 'Suivi des objectifs du mois' },
  { key: 'calendar_sync', icon: '📅', label: 'Sync agenda',              desc: 'Google Agenda et calendrier natif' },
  { key: 'client_import', icon: '📤', label: 'Import clientèle',         desc: 'Import CSV depuis Excel' },
]

export default function CrmSettingsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const {
    profile: bizProfile, labels: statusLabels,
    saveActivityType, toggleModule, isModuleActive, saveLrpName,
    saveLabel, applyActivityPreset, resetLabels,
  } = useAppConfig()

  const [labelDraft, setLabelDraft] = useState<Partial<Record<ContactRole, string>>>({})
  const [labelsSaving, setLabelsSaving] = useState(false)

  useEffect(() => { setLabelDraft({ ...statusLabels }) }, [statusLabels])

  const activePreset = useMemo((): ActivityType | null => {
    for (const [type, preset] of Object.entries(ROLE_PRESETS)) {
      if (!preset) continue
      const entries = Object.entries(preset)
      if (!entries.length) continue
      if (entries.every(([k, v]) => statusLabels[k as ContactRole] === v)) return type as ActivityType
    }
    return null
  }, [statusLabels])

  async function handleSaveLabels() {
    setLabelsSaving(true)
    try {
      for (const [key, val] of Object.entries(labelDraft)) {
        if (val?.trim()) await saveLabel(key as ContactRole, val.trim())
      }
    } finally { setLabelsSaving(false) }
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.nav_crm'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Ma marque ────────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('settings.section_activity').toUpperCase()}</Text>
        <View style={styles.card}>
          <View style={styles.activityGrid}>
            {ACTIVITY_OPTIONS.map(opt => {
              const active = bizProfile.activity_type === opt.value
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.activityChip, active && styles.activityChipActive]}
                  onPress={() => saveActivityType(opt.value as ActivityType)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.activityEmoji}>{opt.emoji}</Text>
                  <Text style={[styles.activityLabel, active && { color: colors.primary, fontFamily: fonts.semibold }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              )
            })}
          </View>
          {bizProfile.activity_type === 'custom' && (
            <Input
              label={t('settings.custom_brand_placeholder')}
              value={bizProfile.custom_brand_name ?? ''}
              onChangeText={v => saveActivityType('custom', v)}
              placeholder={t('settings.custom_brand_placeholder')}
            />
          )}
          <View style={styles.disclaimer}>
            <Text style={styles.disclaimerText}>
              Oryalis est indépendant. Les marques renseignées servent uniquement à votre organisation personnelle.
            </Text>
          </View>
        </View>

        {/* ── Mes modules ──────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('settings.section_modules').toUpperCase()}</Text>
        <View style={styles.card}>
          {MODULE_OPTIONS.map((mod, idx) => (
            <View key={mod.key} style={[styles.moduleRow, idx > 0 && styles.moduleRowBorder]}>
              <Text style={styles.moduleIcon}>{mod.icon}</Text>
              <View style={styles.moduleInfo}>
                <Text style={styles.moduleLabel}>{mod.label}</Text>
                <Text style={styles.moduleDesc}>{mod.desc}</Text>
              </View>
              <Switch
                value={isModuleActive(mod.key)}
                onValueChange={v => toggleModule(mod.key, v)}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor={colors.card}
              />
            </View>
          ))}
          {isModuleActive('renewals_lrp') && (
            <Input
              label={t('settings.custom_lrp_name_label')}
              value={bizProfile.custom_lrp_name ?? ''}
              onChangeText={saveLrpName}
              placeholder={t('settings.custom_lrp_name_placeholder')}
            />
          )}
          <Text style={styles.moduleHint}>Désactiver un module masque son interface. Vos données sont conservées.</Text>
        </View>

        {/* ── Mes libellés ─────────────────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>{t('settings.section_labels').toUpperCase()}</Text>
        <View style={styles.card}>
          <Text style={styles.labelsHint}>{t('settings.labels_hint')}</Text>

          <View style={styles.presetRow}>
            {(['doterra', 'zinzino'] as ActivityType[]).map(type => {
              const isActive = activePreset === type
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.presetBtn, isActive && styles.presetBtnActive]}
                  onPress={() => applyActivityPreset(type)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.presetBtnText, isActive && { color: colors.success }]}>
                    {isActive ? `✓ ${t('settings.preset_applied')}` : t(`settings.preset_${type}`)}
                  </Text>
                </TouchableOpacity>
              )
            })}
            <TouchableOpacity
              style={styles.presetBtnGhost}
              onPress={() => { resetLabels(); setLabelDraft({}) }}
              activeOpacity={0.8}
            >
              <Text style={styles.presetBtnGhostText}>{t('settings.preset_reset')}</Text>
            </TouchableOpacity>
          </View>

          {ROLE_KEYS.map(key => (
            <View key={key} style={styles.labelRow}>
              <Text style={styles.labelKey}>{key}</Text>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.labelInput}
                  value={labelDraft[key] ?? DEFAULT_ROLE_LABELS[key]}
                  onChangeText={v => setLabelDraft(prev => ({ ...prev, [key]: v }))}
                  placeholder={DEFAULT_ROLE_LABELS[key]}
                  placeholderTextColor={colors.textTertiary}
                />
              </View>
            </View>
          ))}

          <Button
            label={labelsSaving ? t('appointments.saving') : t('settings.save')}
            onPress={handleSaveLabels}
            loading={labelsSaving}
          />
        </View>

        {/* ── Import ───────────────────────────────────────────────────────── */}
        <TouchableOpacity
          style={styles.importCard}
          onPress={() => router.push('/(app)/import' as any)}
          activeOpacity={0.85}
        >
          <Text style={styles.importIcon}>📤</Text>
          <View style={styles.importBody}>
            <Text style={styles.importTitle}>{t('settings.nav_import')}</Text>
            <Text style={styles.importDesc}>{t('settings.nav_import_desc')}</Text>
          </View>
          <Text style={styles.importArrow}>›</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 10, maxWidth: 720, alignSelf: 'center', width: '100%' },
  sectionLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, letterSpacing: 0.6, paddingHorizontal: 2, paddingTop: 6 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.border },

  activityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  activityChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.bg },
  activityChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  activityEmoji: { fontSize: 14 },
  activityLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  disclaimer: { backgroundColor: colors.bgDim, borderRadius: 8, padding: 10 },
  disclaimerText: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, lineHeight: 16 },

  moduleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  moduleRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 14, marginTop: 2 },
  moduleIcon: { fontSize: 17, width: 24, textAlign: 'center' },
  moduleInfo: { flex: 1 },
  moduleLabel: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  moduleDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 1 },
  moduleHint: { fontSize: 11, fontFamily: fonts.body, color: colors.textTertiary, fontStyle: 'italic' },

  labelsHint: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17 },
  presetRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.primary },
  presetBtnActive: { backgroundColor: colors.successLight, borderColor: colors.success },
  presetBtnText: { fontSize: 12, fontFamily: fonts.semibold, color: colors.primary },
  presetBtnGhost: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: colors.border },
  presetBtnGhostText: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  labelKey: { fontSize: 10, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5, width: 80, flexShrink: 0 },
  labelInput: { backgroundColor: colors.bg, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontFamily: fonts.medium, color: colors.text },

  importCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
  importIcon: { fontSize: 22 },
  importBody: { flex: 1 },
  importTitle: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
  importDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textTertiary, marginTop: 2 },
  importArrow: { fontSize: 20, color: colors.textTertiary },
  })
}
