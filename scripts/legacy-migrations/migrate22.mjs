// migrate22.mjs — Profil enrichi : photo, téléphone, bio, cabinet, ville, linkedin
// Run : SUPABASE_DB_PASSWORD=xxx node migrate22.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

await client.query(`
  ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS avatar_url   text,
    ADD COLUMN IF NOT EXISTS phone        text,
    ADD COLUMN IF NOT EXISTS website      text,
    ADD COLUMN IF NOT EXISTS bio          text,
    ADD COLUMN IF NOT EXISTS company      text,
    ADD COLUMN IF NOT EXISTS city         text,
    ADD COLUMN IF NOT EXISTS linkedin_url text
`)
console.log('✓ profiles : 7 colonnes ajoutées (avatar, phone, website, bio, company, city, linkedin)')

await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 22 terminée — profil enrichi')
