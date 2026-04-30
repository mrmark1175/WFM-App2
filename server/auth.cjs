/**
 * Compatibility shim: all routes call getCurrentUser(req) to get the
 * authenticated user. Now that real auth sets req.user via authenticateToken,
 * this just returns req.user directly.
 */
function getCurrentUser(req) {
  return req.user || { id: null, organization_id: 1, role: 'read_only', name: 'Unknown' };
}

module.exports = { getCurrentUser };
