'use strict';

const assert = require('node:assert/strict');
const {
  buildDefaultBreakPolicy,
  normalizeBreakPolicy,
  parseActivitySequenceCode,
  placeBreakActivities,
  validateBreakPlacement,
} = require('./breakPlacement.cjs');

function assertFeasible(label, result) {
  assert.equal(
    result.feasible,
    true,
    `${label} expected feasible. errors=${result.errors.join('; ')} warnings=${result.warnings.join('; ')}`
  );
}

function assertInfeasible(label, result) {
  assert.equal(result.feasible, false, `${label} expected infeasible.`);
}

function assertNoOverlap(label, activities) {
  const sorted = [...activities].sort((a, b) => a.start_offset_minutes - b.start_offset_minutes);
  for (let i = 1; i < sorted.length; i += 1) {
    assert.ok(
      sorted[i].start_offset_minutes >= sorted[i - 1].end_offset_minutes,
      `${label} has overlapping activities.`
    );
  }
}

function assertWorkRules(label, result, policy) {
  const validation = validateBreakPlacement({
    shift_start_time: result.diagnostics.shift.start_time,
    shift_duration_minutes: result.diagnostics.shift.duration_minutes,
    policy,
    activities: result.activities,
  });
  assertFeasible(`${label} validation`, validation);
  validation.diagnostics.continuous_work_blocks.forEach((block, index) => {
    assert.ok(
      block.duration_minutes <= policy.max_continuous_work_minutes,
      `${label} block ${index + 1} exceeds max continuous work.`
    );
  });
  assertNoOverlap(label, result.activities);
}

function explicitPolicy(sequenceCode, activities, overrides = {}) {
  return {
    activity_sequence_code: sequenceCode,
    activities,
    min_work_before_first_activity_minutes: 120,
    min_work_between_activities_minutes: 120,
    max_continuous_work_minutes: 150,
    allowed_start_granularity_minutes: 15,
    infeasible_policy: 'warn',
    ...overrides,
  };
}

