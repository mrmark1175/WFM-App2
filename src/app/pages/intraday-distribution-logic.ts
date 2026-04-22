// ── Intraday Distribution Engine — pure math utilities ────────────────────────
// No React dependencies. All functions are deterministic and unit-testable.

// ── Erlang C staffing — per-interval FTE calculation ─────────────────────────

/** Erlang C: probability that an arriving call must wait (exact formula). */
export function erlangC(A: number, N: number): number {
  const nInt = Math.floor(N);
  if (nInt <= A) return 1; // under-staffed: everyone waits
  let sumFact = 1, term = 1;
  for (let i = 1; i < nInt; i++) { term *= A / i; sumFact += term; }
  const lastTerm = term * A / nInt;
  const X = lastTerm * nInt / (nInt - A);
  return Math.min(1, Math.max(0, X / (sumFact + X)));
}

/** Service level: fraction of calls answered within `asaSec` seconds. */
export function erlangServiceLevel(A: number, N: number, ahtSec: number, asaSec: number): number {
  if (N <= A) return 0;
  return 1 - erlangC(A, N) * Math.exp(-((N - A) * asaSec) / ahtSec);
}

/** Minimum integer agents such that SL ≥ targetSL (0–1 fraction). */
function minAgentsForSL(A: number, ahtSec: number, asaSec: number, targetSL: number): number {
  let N = Math.max(1, Math.ceil(A) + 1);
  for (let i = 0; i < 300; i++) {
    if (erlangServiceLevel(A, N, ahtSec, asaSec) >= targetSL) return N;
    N++;
  }
  return N;
}

// ── Erlang A (M/M/N+M) — Palm's model with customer abandonment ───────────────
//
// Extends Erlang C by adding exponential customer patience (θ = 1/patienceSec).
// Customers who have waited longer than their patience abandon the queue.
// This produces a lower (more realistic) staffing requirement at high occupancy
// because abandonments self-regulate congestion.
//
// Key output: abandonRate — fraction of all arrivals that leave before being served.
// A 5% abandon rate threshold is the typical industry warning level.
//
// Implementation: truncated stationary distribution via forward recursion.
// For k < N servers: π[k+1] = A · π[k] / (k+1)          (pure Poisson birth)
// For k ≥ N servers: π[k+1] = A · π[k] / (N + (k−N+1)·β)  (service + abandon drain)
// where β = AHT / patience (dimensionless ratio of service time to patience time).
//
// Falls back to Erlang C when patienceSec ≤ 0 (infinite patience).
function erlangAMetrics(
  A: number,           // offered traffic in Erlangs (= λ × AHT)
  N: number,           // number of concurrent agents
  patienceSec: number, // mean customer patience in seconds (exponential distribution)
  ahtSec: number,      // mean handle time in seconds
): {
  pWait: number;        // probability an arriving customer must wait (all N servers busy)
  abandonRate: number;  // fraction of arrivals that abandon before being served (0–1)
  slFn: (T: number) => number; // service-level function: P(answered within T seconds)
} {
  const nInt = Math.floor(N);

  if (patienceSec <= 0) {
    // Infinite patience → pure Erlang C
    const pWait = erlangC(A, nInt);
    return {
      pWait,
      abandonRate: 0,
      slFn: (T) => erlangServiceLevel(A, nInt, ahtSec, T),
    };
  }

  // β = AHT / patience: how many "patience units" fit in one service time.
  // High β (AHT >> patience) → large abandonment drain → lower congestion.
  const beta = ahtSec / patienceSec;

  // Truncate the state space where terms become negligible.
  const K_max = Math.max(nInt + 300, Math.ceil(A * 3) + 200);
  const pi: number[] = new Array(K_max + 1).fill(0);
  pi[0] = 1;

  for (let k = 0; k < K_max; k++) {
    if (k < nInt) {
      pi[k + 1] = (A * pi[k]) / (k + 1);
    } else {
      pi[k + 1] = (A * pi[k]) / (nInt + (k - nInt + 1) * beta);
    }
    if (!isFinite(pi[k + 1]) || pi[k + 1] < 1e-12) break;
  }

  const total = pi.reduce((s, v) => s + v, 0);
  if (total === 0) return { pWait: 0, abandonRate: 0, slFn: () => 1 };
  const piNorm = pi.map(v => v / total);

  // P(wait) = Σ π[k] for k ≥ N
  let pWait = 0;
  for (let k = nInt; k < piNorm.length; k++) pWait += piNorm[k];
  pWait = Math.min(1, Math.max(0, pWait));

  // E[queue length] = Σ (k − N) · π[k] for k > N
  let eQueue = 0;
  for (let k = nInt + 1; k < piNorm.length; k++) eQueue += (k - nInt) * piNorm[k];

  // P(abandon) = ν · E[queue] / λ = (ahtSec/patienceSec) · E[queue] / A = β · E[queue] / A
  const abandonRate = A > 0 ? Math.min(1, (beta * eQueue) / A) : 0;

  // SL(T): 1 − P(wait) · exp(−drainRate · T)
  // The effective queue drain rate combines excess service capacity and abandonment:
  //   excessCapacity = max(0, N − A_eff) / ahtSec  [agents/s draining the queue]
  //   nuRate         = 1 / patienceSec              [abandonment drain]
  const A_eff = A * (1 - abandonRate);
  const excessCapacity = Math.max(0, nInt - A_eff) / ahtSec;
  const nuRate = 1 / patienceSec;
  const drainRate = excessCapacity + nuRate;

  const slFn = (T: number): number => {
    if (nInt <= A_eff) return 0; // under-staffed even after abandonments
    return Math.min(1, Math.max(0, 1 - pWait * Math.exp(-drainRate * T)));
  };

  return { pWait, abandonRate, slFn };
}

