import pg from 'pg'

const { Client } = pg
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
if (!password) throw new Error('SUPABASE_DB_PASSWORD is required')
const db = new Client({ connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })

await db.connect()
try {
  const invalid = await db.query(`SELECT count(*)::int AS n FROM clients WHERE pipeline_stage IS NULL OR pipeline_stage NOT IN ('new_lead','contacted','presentation_scheduled','presentation_completed','follow_up','customer','distributor','lost')`)
  if (invalid.rows[0].n !== 0) throw new Error('Invalid canonical pipeline values found')

  const { rows: [profile] } = await db.query(`SELECT id FROM profiles ORDER BY created_at LIMIT 1`)
  if (!profile) throw new Error('No profile available')
  await db.query('BEGIN')
  const { rows: [contact] } = await db.query(`
    INSERT INTO clients (user_id, full_name, status, contact_role, pipeline_stage, interests, medical_treatment, welcome_email_sent)
    VALUES ($1, 'Pipeline transaction test', 'prospect', 'leader', 'new_lead', '{}', false, false)
    RETURNING id, contact_role
  `, [profile.id])
  const { rows: [appointment] } = await db.query(`
    INSERT INTO appointments (user_id, client_id, title, appointment_type, status, start_at, end_at, timezone)
    VALUES ($1, $2, 'Pipeline test', 'discovery_call', 'scheduled', now(), now() + interval '1 hour', 'Europe/Paris')
    RETURNING id
  `, [profile.id, contact.id])
  await db.query(`INSERT INTO appointment_business_context (appointment_id, pipeline_stage) VALUES ($1, 'proposal_sent')`, [appointment.id])
  let stage = await db.query(`SELECT pipeline_stage, contact_role FROM clients WHERE id = $1`, [contact.id])
  if (stage.rows[0].pipeline_stage !== 'follow_up') throw new Error('Appointment legacy mapping failed')
  if (stage.rows[0].contact_role !== 'leader') throw new Error('MLM role was unexpectedly changed')

  await db.query(`INSERT INTO followups (user_id, client_id, title, due_date, done, pipeline_stage) VALUES ($1, $2, 'Pipeline test', current_date, false, 'customer')`, [profile.id, contact.id])
  stage = await db.query(`SELECT pipeline_stage, contact_role FROM clients WHERE id = $1`, [contact.id])
  if (stage.rows[0].pipeline_stage !== 'customer') throw new Error('Followup synchronization failed')
  if (stage.rows[0].contact_role !== 'leader') throw new Error('MLM role was unexpectedly changed')
  await db.query('ROLLBACK')

  const counts = await db.query(`SELECT pipeline_stage, count(*)::int AS count FROM clients WHERE archived_at IS NULL GROUP BY pipeline_stage ORDER BY pipeline_stage`)
  console.log(JSON.stringify({ valid_values: true, appointment_sync: true, followup_sync: true, role_preserved: true, transaction_rolled_back: true, distribution: counts.rows }, null, 2))
} catch (error) {
  try { await db.query('ROLLBACK') } catch {}
  throw error
} finally {
  await db.end()
}

