import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { getClients, searchClients } from './clientService'
import { getPendingFollowups } from '@/features/followups/followupService'
import { fetchActiveAppointmentsByUser } from '@/features/appointments/appointmentService'
import { getActiveInteractionsByUser } from '@/features/interactions/interactionService'
import type { ClientListItem, ContactRole, Followup } from '@/shared/lib/types'

export function useClients(roleFilter?: ContactRole) {
  const { session } = useAuth()
  const [clients, setClients] = useState<ClientListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!session) return
    setLoading(true)
    setError(null)
    try {
      const data = await getClients(session.user.id)
      setClients(roleFilter ? data.filter(c => c.contact_role.includes(roleFilter)) : data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setLoading(false)
    }
  }, [session, roleFilter])

  useEffect(() => { fetch() }, [fetch])

  return { clients, loading, error, refresh: fetch }
}

export function useClientSearch() {
  const { session } = useAuth()
  const [results, setResults] = useState<ClientListItem[]>([])
  const [loading, setLoading] = useState(false)
  // Protège contre les réponses hors ordre : si "martin" répond avant "mar" (parti avant,
  // mais plus lent), l'ancienne réponse ne doit jamais écraser le résultat le plus récent.
  const latestRequestId = useRef(0)

  const search = useCallback(async (query: string, role?: ContactRole) => {
    if (!session) return
    const requestId = ++latestRequestId.current
    setLoading(true)
    try {
      const data = await searchClients(session.user.id, query, role)
      if (requestId !== latestRequestId.current) return // requête devenue obsolète, on l'ignore
      setResults(data)
    } finally {
      if (requestId === latestRequestId.current) setLoading(false)
    }
  }, [session])

  return { results, loading, search }
}

function earliestByClient(rows: { client_id: string | null; at: string }[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const r of rows) {
    if (!r.client_id) continue
    const prev = map[r.client_id]
    if (!prev || new Date(r.at).getTime() < new Date(prev).getTime()) map[r.client_id] = r.at
  }
  return map
}

// ACTION-3.6 / CONTACTS-3.6 — variante non-écrasante de earliestByClient : conserve l'id ET la
// date de TOUTES les ressources actives par contact (pas seulement la plus proche), à partir
// des mêmes lignes déjà chargées, jamais une requête séparée. Nécessaire pour "Tous types" :
// le nombre réel de ressources par contact (ex. 3 relances) ne peut pas être déduit d'une map à
// une seule date (audit dédié) ; l'id est nécessaire pour cibler la ressource exacte au clic
// sur une action dépliée (CONTACTS-3.6, réutilise CONTACT-4.2).
export interface ClientActionResource { id: string; at: string }
function allByClient(rows: { client_id: string | null; id: string; at: string }[]): Record<string, ClientActionResource[]> {
  const map: Record<string, ClientActionResource[]> = {}
  for (const r of rows) {
    if (!r.client_id) continue
    ;(map[r.client_id] ??= []).push({ id: r.id, at: r.at })
  }
  return map
}

// ACTION-3.5 — chargement groupé (3 requêtes au total, jamais une par contact) des actions
// actives par type, pour que le filtre Contacts → À traiter → [RDV/Relance/Interaction]
// réponde à "quels contacts ont AU MOINS UNE action de ce type dans l'horizon", plutôt que de
// se limiter à clients.next_action_source (LA seule action globale déjà choisie par le trigger
// DB — un besoin différent, voir l'audit dédié). Chaque map ne retient que la date la plus
// proche par contact, calculée une seule fois ici — jamais recalculée à chaque changement de
// filtre horizon/type (purement local ensuite, voir clients/index.tsx).
export function useActionAvailability(userId: string | undefined) {
  const [appointmentMap, setAppointmentMap] = useState<Record<string, string>>({})
  const [followupMap, setFollowupMap]       = useState<Record<string, string>>({})
  const [interactionMap, setInteractionMap] = useState<Record<string, string>>({})
  // ACTION-3.6 — mêmes données que ci-dessus, non écrasées : toutes les dates actives par
  // contact et par type (pas seulement la plus proche), pour "Tous types" (compteur exact de
  // ressources). Coexiste avec les maps ci-dessus sans les remplacer — les filtres RDV/Relance/
  // Interaction spécifiques continuent d'utiliser exclusivement la date la plus proche.
  const [appointmentAllMap, setAppointmentAllMap] = useState<Record<string, ClientActionResource[]>>({})
  const [followupAllMap, setFollowupAllMap]       = useState<Record<string, ClientActionResource[]>>({})
  const [interactionAllMap, setInteractionAllMap] = useState<Record<string, ClientActionResource[]>>({})
  // CONTACTS-SEGMENTS-1 — "prospect chaud" = au moins une relance en attente notée chaude ou très
  // chaude : même règle que le badge de la fiche contact et la catégorie hot_prospect du
  // dashboard, dérivée des relances déjà chargées ci-dessous (aucune requête supplémentaire).
  const [hotClientIds, setHotClientIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [followups, appointments, interactions] = await Promise.all([
        getPendingFollowups(userId),
        fetchActiveAppointmentsByUser(userId),
        getActiveInteractionsByUser(userId),
      ])
      const followupRows    = (followups as Followup[]).map(f => ({ id: f.id, client_id: f.client_id, at: f.due_date }))
      const appointmentRows = appointments.map(a => ({ id: a.id, client_id: a.client_id, at: a.start_at }))
      const interactionRows = interactions.map(i => ({ id: i.id, client_id: i.client_id, at: i.scheduled_at }))
      setFollowupMap(earliestByClient(followupRows))
      setAppointmentMap(earliestByClient(appointmentRows))
      setInteractionMap(earliestByClient(interactionRows))
      setFollowupAllMap(allByClient(followupRows))
      setAppointmentAllMap(allByClient(appointmentRows))
      setInteractionAllMap(allByClient(interactionRows))
      setHotClientIds(new Set(
        (followups as Followup[])
          .filter(f => f.client_id && (f.prospect_temperature === 'hot' || f.prospect_temperature === 'very_hot'))
          .map(f => f.client_id as string)
      ))
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  return {
    appointmentMap, followupMap, interactionMap,
    appointmentAllMap, followupAllMap, interactionAllMap,
    hotClientIds,
    loading, refresh,
  }
}
