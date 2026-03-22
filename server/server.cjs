const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors()); 
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'exordium_db',
  password: '837177',
  port: 5432,
});

// --- CALL VOLUME SIMULATION ENGINE ---

class CallVolumeSimulator {
  constructor() {
    this.baseVolume = 15000; // Standard monthly base
    this.monthlySeasonality = [
      1.05, 0.85, 0.95, 1.00, 1.05, 1.10, 
      0.90, 0.95, 1.00, 1.15, 1.30, 1.45
    ]; // Jan - Dec
    this.trendFactor = 1.02; // +2% MoM growth
  }

  generateMonthlyVolume(monthIdx) {
    // V = (Base * Trend^t * Seasonality) + Noise
    const trend = Math.pow(this.trendFactor, monthIdx);
    const seasonality = this.monthlySeasonality[monthIdx % 12];
    
    // Add ±5% random noise
    const noise = 1 + (Math.random() * 0.1 - 0.05);
    
    // Anomaly: July typically has a dip due to holidays
    const anomaly = monthIdx === 6 ? 0.92 : 1.0;

    const totalVolume = this.baseVolume * trend * seasonality * noise * anomaly;
    return Math.round(totalVolume);
  }

  generateIntradayVolume(dateStr) {
    const dayWeights = [0.3, 1.3, 1.1, 1.0, 1.0, 0.9, 0.4]; // Sun - Sat
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    const dowFactor = dayWeights[dayOfWeek];

    // Returns 96 intervals (15-min)
    return Array.from({ length: 96 }, (_, i) => {
      const hour = Math.floor(i / 4);
      let todFactor = 0.05; // Night baseline

      // Standard 8-6 Bell Curve
      if (hour >= 8 && hour <= 10) todFactor = 0.2 + (hour - 8) * 0.4; // Ramp
      else if (hour > 10 && hour <= 14) todFactor = 1.1; // Peak
      else if (hour > 14 && hour <= 17) todFactor = 1.0 - (hour - 14) * 0.2; // Decline
      else if (hour > 17 && hour <= 20) todFactor = 0.3; // Evening

      const baseInterval = (this.baseVolume / 30 / 96);
      const noise = 1 + (Math.random() * 0.2 - 0.1);
      
      return Math.round(baseInterval * dowFactor * todFactor * noise);
    });
  }
}

const simulator = new CallVolumeSimulator();

// --- GET ROUTES ---

app.get('/api/agents', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM agents'); 
    res.json(result.rows);
  } catch (err) {
    console.error("Database Error:", err.message);
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.get('/api/forecasts', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT year_label, forecast_method, monthly_volumes, forecast_results,
              alpha, beta, gamma, total_volume, peak_volume, created_at
       FROM forecasts ORDER BY year_label ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Forecasts List Error:", err.message);
    res.status(500).json({ error: "Failed to fetch forecasts" });
  }
});

app.get('/api/forecasts/latest', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM forecasts ORDER BY created_at DESC LIMIT 1');
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error("Fetch Error:", err.message);
    res.status(500).send("Server Error");
  }
});

app.get('/api/forecasts/:year', async (req, res) => {
  const { year } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM forecasts WHERE year_label = $1', [year]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    console.error("Year Fetch Error:", err.message);
    res.status(500).json({ error: "Failed to fetch year data" });
  }
});

// --- CAPACITY SCENARIOS ROUTES ---

app.get('/api/capacity-scenarios', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM capacity_scenarios ORDER BY created_at ASC');
    res.json(result.rows);
  } catch (err) {
    console.error("Scenarios Fetch Error:", err.message);
    res.status(500).json({ error: "Failed to fetch scenarios" });
  }
});

