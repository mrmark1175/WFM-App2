/**
 * Returns the authenticated user attached by `authenticateToken` middleware,
 * or null. There is intentionally NO fallback — historically this returned
 * a synthetic `{ organization_id: 1, role: 'read_only' }` user when no token
 * was present, which silently demoted unauthenticated traffic into org 1
 * instead of rejecting it. With multiple organizations in the live DB that
 * fallback was an active cross-tenant leak waiting to happen.
 *
 * Every `/api/*` route is gated by `authenticateToken` in `server.cjs`, so
 * by the time a route handler reaches this function `req.user` is always
 * populated. If it isn't, that means a route was somehow mounted outside
 * the gate — surface it as a clear failure rather than papering over it.
 */
function getCurrentUser(req) {
  return req.user || null;
}

module.exports = { getCurrentUser };
