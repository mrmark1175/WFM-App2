// Auto-Scheduler Generator — Phase 2 (multi-pass greedy + local search, SLA-optimal)
//
// Rules enforced:
//   - Each agent has ONE start time for all working days in the week
//   - Five working days per week, two CONSECUTIVE rest days
//   - Fixed-rest-day accommodations (e.g., Sat+Sun) always honored
//   - Shift length per agent (default 9h; per-agent override supported)
//   - 9h shift breaks: +2:00 (15m), +4:00 lunch (60m), +7:00 (15m)
//   - Shift starts on 30-minute boundaries clamped to LOB hours_of_operation
//   - Channels: blended LOB → one pool; dedicated LOB → per-channel pools
//
// Optimisation strategy:
//   1. Demand-proportional scoring — high-shortage intervals attract more coverage
//   2. Multi-pass (8 orderings) — overcomes single-pass ordering bias
//   3. Local search improvement — re-seats each agent to reduce total squared shortage
//   4. Valley-aware break stagger — breaks land in low-demand windows
//
// Entry point: await generate({ pool, lob_id, snapshot_id, horizon_start,
//                              horizon_end, fairness_enabled, created_by })
// Returns: { run_id, draft_count, coverage_report }

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

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

// Convert JS Date.getDay() (0=Sun..6=Sat) to our convention (0=Mon..6=Sun)
function jsDowToMon0(jsDow) { return (jsDow + 6) % 7; }

