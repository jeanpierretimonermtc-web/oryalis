// migrate21.mjs — Sprint 6 : table goals (objectifs personnels)
// Run : SUPABASE_DB_PASSWORD=xxx node migrate21.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

await client.query(`
  CREATE TABLE IF NOT EXISTS goals (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    period     text        NOT NULL,
    metric     text        NOT NULL,
    target     integer     NOT NULL,
    current    integer     NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, period, metric)
  )
`)
console.log('✓ Table goals créée')

await client.query(`
  CREATE INDEX IF NOT EXISTS idx_goals_user_period ON goals(user_id, period)
`)
console.log('✓ Index idx_goals_user_period créé')

await client.query(`ALTER TABLE goals ENABLE ROW LEVEL SECURITY`)
await client.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = 'goals' AND policyname = 'goals_user_policy'
    ) THEN
      CREATE POLICY goals_user_policy ON goals
        USING  (auth.uid() = user_id)
        WITH CHECK (auth.uid() = user_id);
    END IF;
  END $$
`)
console.log('✓ RLS goals activé')

await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 21 terminée — table goals')
