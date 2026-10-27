import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { supabase } from '@/shared/lib/supabase'
import { updateProfile } from '@/features/settings/profileService'

export interface ProfileData {
  full_name: string; specialty: string; bio: string
  phone: string; website: string; linkedin_url: string
  company: string; city: string; locale: string; timezone: string
  avatar_url: string
}

const DEFAULTS: ProfileData = {
  full_name: '', specialty: '', bio: '', phone: '',
  website: '', linkedin_url: '', company: '', city: '',
  locale: 'fr', timezone: 'Europe/Paris', avatar_url: '',
}

export function useProfileData() {
  const { session } = useAuth()
  const [data, setData]     = useState<ProfileData>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  useEffect(() => {
    if (!session?.user.id) return
    ;(async () => {
      try {
        const { data: row } = await supabase.from('profiles')
          .select('full_name,specialty,bio,phone,website,linkedin_url,company,city,locale,timezone,avatar_url')
          .eq('id', session.user.id).single()
        if (row) setData({
          ...DEFAULTS,
          full_name:    row.full_name    ?? '',
          specialty:    row.specialty    ?? '',
          bio:          row.bio          ?? '',
          phone:        row.phone        ?? '',
          website:      row.website      ?? '',
          linkedin_url: row.linkedin_url ?? '',
          company:      row.company      ?? '',
          city:         row.city         ?? '',
          locale:       row.locale       ?? 'fr',
          timezone:     row.timezone     ?? 'Europe/Paris',
          avatar_url:   row.avatar_url   ?? '',
        })
      } finally { setLoading(false) }
    })()
  }, [session?.user.id])

  const update = useCallback((patch: Partial<ProfileData>) => {
    setData(prev => ({ ...prev, ...patch }))
  }, [])

  const save = useCallback(async (patch: Partial<ProfileData>) => {
    if (!session?.user.id) return false
    setSaving(true); setSaved(false)
    try {
      await updateProfile(session.user.id, patch)
      setData(prev => ({ ...prev, ...patch }))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      return true
    } catch (e) { console.error(e); return false }
    finally { setSaving(false) }
  }, [session?.user.id])

  return { data, update, save, loading, saving, saved }
}
