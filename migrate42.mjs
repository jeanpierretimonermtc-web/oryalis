import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})
const sql = await readFile(
  new URL('./supabase/migrations/20260729_relationship_model.sql', import.meta.url),
  'utf8',
)

await client.connect()
try {
  await client.query('BEGIN')

  // Colonnes ajoutées en premier (idempotent, IF NOT EXISTS) pour permettre le comptage
  // préalable ci-dessous — le fichier .sql ré-applique le même ALTER plus loin (no-op).
  await client.query(`
    ALTER TABLE public.clients
      ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS manually_inactive boolean NOT NULL DEFAULT false;
  `)

  const { rows: [vip] }      = await client.query(`SELECT count(*)::int AS n FROM clients WHERE status = 'vip' AND is_vip = false`)
  const { rows: [inactive] } = await client.query(`SELECT count(*)::int AS n FROM clients WHERE status = 'inactive' AND manually_inactive = false`)
  const { rows: [advisor] }  = await client.query(`SELECT count(*)::int AS n FROM clients WHERE status = 'advisor' AND contact_role = 'customer'`)
  const { rows: [leader] }   = await client.query(`
    SELECT count(*)::int AS n FROM clients c WHERE c.status = 'advisor' AND c.contact_role = 'customer'
      AND EXISTS (SELECT 1 FROM clients c2 WHERE c2.sponsor_id = c.id)`)
  console.log(`Lignes à mettre à jour — is_vip: ${vip.n}, manually_inactive: ${inactive.n}, ` +
    `advisor→contact_role: ${advisor.n} (${leader.n} → leader, ${advisor.n - leader.n} → distributor)`)

  await client.query(sql)

  if (process.env.MIGRATION_DRY_RUN === '1') {
    await client.query('ROLLBACK')
    console.log('Migration 42 validée (simulation annulée).')
  } else {
    await client.query('COMMIT')
    console.log('Migration 42 terminée : is_vip / manually_inactive ajoutés ; advisor replié dans contact_role.')
  }
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
