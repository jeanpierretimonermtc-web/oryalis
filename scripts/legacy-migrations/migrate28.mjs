// migrate28.mjs — Table upline_nodes (ligne ascendante manuelle)
// Run : SUPABASE_DB_PASSWORD=xxx node migrate28.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

await client.query(`
  CREATE TABLE IF NOT EXISTS upline_nodes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name        TEXT NOT NULL,
    member_id   TEXT,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT now()
  )
`)
console.log('✓ Table upline_nodes créée')

await client.query(`ALTER TABLE upline_nodes ENABLE ROW LEVEL SECURITY`)

await client.query(`
  CREATE POLICY IF NOT EXISTS upline_nodes_own
    ON upline_nodes
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id)
`)
console.log('✓ RLS upline_nodes activé')

await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 28 terminée — upline_nodes')