function hhmmToMin(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minToHHMM(min) {
  const wrapped = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateDiffDays(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86400000);
}

// Fisher-Yates shuffle — produces a new array, does not mutate input
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Break/lunch placement for a given shift length ───────────────────────────
// Returns activity offsets in minutes from shift start.
function activityPlan(shiftHours, rules) {
  const r = { ...DEFAULT_RULES, ...rules };
  const b1Mins  = Math.round(r.break_1_after_hours * 60);
  const lnMins  = Math.round(r.lunch_after_hours * 60);
  const b2Mins  = Math.round(r.break_2_after_hours * 60);
  const breakDur = Number(r.break_duration_mins);
  const lunchDur = Number(r.lunch_duration_mins);

  if (shiftHours >= 8.5) {
    return [
      { type: 'break', offset: b1Mins, duration: breakDur, paid: true },
      { type: 'lunch', offset: lnMins, duration: lunchDur, paid: false },
      { type: 'break', offset: b2Mins, duration: breakDur, paid: true },
    ];
  }
  if (shiftHours >= 6) {
    return [
      { type: 'break', offset: b1Mins,                        duration: breakDur,               paid: true },
      { type: 'lunch', offset: Math.round(shiftHours * 30),   duration: Math.min(lunchDur, 30), paid: false },
    ];
  }
  return [
    { type: 'break', offset: Math.round(shiftHours * 30), duration: breakDur, paid: true },
  ];
}

// Given a shift (startMin, endMin) and its activities (with staggers), return the
// set of interval-indexes where the agent is ON-QUEUE covering demand.
function onQueueIntervals(startMin, endMin, activities, intervalMinutes) {
  const covered = new Set();
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  for (let iv = 0; iv < nIntervals; iv++) {
    const ivStart = iv * intervalMinutes;
    const ivEnd = ivStart + intervalMinutes;
    if (ivEnd > startMin && ivStart < endMin) covered.add(iv);
  }
  for (const act of activities) {
    const aStart = startMin + act.offsetFromStart;
    const aEnd = aStart + act.duration;
    for (let iv = 0; iv < nIntervals; iv++) {
      const ivStart = iv * intervalMinutes;
      const ivEnd = ivStart + intervalMinutes;
      if (aStart <= ivStart && aEnd >= ivEnd) covered.delete(iv);
    }
  }
  return covered;
}

// ── Operating-hours union across channels (for blended) or per-channel ───────
function operatingWindowForWeekday(hoursOfOperation, channel, weekday) {
  const key = WEEKDAY_KEYS[weekday];
  if (!hoursOfOperation) return { open: 0, close: 1440 };
  if (channel === 'blended') {
    const anyChannelConfigured = ['voice', 'chat', 'email', 'cases'].some((ch) => hoursOfOperation?.[ch]);
    if (!anyChannelConfigured) return { open: 0, close: 1440 };
    let open = Infinity, close = -Infinity;
    for (const ch of ['voice', 'chat', 'email', 'cases']) {
      const sched = hoursOfOperation?.[ch]?.[key];
      if (!sched) continue;
      if (!sched.enabled) continue;
      open = Math.min(open, hhmmToMin(sched.open));
      const c = hhmmToMin(sched.close);
      close = Math.max(close, c === 0 && sched.close === '00:00' ? 1440 : c);
    }
    if (open === Infinity) return null;
    return { open, close };
  } else {
    const sched = hoursOfOperation?.[channel]?.[key];
    if (sched === undefined || sched === null) return { open: 0, close: 1440 };
    if (!sched.enabled) return null;
    const close = hhmmToMin(sched.close);
    return { open: hhmmToMin(sched.open), close: close === 0 && sched.close === '00:00' ? 1440 : close };
  }
}

// ── Candidate rest-day combinations ─────────────────────────────────────────
function buildRestCombinations(restCount, consecutiveOnly) {
  const all = [];
  function combine(start, current) {
    if (current.length === restCount) { all.push([...current]); return; }
    for (let i = start; i < 7; i++) { current.push(i); combine(i + 1, current); current.pop(); }
  }
  combine(0, []);

  if (!consecutiveOnly) return all;

  return all.filter((combo) => {
    const sorted = [...combo].sort((a, b) => a - b);
    const straight = sorted.every((v, i) => i === 0 || v === sorted[i - 1] + 1);
    if (straight) return true;
    const max = sorted[sorted.length - 1];
    const min = sorted[0];
    if (max - min === 6) return true;
    const wrapped = sorted.filter((v) => v >= min && v <= max);
    return wrapped.every((v, i) => i === 0 || v === wrapped[i - 1] + 1) &&
           (max + 1) % 7 === sorted.find((v) => v < min) || false;
  });
}

// ── Rest-day assignment ──────────────────────────────────────────────────────
function assignRestDays(agents, demandByWeekday, fairnessEnabled, hoursOfOperation, channel, rules) {
  const r = { ...DEFAULT_RULES, ...rules };
  const restDayCount = 7 - Number(r.days_per_week);
  const REST_COMBOS = buildRestCombinations(restDayCount, !!r.require_consecutive_rest);
  const combos = REST_COMBOS.length > 0 ? REST_COMBOS : buildRestCombinations(restDayCount, false);

  const result = new Map();
  const rotationIdx = { i: 0 };
  const flexibleAgents = [];

  for (const agent of agents) {
    const fixed = agent.availability?.fixed_rest_days;
    if (Array.isArray(fixed) && fixed.length === restDayCount) {
      const idxs = fixed.map((d) => WEEKDAY_KEYS.indexOf(String(d).toLowerCase())).filter((i) => i >= 0);
      if (idxs.length === restDayCount) {
        result.set(agent.id, idxs.sort((a, b) => a - b));
        continue;
      }
    }
    flexibleAgents.push(agent);
  }

  const workingAgentCount = Array(7).fill(0);
  for (const agent of agents) {
    if (!result.has(agent.id)) continue;
    const rest = result.get(agent.id);
    for (let d = 0; d < 7; d++) {
      if (!rest.includes(d)) workingAgentCount[d]++;
    }
  }

  const totalAgents = agents.length;
  const totalDemand = demandByWeekday.reduce((a, b) => a + b, 0);
  const daysPerWeek = Number(r.days_per_week);

  const minAgents = Array(7).fill(0);
  const maxRest = Array(7).fill(totalAgents);
  if (totalDemand > 0) {
    for (let d = 0; d < 7; d++) {
      minAgents[d] = Math.ceil((demandByWeekday[d] / totalDemand) * totalAgents);
      maxRest[d] = totalAgents - minAgents[d];
    }
  }

  const restCount = Array(7).fill(0);
  for (const [, rest] of result.entries()) {
    for (const d of rest) restCount[d]++;
  }

  const targetWorkers = Array(7).fill(0);
  if (totalDemand > 0) {
    for (let d = 0; d < 7; d++) {
      targetWorkers[d] = (demandByWeekday[d] / totalDemand) * daysPerWeek * totalAgents;
    }
  } else {
    for (let d = 0; d < 7; d++) targetWorkers[d] = (daysPerWeek * totalAgents) / 7;
  }

  const closedDays = [];
  for (let d = 0; d < 7; d++) {
    const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
    if (!win) closedDays.push(d);
  }

  function comboRespectsBudget(combo) {
    return combo.every((d) => restCount[d] < maxRest[d]);
  }

  if (fairnessEnabled) {
    for (const agent of flexibleAgents) {
      const baseIdx = rotationIdx.i % combos.length;
      rotationIdx.i++;

      let combo = combos[baseIdx];

      if (!comboRespectsBudget(combo)) {
        const fallback = combos.find((c) => comboRespectsBudget(c));
        if (fallback) combo = fallback;
      }

      if (closedDays.length > 0 && closedDays.some((d) => !combo.includes(d))) {
        const better = combos.find(
          (c) => closedDays.every((d) => c.includes(d)) && comboRespectsBudget(c)
        );
        if (better) combo = better;
      }

      result.set(agent.id, [...combo].sort((a, b) => a - b));
      for (const d of combo) restCount[d]++;
      for (let d = 0; d < 7; d++) if (!combo.includes(d)) workingAgentCount[d]++;
    }
  } else {
    for (const agent of flexibleAgents) {
      let bestCombo = combos[0];
      let bestScore = Infinity;
      for (const combo of combos) {
        let p1Penalty = 0;
        for (const d of combo) {
          if (restCount[d] >= maxRest[d]) p1Penalty += 1e9;
        }
        let closedPenalty = 0;
        for (const cd of closedDays) {
          if (!combo.includes(cd)) closedPenalty += 1e9;
        }
        let shortageSq = 0;
        for (let d = 0; d < 7; d++) {
          const newWorking = workingAgentCount[d] + (combo.includes(d) ? 0 : 1);
          const shortage = Math.max(0, targetWorkers[d] - newWorking);
          shortageSq += shortage * shortage;
        }
        const score = p1Penalty + closedPenalty + shortageSq;
        if (score < bestScore) { bestScore = score; bestCombo = combo; }
      }
      result.set(agent.id, [...bestCombo].sort((a, b) => a - b));
      for (const d of bestCombo) restCount[d]++;
      for (let d = 0; d < 7; d++) if (!bestCombo.includes(d)) workingAgentCount[d]++;
    }
  }

  return result;
}

// ── Build scheduled-coverage matrix (for scoring and local search) ────────────
function buildScheduledMatrix(agents, restMap, startMap, intervalMinutes) {
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  const scheduled = Array.from({ length: 7 }, () => Array(nIntervals).fill(0));
  for (const agent of agents) {
    const info = startMap.get(agent.id);
    if (!info) continue;
    const rest = restMap.get(agent.id) || [];
    const covered = onQueueIntervals(info.startMin, info.startMin + info.shiftMin, info.plan, intervalMinutes);
    for (let d = 0; d < 7; d++) {
      if (rest.includes(d)) continue;
      for (const iv of covered) scheduled[d][iv]++;
    }
  }
  return scheduled;
}

// ── Total squared shortage (objective: minimise) ─────────────────────────────
// Quadratic penalty makes large gaps much worse than small ones, pushing the
// algorithm to eliminate coverage holes rather than just accumulate small surpluses.
function totalShortageScore(scheduled, demandCurves) {
  let score = 0;
  for (let d = 0; d < 7; d++) {
    for (let iv = 0; iv < demandCurves[d].length; iv++) {
      const shortage = Math.max(0, (demandCurves[d][iv] || 0) - (scheduled[d][iv] || 0));
      score += shortage * shortage;
    }
  }
  return score;
}

// ── Start-time assignment (demand-proportional scoring) ─────────────────────
// agents: array — caller controls ordering to break greedy bias.
function assignStartTimes(agents, restMap, demandCurves, hoursOfOperation, channel, intervalMinutes, shiftLenByAgent, rules) {
  const residual = demandCurves.map((curve) => [...curve]);
  const startMap = new Map();

  for (const agent of agents) {
    const shiftH = Number(shiftLenByAgent.get(agent.id) || 9);
    const shiftMin = Math.round(shiftH * 60);
    const rest = restMap.get(agent.id) || [];
    const workingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !rest.includes(d));

    let bestStart = null;
    let bestGain = -Infinity;

    const candidateStarts = new Set();
    for (const d of workingDays) {
      const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
      if (!win) continue;
      const gran = Number((rules || DEFAULT_RULES).shift_start_granularity_mins || 30);
      for (let s = win.open; s + shiftMin <= win.close; s += gran) {
        candidateStarts.add(s);
      }
    }
    if (candidateStarts.size === 0) {
      const gran = Number((rules || DEFAULT_RULES).shift_start_granularity_mins || 30);
      for (let s = 0; s + shiftMin <= 1440; s += gran) candidateStarts.add(s);
    }

    const plan = activityPlan(shiftH, rules).map((a) => ({
      type: a.type, offsetFromStart: a.offset, duration: a.duration, paid: a.paid,
    }));

    for (const s of candidateStarts) {
      const endMin = s + shiftMin;
      if (endMin > 1440) continue;
      let fitDays = [];
      let conflicted = false;
      for (const d of workingDays) {
        const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
        if (!win) continue;
        if (s < win.open || endMin > win.close) { conflicted = true; break; }
        fitDays.push(d);
      }
      if (conflicted) continue;
      if (fitDays.length === 0) continue;

      const covered = onQueueIntervals(s, endMin, plan, intervalMinutes);
      let gain = 0;
      for (const d of fitDays) {
        for (const iv of covered) {
          // Demand-proportional: weight gain by actual remaining shortage so the
          // algorithm prioritises intervals with the highest SLA impact.
          if (residual[d][iv] > 0) gain += residual[d][iv];
        }
      }
      if (gain > bestGain) { bestGain = gain; bestStart = s; }
    }

    if (bestStart === null) continue;

    startMap.set(agent.id, { startMin: bestStart, shiftMin, plan });

    const covered = onQueueIntervals(bestStart, bestStart + shiftMin, plan, intervalMinutes);
    for (const d of workingDays) {
      const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
      if (!win) continue;
      for (const iv of covered) residual[d][iv] = Math.max(0, residual[d][iv] - 1);
    }
  }

  return startMap;
}

