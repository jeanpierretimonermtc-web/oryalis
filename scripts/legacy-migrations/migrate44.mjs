import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})
const sql = await readFile(
  new URL('./supabase/migrations/20260731_first_order_automation.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  const { rows: [before] } = await client.query(
    `SELECT count(*)::int AS n FROM user_business_profiles WHERE 'auto_new_client' = ANY(active_modules)`
  )
  console.log(`Profils à mettre à jour (auto_new_client → auto_first_order) : ${before.n}`)

  await client.query(sql)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 44 validée (simulation annulée).')
  } else {
    await client.query('COMMIT')
    console.log('Migration 44 terminée : auto_new_client renommé en auto_first_order.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
