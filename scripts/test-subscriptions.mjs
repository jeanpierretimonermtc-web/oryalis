import pg from 'pg'

const { Client } = pg
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
if (!password) throw new Error('SUPABASE_DB_PASSWORD is required')
const db = new Client({ connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })

await db.connect()
try {
  const { rows: [profile] } = await db.query(`SELECT id, plan FROM profiles ORDER BY created_at LIMIT 1`)
  if (!profile) throw new Error('No test profile available')
  await db.query('BEGIN')
  await db.query(`INSERT INTO subscriptions (user_id, provider, status, plan, external_subscription_id, current_period_end)
    VALUES ($1, 'manual', 'active', 'advisor', $2, now() + interval '30 days')`, [profile.id, `test-${Date.now()}`])
  const synced = await db.query(`SELECT plan FROM profiles WHERE id = $1`, [profile.id])
  if (synced.rows[0]?.plan !== 'advisor' && !['leader', 'enterprise'].includes(synced.rows[0]?.plan)) throw new Error('Profile plan was not synchronized')

  await db.query('SET LOCAL ROLE authenticated')
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [profile.id])
  const own = await db.query(`SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1`, [profile.id])
  const others = await db.query(`SELECT count(*)::int AS n FROM subscriptions WHERE user_id <> $1`, [profile.id])
  if (own.rows[0].n < 1 || others.rows[0].n !== 0) throw new Error('Subscription RLS isolation failed')

  await db.query('SAVEPOINT client_write')
  let clientWriteBlocked = false
  try {
    await db.query(`INSERT INTO subscriptions (user_id, provider, status, plan) VALUES ($1, 'manual', 'active', 'advisor')`, [profile.id])
  } catch {
    clientWriteBlocked = true
    await db.query('ROLLBACK TO SAVEPOINT client_write')
  }
  if (!clientWriteBlocked) throw new Error('Authenticated client could write subscriptions')
  await db.query('ROLLBACK')
  console.log(JSON.stringify({ source_of_truth_sync: true, rls_own_read: true, rls_other_hidden: true, client_write_blocked: true, transaction_rolled_back: true }, null, 2))
} catch (error) {
  try { await db.query('ROLLBACK') } catch {}
  throw error
} finally {
  await db.end()
}

