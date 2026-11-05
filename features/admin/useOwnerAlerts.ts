import { useCallback, useEffect, useMemo, useState } from 'react'
import { listOwnerAlerts, listSecurityNotifications, markSecurityNotificationsRead, type OwnerAlert } from './adminService'

export interface OwnerAlertGroup {
  key: string
  category: OwnerAlert['category']
  severity: OwnerAlert['severity']
  title: string
  action: string | null
  subject: OwnerAlert['subject']
  items: OwnerAlert[]
  unreadIds: string[]
  lastAt: string
}

const SEVERITY_RANK: Record<OwnerAlert['severity'], number> = { critical: 0, warning: 1, info: 2 }

// Alertes identiques (même type, même compte concerné) réunies en une ligne.
function groupAlerts(alerts: OwnerAlert[]): OwnerAlertGroup[] {
  const groups = new Map<string, OwnerAlertGroup>()
  for (const alert of alerts) {
    const key = [alert.category, alert.severity, alert.title, alert.action ?? '', alert.subject?.user_id ?? ''].join('|')
    const group = groups.get(key) ?? {
      key, category: alert.category, severity: alert.severity, title: alert.title,
      action: alert.action ?? null, subject: alert.subject, items: [], unreadIds: [], lastAt: alert.created_at,
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
  const [alerts, setAlerts] = useState<OwnerAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true); setFailed(false)
    // Repli sans détails tant que owner_list_alerts n'est pas en base.
    try { setAlerts(await listOwnerAlerts(200).catch(() => listSecurityNotifications(200))) }
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
