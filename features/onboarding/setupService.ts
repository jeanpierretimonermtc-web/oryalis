import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from '@/shared/lib/supabase'
import { BrandExistsError, createBrand, fetchBrands, updateBrand } from '@/features/brands/brandService'
import { BRAND_ROLE_PRESETS } from '@/features/brands/brandRoleLabels'
import { fetchBusinessProfile, upsertBusinessProfile } from '@/features/settings/businessProfileService'
import { updateProfile } from '@/features/settings/profileService'
import { applyPreset } from '@/features/settings/statusLabelsService'
import type { ActivityType, ModuleKey } from '@/shared/lib/types'

// SETUP-1 — configuration guidée. La progression reste sur l'appareil : onboarding_events
// n'accepte que 3 étapes et sert à la mesure, pas à la reprise.
export const SETUP_TOTAL_STEPS = 5
export const AUTOMATION_MODULES: ModuleKey[] = ['auto_first_order', 'auto_order', 'auto_appointment', 'auto_no_contact']
export const KNOWN_BRANDS = ['doTERRA', 'Zinzino', 'Herbalife']
export type BrandMode = 'one' | 'many' | 'none'

const ACTIVITY_BY_BRAND: Record<string, ActivityType> = { doterra: 'doterra', zinzino: 'zinzino', herbalife: 'herbalife' }
const CATALOG_SLUGS = ['doterra', 'zinzino']

const progressKey = (userId: string) => `oryalis.setupProgress.${userId}`

export interface SetupProgress { step: number; dismissed?: boolean }

export async function getSetupProgress(userId: string): Promise<SetupProgress | null> {
  try {
    const raw = await AsyncStorage.getItem(progressKey(userId))
    return raw ? JSON.parse(raw) as SetupProgress : null
  } catch (e) {
    console.error('[setup.progress]', e)
    return null
  }
}

export async function saveSetupProgress(userId: string, progress: SetupProgress): Promise<void> {
  await AsyncStorage.setItem(progressKey(userId), JSON.stringify(progress))
}

export async function clearSetupProgress(userId: string): Promise<void> {
  await AsyncStorage.removeItem(progressKey(userId))
}

export interface SetupPrefill {
  fullName: string
  locale: string | null
  timezone: string | null
  mode: BrandMode
  brands: string[]
  activeModules: ModuleKey[] | null
}

export async function fetchSetupPrefill(userId: string): Promise<SetupPrefill> {
  const [{ data: profile }, business, brands] = await Promise.all([
    supabase.from('profiles').select('full_name, locale, timezone').eq('id', userId).single(),
    fetchBusinessProfile(userId),
    fetchBrands(),
  ])
  const activity = business?.activity_type ?? 'generic'
  const single = activity === 'custom' ? business?.custom_brand_name?.trim() : KNOWN_BRANDS.find(b => b.toLowerCase() === activity)
  return {
    fullName: profile?.full_name ?? '',
    locale: profile?.locale ?? null,
    timezone: profile?.timezone ?? null,
    mode: activity === 'multi' ? 'many' : single ? 'one' : 'none',
    brands: activity === 'multi' ? brands.map(b => b.name) : single ? [single] : [],
    activeModules: business?.active_modules ?? null,
  }
}

// upsertBusinessProfile remet à zéro tout champ absent : on repart toujours de l'existant.
export async function saveSetupProfile(userId: string, patch: Parameters<typeof upsertBusinessProfile>[1]) {
  const existing = await fetchBusinessProfile(userId)
  return upsertBusinessProfile(userId, { ...existing, ...patch })
}

// Le nom suffit : marque (+ catalogue officiel et libellés), mode, catalogues affichés. Une marque
// déjà présente garde ses libellés.
export async function applyBrandSetup(userId: string, mode: BrandMode, brandNames: string[]): Promise<void> {
  const names = mode === 'none' ? [] : [...new Set(brandNames.map(n => n.trim()).filter(Boolean))]
  const activity: ActivityType = mode === 'none' ? 'generic'
    : mode === 'many' ? 'multi'
    : ACTIVITY_BY_BRAND[names[0]?.toLowerCase()] ?? 'custom'

  await saveSetupProfile(userId, { activity_type: activity, custom_brand_name: activity === 'custom' ? names[0] ?? null : null })
  if (mode === 'one') await applyPreset(userId, activity)

  const { data: catalogs, error } = await supabase.from('catalogs').select('id, slug').eq('type', 'official').in('slug', CATALOG_SLUGS)
  if (error) throw error
  const catalogBySlug = new Map((catalogs ?? []).map(c => [c.slug as string, c.id as string]))

  for (const name of names) {
    const slug = name.toLowerCase()
    try {
      const brand = await createBrand(userId, name, catalogBySlug.get(slug) ?? null)
      if (slug === 'doterra' || slug === 'zinzino') await updateBrand(brand.id, { role_labels: BRAND_ROLE_PRESETS[slug] })
    } catch (e) {
      if (!(e instanceof BrandExistsError)) throw e
    }
  }

  const slugs = names.map(n => n.toLowerCase()).filter(s => catalogBySlug.has(s))
  await updateProfile(userId, { active_catalog_slugs: slugs.length > 0 ? slugs : null })
}
