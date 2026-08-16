// migrate13.mjs — CRM International Phase A
// Ajoute : colonnes clients/followups/recommendations, tables interactions + orders + RLS
// Run : SUPABASE_DB_PASSWORD=xxx node migrate13.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

// ── 1. Nouveaux champs sur clients ──────────────────────────────────────────
await client.query(`
  ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS country              text,
    ADD COLUMN IF NOT EXISTS first_contact_date   date,
    ADD COLUMN IF NOT EXISTS first_purchase_date  date,
    ADD COLUMN IF NOT EXISTS acquisition_source   text,
    ADD COLUMN IF NOT EXISTS journey_stage        text,
    ADD COLUMN IF NOT EXISTS next_action_date     date,
    ADD COLUMN IF NOT EXISTS next_action_type     text,
    ADD COLUMN IF NOT EXISTS referrals_count      int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS referral_count       int NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS network_potential    text
`)
console.log('✓ clients : 10 colonnes ajoutées')

// ── 2. Nouveau champ sur followups ──────────────────────────────────────────
await client.query(`
  ALTER TABLE followups
    ADD COLUMN IF NOT EXISTS action_type text
`)
console.log('✓ followups.action_type ajouté')

// ── 3. Nouveaux champs sur recommendations ──────────────────────────────────
await client.query(`
  ALTER TABLE recommendations
    ADD COLUMN IF NOT EXISTS quantity             int NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS objective            text,
    ADD COLUMN IF NOT EXISTS recommendation_date  timestamptz DEFAULT now()
`)
console.log('✓ recommendations : quantity, objective, recommendation_date ajoutés')

// ── 4. Table interactions ────────────────────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS interactions (
    id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id         uuid        NOT NULL REFERENCES clients(id)    ON DELETE CASCADE,
    interaction_type  text        NOT NULL,
    scheduled_at      timestamptz,
    completed_at      timestamptz,
    subject           text,
    summary           text,
    needs_identified  text,
    objections        text,
    interest_level    text,
    notes_brutes      text,
    ai_summary        text,
    ai_next_actions   text,
    ai_followup_draft text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz
  )
`)
console.log('✓ Table interactions créée')

await client.query(`ALTER TABLE interactions ENABLE ROW LEVEL SECURITY`)

await client.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'interactions' AND policyname = 'interactions_user_policy'
    ) THEN
      CREATE POLICY interactions_user_policy ON interactions
        USING  (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
    END IF;
  END $$
`)
console.log('✓ RLS interactions activé')

// ── 5. Table orders ──────────────────────────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS orders (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
    client_id    uuid        NOT NULL REFERENCES clients(id)           ON DELETE CASCADE,
    product_name text        NOT NULL,
    catalog_id   uuid        REFERENCES catalogs(id)                   ON DELETE SET NULL,
    product_id   uuid        REFERENCES catalog_products(id)           ON DELETE SET NULL,
    quantity     int         NOT NULL DEFAULT 1,
    amount       numeric(10,2),
    currency     text        NOT NULL DEFAULT 'EUR',
    order_date   timestamptz NOT NULL DEFAULT now(),
    status       text        NOT NULL DEFAULT 'pending',
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz
  )
`)
console.log('✓ Table orders créée')

await client.query(`ALTER TABLE orders ENABLE ROW LEVEL SECURITY`)

await client.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = 'orders' AND policyname = 'orders_user_policy'
    ) THEN
      CREATE POLICY orders_user_policy ON orders
        USING  (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
    END IF;
  END $$
`)
console.log('✓ RLS orders activé')

// ── 6. Reload PostgREST schema cache ────────────────────────────────────────
await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 13 terminée — Phase A CRM International')
console.log('   Prochaine étape : node migrate13.mjs puis valider Phase B (types + services)')
