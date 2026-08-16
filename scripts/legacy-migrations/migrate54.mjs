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
  new URL('./supabase/migrations/20260805_lot1_2_1_reliability.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existing] } = await client.query(`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE (table_name = 'orders' AND column_name = 'closure_action_key')
       OR (table_name = 'recommendations' AND column_name = 'closure_action_key')
       OR (table_name = 'followups' AND column_name = 'closure_action_key')
  `)
  if (existing.n >= 3) {
    throw new Error('closure_action_key existe déjà sur les 3 tables — migration déjà appliquée.')
  }

  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 54 validée (simulation annulée) : CHECK client_events, closure_action_key, revise_appointment_outcome() prêts.')
  } else {
    await client.query('COMMIT')
    console.log('Migration 54 terminée : CHECK client_events étendu, closure_action_key ajouté, revise_appointment_outcome() créée.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
