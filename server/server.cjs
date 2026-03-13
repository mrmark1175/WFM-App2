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

// --- START SERVER ---
app.listen(5000, () => {
  console.log('Backend Server is running on http://localhost:5000');
});
