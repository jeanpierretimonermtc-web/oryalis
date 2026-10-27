import { useEffect } from 'react'
import { AppState, Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { rescheduleNotifications, setBadgeCount } from './notificationService'
import { loadNotificationPrefs } from './notificationPrefs'

// NOTIF-DIGEST-1 — recalcul au lancement et à chaque retour au premier plan (les chiffres du
// résumé restent ainsi à jour), limité à une fois toutes les 5 minutes : un aller-retour rapide
// entre applications ne relance pas les 4 requêtes.
const MIN_INTERVAL_MS = 5 * 60 * 1000
let lastRunAt = 0

export async function refreshScheduledNotifications(userId: string, force = false): Promise<void> {
  if (Platform.OS === 'web') return
  if (!force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return
  lastRunAt = Date.now()
  try {
    await rescheduleNotifications(userId, await loadNotificationPrefs())
  } catch (e) {
    console.error('[refreshScheduledNotifications]', e)
  }
}

export function useNotificationSetup(userId: string | undefined) {
  useEffect(() => {
    if (Platform.OS === 'web' || !userId) return

    refreshScheduledNotifications(userId)
    const appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshScheduledNotifications(userId)
    })

    // Ouvre la bonne page quand l'utilisateur tape sur une notif
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const dest = response.notification.request.content.data?.navigateTo as string | undefined
      if (dest) router.push(dest as any)
    })

    return () => { appStateSub.remove(); responseSub.remove() }
  }, [userId])
}

// ── Badge iOS : met à jour le chiffre sur l'icône de l'app ──────────────────

export function useFollowupBadge(count: number) {
  useEffect(() => {
    setBadgeCount(count).catch(console.error)
  }, [count])
}
