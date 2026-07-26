// migrate7.mjs — Ajoute profiles.specialty
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

await client.query(`
  ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS specialty text DEFAULT NULL
`)
console.log('✅ profiles.specialty added')

await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✅ PostgREST schema cache reloaded')

  console.log('Done.')
} finally {
  await client.end()
}
