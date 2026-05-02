const crypto = require('crypto');
const { pool } = require('../db.cjs');

const IS_PROD = process.env.NODE_ENV === 'production';

const SESSION_SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (IS_PROD) {
    console.error(
      '[auth] FATAL: SESSION_SECRET is required in production.\n' +
      '       Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
    process.exit(1);
  }
  const ephemeral = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[auth] SESSION_SECRET not set — using an ephemeral secret. ' +
    'All sessions will be invalidated on restart. Set SESSION_SECRET in .env for persistence.'
  );
  return ephemeral;
})();

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (Date.now() - payload.iat > TOKEN_TTL_MS) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(cookieHeader.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k.trim(), decodeURIComponent(v.join('='))];
  }));
}

function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie',
    `wfm_token=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${12 * 3600}${IS_PROD ? '; Secure' : ''}`
  );
}

// Verifies wfm_token cookie, attaches req.user. Rejects tokens missing
// userId or organizationId — every authenticated request must carry a
// tenant boundary so downstream queries can scope by organization_id
// without falling back to a hardcoded default.
//
// Also re-checks the user against the DB on every request:
//   - User row must still exist (account not deleted).
//   - is_active must still be true (account not deactivated).
// Without this, a previously issued JWT remained valid for its full
// 12h TTL even after an admin clicked "Deactivate user" — the smoke
// test for PR #3c surfaced the gap. The DB-resolved values for role
// and organization_id are also what land on req.user, so a role demote
// or org move takes effect on the next request rather than on next
// login.
async function authenticateToken(req, res, next) {
  const token = parseCookies(req.headers.cookie).wfm_token;
  const payload = verifyToken(token);
  if (!payload || !payload.userId || !payload.organizationId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let row;
  try {
    const result = await pool.query(
      'SELECT id, email, role, organization_id, is_active FROM users WHERE id = $1',
      [payload.userId]
    );
    row = result.rows[0];
  } catch (err) {
    console.error('[auth] DB lookup failed:', err.message);
    return res.status(500).json({ error: 'Auth check failed' });
  }
  if (!row || !row.is_active) {
    return res.status(401).json({ error: 'User not found or inactive' });
  }
  req.user = {
    id: row.id,
    email: row.email,
    role: row.role,
    organization_id: row.organization_id,
  };
  next();
}

module.exports = { authenticateToken, signToken, verifyToken, parseCookies, setAuthCookie };
