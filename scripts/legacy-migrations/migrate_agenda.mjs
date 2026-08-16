import pg from 'pg'

const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) {
  throw new Error('Missing environment variable: SUPABASE_DB_PASSWORD')
}

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()

try {
  // ─────────────────────────────────────────────
  // ENUMS
  // ─────────────────────────────────────────────

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE appointment_type_enum AS ENUM (
        'discovery_call',
        'product_presentation',
        'follow_up',
        'closing_call',
        'customer_support',
        'team_training',
        'team_meeting',
        'webinar',
        'onboarding',
        'business_review',
        'other'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE appointment_status_enum AS ENUM (
        'scheduled',
        'completed',
        'cancelled',
        'no_show',
        'rescheduled'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE pipeline_stage_enum AS ENUM (
        'new_lead',
        'contacted',
        'presentation_scheduled',
        'presentation_completed',
        'follow_up',
        'proposal_sent',
        'customer',
        'distributor',
        'inactive',
        'lost'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE prospect_temperature_enum AS ENUM (
        'cold',
        'warm',
        'hot',
        'very_hot'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE commercial_intent_enum AS ENUM (
        'buy_product',
        'become_customer',
        'become_distributor',
        'build_team',
        'training',
        'support',
        'other'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE task_type_enum AS ENUM (
        'follow_up',
        'send_catalog',
        'send_price_list',
        'send_sample',
        'invite_to_webinar',
        'invite_to_training',
        'send_payment_link',
        'customer_checkin',
        'team_followup',
        'ask_referral',
        'other'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE task_priority_enum AS ENUM ('low', 'medium', 'high', 'urgent');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await client.query(`
    DO $$ BEGIN
      CREATE TYPE task_status_enum AS ENUM ('pending', 'in_progress', 'done', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  console.log('✓ Enums créés')

  // ─────────────────────────────────────────────
  // TABLE : appointments
  // ─────────────────────────────────────────────

  await client.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,

      title               TEXT NOT NULL,
      appointment_type    appointment_type_enum NOT NULL DEFAULT 'other',
      status              appointment_status_enum NOT NULL DEFAULT 'scheduled',

      start_at            TIMESTAMPTZ NOT NULL,
      end_at              TIMESTAMPTZ NOT NULL,
      duration_minutes    INTEGER GENERATED ALWAYS AS (
                            EXTRACT(EPOCH FROM (end_at - start_at))::INTEGER / 60
                          ) STORED,
      timezone            TEXT NOT NULL DEFAULT 'Europe/Paris',

      location            TEXT,
      meeting_url         TEXT,

      -- Synchronisation calendrier externe (Phase 2+)
      provider            TEXT NOT NULL DEFAULT 'oryalis',
      external_calendar_id TEXT,
      external_event_id   TEXT,
      last_synced_at      TIMESTAMPTZ,
      sync_status         TEXT,

      cancelled_at        TIMESTAMPTZ,
      cancellation_reason TEXT,

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_appointments_user_id   ON appointments(user_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON appointments(client_id);
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='start_at') THEN
        CREATE INDEX IF NOT EXISTS idx_appointments_start_at ON appointments(start_at);
      END IF;
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='status') THEN
        CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
      END IF;
    END $$;
  `)

  console.log('✓ Table appointments')

  // ─────────────────────────────────────────────
  // TABLE : appointment_notes
  // ─────────────────────────────────────────────

  await client.query(`
    CREATE TABLE IF NOT EXISTS appointment_notes (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id      UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,

      client_notes        TEXT,
      internal_notes      TEXT,
      objections          TEXT,
      needs_identified    TEXT,
      products_discussed  TEXT,

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_appt_notes_appointment_id ON appointment_notes(appointment_id);
  `)

  console.log('✓ Table appointment_notes')

  // ─────────────────────────────────────────────
  // TABLE : appointment_business_context
  // ─────────────────────────────────────────────

  await client.query(`
    CREATE TABLE IF NOT EXISTS appointment_business_context (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id      UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,

      brand_id            UUID REFERENCES catalogs(id) ON DELETE SET NULL,
      catalog_id          UUID REFERENCES catalogs(id) ON DELETE SET NULL,
      main_product_id     UUID REFERENCES catalog_products(id) ON DELETE SET NULL,

      pipeline_stage      pipeline_stage_enum NOT NULL DEFAULT 'new_lead',
      prospect_temperature prospect_temperature_enum,
      commercial_intent   commercial_intent_enum,

      estimated_value     NUMERIC(10, 2),
      currency            TEXT NOT NULL DEFAULT 'EUR',

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_appt_biz_appointment_id  ON appointment_business_context(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_appt_biz_pipeline_stage  ON appointment_business_context(pipeline_stage);
    CREATE INDEX IF NOT EXISTS idx_appt_biz_temperature     ON appointment_business_context(prospect_temperature);
  `)

  console.log('✓ Table appointment_business_context')

  // ─────────────────────────────────────────────
  // TABLE : appointment_tasks
  // ─────────────────────────────────────────────

  await client.query(`
    CREATE TABLE IF NOT EXISTS appointment_tasks (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id      UUID REFERENCES appointments(id) ON DELETE SET NULL,
      user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,

      title               TEXT NOT NULL,
      task_type           task_type_enum NOT NULL DEFAULT 'follow_up',
      priority            task_priority_enum NOT NULL DEFAULT 'medium',
      status              task_status_enum NOT NULL DEFAULT 'pending',

      due_at              TIMESTAMPTZ,
      completed_at        TIMESTAMPTZ,

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_appt_tasks_user_id       ON appointment_tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_appt_tasks_appointment_id ON appointment_tasks(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_appt_tasks_client_id     ON appointment_tasks(client_id);
    CREATE INDEX IF NOT EXISTS idx_appt_tasks_due_at        ON appointment_tasks(due_at);
    CREATE INDEX IF NOT EXISTS idx_appt_tasks_status        ON appointment_tasks(status);
  `)

  console.log('✓ Table appointment_tasks')

  // ─────────────────────────────────────────────
  // TABLE : appointment_attendees
  // ─────────────────────────────────────────────

  await client.query(`
    CREATE TABLE IF NOT EXISTS appointment_attendees (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      appointment_id      UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      client_id           UUID REFERENCES clients(id) ON DELETE SET NULL,

      -- Pour les participants sans fiche client (ex: invité externe)
      external_name       TEXT,
      external_email      TEXT,

      status              TEXT NOT NULL DEFAULT 'invited',
      -- invited | accepted | declined | no_show

      created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_appt_attendees_appointment_id ON appointment_attendees(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_appt_attendees_client_id      ON appointment_attendees(client_id);
  `)

  console.log('✓ Table appointment_attendees')

  // ─────────────────────────────────────────────
  // RLS
  // ─────────────────────────────────────────────

  const tables = [
    'appointments',
    'appointment_notes',
    'appointment_business_context',
    'appointment_tasks',
    'appointment_attendees',
  ]

  for (const table of tables) {
    await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`)
  }

  // appointments
  await client.query(`
    DROP POLICY IF EXISTS "appointments_user_select" ON appointments;
    CREATE POLICY "appointments_user_select" ON appointments
      FOR SELECT USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "appointments_user_insert" ON appointments;
    CREATE POLICY "appointments_user_insert" ON appointments
      FOR INSERT WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "appointments_user_update" ON appointments;
    CREATE POLICY "appointments_user_update" ON appointments
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "appointments_user_delete" ON appointments;
    CREATE POLICY "appointments_user_delete" ON appointments
      FOR DELETE USING (auth.uid() = user_id);
  `)

  // tables liées — accès via join sur appointments.user_id
  const linkedTables = [
    'appointment_notes',
    'appointment_business_context',
    'appointment_attendees',
  ]

  for (const table of linkedTables) {
    await client.query(`
      DROP POLICY IF EXISTS "${table}_user_select" ON ${table};
      CREATE POLICY "${table}_user_select" ON ${table}
        FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = ${table}.appointment_id
            AND a.user_id = auth.uid()
          )
        );

      DROP POLICY IF EXISTS "${table}_user_insert" ON ${table};
      CREATE POLICY "${table}_user_insert" ON ${table}
        FOR INSERT WITH CHECK (
          EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = ${table}.appointment_id
            AND a.user_id = auth.uid()
          )
        );

      DROP POLICY IF EXISTS "${table}_user_update" ON ${table};
      CREATE POLICY "${table}_user_update" ON ${table}
        FOR UPDATE USING (
          EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = ${table}.appointment_id
            AND a.user_id = auth.uid()
          )
        );

      DROP POLICY IF EXISTS "${table}_user_delete" ON ${table};
      CREATE POLICY "${table}_user_delete" ON ${table}
        FOR DELETE USING (
          EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.id = ${table}.appointment_id
            AND a.user_id = auth.uid()
          )
        );
    `)
  }

  // appointment_tasks — user_id direct
  await client.query(`
    DROP POLICY IF EXISTS "appointment_tasks_user_select" ON appointment_tasks;
    CREATE POLICY "appointment_tasks_user_select" ON appointment_tasks
      FOR SELECT USING (auth.uid() = user_id);

    DROP POLICY IF EXISTS "appointment_tasks_user_insert" ON appointment_tasks;
    CREATE POLICY "appointment_tasks_user_insert" ON appointment_tasks
      FOR INSERT WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "appointment_tasks_user_update" ON appointment_tasks;
    CREATE POLICY "appointment_tasks_user_update" ON appointment_tasks
      FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

    DROP POLICY IF EXISTS "appointment_tasks_user_delete" ON appointment_tasks;
    CREATE POLICY "appointment_tasks_user_delete" ON appointment_tasks
      FOR DELETE USING (auth.uid() = user_id);
  `)

  console.log('✓ RLS activé sur toutes les tables')

  // ─────────────────────────────────────────────
  // TRIGGER updated_at
  // ─────────────────────────────────────────────

  await client.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `)

  const triggeredTables = [
    'appointments',
    'appointment_notes',
    'appointment_business_context',
    'appointment_tasks',
  ]

  for (const table of triggeredTables) {
    await client.query(`
      DROP TRIGGER IF EXISTS set_updated_at ON ${table};
      CREATE TRIGGER set_updated_at
        BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `)
  }

  console.log('✓ Triggers updated_at')
  console.log('\n✅ Migration agenda terminée avec succès.')

} finally {
  await client.end()
}
