const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors()); 
app.use(express.json());

// 1. Connection to pgAdmin 4 / PostgreSQL
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'exordium_db',
  password: '837177',
  port: 5432,
});

// --- GET ROUTES ---

// Fetch all agents
app.get('/api/agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agents'); 
    res.json(result.rows);
  } catch (err) {
    console.error("Database Error:", err.message);
    res.status(500).json({ error: "Database connection failed" });
  }
});

// ✅ NEW: Fetch ALL saved forecast years (used by Capacity Planning)
app.get('/api/forecasts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (year_label) year_label, forecast_method, monthly_volumes, total_volume, peak_volume, created_at
       FROM forecasts
       ORDER BY year_label ASC, created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Forecasts List Error:", err.message);
    res.status(500).json({ error: "Failed to fetch forecasts" });
  }
});

// Fetch the absolute LATEST forecast saved
// ⚠️ NOTE: This must come BEFORE /api/forecasts/:year or Express will treat "latest" as a :year param
app.get('/api/forecasts/latest', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM forecasts ORDER BY created_at DESC LIMIT 1'
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error("Fetch Error:", err.message);
    res.status(500).send("Server Error");
  }
  });

// Fetch forecast for a SPECIFIC year (e.g., /api/forecasts/Year 2)
app.get('/api/forecasts/:year', async (req, res) => {
  const { year } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM forecasts WHERE year_label = $1 ORDER BY created_at DESC LIMIT 1',
      [year]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error("Year Fetch Error:", err.message);
    res.status(500).json({ error: "Failed to fetch year data" });
  }
});

// --- CAPACITY SCENARIOS ROUTES ---

// Fetch all scenarios
app.get('/api/capacity-scenarios', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM capacity_scenarios ORDER BY created_at ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Scenarios Fetch Error:", err.message);
    res.status(500).json({ error: "Failed to fetch scenarios" });
  }
});

// Create a new scenario
app.post('/api/capacity-scenarios', async (req, res) => {
  const {
    scenario_name, forecast_year, aht, hours_op, work_days,
    day_pcts, shrinkage, occupancy, target_sl, asa, selected_week
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO capacity_scenarios
        (scenario_name, forecast_year, aht, hours_op, work_days, day_pcts, shrinkage, occupancy, target_sl, asa, selected_week)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        scenario_name, forecast_year, aht, hours_op, work_days,
        JSON.stringify(day_pcts), shrinkage, occupancy, target_sl, asa, selected_week ?? 0
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Scenario Create Error:", err.message);
    res.status(500).json({ error: "Failed to create scenario" });
  }
});

// Update an existing scenario (auto-save & manual save both hit this)
app.put('/api/capacity-scenarios/:id', async (req, res) => {
      const { id } = req.params;
  const {
    scenario_name, forecast_year, aht, hours_op, work_days,
    day_pcts, shrinkage, occupancy, target_sl, asa, selected_week
  } = req.body;
  try {
    const result = await pool.query(
      `UPDATE capacity_scenarios SET
        scenario_name=$1, forecast_year=$2, aht=$3, hours_op=$4, work_days=$5,
        day_pcts=$6, shrinkage=$7, occupancy=$8, target_sl=$9, asa=$10,
        selected_week=$11, updated_at=NOW()
       WHERE id=$12
       RETURNING *`,
      [
        scenario_name, forecast_year, aht, hours_op, work_days,
        JSON.stringify(day_pcts), shrinkage, occupancy, target_sl, asa,
        selected_week ?? 0, id
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Scenario not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Scenario Update Error:", err.message);
    res.status(500).json({ error: "Failed to update scenario" });
  }
});

// Delete a scenario
app.delete('/api/capacity-scenarios/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM capacity_scenarios WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Scenario Delete Error:", err.message);
    res.status(500).json({ error: "Failed to delete scenario" });
  }
});

// --- POST ROUTES ---

