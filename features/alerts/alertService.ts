import { supabase } from '@/shared/lib/supabase'
import type { Alert } from '@/shared/lib/types'

export async function fetchUnreadAlerts(userId: string): Promise<Alert[]> {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('read', false)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function markAlertRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('alerts')
    .update({ read: true })
    .eq('id', id)
  if (error) throw new Error(error.message)
}

export async function markAllAlertsRead(userId: string): Promise<void> {
  const { error } = await supabase
    .from('alerts')
    .update({ read: true })
    .eq('user_id', userId)
    .eq('read', false)
  if (error) throw new Error(error.message)
}

export async function computeAndSaveAlerts(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const todayStart = today + 'T00:00:00.000Z'

  // Already-created alerts today → dedup key = "type:client_id"
  const { data: todayAlerts } = await supabase
    .from('alerts')
    .select('type, client_id')
    .eq('user_id', userId)
    .gte('created_at', todayStart)

  const existing = new Set(
    (todayAlerts ?? []).map(a => `${a.type}:${a.client_id ?? ''}`)
  )

  type NewAlert = Omit<Alert, 'id' | 'created_at'>
  const toInsert: NewAlert[] = []

  function add(a: NewAlert) {
    const key = `${a.type}:${a.client_id ?? ''}`
    if (!existing.has(key)) toInsert.push(a)
  }

  // ── Rule 1 — prospect_forgotten (>7j sans contact) ──────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const { data: forgotten } = await supabase
    .from('clients')
    .select('id, full_name')
    .eq('user_id', userId)
    .is('archived_at', null)
    .in('status', ['prospect', 'new_client'])
    .or(`last_interaction_at.lt.${sevenDaysAgo},last_interaction_at.is.null`)
    .limit(10)

  for (const c of forgotten ?? []) {
    add({
      user_id:    userId,
      type:       'prospect_forgotten',
      client_id:  c.id,
      message:    `${c.full_name} — prospect sans contact depuis plus de 7 jours`,
      action_url: `/(app)/clients/${c.id}/followups`,
      read:       false,
    })
  }

  // ── Rule 2 — client_inactive (pas de commande depuis >45j) ──────────────────
  const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86400000).toISOString().split('T')[0]
  const { data: recentOrders } = await supabase
    .from('orders')
    .select('client_id')
    .eq('user_id', userId)
    .gte('order_date', fortyFiveDaysAgo)

  const recentClientIds = new Set((recentOrders ?? []).map(o => o.client_id).filter(Boolean))

  const { data: activeClients } = await supabase
    .from('clients')
    .select('id, full_name')
    .eq('user_id', userId)
    .is('archived_at', null)
    .in('status', ['active', 'loyal', 'vip'])
    .limit(30)

  for (const c of activeClients ?? []) {
    if (!recentClientIds.has(c.id)) {
      add({
        user_id:    userId,
        type:       'client_inactive',
        client_id:  c.id,
        message:    `${c.full_name} — pas de commande depuis plus de 45 jours`,
        action_url: `/(app)/clients/${c.id}/orders`,
        read:       false,
      })
    }
  }

  // ── Rule 3 — lrp_due (LRP dans <5 jours) ────────────────────────────────────
  const fiveDaysLater = new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0]
  const { data: lrpClients } = await supabase
    .from('clients')
    .select('id, full_name, next_lrp_date')
    .eq('user_id', userId)
    .is('archived_at', null)
    .gte('next_lrp_date', today)
    .lte('next_lrp_date', fiveDaysLater)
    .limit(10)

  for (const c of lrpClients ?? []) {
    const daysUntil = Math.ceil(
      (new Date(c.next_lrp_date).getTime() - Date.now()) / 86400000
    )
    add({
      user_id:    userId,
      type:       'lrp_due',
      client_id:  c.id,
      message:    `${c.full_name} — LRP dans ${daysUntil} jour${daysUntil > 1 ? 's' : ''}`,
      action_url: `/(app)/clients/${c.id}`,
      read:       false,
    })
  }

  // ── Rule 4 — distributor_dormant (module downline requis) ────────────────────
  const { data: bizProfile } = await supabase
    .from('user_business_profiles')
    .select('active_modules')
    .eq('user_id', userId)
    .single()

  const downlineActive = !bizProfile || (bizProfile.active_modules as string[]).includes('downline')

  if (downlineActive) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data: dormant } = await supabase
      .from('clients')
      .select('id, full_name')
      .eq('user_id', userId)
      .is('archived_at', null)
      .in('contact_role', ['distributor', 'leader'])
      .or(`last_interaction_at.lt.${thirtyDaysAgo},last_interaction_at.is.null`)
      .limit(10)

    for (const c of dormant ?? []) {
      add({
        user_id:    userId,
        type:       'distributor_dormant',
        client_id:  c.id,
        message:    `${c.full_name} — distributeur sans activité depuis plus de 30 jours`,
        action_url: `/(app)/clients/${c.id}`,
        read:       false,
      })
    }
  }

  // ── Rule 5 — followup_overdue (relances en retard, max 5) ────────────────────
  const { data: overdueFollowups } = await supabase
    .from('followups')
    .select('id, client_id, title, content, client:clients(full_name)')
    .eq('user_id', userId)
    .eq('done', false)
    .lt('due_date', today)
    .order('due_date', { ascending: true })
    .limit(5)

  for (const f of overdueFollowups ?? []) {
    const clientName = (f.client as any)?.full_name ?? 'Client inconnu'
    add({
      user_id:    userId,
      type:       'followup_overdue',
      client_id:  f.client_id ?? null,
      message:    `${clientName} — ${f.title ?? f.content ?? 'Relance en retard'}`,
      action_url: f.client_id ? `/(app)/clients/${f.client_id}/followups` : null,
      read:       false,
    })
  }

  // ── Rule 6 — leader_emerging (distributeur avec ≥3 filleuls ce mois) ────────
  const thirtyDaysAgoRecruit = new Date(Date.now() - 30 * 86400000).toISOString()

  // Fetch recent filleuls (created in last 30 days, relevant roles)
  const { data: recentFilleuls } = await supabase
    .from('clients')
    .select('sponsor_id, contact_role')
    .eq('user_id', userId)
    .not('sponsor_id', 'is', null)
    .in('contact_role', ['distributor', 'customer'])
    .gte('created_at', thirtyDaysAgoRecruit)

  // Count filleuls per sponsor
  const sponsorCounts = new Map<string, number>()
  for (const f of recentFilleuls ?? []) {
    if (f.sponsor_id) {
      sponsorCounts.set(f.sponsor_id, (sponsorCounts.get(f.sponsor_id) ?? 0) + 1)
    }
  }

  const emergingIds = [...sponsorCounts.entries()]
    .filter(([, n]) => n >= 3)
    .map(([id]) => id)

  if (emergingIds.length > 0) {
    // Fetch these distributors
    const { data: emerging } = await supabase
      .from('clients')
      .select('id, full_name')
      .eq('user_id', userId)
      .in('id', emergingIds)

    // 7-day dedup (stricter than daily dedup for this alert type)
    const sevenDaysAgoLeader = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: recentLeaderAlerts } = await supabase
      .from('alerts')
      .select('client_id')
      .eq('user_id', userId)
      .eq('type', 'leader_emerging')
      .gte('created_at', sevenDaysAgoLeader)

    const recentLeaderIds = new Set(
      (recentLeaderAlerts ?? []).map(a => a.client_id).filter(Boolean)
    )

    for (const dist of emerging ?? []) {
      if (!recentLeaderIds.has(dist.id)) {
        const count = sponsorCounts.get(dist.id) ?? 0
        toInsert.push({
          user_id:    userId,
          type:       'leader_emerging',
          client_id:  dist.id,
          message:    `${dist.full_name} a recruté ${count} nouveaux contacts ce mois — potentiel leader à accompagner`,
          action_url: `/(app)/clients/${dist.id}`,
          read:       false,
        })
      }
    }
  }

  if (toInsert.length > 0) {
    await supabase.from('alerts').insert(toInsert)
  }
}
