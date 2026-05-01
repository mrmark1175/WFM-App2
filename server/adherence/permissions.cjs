async function getLinkedAgentForUser(pool, user) {
  const { rows } = await pool.query(
    `SELECT *
     FROM scheduling_agents
     WHERE organization_id=$1 AND user_id=$2 AND status <> 'inactive'
     ORDER BY id
     LIMIT 1`,
    [user.organization_id, user.id]
  );
  return rows[0] || null;
}

function canViewAdherence(user) {
  return ['super_admin', 'client_admin', 'rta', 'supervisor'].includes(user?.role);
}

function canCorrectPunch(user) {
  return ['super_admin', 'client_admin', 'rta', 'supervisor'].includes(user?.role);
}

function canConfigureAdherence(user) {
  return ['super_admin', 'client_admin'].includes(user?.role);
}

module.exports = {
  getLinkedAgentForUser,
  canViewAdherence,
  canCorrectPunch,
  canConfigureAdherence,
};
