import { useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { claimSecurityNotifications } from '@/features/admin/adminService'
import { notifyNow } from '@/features/notifications/notificationService'

export function useSecurityNotifications(session: Session | null) {
  useEffect(() => {
    if (!session) return
    let active = true
    const poll = async () => {
      try {
        const notifications = await claimSecurityNotifications()
        if (!active) return
        for (const notification of notifications) {
          await notifyNow(notification.title, notification.body, '/(app)/settings-owner')
        }
      } catch (error) {
        console.warn('[security.notifications]', error)
      }
    }
    void poll()
    const timer = setInterval(poll, 60_000)
    return () => { active = false; clearInterval(timer) }
  }, [session?.user.id])
}
