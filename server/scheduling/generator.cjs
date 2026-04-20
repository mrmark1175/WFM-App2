// Auto-Scheduler Generator — Phase 1 (greedy, pure Node, deterministic)
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
// Entry point: await generate({ pool, lob_id, snapshot_id, horizon_start,
//                              horizon_end, fairness_enabled, created_by })
// Returns: { run_id, draft_count, coverage_report }

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

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

// ── Break/lunch placement for a given shift length ───────────────────────────
// Returns activity offsets in minutes from shift start.
function activityPlan(shiftHours) {
  if (shiftHours >= 8.5) {
    return [
      { type: 'break',  offset: 120, duration: 15, paid: true },   // +2h
      { type: 'lunch',  offset: 240, duration: 60, paid: false },  // +4h (60 min)
      { type: 'break',  offset: 420, duration: 15, paid: true },   // +7h (2h after lunch end at +5h)
    ];
  }
  if (shiftHours >= 6) {
    return [
      { type: 'break',  offset: 120, duration: 15, paid: true },
      { type: 'lunch',  offset: Math.round(shiftHours * 30), duration: 30, paid: false }, // short lunch at mid
    ];
  }
  return [
    { type: 'break', offset: Math.round(shiftHours * 30), duration: 15, paid: true },
  ];
}

// Given a shift (startMin, endMin) and its activities (with staggers), return the
// set of interval-indexes where the agent is ON-QUEUE covering demand.
function onQueueIntervals(startMin, endMin, activities, intervalMinutes) {
  const covered = new Set();
  const nIntervals = Math.ceil(1440 / intervalMinutes);
  // Mark all intervals overlapped by the shift
  // Support overnight shifts (endMin < startMin means next day; we restrict to one day for Phase 1)
  for (let iv = 0; iv < nIntervals; iv++) {
    const ivStart = iv * intervalMinutes;
    const ivEnd = ivStart + intervalMinutes;
    if (ivEnd > startMin && ivStart < endMin) covered.add(iv);
  }
  // Remove intervals fully consumed by any activity
  for (const act of activities) {
    const aStart = startMin + act.offsetFromStart;
    const aEnd = aStart + act.duration;
    for (let iv = 0; iv < nIntervals; iv++) {
      const ivStart = iv * intervalMinutes;
      const ivEnd = ivStart + intervalMinutes;
      // If the activity covers the ENTIRE interval, remove it.
      // (Using "entirely consumed" vs "overlaps" matters; pick entirely-consumed
      // so partial-overlap intervals still count as on-queue.)
      if (aStart <= ivStart && aEnd >= ivEnd) covered.delete(iv);
    }
  }
  return covered;
}

// ── Operating-hours union across channels (for blended) or per-channel ───────
function operatingWindowForWeekday(hoursOfOperation, channel, weekday) {
  // weekday: 0=Mon..6=Sun (our convention)
  const key = WEEKDAY_KEYS[weekday];
  if (!hoursOfOperation) return { open: 0, close: 1440 };
  if (channel === 'blended') {
    let open = Infinity, close = -Infinity;
    for (const ch of ['voice', 'chat', 'email', 'cases']) {
      const sched = hoursOfOperation?.[ch]?.[key];
      if (!sched || !sched.enabled) continue;
      open = Math.min(open, hhmmToMin(sched.open));
      const c = hhmmToMin(sched.close);
      close = Math.max(close, c === 0 && sched.close === '00:00' ? 1440 : c);
    }
    if (open === Infinity) return null;
    return { open, close };
  } else {
    const sched = hoursOfOperation?.[channel]?.[key];
    if (!sched || !sched.enabled) return null;
    const close = hhmmToMin(sched.close);
    return { open: hhmmToMin(sched.open), close: close === 0 && sched.close === '00:00' ? 1440 : close };
  }
}

