import { supabase } from '@/shared/lib/supabase'
import type { Brand, BrandNetworkRole, Client, NetworkNode } from '@/shared/lib/types'
import { isBrandPartnerRole } from '@/features/brands/brandRoleLabels'
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

// BRAND-NETWORK-1 — parrain/rôle fournis par l'appelant : clients.sponsor_id hors marque,
// client_brands.sponsor_client_id / network_role dans le réseau d'une marque.
type Placement = { sponsorId: string | null; networkRole?: BrandNetworkRole }

function buildTree(
  clients: FlatNode[],
  programsByClientId: Map<string, { id: string; next_occurrence_date: string | null }>,
  placementOf: (c: FlatNode) => Placement = c => ({ sponsorId: c.sponsor_id }),
): NetworkNode[] {
  const map = new Map<string, NetworkNode>()
  const sponsorOf = new Map<string, string | null>()

  for (const c of clients) {
    const program = programsByClientId.get(c.id) ?? null
    const placement = placementOf(c)
    sponsorOf.set(c.id, placement.sponsorId)
    map.set(c.id, {
      ...c, children: [], level: 0,
      activeProgramId: program?.id ?? null,
      nextOccurrenceDate: program?.next_occurrence_date ?? null,
      ...(placement.networkRole ? { networkRole: placement.networkRole } : {}),
    })
  }

  const roots: NetworkNode[] = []

  for (const node of map.values()) {
    const sponsorId = sponsorOf.get(node.id)
    if (sponsorId && map.has(sponsorId)) {
      map.get(sponsorId)!.children.push(node)
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
// Includes: clients with sponsor_id set, a network contact_role, or the customer role (a
// customer without sponsor is the user's own customer, shown directly under "me").
async function fetchFlatNetwork(userId: string): Promise<FlatNode[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(NETWORK_COLS)
    .eq('user_id', userId)
    .is('archived_at', null)
    .or('sponsor_id.not.is.null,contact_role.ov.{distributor,leader,team_member,customer}')
    .order('full_name')

  if (error) throw new Error(error.message)
  return (data ?? []) as FlatNode[]
}

export async function fetchNetworkTree(userId: string): Promise<NetworkNode[]> {
  const clients = await fetchFlatNetwork(userId)
  const programsByClientId = await fetchActiveProgramsByClientId(clients.map(c => c.id))
  return buildTree(clients, programsByClientId)
}

// BRAND-NETWORK-1 — un arbre par marque (client_brands), plus un arbre "sans marque" pour les
// contacts réseau rattachés à aucune marque (ancien parrain clients.sponsor_id).
export interface BrandNetwork {
  brand: Brand | null
  roots: NetworkNode[]
}

type LinkedClient = FlatNode & { archived_at: string | null }

type BrandLinkRow = {
  client_id: string
  brand_id: string
  sponsor_client_id: string | null
  network_role: BrandNetworkRole
  brand: Brand
  client: LinkedClient | null
}

const LINKED_CLIENT_SELECT = 'client:clients!client_brands_client_fkey(' + NETWORK_COLS + ', archived_at)'

function stripArchived(c: LinkedClient): FlatNode {
  const { archived_at: _archived, ...rest } = c
  return rest
}

export async function fetchBrandNetworks(userId: string): Promise<BrandNetwork[]> {
  const [linksRes, flat] = await Promise.all([
    supabase
      .from('client_brands')
      .select('client_id, brand_id, sponsor_client_id, network_role, brand:brands(*), ' + LINKED_CLIENT_SELECT)
      .eq('user_id', userId),
    fetchFlatNetwork(userId),
  ])
  if (linksRes.error) throw new Error(linksRes.error.message)
  // Un simple prospect lié à une marque (via une recommandation par ex.) n'est pas encore dans
  // le réseau, sauf s'il y est déjà placé comme partenaire ou sous un parrain.
  const links = ((linksRes.data ?? []) as unknown as BrandLinkRow[]).filter(l =>
    l.client && !l.client.archived_at &&
    (isBrandPartnerRole(l.network_role) || l.sponsor_client_id != null || (l.network_role === 'customer' && l.client.contact_role.some(r => r !== 'prospect' && r !== 'inactive'))))

  const linkedIds = new Set(links.map(l => l.client_id))
  const unbranded = flat.filter(c => !linkedIds.has(c.id))
  const programsByClientId = await fetchActiveProgramsByClientId([...linkedIds, ...unbranded.map(c => c.id)])

  const byBrand = new Map<string, { brand: Brand; rows: BrandLinkRow[] }>()
  for (const l of links) {
    const entry = byBrand.get(l.brand_id) ?? { brand: l.brand, rows: [] }
    entry.rows.push(l)
    byBrand.set(l.brand_id, entry)
  }

  const result: BrandNetwork[] = [...byBrand.values()]
    .sort((a, b) => a.brand.name.localeCompare(b.brand.name))
    .map(({ brand, rows }) => {
      const placement = new Map(rows.map(r => [r.client_id, { sponsorId: r.sponsor_client_id, networkRole: r.network_role }]))
      const clients = rows.map(r => stripArchived(r.client!))
      return { brand, roots: buildTree(clients, programsByClientId, c => placement.get(c.id) ?? { sponsorId: null }) }
    })

  if (unbranded.length > 0) result.push({ brand: null, roots: buildTree(unbranded, programsByClientId) })
  return result
}

// SPONSOR-1 — graphe minimal de tous les contacts actifs, pour choisir un parrain ou un filleul
// sans jamais proposer un choix qui créerait une boucle.
export type SponsorGraphNode = Pick<Client, 'id' | 'full_name' | 'contact_role' | 'sponsor_id'>

export const NETWORK_ROLES = ['distributor', 'leader', 'team_member'] as const

export async function fetchSponsorGraph(userId: string): Promise<SponsorGraphNode[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, full_name, contact_role, sponsor_id')
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('full_name')
  if (error) throw new Error(error.message)
  return (data ?? []) as SponsorGraphNode[]
}

// Le contact lui-même + toute sa descendance : aucun de ces contacts ne peut devenir son parrain.
export function downlineIds(clientId: string, graph: SponsorGraphNode[]): Set<string> {
  const childrenOf = new Map<string, string[]>()
  for (const n of graph) {
    if (!n.sponsor_id) continue
    childrenOf.set(n.sponsor_id, [...(childrenOf.get(n.sponsor_id) ?? []), n.id])
  }
  const result = new Set<string>([clientId])
  const stack = [clientId]
  while (stack.length) {
    for (const child of childrenOf.get(stack.pop()!) ?? []) {
      if (!result.has(child)) { result.add(child); stack.push(child) }
    }
  }
  return result
}

export class SponsorCycleError extends Error {}

export async function setClientSponsor(userId: string, clientId: string, sponsorId: string | null) {
  if (sponsorId) {
    const graph = await fetchSponsorGraph(userId)
    if (downlineIds(clientId, graph).has(sponsorId)) throw new SponsorCycleError()
  }
  const { error } = await supabase
    .from('clients')
    .update({ sponsor_id: sponsorId, updated_at: new Date().toISOString() })
    .eq('id', clientId)
  if (error) throw new Error(error.message)
}

// Returns only direct children of a given sponsor (level 1 downline).
// Filleuls directs : hors marque (clients.sponsor_id) et dans chaque marque (client_brands).
export async function fetchDirectDownline(sponsorId: string): Promise<FlatNode[]> {
  const [direct, viaBrand] = await Promise.all([
    supabase.from('clients').select(NETWORK_COLS).eq('sponsor_id', sponsorId).is('archived_at', null),
    supabase.from('client_brands').select(LINKED_CLIENT_SELECT).eq('sponsor_client_id', sponsorId),
  ])
  if (direct.error) throw new Error(direct.error.message)
  if (viaBrand.error) throw new Error(viaBrand.error.message)
  const byId = new Map<string, FlatNode>()
  for (const c of (direct.data ?? []) as FlatNode[]) byId.set(c.id, c)
  for (const row of (viaBrand.data ?? []) as unknown as { client: LinkedClient | null }[]) {
    if (row.client && !row.client.archived_at) byId.set(row.client.id, stripArchived(row.client))
  }
  return [...byId.values()].sort((a, b) => a.full_name.localeCompare(b.full_name))
}
