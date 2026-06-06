const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SHORT_WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const DEFAULT_RULES = {
  default_shift_hours: 9,
  shift_start_granularity_mins: 30,
  days_per_week: 5,
  require_consecutive_rest: true,
  break_duration_mins: 15,
  lunch_duration_mins: 60,
  break_1_after_hours: 2,
  lunch_after_hours: 4,
  break_2_after_hours: 7,
};

function jsDowToMon0(jsDow) {
  return (jsDow + 6) % 7;
}

function hhmmToMin(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToHHMM(min) {
  const wrapped = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateDiffDays(a, b) {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86400000);
}

function round2(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function normalizeChannel(value) {
  const channel = String(value || '').toLowerCase();
  return ['voice', 'chat', 'email', 'cases', 'blended'].includes(channel) ? channel : null;
}

function activityPlan(shiftHours, rules, templateBreakRules) {
  const shiftMin = Math.round(Number(shiftHours || 0) * 60);

  if (Array.isArray(templateBreakRules) && templateBreakRules.length > 0) {
    return templateBreakRules
      .filter((rule) => {
        const offset = Math.round(Number(rule.after_hours || 0) * 60);
        return offset + Number(rule.duration_minutes || 0) <= shiftMin;
      })
      .map((rule) => ({
        type: Number(rule.duration_minutes) >= 30 ? 'meal' : 'break',
        offsetFromStart: Math.round(Number(rule.after_hours || 0) * 60),
        duration: Number(rule.duration_minutes) || 0,
        paid: !!rule.is_paid,
      }));
  }

  const r = { ...DEFAULT_RULES, ...rules };
  const breakDur = Number(r.break_duration_mins);
  const lunchDur = Number(r.lunch_duration_mins);

  if (shiftHours >= 8.5) {
    return [
      { type: 'break', offsetFromStart: Math.round(Number(r.break_1_after_hours) * 60), duration: breakDur, paid: true },
      { type: 'meal', offsetFromStart: Math.round(Number(r.lunch_after_hours) * 60), duration: lunchDur, paid: false },
      { type: 'break', offsetFromStart: Math.round(Number(r.break_2_after_hours) * 60), duration: breakDur, paid: true },
    ];
  }

  if (shiftHours >= 6) {
    return [
      { type: 'break', offsetFromStart: Math.round(Number(r.break_1_after_hours) * 60), duration: breakDur, paid: true },
      { type: 'meal', offsetFromStart: Math.round(shiftHours * 30), duration: Math.min(lunchDur, 30), paid: false },
    ];
  }

  return [
    { type: 'break', offsetFromStart: Math.round(shiftHours * 30), duration: breakDur, paid: true },
  ];
}

function onQueueIntervals(startMin, endMin, activities, intervalMinutes) {
  const covered = new Set();
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  for (let iv = 0; iv < nIntervals; iv += 1) {
    const ivStart = iv * intervalMinutes;
    const ivEnd = ivStart + intervalMinutes;
    if (ivEnd > startMin && ivStart < endMin) covered.add(iv);
  }

  for (const activity of activities) {
    const activityStart = startMin + activity.offsetFromStart;
    const activityEnd = activityStart + activity.duration;
    for (let iv = 0; iv < nIntervals; iv += 1) {
      const ivStart = iv * intervalMinutes;
      const ivEnd = ivStart + intervalMinutes;
      if (activityStart <= ivStart && activityEnd >= ivEnd) covered.delete(iv);
    }
  }

  return covered;
}

function operatingWindowForWeekday(hoursOfOperation, channel, weekday) {
  const key = WEEKDAY_KEYS[weekday];
  if (!hoursOfOperation) return { open: 0, close: 1440 };

  if (channel === 'blended') {
    const channels = ['voice', 'chat', 'email', 'cases'];
    const anyConfigured = channels.some((ch) => hoursOfOperation?.[ch]);
    if (!anyConfigured) return { open: 0, close: 1440 };

    let open = Infinity;
    let close = -Infinity;
    for (const ch of channels) {
      const sched = hoursOfOperation?.[ch]?.[key];
      if (!sched || !sched.enabled) continue;
      open = Math.min(open, hhmmToMin(sched.open));
      const closeMins = hhmmToMin(sched.close);
      close = Math.max(close, closeMins === 0 && sched.close === '00:00' ? 1440 : closeMins);
    }

    return open === Infinity ? null : { open, close };
  }

  const sched = hoursOfOperation?.[channel]?.[key];
  if (sched == null) return { open: 0, close: 1440 };
  if (!sched.enabled) return null;
  const close = hhmmToMin(sched.close);
  return {
    open: hhmmToMin(sched.open),
    close: close === 0 && sched.close === '00:00' ? 1440 : close,
  };
}

function allCombinations(restCount) {
  const result = [];
  function walk(start, current) {
    if (current.length === restCount) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < 7; i += 1) {
      current.push(i);
      walk(i + 1, current);
      current.pop();
    }
  }
  walk(0, []);
  return result;
}

function consecutiveCombinations(restCount) {
  if (restCount <= 0) return [[]];
  if (restCount >= 7) return [[0, 1, 2, 3, 4, 5, 6]];
  const seen = new Set();
  const result = [];
  for (let start = 0; start < 7; start += 1) {
    const combo = Array.from({ length: restCount }, (_, idx) => (start + idx) % 7).sort((a, b) => a - b);
    const key = combo.join(',');
    if (!seen.has(key)) {
      seen.add(key);
      result.push(combo);
    }
  }
  return result;
}

function buildRestCombinations(restCount, consecutiveOnly) {
  return consecutiveOnly ? consecutiveCombinations(restCount) : allCombinations(restCount);
}

function assignRestDays(agents, demandByWeekday, fairnessEnabled, hoursOfOperation, channel, rules) {
  const r = { ...DEFAULT_RULES, ...rules };
  const daysPerWeek = Math.max(0, Math.min(7, Number(r.days_per_week || 5)));
  const restDayCount = 7 - daysPerWeek;
  const combos = buildRestCombinations(restDayCount, !!r.require_consecutive_rest);
  const result = new Map();
  const flexibleAgents = [];

  for (const agent of agents) {
    const fixed = agent.availability?.fixed_rest_days;
    if (Array.isArray(fixed) && fixed.length === restDayCount) {
      const idxs = fixed
        .map((day) => WEEKDAY_KEYS.indexOf(String(day).toLowerCase()))
        .filter((idx) => idx >= 0);
      if (idxs.length === restDayCount) {
        result.set(agent.id, idxs.sort((a, b) => a - b));
        continue;
      }
    }
    flexibleAgents.push(agent);
  }

  const workingAgentCount = Array(7).fill(0);
  for (const [, rest] of result.entries()) {
    for (let d = 0; d < 7; d += 1) {
      if (!rest.includes(d)) workingAgentCount[d] += 1;
    }
  }

  const totalAgents = agents.length;
  const totalDemand = demandByWeekday.reduce((sum, value) => sum + value, 0);
  const restCount = Array(7).fill(0);
  for (const [, rest] of result.entries()) {
    for (const day of rest) restCount[day] += 1;
  }

  const maxRest = Array(7).fill(totalAgents);
  const targetWorkers = Array(7).fill(0);
  if (totalDemand > 0) {
    for (let day = 0; day < 7; day += 1) {
      const share = demandByWeekday[day] / totalDemand;
      targetWorkers[day] = share * daysPerWeek * totalAgents;
      maxRest[day] = totalAgents - Math.ceil(share * totalAgents);
    }
  } else {
    for (let day = 0; day < 7; day += 1) targetWorkers[day] = (daysPerWeek * totalAgents) / 7;
  }

  const closedDays = [];
  for (let day = 0; day < 7; day += 1) {
    if (!operatingWindowForWeekday(hoursOfOperation, channel, day)) closedDays.push(day);
  }

  function comboRespectsBudget(combo) {
    return combo.every((day) => restCount[day] < maxRest[day]);
  }

  flexibleAgents.forEach((agent, index) => {
    let bestCombo = combos[0] || [];

    if (fairnessEnabled) {
      bestCombo = combos[index % combos.length] || [];
      const budgetFallback = combos.find(comboRespectsBudget);
      if (!comboRespectsBudget(bestCombo) && budgetFallback) bestCombo = budgetFallback;
      const closedFallback = combos.find((combo) => closedDays.every((day) => combo.includes(day)) && comboRespectsBudget(combo));
      if (closedFallback) bestCombo = closedFallback;
    } else {
      let bestScore = Infinity;
      for (const combo of combos) {
        let score = 0;
        for (const day of combo) {
          if (restCount[day] >= maxRest[day]) score += 1e9;
        }
        for (const closedDay of closedDays) {
          if (!combo.includes(closedDay)) score += 1e9;
        }
        for (let day = 0; day < 7; day += 1) {
          const newWorking = workingAgentCount[day] + (combo.includes(day) ? 0 : 1);
          const shortage = Math.max(0, targetWorkers[day] - newWorking);
          score += shortage * shortage;
        }
        if (score < bestScore) {
          bestScore = score;
          bestCombo = combo;
        }
      }
    }

    const sorted = [...bestCombo].sort((a, b) => a - b);
    result.set(agent.id, sorted);
    for (const day of sorted) restCount[day] += 1;
    for (let day = 0; day < 7; day += 1) {
      if (!sorted.includes(day)) workingAgentCount[day] += 1;
    }
  });

  return result;
}

function buildScheduledMatrix(agents, restMap, startMap, intervalMinutes) {
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  const scheduled = Array.from({ length: 7 }, () => Array(nIntervals).fill(0));
  for (const agent of agents) {
    const info = startMap.get(agent.id);
    if (!info) continue;
    const rest = restMap.get(agent.id) || [];
    const covered = onQueueIntervals(info.startMin, info.startMin + info.shiftMin, info.plan, intervalMinutes);
    for (let day = 0; day < 7; day += 1) {
      if (rest.includes(day)) continue;
      for (const interval of covered) scheduled[day][interval] += 1;
    }
  }
  return scheduled;
}

function totalShortageScore(scheduled, demandCurves) {
  let score = 0;
  for (let day = 0; day < 7; day += 1) {
    for (let interval = 0; interval < demandCurves[day].length; interval += 1) {
      const shortage = Math.max(0, (demandCurves[day][interval] || 0) - (scheduled[day][interval] || 0));
      score += shortage * shortage;
    }
  }
  return score;
}

function assignStartTimes(agents, restMap, demandCurves, hoursOfOperation, channel, intervalMinutes, shiftLenByAgent, rules, templateBreakRules) {
  const residual = demandCurves.map((curve) => [...curve]);
  const startMap = new Map();
  const granularity = Number((rules || DEFAULT_RULES).shift_start_granularity_mins || 30);

  for (const agent of agents) {
    const shiftHours = Number(shiftLenByAgent.get(agent.id) || rules.default_shift_hours || 9);
    const shiftMin = Math.round(shiftHours * 60);
    const rest = restMap.get(agent.id) || [];
    const workingDays = [0, 1, 2, 3, 4, 5, 6].filter((day) => !rest.includes(day));
    const candidates = new Set();

    for (const day of workingDays) {
      const win = operatingWindowForWeekday(hoursOfOperation, channel, day);
      if (!win) continue;
      for (let start = win.open; start + shiftMin <= win.close; start += granularity) candidates.add(start);
    }
    if (candidates.size === 0) {
      for (let start = 0; start + shiftMin <= 1440; start += granularity) candidates.add(start);
    }

    const plan = activityPlan(shiftHours, rules, templateBreakRules);
    let bestStart = null;
    let bestGain = -Infinity;

    for (const start of candidates) {
      const end = start + shiftMin;
      if (end > 1440) continue;
      let conflicted = false;
      const fitDays = [];
      for (const day of workingDays) {
        const win = operatingWindowForWeekday(hoursOfOperation, channel, day);
        if (!win) continue;
        if (start < win.open || end > win.close) {
          conflicted = true;
          break;
        }
        fitDays.push(day);
      }
      if (conflicted || fitDays.length === 0) continue;

      const covered = onQueueIntervals(start, end, plan, intervalMinutes);
      let gain = 0;
      for (const day of fitDays) {
        for (const interval of covered) {
          if ((residual[day][interval] || 0) > 0) gain += residual[day][interval];
        }
      }
      if (gain > bestGain) {
        bestGain = gain;
        bestStart = start;
      }
    }

    if (bestStart === null) continue;

    startMap.set(agent.id, { startMin: bestStart, shiftMin, shiftHours, plan });
    const covered = onQueueIntervals(bestStart, bestStart + shiftMin, plan, intervalMinutes);
    for (const day of workingDays) {
      const win = operatingWindowForWeekday(hoursOfOperation, channel, day);
      if (!win) continue;
      for (const interval of covered) residual[day][interval] = Math.max(0, residual[day][interval] - 1);
    }
  }

  return startMap;
}

function localSearchImprove(agents, restMap, startMap, demandCurves, hoursOfOperation, channel, intervalMinutes, shiftLenByAgent, rules, templateBreakRules) {
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  const granularity = Number((rules || DEFAULT_RULES).shift_start_granularity_mins || 30);
  const scheduled = buildScheduledMatrix(agents, restMap, startMap, intervalMinutes);

  for (const agent of agents) {
    const current = startMap.get(agent.id);
    if (!current) continue;

    const shiftHours = Number(shiftLenByAgent.get(agent.id) || rules.default_shift_hours || 9);
    const shiftMin = Math.round(shiftHours * 60);
    const rest = restMap.get(agent.id) || [];
    const workingDays = [0, 1, 2, 3, 4, 5, 6].filter((day) => !rest.includes(day));
    const currentCovered = onQueueIntervals(current.startMin, current.startMin + current.shiftMin, current.plan, intervalMinutes);

    for (let day = 0; day < 7; day += 1) {
      if (rest.includes(day)) continue;
      for (const interval of currentCovered) scheduled[day][interval] -= 1;
    }

    let baseline = 0;
    for (let day = 0; day < 7; day += 1) {
      for (let interval = 0; interval < nIntervals; interval += 1) {
        const shortage = Math.max(0, (demandCurves[day][interval] || 0) - (scheduled[day][interval] || 0));
        baseline += shortage * shortage;
      }
    }

    const candidates = new Set();
    for (const day of workingDays) {
      const win = operatingWindowForWeekday(hoursOfOperation, channel, day);
      if (!win) continue;
      for (let start = win.open; start + shiftMin <= win.close; start += granularity) candidates.add(start);
    }
    if (candidates.size === 0) {
      for (let start = 0; start + shiftMin <= 1440; start += granularity) candidates.add(start);
    }

    const basePlan = activityPlan(shiftHours, rules, templateBreakRules);
    let bestStart = current.startMin;
    let bestScore = Infinity;

    for (const start of candidates) {
      const end = start + shiftMin;
      if (end > 1440) continue;
      let conflicted = false;
      const fitDays = [];
      for (const day of workingDays) {
        const win = operatingWindowForWeekday(hoursOfOperation, channel, day);
        if (!win) continue;
        if (start < win.open || end > win.close) {
          conflicted = true;
          break;
        }
        fitDays.push(day);
      }
      if (conflicted || fitDays.length === 0) continue;

      const covered = onQueueIntervals(start, end, basePlan, intervalMinutes);
      let score = baseline;
      for (const day of workingDays) {
        if (!fitDays.includes(day)) continue;
        for (const interval of covered) {
          const previousShortage = Math.max(0, (demandCurves[day][interval] || 0) - (scheduled[day][interval] || 0));
          const newShortage = Math.max(0, (demandCurves[day][interval] || 0) - (scheduled[day][interval] || 0) - 1);
          score += newShortage * newShortage - previousShortage * previousShortage;
        }
      }
      if (score < bestScore) {
        bestScore = score;
        bestStart = start;
      }
    }

    const bestPlan = activityPlan(shiftHours, rules, templateBreakRules);
    startMap.set(agent.id, { startMin: bestStart, shiftMin, shiftHours, plan: bestPlan });
    const newCovered = onQueueIntervals(bestStart, bestStart + shiftMin, bestPlan, intervalMinutes);
    for (let day = 0; day < 7; day += 1) {
      if (rest.includes(day)) continue;
      const win = operatingWindowForWeekday(hoursOfOperation, channel, day);
      if (!win) continue;
      for (const interval of newCovered) scheduled[day][interval] += 1;
    }
  }

  return startMap;
}

function applyBreakStagger(startMap, demandCurves, intervalMinutes) {
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  const blended = Array(nIntervals).fill(0);
  for (let day = 0; day < 7; day += 1) {
    for (let interval = 0; interval < nIntervals; interval += 1) {
      blended[interval] += demandCurves?.[day]?.[interval] || 0;
    }
  }

  const cohorts = new Map();
  for (const [agentId, info] of startMap.entries()) {
    if (!cohorts.has(info.startMin)) cohorts.set(info.startMin, []);
    cohorts.get(info.startMin).push(agentId);
  }

  for (const [startMin, agentIds] of cohorts.entries()) {
    agentIds.sort((a, b) => a - b);
    agentIds.forEach((agentId, idx) => {
      const info = startMap.get(agentId);
      if (!info) return;

      info.plan = info.plan.map((activity) => {
        const candidates = [];
        for (let slide = -30; slide <= 30; slide += 15) {
          const offset = activity.offsetFromStart + slide;
          if (offset < 0 || offset + activity.duration > info.shiftMin) continue;
          const interval = Math.floor((startMin + offset) / intervalMinutes) % nIntervals;
          candidates.push({ offset, demand: blended[interval] || 0 });
        }
        candidates.sort((a, b) => a.demand - b.demand);
        return { ...activity, offsetFromStart: candidates[idx % candidates.length]?.offset ?? activity.offsetFromStart };
      });

      info.plan.sort((a, b) => a.offsetFromStart - b.offsetFromStart);
      for (let i = 1; i < info.plan.length; i += 1) {
        const prev = info.plan[i - 1];
        const cur = info.plan[i];
        if (cur.offsetFromStart < prev.offsetFromStart + prev.duration) {
          info.plan[i] = { ...cur, offsetFromStart: prev.offsetFromStart + prev.duration };
        }
      }
      info.plan = info.plan.filter((activity) => activity.offsetFromStart + activity.duration <= info.shiftMin);
    });
  }

  return startMap;
}

function buildActivitySegments(startMin, shiftMin, plan) {
  const sorted = [...plan].sort((a, b) => a.offsetFromStart - b.offsetFromStart);
  const segments = [];
  let cursor = 0;

  for (const activity of sorted) {
    if (activity.offsetFromStart > cursor) {
      segments.push({
        activity_type: 'work',
        start_time: minToHHMM(startMin + cursor),
        end_time: minToHHMM(startMin + activity.offsetFromStart),
      });
    }
    segments.push({
      activity_type: activity.type === 'meal' ? 'meal' : activity.type === 'break' ? 'break' : 'offline',
      start_time: minToHHMM(startMin + activity.offsetFromStart),
      end_time: minToHHMM(startMin + activity.offsetFromStart + activity.duration),
    });
    cursor = Math.max(cursor, activity.offsetFromStart + activity.duration);
  }

  if (cursor < shiftMin) {
    segments.push({
      activity_type: 'work',
      start_time: minToHHMM(startMin + cursor),
      end_time: minToHHMM(startMin + shiftMin),
    });
  }

  return segments;
}

function availabilityWarnings(agent, weekday, startMin, endMin) {
  const availability = agent.availability || {};
  const day = availability[SHORT_WEEKDAY_KEYS[weekday]];
  if (!day) return [];
  if (day.available === false) {
    return [`Agent weekly availability marks ${WEEKDAY_KEYS[weekday]} unavailable; preview reports this but does not block yet.`];
  }
  const start = day.start ? hhmmToMin(day.start) : null;
  const end = day.end ? hhmmToMin(day.end) : null;
  if (start !== null && end !== null && (startMin < start || endMin > end)) {
    return [`Shift is outside configured ${WEEKDAY_KEYS[weekday]} availability; preview reports this but does not block yet.`];
  }
  return [];
}

function chooseChannelAgents(allAgents, channelsInScope, demandByChannel, poolingMode) {
  const channelAgents = new Map();
  if (poolingMode === 'blended' || (channelsInScope.length === 1 && channelsInScope[0] === 'blended')) {
    channelAgents.set(channelsInScope[0], allAgents);
    return channelAgents;
  }

  const demandShare = {};
  let totalDemand = 0;
  for (const channel of channelsInScope) {
    const sum = demandByChannel.get(channel).reduce((acc, day) => acc + day.reduce((a, b) => a + b, 0), 0);
    demandShare[channel] = sum;
    totalDemand += sum;
  }

  const skillKey = { voice: 'skill_voice', chat: 'skill_chat', email: 'skill_email', cases: 'skill_email' };
  const remaining = [...allAgents];
  for (const channel of channelsInScope) {
    const key = skillKey[channel] || 'skill_voice';
    const skilled = remaining.filter((agent) => agent[key]);
    const share = totalDemand > 0 ? demandShare[channel] / totalDemand : 1 / channelsInScope.length;
    const requested = Math.round(skilled.length * share);
    const take = Math.max(skilled.length > 0 ? 1 : 0, requested);
    const pool = skilled.slice(0, take);
    channelAgents.set(channel, pool);
    const taken = new Set(pool.map((agent) => agent.id));
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (taken.has(remaining[i].id)) remaining.splice(i, 1);
    }
  }

  return channelAgents;
}

