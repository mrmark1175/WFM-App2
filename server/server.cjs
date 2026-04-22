const express = require('express');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const { getCurrentUser } = require('./auth.cjs');
const { pool } = require('./db.cjs');
const { generate: generateSchedule } = require('./scheduling/generator.cjs');

const app = express();
const distPath = path.resolve(__dirname, '../dist');
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Admin Auth helpers ────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  const s = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] SESSION_SECRET not set — sessions will reset on every restart. Add SESSION_SECRET to .env for persistence.');
  return s;
})();
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const IS_PROD = process.env.NODE_ENV === 'production';

function hashPw(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function storePw(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${hashPw(password, salt)}`;
}
function checkPw(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const computed = hashPw(password, salt);
    return computed.length === hash.length &&
      crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() - payload.iat > TOKEN_TTL_MS) return null;
    return payload;
  } catch { return null; }
}
function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(cookieHeader.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k.trim(), decodeURIComponent(v.join('='))];
  }));
}
function requireAuth(req, res, next) {
  const token = parseCookies(req.headers.cookie).wfm_token;
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}
function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie',
    `wfm_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${IS_PROD ? '; Secure' : ''}`
  );
}

// Protect all /api/* routes except /api/auth/*
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/')) return next();
  requireAuth(req, res, next);
});

async function ensureAppTables() {
  // ── Existing app tables ──────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demand_planner_scenarios (
      scenario_id text NOT NULL,
      scenario_name text NOT NULL,
      planner_snapshot jsonb NOT NULL,
      organization_id integer NOT NULL DEFAULT 1,
      lob_id integer,
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      PRIMARY KEY (scenario_id, organization_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demand_planner_active_state (
      organization_id integer NOT NULL,
      state_value jsonb NOT NULL,
      updated_at timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  // Ensure PK exists on demand_planner_active_state (for fresh installs before LOB migration)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'demand_planner_active_state_pkey'
        AND conrelid = 'demand_planner_active_state'::regclass
      ) THEN
        ALTER TABLE demand_planner_active_state ADD PRIMARY KEY (organization_id);
      END IF;
    EXCEPTION WHEN undefined_table THEN NULL;
    END; $$
  `);

  // ── LOBs table ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lobs (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL DEFAULT 1,
      lob_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, lob_name)
    )
  `);

  // Seed the default LOB for org 1
  await pool.query(`
    INSERT INTO lobs (organization_id, lob_name)
    VALUES (1, 'Default LOB')
    ON CONFLICT DO NOTHING
  `);

  // ── Migrate existing tables to include lob_id ────────────────────────────────

  // forecasts
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE forecasts ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      UPDATE forecasts SET lob_id = (
        SELECT id FROM lobs WHERE organization_id = forecasts.organization_id AND lob_name = 'Default LOB' LIMIT 1
      ) WHERE lob_id IS NULL;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE forecasts ADD CONSTRAINT forecasts_year_lob_channel_key UNIQUE (year_label, lob_id, channel);
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN undefined_table THEN NULL; END; $$
  `);

  // capacity_scenarios
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE capacity_scenarios ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      UPDATE capacity_scenarios SET lob_id = (
        SELECT id FROM lobs WHERE organization_id = capacity_scenarios.organization_id AND lob_name = 'Default LOB' LIMIT 1
      ) WHERE lob_id IS NULL;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);

  // interaction_arrival
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE interaction_arrival ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      UPDATE interaction_arrival SET lob_id = (
        SELECT id FROM lobs WHERE organization_id = interaction_arrival.organization_id AND lob_name = 'Default LOB' LIMIT 1
      ) WHERE lob_id IS NULL;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  // Drop ALL unique constraints on interaction_arrival that don't include lob_id,
  // regardless of their auto-generated name (Supabase names vary per environment).
  await pool.query(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'interaction_arrival'
          AND c.contype = 'u'
          AND c.conname != 'ia_date_idx_lob_channel_key'
      LOOP
        BEGIN
          EXECUTE 'ALTER TABLE interaction_arrival DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END LOOP;
    EXCEPTION WHEN undefined_table THEN NULL;
    END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE interaction_arrival ADD CONSTRAINT ia_date_idx_lob_channel_key UNIQUE (interval_date, interval_index, lob_id, channel);
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; WHEN undefined_table THEN NULL; END; $$
  `);

  // interaction_arrival — new columns per spec
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE interaction_arrival ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'Inbound';
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE interaction_arrival ADD COLUMN IF NOT EXISTS target_sl_percent FLOAT;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE interaction_arrival ADD COLUMN IF NOT EXISTS target_tt_seconds INTEGER;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE interaction_arrival ADD COLUMN IF NOT EXISTS concurrency_factor FLOAT NOT NULL DEFAULT 1.0;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);

  // long_term_actuals
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE long_term_actuals ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      UPDATE long_term_actuals SET lob_id = (
        SELECT id FROM lobs WHERE organization_id = long_term_actuals.organization_id AND lob_name = 'Default LOB' LIMIT 1
      ) WHERE lob_id IS NULL;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);

  // demand_planner_scenarios — add lob_id
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE demand_planner_scenarios ADD COLUMN IF NOT EXISTS lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_column THEN NULL; WHEN undefined_table THEN NULL; END; $$
  `);
  await pool.query(`
    DO $$ BEGIN
      UPDATE demand_planner_scenarios SET lob_id = (
        SELECT id FROM lobs WHERE organization_id = demand_planner_scenarios.organization_id AND lob_name = 'Default LOB' LIMIT 1
      ) WHERE lob_id IS NULL;
    EXCEPTION WHEN undefined_table THEN NULL; END; $$
  `);

  // demand_planner_active_state — migrate PK from (organization_id) to (organization_id, lob_id)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'demand_planner_active_state' AND column_name = 'lob_id'
      ) THEN
        ALTER TABLE demand_planner_active_state ADD COLUMN lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE;
        UPDATE demand_planner_active_state SET lob_id = (
          SELECT id FROM lobs
          WHERE organization_id = demand_planner_active_state.organization_id
          AND lob_name = 'Default LOB'
          LIMIT 1
        );
        ALTER TABLE demand_planner_active_state ALTER COLUMN lob_id SET NOT NULL;
        ALTER TABLE demand_planner_active_state DROP CONSTRAINT IF EXISTS demand_planner_active_state_pkey;
        ALTER TABLE demand_planner_active_state ADD PRIMARY KEY (organization_id, lob_id);
      END IF;
    END;
    $$
  `);

  // ── shrinkage_plans — one plan per org+LOB ───────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shrinkage_plans (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL DEFAULT 1,
      lob_id INTEGER NOT NULL REFERENCES lobs(id) ON DELETE CASCADE,
      hours_per_day FLOAT NOT NULL DEFAULT 7.5,
      days_per_week FLOAT NOT NULL DEFAULT 5,
      net_fte_input FLOAT,
      absence_items JSONB NOT NULL DEFAULT '[]',
      activity_items JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, lob_id)
    )
  `);

  // ── user_preferences — generic per-page UI state per org+LOB ────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL DEFAULT 1,
      lob_id INTEGER REFERENCES lobs(id) ON DELETE CASCADE,
      page_key TEXT NOT NULL,
      preferences JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, lob_id, page_key)
    )
  `);
  // Separate index for global (lob_id IS NULL) preferences
  await pool.query(`
    DO $$ BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_global_key
        ON user_preferences (organization_id, page_key)
        WHERE lob_id IS NULL;
    EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END; $$
  `);

  // ── distribution_profiles — saved intraday arrival patterns per LOB+channel ─
  await pool.query(`
    CREATE TABLE IF NOT EXISTS distribution_profiles (
      id              SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL DEFAULT 1,
      lob_id          INTEGER NOT NULL REFERENCES lobs(id) ON DELETE CASCADE,
      channel         TEXT NOT NULL DEFAULT 'voice',
      profile_name    TEXT NOT NULL,
      interval_weights JSONB NOT NULL,
      day_weights      JSONB NOT NULL,
      baseline_start_date DATE,
      baseline_end_date   DATE,
      sample_day_count    SMALLINT,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE distribution_profiles
        ADD CONSTRAINT dist_profiles_org_lob_channel_name_key
        UNIQUE (organization_id, lob_id, channel, profile_name);
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END; $$
  `);

  // ── lob_settings — per-LOB channel, staffing, and hours-of-operation config ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lob_settings (
      id                   SERIAL PRIMARY KEY,
      organization_id      INTEGER NOT NULL DEFAULT 1,
      lob_id               INTEGER NOT NULL REFERENCES lobs(id) ON DELETE CASCADE,
      channels_enabled     JSONB   NOT NULL DEFAULT '{"voice":true,"email":false,"chat":false,"cases":false}',
      pooling_mode         TEXT    NOT NULL DEFAULT 'dedicated',
      voice_aht            INTEGER NOT NULL DEFAULT 300,
      voice_sla_target     NUMERIC NOT NULL DEFAULT 80,
      voice_sla_seconds    INTEGER NOT NULL DEFAULT 20,
      chat_aht             INTEGER NOT NULL DEFAULT 450,
      chat_sla_target      NUMERIC NOT NULL DEFAULT 80,
      chat_sla_seconds     INTEGER NOT NULL DEFAULT 30,
      chat_concurrency     NUMERIC NOT NULL DEFAULT 2,
      email_aht            INTEGER NOT NULL DEFAULT 600,
      email_sla_target     NUMERIC NOT NULL DEFAULT 90,
      email_sla_seconds    INTEGER NOT NULL DEFAULT 14400,
      email_occupancy      NUMERIC NOT NULL DEFAULT 85,
      hours_of_operation   JSONB   NOT NULL DEFAULT '{}',
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, lob_id)
    )
  `);

  // ── demand_actuals — per-LOB, per-channel actual volumes for re-cut ──────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demand_actuals (
      id              SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL DEFAULT 1,
      lob_id          INTEGER NOT NULL REFERENCES lobs(id) ON DELETE CASCADE,
      year            INTEGER NOT NULL,
      month           INTEGER NOT NULL,
      channel         TEXT    NOT NULL,
      actual_volume   INTEGER NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, lob_id, year, month, channel)
    )
  `);

  // ── Scheduling Prerequisites ──────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduling_agents (
      id                  SERIAL PRIMARY KEY,
      organization_id     INTEGER NOT NULL DEFAULT 1,
      employee_id         VARCHAR(100),
      full_name           VARCHAR(255) NOT NULL,
      email               VARCHAR(255),
      contract_type       VARCHAR(50) NOT NULL DEFAULT 'full_time',
      skill_voice         BOOLEAN NOT NULL DEFAULT TRUE,
      skill_chat          BOOLEAN NOT NULL DEFAULT FALSE,
      skill_email         BOOLEAN NOT NULL DEFAULT FALSE,
      lob_assignments     INTEGER[] NOT NULL DEFAULT '{}',
      accommodation_flags TEXT[] NOT NULL DEFAULT '{}',
      availability        JSONB NOT NULL DEFAULT '{}',
      status              VARCHAR(50) NOT NULL DEFAULT 'active',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduling_shift_templates (
      id               SERIAL PRIMARY KEY,
      organization_id  INTEGER NOT NULL DEFAULT 1,
      name             VARCHAR(255) NOT NULL,
      start_time       VARCHAR(10) NOT NULL,
      end_time         VARCHAR(10) NOT NULL,
      duration_hours   NUMERIC(4,2),
      break_rules      JSONB NOT NULL DEFAULT '[]',
      channel_coverage TEXT[] NOT NULL DEFAULT '{}',
      color            VARCHAR(20) NOT NULL DEFAULT '#6366f1',
      is_overnight     BOOLEAN NOT NULL DEFAULT FALSE,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduling_labor_laws (
      id                        SERIAL PRIMARY KEY,
      organization_id           INTEGER NOT NULL DEFAULT 1,
      jurisdiction_name         VARCHAR(255) NOT NULL,
      jurisdiction_code         VARCHAR(50),
      is_preset                 BOOLEAN NOT NULL DEFAULT FALSE,
      max_hours_per_day         NUMERIC(4,1) NOT NULL DEFAULT 8,
      max_hours_per_week        NUMERIC(5,1) NOT NULL DEFAULT 40,
      max_consecutive_days      INTEGER NOT NULL DEFAULT 5,
      overtime_threshold_daily  NUMERIC(4,1),
      overtime_threshold_weekly NUMERIC(5,1) DEFAULT 40,
      rest_hours_between_shifts NUMERIC(4,1) NOT NULL DEFAULT 8,
      rest_days_per_week        INTEGER NOT NULL DEFAULT 1,
      meal_break_minutes        INTEGER NOT NULL DEFAULT 60,
      meal_break_after_hours    NUMERIC(3,1) NOT NULL DEFAULT 5,
      short_breaks_count        INTEGER NOT NULL DEFAULT 2,
      short_break_minutes       INTEGER NOT NULL DEFAULT 15,
      night_differential_pct    NUMERIC(5,2) NOT NULL DEFAULT 0,
      overtime_rate_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.25,
      custom_rules              JSONB NOT NULL DEFAULT '{}',
      notes                     TEXT,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, jurisdiction_code)
    )
  `);

  // Seed preset labor law jurisdictions (idempotent)
  await pool.query(`
    INSERT INTO scheduling_labor_laws
      (organization_id, jurisdiction_name, jurisdiction_code, is_preset,
       max_hours_per_day, max_hours_per_week, max_consecutive_days,
       overtime_threshold_daily, overtime_threshold_weekly,
       rest_hours_between_shifts, rest_days_per_week,
       meal_break_minutes, meal_break_after_hours,
       short_breaks_count, short_break_minutes,
       night_differential_pct, overtime_rate_multiplier, notes)
    VALUES
      (1, 'Philippines (DOLE)', 'PH', true,
       8, 48, 6, 8, 48, 8, 1, 60, 5, 2, 15, 10.00, 1.25,
       'DOLE Labor Code. Night differential 10% for work 10PM–6AM. OT at 25% above regular rate. Max 6 consecutive days; 1 mandatory rest day per week. Holiday pay and 13th month pay rules apply separately.'),
      (1, 'United States (FLSA)', 'US', true,
       8, 40, 6, NULL, 40, 8, 1, 30, 5, 2, 10, 0.00, 1.50,
       'Fair Labor Standards Act. Federal OT after 40 hrs/week at 1.5x. No federal daily OT threshold — check state law (CA and NV require daily OT after 8 hrs). No federal meal break mandate; verify applicable state regulations.'),
      (1, 'India (Shops & Establishments Act)', 'IN', true,
       9, 48, 6, 9, 48, 12, 1, 60, 5, 2, 15, 0.00, 2.00,
       'Shops and Commercial Establishments Act. Max 9 hrs/day, 48 hrs/week. Minimum 12 hrs rest between shifts. OT at 2x rate. 1 paid weekly off mandatory. State-specific variations apply — verify with local HR compliance counsel.')
    ON CONFLICT (organization_id, jurisdiction_code) DO NOTHING
  `);

  // ── Capacity Plan Config — assumptions per LOB+channel ───────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS capacity_plan_config (
      id                      SERIAL PRIMARY KEY,
      organization_id         INTEGER NOT NULL DEFAULT 1,
      lob_id                  INTEGER NOT NULL REFERENCES lobs(id) ON DELETE CASCADE,
      channel                 TEXT NOT NULL DEFAULT 'blended',
      plan_start_date         DATE NOT NULL DEFAULT CURRENT_DATE,
      horizon_weeks           INTEGER NOT NULL DEFAULT 26,
      attrition_rate_monthly  NUMERIC NOT NULL DEFAULT 2.0,
      ramp_training_weeks     INTEGER NOT NULL DEFAULT 4,
      ramp_nesting_weeks      INTEGER NOT NULL DEFAULT 2,
      ramp_nesting_pct        NUMERIC NOT NULL DEFAULT 50,
      starting_hc             NUMERIC NOT NULL DEFAULT 0,
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, lob_id, channel)
    )
  `);

  // ── Capacity Plan Weekly Inputs — user-entered data per LOB+channel+week ──────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS capacity_plan_weekly_inputs (
      id                    SERIAL PRIMARY KEY,
      organization_id       INTEGER NOT NULL DEFAULT 1,
      lob_id                INTEGER NOT NULL REFERENCES lobs(id) ON DELETE CASCADE,
      channel               TEXT NOT NULL DEFAULT 'blended',
      week_offset           INTEGER NOT NULL,
      planned_hires         NUMERIC,
      known_exits           NUMERIC,
      actual_hc             NUMERIC,
      actual_attrition      NUMERIC,
      vol_override_voice    NUMERIC,
      vol_override_chat     NUMERIC,
      vol_override_email    NUMERIC,
      aht_override_voice    NUMERIC,
      aht_override_chat     NUMERIC,
      aht_override_email    NUMERIC,
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id, lob_id, channel, week_offset)
    )
  `);
  await pool.query(`ALTER TABLE capacity_plan_weekly_inputs ADD COLUMN IF NOT EXISTS vol_override_cases NUMERIC`);
  await pool.query(`ALTER TABLE capacity_plan_weekly_inputs ADD COLUMN IF NOT EXISTS aht_override_cases NUMERIC`);

  // ── Schedule Assignments — agent shift assignments per date ──────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_assignments (
      id                  SERIAL PRIMARY KEY,
      organization_id     INTEGER NOT NULL DEFAULT 1,
      lob_id              INTEGER REFERENCES lobs(id) ON DELETE CASCADE,
      agent_id            INTEGER REFERENCES scheduling_agents(id) ON DELETE CASCADE,
      shift_template_id   INTEGER REFERENCES scheduling_shift_templates(id) ON DELETE SET NULL,
      work_date           DATE NOT NULL,
      start_time          TIME NOT NULL,
      end_time            TIME NOT NULL,
      is_overnight        BOOLEAN NOT NULL DEFAULT FALSE,
      channel             TEXT NOT NULL DEFAULT 'voice',
      notes               TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Shift Activities — breaks, meals, coaching, training, meetings within a shift ──
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shift_activities (
      id              SERIAL PRIMARY KEY,
      assignment_id   INTEGER NOT NULL REFERENCES schedule_assignments(id) ON DELETE CASCADE,
      activity_type   TEXT NOT NULL,
      start_time      TIME NOT NULL,
      end_time        TIME NOT NULL,
      is_paid         BOOLEAN NOT NULL DEFAULT FALSE,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Auto-Scheduler: Demand snapshots frozen from Intraday Forecast ────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduling_demand_snapshots (
      id                SERIAL PRIMARY KEY,
      organization_id   INTEGER NOT NULL DEFAULT 1,
      lob_id            INTEGER NOT NULL REFERENCES lobs(id) ON DELETE CASCADE,
      snapshot_label    VARCHAR(255),
      interval_minutes  INTEGER NOT NULL DEFAULT 30,
      approved_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_by       VARCHAR(255),
      notes             TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduling_demand_snapshot_rows (
      id             SERIAL PRIMARY KEY,
      snapshot_id    INTEGER NOT NULL REFERENCES scheduling_demand_snapshots(id) ON DELETE CASCADE,
      channel        TEXT NOT NULL,
      weekday        INTEGER NOT NULL,
      interval_start TIME NOT NULL,
      required_fte   NUMERIC NOT NULL DEFAULT 0,
      UNIQUE (snapshot_id, channel, weekday, interval_start)
    )
  `);

  // ── Auto-Scheduler: Generation runs ───────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_generation_runs (
      id                 SERIAL PRIMARY KEY,
      organization_id    INTEGER NOT NULL DEFAULT 1,
      lob_id             INTEGER NOT NULL REFERENCES lobs(id) ON DELETE CASCADE,
      snapshot_id        INTEGER REFERENCES scheduling_demand_snapshots(id) ON DELETE SET NULL,
      horizon_start      DATE NOT NULL,
      horizon_end        DATE NOT NULL,
      fairness_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
      coverage_report    JSONB NOT NULL DEFAULT '{}',
      notes              TEXT,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by         VARCHAR(255)
    )
  `);

  // ── Auto-Scheduler: extensions to existing tables ─────────────────────────
  await pool.query(`ALTER TABLE scheduling_agents ADD COLUMN IF NOT EXISTS shift_length_hours NUMERIC NOT NULL DEFAULT 9`);
  await pool.query(`ALTER TABLE scheduling_agents ADD COLUMN IF NOT EXISTS team_name VARCHAR(255)`);
  await pool.query(`ALTER TABLE scheduling_agents ADD COLUMN IF NOT EXISTS team_lead_id INTEGER`);
  await pool.query(`ALTER TABLE schedule_assignments ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft'`);
  await pool.query(`ALTER TABLE schedule_assignments ADD COLUMN IF NOT EXISTS generation_run_id INTEGER REFERENCES schedule_generation_runs(id) ON DELETE SET NULL`);
  await pool.query(`ALTER TABLE schedule_assignments ADD COLUMN IF NOT EXISTS absence_type VARCHAR(100) NULL`);

  // ── Admin auth ────────────────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_auth (
      id              SERIAL PRIMARY KEY,
      password_hash   TEXT NOT NULL,
      recovery_key_hash TEXT NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function ensureAdminAuth() {
  const existing = await pool.query('SELECT id FROM admin_auth LIMIT 1');
  if (existing.rows.length > 0) return;
  const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const recoveryKey = crypto.randomBytes(16).toString('hex');
  await pool.query(
    'INSERT INTO admin_auth (password_hash, recovery_key_hash) VALUES ($1, $2)',
    [storePw(defaultPassword), storePw(recoveryKey)]
  );
  console.log('\n' + '═'.repeat(60));
  console.log('  Admin auth initialized for the first time.');
  console.log(`  Default password : ${defaultPassword}`);
  console.log(`  Recovery key     : ${recoveryKey}`);
  console.log('  Please change the password after your first login.');
  console.log('  (Recovery key is also used if you forget your password.)');
  console.log('═'.repeat(60) + '\n');
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

app.get('/api/auth/status', (req, res) => {
  const token = parseCookies(req.headers.cookie).wfm_token;
  res.json({ authenticated: !!verifyToken(token) });
});

app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });
  try {
    const result = await pool.query('SELECT password_hash FROM admin_auth LIMIT 1');
    if (!result.rows[0]) return res.status(500).json({ error: 'Auth not initialized' });
    if (!checkPw(password, result.rows[0].password_hash)) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    setAuthCookie(res, signToken({ auth: true }));
    res.json({ ok: true });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'wfm_token=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const result = await pool.query('SELECT password_hash FROM admin_auth LIMIT 1');
    if (!checkPw(currentPassword, result.rows[0].password_hash))
      return res.status(401).json({ error: 'Current password is incorrect' });
    await pool.query('UPDATE admin_auth SET password_hash = $1, updated_at = NOW()', [storePw(newPassword)]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Change password error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/recover', async (req, res) => {
  const { recoveryKey, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const result = await pool.query('SELECT recovery_key_hash FROM admin_auth LIMIT 1');
    if (!result.rows[0] || !checkPw(recoveryKey, result.rows[0].recovery_key_hash))
      return res.status(401).json({ error: 'Invalid recovery key' });
    const newRecoveryKey = crypto.randomBytes(16).toString('hex');
    await pool.query(
      'UPDATE admin_auth SET password_hash = $1, recovery_key_hash = $2, updated_at = NOW()',
      [storePw(newPassword), storePw(newRecoveryKey)]
    );
    console.log('\n' + '═'.repeat(60));
    console.log('  Password recovered via recovery key.');
    console.log(`  New recovery key : ${newRecoveryKey}`);
    console.log('  Save this key somewhere safe!');
    console.log('═'.repeat(60) + '\n');
    res.json({ ok: true, newRecoveryKey });
  } catch (err) {
    console.error('Recover error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── LOB helper ────────────────────────────────────────────────────────────────
async function getDefaultLobId(organizationId) {
  const res = await pool.query(
    'SELECT id FROM lobs WHERE organization_id = $1 ORDER BY id ASC LIMIT 1',
    [organizationId]
  );
  return res.rows[0]?.id || null;
}

// --- CALL VOLUME SIMULATION ENGINE ---

class CallVolumeSimulator {
  constructor() {
    this.channelProfiles = {
      voice: {
        baseVolume: 18500,
        trendFactor: 1.006,
        monthlySeasonality: [1.08, 0.92, 0.96, 0.98, 1.01, 1.03, 0.95, 0.97, 1.00, 1.08, 1.18, 1.24],
        dayWeights: [0.38, 1.12, 1.05, 1.02, 1.04, 0.98, 0.52],
        intradayShape: [0.04, 0.04, 0.03, 0.03, 0.03, 0.05, 0.09, 0.16, 0.34, 0.57, 0.78, 0.92, 0.99, 1.00, 0.98, 0.94, 0.88, 0.76, 0.60, 0.42, 0.28, 0.18, 0.10, 0.06],
      },
      email: {
        baseVolume: 7200,
        trendFactor: 1.012,
        monthlySeasonality: [1.02, 0.95, 1.00, 1.03, 1.05, 1.01, 0.96, 0.98, 1.02, 1.10, 1.15, 1.08],
        dayWeights: [0.22, 1.24, 1.12, 1.02, 0.98, 0.86, 0.28],
        intradayShape: [0.01, 0.01, 0.01, 0.01, 0.02, 0.03, 0.06, 0.12, 0.26, 0.54, 0.76, 0.90, 0.96, 1.00, 0.97, 0.93, 0.86, 0.78, 0.66, 0.46, 0.28, 0.15, 0.08, 0.03],
      },
      chat: {
        baseVolume: 9800,
        trendFactor: 1.018,
        monthlySeasonality: [0.94, 0.92, 0.96, 0.99, 1.03, 1.07, 1.10, 1.12, 1.05, 1.08, 1.16, 1.20],
        dayWeights: [0.30, 1.10, 1.08, 1.04, 1.03, 1.00, 0.46],
        intradayShape: [0.03, 0.03, 0.02, 0.02, 0.03, 0.05, 0.08, 0.14, 0.28, 0.48, 0.68, 0.82, 0.92, 0.98, 1.00, 0.98, 0.96, 0.92, 0.84, 0.70, 0.54, 0.34, 0.18, 0.08],
      },
    };
  }

  getChannelProfile(channel = 'voice') {
    return this.channelProfiles[channel] || this.channelProfiles.voice;
  }

  deterministicNoise(seed, amplitude = 0.05) {
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const normalized = (hash >>> 0) / 4294967295;
    return 1 + ((normalized * 2) - 1) * amplitude;
  }

  getMonthlyEventFactor(channel, monthIdx) {
    const monthOfYear = monthIdx % 12;
    if (channel === 'voice') {
      if (monthOfYear === 0) return 1.03;
      if (monthOfYear === 6) return 0.94;
      if (monthOfYear === 10) return 1.04;
      if (monthOfYear === 11) return 1.08;
    }
    if (channel === 'email') {
      if (monthOfYear === 1) return 1.04;
      if (monthOfYear === 5) return 0.97;
      if (monthOfYear === 10) return 1.06;
    }
    if (channel === 'chat') {
      if (monthOfYear >= 5 && monthOfYear <= 7) return 1.05;
      if (monthOfYear === 10 || monthOfYear === 11) return 1.07;
    }
    return 1;
  }

  generateMonthlyVolume(monthIdx, channel = 'voice') {
    const profile = this.getChannelProfile(channel);
    const trend = Math.pow(profile.trendFactor, monthIdx);
    const seasonality = profile.monthlySeasonality[monthIdx % 12];
    const eventFactor = this.getMonthlyEventFactor(channel, monthIdx);
    const noise = this.deterministicNoise(`${channel}-monthly-${monthIdx}`, 0.035);
    const totalVolume = profile.baseVolume * trend * seasonality * eventFactor * noise;
    return Math.max(0, Math.round(totalVolume));
  }

  generateIntradayVolume(dateStr, channel = 'voice') {
    const profile = this.getChannelProfile(channel);
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const dowFactor = profile.dayWeights[dayOfWeek];
    const seasonalFactor = profile.monthlySeasonality[date.getMonth()];
    const baseInterval = (profile.baseVolume * seasonalFactor / 30 / 96) * dowFactor * this.deterministicNoise(`${channel}-${dateStr}-day`, 0.08);
    return Array.from({ length: 96 }, (_, i) => {
      const hour = Math.floor(i / 4);
      const quarterHourBias = [0.94, 1.02, 1.05, 0.99][i % 4];
      const todFactor = profile.intradayShape[hour] || 0.02;
      const noise = this.deterministicNoise(`${channel}-${dateStr}-${i}`, 0.09);
      return Math.max(0, Math.round(baseInterval * todFactor * quarterHourBias * noise));
    });
  }
}

const simulator = new CallVolumeSimulator();

// ── LOB CRUD Routes ───────────────────────────────────────────────────────────

app.get('/api/lobs', async (req, res) => {
  const user = getCurrentUser(req);
  try {
    const result = await pool.query(
      'SELECT id, organization_id, lob_name, created_at FROM lobs WHERE organization_id = $1 ORDER BY id ASC',
      [user.organization_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('LOB Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch LOBs' });
  }
});

app.post('/api/lobs', async (req, res) => {
  const user = getCurrentUser(req);
  const { lob_name } = req.body;
  if (!lob_name || !lob_name.trim()) return res.status(400).json({ error: 'lob_name is required' });
  try {
    const result = await pool.query(
      'INSERT INTO lobs (organization_id, lob_name) VALUES ($1, $2) RETURNING *',
      [user.organization_id, lob_name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An LOB with this name already exists' });
    console.error('LOB Create Error:', err.message);
    res.status(500).json({ error: 'Failed to create LOB' });
  }
});

app.put('/api/lobs/:id', async (req, res) => {
  const user = getCurrentUser(req);
  const { id } = req.params;
  const { lob_name } = req.body;
  if (!lob_name || !lob_name.trim()) return res.status(400).json({ error: 'lob_name is required' });
  try {
    const result = await pool.query(
      'UPDATE lobs SET lob_name = $1 WHERE id = $2 AND organization_id = $3 RETURNING *',
      [lob_name.trim(), id, user.organization_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'LOB not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'An LOB with this name already exists' });
    console.error('LOB Rename Error:', err.message);
    res.status(500).json({ error: 'Failed to rename LOB' });
  }
});

app.delete('/api/lobs/:id', async (req, res) => {
  const user = getCurrentUser(req);
  const { id } = req.params;
  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM lobs WHERE organization_id = $1', [user.organization_id]);
    if (parseInt(countRes.rows[0].count) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last LOB' });
    }
    await pool.query('DELETE FROM lobs WHERE id = $1 AND organization_id = $2', [id, user.organization_id]);
    res.json({ success: true });
  } catch (err) {
    console.error('LOB Delete Error:', err.message);
    res.status(500).json({ error: 'Failed to delete LOB' });
  }
});

// ── LOB Metadata (rich stats for LOB Management page) ────────────────────────

app.get('/api/lobs/metadata', async (req, res) => {
  const user = getCurrentUser(req);
  try {
    const result = await pool.query(
      `SELECT
         l.id,
         l.lob_name,
         l.created_at,
         COUNT(DISTINCT cs.id)::int          AS capacity_scenario_count,
         COUNT(DISTINCT dps.scenario_id)::int AS demand_scenario_count,
         GREATEST(
           MAX(cs.updated_at),
           MAX(dps.updated_at),
           MAX(ia.updated_at),
           MAX(sp.updated_at)
         ) AS last_activity
       FROM lobs l
       LEFT JOIN capacity_scenarios cs ON cs.lob_id = l.id
       LEFT JOIN demand_planner_scenarios dps ON dps.lob_id = l.id
       LEFT JOIN interaction_arrival ia ON ia.lob_id = l.id
       LEFT JOIN shrinkage_plans sp ON sp.lob_id = l.id
       WHERE l.organization_id = $1
       GROUP BY l.id, l.lob_name, l.created_at
       ORDER BY l.id ASC`,
      [user.organization_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('LOB Metadata Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch LOB metadata' });
  }
});

// ── Shrinkage Plans ───────────────────────────────────────────────────────────

app.get('/api/shrinkage-plan', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  try {
    const result = await pool.query(
      'SELECT * FROM shrinkage_plans WHERE organization_id = $1 AND lob_id = $2',
      [user.organization_id, lobId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Shrinkage Plan Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch shrinkage plan' });
  }
});

app.put('/api/shrinkage-plan', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  const { hours_per_day, days_per_week, net_fte_input, absence_items, activity_items } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO shrinkage_plans (organization_id, lob_id, hours_per_day, days_per_week, net_fte_input, absence_items, activity_items, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (organization_id, lob_id) DO UPDATE SET
         hours_per_day  = EXCLUDED.hours_per_day,
         days_per_week  = EXCLUDED.days_per_week,
         net_fte_input  = EXCLUDED.net_fte_input,
         absence_items  = EXCLUDED.absence_items,
         activity_items = EXCLUDED.activity_items,
         updated_at     = NOW()
       RETURNING *`,
      [user.organization_id, lobId, hours_per_day, days_per_week, net_fte_input ?? null,
       JSON.stringify(absence_items ?? []), JSON.stringify(activity_items ?? [])]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Shrinkage Plan Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save shrinkage plan' });
  }
});

// ── User Preferences (generic per-page UI state) ──────────────────────────────

app.get('/api/user-preferences', async (req, res) => {
  const user = getCurrentUser(req);
  const { page_key, lob_id } = req.query;
  if (!page_key) return res.status(400).json({ error: 'page_key is required' });
  const lobId = lob_id ? parseInt(lob_id) : null;
  try {
    const result = lobId
      ? await pool.query(
          'SELECT preferences FROM user_preferences WHERE organization_id = $1 AND lob_id = $2 AND page_key = $3',
          [user.organization_id, lobId, page_key]
        )
      : await pool.query(
          'SELECT preferences FROM user_preferences WHERE organization_id = $1 AND lob_id IS NULL AND page_key = $2',
          [user.organization_id, page_key]
        );
    res.json(result.rows[0]?.preferences ?? {});
  } catch (err) {
    console.error('User Preferences Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

app.put('/api/user-preferences', async (req, res) => {
  const user = getCurrentUser(req);
  const { page_key, lob_id } = req.query;
  if (!page_key) return res.status(400).json({ error: 'page_key is required' });
  const lobId = lob_id ? parseInt(lob_id) : null;
  const { preferences } = req.body;
  try {
    if (lobId) {
      // LOB-scoped: standard UNIQUE(org, lob_id, page_key) handles conflict
      await pool.query(
        `INSERT INTO user_preferences (organization_id, lob_id, page_key, preferences, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (organization_id, lob_id, page_key) DO UPDATE SET
           preferences = EXCLUDED.preferences, updated_at = NOW()`,
        [user.organization_id, lobId, page_key, JSON.stringify(preferences)]
      );
    } else {
      // Global (lob_id IS NULL): PostgreSQL treats NULLs as distinct in UNIQUE,
      // so use explicit UPDATE-then-INSERT pattern
      const upd = await pool.query(
        `UPDATE user_preferences SET preferences = $1, updated_at = NOW()
         WHERE organization_id = $2 AND lob_id IS NULL AND page_key = $3`,
        [JSON.stringify(preferences), user.organization_id, page_key]
      );
      if (upd.rowCount === 0) {
        await pool.query(
          `INSERT INTO user_preferences (organization_id, lob_id, page_key, preferences, updated_at)
           VALUES ($1, NULL, $2, $3, NOW())`,
          [user.organization_id, page_key, JSON.stringify(preferences)]
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('User Preferences Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// --- GET ROUTES ---

app.get('/api/agents', async (req, res) => {
  const user = getCurrentUser(req);
  try {
    const result = await pool.query('SELECT * FROM agents WHERE organization_id = $1', [user.organization_id]);
    res.json(result.rows);
  } catch (err) {
    console.error("Database Error:", err.message);
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.get('/api/forecasts', async (req, res) => {
  const user = getCurrentUser(req);
  const channel = req.query.channel || 'voice';
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  try {
    const result = await pool.query(
      `SELECT year_label, forecast_method, monthly_volumes, forecast_results,
              alpha, beta, gamma, total_volume, peak_volume, created_at, channel
       FROM forecasts
       WHERE organization_id = $1 AND channel = $2 AND lob_id = $3
       ORDER BY year_label ASC`,
      [user.organization_id, channel, lobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Forecasts List Error:", err.message);
    res.status(500).json({ error: "Failed to fetch forecasts" });
  }
});

app.get('/api/forecasts/latest', async (req, res) => {
  const user = getCurrentUser(req);
  const channel = req.query.channel || 'voice';
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  try {
    const result = await pool.query(
      'SELECT * FROM forecasts WHERE organization_id = $1 AND channel = $2 AND lob_id = $3 ORDER BY created_at DESC LIMIT 1',
      [user.organization_id, channel, lobId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error("Fetch Error:", err.message);
    res.status(500).send("Server Error");
  }
});

app.get('/api/forecasts/:year', async (req, res) => {
  const { year } = req.params;
  const user = getCurrentUser(req);
  const channel = req.query.channel || 'voice';
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  try {
    const result = await pool.query(
      'SELECT * FROM forecasts WHERE year_label = $1 AND organization_id = $2 AND channel = $3 AND lob_id = $4',
      [year, user.organization_id, channel, lobId]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error("Year Fetch Error:", err.message);
    res.status(500).json({ error: "Failed to fetch year data" });
  }
});

// --- CAPACITY SCENARIOS ROUTES ---

app.get('/api/capacity-scenarios', async (req, res) => {
  const user = getCurrentUser(req);
  const channel = req.query.channel || 'voice';
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  try {
    const result = await pool.query(
      'SELECT * FROM capacity_scenarios WHERE organization_id = $1 AND channel = $2 AND (lob_id = $3 OR lob_id IS NULL) ORDER BY created_at ASC',
      [user.organization_id, channel, lobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Scenarios Fetch Error:", err.message);
    res.status(500).json({ error: "Failed to fetch scenarios" });
  }
});

app.post('/api/capacity-scenarios', async (req, res) => {
  const user = getCurrentUser(req);
  const {
    scenario_name, forecast_year, aht, hours_op, work_days,
    day_pcts, shrinkage, occupancy, target_sl, asa, selected_week,
    actual_fte, actual_fte_start_date, attrition_pct, classes, channel, lob_id
  } = req.body;
  const targetChannel = channel || 'voice';
  const lobId = lob_id || await getDefaultLobId(user.organization_id);

  try {
    const result = await pool.query(
      `INSERT INTO capacity_scenarios
        (scenario_name, forecast_year, aht, hours_op, work_days, day_pcts,
         shrinkage, occupancy, target_sl, asa, selected_week,
         actual_fte, actual_fte_start_date, attrition_pct, classes, organization_id, channel, lob_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        scenario_name, forecast_year, aht, hours_op, work_days,
        JSON.stringify(day_pcts), shrinkage, occupancy, target_sl, asa, selected_week ?? 0,
        actual_fte ?? 0, actual_fte_start_date ?? '', attrition_pct ?? 0,
        JSON.stringify(classes || []), user.organization_id, targetChannel, lobId
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Scenario Create Error:", err.message);
    res.status(500).json({ error: "Failed to create scenario" });
  }
});

app.put('/api/capacity-scenarios/:id', async (req, res) => {
  const { id } = req.params;
  const user = getCurrentUser(req);
  const {
    scenario_name, forecast_year, aht, hours_op, work_days,
    day_pcts, shrinkage, occupancy, target_sl, asa, selected_week,
    actual_fte, actual_fte_start_date, attrition_pct, classes
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE capacity_scenarios SET
        scenario_name=$1, forecast_year=$2, aht=$3, hours_op=$4, work_days=$5,
        day_pcts=$6, shrinkage=$7, occupancy=$8, target_sl=$9, asa=$10,
        selected_week=$11, actual_fte=$12, actual_fte_start_date=$13,
        attrition_pct=$14, classes=$15, updated_at=NOW()
       WHERE id=$16 AND organization_id=$17 RETURNING *`,
      [
        scenario_name, forecast_year, aht, hours_op, work_days,
        JSON.stringify(day_pcts), shrinkage, occupancy, target_sl, asa,
        selected_week ?? 0, actual_fte ?? 0, actual_fte_start_date ?? '',
        attrition_pct ?? 0, JSON.stringify(classes || []), id, user.organization_id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Scenario not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Scenario Update Error:", err.message);
    res.status(500).json({ error: "Failed to update scenario" });
  }
});

app.delete('/api/capacity-scenarios/:id', async (req, res) => {
  const { id } = req.params;
  const user = getCurrentUser(req);
  try {
    await pool.query('DELETE FROM capacity_scenarios WHERE id=$1 AND organization_id=$2', [id, user.organization_id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Scenario Delete Error:", err.message);
    res.status(500).json({ error: "Failed to delete scenario" });
  }
});

// --- FORECAST ROUTES ---

app.post('/api/forecasts', async (req, res) => {
  const user = getCurrentUser(req);
  const { year_label, forecast_method, monthly_volumes, total_volume, peak_volume, forecast_results, alpha, beta, gamma, channel, lob_id } = req.body;
  const targetChannel = channel || 'voice';
  const lobId = lob_id || await getDefaultLobId(user.organization_id);

  try {
    const result = await pool.query(
      `INSERT INTO forecasts (year_label, forecast_method, monthly_volumes, total_volume, peak_volume, forecast_results, alpha, beta, gamma, organization_id, channel, lob_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT ON CONSTRAINT forecasts_year_lob_channel_key DO UPDATE SET
         forecast_method=EXCLUDED.forecast_method, monthly_volumes=EXCLUDED.monthly_volumes,
         total_volume=EXCLUDED.total_volume, peak_volume=EXCLUDED.peak_volume,
         forecast_results=EXCLUDED.forecast_results, alpha=EXCLUDED.alpha,
         beta=EXCLUDED.beta, gamma=EXCLUDED.gamma, created_at=NOW()
       RETURNING *`,
      [year_label, forecast_method, JSON.stringify(monthly_volumes), total_volume, peak_volume,
       JSON.stringify(forecast_results || []), alpha ?? 0.3, beta ?? 0.1, gamma ?? 0.2, user.organization_id, targetChannel, lobId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Database Error:", err.message);
    res.status(500).json({ error: "Failed to save forecast to database", details: err.message });
  }
});

app.delete('/api/forecasts/:year', async (req, res) => {
  const { year } = req.params;
  const user = getCurrentUser(req);
  const channel = req.query.channel || 'voice';
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);

  try {
    await pool.query(
      'DELETE FROM forecasts WHERE year_label = $1 AND organization_id = $2 AND channel = $3 AND lob_id = $4',
      [year, user.organization_id, channel, lobId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Delete Error:", err.message);
    res.status(500).json({ error: "Failed to delete forecast year" });
  }
});

// --- INTERACTION ARRIVAL ROUTES ---

app.get('/api/interaction-arrival', async (req, res) => {
  const { startDate, endDate, channel, lob_id } = req.query;
  const user = getCurrentUser(req);
  const targetChannel = channel || 'voice';
  const lobId = lob_id ? parseInt(lob_id) : await getDefaultLobId(user.organization_id);

  try {
    const result = await pool.query(
      `SELECT interval_date, interval_index, volume, aht, channel FROM interaction_arrival
       WHERE organization_id = $3 AND channel = $4 AND lob_id = $5 AND interval_date BETWEEN $1 AND $2
       ORDER BY interval_date ASC, interval_index ASC`,
      [startDate, endDate, user.organization_id, targetChannel, lobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Interaction Arrival Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch interaction arrival data' });
  }
});

app.post('/api/interaction-arrival', async (req, res) => {
  const { records, channel, lob_id } = req.body;
  const user = getCurrentUser(req);
  const targetChannel = channel || 'voice';
  const lobId = lob_id || await getDefaultLobId(user.organization_id);

  if (!Array.isArray(records) || records.length === 0)
    return res.status(400).json({ error: 'records array is required' });

  const BATCH_SIZE = 500;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const values = batch.map((_, j) =>
        `($${j*7+1},$${j*7+2},$${j*7+3},$${j*7+4},$${j*7+5},$${j*7+6},$${j*7+7})`
      ).join(',');

      const flat = batch.flatMap(r => [
        r.interval_date,
        r.interval_index,
        r.volume ?? 0,
        r.aht ?? 0,
        user.organization_id,
        r.channel || targetChannel,
        r.lob_id || lobId,
      ]);

      await client.query(
        `INSERT INTO interaction_arrival (interval_date, interval_index, volume, aht, organization_id, channel, lob_id)
         VALUES ${values}
         ON CONFLICT ON CONSTRAINT ia_date_idx_lob_channel_key DO UPDATE SET
           volume=EXCLUDED.volume, aht=EXCLUDED.aht, updated_at=NOW()`,
        flat
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, count: records.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Interaction Arrival Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save interaction arrival data' });
  } finally {
    client.release();
  }
});

app.post('/api/telephony/pull', async (req, res) => {
  const { system, date, startDate, endDate, channel } = req.body;

  if (system === 'genesys') {
    const targetChannel = channel || 'voice';
    const start = new Date((startDate || date) + 'T00:00:00');
    const end = new Date((endDate || date) + 'T00:00:00');
    const results = [];

    let current = new Date(start);
    while (current <= end) {
      const dateStr = current.getFullYear() + '-' +
                      String(current.getMonth() + 1).padStart(2, '0') + '-' +
                      String(current.getDate()).padStart(2, '0');

      const intervalVolumes = simulator.generateIntradayVolume(dateStr, targetChannel);

      const dayData = intervalVolumes.map((offer, i) => {
        const hour = Math.floor(i / 4);

        if (offer > 0) {
          const abandon = Math.floor(offer * 0.05);
          const answer = offer - abandon;
          const asa = Math.floor(Math.random() * 20 + 5);

          let slBase = 0.85;
          if (hour >= 10 && hour <= 14) slBase = 0.75;

          const slPct = Math.min(0.99, Math.max(0.5, slBase + (Math.random() * 0.15 - 0.05)));

          const avgTalk = targetChannel === 'email' ? Math.random() * 260 + 320 : targetChannel === 'chat' ? Math.random() * 180 + 220 : Math.random() * 200 + 200;
          const avgHold = targetChannel === 'email' ? Math.random() * 8 + 2 : Math.random() * 20 + 5;
          const avgAcw = targetChannel === 'chat' ? Math.random() * 25 + 15 : Math.random() * 40 + 20;

          return {
            date: dateStr,
            interval_index: i,
            offer: offer,
            answer: answer,
            abandon: abandon,
            asa: asa,
            avg_wait: asa + Math.floor(Math.random() * 3),
            avg_talk: Math.round(avgTalk),
            avg_hold: Math.round(avgHold),
            avg_acw: Math.round(avgAcw),
            avg_handle: Math.round(avgTalk + avgHold + avgAcw),
            sl_pct: slPct,
            hold_count: Math.floor(Math.random() * 2),
            transfer_count: Math.floor(Math.random() * 2),
            short_abandon: Math.floor(Math.random() * 1)
          };
        } else {
          return {
            date: dateStr,
            interval_index: i, offer: 0, answer: 0, abandon: 0, asa: 0,
            avg_wait: 0, avg_talk: 0, avg_hold: 0, avg_acw: 0, avg_handle: 0,
            sl_pct: 1, hold_count: 0, transfer_count: 0, short_abandon: 0
          };
        }
      });
      results.push(...dayData);
      current.setDate(current.getDate() + 1);
    }

    return res.json({ success: true, data: results });
  }

  return res.json({ success: false, message: `${system} integration not yet configured.` });
});

app.post('/api/genesys/sync', async (req, res) => {
  try {
    const targetChannel = req.body.channel || 'voice';
    const monthlyVolumes = Array.from({ length: 24 }, (_, monthIdx) => {
      return simulator.generateMonthlyVolume(monthIdx, targetChannel);
    });

    res.json({ success: true, channel: targetChannel, data: monthlyVolumes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/long-term-actuals', async (req, res) => {
  const user = getCurrentUser(req);
  const channel = req.query.channel || 'voice';
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);

  try {
    const result = await pool.query(
      `SELECT year_index, month_index, volume, updated_at, channel
       FROM long_term_actuals
       WHERE organization_id = $1 AND channel = $2 AND (lob_id = $3 OR lob_id IS NULL)
       ORDER BY year_index ASC, month_index ASC`,
      [user.organization_id, channel, lobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Long Term Actuals Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch long term actuals' });
  }
});

app.get('/api/demand-planner-scenarios', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);

  try {
    const result = await pool.query(
      `SELECT scenario_id, scenario_name, planner_snapshot, updated_at
       FROM demand_planner_scenarios
       WHERE organization_id = $1 AND (lob_id = $2 OR lob_id IS NULL)
       ORDER BY updated_at ASC`,
      [user.organization_id, lobId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Demand Planner Scenarios Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch demand planner scenarios' });
  }
});

app.put('/api/demand-planner-scenarios/:id', async (req, res) => {
  const user = getCurrentUser(req);
  const { id } = req.params;
  const { scenario_name, planner_snapshot, lob_id } = req.body;
  const lobId = lob_id || await getDefaultLobId(user.organization_id);

  if (!scenario_name || !planner_snapshot || typeof planner_snapshot !== 'object') {
    return res.status(400).json({ error: 'scenario_name and planner_snapshot are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO demand_planner_scenarios (scenario_id, scenario_name, planner_snapshot, organization_id, lob_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (scenario_id, organization_id) DO UPDATE SET
         scenario_name = EXCLUDED.scenario_name,
         planner_snapshot = EXCLUDED.planner_snapshot,
         lob_id = EXCLUDED.lob_id,
         updated_at = NOW()
       RETURNING scenario_id, scenario_name, planner_snapshot, updated_at`,
      [id, scenario_name, JSON.stringify(planner_snapshot), user.organization_id, lobId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Demand Planner Scenario Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save demand planner scenario' });
  }
});

app.delete('/api/demand-planner-scenarios/:id', async (req, res) => {
  const user = getCurrentUser(req);
  const { id } = req.params;

  try {
    await pool.query(
      'DELETE FROM demand_planner_scenarios WHERE scenario_id = $1 AND organization_id = $2',
      [id, user.organization_id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Demand Planner Scenario Delete Error:', err.message);
    res.status(500).json({ error: 'Failed to delete demand planner scenario' });
  }
});

app.get('/api/demand-planner-active-state', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  try {
    const result = await pool.query(
      'SELECT state_value FROM demand_planner_active_state WHERE organization_id = $1 AND lob_id = $2',
      [user.organization_id, lobId]
    );
    if (result.rows.length === 0) return res.json(null);
    res.json(result.rows[0].state_value);
  } catch (err) {
    console.error('Demand Planner Active State Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch active state' });
  }
});

app.put('/api/demand-planner-active-state', async (req, res) => {
  const user = getCurrentUser(req);
  const { state_value, lob_id } = req.body;
  const lobId = lob_id || await getDefaultLobId(user.organization_id);
  if (!state_value || typeof state_value !== 'object') {
    return res.status(400).json({ error: 'state_value is required' });
  }
  try {
    await pool.query(
      `INSERT INTO demand_planner_active_state (organization_id, lob_id, state_value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (organization_id, lob_id) DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()`,
      [user.organization_id, lobId, JSON.stringify(state_value)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Demand Planner Active State Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save active state' });
  }
});

// ── Demand Actuals (Re-cut) ───────────────────────────────────────────────────
app.get('/api/demand-actuals', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    const params = [user.organization_id, lobId];
    const yearClause = year ? ' AND year = $3' : '';
    if (year) params.push(year);
    const result = await pool.query(
      `SELECT year, month, channel, actual_volume, updated_at
       FROM demand_actuals
       WHERE organization_id = $1 AND lob_id = $2${yearClause}
       ORDER BY year, month, channel`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Demand Actuals Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch demand actuals' });
  }
});

app.put('/api/demand-actuals', async (req, res) => {
  const user = getCurrentUser(req);
  const { lob_id, year, month, channel, actual_volume } = req.body;
  if (!lob_id || !year || !month || !channel || actual_volume == null) {
    return res.status(400).json({ error: 'lob_id, year, month, channel, and actual_volume are required' });
  }
  try {
    await pool.query(
      `INSERT INTO demand_actuals (organization_id, lob_id, year, month, channel, actual_volume, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (organization_id, lob_id, year, month, channel)
       DO UPDATE SET actual_volume = EXCLUDED.actual_volume, updated_at = NOW()`,
      [user.organization_id, lob_id, year, month, channel, actual_volume]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Demand Actuals Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save demand actual' });
  }
});

// ── Distribution Profiles ─────────────────────────────────────────────────────
app.get('/api/distribution-profiles', async (req, res) => {
  try {
    const user = getCurrentUser(req);
    const lobId = parseInt(req.query.lob_id) || await getDefaultLobId(user.organization_id);
    const channel = req.query.channel || 'voice';
    const result = await pool.query(
      `SELECT * FROM distribution_profiles
       WHERE organization_id = $1 AND lob_id = $2 AND channel = $3
       ORDER BY updated_at DESC`,
      [user.organization_id, lobId, channel]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Distribution Profiles GET Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch distribution profiles' });
  }
});

app.post('/api/distribution-profiles', async (req, res) => {
  try {
    const user = getCurrentUser(req);
    const { lob_id, channel = 'voice', profile_name, interval_weights, day_weights,
            baseline_start_date, baseline_end_date, sample_day_count, notes } = req.body;
    if (!profile_name || !interval_weights || !day_weights) {
      return res.status(400).json({ error: 'profile_name, interval_weights, and day_weights are required' });
    }
    const lobId = lob_id || await getDefaultLobId(user.organization_id);
    const result = await pool.query(
      `INSERT INTO distribution_profiles
         (organization_id, lob_id, channel, profile_name, interval_weights, day_weights,
          baseline_start_date, baseline_end_date, sample_day_count, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [user.organization_id, lobId, channel, profile_name,
       JSON.stringify(interval_weights), JSON.stringify(day_weights),
       baseline_start_date || null, baseline_end_date || null,
       sample_day_count || null, notes || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Distribution Profiles POST Error:', err.message);
    res.status(500).json({ error: 'Failed to save distribution profile' });
  }
});

app.put('/api/distribution-profiles/:id', async (req, res) => {
  try {
    const user = getCurrentUser(req);
    const { profile_name, interval_weights, day_weights, notes } = req.body;
    const result = await pool.query(
      `UPDATE distribution_profiles
       SET profile_name = COALESCE($1, profile_name),
           interval_weights = COALESCE($2, interval_weights),
           day_weights = COALESCE($3, day_weights),
           notes = COALESCE($4, notes),
           updated_at = NOW()
       WHERE id = $5 AND organization_id = $6
       RETURNING *`,
      [profile_name || null,
       interval_weights ? JSON.stringify(interval_weights) : null,
       day_weights ? JSON.stringify(day_weights) : null,
       notes !== undefined ? notes : null,
       parseInt(req.params.id), user.organization_id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Profile not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Distribution Profiles PUT Error:', err.message);
    res.status(500).json({ error: 'Failed to update distribution profile' });
  }
});

app.delete('/api/distribution-profiles/:id', async (req, res) => {
  try {
    const user = getCurrentUser(req);
    await pool.query(
      'DELETE FROM distribution_profiles WHERE id = $1 AND organization_id = $2',
      [parseInt(req.params.id), user.organization_id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Distribution Profiles DELETE Error:', err.message);
    res.status(500).json({ error: 'Failed to delete distribution profile' });
  }
});

// ── LOB Settings ─────────────────────────────────────────────────────────────
app.get('/api/lob-settings', async (req, res) => {
  const user = getCurrentUser(req);
  try {
    if (req.query.lob_id) {
      const lobId = parseInt(req.query.lob_id);
      const result = await pool.query(
        `SELECT l.id AS lob_id, l.lob_name,
                ls.channels_enabled, ls.pooling_mode,
                ls.voice_aht, ls.voice_sla_target, ls.voice_sla_seconds, ls.voice_shrinkage, ls.voice_max_occupancy,
                ls.chat_aht, ls.chat_sla_target, ls.chat_sla_seconds, ls.chat_concurrency, ls.chat_shrinkage,
                ls.email_aht, ls.email_sla_target, ls.email_sla_seconds, ls.email_occupancy, ls.email_shrinkage,
                ls.hours_of_operation, ls.updated_at
         FROM lobs l
         LEFT JOIN lob_settings ls ON ls.lob_id = l.id AND ls.organization_id = $1
         WHERE l.id = $2 AND l.organization_id = $1`,
        [user.organization_id, lobId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'LOB not found' });
      res.json(result.rows[0]);
    } else {
      const result = await pool.query(
        `SELECT l.id AS lob_id, l.lob_name,
                ls.channels_enabled, ls.pooling_mode,
                ls.voice_aht, ls.voice_sla_target, ls.voice_sla_seconds, ls.voice_shrinkage, ls.voice_max_occupancy,
                ls.chat_aht, ls.chat_sla_target, ls.chat_sla_seconds, ls.chat_concurrency, ls.chat_shrinkage,
                ls.email_aht, ls.email_sla_target, ls.email_sla_seconds, ls.email_occupancy, ls.email_shrinkage,
                ls.hours_of_operation, ls.updated_at
         FROM lobs l
         LEFT JOIN lob_settings ls ON ls.lob_id = l.id AND ls.organization_id = $1
         WHERE l.organization_id = $1
         ORDER BY l.id ASC`,
        [user.organization_id]
      );
      res.json(result.rows);
    }
  } catch (err) {
    console.error('LOB Settings GET Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch LOB settings' });
  }
});

app.put('/api/lob-settings', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : null;
  if (!lobId) return res.status(400).json({ error: 'lob_id is required' });
  const {
    channels_enabled, pooling_mode,
    voice_aht, voice_sla_target, voice_sla_seconds,
    chat_aht, chat_sla_target, chat_sla_seconds, chat_concurrency,
    email_aht, email_sla_target, email_sla_seconds, email_occupancy,
    hours_of_operation,
  } = req.body;
  try {
    await pool.query(
      `INSERT INTO lob_settings
         (organization_id, lob_id, channels_enabled, pooling_mode,
          voice_aht, voice_sla_target, voice_sla_seconds,
          chat_aht, chat_sla_target, chat_sla_seconds, chat_concurrency,
          email_aht, email_sla_target, email_sla_seconds, email_occupancy,
          hours_of_operation, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
       ON CONFLICT (organization_id, lob_id) DO UPDATE SET
         channels_enabled   = EXCLUDED.channels_enabled,
         pooling_mode       = EXCLUDED.pooling_mode,
         voice_aht          = EXCLUDED.voice_aht,
         voice_sla_target   = EXCLUDED.voice_sla_target,
         voice_sla_seconds  = EXCLUDED.voice_sla_seconds,
         chat_aht           = EXCLUDED.chat_aht,
         chat_sla_target    = EXCLUDED.chat_sla_target,
         chat_sla_seconds   = EXCLUDED.chat_sla_seconds,
         chat_concurrency   = EXCLUDED.chat_concurrency,
         email_aht          = EXCLUDED.email_aht,
         email_sla_target   = EXCLUDED.email_sla_target,
         email_sla_seconds  = EXCLUDED.email_sla_seconds,
         email_occupancy    = EXCLUDED.email_occupancy,
         hours_of_operation = EXCLUDED.hours_of_operation,
         updated_at         = NOW()`,
      [
        user.organization_id, lobId,
        JSON.stringify(channels_enabled ?? { voice: true, email: false, chat: false, cases: false }),
        pooling_mode ?? 'dedicated',
        voice_aht ?? 300, voice_sla_target ?? 80, voice_sla_seconds ?? 20,
        chat_aht ?? 450, chat_sla_target ?? 80, chat_sla_seconds ?? 30, chat_concurrency ?? 2,
        email_aht ?? 600, email_sla_target ?? 90, email_sla_seconds ?? 14400, email_occupancy ?? 85,
        JSON.stringify(hours_of_operation ?? {}),
      ]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('LOB Settings PUT Error:', err.message);
    res.status(500).json({ error: 'Failed to save LOB settings' });
  }
});

// ── Scheduling: Agents ───────────────────────────────────────────────────────
app.get('/api/scheduling/agents', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM scheduling_agents WHERE organization_id = 1 ORDER BY full_name ASC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/scheduling/agents', async (req, res) => {
  const { employee_id, full_name, email, contract_type, skill_voice, skill_chat, skill_email, lob_assignments, accommodation_flags, availability, status, shift_length_hours, team_name, team_lead_id } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO scheduling_agents
         (organization_id, employee_id, full_name, email, contract_type, skill_voice, skill_chat, skill_email, lob_assignments, accommodation_flags, availability, status, shift_length_hours, team_name, team_lead_id)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [employee_id||null, full_name, email||null, contract_type||'full_time', skill_voice??true, skill_chat??false, skill_email??false, lob_assignments||[], accommodation_flags||[], JSON.stringify(availability||{}), status||'active', shift_length_hours ?? 9, team_name || null, team_lead_id || null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/scheduling/agents/:id', async (req, res) => {
  const { employee_id, full_name, email, contract_type, skill_voice, skill_chat, skill_email, lob_assignments, accommodation_flags, availability, status, shift_length_hours, team_name, team_lead_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE scheduling_agents SET
         employee_id=$1, full_name=$2, email=$3, contract_type=$4,
         skill_voice=$5, skill_chat=$6, skill_email=$7,
         lob_assignments=$8, accommodation_flags=$9, availability=$10,
         status=$11, shift_length_hours=$12, team_name=$13, team_lead_id=$14, updated_at=NOW()
       WHERE id=$15 AND organization_id=1 RETURNING *`,
      [employee_id||null, full_name, email||null, contract_type, skill_voice, skill_chat, skill_email, lob_assignments||[], accommodation_flags||[], JSON.stringify(availability||{}), status, shift_length_hours ?? 9, team_name || null, team_lead_id || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Agent not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/scheduling/agents/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM scheduling_agents WHERE id=$1 AND organization_id=1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scheduling: Shift Templates ───────────────────────────────────────────────
app.get('/api/scheduling/shift-templates', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM scheduling_shift_templates WHERE organization_id = 1 ORDER BY start_time ASC, name ASC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/scheduling/shift-templates', async (req, res) => {
  const { name, start_time, end_time, duration_hours, break_rules, channel_coverage, color, is_overnight } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO scheduling_shift_templates
         (organization_id, name, start_time, end_time, duration_hours, break_rules, channel_coverage, color, is_overnight)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [name, start_time, end_time, duration_hours||null, JSON.stringify(break_rules||[]), channel_coverage||[], color||'#6366f1', is_overnight??false]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/scheduling/shift-templates/:id', async (req, res) => {
  const { name, start_time, end_time, duration_hours, break_rules, channel_coverage, color, is_overnight } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE scheduling_shift_templates SET
         name=$1, start_time=$2, end_time=$3, duration_hours=$4,
         break_rules=$5, channel_coverage=$6, color=$7, is_overnight=$8, updated_at=NOW()
       WHERE id=$9 AND organization_id=1 RETURNING *`,
      [name, start_time, end_time, duration_hours||null, JSON.stringify(break_rules||[]), channel_coverage||[], color||'#6366f1', is_overnight??false, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Shift template not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/scheduling/shift-templates/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM scheduling_shift_templates WHERE id=$1 AND organization_id=1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scheduling: Labor Laws ────────────────────────────────────────────────────
app.get('/api/scheduling/labor-laws', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM scheduling_labor_laws WHERE organization_id = 1 ORDER BY is_preset DESC, jurisdiction_name ASC'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/scheduling/labor-laws', async (req, res) => {
  const { jurisdiction_name, jurisdiction_code, max_hours_per_day, max_hours_per_week, max_consecutive_days, overtime_threshold_daily, overtime_threshold_weekly, rest_hours_between_shifts, rest_days_per_week, meal_break_minutes, meal_break_after_hours, short_breaks_count, short_break_minutes, night_differential_pct, overtime_rate_multiplier, custom_rules, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO scheduling_labor_laws
         (organization_id, jurisdiction_name, jurisdiction_code, is_preset,
          max_hours_per_day, max_hours_per_week, max_consecutive_days,
          overtime_threshold_daily, overtime_threshold_weekly,
          rest_hours_between_shifts, rest_days_per_week,
          meal_break_minutes, meal_break_after_hours,
          short_breaks_count, short_break_minutes,
          night_differential_pct, overtime_rate_multiplier, custom_rules, notes)
       VALUES (1,$1,$2,false,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [jurisdiction_name, jurisdiction_code||null, max_hours_per_day||8, max_hours_per_week||40, max_consecutive_days||5, overtime_threshold_daily||null, overtime_threshold_weekly||40, rest_hours_between_shifts||8, rest_days_per_week||1, meal_break_minutes||60, meal_break_after_hours||5, short_breaks_count||2, short_break_minutes||15, night_differential_pct||0, overtime_rate_multiplier||1.25, JSON.stringify(custom_rules||{}), notes||null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/scheduling/labor-laws/:id', async (req, res) => {
  const { jurisdiction_name, jurisdiction_code, max_hours_per_day, max_hours_per_week, max_consecutive_days, overtime_threshold_daily, overtime_threshold_weekly, rest_hours_between_shifts, rest_days_per_week, meal_break_minutes, meal_break_after_hours, short_breaks_count, short_break_minutes, night_differential_pct, overtime_rate_multiplier, custom_rules, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE scheduling_labor_laws SET
         jurisdiction_name=$1, jurisdiction_code=$2,
         max_hours_per_day=$3, max_hours_per_week=$4, max_consecutive_days=$5,
         overtime_threshold_daily=$6, overtime_threshold_weekly=$7,
         rest_hours_between_shifts=$8, rest_days_per_week=$9,
         meal_break_minutes=$10, meal_break_after_hours=$11,
         short_breaks_count=$12, short_break_minutes=$13,
         night_differential_pct=$14, overtime_rate_multiplier=$15,
         custom_rules=$16, notes=$17, updated_at=NOW()
       WHERE id=$18 AND organization_id=1 AND is_preset=false RETURNING *`,
      [jurisdiction_name, jurisdiction_code||null, max_hours_per_day||8, max_hours_per_week||40, max_consecutive_days||5, overtime_threshold_daily||null, overtime_threshold_weekly||40, rest_hours_between_shifts||8, rest_days_per_week||1, meal_break_minutes||60, meal_break_after_hours||5, short_breaks_count||2, short_break_minutes||15, night_differential_pct||0, overtime_rate_multiplier||1.25, JSON.stringify(custom_rules||{}), notes||null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Rule not found or preset rules cannot be edited' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/scheduling/labor-laws/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM scheduling_labor_laws WHERE id=$1 AND organization_id=1 AND is_preset=false',
      [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Rule not found or preset rules cannot be deleted' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scheduling: Hub counts ────────────────────────────────────────────────────
app.get('/api/scheduling/counts', async (req, res) => {
  try {
    const [agents, shifts, laws] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM scheduling_agents WHERE organization_id=1'),
      pool.query('SELECT COUNT(*)::int AS n FROM scheduling_shift_templates WHERE organization_id=1'),
      pool.query('SELECT COUNT(*)::int AS n, SUM(CASE WHEN is_preset THEN 1 ELSE 0 END)::int AS presets FROM scheduling_labor_laws WHERE organization_id=1'),
    ]);
    res.json({ agents: agents.rows[0].n, shifts: shifts.rows[0].n, laws: laws.rows[0].n, lawPresets: laws.rows[0].presets });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scheduling: Assignments ───────────────────────────────────────────────────
app.get('/api/scheduling/assignments', async (req, res) => {
  const { lob_id, date_start, date_end } = req.query;
  try {
    const params = [1];
    let sql = `
      SELECT sa.*,
        json_agg(
          json_build_object(
            'id', act.id,
            'activity_type', act.activity_type,
            'start_time', act.start_time::text,
            'end_time', act.end_time::text,
            'is_paid', act.is_paid,
            'notes', act.notes
          ) ORDER BY act.start_time
        ) FILTER (WHERE act.id IS NOT NULL) AS activities,
        ag.full_name AS agent_name,
        ag.skill_voice, ag.skill_chat, ag.skill_email,
        st.name AS template_name, st.color AS template_color
      FROM schedule_assignments sa
      LEFT JOIN shift_activities act ON act.assignment_id = sa.id
      LEFT JOIN scheduling_agents ag ON ag.id = sa.agent_id
      LEFT JOIN scheduling_shift_templates st ON st.id = sa.shift_template_id
      WHERE sa.organization_id = $1
    `;
    if (lob_id) { params.push(lob_id); sql += ` AND sa.lob_id = $${params.length}`; }
    if (date_start) { params.push(date_start); sql += ` AND sa.work_date >= $${params.length}`; }
    if (date_end) { params.push(date_end); sql += ` AND sa.work_date <= $${params.length}`; }
    sql += ' GROUP BY sa.id, ag.full_name, ag.skill_voice, ag.skill_chat, ag.skill_email, st.name, st.color ORDER BY sa.work_date, sa.start_time';
    const { rows } = await pool.query(sql, params);
    // Ensure activities is always an array
    const result = rows.map(r => ({ ...r, activities: r.activities || [] }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/scheduling/assignments', async (req, res) => {
  const { lob_id, agent_id, shift_template_id, work_date, start_time, end_time, is_overnight, channel, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO schedule_assignments (organization_id, lob_id, agent_id, shift_template_id, work_date, start_time, end_time, is_overnight, channel, notes)
       VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [lob_id || null, agent_id, shift_template_id || null, work_date, start_time, end_time, is_overnight || false, channel || 'voice', notes || null]
    );
    res.json({ ...rows[0], activities: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/scheduling/assignments/:id', async (req, res) => {
  const { start_time, end_time, is_overnight, channel, notes, shift_template_id, agent_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE schedule_assignments
       SET start_time=$1, end_time=$2, is_overnight=$3, channel=$4, notes=$5, shift_template_id=$6,
           agent_id=COALESCE($8, agent_id), updated_at=NOW()
       WHERE id=$7 AND organization_id=1 RETURNING *`,
      [start_time, end_time, is_overnight ?? false, channel || 'voice', notes ?? null, shift_template_id ?? null, req.params.id, agent_id ?? null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/scheduling/assignments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM schedule_assignments WHERE id=$1 AND organization_id=1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk delete assignments in a date range for a LOB. Accepts status="draft"|"published"|"all" (default "draft").
app.post('/api/scheduling/assignments/bulk-delete', async (req, res) => {
  const { lob_id, date_start, date_end, status } = req.body;
  if (!lob_id || !date_start || !date_end) {
    return res.status(400).json({ error: 'lob_id, date_start, date_end required' });
  }
  const filter = status === 'published' ? `AND status='published'`
                : status === 'all' ? ''
                : `AND status='draft'`;
  try {
    const result = await pool.query(
      `DELETE FROM schedule_assignments
       WHERE organization_id=1 AND lob_id=$1 AND work_date BETWEEN $2 AND $3 ${filter}`,
      [lob_id, date_start, date_end]
    );
    res.json({ ok: true, deleted: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scheduling: Activities within a shift ─────────────────────────────────────
app.post('/api/scheduling/activities', async (req, res) => {
  const { assignment_id, activity_type, start_time, end_time, is_paid, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO shift_activities (assignment_id, activity_type, start_time, end_time, is_paid, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [assignment_id, activity_type, start_time, end_time, is_paid || false, notes || null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/scheduling/activities/:id', async (req, res) => {
  const { activity_type, start_time, end_time, is_paid, notes } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE shift_activities SET activity_type=$1, start_time=$2, end_time=$3, is_paid=$4, notes=$5
       WHERE id=$6 RETURNING *`,
      [activity_type, start_time, end_time, is_paid ?? false, notes ?? null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/scheduling/activities/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM shift_activities WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Scheduling: Bulk publish (local-first → DB) ─────────────────────────────
app.put('/api/scheduling/assignments-publish', async (req, res) => {
  const { lob_id, date_start, date_end, assignments } = req.body;
  if (!lob_id || !date_start || !date_end || !Array.isArray(assignments)) {
    return res.status(400).json({ error: 'lob_id, date_start, date_end, and assignments[] are required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Find existing assignment IDs in this date range
    const existing = await client.query(
      `SELECT id FROM schedule_assignments WHERE organization_id=1 AND lob_id=$1 AND work_date >= $2 AND work_date <= $3`,
      [lob_id, date_start, date_end]
    );
    const existingIds = existing.rows.map(r => r.id);

    // Delete activities then assignments for existing
    if (existingIds.length > 0) {
      await client.query(`DELETE FROM shift_activities WHERE assignment_id = ANY($1)`, [existingIds]);
      await client.query(`DELETE FROM schedule_assignments WHERE id = ANY($1)`, [existingIds]);
    }

    // Re-create all assignments with their activities
    for (const a of assignments) {
      const { rows } = await client.query(
        `INSERT INTO schedule_assignments (organization_id, lob_id, agent_id, shift_template_id, work_date, start_time, end_time, is_overnight, channel, notes, absence_type)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [lob_id, a.agent_id, a.shift_template_id || null, a.work_date, a.start_time, a.end_time, a.is_overnight || false, a.channel || 'voice', a.notes || null, a.absence_type || null]
      );
      const newId = rows[0].id;

      for (const act of (a.activities || [])) {
        await client.query(
          `INSERT INTO shift_activities (assignment_id, activity_type, start_time, end_time, is_paid, notes)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId, act.activity_type, act.start_time, act.end_time, act.is_paid || false, act.notes || null]
        );
      }
    }

    await client.query('COMMIT');

    // Re-fetch the full enriched data for the client
    const refreshSql = `
      SELECT sa.*,
        json_agg(
          json_build_object(
            'id', act.id,
            'activity_type', act.activity_type,
            'start_time', act.start_time::text,
            'end_time', act.end_time::text,
            'is_paid', act.is_paid,
            'notes', act.notes
          ) ORDER BY act.start_time
        ) FILTER (WHERE act.id IS NOT NULL) AS activities,
        ag.full_name AS agent_name,
        ag.skill_voice, ag.skill_chat, ag.skill_email,
        st.name AS template_name, st.color AS template_color
      FROM schedule_assignments sa
      LEFT JOIN shift_activities act ON act.assignment_id = sa.id
      LEFT JOIN scheduling_agents ag ON ag.id = sa.agent_id
      LEFT JOIN scheduling_shift_templates st ON st.id = sa.shift_template_id
      WHERE sa.organization_id = 1 AND sa.lob_id = $1 AND sa.work_date >= $2 AND sa.work_date <= $3
      GROUP BY sa.id, ag.full_name, ag.skill_voice, ag.skill_chat, ag.skill_email, st.name, st.color
      ORDER BY sa.work_date, sa.start_time`;
    const { rows: refreshed } = await client.query(refreshSql, [lob_id, date_start, date_end]);
    const result = refreshed.map(r => ({ ...r, activities: r.activities || [] }));
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── Auto-Scheduler: Demand Snapshots ────────────────────────────────────────
app.get('/api/scheduling/demand-snapshots', async (req, res) => {
  const lob_id = req.query.lob_id ? parseInt(req.query.lob_id) : null;
  if (!lob_id) return res.status(400).json({ error: 'lob_id required' });
  try {
    const snapshots = await pool.query(
      `SELECT id, snapshot_label, interval_minutes, approved_at, approved_by, notes
       FROM scheduling_demand_snapshots
       WHERE organization_id=1 AND lob_id=$1
       ORDER BY approved_at DESC`,
      [lob_id]
    );
    res.json(snapshots.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scheduling/demand-snapshots/:id', async (req, res) => {
  try {
    const snap = await pool.query(
      'SELECT * FROM scheduling_demand_snapshots WHERE id=$1',
      [req.params.id]
    );
    if (snap.rows.length === 0) return res.status(404).json({ error: 'not found' });
    const rows = await pool.query(
      'SELECT channel, weekday, interval_start::text AS interval_start, required_fte FROM scheduling_demand_snapshot_rows WHERE snapshot_id=$1 ORDER BY channel, weekday, interval_start',
      [req.params.id]
    );
    res.json({ ...snap.rows[0], rows: rows.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scheduling/demand-snapshots', async (req, res) => {
  const { lob_id, snapshot_label, interval_minutes, approved_by, notes, rows } = req.body;
  if (!lob_id || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'lob_id and rows[] required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await client.query(
      `INSERT INTO scheduling_demand_snapshots (lob_id, snapshot_label, interval_minutes, approved_by, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [lob_id, snapshot_label || null, interval_minutes || 30, approved_by || null, notes || null]
    );
    const snapshot_id = snap.rows[0].id;
    for (const r of rows) {
      await client.query(
        `INSERT INTO scheduling_demand_snapshot_rows (snapshot_id, channel, weekday, interval_start, required_fte)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (snapshot_id, channel, weekday, interval_start) DO UPDATE SET required_fte=EXCLUDED.required_fte`,
        [snapshot_id, r.channel || 'blended', r.weekday, r.interval_start, Number(r.required_fte) || 0]
      );
    }
    await client.query('COMMIT');
    res.json({ id: snapshot_id });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/scheduling/demand-snapshots/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM scheduling_demand_snapshots WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto-Scheduler: Generate ────────────────────────────────────────────────
app.post('/api/scheduling/auto-generate', async (req, res) => {
  const { lob_id, snapshot_id, horizon_start, horizon_end, fairness_enabled, clear_published, created_by } = req.body;
  if (!lob_id || !snapshot_id || !horizon_start || !horizon_end) {
    return res.status(400).json({ error: 'lob_id, snapshot_id, horizon_start, horizon_end required' });
  }
  try {
    if (clear_published) {
      await pool.query(
        `DELETE FROM schedule_assignments
         WHERE organization_id=1 AND lob_id=$1 AND work_date BETWEEN $2 AND $3 AND status='published'`,
        [lob_id, horizon_start, horizon_end]
      );
    }
    const result = await generateSchedule({
      pool, lob_id, snapshot_id, horizon_start, horizon_end,
      fairness_enabled: !!fairness_enabled, created_by: created_by || null,
    });
    res.json(result);
  } catch (err) {
    console.error('Auto-generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-Scheduler: Publish with scope ──────────────────────────────────────
app.post('/api/scheduling/publish', async (req, res) => {
  const { lob_id, date_start, date_end, scope, agent_ids, team_name } = req.body;
  if (!lob_id || !date_start || !date_end || !scope) {
    return res.status(400).json({ error: 'lob_id, date_start, date_end, scope required' });
  }
  try {
    let q, params;
    if (scope === 'agent') {
      if (!Array.isArray(agent_ids) || agent_ids.length === 0) {
        return res.status(400).json({ error: 'agent_ids[] required for scope=agent' });
      }
      q = `UPDATE schedule_assignments SET status='published', updated_at=NOW()
           WHERE organization_id=1 AND lob_id=$1 AND work_date BETWEEN $2 AND $3 AND status='draft' AND agent_id = ANY($4)`;
      params = [lob_id, date_start, date_end, agent_ids];
    } else if (scope === 'team') {
      if (!team_name) return res.status(400).json({ error: 'team_name required for scope=team' });
      q = `UPDATE schedule_assignments sa SET status='published', updated_at=NOW()
           FROM scheduling_agents ag
           WHERE sa.agent_id = ag.id AND ag.team_name = $4
             AND sa.organization_id=1 AND sa.lob_id=$1 AND sa.work_date BETWEEN $2 AND $3 AND sa.status='draft'`;
      params = [lob_id, date_start, date_end, team_name];
    } else if (scope === 'site') {
      q = `UPDATE schedule_assignments SET status='published', updated_at=NOW()
           WHERE organization_id=1 AND lob_id=$1 AND work_date BETWEEN $2 AND $3 AND status='draft'`;
      params = [lob_id, date_start, date_end];
    } else {
      return res.status(400).json({ error: 'scope must be agent|team|site' });
    }
    const result = await pool.query(q, params);
    res.json({ published_count: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-Scheduler: Generation runs ─────────────────────────────────────────
app.get('/api/scheduling/generation-runs', async (req, res) => {
  const lob_id = req.query.lob_id ? parseInt(req.query.lob_id) : null;
  if (!lob_id) return res.status(400).json({ error: 'lob_id required' });
  try {
    const runs = await pool.query(
      `SELECT id, snapshot_id, horizon_start, horizon_end, fairness_enabled,
              coverage_report, notes, created_at, created_by
       FROM schedule_generation_runs
       WHERE organization_id=1 AND lob_id=$1
       ORDER BY created_at DESC LIMIT 20`,
      [lob_id]
    );
    res.json(runs.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Capacity Plan Config ──────────────────────────────────────────────────────
app.get('/api/capacity-plan-config', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  const channel = req.query.channel || 'blended';
  try {
    const result = await pool.query(
      `SELECT * FROM capacity_plan_config WHERE organization_id = $1 AND lob_id = $2 AND channel = $3`,
      [user.organization_id, lobId, channel]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error('Capacity Plan Config Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch capacity plan config' });
  }
});

app.put('/api/capacity-plan-config', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  const channel = req.query.channel || 'blended';
  const {
    plan_start_date, horizon_weeks, attrition_rate_monthly,
    ramp_training_weeks, ramp_nesting_weeks, ramp_nesting_pct, starting_hc
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO capacity_plan_config
         (organization_id, lob_id, channel, plan_start_date, horizon_weeks,
          attrition_rate_monthly, ramp_training_weeks, ramp_nesting_weeks,
          ramp_nesting_pct, starting_hc, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (organization_id, lob_id, channel) DO UPDATE SET
         plan_start_date        = EXCLUDED.plan_start_date,
         horizon_weeks          = EXCLUDED.horizon_weeks,
         attrition_rate_monthly = EXCLUDED.attrition_rate_monthly,
         ramp_training_weeks    = EXCLUDED.ramp_training_weeks,
         ramp_nesting_weeks     = EXCLUDED.ramp_nesting_weeks,
         ramp_nesting_pct       = EXCLUDED.ramp_nesting_pct,
         starting_hc            = EXCLUDED.starting_hc,
         updated_at             = NOW()
       RETURNING *`,
      [user.organization_id, lobId, channel,
       plan_start_date, horizon_weeks ?? 26,
       attrition_rate_monthly ?? 2.0,
       ramp_training_weeks ?? 4, ramp_nesting_weeks ?? 2,
       ramp_nesting_pct ?? 50, starting_hc ?? 0]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Capacity Plan Config Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save capacity plan config' });
  }
});

// ── Capacity Plan Weekly Inputs ───────────────────────────────────────────────
app.get('/api/capacity-plan-inputs', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  const channel = req.query.channel || 'blended';
  try {
    const result = await pool.query(
      `SELECT * FROM capacity_plan_weekly_inputs
       WHERE organization_id = $1 AND lob_id = $2 AND channel = $3
       ORDER BY week_offset ASC`,
      [user.organization_id, lobId, channel]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Capacity Plan Inputs Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch capacity plan inputs' });
  }
});

app.put('/api/capacity-plan-inputs', async (req, res) => {
  const user = getCurrentUser(req);
  const lobId = req.query.lob_id ? parseInt(req.query.lob_id) : await getDefaultLobId(user.organization_id);
  const channel = req.query.channel || 'blended';
  const { week_offset, field, value } = req.body;
  if (week_offset == null || !field) {
    return res.status(400).json({ error: 'week_offset and field are required' });
  }
  const allowed = ['planned_hires','known_exits','actual_hc','actual_attrition',
    'vol_override_voice','vol_override_chat','vol_override_email','vol_override_cases',
    'aht_override_voice','aht_override_chat','aht_override_email','aht_override_cases'];
  if (!allowed.includes(field)) return res.status(400).json({ error: 'Invalid field' });
  try {
    await pool.query(
      `INSERT INTO capacity_plan_weekly_inputs
         (organization_id, lob_id, channel, week_offset, ${field}, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (organization_id, lob_id, channel, week_offset) DO UPDATE
         SET ${field} = EXCLUDED.${field}, updated_at = NOW()`,
      [user.organization_id, lobId, channel, week_offset, value]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Capacity Plan Input Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save capacity plan input' });
  }
});

app.use(express.static(distPath));

// ── Statistical normalization: clamp outlier week volumes to Poisson ±2σ fence ─
// Winsorizes outlier weeks to their nearest fence boundary (upper or lower).
// No external API required.
app.post('/api/ai/normalize-week', (req, res) => {
  const { weeks } = req.body;
  if (!weeks?.length) return res.status(400).json({ error: 'No weeks provided' });

  const outlierWeeks = weeks.filter(w => w.isOutlier);
  if (!outlierWeeks.length) return res.json({ suggestions: [] });

  // Poisson baseline — use only non-outlier weeks so the mean isn't skewed
  const normalVolumes = weeks.map(w => w.volume).filter(v => v > 0 && !weeks.find(x => x.volume === v && x.isOutlier));
  const baseVolumes = normalVolumes.length ? normalVolumes : weeks.map(w => w.volume).filter(v => v > 0);
  const mean = baseVolumes.reduce((a, b) => a + b, 0) / (baseVolumes.length || 1);
  const sigma = Math.sqrt(Math.max(mean, 1));
  const lower = Math.max(0, mean - 2 * sigma);
  const upper = mean + 2 * sigma;

  const suggestions = outlierWeeks.map(w => {
    const isHigh = w.volume > upper;
    const clamped = Math.round(isHigh ? upper : lower);
    const pctDiff = Math.round(Math.abs(w.volume - (isHigh ? upper : lower)) / mean * 100);
    const reason = isHigh
      ? `${pctDiff}% above expected range — clamped to upper fence`
      : `${pctDiff}% below expected range — clamped to lower fence`;
    return { weekIndex: w.index, suggestedVolume: clamped, reason, confidence: 'High' };
  });

  res.json({ suggestions });
});

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

ensureAppTables()
  .then(() => ensureAdminAuth())
  .then(() => {
    app.listen(process.env.PORT || 5000, () => {
      console.log(`Backend Server is running on http://localhost:${process.env.PORT || 5000}`);
    });
  })
  .catch((error) => {
    console.error('Startup schema initialization failed:', error.message);
    process.exit(1);
  });
