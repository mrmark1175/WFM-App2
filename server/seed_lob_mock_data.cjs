/**
 * seed_lob_mock_data.cjs
 *
 * Generates realistic 15-minute interval data from 2026-04-01 to 2028-12-31
 * across 3 LOBs and their respective channels.
 *
 * Usage:
 *   node server/seed_lob_mock_data.cjs
 *
 * Requires DATABASE_URL or individual PG* env vars in .env
 */

// Load .env without requiring dotenv package
const fs = require('fs');
const path = require('path');
try {
  const envPath = path.join(__dirname, '../.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && !process.env[key]) process.env[key] = val;
  }
} catch (_) { /* .env not present — rely on shell env vars */ }

const { Pool } = require('pg');

// ── DB connection (mirrors db.cjs logic) ─────────────────────────────────────
function getPoolConfig() {
  const cs = process.env.DATABASE_URL;
  if (cs) return { connectionString: cs, ssl: { rejectUnauthorized: false } };
  return {
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'exordium_db',
    password: process.env.PGPASSWORD || '837177',
    port: Number(process.env.PGPORT) || 5432,
    ssl: false,
  };
}
const pool = new Pool(getPoolConfig());

// ── LOB definitions ───────────────────────────────────────────────────────────
const LOB_DEFINITIONS = [
  {
    name: 'Inbound Sales',
    channels: [
      { channel: 'voice', direction: 'Inbound',  baseDaily: 800,  ahtRange: [240, 360], concurrency: 1.0, yoyGrowth: 0.08 },
      { channel: 'voice', direction: 'Outbound', baseDaily: 400,  ahtRange: [180, 300], concurrency: 1.0, yoyGrowth: 0.08 },
      { channel: 'email', direction: 'Inbound',  baseDaily: 250,  ahtRange: [420, 600], concurrency: 1.0, yoyGrowth: 0.06 },
    ],
  },
  {
    name: 'Technical Support',
    channels: [
      { channel: 'voice', direction: 'Inbound',  baseDaily: 1200, ahtRange: [480, 600], concurrency: 1.0, yoyGrowth: 0.05 },
      { channel: 'chat',  direction: 'Inbound',  baseDaily: 600,  ahtRange: [300, 420], concurrency: 1.8, yoyGrowth: 0.10 },
    ],
  },
  {
    name: 'Digital & Self-Service',
    channels: [
      { channel: 'chat',  direction: 'Inbound',  baseDaily: 1500, ahtRange: [180, 240], concurrency: 2.5, yoyGrowth: 0.15 },
    ],
  },
];

// ── Monthly seasonality multipliers ──────────────────────────────────────────
const SEASONALITY = {
  'Inbound Sales':           [1.25, 0.90, 0.95, 0.95, 1.00, 0.90, 0.85, 0.90, 1.00, 1.10, 1.30, 1.40],
  'Technical Support':       [0.95, 0.90, 1.00, 1.05, 1.10, 1.05, 0.95, 1.00, 1.10, 1.15, 1.05, 0.90],
  'Digital & Self-Service':  [0.90, 0.85, 0.95, 1.00, 1.05, 1.10, 1.15, 1.10, 1.00, 1.00, 0.95, 0.90],
};

