import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})
const sql = await readFile(
  new URL('./supabase/migrations/20260802_client_events.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existing] } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'client_events'`
  )
  if (existing.n > 0) throw new Error('La table client_events existe déjà — migration déjà appliquée.')

  await client.query(sql)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 45 validée (simulation annulée) : table client_events prête à être créée.')
  } else {
    await client.query('COMMIT')
    console.log('Migration 45 terminée : table client_events créée (traçabilité pipeline/rôle/annulation/suppression RDV).')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
