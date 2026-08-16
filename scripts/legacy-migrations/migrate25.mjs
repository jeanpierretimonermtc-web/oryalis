// migrate25.mjs — Fix contrainte CHECK sur clients.status
// La contrainte d'origine n'autorisait que 5 valeurs ; le code en utilise 9.
// Run : SUPABASE_DB_PASSWORD=xxx node migrate25.mjs

import pg from 'pg'
const { Client } = pg

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

await client.query(`
  ALTER TABLE clients
    DROP CONSTRAINT IF EXISTS clients_status_check,
    ADD CONSTRAINT clients_status_check CHECK (
      status = ANY (ARRAY[
        'prospect',
        'new_client',
        'active',
        'loyal',
        'vip',
        'inactive',
        'advisor',
        'team_member',
        'lost'
      ])
    )
`)
console.log('✓ Contrainte clients_status_check mise à jour (9 valeurs)')

await client.query(`SELECT pg_notify('pgrst', 'reload schema')`)
console.log('✓ PostgREST schema reloaded')

await client.end()
console.log('\n✅ Migration 25 terminée — fix status constraint')
