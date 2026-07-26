import { supabase } from '@/shared/lib/supabase'

// ── Date helpers — always relative to today ───────────────────────────────────

function dt(daysOffset: number, hour = 10, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

function dateStr(daysOffset: number): string {
  return new Date(Date.now() + daysOffset * 86400000).toISOString().split('T')[0]
}

function period(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// ── Guard ─────────────────────────────────────────────────────────────────────

export async function getDemoClientsCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source', 'demo')
  if (error) throw error
  return count ?? 0
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadDemoData(userId: string): Promise<void> {
  const existing = await getDemoClientsCount(userId)
  if (existing > 0) return

  // ── 1. Clients (réseau MLM doTERRA à 2 niveaux) ──────────────────────────

  const { data: insertedClients, error: clientsErr } = await supabase
    .from('clients')
    .insert([
      // Niveau 1 — distributeurs directs
      {
        user_id: userId, source: 'demo',
        first_name: 'Emma', full_name: 'Emma Dupont',
        email: 'emma.dupont@gmail.com', phone: '06 11 22 33 44',
        status: 'active', contact_role: 'distributor',
        profession: 'Professeure', language: 'fr',
        inscription_date: dateStr(-120),
        interests: ['Huiles essentielles', 'LRP', 'Bien-être famille'],
        doterra_id: 'DT-48291', next_lrp_date: dateStr(3),
        welcome_email_sent: true, medical_treatment: false,
        referrals_count: 2, referral_count: 2,
        network_potential: 'high',
      },
      {
        user_id: userId, source: 'demo',
        first_name: 'Thomas', full_name: 'Thomas Petit',
        email: 'thomas.petit@outlook.fr', phone: '06 55 44 33 22',
        status: 'active', contact_role: 'distributor',
        profession: 'Kinésithérapeute', language: 'fr',
        inscription_date: dateStr(-90),
        interests: ['Nutrition', 'Sport', 'Récupération'],
        doterra_id: 'DT-59283',
        welcome_email_sent: true, medical_treatment: false,
        referrals_count: 2, referral_count: 2,
        network_potential: 'medium',
      },
      // Niveau 2 — filleuls d'Emma
      {
        user_id: userId, source: 'demo',
        first_name: 'Marie', full_name: 'Marie Leblanc',
        email: 'marie.leblanc@yahoo.fr', phone: '07 88 77 66 55',
        status: 'active', contact_role: 'customer',
        profession: 'Infirmière', language: 'fr',
        inscription_date: dateStr(-60),
        interests: ['Stress', 'Sommeil', 'Immunité'],
        doterra_id: 'DT-67432', next_lrp_date: dateStr(12),
        welcome_email_sent: true, medical_treatment: false,
        referrals_count: 0, referral_count: 0,
      },
      {
        user_id: userId, source: 'demo',
        first_name: 'Lucas', full_name: 'Lucas Bernard',
        email: 'lucas.bernard@gmail.com', phone: '06 99 88 77 66',
        status: 'inactive', contact_role: 'distributor',
        profession: 'Commercial', language: 'fr',
        inscription_date: dateStr(-150),
        interests: ['Énergie', 'Nutrition', 'Sport'],
        welcome_email_sent: true, medical_treatment: false,
        referrals_count: 0, referral_count: 0,
        network_potential: 'low',
      },
      // Niveau 2 — filleuls de Thomas
      {
        user_id: userId, source: 'demo',
        first_name: 'Julie', full_name: 'Julie Moreau',
        email: 'julie.moreau@gmail.com', phone: '06 33 22 11 00',
        status: 'prospect', contact_role: 'prospect',
        profession: 'Comptable', language: 'fr',
        inscription_date: dateStr(-8),
        interests: ['Bien-être', 'Huiles essentielles', 'Détox'],
        welcome_email_sent: false, medical_treatment: false,
        referrals_count: 0, referral_count: 0,
      },
      {
        user_id: userId, source: 'demo',
        first_name: 'David', full_name: 'David Leroy',
        email: 'd.leroy@work.fr', phone: '07 44 55 66 77',
        status: 'active', contact_role: 'customer',
        profession: 'Ingénieur', language: 'fr',
        inscription_date: dateStr(-45),
        interests: ['Concentration', 'Productivité', 'Énergie'],
        doterra_id: 'DT-72918',
        welcome_email_sent: true, medical_treatment: false,
        referrals_count: 0, referral_count: 0,
      },
      // Prospects directs
      {
        user_id: userId, source: 'demo',
        first_name: 'Amandine', full_name: 'Amandine Ferreira',
        email: 'amandine.f@gmail.com', phone: '06 77 88 99 00',
        status: 'prospect', contact_role: 'prospect',
        profession: 'Coach sportive', language: 'fr',
        inscription_date: dateStr(-6),
        interests: ['Performance', 'Récupération', 'Énergie'],
        welcome_email_sent: false, medical_treatment: false,
        referrals_count: 0, referral_count: 0,
        network_potential: 'high',
      },
      // Cliente VIP
      {
        user_id: userId, source: 'demo',
        first_name: 'Isabelle', full_name: 'Isabelle Vidal',
        email: 'isabelle.vidal@free.fr', phone: '06 22 33 44 55',
        status: 'vip', contact_role: 'customer',
        profession: 'Médecin', language: 'fr',
        inscription_date: dateStr(-365),
        interests: ['Immunité', 'Bien-être famille', 'LRP', 'Huiles pures'],
        doterra_id: 'DT-12934', next_lrp_date: dateStr(3),
        welcome_email_sent: true, medical_treatment: false,
        referrals_count: 3, referral_count: 3,
        network_potential: 'high',
      },
    ])
    .select('id, full_name')

  if (clientsErr || !insertedClients) throw clientsErr ?? new Error('clients insert failed')

  const [emmaId, thomasId, marieId, lucasId, julieId, davidId, amandineId, isabelleId] =
    insertedClients.map(c => c.id)

  // ── 2. Réseau — sponsor_id ────────────────────────────────────────────────
  await supabase.from('clients').update({ sponsor_id: emmaId   }).in('id', [marieId, lucasId])
  await supabase.from('clients').update({ sponsor_id: thomasId }).in('id', [julieId, davidId])

  // ── 3. Appointments (nouveau schéma) ──────────────────────────────────────
  const { data: insertedAppts, error: apptErr } = await supabase
    .from('appointments')
    .insert([
      // Emma — RDV découverte complété il y a 12j
      {
        user_id: userId, client_id: emmaId,
        title: 'Appel découverte — Emma Dupont',
        appointment_type: 'discovery_call', status: 'completed',
        start_at: dt(-12, 10), end_at: dt(-12, 11),
        timezone: 'Europe/Paris',
      },
      // Emma — Suivi complété il y a 5j
      {
        user_id: userId, client_id: emmaId,
        title: 'Suivi doTERRA — kit démarrage',
        appointment_type: 'follow_up', status: 'completed',
        start_at: dt(-5, 14), end_at: dt(-5, 15),
        timezone: 'Europe/Paris',
      },
      // Amandine — Présentation produit complétée il y a 2j
      {
        user_id: userId, client_id: amandineId,
        title: 'Présentation doTERRA — Amandine F.',
        appointment_type: 'product_presentation', status: 'completed',
        start_at: dt(-2, 11), end_at: dt(-2, 12),
        timezone: 'Europe/Paris',
      },
      // Isabelle — Suivi LRP complété il y a 28j
      {
        user_id: userId, client_id: isabelleId,
        title: 'Suivi LRP — Isabelle Vidal',
        appointment_type: 'follow_up', status: 'completed',
        start_at: dt(-28, 15), end_at: dt(-28, 16),
        timezone: 'Europe/Paris',
      },
      // Thomas — RDV aujourd'hui (planifié)
      {
        user_id: userId, client_id: thomasId,
        title: 'Point équipe — Thomas Petit',
        appointment_type: 'team_meeting', status: 'scheduled',
        start_at: dt(0, 14, 30), end_at: dt(0, 15, 30),
        timezone: 'Europe/Paris',
      },
      // Julie — Présentation planifiée dans 3j
      {
        user_id: userId, client_id: julieId,
        title: 'Présentation doTERRA — Julie Moreau',
        appointment_type: 'product_presentation', status: 'scheduled',
        start_at: dt(3, 10), end_at: dt(3, 11),
        timezone: 'Europe/Paris',
      },
    ])
    .select('id, client_id')

  if (apptErr || !insertedAppts) throw apptErr ?? new Error('appointments insert failed')

  const apptEmmaDisc   = insertedAppts[0].id
  const apptAmandine   = insertedAppts[2].id
  const apptIsabelle   = insertedAppts[3].id

  // ── 4. Appointment notes + business context ───────────────────────────────

  await supabase.from('appointment_notes').insert([
    {
      appointment_id: apptEmmaDisc,
      client_notes: 'Emma très enthousiaste. Déjà utilisatrice doTERRA depuis 6 mois. Veut démarrer une activité.',
      internal_notes: 'Profil leader potentiel. Réseau social fort (professeure). Bien briefer sur la duplication.',
      needs_identified: 'Revenu complémentaire, flexibilité, produits naturels pour famille',
      products_discussed: 'Kit Famille, Copaiba, Deep Blue, On Guard',
      objections: 'Manque de temps, peur de déranger ses proches',
    },
    {
      appointment_id: apptAmandine,
      client_notes: 'Coach sportive très intéressée par Deep Blue et MetaPWR. Veut tester avant commande.',
      internal_notes: 'Très chaude. Réseau sportif = levier de recrutement fort.',
      needs_identified: 'Récupération musculaire, énergie durable, performance',
      products_discussed: 'Deep Blue Rub, MetaPWR, xEO Mega',
      objections: 'Prix — trouver financement via premiers clients',
    },
  ])

  await supabase.from('appointment_business_context').insert([
    {
      appointment_id: apptEmmaDisc,
      pipeline_stage: 'customer',
      prospect_temperature: 'hot',
      commercial_intent: 'become_distributor',
      estimated_value: 250,
      currency: 'EUR',
    },
    {
      appointment_id: apptAmandine,
      pipeline_stage: 'proposal_sent',
      prospect_temperature: 'very_hot',
      commercial_intent: 'buy_product',
      estimated_value: 180,
      currency: 'EUR',
    },
    {
      appointment_id: apptIsabelle,
      pipeline_stage: 'customer',
      prospect_temperature: 'warm',
      commercial_intent: 'buy_product',
      estimated_value: 120,
      currency: 'EUR',
    },
  ])

  // ── 5. Notes ──────────────────────────────────────────────────────────────
  await supabase.from('notes').insert([
    {
      user_id: userId, client_id: emmaId,
      content: 'Leader naturelle. Réseau enseignant très solide. Lui envoyer le guide "démarrage distributeur" avant prochain appel.',
    },
    {
      user_id: userId, client_id: isabelleId,
      content: 'Cliente depuis 1 an. Commandes régulières LRP 120€/mois. A recommandé 3 nouveaux clients. VIP confirmée.',
    },
    {
      user_id: userId, client_id: lucasId,
      content: 'Plus de nouvelles depuis 2 mois. Profil motivé au départ. À relancer avec un nouveau produit.',
    },
    {
      user_id: userId, client_id: amandineId,
      content: 'Première rencontre via Instagram. Coach sportive avec 2k abonnés. Potentiel de recrutement excellent.',
    },
  ])

  // ── 6. Followups enrichis (avec température + pipeline + score) ───────────
  await supabase.from('followups').insert([
    {
      user_id: userId, client_id: amandineId,
      title: 'Relancer Amandine — très intéressée produits sportifs',
      due_date: dateStr(-2),  // EN RETARD
      done: false,
      prospect_temperature: 'very_hot',
      pipeline_stage: 'proposal_sent',
      product_context: 'Deep Blue Rub + MetaPWR',
      auto_generated: false,
      priority_score: 90,
    },
    {
      user_id: userId, client_id: julieId,
      title: 'Préparer présentation Julie — objections prix à anticiper',
      due_date: dateStr(1),
      done: false,
      prospect_temperature: 'hot',
      pipeline_stage: 'presentation_scheduled',
      product_context: 'Kit Bien-être Famille',
      auto_generated: false,
      priority_score: 65,
    },
    {
      user_id: userId, client_id: isabelleId,
      title: 'Préparer commande LRP Isabelle — dans 3 jours',
      due_date: dateStr(3),
      done: false,
      prospect_temperature: 'warm',
      pipeline_stage: 'customer',
      product_context: 'Copaiba, Deep Blue, On Guard 250ml',
      auto_generated: true,
      priority_score: 45,
    },
    // Relance automatique J+7 attendue après le "Suivi LRP" complété il y a 28j (non traitée) — EN RETARD
    {
      user_id: userId, client_id: isabelleId,
      title: 'Feedback RDV Isabelle — des questions ?',
      due_date: dateStr(-21),
      done: false,
      prospect_temperature: 'warm',
      pipeline_stage: 'customer',
      product_context: null,
      auto_generated: true,
      priority_score: 55,
    },
    {
      user_id: userId, client_id: lucasId,
      title: 'Réactiver Lucas — distributeur endormi depuis 2 mois',
      due_date: dateStr(5),
      done: false,
      prospect_temperature: 'cold',
      pipeline_stage: 'inactive',
      product_context: null,
      auto_generated: false,
      priority_score: 20,
    },
  ])

  // ── 7. Orders (historique commercial) ────────────────────────────────────
  await supabase.from('orders').insert([
    // Isabelle — LRP régulier ce mois
    {
      user_id: userId, client_id: isabelleId,
      product_name: 'LRP Isabelle — Copaiba + Deep Blue + On Guard',
      amount: 124.50, order_date: dateStr(-28),
      is_lrp: true, status: 'completed', currency: 'EUR',
      order_number: 'LRP-2024-IS-01',
    },
    // Marie — LRP
    {
      user_id: userId, client_id: marieId,
      product_name: 'LRP Marie — Kit Stress & Sommeil',
      amount: 89.90, order_date: dateStr(-15),
      is_lrp: true, status: 'completed', currency: 'EUR',
      order_number: 'LRP-2024-ML-01',
    },
    // Emma — commande démarrage
    {
      user_id: userId, client_id: emmaId,
      product_name: 'Kit Démarrage Distributeur — Emma',
      amount: 258.00, order_date: dateStr(-10),
      is_lrp: false, status: 'completed', currency: 'EUR',
      order_number: 'ORD-2024-ED-01',
    },
    // David — première commande
    {
      user_id: userId, client_id: davidId,
      product_name: 'MetaPWR + InTune + xEO Mega',
      amount: 147.00, order_date: dateStr(-5),
      is_lrp: false, status: 'completed', currency: 'EUR',
      order_number: 'ORD-2024-DL-01',
    },
    // Isabelle — commande ponctuelle
    {
      user_id: userId, client_id: isabelleId,
      product_name: 'Huile de Coco Fractionnée x2 + Correct-X',
      amount: 67.50, order_date: dateStr(-3),
      is_lrp: false, status: 'completed', currency: 'EUR',
      order_number: 'ORD-2024-IS-02',
    },
  ])

  // ── 8. Goals du mois ─────────────────────────────────────────────────────
  // current est calculé dynamiquement par computeCurrentValues()
  const p = period()
  await supabase.from('goals').upsert([
    { user_id: userId, period: p, metric: 'new_clients',      target: 5,    current: 0 },
    { user_id: userId, period: p, metric: 'new_distributors', target: 3,    current: 0 },
    { user_id: userId, period: p, metric: 'revenue',          target: 1000, current: 0 },
    { user_id: userId, period: p, metric: 'appointments',     target: 8,    current: 0 },
  ], { onConflict: 'user_id,period,metric' })
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteDemoData(userId: string): Promise<void> {
  const { data: demoClients, error: fetchErr } = await supabase
    .from('clients')
    .select('id')
    .eq('user_id', userId)
    .eq('source', 'demo')

  if (fetchErr) throw fetchErr
  if (!demoClients?.length) return

  const clientIds = demoClients.map(c => c.id)

  // Get appointment IDs for these clients (to clean related tables)
  const { data: demoAppts } = await supabase
    .from('appointments')
    .select('id')
    .eq('user_id', userId)
    .in('client_id', clientIds)

  const apptIds = (demoAppts ?? []).map(a => a.id)

  // Clean in dependency order (children first)
  if (apptIds.length > 0) {
    await supabase.from('appointment_tasks').delete().in('appointment_id', apptIds)
    await supabase.from('appointment_notes').delete().in('appointment_id', apptIds)
    await supabase.from('appointment_business_context').delete().in('appointment_id', apptIds)
  }

  await supabase.from('recommendations').delete().in('client_id', clientIds)
  await supabase.from('orders').delete().in('client_id', clientIds)
  await supabase.from('followups').delete().in('client_id', clientIds)
  await supabase.from('notes').delete().in('client_id', clientIds)
  await supabase.from('appointments').delete().in('client_id', clientIds)
  await supabase.from('alerts').delete().eq('user_id', userId)
  await supabase.from('goals').delete().eq('user_id', userId).eq('period', period())

  const { error: clientErr } = await supabase
    .from('clients')
    .delete()
    .in('id', clientIds)

  if (clientErr) throw clientErr
}
