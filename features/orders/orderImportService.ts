import { supabase } from '@/shared/lib/supabase'
import { createClient, buildMinimalClientInput } from '@/features/clients/clientService'
import { createOrder } from './orderService'

// ORDER-IMPORT-1 — import d'un historique de commandes depuis un export CSV du back-office
// d'une marque. Aucune relance automatique n'est créée (historique, pas une nouvelle vente).

export type ImportField = 'date' | 'name' | 'email' | 'phone' | 'amount' | 'product' | 'order_number'
export const IMPORT_FIELDS: ImportField[] = ['date', 'name', 'email', 'phone', 'amount', 'product', 'order_number']

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

export type ColumnMapping = Partial<Record<ImportField, number>>

// ── Lecture CSV (séparateur ; , ou tabulation, guillemets "" gérés) ─────────────────────────────

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, '')
  const firstLine = clean.split(/\r?\n/)[0] ?? ''
  const separator = [';', '\t', ','].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0]
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === separator) {
      record.push(field.trim()); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++
      record.push(field.trim()); field = ''
      if (record.some(v => v !== '')) records.push(record)
      record = []
    } else {
      field += ch
    }
  }
  record.push(field.trim())
  if (record.some(v => v !== '')) records.push(record)
  const [headers = [], ...rows] = records
  return { headers, rows }
}

const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const FIELD_HINTS: Record<ImportField, string[]> = {
  date: ['date', 'order date', 'date commande', 'date de commande', 'created'],
  name: ['nom', 'name', 'client', 'customer', 'nom client', 'nom complet', 'full name', 'membre', 'member'],
  email: ['email', 'e mail', 'mail', 'courriel'],
  phone: ['telephone', 'tel', 'phone', 'mobile', 'portable'],
  amount: ['montant', 'total', 'amount', 'prix', 'price', 'ttc', 'montant ttc'],
  product: ['produit', 'product', 'article', 'articles', 'designation', 'description', 'items'],
  order_number: ['numero', 'n commande', 'commande', 'order', 'order number', 'order id', 'reference', 'ref'],
}

// Devine la colonne de chaque champ d'après les en-têtes (modifiable ensuite par l'utilisateur).
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const used = new Set<number>()
  const normalized = headers.map(normalize)
  for (const field of IMPORT_FIELDS) {
    const hints = FIELD_HINTS[field]
    let index = normalized.findIndex((h, i) => !used.has(i) && hints.includes(h))
    if (index < 0) index = normalized.findIndex((h, i) => !used.has(i) && hints.some(hint => h.includes(hint)))
    if (index >= 0) { mapping[field] = index; used.add(index) }
  }
  return mapping
}

// "02/11/2026", "2/11/26", "2026-11-02", "02.11.2026" → "2026-11-02" (jour avant mois, usage FR).
export function parseImportDate(raw: string): string | null {
  const v = raw.trim()
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/)
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return null
}

// "1 234,56 €", "1,234.56", "89.90" → nombre.
export function parseImportAmount(raw: string): number | null {
  let v = raw.replace(/[^\d,.\-]/g, '')
  if (!v) return null
  if (v.includes(',') && v.includes('.')) v = v.lastIndexOf(',') > v.lastIndexOf('.') ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '')
  else if (v.includes(',')) v = v.replace(',', '.')
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

// ── Préparation : correspondance contacts + doublons ───────────────────────────────────────────

export type ImportRowStatus = 'matched' | 'new_contact' | 'duplicate' | 'invalid'

export interface PreparedRow {
  index: number
  date: string | null
  name: string
  email: string | null
  phone: string | null
  amount: number | null
  product: string
  orderNumber: string | null
  clientId: string | null
  clientName: string | null
  status: ImportRowStatus
  problem?: 'no_date' | 'no_contact_info'
}

type ClientLite = { id: string; full_name: string; email: string | null; phone: string | null }
type OrderLite = { client_id: string; order_date: string | null; amount: number | null; order_number: string | null }

const phoneKey = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '').slice(-9)
const nameKey = (n: string) => normalize(n).split(' ').filter(Boolean).sort().join(' ')

