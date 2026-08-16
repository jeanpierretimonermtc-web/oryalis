import pg from 'pg'
const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()

try {
  // Supprimer les tables dépendantes (vides) puis l'ancienne appointments
  await client.query(`
    DROP TABLE IF EXISTS appointment_attendees;
    DROP TABLE IF EXISTS appointment_tasks;
    DROP TABLE IF EXISTS appointment_business_context;
    DROP TABLE IF EXISTS appointment_notes;
    DROP TABLE IF EXISTS appointments;
  `)
  console.log('✓ Anciennes tables supprimées')

  // Nouvelle table appointments
  await client.query(`
    CREATE TABLE appointments (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      client_id            UUID REFERENCES clients(id) ON DELETE SET NULL,

      title                TEXT NOT NULL,
      appointment_type     appointment_type_enum NOT NULL DEFAULT 'other',
      status               appointment_status_enum NOT NULL DEFAULT 'scheduled',

      start_at             TIMESTAMPTZ NOT NULL,
      end_at               TIMESTAMPTZ NOT NULL,
      duration_minutes     INTEGER GENERATED ALWAYS AS (
                             EXTRACT(EPOCH FROM (end_at - start_at))::INTEGER / 60
                           ) STORED,
      timezone             TEXT NOT NULL DEFAULT 'Europe/Paris',

      location             TEXT,
      meeting_url          TEXT,

      provider             TEXT NOT NULL DEFAULT 'oryalis',
      external_calendar_id TEXT,
      external_event_id    TEXT,
      last_synced_at       TIMESTAMPTZ,
      sync_status          TEXT,

      cancelled_at         TIMESTAMPTZ,
      cancellation_reason  TEXT,

      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await client.query(`
    CREATE INDEX idx_appointments_user_id   ON appointments(user_id);
    CREATE INDEX idx_appointments_client_id ON appointments(client_id);
    CREATE INDEX idx_appointments_start_at  ON appointments(start_at);
    CREATE INDEX idx_appointments_status    ON appointments(status);
  `)
  console.log('✓ Table appointments')

  // appointment_notes
  await client.query(`
    CREATE TABLE appointment_notes (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id     UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      client_notes       TEXT,
      internal_notes     TEXT,
      objections         TEXT,
      needs_identified   TEXT,
      products_discussed TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (appointment_id)
    );
    CREATE INDEX idx_appt_notes_appointment_id ON appointment_notes(appointment_id);
  `)
  console.log('✓ Table appointment_notes')

  // appointment_business_context
  await client.query(`
    CREATE TABLE appointment_business_context (
      id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id       UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      brand_id             UUID REFERENCES catalogs(id) ON DELETE SET NULL,
      catalog_id           UUID REFERENCES catalogs(id) ON DELETE SET NULL,
      main_product_id      UUID REFERENCES catalog_products(id) ON DELETE SET NULL,
      pipeline_stage       pipeline_stage_enum NOT NULL DEFAULT 'new_lead',
      prospect_temperature prospect_temperature_enum,
      commercial_intent    commercial_intent_enum,
      estimated_value      NUMERIC(10, 2),
      currency             TEXT NOT NULL DEFAULT 'EUR',
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (appointment_id)
    );
    CREATE INDEX idx_appt_biz_appointment_id ON appointment_business_context(appointment_id);
    CREATE INDEX idx_appt_biz_pipeline_stage ON appointment_business_context(pipeline_stage);
    CREATE INDEX idx_appt_biz_temperature    ON appointment_business_context(prospect_temperature);
  `)
  console.log('✓ Table appointment_business_context')

  // appointment_tasks
  await client.query(`
    CREATE TABLE appointment_tasks (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
      user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      client_id      UUID REFERENCES clients(id) ON DELETE SET NULL,
      title          TEXT NOT NULL,
      task_type      task_type_enum NOT NULL DEFAULT 'follow_up',
      priority       task_priority_enum NOT NULL DEFAULT 'medium',
      status         task_status_enum NOT NULL DEFAULT 'pending',
      due_at         TIMESTAMPTZ,
      completed_at   TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_appt_tasks_user_id        ON appointment_tasks(user_id);
    CREATE INDEX idx_appt_tasks_appointment_id ON appointment_tasks(appointment_id);
    CREATE INDEX idx_appt_tasks_client_id      ON appointment_tasks(client_id);
    CREATE INDEX idx_appt_tasks_due_at         ON appointment_tasks(due_at);
    CREATE INDEX idx_appt_tasks_status         ON appointment_tasks(status);
  `)
  console.log('✓ Table appointment_tasks')

  // appointment_attendees
  await client.query(`
    CREATE TABLE appointment_attendees (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      client_id      UUID REFERENCES clients(id) ON DELETE SET NULL,
      external_name  TEXT,
      external_email TEXT,
      status         TEXT NOT NULL DEFAULT 'invited',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX idx_appt_attendees_appointment_id ON appointment_attendees(appointment_id);
    CREATE INDEX idx_appt_attendees_client_id      ON appointment_attendees(client_id);
  `)
  console.log('✓ Table appointment_attendees')

  // RLS
  const tables = ['appointments', 'appointment_notes', 'appointment_business_context', 'appointment_tasks', 'appointment_attendees']
  for (const t of tables) {
    await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`)
  }

  await client.query(`
    CREATE POLICY "appointments_select" ON appointments FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "appointments_insert" ON appointments FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "appointments_update" ON appointments FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "appointments_delete" ON appointments FOR DELETE USING (auth.uid() = user_id);
  `)

  for (const t of ['appointment_notes', 'appointment_business_context', 'appointment_attendees']) {
    await client.query(`
      CREATE POLICY "${t}_select" ON ${t} FOR SELECT USING (EXISTS (SELECT 1 FROM appointments a WHERE a.id = ${t}.appointment_id AND a.user_id = auth.uid()));
      CREATE POLICY "${t}_insert" ON ${t} FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM appointments a WHERE a.id = ${t}.appointment_id AND a.user_id = auth.uid()));
      CREATE POLICY "${t}_update" ON ${t} FOR UPDATE USING (EXISTS (SELECT 1 FROM appointments a WHERE a.id = ${t}.appointment_id AND a.user_id = auth.uid()));
      CREATE POLICY "${t}_delete" ON ${t} FOR DELETE USING (EXISTS (SELECT 1 FROM appointments a WHERE a.id = ${t}.appointment_id AND a.user_id = auth.uid()));
    `)
  }

  await client.query(`
    CREATE POLICY "appointment_tasks_select" ON appointment_tasks FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "appointment_tasks_insert" ON appointment_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "appointment_tasks_update" ON appointment_tasks FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "appointment_tasks_delete" ON appointment_tasks FOR DELETE USING (auth.uid() = user_id);
  `)
  console.log('✓ RLS activé')

  // Triggers updated_at
  for (const t of ['appointments', 'appointment_notes', 'appointment_business_context', 'appointment_tasks']) {
    await client.query(`
      CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON ${t}
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `)
  }
  console.log('✓ Triggers updated_at')

  // Reload PostgREST schema cache
  await client.query(`NOTIFY pgrst, 'reload schema'`)
  console.log('\n✅ Migration agenda2 terminée.')

} finally {
  await client.end()
}
