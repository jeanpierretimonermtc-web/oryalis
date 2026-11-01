import { supabase } from '@/shared/lib/supabase'
import { createClient, buildMinimalClientInput } from '@/features/clients/clientService'

// LEAD-PAGE-1 — page publique de prospect (migration 20261101_lead_forms.sql).

export interface LeadForm {
  id: string
  user_id: string
  // LEAD-PAGE-2 — page d'une marque (null = page générale).
  brand_id: string | null
  slug: string
  title: string
  intro: string | null
  active: boolean
}

export interface LeadSubmission {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  message: string | null
  consent: boolean
  client_id: string | null
  status: 'created' | 'pending'
  created_at: string
  form: { brand_id: string | null } | null
}

export interface PublicLeadForm {
  title: string
  intro: string | null
  advisor_name: string
  brand_name: string | null
}

export const LEAD_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,40}$/

export function slugify(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 41)
}

export class LeadSlugTakenError extends Error {}

export async function fetchMyLeadForms(userId: string): Promise<LeadForm[]> {
  const { data, error } = await supabase.from('lead_forms').select('*').eq('user_id', userId)
  if (error) throw error
  return (data ?? []) as LeadForm[]
}

// Une page générale + une page par marque : mise à jour si elle existe, sinon création.
export async function saveLeadForm(
  userId: string,
  existingId: string | null,
  input: Pick<LeadForm, 'brand_id' | 'slug' | 'title' | 'intro' | 'active'>,
): Promise<LeadForm> {
  const values = {
    slug: input.slug, title: input.title.trim(), intro: input.intro?.trim() || null,
    active: input.active, updated_at: new Date().toISOString(),
  }
  const query = existingId
    ? supabase.from('lead_forms').update(values).eq('id', existingId)
    : supabase.from('lead_forms').insert({ ...values, user_id: userId, brand_id: input.brand_id })
  const { data, error } = await query.select('*').single()
  if (error) {
    if (error.code === '23505') throw new LeadSlugTakenError()
    throw error
  }
  return data as LeadForm
}

export async function fetchLeadSubmissions(userId: string): Promise<LeadSubmission[]> {
  const { data, error } = await supabase
    .from('lead_submissions')
    .select('id, full_name, email, phone, message, consent, client_id, status, created_at, form:lead_forms(brand_id)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  // Jointure many-to-one : PostgREST renvoie un objet, le typage généré suppose un tableau.
  return (data ?? []) as unknown as LeadSubmission[]
}

// Envoi resté "en attente" (ex. quota gratuit atteint au moment de l'envoi) : créer le contact.
export async function createContactFromSubmission(userId: string, submission: LeadSubmission): Promise<string> {
  const client = await createClient(userId, {
    ...buildMinimalClientInput(submission.full_name, submission.email, submission.phone, 'prospect'),
    source: 'Page prospect',
    tracking_consent_at: submission.consent ? submission.created_at : null,
  })
  // Inscription venue de la page d'une marque : même rattachement que lors d'un envoi direct.
  if (submission.form?.brand_id) {
    await supabase.from('client_brands').insert({
      user_id: userId, client_id: client.id, brand_id: submission.form.brand_id, source: 'lead_page', source_at: submission.created_at,
    })
  }
  const { error } = await supabase.from('lead_submissions').update({ client_id: client.id, status: 'created' }).eq('id', submission.id)
  if (error) throw error
  return client.id
}

export async function deleteLeadSubmission(id: string): Promise<void> {
  const { error } = await supabase.from('lead_submissions').delete().eq('id', id)
  if (error) throw error
}

// ── Côté visiteur (sans compte) ──────────────────────────────────────────────────────────────

export async function getPublicLeadForm(slug: string): Promise<PublicLeadForm | null> {
  const { data, error } = await supabase.rpc('get_public_lead_form', { p_slug: slug })
  if (error) throw error
  const rows = (data ?? []) as PublicLeadForm[]
  return rows[0] ?? null
}

export type PublicLeadError = 'invalid' | 'invalid_email' | 'not_found' | 'rate_limit' | 'unknown'

export async function submitPublicLead(slug: string, input: { fullName: string; email: string; phone: string; message: string; consent: boolean }): Promise<void> {
  const { error } = await supabase.rpc('submit_public_lead', {
    p_slug: slug,
    p_full_name: input.fullName,
    p_email: input.email,
    p_phone: input.phone,
    p_message: input.message,
    p_consent: input.consent,
  })
  if (error) {
    const code: PublicLeadError = error.message.includes('LEAD_INVALID_EMAIL') ? 'invalid_email'
      : error.message.includes('LEAD_INVALID') ? 'invalid'
      : error.message.includes('LEAD_FORM_NOT_FOUND') ? 'not_found'
      : error.message.includes('LEAD_RATE_LIMIT') ? 'rate_limit'
      : 'unknown'
    throw new Error(code)
  }
}
