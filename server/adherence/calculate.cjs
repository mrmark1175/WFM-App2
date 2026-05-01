const {
  ACTIVITY,
  PUNCH_ACTION,
  ADHERENCE_STATE,
  NON_QUEUE_ACTIVITIES,
  normalizeActivityType,
  activityLabel,
} = require('./types.cjs');
const { buildScheduledIntervals } = require('./schedule.cjs');

function minutesBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60000);
}

function deriveCurrentStatus(punches) {
  const ordered = [...(punches || [])].sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at));
  let loggedIn = false;
  let currentStatus = ACTIVITY.LOGOUT;
  let startedAt = null;
  let lastPunch = null;

  for (const punch of ordered) {
    const action = punch.punch_action;
    const activityType = normalizeActivityType(punch.activity_type);
    lastPunch = punch;

    if (action === PUNCH_ACTION.LOGIN) {
      loggedIn = true;
      currentStatus = ACTIVITY.ON_QUEUE;
      startedAt = punch.punched_at;
    } else if (action === PUNCH_ACTION.LOGOUT) {
      loggedIn = false;
      currentStatus = ACTIVITY.LOGOUT;
      startedAt = punch.punched_at;
    } else if (action === PUNCH_ACTION.IN || action === PUNCH_ACTION.STATUS_CHANGE) {
      loggedIn = true;
      currentStatus = activityType;
      startedAt = punch.punched_at;
    } else if (action === PUNCH_ACTION.OUT) {
      loggedIn = true;
      currentStatus = ACTIVITY.ON_QUEUE;
      startedAt = punch.punched_at;
    }
  }

  return {
    is_logged_in: loggedIn,
    current_status: currentStatus,
    current_status_label: activityLabel(currentStatus),
    current_status_started_at: startedAt,
    last_punch: lastPunch,
  };
}

function findScheduledInterval(assignment, at = new Date()) {
  return buildScheduledIntervals(assignment).find(i => at >= i.start && at < i.end) || null;
}

function findMatchingScheduledActivity(assignment, punchOrStatus) {
  const activityType = normalizeActivityType(punchOrStatus.activity_type || punchOrStatus.current_status);
  const activityId = punchOrStatus.shift_activity_id || punchOrStatus.schedule_activity_id;
  const intervals = buildScheduledIntervals(assignment);
  if (activityId) return intervals.find(i => i.schedule_activity_id === Number(activityId)) || null;
  return intervals.find(i => i.activity_type === activityType && i.activity_type !== ACTIVITY.ON_QUEUE) || null;
}

function getShiftBounds(assignment) {
  const intervals = buildScheduledIntervals(assignment);
  if (!intervals.length) return { start: null, end: null };
  return { start: intervals[0].start, end: intervals[intervals.length - 1].end };
}

function findFirstPunch(punches, predicate) {
  return [...(punches || [])]
    .sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at))
    .find(predicate) || null;
}

