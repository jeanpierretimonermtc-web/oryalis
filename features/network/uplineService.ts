import { supabase } from '@/shared/lib/supabase'
import type { UplineNode } from '@/shared/lib/types'

export async function fetchUplineNodes(userId: string): Promise<UplineNode[]> {
  const { data, error } = await supabase
    .from('upline_nodes')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: false }) // position haute = plus loin de moi
  if (error) throw error
  return data as UplineNode[]
}

export async function createUplineNode(
  userId: string,
  name: string,
  memberId: string | null,
  position: number,
  brandId: string | null = null,
): Promise<UplineNode> {
  const { data, error } = await supabase
    .from('upline_nodes')
    .insert({ user_id: userId, name, member_id: memberId, position, brand_id: brandId })
    .select()
    .single()
  if (error) throw error
  return data as UplineNode
}

export async function updateUplineNode(
  id: string,
  name: string,
  memberId: string | null,
  brandId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('upline_nodes')
    .update({ name, member_id: memberId, brand_id: brandId })
    .eq('id', id)
  if (error) throw error
}

export async function deleteUplineNode(id: string): Promise<void> {
  const { error } = await supabase
    .from('upline_nodes')
    .delete()
    .eq('id', id)
  if (error) throw error
}
