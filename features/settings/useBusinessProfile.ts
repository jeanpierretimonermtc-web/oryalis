import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { fetchBusinessProfile, upsertBusinessProfile } from './businessProfileService'
import type { UserBusinessProfile, ActivityType, ModuleKey } from '@/shared/lib/types'

const DEFAULT: UserBusinessProfile = {
  id: '',
  user_id: '',
  activity_type: 'generic',
  custom_brand_name: null,
  custom_lrp_name: null,
  active_modules: ['products', 'renewals_lrp', 'downline', 'goals', 'calendar_sync'],
  automation_delays: {},
  created_at: '',
  updated_at: '',
}

export function useBusinessProfile() {
  const { session } = useAuth()
  const [profile, setProfile]   = useState<UserBusinessProfile>(DEFAULT)
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    if (!session) return
    setLoading(true)
    try {
      const data = await fetchBusinessProfile(session.user.id)
      if (data) setProfile(data)
    } catch (e) {
      console.error('[useBusinessProfile]', e)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (
    patch: { activity_type?: ActivityType; custom_brand_name?: string | null; active_modules?: ModuleKey[] }
  ) => {
    if (!session) return
    try {
      const updated = await upsertBusinessProfile(session.user.id, {
        ...profile,
        ...patch,
      })
      setProfile(updated)
    } catch (e) {
      console.error('[useBusinessProfile.save]', e)
    }
  }, [session, profile])

  const isModuleActive = useCallback((key: ModuleKey): boolean => {
    return profile.active_modules.includes(key)
  }, [profile.active_modules])

  const toggleModule = useCallback(async (key: ModuleKey, active: boolean) => {
    const updated = active
      ? [...profile.active_modules.filter(m => m !== key), key]
      : profile.active_modules.filter(m => m !== key)
    await save({ active_modules: updated })
  }, [profile.active_modules, save])

  return { profile, loading, save, isModuleActive, toggleModule, reload: load }
}
