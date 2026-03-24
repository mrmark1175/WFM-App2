
/**
 * Mock authentication system.
 * Allows a request-scoped organization override while keeping org 1 as the
 * backward-compatible default until real authentication is implemented.
 */
function getDefaultOrganizationId() {
  const value = Number(process.env.DEFAULT_ORGANIZATION_ID);
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function getCurrentUser(req) {
  const headerOrgId = Number(
    req?.headers?.['x-organization-id'] ?? req?.headers?.['x-org-id']
  );
  const organizationId =
    Number.isInteger(headerOrgId) && headerOrgId > 0
      ? headerOrgId
      : getDefaultOrganizationId();

  return {
    id: 1,
    organization_id: organizationId,
    role: 'ADMIN',
    name: 'Mock Admin'
  };
}

module.exports = {
  getCurrentUser
};