// ── Intraday shape (96 slots) — interpolated from 24-hour profile ─────────────
function buildIntradayShape(channel, direction) {
  const hour24 = [];
  if (channel === 'voice' && direction === 'Inbound') {
    // Bimodal: morning peak 9-11, afternoon 14-16
    for (let h = 0; h < 24; h++) {
      let v = 0.02;
      if (h >= 8  && h < 9)  v = 0.30;
      if (h >= 9  && h < 11) v = 0.90 + (h === 10 ? 0.10 : 0);
      if (h >= 11 && h < 12) v = 0.75;
      if (h >= 12 && h < 13) v = 0.60;
      if (h >= 13 && h < 14) v = 0.70;
      if (h >= 14 && h < 16) v = 0.88 + (h === 14 ? 0.12 : 0);
      if (h >= 16 && h < 17) v = 0.65;
      if (h >= 17 && h < 18) v = 0.40;
      hour24.push(v);
    }
  } else if (channel === 'voice' && direction === 'Outbound') {
    // Unimodal 10:00-14:00 (dialing window)
    for (let h = 0; h < 24; h++) {
      let v = 0.01;
      if (h >= 9  && h < 10) v = 0.50;
      if (h >= 10 && h < 14) v = 1.00;
      if (h >= 14 && h < 15) v = 0.70;
      if (h >= 15 && h < 17) v = 0.30;
      hour24.push(v);
    }
  } else if (channel === 'email') {
    // Flat business hours 08-17
    for (let h = 0; h < 24; h++) {
      hour24.push(h >= 8 && h < 17 ? 0.80 : 0.02);
    }
  } else if (channel === 'chat') {
    // Gradual ramp, plateau 10-20, sharp drop
    for (let h = 0; h < 24; h++) {
      let v = 0.02;
      if (h >= 8  && h < 10) v = 0.40 + (h - 8) * 0.20;
      if (h >= 10 && h < 20) v = 1.00;
      if (h >= 20 && h < 22) v = 0.50 - (h - 20) * 0.20;
      hour24.push(v);
    }
  } else {
    for (let h = 0; h < 24; h++) hour24.push(0.5);
  }
  // Expand to 96 slots (each hour → 4 quarter-hour slots)
  const slots96 = [];
  for (let i = 0; i < 96; i++) {
    const h = Math.floor(i / 4);
    const bias = [0.94, 1.02, 1.05, 0.99][i % 4];
    slots96.push(hour24[h] * bias);
  }
  // Normalise so sum = 1
  const total = slots96.reduce((a, b) => a + b, 0);
  return slots96.map(v => v / total);
}

// ── Simple deterministic noise ────────────────────────────────────────────────
function noise(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 1 + (((h >>> 0) / 4294967295) * 2 - 1) * 0.07;
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function addDays(date, n) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}
function toStr(date) {
  return date.toISOString().split('T')[0];
}

