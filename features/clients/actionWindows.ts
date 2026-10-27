import type { ClientActionResource } from './useClients'

// DASH-URGENCY-1 — fenêtres STRICTES (disjointes) partagées par les compteurs d'urgence du
// dashboard ET la liste Contacts → À traiter : un clic sur "3 en retard" doit ouvrir exactement
// ces 3 contacts. Distinctes des horizons cumulatifs de la liste (aujourd'hui/3j/7j…, bornes
// supérieures seules, retards inclus), qui restent inchangés.
export type UrgencyWindow = 'overdue' | 'due_today' | 'next_7d'
export const URGENCY_WINDOWS: UrgencyWindow[] = ['overdue', 'due_today', 'next_7d']

// Une relance porte une date sans heure ("2026-10-27") : `new Date()` la lirait comme minuit
// UTC, ce qui hors de l'Europe la ferait basculer la veille (donc "en retard" à tort).
function parseActionDate(at: string): number {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(at)
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])).getTime()
  return new Date(at).getTime()
}

function dayBoundary(now: Date, plusDays: number, end: boolean): number {
  const d = new Date(now)
  d.setDate(d.getDate() + plusDays)
  if (end) d.setHours(23, 59, 59, 999)
  else d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isInUrgencyWindow(at: string, window: UrgencyWindow, now: Date = new Date()): boolean {
  const t = parseActionDate(at)
  const todayStart = dayBoundary(now, 0, false)
  const todayEnd = dayBoundary(now, 0, true)
  if (window === 'overdue') return t < todayStart
  if (window === 'due_today') return t >= todayStart && t <= todayEnd
  return t > todayEnd && t <= dayBoundary(now, 7, true)
}

export type ActionResourceMaps = {
  appointment: Record<string, ClientActionResource[]>
  followup: Record<string, ClientActionResource[]>
  interaction: Record<string, ClientActionResource[]>
}

export function clientHasActionInWindow(clientId: string, maps: ActionResourceMaps, window: UrgencyWindow, now: Date = new Date()): boolean {
  return (['appointment', 'followup', 'interaction'] as const).some(source =>
    (maps[source][clientId] ?? []).some(r => isInUrgencyWindow(r.at, window, now))
  )
}

export interface UrgencyCounts {
  overdue: number
  due_today: number
  next_7d: number
  no_action: number
}

// Compte des CONTACTS (pas des actions), un contact pouvant apparaître dans plusieurs fenêtres
// s'il a à la fois une action en retard et une autre aujourd'hui — même règle que la liste.
// "Sans prochaine action" = même critère que le filtre "Sans action" de la liste (next_action_at).
export function computeUrgencyCounts(
  clients: { id: string; next_action_at: string | null }[],
  maps: ActionResourceMaps,
  now: Date = new Date(),
): UrgencyCounts {
  const counts: UrgencyCounts = { overdue: 0, due_today: 0, next_7d: 0, no_action: 0 }
  for (const c of clients) {
    if (!c.next_action_at) counts.no_action++
    for (const w of URGENCY_WINDOWS) {
      if (clientHasActionInWindow(c.id, maps, w, now)) counts[w]++
    }
  }
  return counts
}
