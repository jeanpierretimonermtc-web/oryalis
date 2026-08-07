import { supabase } from '@/shared/lib/supabase'
import type { ClientStatus, ContactRole, PipelineStage } from '@/shared/lib/types'
import { STATUS_KEYS } from '@/shared/lib/types'

// ── CSV Parser ────────────────────────────────────────────────────────────────

export interface ParsedCSV {
  headers: string[]
  rows: string[][]
}

export function parseCSV(text: string): ParsedCSV {
  // Strip BOM if present
  const clean = text.replace(/^﻿/, '')
  const lines = clean.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const nonEmpty = lines.filter(l => l.trim().length > 0)
  if (nonEmpty.length === 0) return { headers: [], rows: [] }

  // Detect delimiter (comma or semicolon)
  const sample = nonEmpty[0]
  const delimiter = (sample.split(';').length > sample.split(',').length) ? ';' : ','

  function parseRow(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseRow(nonEmpty[0]).map(h =>
    h.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove accents
      .replace(/[\s\-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
  )
  const rows = nonEmpty.slice(1).map(parseRow)
  return { headers, rows }
}

// ── Column mapping ────────────────────────────────────────────────────────────

// Maps various CSV header variants to canonical field names
const COLUMN_MAP: Record<string, string> = {
  // Name
  full_name: 'full_name', nom_complet: 'full_name', nom: 'full_name',
  name: 'full_name', prenom_nom: 'full_name',
  first_name: 'first_name', prenom: 'first_name',
  last_name: 'last_name',
  // Contact
  email: 'email', mail: 'email', courriel: 'email',
  phone: 'phone', tel: 'phone', telephone: 'phone', mobile: 'phone',
  // Status
  status: 'status', statut: 'status', etat: 'status',
  // Location
  country: 'country', pays: 'country',
  city: 'city', ville: 'city',
  // Language
  language: 'language', langue: 'language',
  // Notes / interests
  notes: 'notes', note: 'notes',
  interests: 'interests', interets: 'interests', produits: 'interests', products_interest: 'interests',
  // Followup
  next_followup_date: 'next_followup_date', date_relance: 'next_followup_date', prochaine_relance: 'next_followup_date',
  // Role
  contact_role: 'contact_role', role: 'contact_role',
  // Source
  source: 'source',
  // Company
  company: 'company', cabinet: 'company', entreprise: 'company',
}

export function mapHeaders(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {}
  headers.forEach((h, i) => {
    const canonical = COLUMN_MAP[h]
    if (canonical && !(canonical in mapping)) {
      mapping[canonical] = i
    }
  })
  return mapping
}

// Champs pouvant être associés à une colonne du fichier importé, dans l'ordre
// affiché à l'utilisateur dans l'étape de correspondance des colonnes.
export const TARGET_FIELDS: { key: string; labelKey: string }[] = [
  { key: 'full_name',          labelKey: 'settings.import_field_full_name' },
  { key: 'first_name',         labelKey: 'settings.import_field_first_name' },
  { key: 'last_name',          labelKey: 'settings.import_field_last_name' },
  { key: 'email',              labelKey: 'settings.import_field_email' },
  { key: 'phone',              labelKey: 'settings.import_field_phone' },
  { key: 'status',             labelKey: 'settings.import_field_status' },
  { key: 'contact_role',       labelKey: 'settings.import_field_contact_role' },
  { key: 'country',            labelKey: 'settings.import_field_country' },
  { key: 'city',               labelKey: 'settings.import_field_city' },
  { key: 'language',           labelKey: 'settings.import_field_language' },
  { key: 'notes',              labelKey: 'settings.import_field_notes' },
  { key: 'interests',          labelKey: 'settings.import_field_interests' },
  { key: 'next_followup_date', labelKey: 'settings.import_field_next_followup_date' },
  { key: 'source',             labelKey: 'settings.import_field_source' },
  { key: 'company',            labelKey: 'settings.import_field_company' },
]

export function countImportableRows(parsed: ParsedCSV, mapping: Record<string, number>): number {
  const get = (row: string[], field: string): string =>
    mapping[field] !== undefined ? (row[mapping[field]] ?? '').trim() : ''
  return parsed.rows.filter(row => {
    const fullName = get(row, 'full_name')
    const composedName = [get(row, 'first_name'), get(row, 'last_name')].filter(Boolean).join(' ')
    return Boolean(fullName || composedName)
  }).length
}

// ── Import result ─────────────────────────────────────────────────────────────

export interface ImportResult {
  created: number
  skipped: number
  duplicates: number
  errors: number
  errorMessages: string[]
  duplicateMessages: string[]
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

function normalizeName(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, ' ')
}

function normalizeStatus(raw: string): ClientStatus {
  const lower = raw.toLowerCase().trim()
  // Direct match
  if (STATUS_KEYS.includes(lower as ClientStatus)) return lower as ClientStatus
  // French variants
  const variants: Record<string, ClientStatus> = {
    'prospect': 'prospect', 'nouveau': 'new_client', 'new_client': 'new_client',
    'actif': 'active', 'active': 'active', 'fidele': 'loyal', 'loyal': 'loyal',
    'inactif': 'inactive', 'inactive': 'inactive', 'vip': 'vip',
    'conseiller': 'advisor', 'conseillere': 'advisor', 'advisor': 'advisor',
    'perdu': 'lost', 'lost': 'lost',
    'membre': 'team_member', 'team_member': 'team_member',
    'lrp': 'loyal', 'client_recurrent': 'loyal',
  }
  return variants[lower] ?? 'prospect'
}

function normalizeRole(raw: string): ContactRole {
  const lower = raw.toLowerCase().trim()
  const variants: Record<string, ContactRole> = {
    'distributeur': 'distributor', 'distributor': 'distributor',
    'leader': 'leader', 'client': 'customer', 'customer': 'customer',
    'prospect': 'prospect', 'membre': 'team_member', 'team_member': 'team_member',
    'inactif': 'inactive', 'inactive': 'inactive',
  }
  return variants[lower] ?? 'customer'
}

function initialPipelineStage(status: ClientStatus, role: ContactRole): PipelineStage {
  if (role === 'inactive' || status === 'inactive' || status === 'lost') return 'lost'
  if (role === 'distributor' || role === 'leader' || role === 'team_member' || status === 'advisor' || status === 'team_member') return 'distributor'
  if (role === 'customer' || ['new_client', 'active', 'loyal', 'vip'].includes(status)) return 'customer'
  return 'new_lead'
}

// ── Batch import ──────────────────────────────────────────────────────────────

export async function importCSVClients(
  userId: string,
  parsed: ParsedCSV,
  mapping: Record<string, number>,
  onProgress?: (done: number, total: number) => void,
  maxCreates?: number | null,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, skipped: 0, duplicates: 0, errors: 0, errorMessages: [], duplicateMessages: [] }

  const get = (row: string[], field: string): string =>
    mapping[field] !== undefined ? (row[mapping[field]] ?? '').trim() : ''

  // Duplicate detection: match against existing contacts by email, phone or exact name,
  // and against rows already created earlier in this same file.
  const { data: existing } = await supabase
    .from('clients')
    .select('email, phone, full_name')
    .eq('user_id', userId)
  const seenEmails = new Set((existing ?? []).map(c => c.email?.toLowerCase().trim()).filter(Boolean))
  const seenPhones = new Set((existing ?? []).map(c => c.phone ? normalizePhone(c.phone) : '').filter(Boolean))
  const seenNames  = new Set((existing ?? []).map(c => normalizeName(c.full_name ?? '')).filter(Boolean))

  for (let i = 0; i < parsed.rows.length; i++) {
    const row = parsed.rows[i]
    onProgress?.(i, parsed.rows.length)

    // Build full_name from available columns
    let fullName = get(row, 'full_name')
    if (!fullName) {
      const fn = get(row, 'first_name')
      const ln = get(row, 'last_name')
      fullName = [fn, ln].filter(Boolean).join(' ')
    }
    if (!fullName) { result.skipped++; continue }

    if (maxCreates != null && result.created >= maxCreates) {
      result.skipped++
      continue
    }

    const emailRaw = get(row, 'email')
    const phoneRaw = get(row, 'phone')
    const email = emailRaw.toLowerCase().trim()
    const phone = phoneRaw ? normalizePhone(phoneRaw) : ''
    const name  = normalizeName(fullName)
    const isDuplicate = (email && seenEmails.has(email)) || (phone && seenPhones.has(phone)) || seenNames.has(name)
    if (isDuplicate) {
      result.duplicates++
      result.duplicateMessages.push(`Ligne ${i + 2} (${fullName}): contact déjà existant`)
      continue
    }

    const statusRaw   = get(row, 'status')
    const roleRaw     = get(row, 'contact_role')
    const normalizedStatus = statusRaw ? normalizeStatus(statusRaw) : 'prospect'
    // Sans rôle explicite dans le fichier, "advisor"/"conseiller" devient distributeur
    // (pas "prospect") — un conseiller est déjà engagé, jamais un simple prospect.
    const normalizedRole = roleRaw
      ? normalizeRole(roleRaw)
      : normalizedStatus === 'advisor' ? 'distributor' : 'prospect'
    const notesRaw    = get(row, 'notes')
    const followupRaw = get(row, 'next_followup_date')
    const interests   = get(row, 'interests')

    try {
      const { data: client, error: cErr } = await supabase
        .from('clients')
        .insert({
          user_id:      userId,
          full_name:    fullName,
          first_name:   get(row, 'first_name') || null,
          email:        get(row, 'email') || null,
          phone:        get(row, 'phone') || null,
          status:       normalizedStatus,
          contact_role: [normalizedRole],
          pipeline_stage: initialPipelineStage(normalizedStatus, normalizedRole),
          is_vip:            normalizedStatus === 'vip',
          manually_inactive: normalizedStatus === 'inactive',
          country:      get(row, 'country') || null,
          city:         get(row, 'city') || null,
          language:     get(row, 'language') || 'fr',
          source:       get(row, 'source') || 'import',
          company:      get(row, 'company') || null,
          interests:    interests ? interests.split(/[,;|]/).map(s => s.trim()).filter(Boolean) : [],
          inscription_date: new Date().toISOString().split('T')[0],
          welcome_email_sent: false,
          medical_treatment: false,
          referrals_count: 0, referral_count: 0,
        })
        .select('id')
        .single()

      if (cErr || !client) {
        result.errors++
        result.errorMessages.push(`Ligne ${i + 2} (${fullName}): ${cErr?.message ?? 'erreur'}`)
        continue
      }

      if (email) seenEmails.add(email)
      if (phone) seenPhones.add(phone)
      seenNames.add(name)

      // Create note if provided
      if (notesRaw) {
        await supabase.from('notes').insert({
          user_id: userId, client_id: client.id, content: notesRaw,
        })
      }

      // Create followup if date provided
      if (followupRaw) {
        const date = new Date(followupRaw)
        if (!isNaN(date.getTime())) {
          await supabase.from('followups').insert({
            user_id: userId, client_id: client.id,
            title: 'Relance importée',
            due_date: date.toISOString().split('T')[0],
            done: false,
          })
        }
      }

      result.created++
    } catch (e: any) {
      result.errors++
      result.errorMessages.push(`Ligne ${i + 2}: ${e.message}`)
    }
  }

  onProgress?.(parsed.rows.length, parsed.rows.length)
  return result
}
