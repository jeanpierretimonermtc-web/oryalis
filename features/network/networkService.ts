import { supabase } from '@/shared/lib/supabase'
import type { Client, NetworkNode } from '@/shared/lib/types'

const NETWORK_COLS =
  'id, full_name, first_name, email, phone, status, contact_role, sponsor_id, next_lrp_date, updated_at, created_at'

type FlatNode = Pick<Client,
  'id' | 'full_name' | 'first_name' | 'email' | 'phone' |
  'status' | 'contact_role' | 'sponsor_id' |
  'next_lrp_date' | 'updated_at' | 'created_at'
>

function buildTree(clients: FlatNode[]): NetworkNode[] {
  const map = new Map<string, NetworkNode>()

  for (const c of clients) {
    map.set(c.id, { ...c, children: [], level: 0 })
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
  return buildTree((data ?? []) as FlatNode[])
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
