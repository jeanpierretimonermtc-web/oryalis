import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  fetchBusinessProfile, upsertBusinessProfile,
} from './businessProfileService'
import {
  fetchStatusLabels, upsertStatusLabel,
  applyPreset, resetStatusLabels,
} from './statusLabelsService'
import type {
  ClientStatus, ContactRole, LabelKey, ModuleKey, ActivityType,
  UserBusinessProfile,
} from '@/shared/lib/types'
import { DEFAULT_STATUS_LABELS, DEFAULT_ROLE_LABELS } from '@/shared/lib/types'

// ── Default profile ───────────────────────────────────────────────────────────

const DEFAULT_PROFILE: UserBusinessProfile = {
  id: '', user_id: '',
  activity_type: 'generic',
  custom_brand_name: null,
  custom_lrp_name: null,
  active_modules: ['products', 'renewals_lrp', 'downline', 'goals', 'calendar_sync', 'auto_first_order', 'auto_order', 'auto_appointment', 'auto_no_contact'],
  automation_delays: {},
  created_at: '', updated_at: '',
}

// ── Context shape ─────────────────────────────────────────────────────────────

type AppConfigCtx = {
  // ── State ──────────────────────────────────────────────────────────────────
  profile: UserBusinessProfile
  labels: Partial<Record<LabelKey, string>>
  loading: boolean

  // ── Read ───────────────────────────────────────────────────────────────────
  isModuleActive: (key: ModuleKey) => boolean
  /** @deprecated voir `ClientStatus` — utiliser `getRoleLabel`. */
  getStatusLabel: (key: ClientStatus) => string
  getRoleLabel: (key: ContactRole) => string
  getAutomationDelay: (ruleId: string, fallback: number) => number
  /** Nom affiché du programme de fidélité (ex. "LRP"), personnalisable par l'utilisateur. */
  getLrpName: () => string

  // ── Business profile writes ────────────────────────────────────────────────
  saveActivityType: (type: ActivityType, customBrand?: string | null) => Promise<void>
  toggleModule: (key: ModuleKey, active: boolean) => Promise<void>
  setAutomationDelay: (ruleId: string, days: number) => Promise<void>
  saveLrpName: (name: string | null) => Promise<void>

  // ── Status label writes ────────────────────────────────────────────────────
  saveLabel: (key: LabelKey, value: string) => Promise<void>
  applyActivityPreset: (type: ActivityType) => Promise<void>
  resetLabels: () => Promise<void>

  // ── Reload ─────────────────────────────────────────────────────────────────
  reload: () => Promise<void>
}