/** Minimum integer agents such that Erlang A SL(slaSec) ≥ targetSL. */
function minAgentsForSL_A(
  A: number, ahtSec: number, slaSec: number, targetSL: number, patienceSec: number,
): number {
  // Start below Erlang C floor — Erlang A can achieve target at fewer agents
  let N = Math.max(1, Math.floor(A));
  for (let i = 0; i < 500; i++) {
    const { slFn } = erlangAMetrics(A, N, patienceSec, ahtSec);
    if (slFn(slaSec) >= targetSL) return N;
    N++;
  }
  return N;
}

export interface IntervalFTEResult {
  rawAgents: number;   // concurrent agents on the phones needed this interval
  fte: number;         // rawAgents grossed up for shrinkage (schedule this many)
  achievedSL: number;  // % SL at rawAgents (0 for email — no queue model)
  erlangs: number;     // traffic intensity A = effectiveCalls × AHT / intervalSeconds
  occupancy: number;   // output: A / rawAgents × 100 (NOT an input constraint)
  abandonRate: number; // Erlang A: fraction of arrivals that abandon (0 when patience=0)
}

/**
 * Compute the minimum FTE required for a single interval slot.
 *
 * Voice/Chat: Pure Erlang C — staffing is driven solely by the SLA target.
 *   Occupancy is an OUTPUT (A/N), never a staffing constraint here.
 *   Chat divides effective demand by concurrency (one agent handles N sessions).
 *
 * Email: Async workload model (workload ÷ available agent-seconds per interval).
 *   For email, occupancy IS used as the utilisation target since there is no
 *   queue — it simply caps how much work each agent-second is filled.
 *
 * @param callsPerInterval     Forecast volume for this interval (grain-aggregated)
 * @param grainMinutes         Interval width: 15, 30, or 60
 * @param ahtSec               Average Handle Time in seconds
 * @param slaTarget            Service level target, 0–100 (e.g. 80)
 * @param slaSec               Speed-of-answer threshold in seconds (e.g. 20)
 * @param emailOccupancy       Used ONLY for email workload model (0–100); ignored for voice/chat
 * @param shrinkage            Shrinkage %, 0–100; grosses rawAgents up to schedulable FTE
 * @param channel              "voice" | "chat" | "email" | "cases"
 * @param concurrency          Chat only: simultaneous sessions per agent (default 1)
 * @param avgPatienceSeconds   Erlang A: mean customer patience in seconds (0 = Erlang C fallback)
 */
export function computeIntervalFTE(
  callsPerInterval: number,
  grainMinutes: 15 | 30 | 60,
  ahtSec: number,
  slaTarget: number,
  slaSec: number,
  emailOccupancy: number,
  shrinkage: number,
  channel: "voice" | "chat" | "email" | "cases",
  concurrency = 1,
  avgPatienceSeconds = 0,
): IntervalFTEResult {
  const zero: IntervalFTEResult = { rawAgents: 0, fte: 0, achievedSL: 0, erlangs: 0, occupancy: 0, abandonRate: 0 };
  if (callsPerInterval <= 0 || ahtSec <= 0) return zero;

  const intervalSeconds = grainMinutes * 60;
  const shrinkFactor = Math.max(0.01, 1 - shrinkage / 100);

  if (channel === "email" || channel === "cases") {
    // Async workload — no SLA queue; utilisation target fills agent time
    const occupancyFactor = Math.max(0.01, emailOccupancy / 100);
    const workloadSec = callsPerInterval * ahtSec;
    const agentCapacitySec = intervalSeconds * occupancyFactor;
    const rawAgents = Math.max(0, Math.ceil(workloadSec / agentCapacitySec));
    const occ = rawAgents > 0 ? (workloadSec / (rawAgents * intervalSeconds)) * 100 : 0;
    return {
      rawAgents,
      fte: +(rawAgents / shrinkFactor).toFixed(1),
      achievedSL: 0,
      erlangs: +(workloadSec / intervalSeconds).toFixed(3),
      occupancy: +occ.toFixed(1),
      abandonRate: 0,
    };
  }

  // Voice / Chat — Erlang A when patience configured, Erlang C otherwise.
  // Occupancy is strictly an OUTPUT here; SLA alone drives the agent count.
  //
  // Chat multi-session model (M/M/N×c queue):
  //   Each physical agent handles `concurrency` simultaneous sessions, so the
  //   system has N×c virtual server slots. Erlang C runs on the full traffic
  //   intensity A to find the minimum virtual slots, then physical agents =
  //   ceil(virtual / concurrency). This is more accurate than dividing the
  //   arrival rate by c (the "reduced single-stream" approximation), which
  //   under-counts the queue's drain rate and systematically over-staffs.
  const A = (callsPerInterval * ahtSec) / intervalSeconds;
  const c = channel === "chat" ? Math.max(1, concurrency) : 1;

  let rawAgents: number;
  let achievedSL: number;
  let abandonRate: number;

  if (avgPatienceSeconds > 0) {
    // Erlang A path — find minimum virtual slots, convert to physical
    const minVirtual = minAgentsForSL_A(A, ahtSec, slaSec, slaTarget / 100, avgPatienceSeconds);
    rawAgents = Math.ceil(minVirtual / c);
    const metrics = erlangAMetrics(A, rawAgents * c, avgPatienceSeconds, ahtSec);
    achievedSL = metrics.slFn(slaSec) * 100;
    abandonRate = metrics.abandonRate;
  } else {
    // Erlang C path — find minimum virtual slots, convert to physical
    const minVirtual = minAgentsForSL(A, ahtSec, slaSec, slaTarget / 100);
    rawAgents = Math.ceil(minVirtual / c);
    achievedSL = rawAgents > 0 ? erlangServiceLevel(A, rawAgents * c, ahtSec, slaSec) * 100 : 0;
    abandonRate = 0;
  }

  // Occupancy = traffic intensity / total virtual server capacity
  const occupancy = rawAgents > 0 ? (A / (rawAgents * c)) * 100 : 0;

  return {
    rawAgents,
    fte: +(rawAgents / shrinkFactor).toFixed(1),
    achievedSL: +achievedSL.toFixed(1),
    erlangs: +A.toFixed(3),
    occupancy: +occupancy.toFixed(1),
    abandonRate: +abandonRate.toFixed(4),
  };
}

