const express = require('express');
const path = require('path');
const cors = require('cors');
const { getCurrentUser } = require('./auth.cjs');
const { pool } = require('./db.cjs');

const app = express();
const distPath = path.resolve(__dirname, '../dist');
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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
}

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

app.use(express.static(distPath));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

ensureAppTables()
  .then(() => {
    app.listen(process.env.PORT || 5000, () => {
      console.log(`Backend Server is running on http://localhost:${process.env.PORT || 5000}`);
    });
  })
  .catch((error) => {
    console.error('Startup schema initialization failed:', error.message);
    process.exit(1);
  });
