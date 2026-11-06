import { supabase } from '@/shared/lib/supabase'
import type { Brand, BrandNetworkRole, ClientBrand } from '@/shared/lib/types'

export interface BrandWithCounts extends Brand {
  contactCount: number
  programCount: number
}

export interface ClientBrandWithBrand extends ClientBrand {
  brand: Brand
}

export class BrandExistsError extends Error {
  constructor() { super('brand_exists') }
}

export async function fetchBrands(): Promise<BrandWithCounts[]> {
  const { data, error } = await supabase
    .from('brands')
    .select('*, client_brands(count), recurring_programs(count)')
    .order('name')
  if (error) throw error
  return (data ?? []).map(row => {
    const { client_brands, recurring_programs, ...brand } = row as Brand & {
      client_brands: { count: number }[]
      recurring_programs: { count: number }[]
    }
    return { ...brand, contactCount: client_brands?.[0]?.count ?? 0, programCount: recurring_programs?.[0]?.count ?? 0 }
  })
}

// Suppression définitive d'une marque : ses liens contacts partent en cascade, ses programmes
// restent (brand_id → NULL, "sans marque"), son catalogue éventuel n'est pas touché.
export async function deleteBrand(id: string): Promise<void> {
  const { error } = await supabase.from('brands').delete().eq('id', id)
  if (error) throw error
}

export async function createBrand(userId: string, name: string, catalogId: string | null = null): Promise<Brand> {
  const { data, error } = await supabase
    .from('brands')
    .insert({ user_id: userId, name: name.trim(), catalog_id: catalogId })
    .select()
    .single()
  if (error) {
    // 23505 : même nom normalisé déjà présent (unicité garantie en base).
    if (error.code === '23505') throw new BrandExistsError()
    throw error
  }
  return data as Brand
}

export async function updateBrand(id: string, patch: Partial<Pick<Brand, 'name' | 'color' | 'logo_url' | 'program_name' | 'role_labels'>>): Promise<void> {
  const { error } = await supabase
    .from('brands')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    if (error.code === '23505') throw new BrandExistsError()
    throw error
  }
}

// Logo privé : bucket "avatars" existant (même mécanisme que les photos de contact), dossier
// dédié <userId>/brands/ ; ?t= force le rechargement quand l'image est remplacée.
export async function uploadBrandLogo(userId: string, brandId: string, uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob()
  const path = `${userId}/brands/${brandId}.jpg`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' })
  if (error) throw error
  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)
  const url = `${publicUrl}?t=${Date.now()}`
  await updateBrand(brandId, { logo_url: url })
  return url
}

// Fusion : chaque contact de la marque source passe sur la cible (sans doublon : un contact déjà
// lié à la cible garde son lien, et son numéro de membre s'il en avait un), puis la source est
// supprimée (ses liens restants partent en cascade).
export async function mergeBrands(sourceId: string, targetId: string): Promise<void> {
  if (sourceId === targetId) return
  const [{ data: sourceLinks, error: e1 }, { data: targetLinks, error: e2 }] = await Promise.all([
    supabase.from('client_brands').select('*').eq('brand_id', sourceId),
    supabase.from('client_brands').select('client_id').eq('brand_id', targetId),
  ])
  if (e1) throw e1
  if (e2) throw e2
  const alreadyOnTarget = new Set((targetLinks ?? []).map(l => l.client_id))
  const toMove = (sourceLinks ?? []).filter(l => !alreadyOnTarget.has(l.client_id))
  for (const link of toMove) {
    const { error } = await supabase.from('client_brands').update({ brand_id: targetId, updated_at: new Date().toISOString() }).eq('id', link.id)
    if (error) throw error
  }
  const { error } = await supabase.from('brands').delete().eq('id', sourceId)
  if (error) throw error
}

// ── Marques d'un contact ──────────────────────────────────────────────────────────────────────

export async function fetchClientBrands(clientId: string): Promise<ClientBrandWithBrand[]> {
  const { data, error } = await supabase
    .from('client_brands')
    .select('*, brand:brands(*)')
    .eq('client_id', clientId)
  if (error) throw error
  // Ordre stable (nom de marque) : une mise à jour du lien ne doit jamais déplacer la ligne.
  return ((data ?? []) as unknown as ClientBrandWithBrand[]).sort((a, b) => a.brand.name.localeCompare(b.brand.name))
}

