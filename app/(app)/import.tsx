import { useState, useMemo } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, Platform, Modal,
} from 'react-native'
import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as DocumentPicker from 'expo-document-picker'
import * as Clipboard from 'expo-clipboard'
import { useAuth } from '@/features/auth/AuthProvider'
import { parseCSV, mapHeaders, importCSVClients, countImportableRows, TARGET_FIELDS } from '@/features/clients/importService'
import type { ParsedCSV } from '@/features/clients/importService'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { settingsScreenOptions } from '@/features/settings/SettingsBackButton'
import { useContactQuota } from '@/features/clients/useContactQuota'

const EXAMPLE_COLUMNS = 'full_name, email, phone, status, notes, country, language, contact_role, next_followup_date'
const EXAMPLE_ROW     = 'Sophie Martin, sophie@email.fr, 0612345678, prospect, Intéressée doTERRA, France, fr, prospect, 2026-07-15'

export default function ImportScreen() {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const { session } = useAuth()
  const { quota, loading: quotaLoading, refresh: refreshQuota } = useContactQuota()

  const [parsed,   setParsed]   = useState<ParsedCSV | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress]   = useState(0)
  const [result,   setResult]     = useState<{ created: number; skipped: number; duplicates: number; errors: number; msgs: string[]; dupMsgs: string[] } | null>(null)
  const [error,    setError]      = useState<string | null>(null)

  // Colonne (index dans parsed.headers) → champ Oryalis choisi, ou null si ignorée.
  // Pré-rempli par auto-détection, modifiable manuellement (option "mapping manuel").
  const [columnAssignment, setColumnAssignment] = useState<Record<number, string | null>>({})
  const [pickerForColumn, setPickerForColumn]   = useState<number | null>(null)
  const [promptCopied, setPromptCopied]         = useState(false)

  const mapping = useMemo(() => {
    const m: Record<string, number> = {}
    Object.entries(columnAssignment).forEach(([idx, field]) => {
      if (field) m[field] = Number(idx)
    })
    return m
  }, [columnAssignment])
  const hasNameField = Boolean(mapping.full_name || mapping.first_name || mapping.last_name)
  const preview = parsed?.rows.slice(0, 5) ?? []
  const validRows = parsed ? countImportableRows(parsed, mapping) : 0
  const willImport = quota?.remaining == null ? validRows : Math.min(validRows, quota.remaining)
  const willIgnore = parsed ? parsed.rows.length - willImport : 0

  function assignField(colIdx: number, field: string | null) {
    setColumnAssignment(prev => {
      const next = { ...prev }
      if (field) {
        for (const k of Object.keys(next)) {
          if (next[Number(k)] === field) next[Number(k)] = null
        }
      }
      next[colIdx] = field
      return next
    })
    setPickerForColumn(null)
  }

  async function copyAiPrompt() {
    const prompt = t('settings.import_ai_prompt', { columns: EXAMPLE_COLUMNS })
    await Clipboard.setStringAsync(prompt)
    setPromptCopied(true)
    setTimeout(() => setPromptCopied(false), 2000)
  }

  function applyParsed(p: ParsedCSV) {
    setParsed(p)
    const detected = mapHeaders(p.headers)
    const assignment: Record<number, string | null> = {}
    p.headers.forEach((_, idx) => { assignment[idx] = null })
    Object.entries(detected).forEach(([field, idx]) => { assignment[idx] = field })
    setColumnAssignment(assignment)
  }

  async function pickFile() {
    setError(null)
    setResult(null)
    setParsed(null)
    setColumnAssignment({})

    try {
      if (Platform.OS === 'web') {
        // Web: use hidden file input
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.csv,text/csv'
        input.onchange = async (e: any) => {
          const file: File = e.target.files[0]
          if (!file) return
          setFileName(file.name)
          const text = await file.text()
          const p = parseCSV(text)
          if (p.headers.length === 0) { setError(t('settings.import_error_empty')); return }
          applyParsed(p)
        }
        input.click()
      } else {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
          copyToCacheDirectory: true,
        })
        if (result.canceled) return
        const asset = result.assets[0]
        setFileName(asset.name)
        const response = await fetch(asset.uri)
        const text = await response.text()
        const p = parseCSV(text)
        if (p.headers.length === 0) { setError(t('settings.import_error_empty')); return }
        applyParsed(p)
      }
    } catch (e: any) {
      setError(e.message ?? t('common.error'))
    }
  }

  async function startImport() {
    if (!parsed || !session || quotaLoading) return
    setImporting(true)
    setResult(null)
    setProgress(0)
    try {
      const res = await importCSVClients(
        session.user.id,
        parsed,
        mapping,
        (done, total) => setProgress(total > 0 ? Math.round((done / total) * 100) : 0),
        quota?.remaining ?? null,
      )
      setResult({ created: res.created, skipped: res.skipped, duplicates: res.duplicates, errors: res.errors, msgs: res.errorMessages, dupMsgs: res.duplicateMessages })
      await refreshQuota()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <Stack.Screen options={settingsScreenOptions(t('settings.import_title'))} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {quota?.limit != null && (
          <View style={styles.quotaCard}>
            <Text style={styles.quotaTitle}>{t('clients.quota_title')}</Text>
            <Text style={styles.quotaText}>{t('clients.quota_count', { count: quota.activeCount, limit: quota.limit })}</Text>
          </View>
        )}

        {/* ── Format attendu ─────────────────────────────────────────────── */}
        <View style={styles.formatCard}>
          <Text style={styles.formatTitle}>{t('settings.import_format_title')}</Text>
          <Text style={styles.formatDesc}>{t('settings.import_format_desc')}</Text>
          <Text style={styles.columnsLabel}>{t('settings.import_columns')}</Text>
          <View style={styles.codeBlock}>
            <Text style={styles.codeHeader}>{EXAMPLE_COLUMNS}</Text>
            <Text style={styles.codeRow}>{EXAMPLE_ROW}</Text>
          </View>
        </View>

        {/* ── Aide IA (toujours visible — un lien à cliquer passait inaperçu) ─ */}
        <View style={styles.aiCard}>
          <Text style={styles.aiTitle}>{t('settings.import_ai_help_title')}</Text>
          <Text style={styles.aiDesc}>{t('settings.import_ai_help_desc')}</Text>
          <Text style={styles.aiWarning}>{t('settings.import_ai_help_warning')}</Text>
          <TouchableOpacity style={styles.aiCopyBtn} onPress={copyAiPrompt} activeOpacity={0.85}>
            <Text style={styles.aiCopyBtnText}>
              {promptCopied ? t('settings.import_ai_copied') : t('settings.import_ai_copy')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Picker ─────────────────────────────────────────────────────── */}
        <TouchableOpacity style={styles.pickBtn} onPress={pickFile} activeOpacity={0.85} disabled={importing}>
          <Text style={styles.pickBtnIcon}>📂</Text>
          <Text style={styles.pickBtnText}>
            {fileName ?? t('settings.import_pick')}
          </Text>
        </TouchableOpacity>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* ── Preview ────────────────────────────────────────────────────── */}
        {parsed && !result && (
          <>
            {/* Column mapping — auto-detected, editable manually */}
            <View style={styles.detectedCard}>
              <Text style={styles.detectedTitle}>{t('settings.import_mapping_title')}</Text>
              <Text style={styles.mappingHint}>{t('settings.import_mapping_hint')}</Text>
              {parsed.headers.map((header, idx) => {
                const field = columnAssignment[idx] ?? null
                const fieldLabel = field
                  ? t(TARGET_FIELDS.find(f => f.key === field)?.labelKey ?? '')
                  : t('settings.import_field_none')
                return (
                  <TouchableOpacity
                    key={idx}
                    style={styles.mappingRow}
                    onPress={() => setPickerForColumn(idx)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.mappingHeader} numberOfLines={1}>{header || `#${idx + 1}`}</Text>
                    <Text style={styles.mappingArrow}>→</Text>
                    <Text style={[styles.mappingFieldText, !field && styles.mappingFieldTextEmpty]} numberOfLines={1}>
                      {fieldLabel}
                    </Text>
                  </TouchableOpacity>
                )
              })}
              {!hasNameField && (
                <Text style={styles.warnText}>{t('settings.import_error_no_name')}</Text>
              )}
            </View>

            <View style={styles.capacityCard}>
              <View style={styles.capacityMetric}>
                <Text style={[styles.capacityNumber, { color: colors.success }]}>{willImport}</Text>
                <Text style={styles.capacityLabel}>{t('settings.import_will_create')}</Text>
              </View>
              <View style={styles.capacityDivider} />
              <View style={styles.capacityMetric}>
                <Text style={[styles.capacityNumber, { color: willIgnore > 0 ? colors.warning : colors.textTertiary }]}>{willIgnore}</Text>
                <Text style={styles.capacityLabel}>{t('settings.import_will_ignore')}</Text>
              </View>
            </View>
            {quota?.remaining != null && validRows > quota.remaining && (
              <Text style={styles.capacityWarning}>{t('settings.import_quota_warning', { remaining: quota.remaining })}</Text>
            )}

            {/* Preview table */}
            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>{t('settings.import_preview_title')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  {/* Header row */}
                  <View style={styles.tableRow}>
                    {parsed.headers.map((h, i) => (
                      <View key={i} style={styles.tableCell}>
                        <Text style={styles.tableHeaderText} numberOfLines={1}>{h}</Text>
                      </View>
                    ))}
                  </View>
                  {/* Data rows */}
                  {preview.map((row, ri) => (
                    <View key={ri} style={[styles.tableRow, ri % 2 === 1 && styles.tableRowAlt]}>
                      {row.map((cell, ci) => (
                        <View key={ci} style={styles.tableCell}>
                          <Text style={styles.tableCellText} numberOfLines={1}>{cell}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
              <Text style={styles.rowCount}>{parsed.rows.length} lignes au total</Text>
            </View>

            {/* Import button */}
            {hasNameField && (
              <TouchableOpacity
                style={[styles.importBtn, importing && { opacity: 0.6 }]}
                onPress={startImport}
                disabled={importing || quotaLoading}
                activeOpacity={0.85}
              >
                {importing ? (
                  <View style={styles.importBtnInner}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.importBtnText}>{t('settings.import_importing')} {progress}%</Text>
                  </View>
                ) : (
                  <Text style={styles.importBtnText}>
                    {t('settings.import_start', { count: parsed.rows.length })}
                  </Text>
                )}
              </TouchableOpacity>
            )}
          </>
        )}

        {/* ── Résultats ──────────────────────────────────────────────────── */}
        {result && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>✓ {t('settings.import_done')}</Text>
            <View style={styles.resultRows}>
              <View style={[styles.resultRow, { backgroundColor: colors.successLight }]}>
                <Text style={[styles.resultNum, { color: colors.success }]}>{result.created}</Text>
                <Text style={[styles.resultLabel, { color: colors.success }]}>
                  {t('settings.import_result_created', { n: result.created })}
                </Text>
              </View>
              {result.duplicates > 0 && (
                <View style={[styles.resultRow, { backgroundColor: colors.warningLight }]}>
                  <Text style={[styles.resultNum, { color: colors.warning }]}>{result.duplicates}</Text>
                  <Text style={[styles.resultLabel, { color: colors.warning }]}>
                    {t('settings.import_result_duplicates', { n: result.duplicates })}
                  </Text>
                </View>
              )}
              {result.skipped > 0 && (
                <View style={[styles.resultRow, { backgroundColor: colors.warningLight }]}>
                  <Text style={[styles.resultNum, { color: colors.warning }]}>{result.skipped}</Text>
                  <Text style={[styles.resultLabel, { color: colors.warning }]}>
                    {t('settings.import_result_skipped', { n: result.skipped })}
                  </Text>
                </View>
              )}
              {result.errors > 0 && (
                <View style={[styles.resultRow, { backgroundColor: colors.dangerLight }]}>
                  <Text style={[styles.resultNum, { color: colors.danger }]}>{result.errors}</Text>
                  <Text style={[styles.resultLabel, { color: colors.danger }]}>
                    {t('settings.import_result_errors', { n: result.errors })}
                  </Text>
                </View>
              )}
            </View>
            {result.dupMsgs.length > 0 && (
              <ScrollView style={styles.errList}>
                {result.dupMsgs.map((m, i) => (
                  <Text key={i} style={[styles.errItem, { color: colors.warning }]}>{m}</Text>
                ))}
              </ScrollView>
            )}
            {result.msgs.length > 0 && (
              <ScrollView style={styles.errList}>
                {result.msgs.map((m, i) => (
                  <Text key={i} style={styles.errItem}>{m}</Text>
                ))}
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.pickBtn}
              onPress={() => { setParsed(null); setResult(null); setFileName(null); setColumnAssignment({}) }}
              activeOpacity={0.8}
            >
              <Text style={styles.pickBtnText}>Importer un autre fichier</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 48 }} />
      </ScrollView>

      {/* Field picker modal */}
      <Modal
        visible={pickerForColumn !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerForColumn(null)}
      >
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setPickerForColumn(null)}>
          <View style={styles.modalSheet} onStartShouldSetResponder={() => true}>
            <ScrollView>
              <TouchableOpacity
                style={styles.modalOption}
                onPress={() => pickerForColumn !== null && assignField(pickerForColumn, null)}
              >
                <Text style={styles.modalOptionText}>{t('settings.import_field_none')}</Text>
              </TouchableOpacity>
              {TARGET_FIELDS.map(f => (
                <TouchableOpacity
                  key={f.key}
                  style={styles.modalOption}
                  onPress={() => pickerForColumn !== null && assignField(pickerForColumn, f.key)}
                >
                  <Text style={styles.modalOptionText}>{t(f.labelKey)}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgDim },
  content:   { padding: 16, gap: 14, maxWidth: 800, alignSelf: 'center', width: '100%' },
  quotaCard: { backgroundColor: colors.primaryLight, borderWidth: 1, borderColor: colors.primary, borderRadius: 12, padding: 14, gap: 3 },
  quotaTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.primary },
  quotaText: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },

  formatCard: { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border },
  formatTitle: { fontSize: 15, fontFamily: fonts.bold, color: colors.text },
  formatDesc:  { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  codeBlock:   { backgroundColor: colors.bg, borderRadius: 8, padding: 10, gap: 4, borderWidth: 1, borderColor: colors.border },
  codeHeader:  { fontSize: 10, fontFamily: fonts.semibold, color: colors.primary, lineHeight: 16 },
  codeRow:     { fontSize: 10, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 16 },
  columnsLabel: { fontSize: 11, fontFamily: fonts.bold, color: colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },

  pickBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: colors.primaryLight, borderRadius: 14, paddingVertical: 16,
    borderWidth: 1.5, borderColor: colors.primary, borderStyle: 'dashed',
  },
  pickBtnIcon: { fontSize: 22 },
  pickBtnText: { fontSize: 15, fontFamily: fonts.semibold, color: colors.primary },

  errorText: { fontSize: 13, color: colors.danger, backgroundColor: colors.dangerLight, borderRadius: 8, padding: 10 },
  warnText:  { fontSize: 12, color: colors.warning, fontFamily: fonts.medium },

  detectedCard: { backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: colors.border },
  detectedTitle:{ fontSize: 12, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  mappingHint:  { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 17, marginBottom: 2 },
  mappingRow:   {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  mappingHeader:    { flex: 1, fontSize: 12, fontFamily: fonts.medium, color: colors.text },
  mappingArrow:     { fontSize: 12, color: colors.textTertiary },
  mappingFieldText: {
    flex: 1, textAlign: 'right', fontSize: 12, fontFamily: fonts.semibold, color: colors.primary,
    backgroundColor: colors.primaryLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
  },
  mappingFieldTextEmpty: { color: colors.textTertiary, backgroundColor: colors.bgDim },

  aiCard:       { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.border },
  aiTitle:      { fontSize: 14, fontFamily: fonts.bold, color: colors.text },
  aiDesc:       { fontSize: 13, fontFamily: fonts.body, color: colors.textSecondary, lineHeight: 18 },
  aiWarning:    { fontSize: 12, fontFamily: fonts.medium, color: colors.warning, lineHeight: 17 },
  aiCopyBtn:    { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  aiCopyBtnText:{ fontSize: 14, fontFamily: fonts.semibold, color: '#fff' },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  modalSheet: {
    backgroundColor: colors.card, borderRadius: 16, maxHeight: 420, width: '100%', maxWidth: 360,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  modalOption: {
    paddingVertical: 13, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  modalOptionText: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
  capacityCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14 },
  capacityMetric: { flex: 1, alignItems: 'center', gap: 3 },
  capacityNumber: { fontSize: 24, fontFamily: fonts.bold },
  capacityLabel: { fontSize: 12, fontFamily: fonts.medium, color: colors.textSecondary, textAlign: 'center' },
  capacityDivider: { width: 1, height: 38, backgroundColor: colors.border },
  capacityWarning: { fontSize: 12, fontFamily: fonts.medium, color: colors.warning, lineHeight: 17 },

  previewCard:  { backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 10, borderWidth: 1, borderColor: colors.border },
  previewTitle: { fontSize: 13, fontFamily: fonts.bold, color: colors.text },
  tableRow:     { flexDirection: 'row' },
  tableRowAlt:  { backgroundColor: colors.bgDim },
  tableCell:    { width: 120, paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  tableHeaderText: { fontSize: 11, fontFamily: fonts.bold, color: colors.textSecondary, textTransform: 'uppercase' },
  tableCellText:   { fontSize: 11, fontFamily: fonts.body, color: colors.text },
  rowCount: { fontSize: 11, fontFamily: fonts.medium, color: colors.textTertiary, textAlign: 'right' },

  importBtn: {
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center',
  },
  importBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  importBtnText:  { fontSize: 15, fontFamily: fonts.semibold, color: '#fff' },

  resultCard:  { backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 12, borderWidth: 1, borderColor: colors.border },
  resultTitle: { fontSize: 16, fontFamily: fonts.bold, color: colors.success },
  resultRows:  { gap: 8 },
  resultRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, padding: 12 },
  resultNum:   { fontSize: 24, fontFamily: fonts.display, lineHeight: 28 },
  resultLabel: { fontSize: 13, fontFamily: fonts.medium, flex: 1 },
  errList:     { maxHeight: 120, backgroundColor: colors.bgDim, borderRadius: 8, padding: 8 },
  errItem:     { fontSize: 11, fontFamily: fonts.body, color: colors.danger, lineHeight: 18 },
  })
}