// ── Candidate rest-day pairs (2 consecutive, wrap allowed) ───────────────────
// Each pair is the two weekday indexes (0=Mon..6=Sun). Sun+Mon wrap included.
const REST_PAIRS = (() => {
  const out = [];
  for (let i = 0; i < 7; i++) out.push([i, (i + 1) % 7]);
  return out;
})();

// ── Rest-day assignment ──────────────────────────────────────────────────────
// Assigns 2 consecutive rest days per agent minimizing remaining shortage.
function assignRestDays(agents, demandByWeekday, fairnessEnabled) {
  // demandByWeekday[d] = total required agent-hours on weekday d
  const result = new Map();

  // Fixed-rest-day accommodations first
  const rotationIdx = { i: 0 };
  const flexibleAgents = [];
  for (const agent of agents) {
    const fixed = agent.availability?.fixed_rest_days;
    if (Array.isArray(fixed) && fixed.length === 2) {
      const idxs = fixed.map((d) => WEEKDAY_KEYS.indexOf(String(d).toLowerCase())).filter((i) => i >= 0);
      if (idxs.length === 2) {
        result.set(agent.id, idxs.sort((a, b) => a - b));
        continue;
      }
    }
    flexibleAgents.push(agent);
  }

  // Remaining shortage model: running demand per weekday. Start from the demand curve.
  // We approximate rest-day cost as the demand-hours lost by resting on those days.
  const workingAgentCount = Array(7).fill(0);

  if (fairnessEnabled) {
    for (const agent of flexibleAgents) {
      const pair = REST_PAIRS[rotationIdx.i % REST_PAIRS.length];
      rotationIdx.i++;
      result.set(agent.id, [...pair].sort((a, b) => a - b));
      for (let d = 0; d < 7; d++) if (!pair.includes(d)) workingAgentCount[d]++;
    }
  } else {
    // Best-fit: pair score = sum demand on the 2 rest days (lower = better choice of rest).
    // Pick rest pair that rests on the LOWEST-demand days relative to current capacity gap.
    for (const agent of flexibleAgents) {
      let bestPair = REST_PAIRS[0];
      let bestScore = Infinity;
      for (const pair of REST_PAIRS) {
        // Score: demand on rest days (we prefer resting on LOW-demand days)
        const restDemand = demandByWeekday[pair[0]] + demandByWeekday[pair[1]];
        // Tie-break: balance out the current working-count distribution
        const workingBalanceCost =
          Math.max(...pair.map((d) => -workingAgentCount[d])) * -1;
        const score = restDemand * 1000 + workingBalanceCost;
        if (score < bestScore) { bestScore = score; bestPair = pair; }
      }
      result.set(agent.id, [...bestPair].sort((a, b) => a - b));
      for (let d = 0; d < 7; d++) if (!bestPair.includes(d)) workingAgentCount[d]++;
    }
  }

  return result;
}

