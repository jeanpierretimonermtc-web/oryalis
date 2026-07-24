import pg from 'pg'; import { readFile } from 'node:fs/promises'; const { Client } = pg
if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')
const password=encodeURIComponent(process.env.SUPABASE_DB_PASSWORD), client=new Client({connectionString:`postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`})
const sql=await readFile(new URL('./supabase/migrations/20260712_product_analytics.sql',import.meta.url),'utf8'); await client.connect()
try{await client.query('BEGIN');await client.query(sql);await client.query('COMMIT');console.log('Migration 36 terminée : tunnel produit et cohorte pilote.')}catch(e){await client.query('ROLLBACK');throw e}finally{await client.end()}
