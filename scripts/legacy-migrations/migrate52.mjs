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
  new URL('./supabase/migrations/20260805_appointment_outcome_lot1_2.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existing] } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE (table_name = 'appointment_business_context' AND column_name = 'outcome_revision')
       OR (table_name = 'followups' AND column_name = 'appointment_id')
       OR (table_name = 'orders' AND column_name = 'appointment_id')
       OR (table_name = 'recommendations' AND column_name = 'appointment_id')
       OR (table_name = 'appointments' AND column_name = 'followup_of_appointment_id')
  `)
  if (existing.n >= 5) {
    throw new Error('Colonnes du Lot 1.2 déjà présentes — migration déjà appliquée.')
  }

  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 52 validée (simulation annulée) : colonnes Lot 1.2 prêtes à être ajoutées.')
  } else {
    await client.query('COMMIT')
    console.log('Migration 52 terminée : colonnes Lot 1.2 ajoutées.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