// ── Start-time assignment ────────────────────────────────────────────────────
// For each agent, pick the best 30-min start that maximally reduces shortage
// across their 5 working days. Greedy, online.
function assignStartTimes(agents, restMap, demandCurves, hoursOfOperation, channel, intervalMinutes, shiftLenByAgent) {
  const nIntervals = Math.ceil(1440 / intervalMinutes);

  // residualShortage[d][i] = remaining unmet FTE-demand on weekday d, interval i
  const residual = demandCurves.map((curve) => [...curve]);

  const startMap = new Map();

  // Process agents in deterministic order (by id)
  const sortedAgents = [...agents].sort((a, b) => a.id - b.id);

  for (const agent of sortedAgents) {
    const shiftH = Number(shiftLenByAgent.get(agent.id) || 9);
    const shiftMin = Math.round(shiftH * 60);
    const rest = restMap.get(agent.id) || [];
    const workingDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !rest.includes(d));

    // For each candidate start (on 30-min boundary), compute total shortage reduction.
    // Candidate starts must fit within the operating window for EVERY working day.
    let bestStart = null;
    let bestGain = -Infinity;

    const candidateStarts = new Set();
    for (const d of workingDays) {
      const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
      if (!win) continue;
      for (let s = win.open; s + shiftMin <= win.close; s += 30) {
        candidateStarts.add(s);
      }
    }
    // If no candidate starts (24-hour op or all channels off), fall back to [0..1440-shiftMin]
    if (candidateStarts.size === 0) {
      for (let s = 0; s + shiftMin <= 1440; s += 30) candidateStarts.add(s);
    }

    // Plan activities (offsets from start) for this shift length
    const plan = activityPlan(shiftH).map((a) => ({
      type: a.type, offsetFromStart: a.offset, duration: a.duration, paid: a.paid,
    }));

    for (const s of candidateStarts) {
      const endMin = s + shiftMin;
      if (endMin > 1440) continue;
      // Check: for every working day, candidate must fit within that day's op window
      let fits = true;
      for (const d of workingDays) {
        const win = operatingWindowForWeekday(hoursOfOperation, channel, d);
        if (!win) { fits = false; break; }
        if (s < win.open || endMin > win.close) { fits = false; break; }
      }
      if (!fits) continue;

      const covered = onQueueIntervals(s, endMin, plan, intervalMinutes);
      let gain = 0;
      for (const d of workingDays) {
        for (const iv of covered) {
          if (residual[d][iv] > 0) gain += Math.min(1, residual[d][iv]);
        }
      }
      if (gain > bestGain) { bestGain = gain; bestStart = s; }
    }

    if (bestStart === null) continue; // no valid start — skip agent

    startMap.set(agent.id, { startMin: bestStart, shiftMin, plan });

    // Decrement residual shortage by 1 (this agent covers these intervals) on working days
    const covered = onQueueIntervals(bestStart, bestStart + shiftMin, plan, intervalMinutes);
    for (const d of workingDays) {
      for (const iv of covered) residual[d][iv] = Math.max(0, residual[d][iv] - 1);
    }
  }

  return startMap;
}

