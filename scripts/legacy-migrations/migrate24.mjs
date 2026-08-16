// migrate24.mjs — Google Calendar : tokens OAuth + mapping événements
// Run : SUPABASE_DB_PASSWORD=xxx node migrate24.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

// ── 1. Tokens OAuth Google ────────────────────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS google_calendar_tokens (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    access_token  text NOT NULL,
    refresh_token text,
    expires_at    timestamptz,
    scope         text,
    token_type    text DEFAULT 'Bearer',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id)
  )
`)
console.log('✓ Table google_calendar_tokens créée')

// ── 2. Mapping appointments ↔ Google Calendar events ─────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS google_calendar_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    appointment_id   uuid REFERENCES appointments(id) ON DELETE CASCADE,
    google_event_id  text NOT NULL,
    calendar_id      text NOT NULL DEFAULT 'primary',
    last_synced_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE(user_id, appointment_id),
    UNIQUE(user_id, google_event_id)
  )
`)
console.log('✓ Table google_calendar_events créée')

// ── 3. RLS ────────────────────────────────────────────────────────────────────
for (const table of ['google_calendar_tokens', 'google_calendar_events']) {
  await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = '${table}' AND policyname = '${table}_user'
      ) THEN
        CREATE POLICY ${table}_user ON ${table}
          USING (auth.uid() = user_id)
          WITH CHECK (auth.uid() = user_id);
      END IF;
    END $$
  `)
}
console.log('✓ RLS activé')

await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 24 terminée — Google Calendar')
