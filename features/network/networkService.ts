import { supabase } from '@/shared/lib/supabase'
import type { Client, NetworkNode } from '@/shared/lib/types'
import { isProgramEligibleForNextOccurrence } from '@/features/clients/recurringProgramService'

const NETWORK_COLS =
  'id, full_name, first_name, email, phone, contact_role, sponsor_id, updated_at, created_at'

type FlatNode = Pick<Client,
  'id' | 'full_name' | 'first_name' | 'email' | 'phone' |
  'contact_role' | 'sponsor_id' |
  'updated_at' | 'created_at'
>

// LRP-4 — un client peut porter plusieurs programmes actifs (rare en pratique) ; celui dont
// l'échéance est la plus proche est le seul retenu pour l'alerte réseau, même règle que
// fetchActiveProgramForClient (recurringProgramService.ts) mais en un seul aller-retour pour
// tout l'arbre plutôt qu'une requête par nœud.
async function fetchActiveProgramsByClientId(clientIds: string[]): Promise<Map<string, { id: string; next_occurrence_date: string | null }>> {
  const map = new Map<string, { id: string; next_occurrence_date: string | null }>()
  if (clientIds.length === 0) return map
  const { data, error } = await supabase
    .from('recurring_programs')
    .select('id, client_id, status, next_occurrence_date, end_mode, end_date')
    .in('client_id', clientIds)
    .eq('status', 'active')
    .order('next_occurrence_date', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  // LRP-4.2 §5/§6 — même règle métier unique qu'alertService/useDashboard/Synthèse : un
  // programme end_date dépassée ne doit jamais alimenter le badge réseau, même si son statut DB
  // n'a pas encore été normalisé à 'completed'.
  const today = new Date().toISOString().split('T')[0]
  for (const row of (data ?? []).filter(r => isProgramEligibleForNextOccurrence(r, today))) {
    if (!map.has(row.client_id)) map.set(row.client_id, { id: row.id, next_occurrence_date: row.next_occurrence_date })
  }
  return map
}

function buildTree(clients: FlatNode[], programsByClientId: Map<string, { id: string; next_occurrence_date: string | null }>): NetworkNode[] {
  const map = new Map<string, NetworkNode>()

  for (const c of clients) {
    const program = programsByClientId.get(c.id) ?? null
    map.set(c.id, {
      ...c, children: [], level: 0,
      activeProgramId: program?.id ?? null,
      nextOccurrenceDate: program?.next_occurrence_date ?? null,
    })
  }

  const roots: NetworkNode[] = []

  for (const node of map.values()) {
    if (node.sponsor_id && map.has(node.sponsor_id)) {
      map.get(node.sponsor_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  function assignLevels(node: NetworkNode, depth: number) {
    node.level = depth
    for (const child of node.children) assignLevels(child, depth + 1)
  }
  roots.forEach(r => assignLevels(r, 0))

  // Sort each level alphabetically
  function sortChildren(node: NetworkNode) {
    node.children.sort((a, b) => a.full_name.localeCompare(b.full_name))
    node.children.forEach(sortChildren)
  }
  roots.forEach(sortChildren)
  roots.sort((a, b) => a.full_name.localeCompare(b.full_name))

  return roots
}

// Returns full downline tree for the authenticated user.
// Includes: clients with sponsor_id set OR with a network contact_role.
export async function fetchNetworkTree(userId: string): Promise<NetworkNode[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(NETWORK_COLS)
    .eq('user_id', userId)
    .or('sponsor_id.not.is.null,contact_role.ov.{distributor,leader,team_member}')
    .order('full_name')

  if (error) throw new Error(error.message)
  const clients = (data ?? []) as FlatNode[]
  const programsByClientId = await fetchActiveProgramsByClientId(clients.map(c => c.id))
  return buildTree(clients, programsByClientId)
}

// Returns only direct children of a given sponsor (level 1 downline).
export async function fetchDirectDownline(sponsorId: string): Promise<FlatNode[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(NETWORK_COLS)
    .eq('sponsor_id', sponsorId)
    .order('full_name')

  if (error) throw new Error(error.message)
  return (data ?? []) as FlatNode[]
}
