// migrate26.mjs — Ajout colonne address sur clients + renommage doterra_id label (code only)
// Run : SUPABASE_DB_PASSWORD=xxx node migrate26.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

await client.query(`
  ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS address TEXT
`)
console.log('✓ Colonne address ajoutée sur clients')

await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 26 terminée — clients.address')