/**
 * Forward Erlang C: given an actual FTE headcount, compute the achievable SLA%.
 *
 * This is the inverse of `computeIntervalFTE` — instead of asking "how many agents
 * do I need?", it asks "given N actual agents, what SLA will I achieve?".
 *
 * Returns null for email (async workload model — no queue, so SLA% is undefined).
 * Returns 0 if the team is under-staffed (A ≥ rawAgents).
 */
export function computeAchievedSLFromFTE(
  weeklyVolume: number,
  ahtSec: number,
  actualFTE: number,
  daysPerWeek: number,
  operatingHoursPerDay: number,
  fteHoursPerDay: number,
  slaSec: number,
  shrinkagePct: number,
  channel: "voice" | "chat" | "email",
  concurrency = 1,
  avgPatienceSeconds = 0,
): number | null {
  if (channel === "email") return null;
  if (weeklyVolume <= 0 || ahtSec <= 0 || actualFTE <= 0 || daysPerWeek <= 0 || operatingHoursPerDay <= 0) return null;

  const shrinkFactor = Math.max(0.01, 1 - shrinkagePct / 100);
  const coverageRatio = fteHoursPerDay > 0 ? operatingHoursPerDay / fteHoursPerDay : 1;

  // Invert FTE → physical agents on floor per average 30-min interval
  const physicalAgents = (actualFTE / coverageRatio) * shrinkFactor;

  // Average traffic intensity per 30-min interval (full, not divided by concurrency)
  const callsPerInterval = weeklyVolume / daysPerWeek / (operatingHoursPerDay * 2);
  const A = (callsPerInterval * ahtSec) / 1800; // 1800s = 30-min interval

  // Total virtual server slots: each chat agent covers c simultaneous sessions
  const c = channel === "chat" ? Math.max(1, concurrency) : 1;
  const virtualAgents = physicalAgents * c;

  if (avgPatienceSeconds > 0) {
    const { slFn } = erlangAMetrics(A, virtualAgents, avgPatienceSeconds, ahtSec);
    return +(slFn(slaSec) * 100).toFixed(1);
  }

  if (virtualAgents <= A) return 0; // under-staffed: everyone waits
  return +(erlangServiceLevel(A, virtualAgents, ahtSec, slaSec) * 100).toFixed(1);
}

/**
 * Smooth FTE values across intervals for one day using a centered rolling average,
 * then renormalize so the daily total (Σ FTE) is preserved exactly.
 *
 * This eliminates zero-gaps caused by sparse call volumes while keeping the
 * headcount plan valid — the same total FTE-hours are distributed more evenly.
 *
 * @param fteValues  FTE per interval for one day (length = number of intervals)
 * @param halfWindow Intervals to look left AND right of each slot (total window = 2×halfWindow+1)
 */
export function smoothFTEValues(fteValues: number[], halfWindow: number): number[] {
  if (halfWindow <= 0) return [...fteValues];
  const n = fteValues.length;

  // Find the active range so smoothing never bleeds outside operating hours.
  let firstActive = -1, lastActive = -1;
  for (let i = 0; i < n; i++) {
    if (fteValues[i] > 0) {
      if (firstActive === -1) firstActive = i;
      lastActive = i;
    }
  }
  if (firstActive === -1) return [...fteValues];

  const smoothed = fteValues.map((_, i) => {
    if (i < firstActive || i > lastActive) return 0;
    const start = Math.max(firstActive, i - halfWindow);
    const end   = Math.min(lastActive, i + halfWindow);
    let sum = 0, count = 0;
    for (let j = start; j <= end; j++) { sum += fteValues[j]; count++; }
    return count > 0 ? sum / count : 0;
  });
  // Renormalize: scale so Σ smoothed === Σ original (preserves daily total exactly)
  const rawSum      = fteValues.reduce((s, v) => s + v, 0);
  const smoothedSum = smoothed.reduce((s, v) => s + v, 0);
  if (smoothedSum <= 0 || rawSum <= 0) return smoothed;
  const scale = rawSum / smoothedSum;
  return smoothed.map((v) => +(v * scale).toFixed(2));
}

export const SLOT_COUNT = 96; // 15-min slots per day (00:00 → 23:45)
export const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
// Map DOW_LABELS index to JS getDay() value: Mon=1, Tue=2, …, Sun=0
export const DOW_JS_MAP = [1, 2, 3, 4, 5, 6, 0] as const;

export type GridData = Record<string, Record<number, { volume: number; aht: number }>>;

