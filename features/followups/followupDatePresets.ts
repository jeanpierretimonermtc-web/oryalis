// ACTION-OUTCOME-1 / P1.2 §6 — aucun preset de date rapide n'existait déjà dans le projet
// (CalendarPickerModal est un calendrier complet, pas des raccourcis "Demain/7 jours") : ceci
// est la première logique du genre, à réutiliser telle quelle plutôt qu'en recréer une autre.
export type FollowupDatePreset = 'tomorrow' | '3d' | '7d' | '14d' | '30d'

const PRESET_DAYS: Record<FollowupDatePreset, number> = {
  tomorrow: 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30,
}

export const FOLLOWUP_DATE_PRESETS: FollowupDatePreset[] = ['tomorrow', '3d', '7d', '14d', '30d']

export function followupPresetDate(preset: FollowupDatePreset): string {
  const d = new Date()
  d.setDate(d.getDate() + PRESET_DAYS[preset])
  return d.toISOString().split('T')[0]
}

export function followupPresetDays(preset: FollowupDatePreset): number {
  return PRESET_DAYS[preset]
}
