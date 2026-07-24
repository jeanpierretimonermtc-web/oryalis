import { supabase } from '@/shared/lib/supabase'

export const FREE_CONTACT_LIMIT = 20
export const CONTACT_QUOTA_ERROR = 'CONTACT_QUOTA_REACHED'

export interface ContactQuota {
  plan: string
  activeCount: number
  limit: number | null
  remaining: number | null
  isPaid: boolean
  reached: boolean
}

export async function getContactQuota(userId: string): Promise<ContactQuota> {
  const { data, error } = await supabase.rpc('get_contact_quota')

  if (!error && data?.[0]) {
    const row = data[0]
    return {
      plan: row.plan ?? 'free',
      activeCount: Number(row.active_count ?? 0),
      limit: row.contact_limit == null ? null : Number(row.contact_limit),
      remaining: row.remaining == null ? null : Number(row.remaining),
      isPaid: row.contact_limit == null,
      reached: row.contact_limit != null && Number(row.remaining) <= 0,
    }
  }

  // Compatibility fallback before the migration is deployed.
  const [{ data: profile }, { count, error: countError }] = await Promise.all([
    supabase.from('profiles').select('plan').eq('id', userId).single(),
    supabase.from('clients').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ])
  if (countError) throw countError
  const plan = profile?.plan ?? 'free'
  const isPaid = ['pro', 'cabinet', 'advisor', 'leader', 'enterprise'].includes(plan)
  const activeCount = count ?? 0
  return {
    plan,
    activeCount,
    limit: isPaid ? null : FREE_CONTACT_LIMIT,
    remaining: isPaid ? null : Math.max(FREE_CONTACT_LIMIT - activeCount, 0),
    isPaid,
    reached: !isPaid && activeCount >= FREE_CONTACT_LIMIT,
  }
}

export function isContactQuotaError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(CONTACT_QUOTA_ERROR)
}