// Format a slot index (0-95) to a readable time label, e.g. "9:00 AM"
export function fmtSlot(slotIdx: number): string {
  const mins = slotIdx * 15;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const period = h < 12 ? "AM" : "PM";
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayH}:${m.toString().padStart(2, "0")} ${period}`;
}

// Build an array of interval rows at the requested grain (15, 30, or 60 min)
export function makeIntervals(size: 15 | 30 | 60): Array<{ label: string; indices: number[] }> {
  const step = size / 15;
  const rows: Array<{ label: string; indices: number[] }> = [];
  for (let i = 0; i < SLOT_COUNT; i += step) {
    rows.push({ label: fmtSlot(i), indices: Array.from({ length: step }, (_, j) => i + j) });
  }
  return rows;
}

// Standard median of a numeric array (returns 0 for empty input)
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Step A ────────────────────────────────────────────────────────────────────
// For each (dayOfWeek 0-6 in Mon-Sun order, intervalIndex 0-95), compute the
// median volume across all dates in the GridData that fall on that day of week.
export function computeMedianPattern(data: GridData): {
  medians: number[][];    // [7][96] — outer=dow(0=Mon…6=Sun), inner=intervalIndex
  sampleCounts: number[]; // [7] — how many dates contributed per dow
} {
  // Accumulate all volume observations per (dow, slot)
  // Index 0=Mon, 1=Tue, …, 6=Sun
  const buckets: number[][][] = Array.from({ length: 7 }, () =>
    Array.from({ length: SLOT_COUNT }, () => [] as number[])
  );

  for (const [dateStr, slots] of Object.entries(data)) {
    const date = new Date(dateStr + "T12:00:00"); // noon to avoid DST edge cases
    const jsDay = date.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
    const dowIdx = jsDay === 0 ? 6 : jsDay - 1; // remap: Mon=0, …, Sun=6
    for (let i = 0; i < SLOT_COUNT; i++) {
      const volume = slots[i]?.volume ?? 0;
      buckets[dowIdx][i].push(volume);
    }
  }

  // Exclude zero observations before computing the median so that missing-data
  // gaps and closed-day zeros don't suppress the pattern for active intervals.
  // Genuinely zero-volume slots (all observations are 0) produce an empty array
  // which median() maps to 0 — the correct output for those intervals.
  const medians: number[][] = buckets.map((dowBuckets) =>
    dowBuckets.map((vals) => median(vals.filter((v) => v > 0)))
  );
  const sampleCounts: number[] = buckets.map((dowBuckets) => dowBuckets[0]?.length ?? 0);

  return { medians, sampleCounts };
}

// ── Step B ────────────────────────────────────────────────────────────────────
// Derive normalised weights from raw medians:
//   dayWeights[d]          = sum(medians[d]) / grandTotal
//   intervalWeights[d][i]  = medians[d][i]  / sum(medians[d])
export function computeDistributionWeights(medians: number[][]): {
  dayWeights: number[];
  intervalWeights: number[][];
} {
  const rowSums = medians.map((row) => row.reduce((a, b) => a + b, 0));
  const grandTotal = rowSums.reduce((a, b) => a + b, 0);

  const dayWeights = rowSums.map((s) => (grandTotal > 0 ? s / grandTotal : 0));
  const intervalWeights = medians.map((row, d) =>
    row.map((v) => (rowSums[d] > 0 ? v / rowSums[d] : 0))
  );

  return { dayWeights, intervalWeights };
}

// ── Weekly Distribution from Monthly ─────────────────────────────────────────
// Given the last N weeks of daily actual volumes, compute the percentage
// contribution of each ISO week (Mon-Sun) relative to the N-week total.
// Returns an array of { weekStart, weekEnd, volume, pct } sorted chronologically.
export interface WeekBucket {
  weekStart: string; // YYYY-MM-DD (Monday)
  weekEnd: string;   // YYYY-MM-DD (Sunday)
  volume: number;
  pct: number;
}

// Get the Monday of the ISO week for a given date
export function getISOMonday(date: Date): Date {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0); // noon avoids DST/UTC-rollback issues
  const day = d.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return d;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

// Compute weekly buckets from daily volume data (GridData).
// Groups dates by their ISO week (Mon-Sun) and computes each week's share.
export function computeWeeklyBuckets(data: GridData): WeekBucket[] {
  const weekMap = new Map<string, { weekStart: Date; weekEnd: Date; volume: number }>();

  for (const [dateStr, slots] of Object.entries(data)) {
    const date = new Date(dateStr + "T12:00:00");
    const monday = getISOMonday(date);
    const key = formatDate(monday);
    const dayVolume = Object.values(slots).reduce((sum, s) => sum + (s.volume ?? 0), 0);

    if (!weekMap.has(key)) {
      weekMap.set(key, {
        weekStart: monday,
        weekEnd: addDays(monday, 6),
        volume: 0,
      });
    }
    weekMap.get(key)!.volume += dayVolume;
  }

  const weeks = Array.from(weekMap.values()).sort(
    (a, b) => a.weekStart.getTime() - b.weekStart.getTime()
  );

  const totalVolume = weeks.reduce((sum, w) => sum + w.volume, 0);

  return weeks.map((w) => ({
    weekStart: formatDate(w.weekStart),
    weekEnd: formatDate(w.weekEnd),
    volume: w.volume,
    pct: totalVolume > 0 ? w.volume / totalVolume : 0,
  }));
}

// Determine which week index (0-based within the target month) a given
// target week start falls into.
//
// Uses the Thursday of the week (ISO convention) to determine which month the
// week "belongs to". This correctly handles weeks whose Monday falls in the
// previous month (e.g. the first week of April 2026 starts on March 30 — the
// old floor(dayOfMonth/7) approach returned position 4 instead of 0).
export function getWeekOfMonth(dateStr: string): number {
  // dateStr is always a Monday; Thursday = +3 days
  const monday = new Date(dateStr + "T12:00:00");
  const thursday = addDays(monday, 3);
  const year = thursday.getFullYear();
  const month = thursday.getMonth();

  // Find the first Thursday of that month
  const firstOfMonth = new Date(year, month, 1, 12, 0, 0);
  const dow = firstOfMonth.getDay(); // 0=Sun … 6=Sat
  const daysToThursday = dow <= 4 ? 4 - dow : 11 - dow;
  const firstThursday = addDays(firstOfMonth, daysToThursday);

  // 0-based position = how many full weeks after the first Thursday
  const diffDays = Math.round((thursday.getTime() - firstThursday.getTime()) / 86400000);
  return Math.floor(diffDays / 7);
}

// Distribute monthly volume to a specific target week using historical weekly pattern.
//
// The key correctness requirement: the share applied to monthlyVolume must be
// "this week-position's fraction of a typical month", NOT "this week's fraction
// of all loaded history".  The latter shrinks proportionally to how many months
// of history are loaded (e.g. 20 weeks → each pct ≈ 5 % → result is 5 % of the
// monthly forecast instead of ~25 %) — the root cause of the low totals.
//
// Fix: group historical weeks by week-of-month position (0 = first week of the
// month, 1 = second, …), average their raw volumes per position, normalise those
// averages so they sum to 1, then multiply by monthlyVolume.  This mirrors the
// correct logic already used in the manual-entry path.
export function distributeMonthlyToTargetWeek(
  monthlyVolume: number,
  weekBuckets: WeekBucket[],
  targetWeekStart: string,
): number {
  if (weekBuckets.length === 0 || monthlyVolume === 0) return 0;

  const targetWeekIdx = getWeekOfMonth(targetWeekStart);

  // 1. Accumulate volumes per week-of-month position across all history
  const volumesByPosition = new Map<number, number[]>();
  for (const bucket of weekBuckets) {
    const pos = getWeekOfMonth(bucket.weekStart);
    if (!volumesByPosition.has(pos)) volumesByPosition.set(pos, []);
    volumesByPosition.get(pos)!.push(bucket.volume);
  }

  // 2. Average volume per position (handles multiple historical cycles correctly)
  const avgByPosition = new Map<number, number>();
  for (const [pos, vols] of volumesByPosition) {
    avgByPosition.set(pos, vols.reduce((a, b) => a + b, 0) / vols.length);
  }

  // 3. Normalise so all position averages sum to 1 → gives "share of a typical month"
  const totalAvg = Array.from(avgByPosition.values()).reduce((a, b) => a + b, 0);
  if (totalAvg === 0) {
    // No usable history — equal split across known positions
    return monthlyVolume / Math.max(1, avgByPosition.size);
  }

  const posAvg = avgByPosition.get(targetWeekIdx);
  if (posAvg !== undefined) {
    return monthlyVolume * (posAvg / totalAvg);
  }

  // Target position not present in history — equal split across known positions
  return monthlyVolume / Math.max(1, avgByPosition.size);
}

// ── Monthly → Weekly via DOW daily expansion ─────────────────────────────────
// Better than the positional-average method because it handles variable month
// composition (e.g. 5 Mondays) and doesn't contaminate estimates with holiday
// weeks or outages in the historical data.
//
// Algorithm:
//   1. Compute each calendar day's expected volume = monthlyVol × (DOW weight /
//      sum of DOW weights for all days in the month).
//   2. Sum the 7 days of the target week (using the month's DOW weight basis
//      even for days that straddle into an adjacent month — acceptable
//      approximation, same monthly rate applied to all 7 days).
export function distributeMonthlyToWeekViaDailyDOW(
  monthlyVolume: number,
  year: number,
  month: number,        // 0-based (0 = Jan)
  targetWeekStart: string, // YYYY-MM-DD (Monday)
  dayWeights: number[], // [Mon=0 … Sun=6], raw or normalised
): number {
  if (monthlyVolume === 0) return 0;

  const totalDOWWeight = dayWeights.reduce((a, b) => a + b, 0);
  // Uniform fallback when no DOW pattern exists yet
  const w = (dowIdx: number) =>
    totalDOWWeight > 0 ? dayWeights[dowIdx] : 1;

  // Sum DOW weights across every calendar day in the month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let monthWeightSum = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const jsDay = new Date(year, month, d, 12, 0, 0).getDay(); // 0=Sun
    const dowIdx = jsDay === 0 ? 6 : jsDay - 1;                // Mon=0..Sun=6
    monthWeightSum += w(dowIdx);
  }
  if (monthWeightSum === 0) return monthlyVolume / 4.33; // should never happen

  // Sum DOW weights for the 7 days of the target week
  const twMon = new Date(targetWeekStart + "T12:00:00");
  let weekWeightSum = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(twMon);
    d.setDate(d.getDate() + i);
    const jsDay = d.getDay();
    const dowIdx = jsDay === 0 ? 6 : jsDay - 1;
    weekWeightSum += w(dowIdx);
  }

  return monthlyVolume * (weekWeightSum / monthWeightSum);
}

// ── Statistical outlier fence for week buckets ────────────────────────────────
// Uses the Poisson noise model: for a process with mean λ, σ = √λ.
// A week is flagged when its volume falls outside μ ± 2√μ relative to other
// historical weeks at the same week-of-month position.
// Requires at least 2 data points per position to compute a fence.

export interface WeekOutlierAnalysis {
  /** weekStart strings for weeks flagged as statistical outliers */
  outlierSet: Set<string>;
  /** Poisson fence stats per week-of-month position (0 = first week of month) */
  fenceByPosition: Map<number, { mean: number; lower: number; upper: number; n: number }>;
}

export function computeWeekOutlierFence(weekBuckets: WeekBucket[]): WeekOutlierAnalysis {
  const byPosition = new Map<number, WeekBucket[]>();
  for (const bucket of weekBuckets) {
    const pos = getWeekOfMonth(bucket.weekStart);
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(bucket);
  }

  const fenceByPosition = new Map<number, { mean: number; lower: number; upper: number; n: number }>();
  const outlierSet = new Set<string>();

  for (const [pos, buckets] of byPosition) {
    if (buckets.length < 2) continue; // need ≥ 2 to establish a baseline
    const volumes = buckets.map(b => b.volume);
    const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const sigma = Math.sqrt(Math.max(mean, 1)); // Poisson: σ = √λ
    const lower = Math.max(0, mean - 2 * sigma);
    const upper = mean + 2 * sigma;
    fenceByPosition.set(pos, { mean, lower, upper, n: buckets.length });
    for (const b of buckets) {
      if (b.volume < lower || b.volume > upper) outlierSet.add(b.weekStart);
    }
  }

  return { outlierSet, fenceByPosition };
}

// ── Step C (Updated) ─────────────────────────────────────────────────────────
// Distribute a weekly forecast volume into interval-level volumes for each day.
// Formula:
//   interval_vol[d][i] = weeklyVol × dayWeights[d] × intervalWeights[d][i]
export function distributeWeeklyVolumeToIntervals(
  weeklyVolume: number,
  dayWeights: number[],
  intervalWeights: number[][],
): number[][] {
  return dayWeights.map((dw, d) =>
    intervalWeights[d].map((iw) => dw * iw * weeklyVolume)
  );
}

// Legacy function: distribute monthly volume to a representative week
// (kept for backward compat)
export function distributeMonthlyVolumeToWeek(
  monthlyVolume: number,
  targetYear: number,
  targetMonth: number, // 0-11
  dayWeights: number[],
  intervalWeights: number[][]
): number[][] {
  const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const weeklyFraction = daysInMonth / 7;

  return dayWeights.map((dw, d) =>
    intervalWeights[d].map((iw) => dw * iw * monthlyVolume * weeklyFraction)
  );
}

// ── Step D ────────────────────────────────────────────────────────────────────
// Aggregate 15-min slot data [7][96] into 30-min slot data [7][48]
export function aggregateTo30Min(data: number[][]): number[][] {
  return data.map((day) => {
    const result: number[] = [];
    for (let i = 0; i < day.length; i += 2) {
      result.push((day[i] ?? 0) + (day[i + 1] ?? 0));
    }
    return result;
  });
}

// Aggregate 15-min slot data [7][96] into 60-min slot data [7][24]
export function aggregateTo60Min(data: number[][]): number[][] {
  return data.map((day) => {
    const result: number[] = [];
    for (let i = 0; i < day.length; i += 4) {
      result.push((day[i] ?? 0) + (day[i + 1] ?? 0) + (day[i + 2] ?? 0) + (day[i + 3] ?? 0));
    }
    return result;
  });
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
// Build a Recharts-ready data array from weekForecast[7][slots]
// Each point: { time: "9:00 AM", Mon: 12.3, Tue: 8.1, ... }
export function buildChartData(
  weekForecast: number[][],
  grain: 15 | 30 | 60
): Record<string, number | string>[] {
  const step = grain / 15;
  const slotCount = Math.floor(SLOT_COUNT / step);
  return Array.from({ length: slotCount }, (_, i) => {
    const point: Record<string, number | string> = { time: fmtSlot(i * step) };
    DOW_LABELS.forEach((label, d) => {
      point[label] = Math.round((weekForecast[d]?.[i] ?? 0) * 10) / 10;
    });
    return point;
  });
}

// ── Month label helpers ───────────────────────────────────────────────────────
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Generate 12 month labels starting from a given startDate string (YYYY-MM-DD)
export function generateMonthLabels(startDate: string): string[] {
  const base = new Date(startDate + "T12:00:00");
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  });
}

// Return { year, month (0-11) } for a given offset from startDate
export function monthFromOffset(startDate: string, offset: number): { year: number; month: number } {
  const base = new Date(startDate + "T12:00:00");
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// ── Week helpers ──────────────────────────────────────────────────────────────

// Get all Monday-start weeks that fall within a given month
export function getWeeksInMonth(year: number, month: number): Array<{ start: string; end: string; label: string }> {
  const weeks: Array<{ start: string; end: string; label: string }> = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Start from the Monday on or before the first day of month
  let cursor = getISOMonday(firstDay);

  while (cursor <= lastDay) {
    const weekEnd = addDays(cursor, 6);
    const startStr = formatDate(cursor);
    const endStr = formatDate(weekEnd);

    // Only include if any part of the week overlaps the target month
    const overlapStart = cursor < firstDay ? firstDay : cursor;
    const overlapEnd = weekEnd > lastDay ? lastDay : weekEnd;
    if (overlapStart <= overlapEnd) {
      const startLabel = `${cursor.getDate()} ${MONTH_NAMES[cursor.getMonth()]}`;
      const endLabel = `${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]}`;
      weeks.push({
        start: startStr,
        end: endStr,
        label: `${startLabel} – ${endLabel}`,
      });
    }

    cursor = addDays(cursor, 7);
  }

  return weeks;
}

// ── Manual Entry Parsing ──────────────────────────────────────────────────────
// Parse pasted Excel/spreadsheet data (tab-separated rows) into a flat number array.
// Expected format: rows of weekly actual volumes (one number per line or tab-separated)
export function parseExcelPaste(text: string): number[] {
  const values: number[] = [];
  const lines = text.trim().split(/\r?\n/);
  for (const line of lines) {
    const cells = line.split(/\t|,/).map((c) => c.trim());
    for (const cell of cells) {
      const num = parseFloat(cell.replace(/[,$\s]/g, ""));
      if (Number.isFinite(num) && num >= 0) {
        values.push(num);
      }
    }
  }
  return values;
}

// ── Interval Grid Paste Parsing ───────────────────────────────────────────────
// Parse a pasted Excel grid that matches the screenshot format:
//   Row 0 (optional header): "Date", "05/12", "05/13", … OR "Day", "Mon", "Tue", …
//   Row 1 (optional subheader): "Day", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"
//   Data rows: "12:00 AM", 3, 0, 2, 0, 1, 0, 2
//              "12:30 AM", 0, 1, 0, 0, 1, 0, 3
//              …
//
// The paste can include:
//  - A "Date" header row with actual dates (we parse those dates)
//  - OR just day-of-week labels (Mon/Tue/…) with no real dates
//  - Time labels in column 0 (12:00 AM, 12:30 AM, …) OR just numeric interval indexes
//
// Returns GridData keyed by ISO date string (or synthetic Mon-Sun dates if no real dates found).
// Also returns a summary of what was parsed.

export interface GridPasteResult {
  data: GridData;
  rowCount: number;      // number of time-slot rows parsed
  colCount: number;      // number of day columns parsed
  weekCount: number;     // number of weeks inferred from colCount
  dates: string[];       // actual date strings used as keys
  hasRealDates: boolean; // true if real calendar dates were detected in header
  grain: 15 | 30 | 60;  // inferred from time labels or row count
}

// Parse a time label like "12:00 AM", "9:30 AM", "14:00" → slot index (0-95)
// Returns -1 if unparseable
function parseTimeLabel(label: string): number {
  if (!label) return -1;
  const clean = label.trim().toUpperCase();

  // Try HH:MM AM/PM
  const ampm = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = parseInt(ampm[2]);
    const period = ampm[3];
    if (period === "AM") {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
    return Math.round((h * 60 + m) / 15);
  }

  // Try 24h HH:MM
  const h24 = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const h = parseInt(h24[1]);
    const m = parseInt(h24[2]);
    return Math.round((h * 60 + m) / 15);
  }

  return -1;
}

// Parse a date string like "05/12", "2026-05-12", "5/12/2026" → YYYY-MM-DD
// If only MM/DD with no year, assume current year
function parseDateHeader(cell: string, year?: number): string | null {
  const clean = cell.trim();
  const y = year ?? new Date().getFullYear();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  // MM/DD/YYYY or M/D/YYYY
  const mdy = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }

  // MM/DD or M/D (no year — assume current year)
  const md = clean.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (md) {
    return `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
  }

  return null;
}

