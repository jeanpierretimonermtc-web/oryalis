import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})
const sql = await readFile(
  new URL('./supabase/migrations/20260804_lrp_program.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existing] } = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'lrp_status'`
  )
  if (existing.n > 0) throw new Error('clients.lrp_status existe déjà — migration déjà appliquée.')

  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 48 validée (simulation annulée) : colonnes du programme de fidélité prêtes.')
  } else {
    await client.query('COMMIT')
    console.log('Migration 48 terminée : programme de fidélité (statut, %, ancienneté, nom personnalisé) ajouté.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
