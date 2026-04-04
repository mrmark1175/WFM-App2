// ── Intraday Distribution Engine — pure math utilities ────────────────────────
// No React dependencies. All functions are deterministic and unit-testable.

export const SLOT_COUNT = 96; // 15-min slots per day (00:00 → 23:45)
export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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

// Build an array of interval rows at the requested grain (15 or 30 min)
export function makeIntervals(size: 15 | 30): Array<{ label: string; indices: number[] }> {
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
// For each (dayOfWeek 0-6, intervalIndex 0-95), compute the median volume
// across all dates in the GridData that fall on that day of week.
export function computeMedianPattern(data: GridData): {
  medians: number[][];    // [7][96] — outer=dow(0=Sun…6=Sat), inner=intervalIndex
  sampleCounts: number[]; // [7] — how many dates contributed per dow
} {
  // Accumulate all volume observations per (dow, slot)
  const buckets: number[][][] = Array.from({ length: 7 }, () =>
    Array.from({ length: SLOT_COUNT }, () => [] as number[])
  );

  for (const [dateStr, slots] of Object.entries(data)) {
    const date = new Date(dateStr + "T12:00:00"); // noon to avoid DST edge cases
    const dow = date.getDay(); // 0=Sun … 6=Sat
    for (let i = 0; i < SLOT_COUNT; i++) {
      const volume = slots[i]?.volume ?? 0;
      buckets[dow][i].push(volume);
    }
  }

  const medians: number[][] = buckets.map((dowBuckets) =>
    dowBuckets.map((vals) => median(vals))
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

// ── Step C ────────────────────────────────────────────────────────────────────
// Distribute a monthly forecast volume into a representative week of interval-level volumes.
// Formula:
//   interval_vol[d][i] = monthlyVol × (daysInMonth / 7) × dayWeights[d] × intervalWeights[d][i]
//
// "daysInMonth / 7" converts a monthly total to a weekly slice.
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
// by summing adjacent pairs.
export function aggregateTo30Min(data: number[][]): number[][] {
  return data.map((day) => {
    const result: number[] = [];
    for (let i = 0; i < day.length; i += 2) {
      result.push((day[i] ?? 0) + (day[i + 1] ?? 0));
    }
    return result;
  });
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
// Build a Recharts-ready data array from weekForecast[7][slots]
// Each point: { time: "9:00 AM", Sun: 0, Mon: 12.3, Tue: 8.1, ... }
export function buildChartData(
  weekForecast: number[][],
  grain: 15 | 30
): Record<string, number | string>[] {
  const slotCount = grain === 15 ? SLOT_COUNT : SLOT_COUNT / 2;
  return Array.from({ length: slotCount }, (_, i) => {
    const point: Record<string, number | string> = { time: fmtSlot(i * (grain / 15)) };
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
