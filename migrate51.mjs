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

const ALLOWED_OUTCOMES = [
  'sale_completed', 'interested', 'follow_up_required',
  'not_interested', 'partner_potential', 'partner_recruited', 'other',
]

const client = new Client({
  host: process.env.SUPABASE_DB_HOST,
  port: Number(process.env.SUPABASE_DB_PORT),
  database: process.env.SUPABASE_DB_NAME,
  user: process.env.SUPABASE_DB_USER,
  password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
})
const sql = await readFile(
  new URL('./supabase/migrations/20260804_appointment_closure_guards.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existingColumn] } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'appointment_business_context' AND column_name = 'no_followup_required'`
  )
  const { rows: [existingConstraint] } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.table_constraints WHERE table_name = 'appointment_business_context' AND constraint_name = 'appointment_business_context_outcome_check'`
  )
  if (existingColumn.n > 0 && existingConstraint.n > 0) {
    throw new Error('appointment_business_context.no_followup_required et la contrainte outcome existent déjà — migration déjà appliquée.')
  }

  if (existingConstraint.n === 0) {
    const { rows: invalid } = await client.query(
      `SELECT DISTINCT outcome FROM appointment_business_context WHERE outcome IS NOT NULL AND outcome != ALL($1::text[])`,
      [ALLOWED_OUTCOMES],
    )
    if (invalid.length > 0) {
      throw new Error(`Valeurs outcome invalides détectées, migration arrêtée sans correction automatique : ${invalid.map(r => r.outcome).join(', ')}`)
    }
  }

  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 51 validée (simulation annulée) : no_followup_required + contrainte outcome prêtes à être ajoutées.')
  } else {
    await client.query('COMMIT')
    console.log('Migration 51 terminée : no_followup_required + contrainte outcome ajoutées.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