// ── Valley-aware break stagger ────────────────────────────────────────────────
// For each start-time cohort, we spread breaks across the low-demand slots
// within the valid break window so fewer agents are simultaneously off-queue.
// demandCurves: weekday × interval demand (blended across days for placement)
function applyStagger(startMap, demandCurves, intervalMinutes) {
  const nIntervals = Math.ceil(1440 / intervalMinutes);

  // Build blended demand across all 7 days (sums represent "typical demand level")
  const blended = Array(nIntervals).fill(0);
  if (demandCurves) {
    for (let d = 0; d < 7; d++) {
      for (let iv = 0; iv < nIntervals; iv++) {
        blended[iv] += (demandCurves[d][iv] || 0);
      }
    }
  }

  const cohorts = new Map(); // startMin → agentIds[]
  for (const [agentId, info] of startMap.entries()) {
    const key = info.startMin;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(agentId);
  }

  for (const [startMin, ids] of cohorts.entries()) {
    ids.sort((a, b) => a - b);
    const cohortSize = ids.length;

    // For each break slot type, pre-compute candidate offsets within the shift
    // sorted by ascending blended demand (valley-first), capped to 4 distinct
    // slots so the stagger doesn't push breaks out of reasonable range.
    const getValleySortedOffsets = (baseOffset, duration, shiftMin, windowMins) => {
      const candidates = [];
      const maxSlide = Math.min(windowMins, shiftMin - baseOffset - duration);
      for (let slide = 0; slide <= maxSlide; slide += intervalMinutes) {
        const offset = baseOffset + slide;
        if (offset + duration > shiftMin) break;
        const iv = Math.floor((startMin + offset) / intervalMinutes) % nIntervals;
        candidates.push({ offset, demand: blended[iv] || 0 });
      }
      // Sort ascending by demand: lowest demand = best break slot
      candidates.sort((a, b) => a.demand - b.demand);
      return candidates.map((c) => c.offset);
    };

    ids.forEach((agentId, idx) => {
      const info = startMap.get(agentId);
      const VALLEY_WINDOW = intervalMinutes * 4; // search up to 4 intervals ahead

      info.plan = info.plan.map((act) => {
        // Valley offsets for this activity type; fall back to index-based stagger
        const valleys = getValleySortedOffsets(act.offsetFromStart, act.duration, info.shiftMin, VALLEY_WINDOW);
        const newOffset = valleys.length > 0
          ? valleys[idx % valleys.length]
          : act.offsetFromStart + (act.type === 'break' ? 15 * (idx % 4) : 30 * (idx % 2));
        return { ...act, offsetFromStart: newOffset };
      });

      // Clamp: remove activities that would extend past shift end
      info.plan = info.plan.filter((a) => a.offsetFromStart + a.duration <= info.shiftMin);

      // Deduplicate: if two activities were assigned the same offset, nudge the later one
      info.plan.sort((a, b) => a.offsetFromStart - b.offsetFromStart);
      for (let i = 1; i < info.plan.length; i++) {
        const prev = info.plan[i - 1];
        const cur = info.plan[i];
        if (cur.offsetFromStart < prev.offsetFromStart + prev.duration) {
          info.plan[i] = { ...cur, offsetFromStart: prev.offsetFromStart + prev.duration };
        }
      }
      info.plan = info.plan.filter((a) => a.offsetFromStart + a.duration <= info.shiftMin);
    });
  }

  return startMap;
}

