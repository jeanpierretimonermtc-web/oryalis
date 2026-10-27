import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  fetchBusinessProfile, upsertBusinessProfile,
} from './businessProfileService'
import {
  fetchStatusLabels, upsertStatusLabel,
  applyPreset, resetStatusLabels,
} from './statusLabelsService'
import type {
  ClientStatus, ContactRole, LabelKey, ModuleKey, ActivityType, PipelineStage,
  UserBusinessProfile,
} from '@/shared/lib/types'
import { DEFAULT_STATUS_LABELS, DEFAULT_ROLE_LABELS } from '@/shared/lib/types'

// Seules ces 2 étapes du pipeline commercial représentent exactement le même fait métier
// qu'un rôle de Mes libellés (synchronisation bidirectionnelle confirmée par les triggers
// sync_client_role_from_pipeline / sync_client_pipeline_from_role — voir migrations
// 20260804_role_pipeline_consistency.sql et 20260817_pipeline_role_consistency.sql). Les 6
// autres valeurs sont de vraies étapes de parcours sans équivalent dans Mes libellés et
// doivent rester sur leur clé i18n générique — ne jamais étendre cette liste sans revalider
// qu'une nouvelle valeur de pipeline_stage soit réellement synchronisée avec contact_role.
const SHARED_PIPELINE_ROLE_STAGES: ReadonlySet<PipelineStage> = new Set(['customer', 'distributor'])

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
  /** Résolution centralisée du libellé d'une étape pipeline : les 2 étapes partagées avec
   * contact_role (customer/distributor) passent par getRoleLabel (personnalisé), les 6
   * autres restent sur leur clé i18n générique `pipeline_stages.*`. Ne jamais recopier cette
   * condition dans les écrans — toujours passer par cette fonction. */
  getPipelineStageLabel: (stage: PipelineStage) => string
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
  getPipelineStageLabel: (stage) => SHARED_PIPELINE_ROLE_STAGES.has(stage) ? (DEFAULT_ROLE_LABELS[stage as ContactRole] ?? stage) : stage,
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
  const { t } = useTranslation()

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

  const getPipelineStageLabel = useCallback((stage: PipelineStage): string =>
    SHARED_PIPELINE_ROLE_STAGES.has(stage) ? getRoleLabel(stage as ContactRole) : t(`pipeline_stages.${stage}`)
  , [getRoleLabel, t])

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
      isModuleActive, getStatusLabel, getRoleLabel, getPipelineStageLabel, getAutomationDelay, getLrpName,
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
