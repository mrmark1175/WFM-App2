
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'exordium_db',
  password: '837177',
  port: 5432,
});

async function reproduceInsertError() {
  const year_label = '2027-Chat-Test';
  const forecast_method = 'Prophet';
  const monthly_volumes = [];
  const total_volume = 1000;
  const peak_volume = 100;
  const forecast_results = [];
  const alpha = 0.3;
  const beta = 0.1;
  const gamma = 0.2;
  const organization_id = 1;
  const channel = 'chat';

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
       JSON.stringify(forecast_results || []), alpha, beta, gamma, organization_id, channel]
    );
    console.log('Success:', result.rows[0]);
  } catch (err) {
    console.error('Insert Error:', err);
  } finally {
    await pool.end();
  }
}

reproduceInsertError();