// ── Local search improvement pass ─────────────────────────────────────────────
// For each agent (in random order), temporarily remove them from the schedule,
// try every valid start time, and keep the one that minimises total squared shortage.
// Each re-seat is incremental (O(coveredIntervals)) rather than a full recompute.
// Runs up to MAX_ITER times until no agent can be improved.
function localSearchImprove(agents, restMap, startMap, demandCurves, hoursOfOperation, channel, intervalMinutes, shiftLenByAgent, rules) {
  const MAX_ITER = 3;
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  const gran = Number((rules || DEFAULT_RULES).shift_start_granularity_mins || 30);

  // Build mutable scheduled matrix
  const scheduled = buildScheduledMatrix(agents, restMap, startMap, intervalMinutes);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let anyImproved = false;

    for (const agent of shuffleArray(agents)) {
      const info = startMap.get(agent.id);
      if (!info) continue;

      const shiftH = Number(shiftLenByAgent.get(agent.id) || 9);
      const shiftMin = Math.round(shiftH * 60);
      const rest = restMap.get(agent.id) || [];
      const workingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !rest.includes(d));

      // Current on-queue intervals for this agent
      const curCovered = onQueueIntervals(info.startMin, info.startMin + info.shiftMin, info.plan, intervalMinutes);

      // Remove agent's current contribution
      for (let d = 0; d < 7; d++) {
        if (rest.includes(d)) continue;
        for (const iv of curCovered) scheduled[d][iv]--;
      }

      // Score without this agent (baseline to beat)
      let baseline = 0;
      for (let d = 0; d < 7; d++) {
        for (let iv = 0; iv < nIntervals; iv++) {
          const sh = Math.max(0, (demandCurves[d][iv] || 0) - scheduled[d][iv]);
          baseline += sh * sh;
        }
      }

      // Try all candidate start times
      const candidateStarts = new Set();
      for (const d of workingDays) {
        const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
        if (!win) continue;
        for (let s = win.open; s + shiftMin <= win.close; s += gran) candidateStarts.add(s);
      }
      if (candidateStarts.size === 0) {
        for (let s = 0; s + shiftMin <= 1440; s += gran) candidateStarts.add(s);
      }

      const basePlan = activityPlan(shiftH, rules).map((a) => ({
        type: a.type, offsetFromStart: a.offset, duration: a.duration, paid: a.paid,
      }));

      let bestStart = info.startMin;
      let bestScore = Infinity;

      for (const s of candidateStarts) {
        const endMin = s + shiftMin;
        if (endMin > 1440) continue;
        let fitDays = [];
        let conflicted = false;
        for (const d of workingDays) {
          const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
          if (!win) continue;
          if (s < win.open || endMin > win.close) { conflicted = true; break; }
          fitDays.push(d);
        }
        if (conflicted || fitDays.length === 0) continue;

        const newCovered = onQueueIntervals(s, endMin, basePlan, intervalMinutes);

        // Compute score delta (only changed intervals need re-evaluation)
        let score = baseline;
        for (let d = 0; d < 7; d++) {
          if (rest.includes(d)) continue;
          const isWorking = fitDays.includes(d);
          // Intervals this candidate would cover
          for (const iv of (isWorking ? newCovered : [])) {
            const prevSh = Math.max(0, (demandCurves[d][iv] || 0) - scheduled[d][iv]);
            const newSh  = Math.max(0, (demandCurves[d][iv] || 0) - scheduled[d][iv] - 1);
            score += newSh * newSh - prevSh * prevSh;
          }
        }

        if (score < bestScore) { bestScore = score; bestStart = s; }
      }

      // Apply best start and add back contribution
      const bestPlan = activityPlan(shiftH, rules).map((a) => ({
        type: a.type, offsetFromStart: a.offset, duration: a.duration, paid: a.paid,
      }));
      if (bestStart !== info.startMin) anyImproved = true;
      startMap.set(agent.id, { startMin: bestStart, shiftMin, plan: bestPlan });

      const newCovered = onQueueIntervals(bestStart, bestStart + shiftMin, bestPlan, intervalMinutes);
      for (let d = 0; d < 7; d++) {
        if (rest.includes(d)) continue;
        const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
        if (!win) continue;
        for (const iv of newCovered) scheduled[d][iv]++;
      }
    }

    if (!anyImproved) break;
  }

  return startMap;
}