function calculateAdherence({ assignment, punches, at = new Date(), graceMinutes = 5 }) {
  const status = deriveCurrentStatus(punches);
  const scheduled = findScheduledInterval(assignment, at);
  const shift = assignment ? getShiftBounds(assignment) : { start: null, end: null };

  if (!assignment || !shift.start || !shift.end || at < shift.start || at >= shift.end) {
    return {
      ...status,
      scheduled_activity: null,
      scheduled_activity_label: 'Not Scheduled',
      adherence_state: status.current_status === ACTIVITY.LOGOUT ? ADHERENCE_STATE.NOT_SCHEDULED : ADHERENCE_STATE.UNSCHEDULED_ACTIVITY,
      variance_minutes: null,
    };
  }

  const loginPunch = findFirstPunch(punches, p => p.punch_action === PUNCH_ACTION.LOGIN);
  if (!loginPunch && at >= shift.start) {
    return {
      ...status,
      scheduled_activity: scheduled?.activity_type || ACTIVITY.ON_QUEUE,
      scheduled_activity_label: scheduled?.label || activityLabel(ACTIVITY.ON_QUEUE),
      adherence_state: ADHERENCE_STATE.MISSING_PUNCH,
      variance_minutes: minutesBetween(at, shift.start),
    };
  }

  if (loginPunch && new Date(loginPunch.punched_at) > new Date(shift.start.getTime() + graceMinutes * 60000)) {
    return {
      ...status,
      scheduled_activity: scheduled?.activity_type || ACTIVITY.ON_QUEUE,
      scheduled_activity_label: scheduled?.label || activityLabel(ACTIVITY.ON_QUEUE),
      adherence_state: ADHERENCE_STATE.LATE_LOGIN,
      variance_minutes: minutesBetween(loginPunch.punched_at, shift.start),
    };
  }

  const lastPunch = status.last_punch;
  if (lastPunch?.punch_action === PUNCH_ACTION.LOGOUT && new Date(lastPunch.punched_at) < shift.end) {
    return {
      ...status,
      scheduled_activity: scheduled?.activity_type || ACTIVITY.ON_QUEUE,
      scheduled_activity_label: scheduled?.label || activityLabel(ACTIVITY.ON_QUEUE),
      adherence_state: ADHERENCE_STATE.EARLY_LOGOUT,
      variance_minutes: minutesBetween(shift.end, lastPunch.punched_at),
    };
  }

  const scheduledType = scheduled?.activity_type || ACTIVITY.ON_QUEUE;
  const actualType = normalizeActivityType(status.current_status);
  const variance = scheduled ? minutesBetween(at, scheduled.start) : null;

  if (actualType === scheduledType) {
    if (NON_QUEUE_ACTIVITIES.has(actualType)) {
      const actualStart = status.current_status_started_at ? new Date(status.current_status_started_at) : null;
      if (actualStart && actualStart < new Date(scheduled.start.getTime() - graceMinutes * 60000)) {
        return state(status, scheduled, ADHERENCE_STATE.EARLY_BREAK, minutesBetween(scheduled.start, actualStart));
      }
      if (actualStart && actualStart > new Date(scheduled.start.getTime() + graceMinutes * 60000)) {
        return state(status, scheduled, actualType === ACTIVITY.MEAL ? ADHERENCE_STATE.LATE_BREAK : ADHERENCE_STATE.LATE_BREAK, minutesBetween(actualStart, scheduled.start));
      }
      if (at > new Date(scheduled.end.getTime() + graceMinutes * 60000)) {
        return state(status, scheduled, actualType === ACTIVITY.MEAL ? ADHERENCE_STATE.LONG_LUNCH : ADHERENCE_STATE.OVERBREAK, minutesBetween(at, scheduled.end));
      }
    }
    return state(status, scheduled, ADHERENCE_STATE.IN_ADHERENCE, variance);
  }

  if (scheduledType === ACTIVITY.ON_QUEUE && NON_QUEUE_ACTIVITIES.has(actualType)) {
    const matching = findMatchingScheduledActivity(assignment, status);
    return state(status, scheduled, matching ? ADHERENCE_STATE.UNSCHEDULED_ACTIVITY : ADHERENCE_STATE.OUT_OF_ADHERENCE, variance);
  }

  if (NON_QUEUE_ACTIVITIES.has(scheduledType) && actualType === ACTIVITY.ON_QUEUE) {
    return state(status, scheduled, ADHERENCE_STATE.OUT_OF_ADHERENCE, variance);
  }

  return state(status, scheduled, ADHERENCE_STATE.OUT_OF_ADHERENCE, variance);
}

function state(status, scheduled, adherenceState, varianceMinutes) {
  return {
    ...status,
    scheduled_activity: scheduled?.activity_type || null,
    scheduled_activity_label: scheduled?.label || null,
    schedule_activity_id: scheduled?.schedule_activity_id || null,
    adherence_state: adherenceState,
    variance_minutes: varianceMinutes,
  };
}

module.exports = {
  minutesBetween,
  deriveCurrentStatus,
  calculateAdherence,
  findMatchingScheduledActivity,
};
