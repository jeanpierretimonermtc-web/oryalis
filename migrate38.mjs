import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})
const sql = await readFile(
  new URL('./supabase/migrations/20260714_owner_console.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 38 validée (simulation annulée).')
  } else {
    await client.query('COMMIT')
    console.log('Migration 38 terminée : console owner, MFA, alertes et accès support.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
