const { ACTIVITY, normalizeActivityType, activityLabel } = require('./types.cjs');

function timeToMinutes(value) {
  const [h, m] = String(value || '00:00').slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function dateTimeFor(workDate, timeValue, dayOffset = 0) {
  const base = new Date(`${workDate}T00:00:00`);
  return addMinutes(base, dayOffset * 1440 + timeToMinutes(timeValue));
}

function sortActivities(activities) {
  return [...(activities || [])].sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));
}

function buildScheduledIntervals(assignment) {
  if (!assignment) return [];
  const workDate = String(assignment.work_date).slice(0, 10);
  const shiftStartMins = timeToMinutes(assignment.start_time);
  let shiftEndMins = timeToMinutes(assignment.end_time);
  if (assignment.is_overnight && shiftEndMins <= shiftStartMins) shiftEndMins += 1440;

  const shiftStart = dateTimeFor(workDate, assignment.start_time);
  const shiftEnd = addMinutes(shiftStart, shiftEndMins - shiftStartMins);
  const intervals = [];
  let cursor = shiftStart;
  let breakIndex = 0;

  for (const rawActivity of sortActivities(assignment.activities)) {
    let startMins = timeToMinutes(rawActivity.start_time);
    let endMins = timeToMinutes(rawActivity.end_time);
    if (assignment.is_overnight && startMins < shiftStartMins) startMins += 1440;
    if (assignment.is_overnight && endMins <= shiftStartMins) endMins += 1440;
    if (endMins <= startMins) endMins += 1440;

    const start = addMinutes(shiftStart, startMins - shiftStartMins);
    const end = addMinutes(shiftStart, endMins - shiftStartMins);
    if (start > cursor) {
      intervals.push({
        schedule_activity_id: null,
        activity_type: ACTIVITY.ON_QUEUE,
        label: activityLabel(ACTIVITY.ON_QUEUE),
        start,
        end: start,
        scheduled_start: cursor,
        scheduled_end: start,
      });
    }

    const activityType = normalizeActivityType(rawActivity.activity_type);
    const label = activityType === ACTIVITY.BREAK
      ? `${++breakIndex === 1 ? 'First' : breakIndex === 2 ? 'Second' : `Break ${breakIndex}`} Break`
      : activityLabel(activityType);
    intervals.push({
      schedule_activity_id: rawActivity.id,
      activity_type: activityType,
      label,
      start,
      end,
      scheduled_start: start,
      scheduled_end: end,
      is_paid: rawActivity.is_paid,
      notes: rawActivity.notes,
    });
    cursor = end > cursor ? end : cursor;
  }

  if (cursor < shiftEnd) {
    intervals.push({
      schedule_activity_id: null,
      activity_type: ACTIVITY.ON_QUEUE,
      label: activityLabel(ACTIVITY.ON_QUEUE),
      start: cursor,
      end: shiftEnd,
      scheduled_start: cursor,
      scheduled_end: shiftEnd,
    });
  }

  return intervals;
}

function getScheduledActivityAt(assignment, at = new Date()) {
  const intervals = buildScheduledIntervals(assignment);
  return intervals.find(i => at >= i.start && at < i.end) || null;
}

async function loadPublishedAssignment(pool, { organizationId, agentId, date, lobId = null, channel = null }) {
  const params = [organizationId, agentId, date];
  let sql = `
    SELECT sa.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', act.id,
            'activity_type', act.activity_type,
            'start_time', act.start_time::text,
            'end_time', act.end_time::text,
            'is_paid', act.is_paid,
            'notes', act.notes
          ) ORDER BY act.start_time
        ) FILTER (WHERE act.id IS NOT NULL),
        '[]'::json
      ) AS activities,
      ag.full_name AS agent_name,
      ag.email AS agent_email,
      ag.team_name,
      ag.team_leader_name
    FROM schedule_assignments sa
    JOIN scheduling_agents ag ON ag.id = sa.agent_id
    LEFT JOIN shift_activities act ON act.assignment_id = sa.id
    WHERE sa.organization_id=$1 AND sa.agent_id=$2 AND sa.work_date=$3 AND sa.status='published'
  `;
  if (lobId) { params.push(lobId); sql += ` AND sa.lob_id=$${params.length}`; }
  if (channel && channel !== 'blended') {
    params.push(channel);
    sql += ` AND (sa.channel=$${params.length} OR sa.channel='blended')`;
  }
  sql += ' GROUP BY sa.id, ag.full_name, ag.email, ag.team_name, ag.team_leader_name ORDER BY sa.start_time LIMIT 1';
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

async function loadPublishedAssignments(pool, { organizationId, date, lobId, channel = null, team = null, supervisor = null }) {
  const params = [organizationId, date];
  let sql = `
    SELECT sa.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', act.id,
            'activity_type', act.activity_type,
            'start_time', act.start_time::text,
            'end_time', act.end_time::text,
            'is_paid', act.is_paid,
            'notes', act.notes
          ) ORDER BY act.start_time
        ) FILTER (WHERE act.id IS NOT NULL),
        '[]'::json
      ) AS activities,
      ag.full_name AS agent_name,
      ag.email AS agent_email,
      ag.team_name,
      ag.team_leader_name,
      ag.lob_assignments
    FROM schedule_assignments sa
    JOIN scheduling_agents ag ON ag.id = sa.agent_id
    LEFT JOIN shift_activities act ON act.assignment_id = sa.id
    WHERE sa.organization_id=$1 AND sa.work_date=$2 AND sa.status='published'
  `;
  if (lobId) { params.push(lobId); sql += ` AND sa.lob_id=$${params.length}`; }
  if (channel && channel !== 'blended') { params.push(channel); sql += ` AND (sa.channel=$${params.length} OR sa.channel='blended')`; }
  if (team && team !== 'all') { params.push(team); sql += ` AND ag.team_name=$${params.length}`; }
  if (supervisor && supervisor !== 'all') { params.push(supervisor); sql += ` AND ag.team_leader_name=$${params.length}`; }
  sql += ' GROUP BY sa.id, ag.full_name, ag.email, ag.team_name, ag.team_leader_name, ag.lob_assignments ORDER BY ag.full_name, sa.start_time';
  const { rows } = await pool.query(sql, params);
  return rows;
}

module.exports = {
  timeToMinutes,
  addMinutes,
  buildScheduledIntervals,
  getScheduledActivityAt,
  loadPublishedAssignment,
  loadPublishedAssignments,
};