// ── Main seed function ────────────────────────────────────────────────────────
async function seed() {
  const client = await pool.connect();
  console.log('Connected to database.');

  try {
    // 1. Ensure LOBs exist
    const lobIds = {};
    for (const def of LOB_DEFINITIONS) {
      const res = await client.query(
        `INSERT INTO lobs (organization_id, lob_name)
         VALUES (1, $1)
         ON CONFLICT (organization_id, lob_name) DO UPDATE SET lob_name = EXCLUDED.lob_name
         RETURNING id`,
        [def.name]
      );
      lobIds[def.name] = res.rows[0].id;
      console.log(`LOB "${def.name}" → id ${lobIds[def.name]}`);
    }

    const START = new Date('2024-01-01T00:00:00Z');
    const END   = new Date('2028-12-31T00:00:00Z');

    // 2. Clear existing seed data for these LOBs (idempotent re-run)
    for (const lobId of Object.values(lobIds)) {
      await client.query('DELETE FROM interaction_arrival WHERE lob_id = $1', [lobId]);
    }
    console.log('Cleared existing seed data.');

    // 3. Generate and insert interval records
    const BATCH_SIZE = 1000;
    let totalRows = 0;

    for (const lob of LOB_DEFINITIONS) {
      const lobId = lobIds[lob.name];
      console.log(`\nSeeding LOB: ${lob.name} (id=${lobId})`);

      for (const ch of lob.channels) {
        const shape = buildIntradayShape(ch.channel, ch.direction);
        console.log(`  Channel: ${ch.channel} (${ch.direction})`);

        let batch = [];
        let current = new Date(START);

        while (current <= END) {
          const dateStr = toStr(current);
          const year = current.getUTCFullYear();
          const month = current.getUTCMonth(); // 0-based

          // Year-over-year growth (relative to 2024)
          const yearsElapsed = year - 2024 + (month / 12);
          const yoyFactor = Math.pow(1 + ch.yoyGrowth, yearsElapsed);

          // Monthly seasonality
          const season = SEASONALITY[lob.name][month];

          // Day-of-week factor
          const dow = current.getUTCDay();
          const dowFactor = [0.35, 1.15, 1.08, 1.03, 1.05, 0.90, 0.40][dow];

          const dailyVolume = ch.baseDaily * yoyFactor * season * dowFactor * noise(`${lob.name}-${ch.channel}-${ch.direction}-${dateStr}`);
          const avgAht = (ch.ahtRange[0] + ch.ahtRange[1]) / 2;

          for (let slot = 0; slot < 96; slot++) {
            const slotVol = Math.max(0, Math.round(dailyVolume * shape[slot] * noise(`slot-${lob.name}-${ch.channel}-${dateStr}-${slot}`)));
            const slotAht = Math.max(30, Math.round(avgAht * noise(`aht-${lob.name}-${ch.channel}-${dateStr}-${slot}`)));

            batch.push({
              interval_date: dateStr,
              interval_index: slot,
              volume: slotVol,
              aht: slotAht,
              organization_id: 1,
              channel: ch.channel,
              lob_id: lobId,
              direction: ch.direction,
              target_sl_percent: ch.channel === 'email' ? 95.0 : ch.channel === 'chat' ? 80.0 : 80.0,
              target_tt_seconds: ch.channel === 'email' ? 86400 : ch.channel === 'chat' ? 30 : 20,
              concurrency_factor: ch.concurrency,
            });

            if (batch.length >= BATCH_SIZE) {
              await insertBatch(client, batch);
              totalRows += batch.length;
              process.stdout.write(`\r  Rows inserted: ${totalRows}`);
              batch = [];
            }
          }

          current = addDays(current, 1);
        }

        if (batch.length > 0) {
          await insertBatch(client, batch);
          totalRows += batch.length;
          process.stdout.write(`\r  Rows inserted: ${totalRows}`);
          batch = [];
        }
      }
    }

    console.log(`\n\nDone! Total rows inserted: ${totalRows}`);

    // 4. Seed long_term_actuals (monthly aggregates per LOB/channel)
    console.log('\nSeeding long_term_actuals...');
    for (const lob of LOB_DEFINITIONS) {
      const lobId = lobIds[lob.name];
      await client.query('DELETE FROM long_term_actuals WHERE lob_id = $1', [lobId]);

      for (const ch of lob.channels) {
        // Aggregate from what we just inserted
        const res = await client.query(
          `SELECT
             EXTRACT(YEAR FROM interval_date)::int  AS yr,
             EXTRACT(MONTH FROM interval_date)::int AS mo,
             SUM(volume)::int AS vol
           FROM interaction_arrival
           WHERE lob_id = $1 AND channel = $2
           GROUP BY yr, mo
           ORDER BY yr, mo`,
          [lobId, ch.channel]
        );

        for (const row of res.rows) {
          const yearIndex  = row.yr - 2024;
          const monthIndex = row.mo - 1; // 0-based
          await client.query(
            `INSERT INTO long_term_actuals (year_index, month_index, volume, channel, organization_id, lob_id, updated_at)
             VALUES ($1, $2, $3, $4, 1, $5, NOW())
             ON CONFLICT DO NOTHING`,
            [yearIndex, monthIndex, row.vol, ch.channel, lobId]
          );
        }
      }
      console.log(`  ${lob.name}: long_term_actuals seeded`);
    }

    console.log('\nAll done!');
  } catch (err) {
    console.error('Seed error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function insertBatch(client, records) {
  const N = 11;
  const values = records.map((_, j) =>
    `(${Array.from({ length: N }, (__, k) => `$${j * N + k + 1}`).join(',')})`
  ).join(',');

  const flat = records.flatMap(r => [
    r.interval_date,
    r.interval_index,
    r.volume,
    r.aht,
    r.organization_id,
    r.channel,
    r.lob_id,
    r.direction,
    r.target_sl_percent,
    r.target_tt_seconds,
    r.concurrency_factor,
  ]);

  await client.query(
    `INSERT INTO interaction_arrival
       (interval_date, interval_index, volume, aht, organization_id, channel, lob_id,
        direction, target_sl_percent, target_tt_seconds, concurrency_factor)
     VALUES ${values}
     ON CONFLICT (interval_date, interval_index, lob_id, channel) DO UPDATE SET
       volume = EXCLUDED.volume,
       aht = EXCLUDED.aht,
       direction = EXCLUDED.direction,
       target_sl_percent = EXCLUDED.target_sl_percent,
       target_tt_seconds = EXCLUDED.target_tt_seconds,
       concurrency_factor = EXCLUDED.concurrency_factor,
       updated_at = NOW()`,
    flat
  );
}

seed();