// Genesys sync placeholder
app.post('/api/genesys/sync', async (req, res) => {
  console.log("Sync request received from frontend");
  try {
    const dummyVolumeData = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650];
    res.json({ success: true, data: dummyVolumeData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Save forecast data
app.post('/api/forecasts', async (req, res) => {
  const { year_label, forecast_method, monthly_volumes, total_volume, peak_volume } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO forecasts (year_label, forecast_method, monthly_volumes, total_volume, peak_volume) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [year_label, forecast_method, JSON.stringify(monthly_volumes), total_volume, peak_volume]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Database Error:", err.message);
    res.status(500).json({ error: "Failed to save forecast to database" });
  }
});
// ─── INTERACTION ARRIVAL ROUTES ───────────────────────────────────────────────
// Add these routes to your server.cjs before the "START SERVER" comment

// GET  /api/interaction-arrival?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
app.get('/api/interaction-arrival', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const result = await pool.query(
      `SELECT interval_date, interval_index, volume, aht
       FROM interaction_arrival
       WHERE interval_date BETWEEN $1 AND $2
       ORDER BY interval_date ASC, interval_index ASC`,
      [startDate, endDate]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Interaction Arrival Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch interaction arrival data' });
  }
});

// POST /api/interaction-arrival  — batch upsert (all 15-min records)
app.post('/api/interaction-arrival', async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required' });
  }
  try {
    // Build a single multi-row upsert for performance
    const values = records.map((r, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(',');
    const flat   = records.flatMap(r => [r.interval_date, r.interval_index, r.volume ?? 0, r.aht ?? 0]);
    await pool.query(
      `INSERT INTO interaction_arrival (interval_date, interval_index, volume, aht)
       VALUES ${values}
       ON CONFLICT (interval_date, interval_index) DO UPDATE SET
         volume     = EXCLUDED.volume,
         aht        = EXCLUDED.aht,
         updated_at = NOW()`,
      flat
    );
    res.json({ success: true, count: records.length });
  } catch (err) {
    console.error('Interaction Arrival Save Error:', err.message);
    res.status(500).json({ error: 'Failed to save interaction arrival data' });
  }
});

// POST /api/telephony/pull  — pull intraday data from a telephony system
app.post('/api/telephony/pull', async (req, res) => {
  const { system, date, queue } = req.body;

  if (system === 'genesys') {
    // ── Genesys Cloud ──────────────────────────────────────────────────────────
    // Replace the block below with your real Genesys API call.
    // For now it returns realistic-looking sample data for the requested date.
    console.log(`Genesys pull requested: date=${date} queue=${queue || 'all'}`);
    const data = Array.from({ length: 96 }, (_, i) => {
      const hour = Math.floor(i / 4);
      // Simulate a typical call center bell curve peaking around 10AM and 2PM
      const baseVol = hour < 7 ? 5
        : hour < 9  ? 30
        : hour < 12 ? 80
        : hour < 13 ? 50
        : hour < 16 ? 75
        : hour < 18 ? 40
        : hour < 20 ? 20
        : 5;
      return {
        interval_index: i,
        volume: Math.round(baseVol + (Math.random() - 0.5) * 10),
        aht:    Math.round(240 + (Math.random() - 0.5) * 60),
      };
    });
    return res.json({ success: true, data });
  }

  if (system === 'avaya') {
    // ── Avaya ──────────────────────────────────────────────────────────────────
    // TODO: implement Avaya CMS / Oceana API call
    return res.json({ success: false, message: 'Avaya integration not yet configured. Add your CMS credentials to server.cjs.' });
  }

  if (system === 'iex') {
    // ── NICE IEX ───────────────────────────────────────────────────────────────
    // TODO: implement IEX TotalView API call
    return res.json({ success: false, message: 'IEX TotalView integration not yet configured.' });
  }

  if (system === 'five9') {
    // TODO: Five9 REST API
    return res.json({ success: false, message: 'Five9 integration not yet configured.' });
  }

  if (system === 'nice') {
    // TODO: NICE CXone API
    return res.json({ success: false, message: 'NICE CXone integration not yet configured.' });
  }

  if (system === 'cisco') {
    // TODO: Cisco UCCE API
    return res.json({ success: false, message: 'Cisco UCCE integration not yet configured.' });
  }

  // Custom / unknown
  return res.json({ success: false, message: `Unknown system "${system}". Contact your admin.` });
});

// --- START SERVER ---
app.listen(5000, () => {
  console.log('Backend Server is running on http://localhost:5000');
});