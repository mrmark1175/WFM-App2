/**
 * Seed script: creates the Exordium Internal org and a super_admin user.
 * Safe to run multiple times (upserts, never duplicates).
 *
 * Usage:
 *   node scripts/seed.cjs
 *
 * Required env vars (set in .env or export before running):
 *   SUPER_ADMIN_EMAIL    — the super admin's email address
 *   SUPER_ADMIN_PASSWORD — the super admin's password (min 8 chars)
 *   DATABASE_URL or PGHOST/PGUSER/PGPASSWORD/PGDATABASE
 */

try { require('dotenv').config({ path: require('path').join(__dirname, '../.env') }); } catch {}

const bcrypt = require('bcryptjs');
const { pool } = require('../server/db.cjs');

async function seed() {
  const email = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = (process.env.SUPER_ADMIN_PASSWORD || '').trim();
  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;

  if (!email || !password) {
    console.error('Error: SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Error: SUPER_ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  try {
    // 1. Upsert the Exordium Internal organization
    await pool.query(`
      INSERT INTO organizations (name, slug, is_active)
      VALUES ('Exordium Internal', 'exordium', true)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    `);
    const orgResult = await pool.query(`SELECT id FROM organizations WHERE slug = 'exordium'`);
    const orgId = orgResult.rows[0].id;
    console.log(`[seed] Organization "Exordium Internal" → id=${orgId}`);

    // 2. Upsert the super_admin user
    const hash = await bcrypt.hash(password, saltRounds);
    await pool.query(`
      INSERT INTO users (organization_id, email, password_hash, full_name, role, is_active)
      VALUES ($1, $2, $3, 'Super Admin', 'super_admin', true)
      ON CONFLICT (organization_id, email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash, updated_at = NOW()
    `, [orgId, email, hash]);

    console.log(`[seed] Super admin user: ${email}`);
    console.log('[seed] Done — run npm run start and log in with the credentials above.');
  } catch (err) {
    console.error('[seed] Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