export async function prepareImport(userId: string, csv: ParsedCsv, mapping: ColumnMapping, defaultProduct: string): Promise<PreparedRow[]> {
  const [clientsRes, ordersRes] = await Promise.all([
    supabase.from('clients').select('id, full_name, email, phone').eq('user_id', userId).is('archived_at', null),
    supabase.from('orders').select('client_id, order_date, amount, order_number').eq('user_id', userId),
  ])
  if (clientsRes.error) throw clientsRes.error
  if (ordersRes.error) throw ordersRes.error
  const clients = (clientsRes.data ?? []) as ClientLite[]
  const orders = (ordersRes.data ?? []) as OrderLite[]

  const byEmail = new Map(clients.filter(c => c.email).map(c => [c.email!.trim().toLowerCase(), c]))
  const byPhone = new Map(clients.filter(c => phoneKey(c.phone).length === 9).map(c => [phoneKey(c.phone), c]))
  const byName = new Map(clients.map(c => [nameKey(c.full_name), c]))
  const orderKeys = new Set(orders.flatMap(o => [
    o.order_number ? `num:${o.client_id}:${o.order_number.trim().toLowerCase()}` : null,
    `day:${o.client_id}:${(o.order_date ?? '').slice(0, 10)}:${o.amount ?? ''}`,
  ].filter((k): k is string => !!k)))
  const seenInFile = new Set<string>()

  const cell = (row: string[], field: ImportField) => {
    const i = mapping[field]
    return i == null ? '' : (row[i] ?? '').trim()
  }

  return csv.rows.map((row, index) => {
    const date = parseImportDate(cell(row, 'date'))
    const name = cell(row, 'name')
    const email = cell(row, 'email').toLowerCase() || null
    const phone = cell(row, 'phone') || null
    const amount = parseImportAmount(cell(row, 'amount'))
    const product = cell(row, 'product') || defaultProduct
    const orderNumber = cell(row, 'order_number') || null
    const base = { index, date, name, email, phone, amount, product, orderNumber }

    if (!date) return { ...base, clientId: null, clientName: null, status: 'invalid' as const, problem: 'no_date' as const }
    const match = (email && byEmail.get(email)) || (phoneKey(phone).length === 9 && byPhone.get(phoneKey(phone))) || (name && byName.get(nameKey(name))) || null
    if (!match && !name) return { ...base, clientId: null, clientName: null, status: 'invalid' as const, problem: 'no_contact_info' as const }

    const clientKey = match?.id ?? `new:${nameKey(name)}`
    const keys = [
      orderNumber ? `num:${clientKey}:${orderNumber.toLowerCase()}` : null,
      `day:${clientKey}:${date}:${amount ?? ''}`,
    ].filter((k): k is string => !!k)
    const duplicate = keys.some(k => orderKeys.has(k) || seenInFile.has(k))
    keys.forEach(k => seenInFile.add(k))
    return {
      ...base,
      clientId: match?.id ?? null,
      clientName: match?.full_name ?? name,
      status: duplicate ? 'duplicate' as const : match ? 'matched' as const : 'new_contact' as const,
    }
  })
}

// ── Import ─────────────────────────────────────────────────────────────────────────────────────

export interface ImportResult {
  imported: number
  createdContacts: number
  skipped: number
  failed: number
}

export async function runImport(
  userId: string,
  rows: PreparedRow[],
  createMissingContacts: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, createdContacts: 0, skipped: 0, failed: 0 }
  const createdByName = new Map<string, string>()
  const todo = rows.filter(r => r.status === 'matched' || (r.status === 'new_contact' && createMissingContacts))
  result.skipped = rows.length - todo.length
  for (let i = 0; i < todo.length; i++) {
    const row = todo[i]
    try {
      let clientId = row.clientId
      if (!clientId) {
        const key = nameKey(row.name)
        clientId = createdByName.get(key) ?? null
        if (!clientId) {
          const created = await createClient(userId, buildMinimalClientInput(row.name, row.email, row.phone, 'customer'))
          clientId = created.id
          createdByName.set(key, clientId)
          result.createdContacts++
        }
      }
      await createOrder(userId, {
        client_id: clientId,
        product_name: row.product,
        amount: row.amount,
        order_date: row.date!,
        order_number: row.orderNumber,
        order_type: 'customer',
        notes: null,
      })
      result.imported++
    } catch (e) {
      console.error('[orderImport.row]', row.index, e)
      result.failed++
    }
    onProgress?.(i + 1, todo.length)
  }
  return result
}