app.post('/api/capacity-scenarios', async (req, res) => {
  const {
    scenario_name, forecast_year, aht, hours_op, work_days,
    day_pcts, shrinkage, occupancy, target_sl, asa, selected_week,
    actual_fte, actual_fte_start_date, attrition_pct, classes
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO capacity_scenarios
        (scenario_name, forecast_year, aht, hours_op, work_days, day_pcts,
         shrinkage, occupancy, target_sl, asa, selected_week,
         actual_fte, actual_fte_start_date, attrition_pct, classes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        scenario_name, forecast_year, aht, hours_op, work_days,
        JSON.stringify(day_pcts), shrinkage, occupancy, target_sl, asa, selected_week ?? 0,
        actual_fte ?? 0, actual_fte_start_date ?? '', attrition_pct ?? 0,
        JSON.stringify(classes || [])
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
       WHERE id=$16 RETURNING *`,
      [
        scenario_name, forecast_year, aht, hours_op, work_days,
        JSON.stringify(day_pcts), shrinkage, occupancy, target_sl, asa,
        selected_week ?? 0, actual_fte ?? 0, actual_fte_start_date ?? '',
        attrition_pct ?? 0, JSON.stringify(classes || []), id
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
  try {
    await pool.query('DELETE FROM capacity_scenarios WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Scenario Delete Error:", err.message);
    res.status(500).json({ error: "Failed to delete scenario" });
  }
});

// --- FORECAST ROUTES ---

app.post('/api/forecasts', async (req, res) => {
  const { year_label, forecast_method, monthly_volumes, total_volume, peak_volume, forecast_results, alpha, beta, gamma } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO forecasts (year_label, forecast_method, monthly_volumes, total_volume, peak_volume, forecast_results, alpha, beta, gamma)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (year_label) DO UPDATE SET
         forecast_method=EXCLUDED.forecast_method, monthly_volumes=EXCLUDED.monthly_volumes,
         total_volume=EXCLUDED.total_volume, peak_volume=EXCLUDED.peak_volume,
         forecast_results=EXCLUDED.forecast_results, alpha=EXCLUDED.alpha,
         beta=EXCLUDED.beta, gamma=EXCLUDED.gamma, created_at=NOW()
       RETURNING *`,
      [year_label, forecast_method, JSON.stringify(monthly_volumes), total_volume, peak_volume,
       JSON.stringify(forecast_results || []), alpha ?? 0.3, beta ?? 0.1, gamma ?? 0.2]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Database Error:", err.message);
    res.status(500).json({ error: "Failed to save forecast to database" });
  }
});

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

// --- INTERACTION ARRIVAL ROUTES ---

app.get('/api/interaction-arrival', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    const result = await pool.query(
      `SELECT interval_date, interval_index, volume, aht FROM interaction_arrival
       WHERE interval_date BETWEEN $1 AND $2 ORDER BY interval_date ASC, interval_index ASC`,
      [startDate, endDate]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Interaction Arrival Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch interaction arrival data' });
  }
});

app.post('/api/interaction-arrival', async (req, res) => {
  const { records } = req.body;
  if (!Array.isArray(records) || records.length === 0)
    return res.status(400).json({ error: 'records array is required' });

  const BATCH_SIZE = 500;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const values = batch.map((_, j) =>
        `($${j*4+1},$${j*4+2},$${j*4+3},$${j*4+4})`
      ).join(',');
      const flat = batch.flatMap(r => [
        r.interval_date, r.interval_index, r.volume ?? 0, r.aht ?? 0
      ]);

      await client.query(
        `INSERT INTO interaction_arrival (interval_date, interval_index, volume, aht)
         VALUES ${values}
         ON CONFLICT (interval_date, interval_index) DO UPDATE SET
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
  const { system, date, startDate, endDate } = req.body;
  
  if (system === 'genesys') {
    const start = new Date((startDate || date) + 'T00:00:00');
    const end = new Date((endDate || date) + 'T00:00:00');
    const results = [];
    
    let current = new Date(start);
    while (current <= end) {
      const dateStr = current.getFullYear() + '-' + 
                      String(current.getMonth() + 1).padStart(2, '0') + '-' + 
                      String(current.getDate()).padStart(2, '0');
      
      const intervalVolumes = simulator.generateIntradayVolume(dateStr);
      
      const dayData = intervalVolumes.map((offer, i) => {
        const hour = Math.floor(i / 4);
        
        if (offer > 0) {
          const abandon = Math.floor(offer * 0.05);
          const answer = offer - abandon;
          const asa = Math.floor(Math.random() * 20 + 5);
          
          let slBase = 0.85; 
          if (hour >= 10 && hour <= 14) slBase = 0.75; 
          
          const slPct = Math.min(0.99, Math.max(0.5, slBase + (Math.random() * 0.15 - 0.05)));
          
          const avgTalk = Math.random() * 200 + 200;
          const avgHold = Math.random() * 20 + 5;
          const avgAcw = Math.random() * 40 + 20;
          
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
    // Return 24 months of historical data for better statistical forecasting
    const monthlyVolumes = Array.from({ length: 24 }, (_, monthIdx) => {
      return simulator.generateMonthlyVolume(monthIdx);
    });
    
    res.json({ success: true, data: monthlyVolumes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(5000, () => { console.log('Backend Server is running on http://localhost:5000'); });
