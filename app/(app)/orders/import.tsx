import { useMemo, useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Platform } from 'react-native'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as DocumentPicker from 'expo-document-picker'
import { useTheme } from '@/shared/theme/ThemeProvider'
import type { ThemeColors } from '@/shared/theme/colors'
import { fonts } from '@/shared/theme/fonts'
import { SOFT_CARD_SHADOW } from '@/shared/theme/elevation'
import { formatDate } from '@/shared/lib/dateFormat'
import { useOrderImport } from '@/features/orders/useOrderImport'
import { IMPORT_FIELDS } from '@/features/orders/orderImportService'
import type { ImportField, ImportRowStatus } from '@/features/orders/orderImportService'

const PREVIEW_ROWS = 50

// ORDER-IMPORT-1 — importer un historique de commandes (export CSV du back-office d'une marque).
export default function OrderImportScreen() {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'
  const imp = useOrderImport()
  const [fileName, setFileName] = useState<string | null>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [defaultProduct, setDefaultProduct] = useState('')
  const [createContacts, setCreateContacts] = useState(true)
  const [fileError, setFileError] = useState<string | null>(null)

  const productLabel = defaultProduct.trim() || t('order_import.default_product')

  function load(text: string, name: string | null) {
    setFileError(null)
    setFileName(name)
    if (!imp.loadText(text)) setFileError(t('order_import.error_empty'))
  }

  async function pickFile() {
    setFileError(null)
    try {
      if (Platform.OS === 'web') {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.csv,text/csv,text/plain'
        input.onchange = async (e: Event) => {
          const file = (e.target as HTMLInputElement).files?.[0]
          if (file) load(await file.text(), file.name)
        }
        input.click()
      } else {
        const res = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'text/plain', '*/*'], copyToCacheDirectory: true })
        if (res.canceled) return
        const asset = res.assets[0]
        load(await (await fetch(asset.uri)).text(), asset.name)
      }
    } catch (e) {
      console.error('[orderImport.pick]', e)
      setFileError(t('order_import.error_read'))
    }
  }

  const counts = useMemo(() => {
    const c: Record<ImportRowStatus, number> = { matched: 0, new_contact: 0, duplicate: 0, invalid: 0 }
    for (const r of imp.rows ?? []) c[r.status]++
    return c
  }, [imp.rows])
  const toImport = counts.matched + (createContacts ? counts.new_contact : 0)

  const STATUS_STYLE: Record<ImportRowStatus, { bg: string; fg: string }> = {
    matched: { bg: colors.successLight, fg: colors.success },
    new_contact: { bg: colors.primaryLight, fg: colors.primary },
    duplicate: { bg: colors.bgDim, fg: colors.textSecondary },
    invalid: { bg: colors.dangerLight, fg: colors.danger },
  }

  return (
    <>
      <Stack.Screen options={{ title: t('order_import.title'), headerBackTitle: '' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('order_import.intro')}</Text>

        {/* 1. Fichier */}
        <View style={styles.card}>
          <Text style={styles.step}>1 · {t('order_import.step_file')}</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.primaryBtn} onPress={pickFile} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>📄 {t('order_import.pick_file')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPasteOpen(v => !v)} activeOpacity={0.8}>
              <Text style={styles.secondaryBtnText}>📋 {t('order_import.paste')}</Text>
            </TouchableOpacity>
          </View>
          {pasteOpen ? (
            <View style={{ gap: 8 }}>
              <TextInput
                style={styles.pasteInput}
                value={pasted}
                onChangeText={setPasted}
                multiline
                placeholder={t('order_import.paste_placeholder')}
                placeholderTextColor={colors.textTertiary}
              />
              <TouchableOpacity style={[styles.secondaryBtn, { alignSelf: 'flex-start' }]} onPress={() => load(pasted, null)} activeOpacity={0.8}>
                <Text style={styles.secondaryBtnText}>{t('order_import.use_pasted')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {imp.csv ? (
            <Text style={styles.ok}>✓ {t('order_import.file_loaded', { name: fileName ?? t('order_import.pasted_text'), count: imp.csv.rows.length })}</Text>
          ) : null}
          {fileError ? <Text style={styles.error}>{fileError}</Text> : null}
          <Text style={styles.hint}>{t('order_import.file_hint')}</Text>
        </View>

        {/* 2. Colonnes */}
        {imp.csv ? (
          <View style={styles.card}>
            <Text style={styles.step}>2 · {t('order_import.step_columns')}</Text>
            {IMPORT_FIELDS.map((field: ImportField) => (
              <View key={field} style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>
                  {t(`order_import.field_${field}`)}{field === 'date' ? ' *' : ''}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                  <TouchableOpacity
                    style={[styles.chip, imp.mapping[field] == null && styles.chipActive]}
                    onPress={() => { imp.setMapping(m => ({ ...m, [field]: undefined })); imp.setRows(null) }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipText, imp.mapping[field] == null && styles.chipTextActive]}>—</Text>
                  </TouchableOpacity>
                  {imp.csv!.headers.map((h, i) => {
                    const active = imp.mapping[field] === i
                    return (
                      <TouchableOpacity
                        key={`${h}-${i}`}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => { imp.setMapping(m => ({ ...m, [field]: i })); imp.setRows(null) }}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{h || `#${i + 1}`}</Text>
                      </TouchableOpacity>
                    )
                  })}
                </ScrollView>
              </View>
            ))}
            <Text style={styles.fieldLabel}>{t('order_import.default_product_label')}</Text>
            <TextInput
              style={styles.input}
              value={defaultProduct}
              onChangeText={v => { setDefaultProduct(v); imp.setRows(null) }}
              placeholder={t('order_import.default_product')}
              placeholderTextColor={colors.textTertiary}
            />
            <Text style={styles.hint}>{t('order_import.contact_hint')}</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, (imp.mapping.date == null || imp.busy) && { opacity: 0.5 }]}
              onPress={() => imp.analyze(productLabel)}
              disabled={imp.mapping.date == null || imp.busy}
              activeOpacity={0.85}
            >
              {imp.busy && !imp.rows ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Text style={styles.primaryBtnText}>🔎 {t('order_import.analyze')}</Text>}
            </TouchableOpacity>
          </View>
        ) : null}

        {/* 3. Aperçu */}
        {imp.rows ? (
          <View style={styles.card}>
            <Text style={styles.step}>3 · {t('order_import.step_preview')}</Text>
            <View style={styles.summary}>
              {(['matched', 'new_contact', 'duplicate', 'invalid'] as ImportRowStatus[]).map(s => (
                <View key={s} style={[styles.summaryPill, { backgroundColor: STATUS_STYLE[s].bg }]}>
                  <Text style={[styles.summaryText, { color: STATUS_STYLE[s].fg }]}>{t(`order_import.status_${s}`)} · {counts[s]}</Text>
                </View>
              ))}
            </View>
            {counts.new_contact > 0 ? (
              <TouchableOpacity style={styles.checkRow} onPress={() => setCreateContacts(v => !v)} activeOpacity={0.8}>
                <View style={[styles.checkBox, createContacts && styles.checkBoxOn]}>
                  {createContacts ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
                <Text style={styles.checkText}>{t('order_import.create_contacts', { count: counts.new_contact })}</Text>
              </TouchableOpacity>
            ) : null}
            {imp.rows.slice(0, PREVIEW_ROWS).map(r => (
              <View key={r.index} style={styles.previewRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.previewName} numberOfLines={1}>{r.clientName || r.name || '—'}</Text>
                  <Text style={styles.previewMeta} numberOfLines={1}>
                    {[r.date ? formatDate(r.date, locale) : t('order_import.no_date'), r.amount != null ? `${r.amount.toLocaleString(locale)} €` : null, r.orderNumber ? `#${r.orderNumber}` : null, r.product].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: STATUS_STYLE[r.status].bg }]}>
                  <Text style={[styles.statusText, { color: STATUS_STYLE[r.status].fg }]}>{t(`order_import.status_${r.status}`)}</Text>
                </View>
              </View>
            ))}
            {imp.rows.length > PREVIEW_ROWS ? <Text style={styles.hint}>{t('order_import.more_rows', { count: imp.rows.length - PREVIEW_ROWS })}</Text> : null}
            <TouchableOpacity
              style={[styles.primaryBtn, (toImport === 0 || imp.busy) && { opacity: 0.5 }]}
              onPress={() => imp.start(createContacts)}
              disabled={toImport === 0 || imp.busy}
              activeOpacity={0.85}
            >
              {imp.busy
                ? <Text style={styles.primaryBtnText}>{t('order_import.importing', { progress: imp.progress })}</Text>
                : <Text style={styles.primaryBtnText}>⬆️ {t('order_import.import_btn', { count: toImport })}</Text>}
            </TouchableOpacity>
            <Text style={styles.hint}>{t('order_import.no_followups_hint')}</Text>
          </View>
        ) : null}

        {imp.result ? (
          <View style={[styles.card, { borderColor: colors.success }]}>
            <Text style={styles.step}>✅ {t('order_import.done_title')}</Text>
            <Text style={styles.resultText}>{t('order_import.done_imported', { count: imp.result.imported })}</Text>
            {imp.result.createdContacts > 0 ? <Text style={styles.resultText}>{t('order_import.done_contacts', { count: imp.result.createdContacts })}</Text> : null}
            {imp.result.skipped > 0 ? <Text style={styles.resultText}>{t('order_import.done_skipped', { count: imp.result.skipped })}</Text> : null}
            {imp.result.failed > 0 ? <Text style={styles.error}>{t('order_import.done_failed', { count: imp.result.failed })}</Text> : null}
            <View style={styles.row}>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/(app)/orders' as any)} activeOpacity={0.85}>
                <Text style={styles.primaryBtnText}>{t('order_import.see_orders')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => { imp.reset(); setFileName(null); setPasted('') }} activeOpacity={0.8}>
                <Text style={styles.secondaryBtnText}>{t('order_import.another')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        {imp.error ? <Text style={styles.error}>{t('order_import.error_generic')}</Text> : null}
        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  )
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, gap: 14, maxWidth: 760, alignSelf: 'center', width: '100%' },
    intro: { fontSize: 14, lineHeight: 20, fontFamily: fonts.body, color: colors.textSecondary },
    card: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12, ...SOFT_CARD_SHADOW },
    step: { fontSize: 15, fontFamily: fonts.semibold, color: colors.text },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    primaryBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: colors.primaryAction, alignItems: 'center', justifyContent: 'center' },
    primaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.onPrimary },
    secondaryBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
    secondaryBtnText: { fontSize: 14, fontFamily: fonts.semibold, color: colors.text },
    pasteInput: { minHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontFamily: fonts.body, fontSize: 13, color: colors.text, backgroundColor: colors.bg, textAlignVertical: 'top' },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: fonts.body, fontSize: 14, color: colors.text, backgroundColor: colors.bg },
    ok: { fontSize: 13, fontFamily: fonts.medium, color: colors.success },
    error: { fontSize: 13, fontFamily: fonts.medium, color: colors.danger },
    hint: { fontSize: 12.5, lineHeight: 18, fontFamily: fonts.body, color: colors.textSecondary },
    fieldBlock: { gap: 6 },
    fieldLabel: { fontSize: 12, fontFamily: fonts.semibold, color: colors.textSecondary },
    chips: { gap: 6 },
    chip: { maxWidth: 200, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    chipText: { fontSize: 12.5, fontFamily: fonts.medium, color: colors.textSecondary },
    chipTextActive: { color: colors.primary, fontFamily: fonts.semibold },
    summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    summaryPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
    summaryText: { fontSize: 12.5, fontFamily: fonts.semibold },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    checkBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    checkBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    checkMark: { color: colors.onPrimary, fontFamily: fonts.bold, fontSize: 12 },
    checkText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, color: colors.text },
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    previewName: { fontSize: 13.5, fontFamily: fonts.semibold, color: colors.text },
    previewMeta: { fontSize: 12, fontFamily: fonts.body, color: colors.textSecondary },
    statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
    statusText: { fontSize: 11, fontFamily: fonts.semibold },
    resultText: { fontSize: 14, fontFamily: fonts.medium, color: colors.text },
  })
}
