import pg from 'pg'; const { Client } = pg
if(!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')
const password=encodeURIComponent(process.env.SUPABASE_DB_PASSWORD), db=new Client({connectionString:`postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`}); await db.connect()
try {
  await db.query('BEGIN')
  const profile=await db.query('SELECT id FROM profiles LIMIT 1'); if(!profile.rowCount) throw new Error('Aucun profil disponible')
  const uid=profile.rows[0].id; await db.query('DELETE FROM product_events WHERE user_id=$1',[uid])
  const contact=await db.query("INSERT INTO clients(user_id,full_name,status,contact_role,pipeline_stage) VALUES($1,'TEST analytics','prospect','prospect','new_lead') RETURNING id",[uid])
  const followup=await db.query("INSERT INTO followups(user_id,client_id,title,due_date,done) VALUES($1,$2,'TEST action',CURRENT_DATE,false) RETURNING id",[uid,contact.rows[0].id])
  await db.query('UPDATE followups SET done=true,updated_at=now() WHERE id=$1',[followup.rows[0].id])
  await db.query("INSERT INTO subscriptions(user_id,provider,status,plan,external_subscription_id) VALUES($1,'manual','active','advisor',$2)",[uid,`test-${Date.now()}`])
  const events=(await db.query('SELECT event_name FROM product_events WHERE user_id=$1',[uid])).rows.map(r=>r.event_name)
  for(const expected of ['first_contact_created','first_action_scheduled','first_action_completed','subscription_started']) if(!events.includes(expected)) throw new Error(`Événement absent: ${expected}`)
  await db.query('ROLLBACK'); console.log('Tests réussis : activation, action et abonnement mesurés ; données annulées.')
} catch(e){try{await db.query('ROLLBACK')}catch{};throw e} finally{await db.end()}