// Tous les liens de l'utilisateur, pour la liste des contacts (pastilles + filtre).
export type ClientBrandLinkLite = Pick<ClientBrand, 'client_id' | 'brand_id' | 'sponsor_client_id' | 'network_role'>

export async function fetchAllClientBrandLinks(): Promise<ClientBrandLinkLite[]> {
  const { data, error } = await supabase.from('client_brands').select('client_id, brand_id, sponsor_client_id, network_role')
  if (error) throw error
  return data ?? []
}

export async function addClientBrand(userId: string, clientId: string, brandId: string): Promise<void> {
  const { error } = await supabase
    .from('client_brands')
    .insert({ user_id: userId, client_id: clientId, brand_id: brandId, source: 'manual', source_at: new Date().toISOString() })
  // 23505 : déjà liée — rien à faire.
  if (error && error.code !== '23505') throw error
}

export async function removeClientBrand(id: string): Promise<void> {
  const { error } = await supabase.from('client_brands').delete().eq('id', id)
  if (error) throw error
}

// BRAND-NETWORK-1 — rôle et parrain dans le réseau de la marque. La base refuse soi-même,
// un parrain sans cette marque et toute boucle (trigger check_client_brand_sponsor).
export class BrandSponsorError extends Error {}

export async function updateClientBrandNetwork(
  id: string,
  patch: Partial<Pick<ClientBrand, 'network_role' | 'sponsor_client_id'>>,
): Promise<void> {
  const { error } = await supabase
    .from('client_brands')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    if (error.message?.startsWith('BRAND_SPONSOR_')) throw new BrandSponsorError(error.message)
    throw error
  }
}

export interface BrandMember {
  client_id: string
  sponsor_client_id: string | null
  network_role: BrandNetworkRole
  full_name: string
}

// Membres (contacts actifs) du réseau d'une marque, pour choisir un parrain.
export async function fetchBrandMembers(brandId: string): Promise<BrandMember[]> {
  const { data, error } = await supabase
    .from('client_brands')
    .select('client_id, sponsor_client_id, network_role, client:clients!client_brands_client_fkey(full_name, archived_at)')
    .eq('brand_id', brandId)
  if (error) throw error
  type Row = Omit<BrandMember, 'full_name'> & { client: { full_name: string; archived_at: string | null } | null }
  return ((data ?? []) as unknown as Row[])
    .filter(r => r.client && !r.client.archived_at)
    .map(r => ({ client_id: r.client_id, sponsor_client_id: r.sponsor_client_id, network_role: r.network_role, full_name: r.client!.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
}

// Le contact + toute sa descendance dans la marque : jamais proposés comme parrain.
export function brandDownlineIds(clientId: string, members: BrandMember[]): Set<string> {
  const result = new Set<string>([clientId])
  let grew = true
  while (grew) {
    grew = false
    for (const m of members) {
      if (m.sponsor_client_id && result.has(m.sponsor_client_id) && !result.has(m.client_id)) { result.add(m.client_id); grew = true }
    }
  }
  return result
}

// Rattache un contact à une marque (s'il ne l'a pas encore) puis le place sous ce parrain.
export async function attachToBrandSponsor(
  userId: string, clientId: string, brandId: string, sponsorClientId: string | null, networkRole?: BrandNetworkRole,
): Promise<void> {
  await addClientBrand(userId, clientId, brandId)
  const { data, error } = await supabase
    .from('client_brands').select('id').eq('client_id', clientId).eq('brand_id', brandId).single()
  if (error) throw error
  await updateClientBrandNetwork(data.id, { sponsor_client_id: sponsorClientId, ...(networkRole ? { network_role: networkRole } : {}) })
}

export async function updateClientBrandMemberNumber(id: string, memberNumber: string): Promise<void> {
  const { error } = await supabase
    .from('client_brands')
    .update({ member_number: memberNumber.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}
