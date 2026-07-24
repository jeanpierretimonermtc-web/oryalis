import * as Linking from 'expo-linking'
import { supabase } from '@/shared/lib/supabase'
import type { Client } from '@/shared/lib/types'

function requireSource(client: Client) {
  if (!client.next_action_source || !client.next_action_source_id) {
    throw new Error('Aucune prochaine action à traiter.')
  }
  return { source: client.next_action_source, id: client.next_action_source_id }
}

export async function completeNextAction(client: Client) {
  const { source, id } = requireSource(client)
  const now = new Date().toISOString()
  const operation = source === 'appointment'
    ? supabase.from('appointments').update({ status: 'completed', updated_at: now }).eq('id', id)
    : source === 'interaction'
      ? supabase.from('interactions').update({ completed_at: now, updated_at: now }).eq('id', id)
      : supabase.from('followups').update({ done: true, updated_at: now }).eq('id', id)
  const { error } = await operation
  if (error) throw error
}

export async function postponeNextAction(client: Client, days = 1) {
  const { source, id } = requireSource(client)
  if (!client.next_action_at) throw new Error('Cette action ne possède pas de date.')
  const shifted = new Date(new Date(client.next_action_at).getTime() + days * 86400000)
  let operation
  if (source === 'appointment') {
    const { data, error } = await supabase.from('appointments').select('start_at, end_at').eq('id', id).single()
    if (error) throw error
    const duration = new Date(data.end_at).getTime() - new Date(data.start_at).getTime()
    operation = supabase.from('appointments').update({
      start_at: shifted.toISOString(),
      end_at: new Date(shifted.getTime() + duration).toISOString(),
      status: 'rescheduled',
      updated_at: new Date().toISOString(),
    }).eq('id', id)
  } else if (source === 'interaction') {
    operation = supabase.from('interactions').update({ scheduled_at: shifted.toISOString(), updated_at: new Date().toISOString() }).eq('id', id)
  } else {
    operation = supabase.from('followups').update({ due_date: shifted.toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', id)
  }
  const { error } = await operation
  if (error) throw error
}

export async function callContact(phone: string) {
  await Linking.openURL(`tel:${phone.replace(/[^+\d]/g, '')}`)
}

export async function openWhatsApp(phone: string) {
  const digits = phone.replace(/\D/g, '')
  await Linking.openURL(`https://wa.me/${digits}`)
}