function buildCoverageVariance({ channelsInScope, demandByChannel, proposedShifts, horizonStart, horizonEnd, intervalMinutes }) {
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  const variance = [];
  const dailyMap = new Map();
  const weeklyByChannel = new Map();
  const totalDays = dateDiffDays(horizonStart, horizonEnd) + 1;

  const shiftsByDateChannel = new Map();
  for (const shift of proposedShifts) {
    const key = `${shift.date}|${shift.channel}`;
    if (!shiftsByDateChannel.has(key)) shiftsByDateChannel.set(key, []);
    shiftsByDateChannel.get(key).push(shift);
  }

  for (let offset = 0; offset < totalDays; offset += 1) {
    const date = addDays(horizonStart, offset);
    const weekday = jsDowToMon0(new Date(`${date}T00:00:00Z`).getUTCDay());

    for (const channel of channelsInScope) {
      const demandCurves = demandByChannel.get(channel);
      const shifts = shiftsByDateChannel.get(`${date}|${channel}`) || [];
      const scheduled = Array(nIntervals).fill(0);

      for (const shift of shifts) {
        const startMin = hhmmToMin(shift.start_time);
        const shiftEndMin = startMin + Math.round(Number(shift.shift_minutes || 0));
        const nonProductive = shift.activities
          .filter((activity) => activity.activity_type !== 'work')
          .map((activity) => ({
            offsetFromStart: hhmmToMin(activity.start_time) >= startMin
              ? hhmmToMin(activity.start_time) - startMin
              : hhmmToMin(activity.start_time) + 1440 - startMin,
            duration: Math.max(0, hhmmToMin(activity.end_time) - hhmmToMin(activity.start_time)),
          }));
        const covered = onQueueIntervals(startMin, shiftEndMin, nonProductive, intervalMinutes);
        for (const interval of covered) scheduled[interval] += 1;
      }

      let requiredTotal = 0;
      let scheduledTotal = 0;
      let shortageTotal = 0;
      let surplusTotal = 0;
      let shortageCount = 0;
      let worstShortage = null;

      for (let interval = 0; interval < nIntervals; interval += 1) {
        const required = Number(demandCurves?.[weekday]?.[interval] || 0);
        const productive = Number(scheduled[interval] || 0);
        const shortage = Math.max(0, required - productive);
        const surplus = Math.max(0, productive - required);
        const row = {
          channel,
          date,
          weekday,
          interval_start: minToHHMM(interval * intervalMinutes),
          required_fte: round2(required),
          scheduled_productive_fte: round2(productive),
          shortage_fte: round2(shortage),
          surplus_fte: round2(surplus),
        };
        variance.push(row);

        requiredTotal += required;
        scheduledTotal += productive;
        shortageTotal += shortage;
        surplusTotal += surplus;
        if (shortage > 0) shortageCount += 1;
        if (!worstShortage || shortage > worstShortage.shortage_fte) {
          worstShortage = {
            channel,
            date,
            interval_start: row.interval_start,
            shortage_fte: round2(shortage),
          };
        }
      }

      const dailyKey = `${date}|${channel}`;
      dailyMap.set(dailyKey, {
        channel,
        date,
        weekday,
        required_fte_intervals: round2(requiredTotal),
        scheduled_productive_fte_intervals: round2(scheduledTotal),
        shortage_fte_intervals: round2(shortageTotal),
        surplus_fte_intervals: round2(surplusTotal),
        shortage_interval_count: shortageCount,
        worst_shortage: worstShortage?.shortage_fte > 0 ? worstShortage : null,
      });

      const weekly = weeklyByChannel.get(channel) || {
        channel,
        required_fte_intervals: 0,
        scheduled_productive_fte_intervals: 0,
        shortage_fte_intervals: 0,
        surplus_fte_intervals: 0,
        shortage_interval_count: 0,
        shift_count: 0,
        worst_shortage: null,
      };
      weekly.required_fte_intervals += requiredTotal;
      weekly.scheduled_productive_fte_intervals += scheduledTotal;
      weekly.shortage_fte_intervals += shortageTotal;
      weekly.surplus_fte_intervals += surplusTotal;
      weekly.shortage_interval_count += shortageCount;
      weekly.shift_count += shifts.length;
      if (worstShortage?.shortage_fte > 0 && (!weekly.worst_shortage || worstShortage.shortage_fte > weekly.worst_shortage.shortage_fte)) {
        weekly.worst_shortage = worstShortage;
      }
      weeklyByChannel.set(channel, weekly);
    }
  }

  return {
    coverage_variance: variance,
    daily_summary: Array.from(dailyMap.values()),
    weekly_by_channel: Array.from(weeklyByChannel.values()).map((summary) => ({
      ...summary,
      required_fte_intervals: round2(summary.required_fte_intervals),
      scheduled_productive_fte_intervals: round2(summary.scheduled_productive_fte_intervals),
      shortage_fte_intervals: round2(summary.shortage_fte_intervals),
      surplus_fte_intervals: round2(summary.surplus_fte_intervals),
    })),
  };
}

