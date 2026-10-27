import { supabase } from '@/shared/lib/supabase'

export async function updateProfile(userId: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from('profiles')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw error
}
