// migrate6.mjs — Phase 1: fix followups.content schema cache + profiles.onboarding_completed
import pg from 'pg'
const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()
try {
console.log('Connected.')

// 1. Add followups.content as nullable TEXT (column was missing from DB)
await client.query(`
  ALTER TABLE followups
    ADD COLUMN IF NOT EXISTS content text DEFAULT NULL
`)
console.log('✅ followups.content column added (nullable text)')

// 2. Add onboarding_completed to profiles
await client.query(`
  ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false
`)
console.log('✅ profiles.onboarding_completed added')

// 3. Reload PostgREST schema cache
await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✅ PostgREST schema cache reloaded')

  console.log('Done.')
} finally {
  await client.end()
}
