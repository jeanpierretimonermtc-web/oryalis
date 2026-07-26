import { useState, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import { exportAllData, exportAllDataXlsx } from '@/features/clients/exportService'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'

export default function ExportScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()

  const [exportingXlsx, setExportingXlsx] = useState(false)
  const [exportingJson, setExportingJson] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error,  setError]  = useState<string | null>(null)

  async function runXlsx() {
    if (!session || exportingXlsx || exportingJson) return
    setError(null); setResult(null); setExportingXlsx(true)
    try {
      const count = await exportAllDataXlsx(session.user.id)
      setResult(t('settings.export_done', { count }))
    } catch (e: any) {
      setError(e.message ?? t('common.error'))
    } finally {
      setExportingXlsx(false)
    }
  }

  async function runJson() {
    if (!session || exportingXlsx || exportingJson) return
    setError(null); setResult(null); setExportingJson(true)
    try {
      const count = await exportAllData(session.user.id)
      setResult(t('settings.export_done', { count }))
    } catch (e: any) {
      setError(e.message ?? t('common.error'))
    } finally {
      setExportingJson(false)
    }
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.export_title'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        <View style={styles.introCard}>
          <Text style={styles.introText}>{t('settings.export_intro')}</Text>
        </View>

        {/* ── Excel (option principale) ─────────────────────────────────── */}
        <TouchableOpacity
          style={[styles.xlsxBtn, exportingXlsx && { opacity: 0.7 }]}
          onPress={runXlsx}
          disabled={exportingXlsx || exportingJson}
          activeOpacity={0.85}
        >
          {exportingXlsx ? (
            <View style={styles.btnInner}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.xlsxBtnText}>{t('settings.export_exporting')}</Text>
            </View>
          ) : (
            <Text style={styles.xlsxBtnText}>{t('settings.export_xlsx_btn')}</Text>
          )}
        </TouchableOpacity>
        <Text style={styles.xlsxDesc}>{t('settings.export_xlsx_desc')}</Text>

        {/* ── JSON (option secondaire / technique) ──────────────────────── */}
        <View style={styles.jsonCard}>
          <Text style={styles.jsonTitle}>{t('settings.export_json_title')}</Text>
          <Text style={styles.jsonDesc}>{t('settings.export_json_desc')}</Text>
          <TouchableOpacity
            style={[styles.jsonBtn, exportingJson && { opacity: 0.7 }]}
            onPress={runJson}
            disabled={exportingXlsx || exportingJson}
            activeOpacity={0.8}
          >
            {exportingJson ? (
              <View style={styles.btnInner}>
                <ActivityIndicator color={colors.textSecondary} size="small" />
                <Text style={styles.jsonBtnText}>{t('settings.export_exporting')}</Text>
              </View>
            ) : (
              <Text style={styles.jsonBtnText}>{t('settings.export_json_btn')}</Text>
            )}
          </TouchableOpacity>
        </View>

        {result ? <Text style={styles.resultText}>✓ {result}</Text> : null}
        {error  ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={{ height: 48 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bgDim },
    content:   { padding: 16, gap: 14, maxWidth: 720, alignSelf: 'center', width: '100%' },

    introCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
    introText: { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },

    xlsxBtn: {
      backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 18, alignItems: 'center',
    },
    xlsxBtnText: { fontSize: 16, fontFamily: fonts.semibold, color: '#fff' },
    xlsxDesc: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, textAlign: 'center', lineHeight: 17, marginTop: -6 },
    btnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },

    jsonCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
    jsonTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
    jsonDesc:  { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17 },
    jsonBtn: {
      backgroundColor: colors.bgDim, borderRadius: 10, paddingVertical: 12, alignItems: 'center',
      borderWidth: 1, borderColor: colors.border,
    },
    jsonBtnText: { fontSize: 13, fontFamily: fonts.semibold, color: colors.textSecondary },

    resultText: { fontSize: 13, fontFamily: fonts.medium, color: colors.success, backgroundColor: colors.successLight, borderRadius: 8, padding: 10 },
    errorText:  { fontSize: 13, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
  })
}
