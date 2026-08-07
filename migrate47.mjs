import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})
const sql = await readFile(
  new URL('./supabase/migrations/20260804_role_pipeline_consistency.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [existing] } = await client.query(
    `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'sync_client_role_from_pipeline'`
  )
  if (existing.n > 0) throw new Error('sync_client_role_from_pipeline existe déjà — migration déjà appliquée.')

  const { rows: [before] } = await client.query(
    `SELECT count(*)::int AS n FROM public.clients WHERE contact_role = ARRAY['customer']::text[] AND pipeline_stage = 'new_lead'`
  )

  await client.query(sql)
  await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log(`Migration 47 validée (simulation annulée) : ${before.n} contact(s) à corriger, trigger prêt à être créé.`)
  } else {
    await client.query('COMMIT')
    console.log(`Migration 47 terminée : ${before.n} contact(s) corrigé(s), trigger de cohérence rôle/pipeline actif.`)
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
