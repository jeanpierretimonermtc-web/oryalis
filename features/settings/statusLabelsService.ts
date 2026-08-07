import { supabase } from '@/shared/lib/supabase'
import type { LabelKey, UserStatusLabel, ActivityType } from '@/shared/lib/types'
import { ROLE_PRESETS } from '@/shared/lib/types'

export async function fetchStatusLabels(userId: string): Promise<Record<LabelKey, string>> {
  const { data, error } = await supabase
    .from('user_status_labels')
    .select('status_key, custom_label')
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
  const map: Record<string, string> = {}
  for (const row of data ?? []) {
    map[row.status_key] = row.custom_label
  }
  return map as Record<LabelKey, string>
}

export async function upsertStatusLabel(
  userId: string,
  statusKey: LabelKey,
  customLabel: string
): Promise<void> {
  const { error } = await supabase
    .from('user_status_labels')
    .upsert(
      { user_id: userId, status_key: statusKey, custom_label: customLabel },
      { onConflict: 'user_id,status_key' }
    )
  if (error) throw new Error(error.message)
}

export async function applyPreset(
  userId: string,
  activityType: ActivityType
): Promise<void> {
  const preset = ROLE_PRESETS[activityType]
  if (!preset || Object.keys(preset).length === 0) return
  // Upserts individuels — plus fiables que le batch pour les conflits multi-colonnes
  for (const [statusKey, label] of Object.entries(preset)) {
    const { error } = await supabase
      .from('user_status_labels')
      .upsert(
        { user_id: userId, status_key: statusKey, custom_label: label },
        { onConflict: 'user_id,status_key' }
      )
    if (error) throw new Error(error.message)
  }
}

export async function resetStatusLabels(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_status_labels')
    .delete()
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}