async function generatePreview({ pool, organization_id, lob_id, snapshot_id, horizon_start, horizon_end, fairness_enabled, template_id, staffing_mode, channel }) {
  if (!organization_id) throw new Error('organization_id is required');
  if (!lob_id || !snapshot_id || !horizon_start || !horizon_end) {
    throw new Error('lob_id, snapshot_id, horizon_start, horizon_end required');
  }

  const requestedChannel = normalizeChannel(channel);
  const warnings = [
    'Labor law records are currently reference/config only and are not fully enforced by preview.',
    'Approved leave/date-specific availability is not fully enforced yet.',
    'Contract-rule enforcement is limited to existing generator capabilities.',
    'Preview is read-only and does not save draft shifts or publish schedules.',
  ];

  const snapshotRes = await pool.query(
    `SELECT *
     FROM scheduling_demand_snapshots
     WHERE id=$1 AND organization_id=$2 AND lob_id=$3`,
    [snapshot_id, organization_id, lob_id]
  );
  if (snapshotRes.rows.length === 0) throw new Error(`Snapshot ${snapshot_id} not found for this LOB`);
  const snapshot = snapshotRes.rows[0];
  const sourceIntervalMinutes = Number(snapshot.interval_minutes || 30);
  const intervalMinutes = 15;
  const nIntervals = Math.ceil(1440 / intervalMinutes);

  if (sourceIntervalMinutes !== intervalMinutes) {
    warnings.push(`Snapshot interval_minutes is ${sourceIntervalMinutes}; preview expands rows to 15-minute coverage intervals.`);
  }
  if (staffing_mode && String(staffing_mode) !== String(snapshot.staffing_mode)) {
    warnings.push(`Requested staffing_mode ${staffing_mode} differs from snapshot staffing_mode ${snapshot.staffing_mode}; snapshot rows remain authoritative.`);
  }

  const rowsRes = await pool.query(
    `SELECT channel, weekday, interval_start, required_fte
     FROM scheduling_demand_snapshot_rows
     WHERE snapshot_id=$1
     ORDER BY channel, weekday, interval_start`,
    [snapshot_id]
  );

  const demandByChannel = new Map();
  for (const row of rowsRes.rows) {
    const rowChannel = normalizeChannel(row.channel) || 'blended';
    if (requestedChannel && requestedChannel !== 'blended' && rowChannel !== requestedChannel) continue;
    if (requestedChannel === 'blended' && rowChannel !== 'blended') continue;

    if (!demandByChannel.has(rowChannel)) {
      demandByChannel.set(rowChannel, Array.from({ length: 7 }, () => Array(nIntervals).fill(0)));
    }
    const intervalStart = typeof row.interval_start === 'string'
      ? row.interval_start
      : row.interval_start.toString().slice(0, 5);
    const intervalStartMin = hhmmToMin(intervalStart);
    const intervalEndMin = Math.min(1440, intervalStartMin + sourceIntervalMinutes);
    const startIdx = Math.floor(intervalStartMin / intervalMinutes);
    const endIdx = Math.max(startIdx + 1, Math.ceil(intervalEndMin / intervalMinutes));
    const weekday = Number(row.weekday);
    if (weekday >= 0 && weekday < 7 && startIdx >= 0 && startIdx < nIntervals) {
      for (let intervalIdx = startIdx; intervalIdx < Math.min(endIdx, nIntervals); intervalIdx += 1) {
        demandByChannel.get(rowChannel)[weekday][intervalIdx] = Number(row.required_fte) || 0;
      }
    }
  }

  if (demandByChannel.size === 0) throw new Error('Snapshot has no matching demand rows');

  const [rulesRes, lobRes, agentsRes] = await Promise.all([
    pool.query('SELECT * FROM scheduler_rules WHERE organization_id=$1 AND lob_id=$2', [organization_id, lob_id]),
    pool.query('SELECT hours_of_operation, pooling_mode FROM lob_settings WHERE lob_id=$1', [lob_id]),
    pool.query(
      `SELECT id, full_name, skill_voice, skill_chat, skill_email, accommodation_flags, availability, shift_length_hours, lob_assignments, contract_type
       FROM scheduling_agents
       WHERE organization_id=$1 AND status='active' AND $2 = ANY(lob_assignments)
       ORDER BY id`,
      [organization_id, lob_id]
    ),
  ]);

  const rules = { ...DEFAULT_RULES, ...(rulesRes.rows[0] || {}) };
  const hoursOfOperation = lobRes.rows[0]?.hours_of_operation || null;
  const poolingMode = lobRes.rows[0]?.pooling_mode || 'dedicated';
  const agents = agentsRes.rows.map((agent) => ({
    ...agent,
    availability: parseMaybeJson(agent.availability, {}) || {},
    accommodation_flags: parseMaybeJson(agent.accommodation_flags, []) || [],
    shift_length_hours: Number(agent.shift_length_hours || rules.default_shift_hours || 9),
  }));

  if (agents.length === 0) {
    warnings.push('No active agents are assigned to this LOB; preview can only report demand shortage.');
  }

  let templateBreakRules = null;
  let resolvedTemplateId = template_id ? Number(template_id) : null;
  if (resolvedTemplateId) {
    const templateRes = await pool.query(
      'SELECT id, break_rules FROM scheduling_shift_templates WHERE id=$1 AND organization_id=$2',
      [resolvedTemplateId, organization_id]
    );
    if (templateRes.rows.length > 0) {
      templateBreakRules = parseMaybeJson(templateRes.rows[0].break_rules, null);
    } else {
      warnings.push(`Shift template ${resolvedTemplateId} was not found for this organization; scheduler rules break structure was used.`);
      resolvedTemplateId = null;
    }
  }

  const proposedShifts = [];
  const skipped = [];
  const channelsInScope = Array.from(demandByChannel.keys());
  const channelAgents = chooseChannelAgents(agents, channelsInScope, demandByChannel, poolingMode);
  const totalDays = dateDiffDays(horizon_start, horizon_end) + 1;

  for (const activeChannel of channelsInScope) {
    const channelPool = channelAgents.get(activeChannel) || [];
    if (channelPool.length === 0) {
      warnings.push(`No eligible active agents were available for channel ${activeChannel}; all demand for that channel remains short.`);
      continue;
    }

    const demandCurves = demandByChannel.get(activeChannel);
    const demandByWeekday = demandCurves.map((day) => day.reduce((sum, value) => sum + value, 0));
    const restMap = assignRestDays(channelPool, demandByWeekday, !!fairness_enabled, hoursOfOperation, activeChannel, rules);
    const shiftLenByAgent = new Map();
    for (const agent of channelPool) {
      const agentHours = Number(agent.shift_length_hours);
      shiftLenByAgent.set(agent.id, agentHours !== 9 ? agentHours : Number(rules.default_shift_hours || 9));
    }

    let bestStartMap = null;
    let bestScore = Infinity;
    const passOrders = [
      [...channelPool].sort((a, b) => a.id - b.id),
      [...channelPool].sort((a, b) => b.id - a.id),
      [...channelPool].sort((a, b) => String(a.full_name).localeCompare(String(b.full_name))),
    ];
    for (const order of passOrders) {
      let candidate = assignStartTimes(order, restMap, demandCurves, hoursOfOperation, activeChannel, intervalMinutes, shiftLenByAgent, rules, templateBreakRules);
      candidate = applyBreakStagger(candidate, demandCurves, intervalMinutes);
      const score = totalShortageScore(buildScheduledMatrix(channelPool, restMap, candidate, intervalMinutes), demandCurves);
      if (score < bestScore) {
        bestScore = score;
        bestStartMap = candidate;
      }
    }

    let startMap = localSearchImprove(channelPool, restMap, bestStartMap || new Map(), demandCurves, hoursOfOperation, activeChannel, intervalMinutes, shiftLenByAgent, rules, templateBreakRules);
    startMap = applyBreakStagger(startMap, demandCurves, intervalMinutes);

    for (let offset = 0; offset < totalDays; offset += 1) {
      const date = addDays(horizon_start, offset);
      const weekday = jsDowToMon0(new Date(`${date}T00:00:00Z`).getUTCDay());
      const dayWindow = operatingWindowForWeekday(hoursOfOperation, activeChannel, weekday);
      if (!dayWindow) continue;

      for (const agent of channelPool) {
        const info = startMap.get(agent.id);
        if (!info) {
          skipped.push({ agent_id: agent.id, agent_name: agent.full_name, channel: activeChannel, reason: 'No valid start time found.' });
          continue;
        }
        const rest = restMap.get(agent.id) || [];
        if (rest.includes(weekday)) continue;

        const paidMinutes = info.shiftMin - info.plan.filter((activity) => !activity.paid).reduce((sum, activity) => sum + activity.duration, 0);
        const productiveMinutes = info.shiftMin - info.plan.reduce((sum, activity) => sum + activity.duration, 0);
        const endMin = info.startMin + info.shiftMin;
        proposedShifts.push({
          agent_id: agent.id,
          agent_name: agent.full_name,
          channel: activeChannel,
          date,
          weekday,
          start_time: minToHHMM(info.startMin),
          end_time: minToHHMM(endMin),
          is_overnight: endMin >= 1440,
          shift_template_id: resolvedTemplateId,
          shift_minutes: info.shiftMin,
          paid_minutes: Math.max(0, paidMinutes),
          productive_minutes: Math.max(0, productiveMinutes),
          activities: buildActivitySegments(info.startMin, info.shiftMin, info.plan),
          warnings: availabilityWarnings(agent, weekday, info.startMin, endMin),
        });
      }
    }
  }

  const coverage = buildCoverageVariance({
    channelsInScope,
    demandByChannel,
    proposedShifts,
    horizonStart: horizon_start,
    horizonEnd: horizon_end,
    intervalMinutes,
  });

  let totalRequired = 0;
  let totalScheduled = 0;
  let totalShortage = 0;
  let totalSurplus = 0;
  let shortageIntervalCount = 0;
  let worstShortage = null;

  for (const row of coverage.coverage_variance) {
    totalRequired += row.required_fte;
    totalScheduled += row.scheduled_productive_fte;
    totalShortage += row.shortage_fte;
    totalSurplus += row.surplus_fte;
    if (row.shortage_fte > 0) shortageIntervalCount += 1;
    if (row.shortage_fte > 0 && (!worstShortage || row.shortage_fte > worstShortage.shortage_fte)) {
      worstShortage = {
        channel: row.channel,
        date: row.date,
        interval_start: row.interval_start,
        shortage_fte: row.shortage_fte,
      };
    }
  }

  const summary = {
    feasible: shortageIntervalCount === 0 && agents.length > 0,
    total_required_fte_intervals: round2(totalRequired),
    total_scheduled_productive_fte_intervals: round2(totalScheduled),
    total_shortage_fte_intervals: round2(totalShortage),
    total_surplus_fte_intervals: round2(totalSurplus),
    shortage_interval_count: shortageIntervalCount,
    worst_shortage: worstShortage,
    daily_summary: coverage.daily_summary,
    weekly_summary: {
      channels: coverage.weekly_by_channel,
      shift_count: proposedShifts.length,
      agent_count: agents.length,
      interval_minutes: intervalMinutes,
      source_interval_minutes: sourceIntervalMinutes,
      horizon_start,
      horizon_end,
    },
    warnings,
  };

  return {
    preview_mode: true,
    snapshot: {
      id: snapshot.id,
      label: snapshot.snapshot_label,
      staffing_mode: snapshot.staffing_mode,
      interval_minutes: sourceIntervalMinutes,
      preview_interval_minutes: intervalMinutes,
      approved_at: snapshot.approved_at,
    },
    inputs: {
      lob_id,
      snapshot_id,
      horizon_start,
      horizon_end,
      fairness_enabled: !!fairness_enabled,
      template_id: resolvedTemplateId,
      requested_channel: requestedChannel,
      requested_staffing_mode: staffing_mode || null,
    },
    proposed_shifts: proposedShifts,
    coverage_variance: coverage.coverage_variance,
    summary,
    warnings,
    hard_rule_limitations: warnings.slice(0, 3),
    skipped,
  };
}

module.exports = { generatePreview };
