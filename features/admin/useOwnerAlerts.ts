import { useCallback, useEffect, useMemo, useState } from 'react'
import { listSecurityNotifications, markSecurityNotificationsRead, type SecurityNotification } from './adminService'

export interface OwnerAlertGroup {
  key: string
  category: SecurityNotification['category']
  severity: SecurityNotification['severity']
  title: string
  body: string
  subjectUserId: string | null
  items: SecurityNotification[]
  unreadIds: string[]
  lastAt: string
}

const SEVERITY_RANK: Record<SecurityNotification['severity'], number> = { critical: 0, warning: 1, info: 2 }

// Alertes identiques (même type, même compte concerné) réunies en une ligne.
function groupAlerts(alerts: SecurityNotification[]): OwnerAlertGroup[] {
  const groups = new Map<string, OwnerAlertGroup>()
  for (const alert of alerts) {
    const subject = typeof alert.data?.subject_user_id === 'string' ? alert.data.subject_user_id : null
    const key = [alert.category, alert.severity, alert.title, subject ?? ''].join('|')
    const group = groups.get(key) ?? {
      key, category: alert.category, severity: alert.severity, title: alert.title, body: alert.body,
      subjectUserId: subject, items: [], unreadIds: [], lastAt: alert.created_at,
    }
    group.items.push(alert)
    if (!alert.read_at) group.unreadIds.push(alert.id)
    if (alert.created_at > group.lastAt) group.lastAt = alert.created_at
    groups.set(key, group)
  }
  return [...groups.values()].sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.lastAt.localeCompare(a.lastAt))
}

export function useOwnerAlerts() {
  const [alerts, setAlerts] = useState<SecurityNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true); setFailed(false)
    try { setAlerts(await listSecurityNotifications(200)) }
    catch (e) { console.error('[owner.alerts]', e); setFailed(true) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const markRead = useCallback(async (ids?: string[]) => {
    await markSecurityNotificationsRead(ids)
    await refresh()
  }, [refresh])

  const groups = useMemo(() => groupAlerts(alerts), [alerts])
  return { alerts, groups, loading, failed, markRead }
}
