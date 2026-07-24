import pg from 'pg'

const { Client } = pg
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const db = new Client({ connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })
const assert = (condition, message) => { if (!condition) throw new Error(message) }

await db.connect()
try {
  await db.query('BEGIN')
  const existing = await db.query('SELECT user_id FROM clients LIMIT 1')
  if (!existing.rowCount) throw new Error('Aucun contact disponible pour le test transactionnel.')
  const userId = existing.rows[0].user_id
  const created = await db.query(
    `INSERT INTO clients (user_id, full_name, status, contact_role, pipeline_stage)
     VALUES ($1, 'TEST activité Codex', 'prospect', 'prospect', 'new_lead') RETURNING id`, [userId])
  const clientId = created.rows[0].id
  const inTwoDays = new Date(Date.now() + 2 * 86400000)
  const inThreeDays = new Date(Date.now() + 3 * 86400000)
  const followup = await db.query(
    `INSERT INTO followups (user_id, client_id, title, due_date, done, action_type)
     VALUES ($1, $2, 'Test relance', CURRENT_DATE + 1, false, 'call') RETURNING id`, [userId, clientId])
  await db.query(
    `INSERT INTO interactions (user_id, client_id, interaction_type, scheduled_at)
     VALUES ($1, $2, 'whatsapp', $3)`, [userId, clientId, inTwoDays])
  await db.query(
    `INSERT INTO appointments (user_id, client_id, title, start_at, end_at)
     VALUES ($1, $2, 'Test rendez-vous', $3, $4)`,
    [userId, clientId, inThreeDays, new Date(inThreeDays.getTime() + 3600000)])

  let summary = (await db.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0]
  assert(summary.next_action_source === 'followup', 'La relance la plus proche aurait dû être sélectionnée.')
  await db.query('UPDATE followups SET done = true, updated_at = now() WHERE id = $1', [followup.rows[0].id])
  summary = (await db.query('SELECT * FROM clients WHERE id = $1', [clientId])).rows[0]
  assert(summary.next_action_source === 'interaction', "L'interaction aurait dû devenir la prochaine action.")
  assert(summary.last_interaction_at, 'La dernière interaction aurait dû être enregistrée.')
  await db.query('ROLLBACK')
  console.log('Tests réussis : priorité des 3 sources, terminaison, recalcul et dernière interaction.')
} catch (error) {
  await db.query('ROLLBACK')
  throw error
} finally {
  await db.end()
}
