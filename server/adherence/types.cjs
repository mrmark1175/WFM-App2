const ACTUAL_SOURCE_MANUAL = 'manual_agent_punch';

const ACTIVITY = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  ON_QUEUE: 'on_queue',
  BREAK: 'break',
  MEAL: 'meal',
  COACHING: 'coaching',
  TRAINING: 'training',
  MEETING: 'meeting',
  OFFLINE_WORK: 'offline_work',
};

const PUNCH_ACTION = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  IN: 'in',
  OUT: 'out',
  STATUS_CHANGE: 'status_change',
};

const ADHERENCE_STATE = {
  IN_ADHERENCE: 'in_adherence',
  LATE_LOGIN: 'late_login',
  EARLY_LOGOUT: 'early_logout',
  LATE_BREAK: 'late_break',
  EARLY_BREAK: 'early_break',
  OVERBREAK: 'overbreak',
  LONG_LUNCH: 'long_lunch',
  MISSING_PUNCH: 'missing_punch',
  UNSCHEDULED_ACTIVITY: 'unscheduled_activity',
  OUT_OF_ADHERENCE: 'out_of_adherence',
  NOT_SCHEDULED: 'not_scheduled',
  LOGGED_OUT: 'logged_out',
};

const NON_QUEUE_ACTIVITIES = new Set([
  ACTIVITY.BREAK,
  ACTIVITY.MEAL,
  ACTIVITY.COACHING,
  ACTIVITY.TRAINING,
  ACTIVITY.MEETING,
  ACTIVITY.OFFLINE_WORK,
]);

function normalizeActivityType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'lunch' || raw === 'meal') return ACTIVITY.MEAL;
  if (raw === 'first_break' || raw === 'second_break' || raw === 'break') return ACTIVITY.BREAK;
  if (raw === 'offline' || raw === 'offline_work' || raw === 'other_offline') return ACTIVITY.OFFLINE_WORK;
  if (raw === 'on queue' || raw === 'on_queue' || raw === 'queue') return ACTIVITY.ON_QUEUE;
  if (raw === 'log_in') return ACTIVITY.LOGIN;
  if (raw === 'log_out') return ACTIVITY.LOGOUT;
  if ([ACTIVITY.COACHING, ACTIVITY.TRAINING, ACTIVITY.MEETING].includes(raw)) return raw;
  return raw || ACTIVITY.ON_QUEUE;
}

function activityLabel(activityType) {
  const normalized = normalizeActivityType(activityType);
  return {
    [ACTIVITY.LOGIN]: 'Log In',
    [ACTIVITY.LOGOUT]: 'Log Out',
    [ACTIVITY.ON_QUEUE]: 'On Queue',
    [ACTIVITY.BREAK]: 'Break',
    [ACTIVITY.MEAL]: 'Lunch',
    [ACTIVITY.COACHING]: 'Coaching',
    [ACTIVITY.TRAINING]: 'Training',
    [ACTIVITY.MEETING]: 'Meeting',
    [ACTIVITY.OFFLINE_WORK]: 'Offline Work',
  }[normalized] || normalized.replace(/_/g, ' ');
}

module.exports = {
  ACTUAL_SOURCE_MANUAL,
  ACTIVITY,
  PUNCH_ACTION,
  ADHERENCE_STATE,
  NON_QUEUE_ACTIVITIES,
  normalizeActivityType,
  activityLabel,
};
