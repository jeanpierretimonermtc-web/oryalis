import type { RelationshipHealth } from '@/shared/lib/types'

// Reprend les seuils déjà utilisés ailleurs dans l'app (features/alerts/alertService.ts :
// 7 jours pour "sans contact", 30 jours pour "dormant") plutôt que d'en inventer de nouveaux.
const STALE_DAYS = 7
const DORMANT_DAYS = 30

export interface RelationshipHealthInput {
  next_action_at: string | null
  last_interaction_at: string | null
  manually_inactive: boolean
  created_at: string
}

// Bascule manuelle prioritaire, puis action planifiée (passée/à venir), puis récence du
// dernier contact en l'absence d'action planifiée. Un client jamais encore contacté n'a
// pas de last_interaction_at : on retombe sur sa date de création plutôt que de le
// déclarer "dormant" — sinon un client tout juste créé apparaît immédiatement délaissé.
export function computeRelationshipHealth(
  client: RelationshipHealthInput,
  now: Date = new Date(),
): RelationshipHealth {
  if (client.manually_inactive) return { tier: 'dormant', overridden: true }

  const nowMs = now.getTime()
  const nextActionMs = client.next_action_at ? new Date(client.next_action_at).getTime() : null
  const lastContactMs = client.last_interaction_at
    ? new Date(client.last_interaction_at).getTime()
    : new Date(client.created_at).getTime()

  if (nextActionMs != null) {
    return nextActionMs < nowMs
      ? { tier: 'overdue', overridden: false }
      : { tier: 'up_to_date', overridden: false }
  }

  const daysSinceContact = Math.floor((nowMs - lastContactMs) / 86400000)
  if (daysSinceContact <= STALE_DAYS) return { tier: 'up_to_date', overridden: false }
  if (daysSinceContact <= DORMANT_DAYS) return { tier: 'to_follow_up', overridden: false }
  return { tier: 'dormant', overridden: false }
}
