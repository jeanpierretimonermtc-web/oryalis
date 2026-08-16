// migrate17.mjs — MLM Sprint 2 : colonnes relance intelligente sur followups
// Ajoute : prospect_temperature, pipeline_stage, product_context, auto_generated, priority_score
// Run : SUPABASE_DB_PASSWORD=xxx node migrate17.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

// ── 1. Colonnes relance intelligente sur followups ────────────────────────────
await client.query(`
  ALTER TABLE followups
    ADD COLUMN IF NOT EXISTS prospect_temperature text,
    ADD COLUMN IF NOT EXISTS pipeline_stage       text,
    ADD COLUMN IF NOT EXISTS product_context      text,
    ADD COLUMN IF NOT EXISTS auto_generated       boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS priority_score       integer
`)
console.log('✓ followups : 5 colonnes ajoutées (temperature, pipeline, product, auto, score)')

// ── 2. Index sur priority_score pour le tri des relances intelligentes ────────
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_followups_priority ON followups(user_id, priority_score DESC NULLS LAST)
`)
console.log('✓ Index idx_followups_priority créé')

// ── 3. Reload PostgREST schema cache ─────────────────────────────────────────
await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 17 terminée — followups enrichis pour relance intelligente')
console.log('   Prochaine étape : ÉTAPE 7 (vue Relances intelligentes)')
