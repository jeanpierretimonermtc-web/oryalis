// migrate5.mjs — Purge all demo data (duplicates cleanup)
// Run: node migrate5.mjs
import pg from 'pg'
const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()
try {
console.log('Connected.')

// Get all demo client IDs
const { rows: demoClients } = await client.query(
  `SELECT id FROM clients WHERE source = 'demo'`
)
console.log(`Found ${demoClients.length} demo client(s).`)

if (demoClients.length > 0) {
  const ids = demoClients.map(r => r.id)
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')

  const r1 = await client.query(`DELETE FROM recommendations WHERE client_id IN (${placeholders})`, ids)
  console.log(`  Deleted ${r1.rowCount} recommendations.`)

  const r2 = await client.query(`DELETE FROM followups WHERE client_id IN (${placeholders})`, ids)
  console.log(`  Deleted ${r2.rowCount} followups.`)

  const r3 = await client.query(`DELETE FROM notes WHERE client_id IN (${placeholders})`, ids)
  console.log(`  Deleted ${r3.rowCount} notes.`)

  const r4 = await client.query(`DELETE FROM appointments WHERE client_id IN (${placeholders})`, ids)
  console.log(`  Deleted ${r4.rowCount} appointments.`)

  const r5 = await client.query(`DELETE FROM clients WHERE id IN (${placeholders})`, ids)
  console.log(`  Deleted ${r5.rowCount} clients.`)

  console.log('All demo data purged.')
} else {
  console.log('No demo data to delete.')
}

  console.log('Done.')
} finally {
  await client.end()
}
