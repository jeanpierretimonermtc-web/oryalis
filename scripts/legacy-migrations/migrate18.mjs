// migrate18.mjs — MLM Sprint 2 : table alerts (opportunités détectées automatiquement)
// Run : SUPABASE_DB_PASSWORD=xxx node migrate18.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

// ── 1. Table alerts ───────────────────────────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS alerts (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type       text        NOT NULL,
    client_id  uuid        REFERENCES clients(id) ON DELETE CASCADE,
    message    text        NOT NULL,
    action_url text,
    read       boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )
`)
console.log('✓ Table alerts créée')

// ── 2. Index pour les requêtes courantes ──────────────────────────────────────
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_alerts_user_unread
    ON alerts(user_id, read, created_at DESC)
`)
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_alerts_dedup
    ON alerts(user_id, type, client_id, created_at)
`)
console.log('✓ Index alerts créés')

// ── 3. RLS ────────────────────────────────────────────────────────────────────
await client.query(`ALTER TABLE alerts ENABLE ROW LEVEL SECURITY`)
await client.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = 'alerts' AND policyname = 'alerts_user_policy'
    ) THEN
      CREATE POLICY alerts_user_policy ON alerts
        USING  (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
    END IF;
  END $$
`)
console.log('✓ RLS alerts activé')

// ── 4. Reload PostgREST schema cache ─────────────────────────────────────────
await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 18 terminée — table alerts')
console.log('   Prochaine étape : ÉTAPE 10 (écran réseau/downline)')
