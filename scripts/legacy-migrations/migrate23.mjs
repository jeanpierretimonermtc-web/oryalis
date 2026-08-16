// migrate23.mjs — Configuration CRM : profil d'activité + libellés personnalisés
// Run : SUPABASE_DB_PASSWORD=xxx node migrate23.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

// ── 1. Profil d'activité utilisateur ─────────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS user_business_profiles (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    activity_type     text NOT NULL DEFAULT 'generic',
    custom_brand_name text,
    active_modules    text[] NOT NULL DEFAULT ARRAY[
      'products','renewals_lrp','downline','goals','calendar_sync'
    ],
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id)
  )
`)
console.log('✓ Table user_business_profiles créée')

// ── 2. Libellés personnalisés des statuts ─────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS user_status_labels (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status_key   text NOT NULL,
    custom_label text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, status_key)
  )
`)
console.log('✓ Table user_status_labels créée')

// ── 3. RLS ────────────────────────────────────────────────────────────────────
for (const table of ['user_business_profiles', 'user_status_labels']) {
  await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = '${table}_user_policy'
      ) THEN
        CREATE POLICY ${table}_user_policy ON ${table}
          USING  (auth.uid() = user_id)
          WITH CHECK (auth.uid() = user_id);
      END IF;
    END $$
  `)
}
console.log('✓ RLS activé sur les deux tables')

// ── 4. Reload schema ──────────────────────────────────────────────────────────
await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 23 terminée — profil d\'activité + libellés')