// ── Stagger breaks/lunches WITHIN each (startMin) cohort ──────────────────────
function applyStagger(startMap) {
  const cohorts = new Map(); // startMin → agentIds[]
  for (const [agentId, info] of startMap.entries()) {
    const key = info.startMin;
    if (!cohorts.has(key)) cohorts.set(key, []);
    cohorts.get(key).push(agentId);
  }
  for (const [, ids] of cohorts.entries()) {
    ids.sort((a, b) => a - b);
    ids.forEach((agentId, idx) => {
      const info = startMap.get(agentId);
      // Stagger within cohort. Break offset: +15 * (idx%4). Lunch offset: +30 * (idx%2).
      info.plan = info.plan.map((act) => {
        let extra = 0;
        if (act.type === 'break') extra = 15 * (idx % 4);
        if (act.type === 'lunch') extra = 30 * (idx % 2);
        return { ...act, offsetFromStart: act.offsetFromStart + extra };
      });
      // Clamp so activities never exceed shift
      info.plan = info.plan.filter((a) => a.offsetFromStart + a.duration <= info.shiftMin);
    });
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
async function generate({ pool, lob_id, snapshot_id, horizon_start, horizon_end, fairness_enabled, created_by }) {
  // Load snapshot
  const snap = await pool.query('SELECT * FROM scheduling_demand_snapshots WHERE id=$1', [snapshot_id]);
  if (snap.rows.length === 0) throw new Error(`Snapshot ${snapshot_id} not found`);
  const snapshot = snap.rows[0];
  const intervalMinutes = snapshot.interval_minutes || 30;
  const nIntervals = Math.ceil(1440 / intervalMinutes);

  const rowsRes = await pool.query(
    'SELECT channel, weekday, interval_start, required_fte FROM scheduling_demand_snapshot_rows WHERE snapshot_id=$1',
    [snapshot_id]
  );
  // Group demand: channel → [7 arrays of interval counts]
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

  // Load LOB settings
  const lobRes = await pool.query('SELECT hours_of_operation, pooling_mode FROM lob_settings WHERE lob_id=$1', [lob_id]);
  const hoursOfOperation = lobRes.rows[0]?.hours_of_operation || null;
  const poolingMode = lobRes.rows[0]?.pooling_mode || 'dedicated';

  // Load eligible agents for this LOB
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

  // Create generation run row
  const runIns = await pool.query(
    `INSERT INTO schedule_generation_runs (lob_id, snapshot_id, horizon_start, horizon_end, fairness_enabled, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [lob_id, snapshot_id, horizon_start, horizon_end, !!fairness_enabled, created_by || null]
  );
  const run_id = runIns.rows[0].id;

  // Remove any existing drafts for this LOB in this horizon (overwrite semantics)
  await pool.query(
    `DELETE FROM schedule_assignments
     WHERE lob_id=$1 AND work_date BETWEEN $2 AND $3 AND status='draft'`,
    [lob_id, horizon_start, horizon_end]
  );

  let draftCount = 0;
  const coverageReport = {};

  // Per-channel pools
  const channelsInScope = Array.from(demandByChannel.keys());

  // If blended, usually one channel 'blended' in snapshot → use all agents
  // If dedicated, split agents across channels by skill+demand share
  const channelAgents = new Map();
  if (poolingMode === 'blended' || (channelsInScope.length === 1 && channelsInScope[0] === 'blended')) {
    channelAgents.set(channelsInScope[0], allAgents);
  } else {
    // Compute demand-share per channel
    const demandShare = {};
    let totalDemand = 0;
    for (const ch of channelsInScope) {
      const sum = demandByChannel.get(ch).reduce((acc, arr) => acc + arr.reduce((a, b) => a + b, 0), 0);
      demandShare[ch] = sum;
      totalDemand += sum;
    }
    // Filter agents by skill, then allocate proportionally
    const skillKey = { voice: 'skill_voice', chat: 'skill_chat', email: 'skill_email', cases: 'skill_email' };
    const remaining = [...allAgents];
    for (const ch of channelsInScope) {
      const key = skillKey[ch] || 'skill_voice';
      const skilled = remaining.filter((a) => a[key]);
      const share = totalDemand > 0 ? demandShare[ch] / totalDemand : 1 / channelsInScope.length;
      const take = Math.round(skilled.length * share);
      const pool = skilled.slice(0, take);
      channelAgents.set(ch, pool);
      // Remove taken agents from remaining so they're not double-assigned
      const taken = new Set(pool.map((a) => a.id));
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (taken.has(remaining[i].id)) remaining.splice(i, 1);
      }
    }
  }

  // For each channel pool, run the scheduling pipeline
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const channel of channelsInScope) {
      const agents = channelAgents.get(channel) || [];
      if (agents.length === 0) continue;
      const demandCurves = demandByChannel.get(channel);
      const demandByWeekday = demandCurves.map((arr) => arr.reduce((a, b) => a + b, 0));

      const restMap = assignRestDays(agents, demandByWeekday, fairness_enabled);

      const shiftLenByAgent = new Map();
      for (const a of agents) shiftLenByAgent.set(a.id, a.shift_length_hours);

      let startMap = assignStartTimes(agents, restMap, demandCurves, hoursOfOperation, channel, intervalMinutes, shiftLenByAgent);
      startMap = applyStagger(startMap);

      coverageReport[channel] = computeCoverage(agents, restMap, startMap, demandCurves, intervalMinutes);

      // Write assignments per date in horizon
      const totalDays = dateDiffDays(horizon_start, horizon_end) + 1;
      for (let offset = 0; offset < totalDays; offset++) {
        const workDate = addDays(horizon_start, offset);
        const jsDow = new Date(workDate + 'T00:00:00Z').getUTCDay();
        const weekday = jsDowToMon0(jsDow);
        for (const agent of agents) {
          const info = startMap.get(agent.id);
          if (!info) continue;
          const rest = restMap.get(agent.id) || [];
          if (rest.includes(weekday)) continue;
          // Insert assignment
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
          // Insert activities
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
