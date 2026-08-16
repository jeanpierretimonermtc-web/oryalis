import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})
const sql = await readFile(
  new URL('./supabase/migrations/20260802_client_avatar.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existing] } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'avatar_url'`
  )
  if (existing.n > 0) throw new Error('clients.avatar_url existe déjà — migration déjà appliquée.')

  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 46 validée (simulation annulée) : clients.avatar_url prête à être ajoutée.')
  } else {
    await client.query('COMMIT')
    console.log('Migration 46 terminée : clients.avatar_url ajoutée.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
