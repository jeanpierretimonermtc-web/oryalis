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
  new URL('./supabase/migrations/20260804_appointment_outcome.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existing] } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'appointment_business_context' AND column_name = 'outcome'`
  )
  if (existing.n > 0) throw new Error('appointment_business_context.outcome existe déjà — migration déjà appliquée.')

  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 50 validée (simulation annulée) : appointment_business_context.outcome prête à être ajoutée.')
  } else {
    await client.query('COMMIT')
    console.log('Migration 50 terminée : appointment_business_context.outcome ajoutée.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
