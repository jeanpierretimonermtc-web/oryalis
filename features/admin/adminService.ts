import { supabase } from '@/shared/lib/supabase'

export type AppRole = 'support' | 'owner'

export interface OwnerUserSummary {
  user_id: string
  email: string
  full_name: string | null
  app_role: AppRole | null
  plan: string
  subscription_provider: string | null
  subscription_status: string | null
  subscription_period_end: string | null
  created_at: string
  last_sign_in_at: string | null
}

export interface AdminAuditEntry {
  id: string
  actor_user_id: string | null
  action: string
  target_user_id: string | null
  target_table: string | null
  target_record_id: string | null
  details: Record<string, unknown>
  created_at: string
}

export interface SecurityNotification {
  id: string
  recipient_user_id: string
  category: 'admin_action' | 'unusual_login' | 'support_access' | 'mfa'
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
  data: Record<string, unknown>
  read_at: string | null
  notified_at: string | null
  created_at: string
}

export interface SupportAccessRequest {
  id: string
  user_id?: string
  user_email?: string
  requested_by: string
  requester_email?: string
  scope: 'account_diagnostics' | 'crm_read'
  reason: string
  requested_duration_minutes: number
  status: 'pending' | 'approved' | 'rejected' | 'revoked'
  effective_status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired'
  requested_at: string
  decision_deadline?: string
  decided_at: string | null
  expires_at: string | null
}

export async function getMyAppRole(): Promise<AppRole | null> {
  const { data, error } = await supabase.rpc('get_my_app_role')
  if (error) throw error
  return data as AppRole | null
}

export async function listOwnerUsers(search?: string, limit = 50, offset = 0) {
  const { data, error } = await supabase.rpc('owner_list_users', {
    p_search: search?.trim() || null,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return (data ?? []) as OwnerUserSummary[]
}

export async function grantManualAdvisorAccess(
  userId: string,
  options: { lifetime?: boolean; durationMonths?: number; reason?: string } = {},
) {
  const lifetime = options.lifetime ?? true
  const { data, error } = await supabase.rpc('owner_set_manual_subscription', {
    p_target_user_id: userId,
    p_lifetime: lifetime,
    p_duration_months: lifetime ? null : (options.durationMonths ?? 1),
    p_reason: options.reason?.trim() || null,
  })
  if (error) throw error
  return data?.[0] ?? null
}

export async function revokeManualAdvisorAccess(userId: string, reason?: string) {
  const { data, error } = await supabase.rpc('owner_revoke_manual_subscription', {
    p_target_user_id: userId,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
  return data?.[0] ?? null
}

export async function extendManualAdvisorAccess(userId: string, durationMonths = 1, reason?: string) {
  const { data, error } = await supabase.rpc('owner_extend_manual_subscription', {
    p_target_user_id: userId,
    p_duration_months: durationMonths,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
  return data?.[0] ?? null
}

export async function setAppRole(userId: string, role: AppRole, reason?: string) {
  const { data, error } = await supabase.rpc('owner_set_app_role', {
    p_target_user_id: userId,
    p_role: role,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
  return data as AppRole
}

export async function removeAppRole(userId: string, reason?: string) {
  const { data, error } = await supabase.rpc('owner_remove_app_role', {
    p_target_user_id: userId,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
  return Boolean(data)
}

export async function listAdminAudit(limit = 100, offset = 0) {
  const { data, error } = await supabase.rpc('owner_list_admin_audit', {
    p_limit: limit,
    p_offset: offset,
  })
  if (error) throw error
  return (data ?? []) as AdminAuditEntry[]
}

export async function listSecurityNotifications(limit = 100) {
  const { data, error } = await supabase.rpc('list_my_security_notifications', { p_limit: limit })
  if (error) throw error
  return (data ?? []) as SecurityNotification[]
}

export async function claimSecurityNotifications(limit = 20) {
  const { data, error } = await supabase.rpc('claim_my_security_notifications', { p_limit: limit })
  if (error) throw error
  return (data ?? []) as SecurityNotification[]
}

export async function markSecurityNotificationsRead(ids?: string[]) {
  const { data, error } = await supabase.rpc('mark_my_security_notifications_read', {
    p_ids: ids?.length ? ids : null,
  })
  if (error) throw error
  return Number(data ?? 0)
}

export async function requestSupportAccess(
  userId: string,
  scope: SupportAccessRequest['scope'],
  reason: string,
  durationMinutes = 30,
) {
  const { data, error } = await supabase.rpc('owner_request_support_access', {
    p_target_user_id: userId,
    p_scope: scope,
    p_reason: reason.trim(),
    p_duration_minutes: durationMinutes,
  })
  if (error) throw error
  return data as SupportAccessRequest
}

export async function listMySupportAccessRequests() {
  const { data, error } = await supabase.rpc('list_my_support_access_requests')
  if (error) throw error
  return (data ?? []) as SupportAccessRequest[]
}

export async function respondToSupportAccessRequest(id: string, approve: boolean) {
  const { data, error } = await supabase.rpc('respond_to_support_access_request', {
    p_request_id: id,
    p_approve: approve,
  })
  if (error) throw error
  return data as SupportAccessRequest
}

export async function revokeMySupportAccess(id: string) {
  const { data, error } = await supabase.rpc('revoke_my_support_access', { p_request_id: id })
  if (error) throw error
  return Boolean(data)
}

export async function listOwnerSupportAccessRequests(limit = 100) {
  const { data, error } = await supabase.rpc('owner_list_support_access_requests', { p_limit: limit })
  if (error) throw error
  return (data ?? []) as SupportAccessRequest[]
}

export async function getSupportSnapshot(id: string) {
  const { data, error } = await supabase.rpc('owner_get_support_snapshot', { p_request_id: id })
  if (error) throw error
  return data as Record<string, unknown>
}
