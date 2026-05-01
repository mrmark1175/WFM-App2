
const { pool } = require('./db.cjs');

async function checkForecastsSchema() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'forecasts'
    `);
    console.table(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

checkForecastsSchema();
