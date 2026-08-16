// migrate8.mjs — Préférences catalogues : active_catalog_slugs sur profiles
// null = voir tous les catalogues officiels (comportement par défaut)
import pg from 'pg'
const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()
try {
console.log('Connected to Supabase')

await client.query(`
  ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active_catalog_slugs text[];
`)
console.log('✓ Colonne active_catalog_slugs sur profiles (null = tous les catalogues)')

  console.log('\n✅ Migration 8 terminée')
} finally {
  await client.end()
}
