// Returns middleware that allows only the specified roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// Ensures the authenticated user belongs to the same org as the resource being accessed.
// super_admin bypasses this check.
function requireSameOrg(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role === 'super_admin') return next();
  const targetOrgId = parseInt(
    req.params.orgId || req.body?.organization_id || req.query?.organization_id
  );
  if (targetOrgId && targetOrgId !== req.user.organization_id) {
    return res.status(403).json({ error: 'Access denied: wrong organization' });
  }
  next();
}

module.exports = { requireRole, requireSameOrg };
