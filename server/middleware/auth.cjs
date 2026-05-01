const crypto = require('crypto');

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

// Verifies wfm_token cookie, attaches req.user. Rejects old tokens without userId.
function authenticateToken(req, res, next) {
  const token = parseCookies(req.headers.cookie).wfm_token;
  const payload = verifyToken(token);
  if (!payload || !payload.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = {
    id: payload.userId,
    email: payload.email,
    role: payload.role,
    organization_id: payload.organizationId,
  };
  next();
}

module.exports = { authenticateToken, signToken, verifyToken, parseCookies, setAuthCookie };
