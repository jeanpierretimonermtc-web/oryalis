import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import i18n from '@/shared/i18n'
import { supabase } from '@/shared/lib/supabase'
import { getClients } from '@/features/clients/clientService'
import { getPendingFollowups } from '@/features/followups/followupService'
import { fetchActiveAppointmentsByUser } from '@/features/appointments/appointmentService'
import { getActiveInteractionsByUser } from '@/features/interactions/interactionService'
import { isInUrgencyWindow } from '@/features/clients/actionWindows'
import type { NotificationPrefs } from './notificationPrefs'

// ── Foreground handler ────────────────────────────────────────────────────────

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  false,
    shouldSetBadge:   true,
  }),
})

// ── Permissions ───────────────────────────────────────────────────────────────

export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false
  if (!Device.isDevice)     return false  // simulateur ne supporte pas les notifs

  const { status } = await Notifications.getPermissionsAsync()
  if (status === 'granted') return true

  const { status: asked } = await Notifications.requestPermissionsAsync()
  return asked === 'granted'
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false
  const { status } = await Notifications.getPermissionsAsync()
  return status === 'granted'
}

// ── Résumé quotidien + rappels de RDV (NOTIF-DIGEST-1) ───────────────────────
// Notifications LOCALES, entièrement reprogrammées à chaque appel (ouverture de l'app, retour au
// premier plan, enregistrement des réglages) : le nombre d'actions annoncé est donc celui connu
// au dernier passage, et un jour sans action ne reçoit jamais de notification. Confidentialité :
// aucun nom de contact ni titre de RDV (souvent "RDV Pierre") dans le contenu.

const LEGACY_DAILY_ID = 'oryalis-daily-relances'
const DIGEST_PREFIX = 'oryalis-digest-'
const APPOINTMENT_PREFIX = 'oryalis-rdv-'
const DIGEST_DAYS = 7
const APPOINTMENT_REMINDER_HORIZON_DAYS = 7
// iOS plafonne à 64 notifications locales programmées : 7 résumés + 40 rappels laissent de la marge.
const MAX_APPOINTMENT_REMINDERS = 40

async function cancelOryalisScheduled(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync()
  await Promise.all(scheduled
    .filter(n => n.identifier === LEGACY_DAILY_ID || n.identifier.startsWith(DIGEST_PREFIX) || n.identifier.startsWith(APPOINTMENT_PREFIX))
    .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})))
}

// Mêmes sources que le dashboard et la liste Contacts (actions en attente rattachées à un contact
// non archivé), jamais un second calcul.
async function loadPendingActionDates(userId: string): Promise<string[]> {
  const [clients, followups, appointments, interactions] = await Promise.all([
    getClients(userId),
    getPendingFollowups(userId),
    fetchActiveAppointmentsByUser(userId),
    getActiveInteractionsByUser(userId),
  ])
  const activeIds = new Set(clients.map(c => c.id))
  const dates: string[] = []
  for (const f of followups as { client_id: string | null; due_date: string }[]) if (f.client_id && activeIds.has(f.client_id)) dates.push(f.due_date)
  for (const a of appointments) if (a.client_id && activeIds.has(a.client_id)) dates.push(a.start_at)
  for (const i of interactions) if (i.client_id && activeIds.has(i.client_id)) dates.push(i.scheduled_at)
  return dates
}

async function loadUpcomingAppointments(userId: string): Promise<{ id: string; start_at: string }[]> {
  const now = new Date()
  const until = new Date(now.getTime() + APPOINTMENT_REMINDER_HORIZON_DAYS * 86400000)
  const { data, error } = await supabase
    .from('appointments')
    .select('id, start_at')
    .eq('user_id', userId)
    .eq('provider', 'oryalis')
    .in('status', ['scheduled', 'rescheduled'])
    .gt('start_at', now.toISOString())
    .lte('start_at', until.toISOString())
    .order('start_at')
    .limit(MAX_APPOINTMENT_REMINDERS)
  if (error) throw error
  return data ?? []
}

function dateTrigger(date: Date): Notifications.NotificationTriggerInput {
  return { type: Notifications.SchedulableTriggerInputTypes.DATE, date }
}

export async function rescheduleNotifications(userId: string, prefs: NotificationPrefs): Promise<void> {
  if (Platform.OS === 'web') return
  if (!(await hasNotificationPermission())) return

  await cancelOryalisScheduled()
  const now = new Date()
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US'

  if (prefs.digestEnabled) {
    const dates = await loadPendingActionDates(userId)
    for (let d = 0; d < DIGEST_DAYS; d++) {
      const fireAt = new Date(now)
      fireAt.setDate(fireAt.getDate() + d)
      fireAt.setHours(prefs.digestHour, 0, 0, 0)
      if (fireAt.getTime() <= now.getTime()) continue
      const overdue = dates.filter(at => isInUrgencyWindow(at, 'overdue', fireAt)).length
      const dueToday = dates.filter(at => isInUrgencyWindow(at, 'due_today', fireAt)).length
      const total = overdue + dueToday
      if (total === 0) continue
      await Notifications.scheduleNotificationAsync({
        identifier: `${DIGEST_PREFIX}${d}`,
        content: {
          title: i18n.t('notifications.digest_title'),
          body: overdue > 0
            ? i18n.t('notifications.digest_body_with_overdue', { count: total, overdue })
            : i18n.t('notifications.digest_body', { count: total }),
          sound: true,
          data: { navigateTo: '/(app)' },
        },
        trigger: dateTrigger(fireAt),
      })
    }
  }

  if (prefs.appointmentRemindersEnabled) {
    const appointments = await loadUpcomingAppointments(userId)
    for (const appt of appointments) {
      const start = new Date(appt.start_at)
      const fireAt = new Date(start.getTime() - prefs.appointmentLeadMinutes * 60000)
      if (fireAt.getTime() <= now.getTime()) continue
      await Notifications.scheduleNotificationAsync({
        identifier: `${APPOINTMENT_PREFIX}${appt.id}`,
        content: {
          title: i18n.t('notifications.appointment_title', {
            delay: prefs.appointmentLeadMinutes >= 60 ? `${prefs.appointmentLeadMinutes / 60} h` : `${prefs.appointmentLeadMinutes} min`,
          }),
          body: i18n.t('notifications.appointment_body', {
            time: start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
          }),
          sound: true,
          data: { navigateTo: `/(app)/appointments/${appt.id}` },
        },
        trigger: dateTrigger(fireAt),
      })
    }
  }
}

export async function cancelAllOryalisNotifications(): Promise<void> {
  if (Platform.OS === 'web') return
  await cancelOryalisScheduled()
}

// ── Notification immédiate ────────────────────────────────────────────────────

export async function notifyNow(title: string, body: string, navigateTo?: string): Promise<void> {
  if (Platform.OS === 'web') return
  const ok = await requestPermissions()
  if (!ok) return

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data: navigateTo ? { navigateTo } : undefined,
    },
    trigger: null,
  })
}

// ── Badge app (iOS) ───────────────────────────────────────────────────────────

export async function setBadgeCount(count: number): Promise<void> {
  if (Platform.OS !== 'ios') return
  await Notifications.setBadgeCountAsync(count).catch(() => {})
}
