import { supabase } from '@/shared/lib/supabase'
import type { UserBusinessProfile, ActivityType, ModuleKey } from '@/shared/lib/types'

const DEFAULT_MODULES: ModuleKey[] = ['products', 'renewals_lrp', 'downline', 'goals', 'calendar_sync']

export async function fetchBusinessProfile(userId: string): Promise<UserBusinessProfile | null> {
  const { data, error } = await supabase
    .from('user_business_profiles')
    .select('*')
    .eq('user_id', userId)
    .single()
  if (error?.code === 'PGRST116') return null // not found
  if (error) throw new Error(error.message)
  return data as UserBusinessProfile
}

export async function upsertBusinessProfile(
  userId: string,
  patch: {
    activity_type?: ActivityType
    custom_brand_name?: string | null
    active_modules?: ModuleKey[]
    automation_delays?: Record<string, number>
  }
): Promise<UserBusinessProfile> {
  const { data, error } = await supabase
    .from('user_business_profiles')
    .upsert(
      {
        user_id:       userId,
        activity_type: patch.activity_type ?? 'generic',
        custom_brand_name: patch.custom_brand_name ?? null,
        active_modules: patch.active_modules ?? DEFAULT_MODULES,
        automation_delays: patch.automation_delays ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as UserBusinessProfile
}
