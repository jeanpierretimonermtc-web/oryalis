import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg

const requiredEnv = [
  'SUPABASE_DB_HOST',
  'SUPABASE_DB_PORT',
  'SUPABASE_DB_NAME',
  'SUPABASE_DB_USER',
  'SUPABASE_DB_PASSWORD',
]

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing environment variable: ${key}`)
  }
}

const client = new Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})
const sql = await readFile(
  new URL('./supabase/migrations/20260805_followup_recommendation_cancellation.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existing] } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE (table_name = 'followups' AND column_name = 'cancelled_at')
       OR (table_name = 'recommendations' AND column_name = 'cancelled_at')
  `)
  if (existing.n >= 2) {
    throw new Error('followups.cancelled_at et recommendations.cancelled_at existent déjà — migration déjà appliquée.')
  }

  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 53 validée (simulation annulée) : cancelled_at prêt à être ajouté sur followups et recommendations.')
  } else {
    await client.query('COMMIT')
    console.log('Migration 53 terminée : cancelled_at ajouté sur followups et recommendations.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
