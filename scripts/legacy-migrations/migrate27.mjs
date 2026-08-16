// migrate27.mjs — Ajout colonne loyalty_notes sur clients
// Run : SUPABASE_DB_PASSWORD=xxx node migrate27.mjs

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
    ADD COLUMN IF NOT EXISTS loyalty_notes TEXT
`)
console.log('✓ Colonne loyalty_notes ajoutée sur clients')

await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 27 terminée — clients.loyalty_notes')