// ── Compute coverage report ──────────────────────────────────────────────────
function computeCoverage(agents, restMap, startMap, demandCurves, intervalMinutes) {
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  const scheduled = Array.from({ length: 7 }, () => Array(nIntervals).fill(0));
  for (const agent of agents) {
    const info = startMap.get(agent.id);
    if (!info) continue;
    const rest = restMap.get(agent.id) || [];
    const covered = onQueueIntervals(info.startMin, info.startMin + info.shiftMin, info.plan, intervalMinutes);
    for (let d = 0; d < 7; d++) {
      if (rest.includes(d)) continue;
      for (const iv of covered) scheduled[d][iv]++;
    }
  }
  const report = [];
  for (let d = 0; d < 7; d++) {
    const intervals = [];
    let totalReq = 0, totalSched = 0, shortage = 0;
    for (let iv = 0; iv < nIntervals; iv++) {
      const req = demandCurves[d][iv] || 0;
      const sch = scheduled[d][iv];
      totalReq += req;
      totalSched += sch;
      shortage += Math.max(0, req - sch);
      if (req > 0 || sch > 0) intervals.push({ interval: minToHHMM(iv * intervalMinutes), required: +req.toFixed(2), scheduled: sch });
    }
    report.push({ weekday: WEEKDAY_KEYS[d], totalRequired: +totalReq.toFixed(2), totalScheduled: +totalSched.toFixed(2), shortageFTE: +shortage.toFixed(2), intervals });
  }
  return report;
}

