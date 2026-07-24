import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'

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

// ── Rappel quotidien ──────────────────────────────────────────────────────────

const REMINDER_ID = 'oryalis-daily-relances'

export async function scheduleDailyReminder(hour = 9, minute = 0): Promise<void> {
  if (Platform.OS === 'web') return
  const ok = await requestPermissions()
  if (!ok) return

  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {})

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: '🔔 Relances du jour',
      body:  'Vous avez des relances en attente. Pensez à contacter vos clients !',
      sound: true,
      data:  { navigateTo: '/(app)/followups' },
    },
    trigger: {
      hour,
      minute,
      repeats: true,
    } as any,
  })
}

export async function cancelDailyReminder(): Promise<void> {
  if (Platform.OS === 'web') return
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {})
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
