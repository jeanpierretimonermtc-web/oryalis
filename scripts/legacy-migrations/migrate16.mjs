// migrate16.mjs — MLM Sprint 1 : colonnes MLM sur la table orders existante
// Ajoute : order_number, is_lrp, products (jsonb)
// Run : SUPABASE_DB_PASSWORD=xxx node migrate16.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

// ── 1. Colonnes MLM sur orders ───────────────────────────────────────────────
await client.query(`
  ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS order_number text,
    ADD COLUMN IF NOT EXISTS is_lrp       boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS products     jsonb
`)
console.log('✓ orders : order_number + is_lrp + products ajoutés')

// ── 2. Index sur order_date pour les requêtes dashboard ──────────────────────
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_orders_user_order_date ON orders(user_id, order_date DESC)
`)
console.log('✓ Index idx_orders_user_order_date créé')

// ── 3. Reload PostgREST schema cache ─────────────────────────────────────────
await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 16 terminée — colonnes MLM sur orders')
console.log('   Prochaine étape : ÉTAPE 4 (écrans orders)')
