const { Pool } = require('pg');

function parseBoolean(value, fallback = false) {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function failMissing(missing) {
  console.error(
    `[db] FATAL: missing required environment variable(s): ${missing.join(', ')}.\n` +
    `      Set DATABASE_URL, or set all of PGHOST, PGUSER, PGPASSWORD, PGDATABASE.\n` +
    `      Optional: PGPORT (default 5432), PGSSL (default false; true when DATABASE_URL is set).`
  );
  process.exit(1);
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

  const required = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) failMissing(missing);

  return {
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: Number(process.env.PGPORT) || 5432,
    ssl: parseBoolean(process.env.PGSSL, false)
      ? { rejectUnauthorized: false }
      : false,
  };
}

module.exports = {
  pool: new Pool(getPoolConfig()),
};