// Generate synthetic Mon-Sun date strings for the current or given week
function getSyntheticWeekDates(referenceDate?: Date): string[] {
  const base = referenceDate ?? new Date();
  const monday = getISOMonday(base);
  return Array.from({ length: 7 }, (_, i) => formatDate(addDays(monday, i)));
}

// ── ISO week helpers ──────────────────────────────────────────────────────────

// Get the ISO 8601 week number of a date (1-based)
export function getISOWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7)); // shift to Thursday of the week
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// Get total ISO weeks in a year (52 or 53)
export function getISOWeeksInYear(year: number): number {
  return getISOWeekNumber(new Date(year, 11, 28, 12, 0, 0));
}

// Get the Monday of ISO week N in a given year
export function getISOWeekMonday(year: number, weekNumber: number): Date {
  // Jan 4 is always in ISO week 1
  const jan4 = new Date(year, 0, 4, 12, 0, 0);
  const monday = getISOMonday(jan4);
  return addDays(monday, (weekNumber - 1) * 7);
}

// Get all 7 ISO date strings (Mon–Sun) for a given year + ISO week number
export function getWeekDateStrings(year: number, weekNumber: number): string[] {
  const monday = getISOWeekMonday(year, weekNumber);
  return Array.from({ length: 7 }, (_, i) => formatDate(addDays(monday, i)));
}

