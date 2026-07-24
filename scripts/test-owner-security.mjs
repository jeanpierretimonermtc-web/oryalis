import pg from 'pg'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const db = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

async function assumeAuthenticated(userId, aal = 'aal1') {
  await db.query('SET LOCAL ROLE authenticated')
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId])
  await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', true)")
  await db.query("SELECT set_config('request.jwt.claim.aal', $1, true)", [aal])
  await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated', aal })])
}

await db.connect()
try {
  const owner = await db.query("SELECT user_id FROM public.user_roles WHERE role = 'owner' LIMIT 1")
  if (!owner.rowCount) throw new Error('No owner configured')
  const ownerId = owner.rows[0].user_id

  const regular = await db.query(
    "SELECT id FROM public.profiles WHERE id <> $1 AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = profiles.id AND role = 'owner') LIMIT 1",
    [ownerId],
  )
  if (!regular.rowCount) throw new Error('No regular user available for permission tests')
  const regularId = regular.rows[0].id

  const planGrant = await db.query(`
    SELECT has_column_privilege('authenticated', 'public.profiles', 'plan', 'UPDATE') AS allowed
  `)
  if (planGrant.rows[0].allowed) throw new Error('authenticated can still update profiles.plan')

  await db.query('BEGIN')
  await assumeAuthenticated(regularId)

  let blocked = false
  await db.query('SAVEPOINT direct_plan_update')
  try {
    await db.query("UPDATE public.profiles SET plan = 'enterprise' WHERE id = $1", [regularId])
  } catch (error) {
    blocked = /permission denied|PROFILE_PLAN_ADMIN_ONLY/.test(error.message)
    await db.query('ROLLBACK TO SAVEPOINT direct_plan_update')
  }
  if (!blocked) throw new Error('A regular user changed profiles.plan')

  await db.query('UPDATE public.profiles SET updated_at = updated_at WHERE id = $1', [regularId])

  blocked = false
  await db.query('SAVEPOINT regular_owner_rpc')
  try {
    await db.query('SELECT * FROM public.owner_list_users(NULL, 10, 0)')
  } catch (error) {
    blocked = error.message.includes('OWNER_ROLE_REQUIRED')
    await db.query('ROLLBACK TO SAVEPOINT regular_owner_rpc')
  }
  if (!blocked) throw new Error('A regular user called an owner RPC')
  await db.query('ROLLBACK')

  await db.query('BEGIN')
  await assumeAuthenticated(ownerId, 'aal1')
  blocked = false
  await db.query('SAVEPOINT owner_without_mfa')
  try {
    await db.query('SELECT * FROM public.owner_list_users(NULL, 10, 0)')
  } catch (error) {
    blocked = error.message.includes('OWNER_MFA_REQUIRED')
    await db.query('ROLLBACK TO SAVEPOINT owner_without_mfa')
  }
  if (!blocked) throw new Error('An owner without AAL2 called an owner RPC')
  await db.query('ROLLBACK')

  await db.query('BEGIN')
  await assumeAuthenticated(ownerId, 'aal2')
  const ownerCheck = await db.query('SELECT public.is_app_owner() AS allowed')
  if (!ownerCheck.rows[0].allowed) throw new Error('Configured owner is not recognized')

  const users = await db.query('SELECT * FROM public.owner_list_users(NULL, 10, 0)')
  if (!users.rowCount) throw new Error('Owner cannot list users')

  const beforeAudit = await db.query('SELECT count(*)::int AS count FROM public.owner_list_admin_audit(500, 0)')
  await db.query(
    'SELECT * FROM public.owner_set_manual_subscription($1, true, NULL, $2)',
    [regularId, 'Transactional security test'],
  )
  const afterAudit = await db.query('SELECT count(*)::int AS count FROM public.owner_list_admin_audit(500, 0)')
  if (afterAudit.rows[0].count !== beforeAudit.rows[0].count + 1) {
    throw new Error('Owner action was not audited')
  }

  const revoked = await db.query(
    'SELECT * FROM public.owner_revoke_manual_subscription($1, $2)',
    [regularId, 'Transactional revoke test'],
  )
  if (revoked.rows[0]?.status !== 'expired') throw new Error('Owner cannot revoke manual access')

  await db.query(
    'SELECT public.owner_set_app_role($1, $2, $3)',
    [regularId, 'support', 'Transactional role test'],
  )
  const roleUsers = await db.query('SELECT * FROM public.owner_list_users(NULL, 200, 0) WHERE user_id = $1', [regularId])
  if (roleUsers.rows[0]?.app_role !== 'support') throw new Error('Owner cannot assign support role')
  const removed = await db.query('SELECT public.owner_remove_app_role($1, $2) AS removed', [regularId, 'Transactional role removal'])
  if (!removed.rows[0]?.removed) throw new Error('Owner cannot remove support role')

  blocked = false
  await db.query('SAVEPOINT last_owner_removal')
  try {
    await db.query('SELECT public.owner_remove_app_role($1, $2)', [ownerId, 'Must remain blocked'])
  } catch (error) {
    blocked = error.message.includes('LAST_OWNER_CANNOT_BE_REMOVED')
    await db.query('ROLLBACK TO SAVEPOINT last_owner_removal')
  }
  if (!blocked) throw new Error('The last owner could remove their own role')
  await db.query('ROLLBACK')

  await db.query('BEGIN')
  await db.query("UPDATE public.profiles SET plan = plan WHERE id = $1", [regularId])
  await db.query('ROLLBACK')

  console.log('Tests réussis : plan protégé, RPC owner isolées, abonnements et rôles administrables, dernier owner protégé et audit écrit.')
} catch (error) {
  try { await db.query('ROLLBACK') } catch {}
  throw error
} finally {
  await db.end()
}
