import { useState, useEffect, useMemo } from 'react'
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/components/ui/Button'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { useAppConfig } from '@/features/settings/AppConfigProvider'
import type { ActivityType, ContactRole } from '@/shared/lib/types'
import { ROLE_KEYS, DEFAULT_ROLE_LABELS, ROLE_PRESETS } from '@/shared/lib/types'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'

export default function LabelsSettingsScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { labels, saveLabel, applyActivityPreset, resetLabels } = useAppConfig()
  const [draft, setDraft] = useState<Partial<Record<ContactRole, string>>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft({ ...labels }) }, [labels])

  const activePreset = useMemo((): ActivityType | null => {
    for (const [type, preset] of Object.entries(ROLE_PRESETS)) {
      if (!preset) continue
      const entries = Object.entries(preset)
      if (!entries.length) continue
      if (entries.every(([k, v]) => labels[k as ContactRole] === v)) return type as ActivityType
    }
    return null
  }, [labels])

  async function handleSave() {
    setSaving(true)
    try { for (const [k, v] of Object.entries(draft)) { if (v?.trim()) await saveLabel(k as ContactRole, v.trim()) } }
    finally { setSaving(false) }
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.section_labels'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.hint}>{t('settings.labels_hint')}</Text>

        <View style={styles.presetRow}>
          {(['doterra', 'zinzino'] as ActivityType[]).map(type => {
            const isActive = activePreset === type
            return (
              <TouchableOpacity key={type} style={[styles.presetBtn, isActive && styles.presetBtnActive]} onPress={() => applyActivityPreset(type)} activeOpacity={0.8}>
                <Text style={[styles.presetText, isActive && { color: colors.success }]}>
                  {isActive ? `✓ ${t('settings.preset_applied')}` : t(`settings.preset_${type}`)}
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
  })
}
