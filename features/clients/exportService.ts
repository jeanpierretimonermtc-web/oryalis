import { Platform, Share } from 'react-native'
import ExcelJS from 'exceljs/dist/exceljs.min.js'
import { supabase } from '@/shared/lib/supabase'

function csvCell(value: unknown) { return `"${String(value ?? '').replace(/"/g, '""')}"` }

// Décision #7 de la refonte : les données de santé ne doivent jamais figurer dans un
// export rapide. L'export complet (exportAllData / exportAllDataXlsx, sauvegarde
// explicite de toutes les données) n'est pas concerné par cette exclusion.
const SENSITIVE_CLIENT_COLUMNS = ['medical_notes', 'medical_treatment', 'particularities']

export async function exportAllClients(userId: string) {
  const { data, error } = await supabase.from('clients').select('*').eq('user_id', userId).order('full_name')
  if (error) throw error
  const rows = data ?? []
  const headers = (rows.length ? Object.keys(rows[0]) : ['full_name', 'email', 'phone'])
    .filter(key => !SENSITIVE_CLIENT_COLUMNS.includes(key))
  const csv = [headers.map(csvCell).join(','), ...rows.map(row => headers.map(key => csvCell((row as any)[key])).join(','))].join('\n')
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `oryalis-contacts-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url)
  } else {
    await Share.share({ title: 'Export Oryalis', message: csv })
  }
  return rows.length
}

const EXPORT_TABLES = ['clients', 'notes', 'appointments', 'followups', 'recommendations', 'orders', 'interactions'] as const

const EXPORT_SHEET_NAMES: Record<typeof EXPORT_TABLES[number], string> = {
  clients: 'Clients',
  notes: 'Notes',
  appointments: 'Rendez-vous',
  followups: 'Relances',
  recommendations: 'Recommandations',
  orders: 'Commandes',
  interactions: 'Interactions',
}

// Palette de marque Oryalis (cyan · bleu · violet), utilisée pour les en-têtes
// et onglets afin que l'export ait le même univers visuel que l'app.
const BRAND_COLORS = ['FF2563EB', 'FF0E7490', 'FF6D3BFF'] as const
const ZEBRA_FILL = 'FFF1F5F9'

async function fetchExportData(userId: string): Promise<{ data: Record<string, Record<string, unknown>[]>; total: number }> {
  const data: Record<string, Record<string, unknown>[]> = {}
  let total = 0
  for (const table of EXPORT_TABLES) {
    const { data: rows, error } = await supabase.from(table).select('*').eq('user_id', userId)
    if (error) throw error
    data[table] = rows ?? []
    total += data[table].length
  }
  return { data, total }
}

// Rend chaque cellule compatible avec une feuille de calcul (les tableaux/objets
// ne s'affichent pas correctement tels quels dans Excel/Google Sheets).
function flattenForSheet(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(row => {
    const flat: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (Array.isArray(value)) flat[key] = value.join(', ')
      else if (value !== null && typeof value === 'object') flat[key] = JSON.stringify(value)
      else flat[key] = value
    }
    return flat
  })
}

/**
 * Exports every table owned by the user (contacts, notes, appointments, followups,
 * recommendations, orders, interactions) as a single portable JSON file.
 * Format "technique" — utile pour une sauvegarde brute ou une réimportation future.
 */
export async function exportAllData(userId: string): Promise<number> {
  const { data, total } = await fetchExportData(userId)
  const json = JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2)
  const filename = `oryalis-export-${new Date().toISOString().slice(0, 10)}.json`
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url)
  } else {
    await Share.share({ title: 'Export Oryalis', message: json })
  }
  return total
}

function isDateTimeKey(key: string) { return key.endsWith('_at') }
function isDateOnlyKey(key: string) { return key.endsWith('_date') }

function toExcelValue(key: string, value: unknown): unknown {
  if (value == null || value === '') return null
  if ((isDateTimeKey(key) || isDateOnlyKey(key)) && typeof value === 'string') {
    const d = new Date(value)
    if (!isNaN(d.getTime())) return d
  }
  if (key === 'email' && typeof value === 'string') return { text: value, hyperlink: `mailto:${value}` }
  if (key === 'phone' && typeof value === 'string') return { text: value, hyperlink: `tel:${value.replace(/\s+/g, '')}` }
  return value
}

function columnWidth(header: string, rows: Record<string, unknown>[], key: string): number {
  const longest = rows.reduce((max, r) => {
    const v = r[key]
    const len = v == null ? 0 : String(v).length
    return Math.max(max, len)
  }, header.length)
  return Math.min(40, Math.max(10, longest + 2))
}

function buildWorkbook(data: Record<string, Record<string, unknown>[]>, total: number): any {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Oryalis'
  workbook.created = new Date()

  // ── Feuille de résumé ──────────────────────────────────────────────────
  const summary = workbook.addWorksheet('Résumé', { properties: { tabColor: { argb: BRAND_COLORS[0] } } })
  summary.columns = [
    { header: 'Catégorie', key: 'label', width: 28 },
    { header: 'Nombre d\'enregistrements', key: 'count', width: 26 },
  ]
  const summaryHeader = summary.getRow(1)
  summaryHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  summaryHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS[0] } }
  summary.addRow({ label: 'Export généré le', count: new Date().toLocaleString('fr-FR') })
  for (const table of EXPORT_TABLES) {
    summary.addRow({ label: EXPORT_SHEET_NAMES[table], count: data[table].length })
  }
  summary.addRow({ label: 'Total', count: total })
  summary.getRow(summary.rowCount).font = { bold: true }

  // ── Une feuille par table ──────────────────────────────────────────────
  EXPORT_TABLES.forEach((table, tableIndex) => {
    const rawRows = data[table]
    const sheet = workbook.addWorksheet(EXPORT_SHEET_NAMES[table], {
      properties: { tabColor: { argb: BRAND_COLORS[tableIndex % BRAND_COLORS.length] } },
      views: [{ state: 'frozen', ySplit: 1 }],
    })

    if (rawRows.length === 0) {
      sheet.columns = [{ header: 'Info', key: 'info', width: 40 }]
      sheet.addRow({ info: 'Aucune donnée pour cette catégorie.' })
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS[tableIndex % BRAND_COLORS.length] } }
      return
    }

    const flatRows = flattenForSheet(rawRows)
    const keys = Object.keys(flatRows[0])
    sheet.columns = keys.map(key => ({
      header: key,
      key,
      width: columnWidth(key, flatRows, key),
    }))

    for (const row of flatRows) {
      const excelRow: Record<string, unknown> = {}
      for (const key of keys) excelRow[key] = toExcelValue(key, row[key])
      sheet.addRow(excelRow)
    }

    for (const key of keys) {
      if (isDateTimeKey(key)) sheet.getColumn(key).numFmt = 'dd/mm/yyyy hh:mm'
      else if (isDateOnlyKey(key)) sheet.getColumn(key).numFmt = 'dd/mm/yyyy'
    }

    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLORS[tableIndex % BRAND_COLORS.length] } }
    headerRow.alignment = { vertical: 'middle' }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: keys.length } }

    for (let i = 2; i <= sheet.rowCount; i++) {
      if (i % 2 === 0) {
        sheet.getRow(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_FILL } }
      }
    }
  })

  return workbook
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i], b2 = bytes[i + 1], b3 = bytes[i + 2]
    const triplet = (b1 << 16) | ((b2 ?? 0) << 8) | (b3 ?? 0)
    result += chars[(triplet >> 18) & 0x3f]
    result += chars[(triplet >> 12) & 0x3f]
    result += b2 !== undefined ? chars[(triplet >> 6) & 0x3f] : '='
    result += b3 !== undefined ? chars[triplet & 0x3f] : '='
  }
  return result
}

/**
 * Exports every table owned by the user as a single richly formatted .xlsx workbook
 * (couleurs de marque, en-têtes figés, filtres, liens email/téléphone, dates natives) —
 * ouvrable directement dans Excel ou Google Sheets, sans étape technique.
 */
export async function exportAllDataXlsx(userId: string): Promise<number> {
  const { data, total } = await fetchExportData(userId)
  const workbook = buildWorkbook(data, total)
  const filename = `oryalis-export-${new Date().toISOString().slice(0, 10)}.xlsx`
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

  const buffer = await workbook.xlsx.writeBuffer()
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)

  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url)
  } else {
    const [{ File, Paths }, Sharing] = await Promise.all([
      import('expo-file-system'),
      import('expo-sharing'),
    ])
    const base64 = uint8ToBase64(bytes)
    const file = new File(Paths.cache, filename)
    if (!file.exists) file.create()
    file.write(base64, { encoding: 'base64' })
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: 'Export Oryalis', UTI: 'com.microsoft.excel.xlsx' })
    }
  }
  return total
}