const AppConfigContext = createContext<AppConfigCtx>({
  profile:    DEFAULT_PROFILE,
  labels:     {},
  loading:    true,
  isModuleActive:    () => true,
  getStatusLabel:    (k) => DEFAULT_STATUS_LABELS[k] ?? k,
  getRoleLabel:      (k) => DEFAULT_ROLE_LABELS[k] ?? k,
  getAutomationDelay: (_ruleId, fallback) => fallback,
  getLrpName:        () => 'LRP',
  saveActivityType:  async () => {},
  toggleModule:      async () => {},
  setAutomationDelay: async () => {},
  saveLrpName:       async () => {},
  saveLabel:         async () => {},
  applyActivityPreset: async () => {},
  resetLabels:       async () => {},
  reload:            async () => {},
})

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppConfigProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user?.id

  const [profile, setProfile] = useState<UserBusinessProfile>(DEFAULT_PROFILE)
  const [labels,  setLabels]  = useState<Partial<Record<LabelKey, string>>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [p, l] = await Promise.all([
        fetchBusinessProfile(userId),
        fetchStatusLabels(userId),
      ])
      if (p) setProfile(p)
      setLabels(l)
    } catch (e) {
      console.error('[AppConfigProvider.load]', e)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { load() }, [load])

  // ── Read helpers ─────────────────────────────────────────────────────────────

  const isModuleActive = useCallback((key: ModuleKey): boolean =>
    profile.active_modules.includes(key)
  , [profile.active_modules])

  const getStatusLabel = useCallback((key: ClientStatus): string =>
    labels[key] ?? DEFAULT_STATUS_LABELS[key] ?? key
  , [labels])

  const getRoleLabel = useCallback((key: ContactRole): string =>
    labels[key] ?? DEFAULT_ROLE_LABELS[key] ?? key
  , [labels])

  const getAutomationDelay = useCallback((ruleId: string, fallback: number): number =>
    profile.automation_delays[ruleId] ?? fallback
  , [profile.automation_delays])

  const getLrpName = useCallback((): string =>
    profile.custom_lrp_name?.trim() || 'LRP'
  , [profile.custom_lrp_name])

  // ── Business profile writes ──────────────────────────────────────────────────

  const saveActivityType = useCallback(async (
    type: ActivityType,
    customBrand?: string | null
  ) => {
    if (!userId) return
    try {
      const updated = await upsertBusinessProfile(userId, {
        ...profile,
        activity_type:     type,
        custom_brand_name: customBrand ?? profile.custom_brand_name,
      })
      setProfile(updated)
    } catch (e) { console.error('[saveActivityType]', e) }
  }, [userId, profile])

  const saveLrpName = useCallback(async (name: string | null) => {
    if (!userId) return
    try {
      const updated = await upsertBusinessProfile(userId, {
        ...profile,
        custom_lrp_name: name?.trim() || null,
      })
      setProfile(updated)
    } catch (e) { console.error('[saveLrpName]', e) }
  }, [userId, profile])

  const toggleModule = useCallback(async (key: ModuleKey, active: boolean) => {
    if (!userId) return
    try {
      const newModules = active
        ? [...profile.active_modules.filter(m => m !== key), key]
        : profile.active_modules.filter(m => m !== key)
      const updated = await upsertBusinessProfile(userId, {
        ...profile,
        active_modules: newModules,
      })
      setProfile(updated)
    } catch (e) { console.error('[toggleModule]', e) }
  }, [userId, profile])

  const setAutomationDelay = useCallback(async (ruleId: string, days: number) => {
    if (!userId) return
    try {
      const updated = await upsertBusinessProfile(userId, {
        ...profile,
        automation_delays: { ...profile.automation_delays, [ruleId]: days },
      })
      setProfile(updated)
    } catch (e) { console.error('[setAutomationDelay]', e) }
  }, [userId, profile])

  // ── Status label writes ──────────────────────────────────────────────────────

  const saveLabel = useCallback(async (key: LabelKey, value: string) => {
    if (!userId) return
    try {
      await upsertStatusLabel(userId, key, value)
      setLabels(prev => ({ ...prev, [key]: value.trim() }))
    } catch (e) { console.error('[saveLabel]', e) }
  }, [userId])

  const applyActivityPreset = useCallback(async (type: ActivityType) => {
    if (!userId) return
    try {
      await applyPreset(userId, type)
      const updated = await fetchStatusLabels(userId)
      // Nouvelle référence objet garantie → React détecte le changement
      setLabels({ ...updated })
    } catch (e) { console.error('[applyActivityPreset]', e) }
  }, [userId])

  const resetLabels = useCallback(async () => {
    if (!userId) return
    try {
      await resetStatusLabels(userId)
      setLabels({})
    } catch (e) { console.error('[resetLabels]', e) }
  }, [userId])

  return (
    <AppConfigContext.Provider value={{
      profile, labels, loading,
      isModuleActive, getStatusLabel, getRoleLabel, getAutomationDelay, getLrpName,
      saveActivityType, toggleModule, setAutomationDelay, saveLrpName,
      saveLabel, applyActivityPreset, resetLabels,
      reload: load,
    }}>
      {children}
    </AppConfigContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAppConfig() {
  return useContext(AppConfigContext)
}