// Remap GridData to start at a specific year + ISO week.
// originalDates: the ordered date keys from the paste result (may span multiple weeks).
// Returns new GridData with dates shifted to begin at the given week's Monday.
export function remapGridToWeek(
  data: GridData,
  originalDates: string[],
  year: number,
  weekNumber: number,
): GridData {
  const monday = getISOWeekMonday(year, weekNumber);
  const newData: GridData = {};
  originalDates.forEach((oldDate, i) => {
    const newDate = formatDate(addDays(monday, i));
    if (data[oldDate]) newData[newDate] = data[oldDate];
  });
  return newData;
}

// Generate synthetic dates for N consecutive days (spanning multiple weeks if needed).
// The last week is the most recent Mon-Sun week, earlier weeks go back in time.
function getSyntheticMultiWeekDates(numDays: number): string[] {
  const numWeeks = Math.ceil(numDays / 7);
  const monday = getISOMonday(new Date());
  const startDate = addDays(monday, -(numWeeks - 1) * 7);
  return Array.from({ length: numDays }, (_, i) => formatDate(addDays(startDate, i)));
}

export function parseIntervalGridPaste(text: string): GridPasteResult {
  const empty: GridPasteResult = {
    data: {}, rowCount: 0, colCount: 0, weekCount: 0, dates: [], hasRealDates: false, grain: 15,
  };

  if (!text.trim()) return empty;

  const lines = text.trim().split(/\r?\n/).map((l) => l.split("\t"));
  if (lines.length < 2) return empty;

  // ── Step 1: detect header rows ────────────────────────────────────────────
  // Look at first 1-3 rows to find:
  //   - A "Date" row with actual calendar dates  e.g. ["Date","05/12","05/13","05/14","05/15","05/16","05/17","05/18"]
  //   - OR a "Day" row with day-of-week labels   e.g. ["Day","Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
  //   - Data rows starting with time labels

  const DOW_ABBREV = ["MON","TUE","WED","THU","FRI","SAT","SUN",
                      "MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];

  let dateHeaders: (string | null)[] = []; // null = day-of-week column with no real date
  let dataStartRow = 0;
  let hasRealDates = false;

  const currentYear = new Date().getFullYear();

  for (let r = 0; r < Math.min(4, lines.length); r++) {
    const row = lines[r];
    const firstCell = (row[0] ?? "").trim().toUpperCase();

    // Skip "Date" / "Day" label in col 0
    const dataCols = firstCell === "DATE" || firstCell === "DAY" || firstCell === "" ? row.slice(1) : row;

    // Check if this row contains real dates
    const parsedDates = dataCols.map((c) => parseDateHeader(c.trim(), currentYear));
    const realDateCount = parsedDates.filter(Boolean).length;

    if (realDateCount >= 4) {
      // This is a date header row
      dateHeaders = parsedDates;
      hasRealDates = true;
      dataStartRow = r + 1;
      continue;
    }

    // Check if this row contains day-of-week labels
    const dowCount = dataCols.filter((c) => DOW_ABBREV.includes(c.trim().toUpperCase())).length;
    if (dowCount >= 3) {
      // Day-of-week label row — skip it (already handled via synthetic dates)
      if (!hasRealDates) dataStartRow = r + 1;
      continue;
    }

    // Check if first cell is a time label → data starts here
    const slotIdx = parseTimeLabel(row[0] ?? "");
    if (slotIdx >= 0 || /^\d+$/.test((row[0] ?? "").trim())) {
      dataStartRow = r;
      break;
    }
  }

  // ── Step 2: parse data rows ───────────────────────────────────────────────
  const dataRows = lines.slice(dataStartRow);
  if (dataRows.length === 0) return empty;

  // Determine number of day columns (max cols across data rows, minus time label col)
  const maxCols = Math.max(...dataRows.map((r) => r.length)) - 1;
  if (maxCols <= 0) return empty;

  // Determine dates to use as keys
  let datesToUse: string[];
  if (hasRealDates && dateHeaders.length > 0) {
    datesToUse = dateHeaders.slice(0, maxCols).map((d, i) => {
      return d ?? getSyntheticWeekDates()[i % 7];
    });
  } else {
    // Use synthetic dates spanning as many weeks as needed (supports multi-week paste)
    datesToUse = getSyntheticMultiWeekDates(maxCols);
  }

  // Parse slot volumes
  const slotMap: Map<number, number[]> = new Map(); // slot index → [vol per day col]
  let parsedRowCount = 0;

  for (const row of dataRows) {
    if (row.length < 2) continue;
    const firstCell = (row[0] ?? "").trim();
    let slotIdx = parseTimeLabel(firstCell);

    // Also accept raw integer slot index
    if (slotIdx < 0 && /^\d+$/.test(firstCell)) {
      slotIdx = parseInt(firstCell);
    }

    if (slotIdx < 0 || slotIdx >= SLOT_COUNT) continue;

    const dayVols: number[] = [];
    for (let c = 1; c <= maxCols && c < row.length; c++) {
      const raw = (row[c] ?? "").trim().replace(/[,$]/g, "");
      const vol = raw === "" ? 0 : parseFloat(raw);
      dayVols.push(Number.isFinite(vol) ? Math.max(0, vol) : 0);
    }

    if (dayVols.length > 0) {
      slotMap.set(slotIdx, dayVols);
      parsedRowCount++;
    }
  }

  if (slotMap.size === 0) return empty;

  // ── Step 3: infer grain from slot count ──────────────────────────────────
  const slots = Array.from(slotMap.keys()).sort((a, b) => a - b);
  let inferredGrain: 15 | 30 | 60 = 15;
  if (slots.length >= 2) {
    const step = slots[1] - slots[0];
    if (step === 2) inferredGrain = 30;
    else if (step === 4) inferredGrain = 60;
    else inferredGrain = 15;
  } else {
    if (parsedRowCount <= 24) inferredGrain = 60;
    else if (parsedRowCount <= 48) inferredGrain = 30;
    else inferredGrain = 15;
  }

  // ── Step 4: build GridData ────────────────────────────────────────────────
  // If grain > 15, expand each row to fill all 15-min sub-slots evenly
  const subSlots = inferredGrain / 15;
  const gridData: GridData = {};

  for (const date of datesToUse) {
    gridData[date] = {};
  }

  for (const [slotIdx, dayVols] of slotMap) {
    for (let sub = 0; sub < subSlots; sub++) {
      const actualSlot = slotIdx + sub;
      if (actualSlot >= SLOT_COUNT) continue;
      dayVols.forEach((vol, colIdx) => {
        const date = datesToUse[colIdx];
        if (!date) return;
        const perSubSlot = subSlots > 1 ? vol / subSlots : vol;
        if (!gridData[date]) gridData[date] = {};
        gridData[date][actualSlot] = { volume: perSubSlot, aht: 0 };
      });
    }
  }

  return {
    data: gridData,
    rowCount: parsedRowCount,
    colCount: maxCols,
    weekCount: Math.ceil(maxCols / 7),
    dates: datesToUse,
    hasRealDates,
    grain: inferredGrain,
  };
}
