import { supabase } from '@/shared/lib/supabase'

// NOTIF-DIGEST-1.1 — préférences PAR UTILISATEUR (métadonnées du compte Supabase Auth, aucune
// table ni migration) : réglables depuis le web comme depuis le mobile, appliquées par le
// téléphone (seul à afficher les notifications) à sa prochaine ouverture. Données sans
// sensibilité (horaires de rappel), modifiables uniquement par l'utilisateur lui-même.
export interface NotificationPrefs {
  digestEnabled: boolean
  digestHour: number
  appointmentRemindersEnabled: boolean
  appointmentLeadMinutes: number
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  digestEnabled: true,
  digestHour: 9,
  appointmentRemindersEnabled: true,
  appointmentLeadMinutes: 30,
}

export const DIGEST_HOUR_OPTIONS = [7, 8, 9, 12, 18, 20]
export const APPOINTMENT_LEAD_OPTIONS = [15, 30, 60, 120]

const METADATA_KEY = 'notification_prefs'

// getUser() relit le compte côté serveur (jamais la session en cache) : un réglage enregistré
// depuis le web est donc bien vu par le téléphone dès sa prochaine reprogrammation.
export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return DEFAULT_NOTIFICATION_PREFS
  const stored = data.user.user_metadata?.[METADATA_KEY] as Partial<NotificationPrefs> | undefined
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(stored ?? {}) }
}

export async function saveNotificationPrefs(prefs: NotificationPrefs): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { [METADATA_KEY]: prefs } })
  if (error) throw error
}
