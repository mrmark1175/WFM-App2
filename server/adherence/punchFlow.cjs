const { ACTIVITY, PUNCH_ACTION, NON_QUEUE_ACTIVITIES, normalizeActivityType } = require('./types.cjs');
const { deriveCurrentStatus } = require('./calculate.cjs');

function getValidPunchActions({ assignment, punches, scheduledIntervals = [] }) {
  const status = deriveCurrentStatus(punches);
  const actions = [];

  if (!assignment) {
    return {
      current: status,
      actions: status.is_logged_in
        ? [{ label: 'Log out for the day', activity_type: ACTIVITY.LOGOUT, punch_action: PUNCH_ACTION.LOGOUT }]
        : [],
    };
  }

  if (!status.is_logged_in) {
    actions.push({ label: 'Log in for the day', activity_type: ACTIVITY.LOGIN, punch_action: PUNCH_ACTION.LOGIN });
    return { current: status, actions };
  }

  if (NON_QUEUE_ACTIVITIES.has(status.current_status)) {
    actions.push({
      label: `Return to On Queue`,
      activity_type: status.current_status,
      shift_activity_id: status.last_punch?.shift_activity_id || null,
      punch_action: PUNCH_ACTION.OUT,
    });
    return { current: status, actions };
  }

  for (const interval of scheduledIntervals.filter(i => NON_QUEUE_ACTIVITIES.has(i.activity_type))) {
    actions.push({
      label: `Punch in ${interval.label}`,
      activity_type: interval.activity_type,
      shift_activity_id: interval.schedule_activity_id,
      punch_action: PUNCH_ACTION.IN,
    });
  }
  actions.push({
    label: 'Other approved offline activity',
    activity_type: ACTIVITY.OFFLINE_WORK,
    punch_action: PUNCH_ACTION.STATUS_CHANGE,
  });
  actions.push({ label: 'Log out for the day', activity_type: ACTIVITY.LOGOUT, punch_action: PUNCH_ACTION.LOGOUT });
  return { current: status, actions };
}

function validatePunchFlow({ assignment, punches, activityType, punchAction, shiftActivityId, isCorrection = false }) {
  const normalizedActivity = normalizeActivityType(activityType);
  const status = deriveCurrentStatus(punches);

  if (isCorrection) return { ok: true };
  if (!assignment && punchAction !== PUNCH_ACTION.LOGOUT) {
    return { ok: false, error: 'No published shift is available for this punch.' };
  }
  if (punchAction === PUNCH_ACTION.LOGIN) {
    if (status.is_logged_in) return { ok: false, error: 'You are already logged in.' };
    return { ok: true };
  }
  if (punchAction === PUNCH_ACTION.LOGOUT) {
    if (!status.is_logged_in) return { ok: false, error: 'Cannot log out before logging in.' };
    return { ok: true };
  }
  if (!status.is_logged_in) return { ok: false, error: 'Log in before changing status.' };

  if (punchAction === PUNCH_ACTION.IN || punchAction === PUNCH_ACTION.STATUS_CHANGE) {
    if (NON_QUEUE_ACTIVITIES.has(status.current_status)) {
      return { ok: false, error: `Return from ${status.current_status.replace(/_/g, ' ')} before starting another activity.` };
    }
    if (normalizedActivity === ACTIVITY.BREAK || normalizedActivity === ACTIVITY.MEAL) {
      const openSame = status.current_status === normalizedActivity;
      if (openSame) return { ok: false, error: 'This activity is already open.' };
    }
    return { ok: true };
  }

  if (punchAction === PUNCH_ACTION.OUT) {
    if (!NON_QUEUE_ACTIVITIES.has(status.current_status)) {
      return { ok: false, error: 'There is no active non-queue activity to punch out from.' };
    }
    if (normalizedActivity !== status.current_status) {
      return { ok: false, error: `Cannot punch out ${normalizedActivity}; current status is ${status.current_status}.` };
    }
    if (shiftActivityId && status.last_punch?.shift_activity_id && Number(shiftActivityId) !== Number(status.last_punch.shift_activity_id)) {
      return { ok: false, error: 'Cannot punch out a different scheduled activity.' };
    }
    return { ok: true };
  }

  return { ok: false, error: 'Unsupported punch action.' };
}

module.exports = {
  getValidPunchActions,
  validatePunchFlow,
};
