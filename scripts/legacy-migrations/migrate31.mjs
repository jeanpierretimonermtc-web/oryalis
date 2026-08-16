// migrate31.mjs — Canonical client pipeline
// Run: node --env-file=.env.local migrate31.mjs
import pg from 'pg'
import { readFile } from 'fs/promises'

const { Client } = pg
const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('SUPABASE_DB_PASSWORD is required')
const client = new Client({ connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres` })

await client.connect()
try {
  const sql = await readFile(new URL('./supabase/migrations/20260712_canonical_pipeline.sql', import.meta.url), 'utf8')
  await client.query('BEGIN')
  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
  await client.query('COMMIT')
  console.log('Migration 31 complete: canonical client pipeline')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
