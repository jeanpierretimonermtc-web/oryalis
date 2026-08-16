import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({ connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })
const sql = await readFile(new URL('./supabase/migrations/20260712_contact_activity_summary.sql', import.meta.url), 'utf8')

await client.connect()
try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  console.log('Migration 32 terminée : prochaine action et dernière interaction automatiques.')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
