import { supabase } from '@/shared/lib/supabase'
import type { Followup } from '@/shared/lib/types'

// FOLLOWUP-ORIGIN-1 — d'où vient une relance. Calculé à la lecture depuis les liens déjà posés
// sur followups : une relance sans lien (ancienne ou saisie à la main) reste "automatique" ou
// "manuelle", jamais une origine devinée.
export type FollowupOrigin =
  | { kind: 'care'; label: string; step: string | null; clientId: string }
  | { kind: 'order'; product: string; date: string; clientId: string }
  | { kind: 'interaction'; id: string; date: string; clientId: string }
  | { kind: 'appointment'; id: string; title: string; date: string }
  | { kind: 'automatic'; date: string }
  | { kind: 'manual'; date: string }

export type FollowupOriginInput = Pick<
  Followup,
  'id' | 'client_id' | 'appointment_id' | 'order_id' | 'source_interaction_id' | 'care_journey_id'
  | 'care_step_key' | 'automation_rule_id' | 'auto_generated' | 'created_at'
>

const ids = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))]

async function rowsById<T extends { id: string }>(table: string, columns: string, wanted: string[]): Promise<Map<string, T>> {
  if (wanted.length === 0) return new Map()
  const { data, error } = await supabase.from(table).select(columns).in('id', wanted)
  if (error) throw error
  return new Map(((data ?? []) as unknown as T[]).map(row => [row.id, row]))
}

export async function fetchFollowupOrigins(followups: FollowupOriginInput[]): Promise<Map<string, FollowupOrigin>> {
  const [journeys, orders, interactions, appointments] = await Promise.all([
    rowsById<{ id: string; label: string }>('care_journeys', 'id, label', ids(followups.map(f => f.care_journey_id))),
    rowsById<{ id: string; product_name: string | null; order_date: string }>('orders', 'id, product_name, order_date', ids(followups.map(f => f.order_id))),
    rowsById<{ id: string; completed_at: string | null; scheduled_at: string | null; created_at: string }>('interactions', 'id, completed_at, scheduled_at, created_at', ids(followups.map(f => f.source_interaction_id))),
    rowsById<{ id: string; title: string; start_at: string }>('appointments', 'id, title, start_at', ids(followups.map(f => f.appointment_id))),
  ])

  const result = new Map<string, FollowupOrigin>()
  for (const f of followups) {
    const journey = f.care_journey_id ? journeys.get(f.care_journey_id) : undefined
    const order = f.order_id ? orders.get(f.order_id) : undefined
    const interaction = f.source_interaction_id ? interactions.get(f.source_interaction_id) : undefined
    const appointment = f.appointment_id ? appointments.get(f.appointment_id) : undefined
    const stepDays = f.care_step_key?.match(/^d(\d+)$/)?.[1]

    if (journey) result.set(f.id, { kind: 'care', label: journey.label, step: stepDays ? `J+${stepDays}` : null, clientId: f.client_id })
    else if (order) result.set(f.id, { kind: 'order', product: order.product_name ?? '', date: order.order_date, clientId: f.client_id })
    else if (interaction) result.set(f.id, { kind: 'interaction', id: interaction.id, date: interaction.completed_at ?? interaction.scheduled_at ?? interaction.created_at, clientId: f.client_id })
    else if (appointment) result.set(f.id, { kind: 'appointment', id: appointment.id, title: appointment.title, date: appointment.start_at })
    else if (f.automation_rule_id || f.auto_generated) result.set(f.id, { kind: 'automatic', date: f.created_at })
    else result.set(f.id, { kind: 'manual', date: f.created_at })
  }
  return result
}