function runSelfChecks() {
  const parsed = parseActivitySequenceCode('B-L-B');
  assert.deepEqual(parsed.tokens, ['B', 'L', 'B'], 'B-L-B should parse into configured tokens.');

  const defaultPolicy = buildDefaultBreakPolicy();
  const normalizedDefault = normalizeBreakPolicy(defaultPolicy);
  assert.equal(normalizedDefault.errors.length, 0, normalizedDefault.errors.join('; '));

  const blb = placeBreakActivities({
    shift_start_time: '08:00',
    shift_end_time: '17:00',
    policy: defaultPolicy,
  });
  assertFeasible('B-L-B 9h', blb);
  assert.deepEqual(blb.activities.map((activity) => activity.activity_type), ['break', 'meal', 'break']);
  assert.deepEqual(blb.activities.map((activity) => activity.start_time), ['10:00', '12:15', '15:15']);
  assertWorkRules('B-L-B 9h', blb, normalizedDefault.policy);

  const bblPolicy = explicitPolicy('B-B-L', [
    { activity_type: 'break', duration_minutes: 15, paid: true, sequence_order: 1 },
    { activity_type: 'break', duration_minutes: 15, paid: true, sequence_order: 2 },
    { activity_type: 'meal', duration_minutes: 60, paid: false, sequence_order: 3 },
  ]);
  const bbl9 = placeBreakActivities({
    shift_start_time: '08:00',
    shift_end_time: '17:00',
    policy: bblPolicy,
  });
  assertFeasible('B-B-L 9h', bbl9);
  assert.deepEqual(bbl9.activities.map((activity) => activity.activity_type), ['break', 'break', 'meal']);
  assertWorkRules('B-B-L 9h', bbl9, normalizeBreakPolicy(bblPolicy).policy);

  const bbl7 = placeBreakActivities({
    shift_start_time: '08:00',
    shift_end_time: '15:00',
    policy: bblPolicy,
  });
  assertInfeasible('B-B-L 7h', bbl7);

  const lbbPolicy = explicitPolicy('L-B-B', [
    { activity_type: 'meal', duration_minutes: 60, paid: false, sequence_order: 1 },
    { activity_type: 'break', duration_minutes: 15, paid: true, sequence_order: 2 },
    { activity_type: 'break', duration_minutes: 15, paid: true, sequence_order: 3 },
  ]);
  const lbb9 = placeBreakActivities({
    shift_start_time: '08:00',
    shift_end_time: '17:00',
    policy: lbbPolicy,
  });
  assertFeasible('L-B-B 9h', lbb9);
  assert.deepEqual(lbb9.activities.map((activity) => activity.activity_type), ['meal', 'break', 'break']);
  assertWorkRules('L-B-B 9h', lbb9, normalizeBreakPolicy(lbbPolicy).policy);

  const lbb7 = placeBreakActivities({
    shift_start_time: '08:00',
    shift_end_time: '15:00',
    policy: lbbPolicy,
  });
  assertInfeasible('L-B-B 7h', lbb7);

  const lunchOnly = placeBreakActivities({
    shift_start_time: '08:00',
    shift_end_time: '16:00',
    policy: explicitPolicy('L', [
      { activity_type: 'meal', duration_minutes: 30, paid: false, sequence_order: 1 },
    ]),
  });
  assertInfeasible('Lunch-only 8h', lunchOnly);

  const noBreakLong = placeBreakActivities({
    shift_start_time: '08:00',
    shift_end_time: '16:00',
    policy: explicitPolicy('none', []),
  });
  assertInfeasible('No-break 8h', noBreakLong);

  const noBreakShort = placeBreakActivities({
    shift_start_time: '08:00',
    shift_end_time: '10:00',
    policy: explicitPolicy('none', []),
  });
  assertFeasible('No-break 2h', noBreakShort);
  assert.equal(noBreakShort.activities.length, 0, 'No-break profile must not return persisted work activities.');
  assert.equal(
    noBreakShort.diagnostics.work_segments.length,
    1,
    'No-break profile may expose work as diagnostics only.'
  );

  const overnight = placeBreakActivities({
    shift_start_time: '22:00',
    shift_end_time: '07:00',
    policy: defaultPolicy,
  });
  assertFeasible('Overnight B-L-B 9h', overnight);
  assert.deepEqual(overnight.activities.map((activity) => activity.start_time), ['00:00', '02:15', '05:15']);

  const invalidOverlap = validateBreakPlacement({
    shift_start_time: '08:00',
    shift_end_time: '17:00',
    policy: defaultPolicy,
    activities: [
      { activity_type: 'break', start_time: '10:00', duration_minutes: 30, paid: true, sequence_order: 1 },
      { activity_type: 'meal', start_time: '10:15', duration_minutes: 60, paid: false, sequence_order: 2 },
      { activity_type: 'break', start_time: '15:15', duration_minutes: 15, paid: true, sequence_order: 3 },
    ],
  });
  assertInfeasible('Overlap validation', invalidOverlap);

  const invalidEarly = validateBreakPlacement({
    shift_start_time: '08:00',
    shift_end_time: '17:00',
    policy: defaultPolicy,
    activities: [
      { activity_type: 'break', start_time: '09:30', duration_minutes: 15, paid: true, sequence_order: 1 },
      { activity_type: 'meal', start_time: '12:15', duration_minutes: 60, paid: false, sequence_order: 2 },
      { activity_type: 'break', start_time: '15:15', duration_minutes: 15, paid: true, sequence_order: 3 },
    ],
  });
  assertInfeasible('Early activity validation', invalidEarly);

  const invalidSequence = validateBreakPlacement({
    shift_start_time: '08:00',
    shift_end_time: '17:00',
    policy: defaultPolicy,
    activities: [
      { activity_type: 'meal', start_time: '10:00', duration_minutes: 60, paid: false, sequence_order: 1 },
      { activity_type: 'break', start_time: '13:00', duration_minutes: 15, paid: true, sequence_order: 2 },
      { activity_type: 'break', start_time: '15:15', duration_minutes: 15, paid: true, sequence_order: 3 },
    ],
  });
  assertInfeasible('Fixed sequence validation', invalidSequence);

  for (const result of [blb, bbl9, lbb9, overnight]) {
    assert.equal(
      result.activities.some((activity) => activity.activity_type === 'work'),
      false,
      'Persistable activities must not include work segments.'
    );
  }
}

runSelfChecks();
console.log('breakPlacement self-check passed');
