import pg from 'pg'
const { Client } = pg
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const db = new Client({ connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })
await db.connect()
try {
  await db.query('BEGIN')
  const user = await db.query('SELECT id, plan FROM profiles LIMIT 1')
  if (!user.rowCount) throw new Error('Aucun profil disponible.')
  const userId = user.rows[0].id
  await db.query("UPDATE profiles SET plan = 'free' WHERE id = $1", [userId])
  let blocked = false
  await db.query('SAVEPOINT free_goal')
  try { await db.query("INSERT INTO goals(user_id, period, metric, target) VALUES ($1, '2099-12', 'revenue', 1)", [userId]) }
  catch (error) { blocked = error.message.includes('ADVISOR_PLAN_REQUIRED'); await db.query('ROLLBACK TO SAVEPOINT free_goal') }
  if (!blocked) throw new Error('Un compte Gratuit a pu écrire un objectif premium.')
  blocked = false
  await db.query('SAVEPOINT free_template')
  try { await db.query("INSERT INTO message_templates(user_id, category, name, body) VALUES ($1, 'prospection', 'Test', 'Bonjour')", [userId]) }
  catch (error) { blocked = error.message.includes('ADVISOR_PLAN_REQUIRED'); await db.query('ROLLBACK TO SAVEPOINT free_template') }
  if (!blocked) throw new Error('Un compte Gratuit a pu créer un modèle personnalisé.')
  await db.query('ROLLBACK')

  await db.query('BEGIN')
  await db.query("UPDATE profiles SET plan = 'advisor' WHERE id = $1", [userId])
  await db.query("INSERT INTO goals(user_id, period, metric, target) VALUES ($1, '2099-12', 'revenue', 1)", [userId])
  await db.query("INSERT INTO message_templates(user_id, category, name, body) VALUES ($1, 'prospection', 'Test', 'Bonjour')", [userId])
  await db.query('ROLLBACK')
  console.log('Tests réussis : écriture gratuite bloquée, écriture Conseiller autorisée, données annulées.')
} catch (error) { try { await db.query('ROLLBACK') } catch {}; throw error }
finally { await db.end() }
