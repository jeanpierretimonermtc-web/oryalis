// migrate15.mjs — MLM Sprint 1 : sponsor_id + contact_role sur clients
// Run : SUPABASE_DB_PASSWORD=xxx node migrate15.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

// ── 1. Colonnes MLM sur clients ──────────────────────────────────────────────
await client.query(`
  ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS sponsor_id   uuid REFERENCES clients(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS contact_role text NOT NULL DEFAULT 'customer'
`)
console.log('✓ clients : sponsor_id + contact_role ajoutés')

// ── 2. Index sur sponsor_id pour les requêtes réseau ─────────────────────────
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_clients_sponsor_id ON clients(sponsor_id)
`)
console.log('✓ Index idx_clients_sponsor_id créé')

// ── 3. Reload PostgREST schema cache ─────────────────────────────────────────
await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 15 terminée — sponsor_id + contact_role sur clients')
console.log('   Prochaine étape : node migrate15.mjs puis ÉTAPE 2 (écrans contact_role)')
