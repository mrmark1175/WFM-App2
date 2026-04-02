const { Pool } = require('pg');

function parseBoolean(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function getPoolConfig() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    return {
      connectionString,
      ssl: parseBoolean(process.env.PGSSL, true)
        ? { rejectUnauthorized: false }
        : false,
    };
  }

  return {
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'exordium_db',
    password: process.env.PGPASSWORD || '837177',
    port: Number(process.env.PGPORT) || 5432,
    ssl: parseBoolean(process.env.PGSSL, false)
      ? { rejectUnauthorized: false }
      : false,
  };
}

module.exports = {
  pool: new Pool(getPoolConfig()),
};
