import { supabase } from '@/shared/lib/supabase'

// PRIVACY-1 — sécurité du compte et droits RGPD du praticien (écran Confidentialité & assistance).

export interface LoginDevice {
  id: string
  platform: string | null
  user_agent: string | null
  first_seen_at: string
  last_seen_at: string
  sign_in_count: number
}

export interface AccountDeletionRequest {
  user_id: string
  requested_at: string
  scheduled_for: string
  reason: string | null
  cancelled_at: string | null
  completed_at: string | null
}

export async function changePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

export async function signOutOtherDevices(): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: 'others' })
  if (error) throw error
}

export async function listMyLoginDevices(): Promise<LoginDevice[]> {
  const { data, error } = await supabase.rpc('list_my_login_devices')
  if (error) throw error
  return (data ?? []) as LoginDevice[]
}

export async function getMyDeletionRequest(): Promise<AccountDeletionRequest | null> {
  const { data, error } = await supabase.from('account_deletion_requests').select('*').maybeSingle()
  if (error) throw error
  return data as AccountDeletionRequest | null
}

export async function requestAccountDeletion(reason: string): Promise<AccountDeletionRequest> {
  const { data, error } = await supabase.rpc('request_account_deletion', { p_reason: reason.trim() || null })
  if (error) throw error
  return data as AccountDeletionRequest
}

export async function cancelAccountDeletion(): Promise<void> {
  const { error } = await supabase.rpc('cancel_account_deletion')
  if (error) throw error
}

// "Mozilla/5.0 (iPhone; …) … Safari" → { device: 'iPhone', browser: 'Safari' }
export function describeUserAgent(ua: string | null): { device: string; browser: string | null } {
  const v = ua ?? ''
  const device = /iPhone/.test(v) ? 'iPhone'
    : /iPad/.test(v) ? 'iPad'
    : /Android/.test(v) ? 'Android'
    : /Windows/.test(v) ? 'Windows'
    : /Mac OS X|Macintosh/.test(v) ? 'Mac'
    : /Linux/.test(v) ? 'Linux'
    : '—'
  const browser = /Edg\//.test(v) ? 'Edge'
    : /Firefox\//.test(v) ? 'Firefox'
    : /(Chrome|CriOS)\//.test(v) ? 'Chrome'
    : /Safari\//.test(v) ? 'Safari'
    : null
  return { device, browser }
}