// ── Main entry ───────────────────────────────────────────────────────────────
async function generate({ pool, lob_id, snapshot_id, horizon_start, horizon_end, fairness_enabled, created_by, rules }) {
  rules = { ...DEFAULT_RULES, ...rules };

  const snap = await pool.query('SELECT * FROM scheduling_demand_snapshots WHERE id=$1', [snapshot_id]);
  if (snap.rows.length === 0) throw new Error(`Snapshot ${snapshot_id} not found`);
  const snapshot = snap.rows[0];
  const intervalMinutes = snapshot.interval_minutes || 30;
  const nIntervals = Math.ceil(1440 / intervalMinutes);

  const rowsRes = await pool.query(
    'SELECT channel, weekday, interval_start, required_fte FROM scheduling_demand_snapshot_rows WHERE snapshot_id=$1',
    [snapshot_id]
  );
  const demandByChannel = new Map();
  for (const r of rowsRes.rows) {
    const ch = r.channel || 'blended';
    if (!demandByChannel.has(ch)) {
      demandByChannel.set(ch, Array.from({ length: 7 }, () => Array(nIntervals).fill(0)));
    }
    const ivMin = hhmmToMin(typeof r.interval_start === 'string' ? r.interval_start : r.interval_start.toString().slice(0, 5));
    const ivIdx = Math.floor(ivMin / intervalMinutes);
    if (ivIdx >= 0 && ivIdx < nIntervals) {
      demandByChannel.get(ch)[r.weekday][ivIdx] = Number(r.required_fte) || 0;
    }
  }
  if (demandByChannel.size === 0) {
    throw new Error('Snapshot has no demand rows');
  }

  const lobRes = await pool.query('SELECT hours_of_operation, pooling_mode FROM lob_settings WHERE lob_id=$1', [lob_id]);
  const hoursOfOperation = lobRes.rows[0]?.hours_of_operation || null;
  const poolingMode = lobRes.rows[0]?.pooling_mode || 'dedicated';

  const agRes = await pool.query(
    `SELECT id, full_name, skill_voice, skill_chat, skill_email, accommodation_flags, availability, shift_length_hours, lob_assignments
     FROM scheduling_agents WHERE organization_id=1 AND status='active' AND $1 = ANY(lob_assignments)`,
    [lob_id]
  );
  const allAgents = agRes.rows.map((a) => ({
    ...a,
    availability: a.availability || {},
    shift_length_hours: Number(a.shift_length_hours || 9),
  }));
  if (allAgents.length === 0) {
    throw new Error(
      'No active agents assigned to this LOB. Open Agent Roster, edit each agent, check this LOB under "LOB Assignments", and ensure status is Active.'
    );
  }

  const runIns = await pool.query(
    `INSERT INTO schedule_generation_runs (lob_id, snapshot_id, horizon_start, horizon_end, fairness_enabled, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [lob_id, snapshot_id, horizon_start, horizon_end, !!fairness_enabled, created_by || null]
  );
  const run_id = runIns.rows[0].id;

  await pool.query(
    `DELETE FROM schedule_assignments
     WHERE lob_id=$1 AND work_date BETWEEN $2 AND $3 AND status='draft'`,
    [lob_id, horizon_start, horizon_end]
  );

  let draftCount = 0;
  const coverageReport = {};

  const channelsInScope = Array.from(demandByChannel.keys());

  const channelAgents = new Map();
  if (poolingMode === 'blended' || (channelsInScope.length === 1 && channelsInScope[0] === 'blended')) {
    channelAgents.set(channelsInScope[0], allAgents);
  } else {
    const demandShare = {};
    let totalDemand = 0;
    for (const ch of channelsInScope) {
      const sum = demandByChannel.get(ch).reduce((acc, arr) => acc + arr.reduce((a, b) => a + b, 0), 0);
      demandShare[ch] = sum;
      totalDemand += sum;
    }
    const skillKey = { voice: 'skill_voice', chat: 'skill_chat', email: 'skill_email', cases: 'skill_email' };
    const remaining = [...allAgents];
    for (const ch of channelsInScope) {
      const key = skillKey[ch] || 'skill_voice';
      const skilled = remaining.filter((a) => a[key]);
      const share = totalDemand > 0 ? demandShare[ch] / totalDemand : 1 / channelsInScope.length;
      const take = Math.round(skilled.length * share);
      const pool = skilled.slice(0, take);
      channelAgents.set(ch, pool);
      const taken = new Set(pool.map((a) => a.id));
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (taken.has(remaining[i].id)) remaining.splice(i, 1);
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const channel of channelsInScope) {
      const agents = channelAgents.get(channel) || [];
      if (agents.length === 0) continue;
      const demandCurves = demandByChannel.get(channel);
      const demandByWeekday = demandCurves.map((arr) => arr.reduce((a, b) => a + b, 0));

      const restMap = assignRestDays(agents, demandByWeekday, fairness_enabled, hoursOfOperation, channel, rules);

      const shiftLenByAgent = new Map();
      for (const a of agents) {
        const agentHours = Number(a.shift_length_hours);
        shiftLenByAgent.set(a.id, agentHours !== 9 ? agentHours : Number(rules.default_shift_hours || 9));
      }

      // ── Multi-pass: run 8 orderings, keep the one with lowest total squared shortage ──
      const NUM_PASSES = 8;
      let bestStartMap = null;
      let bestScore = Infinity;

      for (let pass = 0; pass < NUM_PASSES; pass++) {
        // Pass 0: ID-sorted (deterministic baseline)
        // Pass 1+: random shuffle
        const agentOrder = pass === 0
          ? [...agents].sort((a, b) => a.id - b.id)
          : shuffleArray(agents);

        let candidateMap = assignStartTimes(
          agentOrder, restMap, demandCurves, hoursOfOperation, channel, intervalMinutes, shiftLenByAgent, rules
        );
        candidateMap = applyStagger(candidateMap, demandCurves, intervalMinutes);

        const scheduled = buildScheduledMatrix(agents, restMap, candidateMap, intervalMinutes);
        const score = totalShortageScore(scheduled, demandCurves);

        if (score < bestScore) {
          bestScore = score;
          bestStartMap = candidateMap;
        }
      }

      // ── Local search: iteratively re-seat each agent to reduce shortage ──
      let startMap = localSearchImprove(
        agents, restMap, bestStartMap, demandCurves, hoursOfOperation, channel, intervalMinutes, shiftLenByAgent, rules
      );

      // ── Final stagger (re-apply after local search changed start times) ──
      startMap = applyStagger(startMap, demandCurves, intervalMinutes);

      coverageReport[channel] = computeCoverage(agents, restMap, startMap, demandCurves, intervalMinutes);

      // Write assignments per date in horizon
      const totalDays = dateDiffDays(horizon_start, horizon_end) + 1;
      for (let offset = 0; offset < totalDays; offset++) {
        const workDate = addDays(horizon_start, offset);
        const jsDow = new Date(workDate + 'T00:00:00Z').getUTCDay();
        const weekday = jsDowToMon0(jsDow);
        const dayWin = operatingWindowForWeekday(hoursOfOperation, channel, weekday);
        if (!dayWin) continue;
        for (const agent of agents) {
          const info = startMap.get(agent.id);
          if (!info) continue;
          const rest = restMap.get(agent.id) || [];
          if (rest.includes(weekday)) continue;
          const startTime = minToHHMM(info.startMin);
          const endMin = info.startMin + info.shiftMin;
          const isOvernight = endMin >= 1440;
          const endTime = minToHHMM(endMin);
          const asn = await client.query(
            `INSERT INTO schedule_assignments
               (organization_id, lob_id, agent_id, shift_template_id, work_date, start_time, end_time,
                is_overnight, channel, notes, status, generation_run_id)
             VALUES (1,$1,$2,NULL,$3,$4,$5,$6,$7,$8,'draft',$9) RETURNING id`,
            [lob_id, agent.id, workDate, startTime, endTime, isOvernight, channel, `Auto-generated run #${run_id}`, run_id]
          );
          const assignmentId = asn.rows[0].id;
          draftCount++;
          for (const act of info.plan) {
            const aStart = minToHHMM(info.startMin + act.offsetFromStart);
            const aEnd = minToHHMM(info.startMin + act.offsetFromStart + act.duration);
            await client.query(
              `INSERT INTO shift_activities (assignment_id, activity_type, start_time, end_time, is_paid, notes)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [assignmentId, act.type, aStart, aEnd, !!act.paid, null]
            );
          }
        }
      }
    }

    await client.query(
      `UPDATE schedule_generation_runs SET coverage_report=$1 WHERE id=$2`,
      [JSON.stringify(coverageReport), run_id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { run_id, draft_count: draftCount, coverage_report: coverageReport };
}

module.exports = { generate };
