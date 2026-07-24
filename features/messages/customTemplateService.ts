import { supabase } from '@/shared/lib/supabase'
import type { MessageTemplate, TemplateCategory, TemplateChannel } from './templates'
export async function getCustomTemplates() {
  const { data, error } = await supabase.from('message_templates').select('id, category, channel, name, body').order('created_at')
  if (error) throw error
  return (data ?? []) as MessageTemplate[]
}
export async function createCustomTemplate(userId: string, input: { category: TemplateCategory; channel: TemplateChannel; name: string; body: string }) {
  const { data, error } = await supabase.from('message_templates').insert({ user_id: userId, ...input }).select('id, category, channel, name, body').single()
  if (error) throw error
  return data as MessageTemplate
}
