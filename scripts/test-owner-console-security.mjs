import pg from 'pg'

const { Client } = pg
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')
const db = new Client({ connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })

async function auth(userId, aal = 'aal1') {
  await db.query('SET LOCAL ROLE authenticated')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId])
  await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)")
  await db.query("SELECT set_config('request.jwt.claim.aal', $1, true)", [aal])
  await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated', aal })])
}

await db.connect()
try {
  const owner = await db.query("SELECT user_id FROM public.user_roles WHERE role = 'owner' LIMIT 1")
  const user = await db.query("SELECT id FROM public.profiles WHERE id <> $1 AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = profiles.id AND role = 'owner') LIMIT 1", [owner.rows[0].user_id])
  if (!owner.rowCount || !user.rowCount) throw new Error('Owner or test user missing')
  const ownerId = owner.rows[0].user_id
  const userId = user.rows[0].id

  await db.query('BEGIN')
  await auth(ownerId, 'aal2')
  const created = await db.query("SELECT (public.owner_request_support_access($1, 'account_diagnostics', 'Transactional consent test', 5)).id AS id", [userId])
  const requestId = created.rows[0].id
  await db.query('RESET ROLE')
  await auth(userId)
  await db.query('SELECT public.respond_to_support_access_request($1, true)', [requestId])
  await db.query('RESET ROLE')
  await auth(ownerId, 'aal2')
  const snapshot = await db.query('SELECT public.owner_get_support_snapshot($1) AS value', [requestId])
  if (snapshot.rows[0].value?.request_id !== requestId) throw new Error('Approved support snapshot unavailable')
  await db.query('RESET ROLE')
  await auth(userId)
  const revoked = await db.query('SELECT public.revoke_my_support_access($1) AS value', [requestId])
  if (!revoked.rows[0].value) throw new Error('User could not revoke support consent')
  await db.query('RESET ROLE')
  await auth(ownerId, 'aal2')
  let blocked = false
  await db.query('SAVEPOINT revoked_snapshot')
  try { await db.query('SELECT public.owner_get_support_snapshot($1)', [requestId]) }
  catch (error) { blocked = error.message.includes('ACTIVE_SUPPORT_CONSENT_REQUIRED'); await db.query('ROLLBACK TO SAVEPOINT revoked_snapshot') }
  if (!blocked) throw new Error('Revoked support consent still allowed access')
  await db.query('ROLLBACK')

  await db.query('BEGIN')
  const first = await db.query("SELECT public.record_security_login_event($1, 'install-a', 'ip-a', 'test', 'test') AS unusual", [userId])
  const second = await db.query("SELECT public.record_security_login_event($1, 'install-b', 'ip-b', 'test', 'test') AS unusual", [userId])
  if (first.rows[0].unusual || !second.rows[0].unusual) throw new Error('Unusual installation detection is incorrect')
  const alerts = await db.query("SELECT count(*)::int AS count FROM public.security_notifications WHERE recipient_user_id = $1 AND category = 'unusual_login'", [userId])
  if (alerts.rows[0].count < 1) throw new Error('Unusual login notification missing')
  await db.query('ROLLBACK')
  console.log('Tests réussis : consentement support temporaire/révocable et détection de nouvelle installation.')
} catch (error) {
  try { await db.query('ROLLBACK') } catch {}
  throw error
} finally { await db.end() }
