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
  try {
    const result = await pool.query(
      `SELECT year_label, forecast_method, monthly_volumes, forecast_results,
              alpha, beta, gamma, total_volume, peak_volume, created_at, channel
       FROM forecasts 
       WHERE organization_id = $1 AND channel = $2
       ORDER BY year_label ASC`,
      [user.organization_id, channel]
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
  try {
    const result = await pool.query(
      'SELECT * FROM forecasts WHERE organization_id = $1 AND channel = $2 ORDER BY created_at DESC LIMIT 1',
      [user.organization_id, channel]
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
  try {
    const result = await pool.query(
      'SELECT * FROM forecasts WHERE year_label = $1 AND organization_id = $2 AND channel = $3', 
      [year, user.organization_id, channel]
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
  try {
    const result = await pool.query(
      'SELECT * FROM capacity_scenarios WHERE organization_id = $1 AND channel = $2 ORDER BY created_at ASC',
      [user.organization_id, channel]
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
    actual_fte, actual_fte_start_date, attrition_pct, classes, channel
  } = req.body;
  const targetChannel = channel || 'voice';

  try {
    const result = await pool.query(
      `INSERT INTO capacity_scenarios
        (scenario_name, forecast_year, aht, hours_op, work_days, day_pcts,
         shrinkage, occupancy, target_sl, asa, selected_week,
         actual_fte, actual_fte_start_date, attrition_pct, classes, organization_id, channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        scenario_name, forecast_year, aht, hours_op, work_days,
        JSON.stringify(day_pcts), shrinkage, occupancy, target_sl, asa, selected_week ?? 0,
        actual_fte ?? 0, actual_fte_start_date ?? '', attrition_pct ?? 0,
        JSON.stringify(classes || []), user.organization_id, targetChannel
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
  
  // Note: We don't update channel here typically, or if we do, we need it in body.
  // Assuming channel is immutable for a scenario or passed in body if mutable.
  // For backward compatibility, we stick to updating fields, but we should scope by channel if possible?
  // Actually, ID is unique PK, so finding by ID is enough. But we add org_id check.
  // We can leave channel out of WHERE clause since ID is specific.
  
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
  const { year_label, forecast_method, monthly_volumes, total_volume, peak_volume, forecast_results, alpha, beta, gamma, channel } = req.body;
  const targetChannel = channel || 'voice';

  try {
    const result = await pool.query(
      `INSERT INTO forecasts (year_label, forecast_method, monthly_volumes, total_volume, peak_volume, forecast_results, alpha, beta, gamma, organization_id, channel)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (year_label, organization_id, channel) DO UPDATE SET
         forecast_method=EXCLUDED.forecast_method, monthly_volumes=EXCLUDED.monthly_volumes,
         total_volume=EXCLUDED.total_volume, peak_volume=EXCLUDED.peak_volume,
         forecast_results=EXCLUDED.forecast_results, alpha=EXCLUDED.alpha,
         beta=EXCLUDED.beta, gamma=EXCLUDED.gamma, created_at=NOW()
       RETURNING *`,
      [year_label, forecast_method, JSON.stringify(monthly_volumes), total_volume, peak_volume,
       JSON.stringify(forecast_results || []), alpha ?? 0.3, beta ?? 0.1, gamma ?? 0.2, user.organization_id, targetChannel]
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
  
  try {
    await pool.query('DELETE FROM forecasts WHERE year_label = $1 AND organization_id = $2 AND channel = $3', [year, user.organization_id, channel]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete Error:", err.message);
    res.status(500).json({ error: "Failed to delete forecast year" });
  }
});

// --- INTERACTION ARRIVAL ROUTES ---

app.get('/api/interaction-arrival', async (req, res) => {
  const { startDate, endDate, channel } = req.query;
  const user = getCurrentUser(req);
  const targetChannel = channel || 'voice';

  try {
    const result = await pool.query(
      `SELECT interval_date, interval_index, volume, aht, channel FROM interaction_arrival
       WHERE organization_id = $3 AND channel = $4 AND interval_date BETWEEN $1 AND $2 ORDER BY interval_date ASC, interval_index ASC`,
      [startDate, endDate, user.organization_id, targetChannel]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Interaction Arrival Fetch Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch interaction arrival data' });
  }
});

app.post('/api/interaction-arrival', async (req, res) => {
  const { records, channel } = req.body;
  const user = getCurrentUser(req);
  const targetChannel = channel || 'voice'; // If entire batch is for one channel, passed in body.
  
  if (!Array.isArray(records) || records.length === 0)
    return res.status(400).json({ error: 'records array is required' });

  const BATCH_SIZE = 500;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      // Allow record-level channel override, else fallback to body-level, else 'voice'
      const values = batch.map((_, j) =>
        `($${j*6+1},$${j*6+2},$${j*6+3},$${j*6+4},$${j*6+5},$${j*6+6})`
      ).join(',');
      
      const flat = batch.flatMap(r => [
        r.interval_date, 
        r.interval_index, 
        r.volume ?? 0, 
        r.aht ?? 0, 
        user.organization_id,
        r.channel || targetChannel 
      ]);

      await client.query(
        `INSERT INTO interaction_arrival (interval_date, interval_index, volume, aht, organization_id, channel)
         VALUES ${values}
         ON CONFLICT (interval_date, interval_index, organization_id, channel) DO UPDATE SET
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
    // Return 24 months of historical data for better statistical forecasting
    const monthlyVolumes = Array.from({ length: 24 }, (_, monthIdx) => {
      return simulator.generateMonthlyVolume(monthIdx, targetChannel);
    });
    
    res.json({ success: true, channel: targetChannel, data: monthlyVolumes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.use(express.static(distPath));

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(process.env.PORT || 5000, () => { console.log(`Backend Server is running on http://localhost:${process.env.PORT || 5000}`); });

