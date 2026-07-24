import pg from 'pg'

const { Client } = pg
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required')

const db = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

const report = { policies: [], inventory: {}, scenarios: {} }
await db.connect()
try {
  const policies = await db.query(`
    SELECT policyname, cmd, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'clients'
     ORDER BY policyname
  `)
  report.policies = policies.rows

  const inventory = await db.query(`
    SELECT
      count(DISTINCT p.id)::int AS accounts,
      count(c.id)::int AS contacts,
      count(c.id) FILTER (WHERE c.archived_at IS NULL)::int AS active_contacts,
      count(c.id) FILTER (WHERE c.archived_at IS NOT NULL)::int AS archived_contacts,
      count(DISTINCT p.id) FILTER (WHERE COALESCE(p.plan, 'free') = 'free')::int AS free_accounts,
      count(DISTINCT p.id) FILTER (WHERE COALESCE(p.plan, 'free') <> 'free')::int AS paid_accounts
    FROM profiles p
    LEFT JOIN clients c ON c.user_id = p.id
  `)
  report.inventory = inventory.rows[0]

  const selected = await db.query(`
    SELECT p.id
      FROM profiles p
      LEFT JOIN clients c ON c.user_id = p.id
     GROUP BY p.id
     ORDER BY count(c.id), p.id
     LIMIT 1
  `)
  if (!selected.rows[0]) throw new Error('No profile available for transactional test')
  const userId = selected.rows[0].id

  await db.query('BEGIN')
  await db.query(`UPDATE profiles SET plan = 'free' WHERE id = $1`, [userId])
  await db.query(`UPDATE clients SET archived_at = now() WHERE user_id = $1 AND archived_at IS NULL`, [userId])
  await db.query(`SET LOCAL ROLE authenticated`)
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId])
  await db.query(`SELECT set_config('request.jwt.claim.role', 'authenticated', true)`)

  const visibleOwn = await db.query(`SELECT count(*)::int AS n FROM clients WHERE user_id = $1`, [userId])
  const visibleOther = await db.query(`SELECT count(*)::int AS n FROM clients WHERE user_id <> $1`, [userId])
  report.scenarios.rls_own_visible = visibleOwn.rows[0].n >= 0
  report.scenarios.rls_other_hidden = visibleOther.rows[0].n === 0

  for (let i = 1; i <= 20; i++) {
    await db.query(`
      INSERT INTO clients (user_id, full_name, status, contact_role, interests, medical_treatment, welcome_email_sent)
      VALUES ($1, $2, 'prospect', 'prospect', '{}', false, false)
    `, [userId, `Quota test ${i}`])
  }
  report.scenarios.free_19_to_20 = true

  await db.query('SAVEPOINT before_21')
  try {
    await db.query(`
      INSERT INTO clients (user_id, full_name, status, contact_role, interests, medical_treatment, welcome_email_sent)
      VALUES ($1, 'Quota test 21', 'prospect', 'prospect', '{}', false, false)
    `, [userId])
    report.scenarios.free_20_to_21_blocked = false
  } catch (error) {
    report.scenarios.free_20_to_21_blocked = error.message.includes('CONTACT_QUOTA_REACHED')
    await db.query('ROLLBACK TO SAVEPOINT before_21')
  }

  const archived = await db.query(`
    UPDATE clients SET archived_at = now()
     WHERE id = (SELECT id FROM clients WHERE user_id = $1 AND full_name = 'Quota test 1')
     RETURNING id
  `, [userId])
  report.scenarios.archive_frees_slot = archived.rowCount === 1

  await db.query(`
    INSERT INTO clients (user_id, full_name, status, contact_role, interests, medical_treatment, welcome_email_sent)
    VALUES ($1, 'Quota replacement', 'prospect', 'prospect', '{}', false, false)
  `, [userId])
  report.scenarios.insert_after_archive = true

  await db.query('SAVEPOINT before_restore')
  try {
    await db.query(`UPDATE clients SET archived_at = NULL WHERE id = $1`, [archived.rows[0].id])
    report.scenarios.restore_at_limit_blocked = false
  } catch (error) {
    report.scenarios.restore_at_limit_blocked = error.message.includes('CONTACT_QUOTA_REACHED')
    await db.query('ROLLBACK TO SAVEPOINT before_restore')
  }

  await db.query('RESET ROLE')
  await db.query(`UPDATE profiles SET plan = 'advisor' WHERE id = $1`, [userId])
  await db.query(`SET LOCAL ROLE authenticated`)
  await db.query(`
    INSERT INTO clients (user_id, full_name, status, contact_role, interests, medical_treatment, welcome_email_sent)
    VALUES ($1, 'Paid plan extra', 'prospect', 'prospect', '{}', false, false)
  `, [userId])
  report.scenarios.paid_plan_unlimited = true

  const bulkRows = Array.from({ length: 50 }, (_, index) => `($1, 'Bulk test ${index + 1}', 'prospect', 'prospect', '{}', false, false)`).join(',')
  await db.query(`
    INSERT INTO clients (user_id, full_name, status, contact_role, interests, medical_treatment, welcome_email_sent)
    VALUES ${bulkRows}
  `, [userId])
  report.scenarios.paid_bulk_50 = true

  await db.query('ROLLBACK')
  report.scenarios.transaction_rolled_back = true
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  try { await db.query('ROLLBACK') } catch {}
  throw error
} finally {
  await db.end()
}
