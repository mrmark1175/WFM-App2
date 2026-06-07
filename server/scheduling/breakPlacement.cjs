'use strict';

const ACTIVITY_TOKEN_TYPES = {
  B: 'break',
  L: 'meal',
};

const ACTIVITY_TYPE_TOKENS = {
  break: 'B',
  meal: 'L',
};

const DEFAULT_POLICY = Object.freeze({
  activity_sequence_code: 'B-L-B',
  min_work_before_first_activity_minutes: 120,
  min_work_between_activities_minutes: 120,
  max_continuous_work_minutes: 150,
  min_work_after_last_activity_minutes: null,
  allowed_start_granularity_minutes: 15,
  allow_flexible_activity_order: false,
  infeasible_policy: 'warn',
  default_break_duration_minutes: 15,
  default_meal_duration_minutes: 60,
  default_break_paid: true,
  default_meal_paid: false,
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function toPositiveInteger(value, fallback, fieldName, errors) {
  const number = toInteger(value, fallback);
  if (!Number.isFinite(number) || number <= 0) {
    errors.push(`${fieldName} must be greater than 0.`);
    return fallback;
  }
  return number;
}

function toNonNegativeInteger(value, fallback, fieldName, errors) {
  const number = toInteger(value, fallback);
  if (!Number.isFinite(number) || number < 0) {
    errors.push(`${fieldName} must be 0 or greater.`);
    return fallback;
  }
  return number;
}

function normalizeTimeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function hhmmToMinutes(value) {
  const normalized = normalizeTimeText(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return hour * 60 + minute;
}

function minutesToHHMM(value) {
  const wrapped = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function roundUpToGrid(value, grid) {
  return Math.ceil(value / grid) * grid;
}

function roundDownToGrid(value, grid) {
  return Math.floor(value / grid) * grid;
}

function parseActivitySequenceCode(sequenceCode) {
  const errors = [];
  const warnings = [];

  if (sequenceCode === undefined || sequenceCode === null || String(sequenceCode).trim() === '') {
    return {
      sequence_code: DEFAULT_POLICY.activity_sequence_code,
      tokens: ['B', 'L', 'B'],
      warnings,
      errors,
    };
  }

  const raw = String(sequenceCode).trim();
  const normalizedRaw = raw.toLowerCase();
  if (['none', 'no-breaks', 'no_breaks', 'no breaks', 'off'].includes(normalizedRaw)) {
    return {
      sequence_code: 'none',
      tokens: [],
      warnings,
      errors,
    };
  }

  const compact = raw.toUpperCase().replace(/\s+/g, '');
  const tokens = compact.includes('-')
    ? compact.split('-').filter(Boolean)
    : compact.split('');

  for (const token of tokens) {
    if (!ACTIVITY_TOKEN_TYPES[token]) {
      errors.push(`Unsupported activity sequence token "${token}". Use B, L, or none.`);
    }
  }

  return {
    sequence_code: tokens.length > 0 ? tokens.join('-') : 'none',
    tokens,
    warnings,
    errors,
  };
}

function sequenceCodeFromActivities(activities) {
  if (!activities.length) return 'none';
  return activities.map((activity) => ACTIVITY_TYPE_TOKENS[activity.activity_type]).join('-');
}

function buildDefaultBreakPolicy(overrides = {}) {
  const source = isObject(overrides) ? overrides : {};
  const parsed = parseActivitySequenceCode(source.activity_sequence_code ?? DEFAULT_POLICY.activity_sequence_code);
  const breakDuration = toInteger(
    source.break_duration_minutes ?? source.default_break_duration_minutes,
    DEFAULT_POLICY.default_break_duration_minutes
  );
  const mealDuration = toInteger(
    source.meal_duration_minutes ?? source.lunch_duration_minutes ?? source.default_meal_duration_minutes,
    DEFAULT_POLICY.default_meal_duration_minutes
  );
  const activities = parsed.tokens.map((token, index) => ({
    activity_type: ACTIVITY_TOKEN_TYPES[token],
    duration_minutes: token === 'B' ? breakDuration : mealDuration,
    paid: token === 'B'
      ? source.break_paid ?? source.default_break_paid ?? DEFAULT_POLICY.default_break_paid
      : source.meal_paid ?? source.lunch_paid ?? source.default_meal_paid ?? DEFAULT_POLICY.default_meal_paid,
    sequence_order: index + 1,
  }));

  return {
    ...DEFAULT_POLICY,
    ...source,
    activity_sequence_code: parsed.sequence_code,
    activities,
  };
}

function normalizeBreakPolicy(policyInput = {}) {
  const source = isObject(policyInput) ? policyInput : {};
  const warnings = [];
  const errors = [];
  const hasSequenceCode = Object.prototype.hasOwnProperty.call(source, 'activity_sequence_code');
  const activityInput = Array.isArray(source.activities) ? source.activities : null;

  let parsedSequence = hasSequenceCode
    ? parseActivitySequenceCode(source.activity_sequence_code)
    : null;

  if (parsedSequence) {
    warnings.push(...parsedSequence.warnings);
    errors.push(...parsedSequence.errors);
  }

  let normalizedActivities = [];
  if (activityInput && activityInput.length > 0) {
    normalizedActivities = activityInput
      .map((activity, index) => {
        const sequenceOrder = toPositiveInteger(
          activity?.sequence_order ?? index + 1,
          index + 1,
          `activities[${index}].sequence_order`,
          errors
        );
        const activityType = String(activity?.activity_type || '').trim().toLowerCase();
        if (!['break', 'meal'].includes(activityType)) {
          errors.push(`activities[${index}].activity_type must be "break" or "meal".`);
        }
        const duration = toPositiveInteger(
          activity?.duration_minutes,
          activityType === 'meal'
            ? DEFAULT_POLICY.default_meal_duration_minutes
            : DEFAULT_POLICY.default_break_duration_minutes,
          `activities[${index}].duration_minutes`,
          errors
        );
        return {
          activity_type: activityType,
          duration_minutes: duration,
          paid: activity?.paid === undefined ? activityType === 'break' : !!activity.paid,
          sequence_order: sequenceOrder,
          label: activity?.label || activity?.name || null,
        };
      })
      .sort((a, b) => a.sequence_order - b.sequence_order);

    if (!hasSequenceCode) {
      parsedSequence = {
        sequence_code: sequenceCodeFromActivities(normalizedActivities),
        tokens: normalizedActivities.map((activity) => ACTIVITY_TYPE_TOKENS[activity.activity_type]),
        warnings: [],
        errors: [],
      };
    }
  } else {
    if (!parsedSequence) parsedSequence = parseActivitySequenceCode(DEFAULT_POLICY.activity_sequence_code);
    normalizedActivities = parsedSequence.tokens.map((token, index) => ({
      activity_type: ACTIVITY_TOKEN_TYPES[token],
      duration_minutes: token === 'B'
        ? toInteger(
            source.break_duration_minutes ?? source.default_break_duration_minutes,
            DEFAULT_POLICY.default_break_duration_minutes
          )
        : toInteger(
            source.meal_duration_minutes ?? source.lunch_duration_minutes ?? source.default_meal_duration_minutes,
            DEFAULT_POLICY.default_meal_duration_minutes
          ),
      paid: token === 'B'
        ? source.break_paid ?? source.default_break_paid ?? DEFAULT_POLICY.default_break_paid
        : source.meal_paid ?? source.lunch_paid ?? source.default_meal_paid ?? DEFAULT_POLICY.default_meal_paid,
      sequence_order: index + 1,
      label: null,
    }));
  }

  const sequenceTokens = parsedSequence.tokens || [];
  if (hasSequenceCode && sequenceTokens.length === 0 && normalizedActivities.length > 0) {
    errors.push('activity_sequence_code is none, but activities were provided.');
  }
  if (hasSequenceCode && sequenceTokens.length !== normalizedActivities.length) {
    errors.push(
      `activity_sequence_code ${parsedSequence.sequence_code} expects ${sequenceTokens.length} activities, but ${normalizedActivities.length} were provided.`
    );
  }
  if (hasSequenceCode && sequenceTokens.length === normalizedActivities.length) {
    sequenceTokens.forEach((token, index) => {
      const expectedType = ACTIVITY_TOKEN_TYPES[token];
      if (normalizedActivities[index]?.activity_type !== expectedType) {
        errors.push(
          `activities[${index}].activity_type must be "${expectedType}" to match sequence ${parsedSequence.sequence_code}.`
        );
      }
    });
  }

  const minBeforeFirst = toNonNegativeInteger(
    source.min_work_before_first_activity_minutes,
    DEFAULT_POLICY.min_work_before_first_activity_minutes,
    'min_work_before_first_activity_minutes',
    errors
  );
  const minBetween = toNonNegativeInteger(
    source.min_work_between_activities_minutes,
    DEFAULT_POLICY.min_work_between_activities_minutes,
    'min_work_between_activities_minutes',
    errors
  );
  const maxContinuous = toPositiveInteger(
    source.max_continuous_work_minutes,
    DEFAULT_POLICY.max_continuous_work_minutes,
    'max_continuous_work_minutes',
    errors
  );
  const granularity = toPositiveInteger(
    source.allowed_start_granularity_minutes,
    DEFAULT_POLICY.allowed_start_granularity_minutes,
    'allowed_start_granularity_minutes',
    errors
  );
  const minAfterLast = source.min_work_after_last_activity_minutes === undefined ||
    source.min_work_after_last_activity_minutes === null
      ? null
      : toNonNegativeInteger(
          source.min_work_after_last_activity_minutes,
          0,
          'min_work_after_last_activity_minutes',
          errors
        );
  const infeasiblePolicy = ['warn', 'block'].includes(String(source.infeasible_policy || '').toLowerCase())
    ? String(source.infeasible_policy).toLowerCase()
    : DEFAULT_POLICY.infeasible_policy;

  if (minBeforeFirst > maxContinuous) {
    errors.push('min_work_before_first_activity_minutes cannot exceed max_continuous_work_minutes.');
  }
  if (minBetween > maxContinuous) {
    errors.push('min_work_between_activities_minutes cannot exceed max_continuous_work_minutes.');
  }
  if (source.infeasible_policy && !['warn', 'block'].includes(String(source.infeasible_policy).toLowerCase())) {
    warnings.push('Unsupported infeasible_policy was replaced with "warn".');
  }

  const policy = {
    policy_id: source.policy_id || source.id || null,
    policy_name: source.policy_name || source.name || null,
    organization_id: source.organization_id ?? null,
    account_id: source.account_id ?? null,
    lob_id: source.lob_id ?? null,
    labor_profile_id: source.labor_profile_id ?? null,
    country_code: source.country_code ?? null,
    site_id: source.site_id ?? null,
    staffing_mode: source.staffing_mode ?? null,
    channel: source.channel ?? null,
    activity_sequence_code: parsedSequence.sequence_code,
    activities: normalizedActivities,
    min_work_before_first_activity_minutes: minBeforeFirst,
    min_work_between_activities_minutes: minBetween,
    max_continuous_work_minutes: maxContinuous,
    min_work_after_last_activity_minutes: minAfterLast,
    allowed_start_granularity_minutes: granularity,
    allow_flexible_activity_order: !!source.allow_flexible_activity_order,
    infeasible_policy: infeasiblePolicy,
  };

  return { policy, warnings, errors };
}

function normalizeShiftWindow(input = {}) {
  const warnings = [];
  const errors = [];
  const startFromMinutes = input.shift_start_minutes ?? input.start_minutes;
  const startTime = input.shift_start_time ?? input.start_time ?? input.shiftStart ?? input.startTime ?? '00:00';
  const startMinute = startFromMinutes !== undefined && startFromMinutes !== null
    ? toInteger(startFromMinutes, null)
    : hhmmToMinutes(startTime);

  if (!Number.isFinite(startMinute)) {
    errors.push('shift_start_time must be a valid HH:mm time.');
  }

  const explicitDuration = input.shift_duration_minutes ?? input.duration_minutes ?? input.shiftMinutes;
  let durationMinutes = explicitDuration !== undefined && explicitDuration !== null
    ? toPositiveInteger(explicitDuration, 0, 'shift_duration_minutes', errors)
    : null;

  let endMinute = null;
  const endFromMinutes = input.shift_end_minutes ?? input.end_minutes;
  const endTime = input.shift_end_time ?? input.end_time ?? input.shiftEnd ?? input.endTime;
  if (endFromMinutes !== undefined && endFromMinutes !== null) {
    endMinute = toInteger(endFromMinutes, null);
  } else if (endTime !== undefined && endTime !== null) {
    endMinute = hhmmToMinutes(endTime);
  }

  let isOvernight = false;
  if (durationMinutes === null) {
    if (!Number.isFinite(endMinute)) {
      errors.push('Either shift_end_time or shift_duration_minutes is required.');
      durationMinutes = 0;
    } else {
      if (endMinute <= startMinute) {
        endMinute += 1440;
        isOvernight = true;
      }
      durationMinutes = endMinute - startMinute;
    }
  } else {
    endMinute = startMinute + durationMinutes;
    isOvernight = endMinute > 1440 || (Number.isFinite(hhmmToMinutes(endTime)) && hhmmToMinutes(endTime) <= startMinute);
  }

  if (durationMinutes <= 0) {
    errors.push('shift duration must be greater than 0 minutes.');
  }
  if (durationMinutes > 1440) {
    errors.push('shift duration greater than 24 hours is not supported by break placement yet.');
  }

  if (endTime && explicitDuration !== undefined && explicitDuration !== null) {
    const parsedEnd = hhmmToMinutes(endTime);
    if (Number.isFinite(parsedEnd)) {
      const expectedEnd = minutesToHHMM(startMinute + durationMinutes);
      if (normalizeTimeText(endTime) !== expectedEnd) {
        warnings.push(`shift_end_time differs from shift_duration_minutes; using duration-derived end ${expectedEnd}.`);
      }
    }
  }

  return {
    shift: {
      start_minute: startMinute,
      end_minute: startMinute + durationMinutes,
      duration_minutes: durationMinutes,
      start_time: Number.isFinite(startMinute) ? minutesToHHMM(startMinute) : null,
      end_time: Number.isFinite(startMinute) ? minutesToHHMM(startMinute + durationMinutes) : null,
      is_overnight: isOvernight,
    },
    warnings,
    errors,
  };
}

function normalizePlacedActivity(activity, index, shift, errors, warnings) {
  const activityType = String(activity?.activity_type || '').trim().toLowerCase();
  if (!['break', 'meal'].includes(activityType)) {
    errors.push(`activities[${index}].activity_type must be "break" or "meal".`);
  }

  let startOffset = activity?.start_offset_minutes ?? activity?.offset_from_start_minutes ?? activity?.offsetFromStart;
  if (startOffset === undefined || startOffset === null) {
    const startMinute = hhmmToMinutes(activity?.start_time);
    if (!Number.isFinite(startMinute)) {
      errors.push(`activities[${index}].start_time must be HH:mm or start_offset_minutes must be provided.`);
      startOffset = 0;
    } else {
      let absoluteStart = startMinute;
      while (absoluteStart < shift.start_minute) absoluteStart += 1440;
      startOffset = absoluteStart - shift.start_minute;
    }
  }
  startOffset = toInteger(startOffset, 0);

  let duration = activity?.duration_minutes;
  if (duration === undefined || duration === null) {
    const startMinute = shift.start_minute + startOffset;
    const parsedEnd = hhmmToMinutes(activity?.end_time);
    if (!Number.isFinite(parsedEnd)) {
      errors.push(`activities[${index}].duration_minutes or end_time is required.`);
      duration = 0;
    } else {
      let absoluteEnd = parsedEnd;
      while (absoluteEnd <= startMinute) absoluteEnd += 1440;
      duration = absoluteEnd - startMinute;
    }
  }
  duration = toPositiveInteger(duration, 0, `activities[${index}].duration_minutes`, errors);

  if (activity?.end_time) {
    const expectedEnd = minutesToHHMM(shift.start_minute + startOffset + duration);
    if (normalizeTimeText(activity.end_time) !== expectedEnd) {
      warnings.push(`activities[${index}].end_time differs from duration; using duration-derived end ${expectedEnd}.`);
    }
  }

  return {
    activity_type: activityType,
    start_offset_minutes: startOffset,
    end_offset_minutes: startOffset + duration,
    start_time: minutesToHHMM(shift.start_minute + startOffset),
    end_time: minutesToHHMM(shift.start_minute + startOffset + duration),
    duration_minutes: duration,
    paid: activity?.paid === undefined
      ? activity?.is_paid === undefined
        ? activityType === 'break'
        : !!activity.is_paid
      : !!activity.paid,
    sequence_order: toPositiveInteger(activity?.sequence_order ?? index + 1, index + 1, `activities[${index}].sequence_order`, errors),
    label: activity?.label || activity?.name || null,
  };
}

function buildWorkSegments(shift, activities) {
  const sorted = [...activities].sort((a, b) => a.start_offset_minutes - b.start_offset_minutes);
  const segments = [];
  let cursor = 0;

  sorted.forEach((activity, index) => {
    if (activity.start_offset_minutes > cursor) {
      segments.push({
        start_offset_minutes: cursor,
        end_offset_minutes: activity.start_offset_minutes,
        start_time: minutesToHHMM(shift.start_minute + cursor),
        end_time: minutesToHHMM(shift.start_minute + activity.start_offset_minutes),
        duration_minutes: activity.start_offset_minutes - cursor,
        from: index === 0 ? 'shift_start' : 'activity',
        to: activity.activity_type,
      });
    }
    cursor = Math.max(cursor, activity.end_offset_minutes);
  });

  if (cursor < shift.duration_minutes) {
    segments.push({
      start_offset_minutes: cursor,
      end_offset_minutes: shift.duration_minutes,
      start_time: minutesToHHMM(shift.start_minute + cursor),
      end_time: minutesToHHMM(shift.start_minute + shift.duration_minutes),
      duration_minutes: shift.duration_minutes - cursor,
      from: sorted.length ? sorted[sorted.length - 1].activity_type : 'shift_start',
      to: 'shift_end',
    });
  }

  return segments;
}

function validateBreakPlacement(input = {}) {
  const normalizedPolicy = normalizeBreakPolicy(input.policy || input.break_policy || {});
  const normalizedShift = normalizeShiftWindow(input);
  const warnings = [...normalizedPolicy.warnings, ...normalizedShift.warnings];
  const errors = [...normalizedPolicy.errors, ...normalizedShift.errors];
  const policy = normalizedPolicy.policy;
  const shift = normalizedShift.shift;
  const rawActivities = Array.isArray(input.activities) ? input.activities : [];

  let activities = rawActivities.map((activity, index) =>
    normalizePlacedActivity(activity, index, shift, errors, warnings)
  );
  activities = activities.sort((a, b) => a.start_offset_minutes - b.start_offset_minutes);

  if (activities.length !== policy.activities.length) {
    errors.push(`Expected ${policy.activities.length} break/meal activities, but received ${activities.length}.`);
  }

  activities.forEach((activity, index) => {
    if (activity.start_offset_minutes < 0 || activity.end_offset_minutes > shift.duration_minutes) {
      errors.push(`activities[${index}] must be inside the shift window.`);
    }
    if (activity.start_offset_minutes % policy.allowed_start_granularity_minutes !== 0) {
      errors.push(
        `activities[${index}].start_time must align to ${policy.allowed_start_granularity_minutes}-minute granularity.`
      );
    }
    const previous = activities[index - 1];
    if (previous && activity.start_offset_minutes < previous.end_offset_minutes) {
      errors.push(`activities[${index}] overlaps the previous activity.`);
    }
  });

  if (!policy.allow_flexible_activity_order) {
    policy.activities.forEach((policyActivity, index) => {
      if (!activities[index]) return;
      if (activities[index].activity_type !== policyActivity.activity_type) {
        errors.push(
          `activities[${index}].activity_type "${activities[index].activity_type}" does not match configured sequence ${policy.activity_sequence_code}.`
        );
      }
    });
  }

  const workSegments = buildWorkSegments(shift, activities);
  workSegments.forEach((segment, index) => {
    if (segment.duration_minutes > policy.max_continuous_work_minutes) {
      errors.push(
        `Continuous work block ${index + 1} is ${segment.duration_minutes} minutes, exceeding max ${policy.max_continuous_work_minutes}.`
      );
    }
  });

  if (activities.length > 0) {
    const firstWork = workSegments[0]?.start_offset_minutes === 0 ? workSegments[0] : null;
    if (!firstWork || firstWork.duration_minutes < policy.min_work_before_first_activity_minutes) {
      errors.push(
        `First activity must start after at least ${policy.min_work_before_first_activity_minutes} minutes of productive work.`
      );
    }

    for (let i = 1; i < activities.length; i += 1) {
      const previous = activities[i - 1];
      const current = activities[i];
      const workBetween = current.start_offset_minutes - previous.end_offset_minutes;
      if (workBetween < policy.min_work_between_activities_minutes) {
        errors.push(
          `Activity ${i + 1} must start after at least ${policy.min_work_between_activities_minutes} minutes of productive work since the previous activity.`
        );
      }
    }

    if (policy.min_work_after_last_activity_minutes !== null) {
      const last = activities[activities.length - 1];
      const workAfterLast = shift.duration_minutes - last.end_offset_minutes;
      if (workAfterLast < policy.min_work_after_last_activity_minutes) {
        errors.push(
          `Last activity must leave at least ${policy.min_work_after_last_activity_minutes} minutes of productive work before shift end.`
        );
      }
    }
  }

  return {
    feasible: errors.length === 0,
    activities,
    warnings,
    errors,
    diagnostics: {
      shift,
      policy,
      continuous_work_blocks: workSegments,
      work_segments: workSegments,
    },
  };
}

function cloneActivityForPlacement(activity) {
  return {
    activity_type: activity.activity_type,
    duration_minutes: activity.duration_minutes,
    paid: !!activity.paid,
    sequence_order: activity.sequence_order,
    label: activity.label || null,
  };
}

function permutationKey(activities) {
  return activities
    .map((activity) => `${activity.activity_type}:${activity.duration_minutes}:${activity.paid}:${activity.sequence_order}`)
    .join('|');
}

function uniquePermutations(activities, limit = 120) {
  const results = [];
  const seen = new Set();
  const used = Array(activities.length).fill(false);

  function walk(current) {
    if (results.length >= limit) return;
    if (current.length === activities.length) {
      const key = permutationKey(current);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(current.map(cloneActivityForPlacement));
      }
      return;
    }
    for (let i = 0; i < activities.length; i += 1) {
      if (used[i]) continue;
      used[i] = true;
      current.push(activities[i]);
      walk(current);
      current.pop();
      used[i] = false;
    }
  }

  walk([]);
  return results;
}

function buildCandidateActivities(shift, orderedActivities, offsets) {
  return orderedActivities.map((activity, index) => {
    const startOffset = offsets[index];
    const endOffset = startOffset + activity.duration_minutes;
    return {
      activity_type: activity.activity_type,
      start_time: minutesToHHMM(shift.start_minute + startOffset),
      end_time: minutesToHHMM(shift.start_minute + endOffset),
      start_offset_minutes: startOffset,
      end_offset_minutes: endOffset,
      duration_minutes: activity.duration_minutes,
      paid: !!activity.paid,
      sequence_order: activity.sequence_order,
      label: activity.label || null,
    };
  });
}

function intervalsForActivity(activity, shift, intervalMinutes) {
  const startAbsolute = shift.start_minute + activity.start_offset_minutes;
  const endAbsolute = shift.start_minute + activity.end_offset_minutes;
  const indexes = [];
  for (let minute = startAbsolute; minute < endAbsolute; minute += intervalMinutes) {
    indexes.push(Math.floor((minute % 1440) / intervalMinutes));
  }
  return indexes;
}

function scorePlacement(activities, validation, scoring = {}) {
  const intervalMinutes = toPositiveInteger(scoring.interval_minutes, 15, 'interval_minutes', []);
  const intervalDemand = Array.isArray(scoring.intervalDemand) ? scoring.intervalDemand : [];
  const existingOffQueueCounts = Array.isArray(scoring.existingOffQueueCounts) ? scoring.existingOffQueueCounts : [];
  let score = 0;

  for (const activity of activities) {
    for (const index of intervalsForActivity(activity, validation.diagnostics.shift, intervalMinutes)) {
      const demand = Number(intervalDemand[index] || 0);
      const offQueue = Number(existingOffQueueCounts[index] || 0);
      score += demand * 10 + offQueue;
    }
    score += activity.start_offset_minutes * 0.0001;
  }

  return score;
}

function enumeratePlacements(shift, policy, orderedActivities, scoring) {
  const placements = [];
  const offsets = [];
  const granularity = policy.allowed_start_granularity_minutes;

  function walk(index, previousEndOffset) {
    if (index >= orderedActivities.length) {
      const activities = buildCandidateActivities(shift, orderedActivities, offsets);
      const validation = validateBreakPlacement({
        shift_start_time: shift.start_time,
        shift_duration_minutes: shift.duration_minutes,
        policy,
        activities,
      });
      if (validation.feasible) {
        placements.push({
          activities,
          validation,
          score: scorePlacement(activities, validation, scoring),
        });
      }
      return;
    }

    const activity = orderedActivities[index];
    const minWork = index === 0
      ? policy.min_work_before_first_activity_minutes
      : policy.min_work_between_activities_minutes;
    const earliest = roundUpToGrid(previousEndOffset + minWork, granularity);
    const latestByMaxContinuous = previousEndOffset + policy.max_continuous_work_minutes;
    const latestByBounds = shift.duration_minutes - activity.duration_minutes;
    const latest = roundDownToGrid(Math.min(latestByMaxContinuous, latestByBounds), granularity);

    for (let startOffset = earliest; startOffset <= latest; startOffset += granularity) {
      offsets[index] = startOffset;
      walk(index + 1, startOffset + activity.duration_minutes);
    }
  }

  walk(0, 0);
  return placements;
}

function buildFeasibilityMessages(shift, policy) {
  const messages = [];
  const activities = policy.activities;
  const totalActivityMinutes = activities.reduce((sum, activity) => sum + activity.duration_minutes, 0);
  const totalProductiveMinutes = shift.duration_minutes - totalActivityMinutes;

  if (activities.length === 0) {
    if (shift.duration_minutes > policy.max_continuous_work_minutes) {
      messages.push(
        `No-break policy leaves ${shift.duration_minutes} continuous work minutes, exceeding max ${policy.max_continuous_work_minutes}.`
      );
    }
    return messages;
  }

  const minimumProductiveBeforeActivities =
    policy.min_work_before_first_activity_minutes +
    Math.max(0, activities.length - 1) * policy.min_work_between_activities_minutes;

  if (minimumProductiveBeforeActivities + totalActivityMinutes > shift.duration_minutes) {
    messages.push(
      `Sequence ${policy.activity_sequence_code} needs at least ${minimumProductiveBeforeActivities} productive minutes before/between activities plus ${totalActivityMinutes} activity minutes, exceeding shift duration ${shift.duration_minutes}.`
    );
  }

  if (totalProductiveMinutes > policy.max_continuous_work_minutes * (activities.length + 1)) {
    messages.push(
      `${totalProductiveMinutes} productive minutes cannot be split into ${activities.length + 1} work blocks without exceeding max ${policy.max_continuous_work_minutes}.`
    );
  }

  if (policy.min_work_after_last_activity_minutes !== null) {
    const minimumTotal =
      minimumProductiveBeforeActivities +
      policy.min_work_after_last_activity_minutes +
      totalActivityMinutes;
    if (minimumTotal > shift.duration_minutes) {
      messages.push(
        `min_work_after_last_activity_minutes makes the sequence require ${minimumTotal} total minutes, exceeding shift duration ${shift.duration_minutes}.`
      );
    }
  }

  if (messages.length === 0) {
    messages.push(
      `No placement satisfied min/max continuous work rules for sequence ${policy.activity_sequence_code} within a ${shift.duration_minutes}-minute shift.`
    );
  }

  return messages;
}

function placeBreakActivities(input = {}) {
  const normalizedPolicy = normalizeBreakPolicy(input.policy || input.break_policy || {});
  const normalizedShift = normalizeShiftWindow(input);
  const warnings = [...normalizedPolicy.warnings, ...normalizedShift.warnings];
  const errors = [...normalizedPolicy.errors, ...normalizedShift.errors];
  const policy = normalizedPolicy.policy;
  const shift = normalizedShift.shift;

  if (errors.length > 0) {
    return {
      feasible: false,
      activities: [],
      warnings,
      errors,
      diagnostics: {
        shift,
        policy,
        continuous_work_blocks: [],
        work_segments: [],
      },
    };
  }

  if (policy.activities.length === 0) {
    const validation = validateBreakPlacement({
      shift_start_time: shift.start_time,
      shift_duration_minutes: shift.duration_minutes,
      policy,
      activities: [],
    });
    return {
      feasible: validation.feasible,
      activities: [],
      warnings: validation.feasible
        ? warnings
        : [...warnings, ...(policy.infeasible_policy === 'warn' ? buildFeasibilityMessages(shift, policy) : [])],
      errors: validation.feasible
        ? errors
        : [...errors, ...(policy.infeasible_policy === 'block' ? buildFeasibilityMessages(shift, policy) : validation.errors)],
      diagnostics: validation.diagnostics,
    };
  }

  const activityOrders = policy.allow_flexible_activity_order
    ? uniquePermutations(policy.activities)
    : [policy.activities.map(cloneActivityForPlacement)];
  const allPlacements = [];
  for (const orderedActivities of activityOrders) {
    allPlacements.push(...enumeratePlacements(shift, policy, orderedActivities, {
      intervalDemand: input.intervalDemand,
      existingOffQueueCounts: input.existingOffQueueCounts,
      interval_minutes: input.interval_minutes,
    }));
  }

  if (allPlacements.length === 0) {
    const messages = buildFeasibilityMessages(shift, policy);
    return {
      feasible: false,
      activities: [],
      warnings: policy.infeasible_policy === 'warn' ? [...warnings, ...messages] : warnings,
      errors: policy.infeasible_policy === 'block' ? [...errors, ...messages] : errors,
      diagnostics: {
        shift,
        policy,
        continuous_work_blocks: [],
        work_segments: [],
      },
    };
  }

  allPlacements.sort((a, b) => a.score - b.score);
  const best = allPlacements[0];
  return {
    feasible: true,
    activities: best.activities,
    warnings,
    errors,
    diagnostics: {
      ...best.validation.diagnostics,
      score: best.score,
      placement_count: allPlacements.length,
    },
  };
}

module.exports = {
  buildDefaultBreakPolicy,
  hhmmToMinutes,
  minutesToHHMM,
  normalizeBreakPolicy,
  parseActivitySequenceCode,
  placeBreakActivities,
  validateBreakPlacement,
};
