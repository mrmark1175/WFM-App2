
const { pool } = require('./db.cjs');

async function updateSchemaMultichannel() {
  const tables = [
    'forecasts', 
    'interaction_arrival', 
    'capacity_scenarios', 
    'long_term_actuals', 
    'capacity_settings', 
    'forecast_ui_settings'
  ];

  try {
    for (const table of tables) {
      console.log(`Updating table: ${table}`);
      
      // Add channel column
      await pool.query(`
        ALTER TABLE ${table} 
        ADD COLUMN IF NOT EXISTS channel VARCHAR DEFAULT 'voice'
      `);
      
      // Backfill existing NULLs just in case, though DEFAULT handles new ones.
      // Existing rows should have NULL if the column was just added? 
      // No, ADD COLUMN ... DEFAULT 'voice' automatically fills existing rows with 'voice' in Postgres 11+.
      // But to be safe for older versions or if it was nullable first:
      await pool.query(`
        UPDATE ${table} SET channel = 'voice' WHERE channel IS NULL
      `);

      console.log(`Table ${table} updated.`);
    }

    // Update Unique Constraints
    console.log('Updating constraints...');

    // 1. Forecasts
    // Old: forecasts_year_label_org_unique (year_label, organization_id)
    await pool.query('ALTER TABLE forecasts DROP CONSTRAINT IF EXISTS forecasts_year_label_org_unique');
    await pool.query('ALTER TABLE forecasts ADD CONSTRAINT forecasts_year_label_org_channel_unique UNIQUE (year_label, organization_id, channel)');

    // 2. Interaction Arrival
    // Old: interaction_arrival_org_unique (interval_date, interval_index, organization_id)
    await pool.query('ALTER TABLE interaction_arrival DROP CONSTRAINT IF EXISTS interaction_arrival_org_unique');
    await pool.query('ALTER TABLE interaction_arrival ADD CONSTRAINT interaction_arrival_org_channel_unique UNIQUE (interval_date, interval_index, organization_id, channel)');

    console.log('Constraints updated successfully.');

  } catch (err) {
    console.error('Error updating schema:', err.message);
  } finally {
    await pool.end();
  }
}

updateSchemaMultichannel();
