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

// Fetch ALL saved forecast years (used by Capacity Planning & Forecasting)
app.get('/api/forecasts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT year_label, forecast_method, monthly_volumes, forecast_results,
              alpha, beta, gamma, total_volume, peak_volume, created_at
       FROM forecasts
       ORDER BY year_label ASC`
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
      'SELECT * FROM forecasts WHERE year_label = $1',
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

// UPSERT forecast data — saves actuals + projection + model params per year
// Uses ON CONFLICT so saving the same year twice updates instead of duplicating
app.post('/api/forecasts', async (req, res) => {
  const {
    year_label, forecast_method, monthly_volumes,
    total_volume, peak_volume,
    forecast_results, alpha, beta, gamma
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO forecasts
         (year_label, forecast_method, monthly_volumes, total_volume, peak_volume,
          forecast_results, alpha, beta, gamma)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (year_label) DO UPDATE SET
         forecast_method  = EXCLUDED.forecast_method,
         monthly_volumes  = EXCLUDED.monthly_volumes,
         total_volume     = EXCLUDED.total_volume,
         peak_volume      = EXCLUDED.peak_volume,
         forecast_results = EXCLUDED.forecast_results,
         alpha            = EXCLUDED.alpha,
         beta             = EXCLUDED.beta,
         gamma            = EXCLUDED.gamma,
         created_at       = NOW()
       RETURNING *`,
      [
        year_label,
        forecast_method,
        JSON.stringify(monthly_volumes),
        total_volume,
        peak_volume,
        JSON.stringify(forecast_results || []),
        alpha  ?? 0.3,
        beta   ?? 0.1,
        gamma  ?? 0.2,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Database Error:", err.message);
    res.status(500).json({ error: "Failed to save forecast to database" });
  }
});

// Delete a forecast year from the database
app.delete('/api/forecasts/:year', async (req, res) => {
  const { year } = req.params;
  try {
    await pool.query('DELETE FROM forecasts WHERE year_label = $1', [year]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete Error:", err.message);
    res.status(500).json({ error: "Failed to delete forecast year" });
  }
});

// --- START SERVER ---
app.listen(5000, () => {
  console.log('Backend Server is running on http://localhost:5000');
});
