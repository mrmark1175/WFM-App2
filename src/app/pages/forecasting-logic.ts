/**
 * Applies a year-over-year growth rate to a historical data series.
 * @param historicalData - An array of 12 numbers representing last year's monthly volumes.
 * @param growthRate - The percentage growth rate to apply (e.g., 5 for 5%).
 * @returns A new array of 12 numbers representing the forecasted monthly volumes.
 */
export const calculateYoY = (historicalData: number[], growthRate: number): number[] => {
  const growthMultiplier = 1 + growthRate / 100;
  return historicalData.map(volume => Math.max(0, Math.round(volume * growthMultiplier)));
};

/**
 * Moving Average: Rolling average (last N months).
 * Projects a flat line based on the average of the most recent N periods.
 */
export const calculateMovingAverage = (historicalData: number[], periods: number = 3): number[] => {
  if (historicalData.length === 0) return Array(12).fill(0);
  
  const recentData = historicalData.slice(-Math.min(periods, historicalData.length));
  const avg = recentData.reduce((a, b) => a + b, 0) / recentData.length;
  
  return Array(12).fill(Math.max(0, Math.round(avg)));
};

/**
 * Removes trailing placeholder gaps from monthly history before it enters a
 * forecast model. Historical imports can be sparse by channel/LOB; treating
 * padded missing months as real zero-demand months corrupts the trend.
 */
export const normalizeForecastInput = (data: number[]): number[] => {
  let end = data.length;
  while (end > 0) {
    const value = data[end - 1];
    if (Number.isFinite(value) && value > 0) break;
    end--;
  }
  return data
    .slice(0, end)
    .filter((value) => Number.isFinite(value) && value >= 0);
};

/**
 * Guarantees a month-indexed forecast series with the requested number of
 * periods. Missing/non-finite months are filled from the most recent seasonal
 * source pattern when one exists, otherwise with 0.
 */
export const normalizeMonthlyForecast = (
  forecast: number[],
  sourceHistory: number[] = [],
  periods: number = 12
): number[] => {
  const cleanedHistory = normalizeForecastInput(sourceHistory);
  const seasonalSource = cleanedHistory.length > 0 ? cleanedHistory.slice(-Math.min(12, cleanedHistory.length)) : [];
  return Array.from({ length: periods }, (_, index) => {
    const value = forecast[index];
    if (Number.isFinite(value) && value >= 0) return Math.round(value);
    const fallback = seasonalSource.length > 0 ? seasonalSource[index % seasonalSource.length] : 0;
    return Math.max(0, Math.round(fallback));
  });
};

/**
 * Keeps monthly history on its calendar grid for two-pass forecasting. Unlike
 * normalizeForecastInput, this does not shorten a partial final year; padded
 * trailing placeholders are filled so the next appended year still starts at
 * January instead of immediately after the latest non-zero month.
 */
export const normalizeMonthlyHistoryForExtendedForecast = (
  history: number[],
  periodsPerYear: number = 12
): number[] => {
  if (history.length === 0) return [];
  const targetLength = Math.max(periodsPerYear, Math.ceil(history.length / periodsPerYear) * periodsPerYear);
  const padded = Array.from({ length: targetLength }, (_, index) => history[index] ?? 0);
  const cleanedSource = normalizeForecastInput(history);
  const seasonalSource = cleanedSource.length > 0 ? cleanedSource.slice(-Math.min(periodsPerYear, cleanedSource.length)) : [];

  return padded.map((value, index) => {
    if (Number.isFinite(value) && value > 0) return Math.round(value);
    const sameMonthPrior = index >= periodsPerYear ? padded[index - periodsPerYear] : undefined;
    if (Number.isFinite(sameMonthPrior) && sameMonthPrior > 0) return Math.round(sameMonthPrior);
    const fallback = seasonalSource.length > 0 ? seasonalSource[index % seasonalSource.length] : 0;
    return Math.max(0, Math.round(fallback));
  });
};

export const buildTwoPassYear2Input = (historicalBase: number[], year1EffectiveBase: number[]): number[] => {
  const priorYear = historicalBase.slice(-12);
  const priorTotal = priorYear.reduce((sum, value) => sum + value, 0);
  const year1Total = year1EffectiveBase.reduce((sum, value) => sum + value, 0);
  const year1Ratio = priorTotal > 0 ? year1Total / priorTotal : 1;
  const hasStructuralShift = year1Ratio < 0.65 || year1Ratio > 1.55;
  return hasStructuralShift
    ? [...year1EffectiveBase, ...year1EffectiveBase]
    : [...historicalBase, ...year1EffectiveBase];
};

interface EffectiveYearOnePlanInputs {
  basePlan: number[];
  actualsByMonth?: Array<number | null | undefined>;
  completedMonthIndices?: number[];
  recutFactor?: number | null;
  publishedRecut?: number[] | null;
  sourceHistory?: number[];
}

/**
 * Builds the complete Year 1 Jan-Dec series used as extended history for a
 * two-pass Year 2 forecast. Actualized months override the plan, while all
 * remaining months stay on the full-year forecast/re-cut plan.
 */
export const buildEffectiveYearOnePlan = ({
  basePlan,
  actualsByMonth = [],
  completedMonthIndices = Array.from({ length: 12 }, (_, index) => index),
  recutFactor = null,
  publishedRecut = null,
  sourceHistory = [],
}: EffectiveYearOnePlanInputs): number[] => {
  const normalizedBase = normalizeMonthlyForecast(
    basePlan,
    sourceHistory,
    12
  );
  const normalizedPublished = publishedRecut
    ? normalizeMonthlyForecast(publishedRecut.slice(0, 12), normalizedBase, 12)
    : null;
  const completed = new Set(completedMonthIndices.filter((index) => index >= 0 && index < 12));

  return Array.from({ length: 12 }, (_, index) => {
    const baseValue = normalizedPublished?.[index] ?? normalizedBase[index] ?? 0;
    if (completed.has(index)) {
      const actual = actualsByMonth[index];
      if (actual != null && Number.isFinite(actual) && actual >= 0) {
        return Math.round(actual);
      }
    }
    if (normalizedPublished) return Math.round(baseValue);
    return recutFactor != null ? Math.round(baseValue * recutFactor) : Math.round(baseValue);
  });
};

/**
 * Calculates a linear regression forecast (Simple Trend).
 */
export const calculateLinearRegression = (historicalData: number[]): number[] => {
  const n = historicalData.length;
  if (n < 2) return Array(12).fill(historicalData[0] || 0);

  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += historicalData[i];
    sumXY += i * historicalData[i];
    sumXX += i * i;
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  return Array.from({ length: 12 }, (_, i) => {
    const x = n + i;
    return Math.max(0, Math.round(slope * x + intercept));
  });
};

/**
 * Holt-Winters (Triple Exponential Smoothing).
 * Standard WFM method for level, trend, and seasonality.
 */
export const calculateHoltWinters = (
  data: number[],
  alpha: number = 0.3,
  beta: number = 0.1,
  gamma: number = 0.3,
  seasonLength: number = 12,
  forecastPeriods: number = 12
): number[] => {
  if (data.length < seasonLength * 2) {
    // Not enough data for full HW — fall back to linear regression on available data
    return calculateLinearRegression(data);
  }

  const forecastLength = forecastPeriods;
  const seasons = Math.floor(data.length / seasonLength);
  
  let level = data.slice(0, seasonLength).reduce((a, b) => a + b, 0) / seasonLength;
  // Prevent initial level from being 0 to avoid immediate division errors
  if (level === 0) level = 0.0001;

  let trend = (data.slice(seasonLength, 2 * seasonLength).reduce((a, b) => a + b, 0) - 
                data.slice(0, seasonLength).reduce((a, b) => a + b, 0)) / (seasonLength * seasonLength);

  let seasonal: number[] = [];
  for (let i = 0; i < seasonLength; i++) {
    let sumOverSeasons = 0;
    for (let j = 0; j < seasons; j++) {
      sumOverSeasons += data[j * seasonLength + i];
    }
    // Prevent division by zero if level is small
    const safeLevel = level === 0 ? 0.0001 : level;
    seasonal.push(sumOverSeasons / seasons / safeLevel);
  }

  // Ensure seasonal indices aren't zero to prevent future division by zero
  seasonal = seasonal.map(s => s === 0 ? 0.0001 : s);

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    const lastLevel = level;
    const lastTrend = trend;
    const lastSeasonal = seasonal[i % seasonLength];
    
    // Safeguard denominators
    const safeSeasonal = lastSeasonal === 0 ? 0.0001 : lastSeasonal;
    const safeLevel = level === 0 ? 0.0001 : level;

    level = alpha * (value / safeSeasonal) + (1 - alpha) * (lastLevel + lastTrend);
    trend = beta * (level - lastLevel) + (1 - beta) * lastTrend;
    seasonal[i % seasonLength] = gamma * (value / safeLevel) + (1 - gamma) * lastSeasonal;
  }

  return Array.from({ length: forecastLength }, (_, i) => {
    const m = i + 1;
    return Math.max(0, Math.round((level + m * trend) * seasonal[i % seasonLength]));
  });
};

/**
 * Decomposition: Extract trend (moving average) + Apply seasonal indices.
 * A simpler, more transparent method than Holt-Winters.
 */
export const calculateDecomposition = (
  historicalData: number[], 
  trendStrength: number = 1.0, 
  seasonalityStrength: number = 1.0
): number[] => {
  const n = historicalData.length;
  if (n < 12) return Array(12).fill(0);

  // 1. Extract Trend using a centered 12-month moving average
  const trend = new Array(n).fill(null);
  for (let i = 6; i < n - 6; i++) {
    const slice = historicalData.slice(i - 6, i + 6);
    trend[i] = slice.reduce((a, b) => a + b, 0) / 12;
  }

  // 2. Calculate Seasonal Indices (Ratio-to-Trend)
  const seasonalIndices = Array(12).fill(0);
  const counts = Array(12).fill(0);
  for (let i = 0; i < n; i++) {
    if (trend[i] !== null) {
      const monthIdx = i % 12;
      // Prevent division by zero if trend is 0
      const safeTrend = trend[i] === 0 ? 0.0001 : trend[i];
      seasonalIndices[monthIdx] += historicalData[i] / safeTrend;
      counts[monthIdx]++;
    }
  }

  // Average the raw seasonal ratios per month
  for (let i = 0; i < 12; i++) {
    seasonalIndices[i] = counts[i] > 0 ? seasonalIndices[i] / counts[i] : 1.0;
  }
  // Normalize so indices average to 1.0 — classical decomposition requirement.
  // Without this, a systematic bias in the raw ratios would inflate or deflate every
  // forecast month equally, which is not a seasonal effect.
  const meanSI = seasonalIndices.reduce((a, b) => a + b, 0) / 12;
  for (let i = 0; i < 12; i++) {
    const normalized = meanSI > 0 ? seasonalIndices[i] / meanSI : 1.0;
    seasonalIndices[i] = 1.0 + (normalized - 1.0) * seasonalityStrength;
  }

  // 3. Project Trend using simple linear regression on the extracted trend points
  const validTrendPoints = trend.map((v, i) => ({ x: i, y: v })).filter(p => p.y !== null);
  const m = validTrendPoints.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  validTrendPoints.forEach(p => {
    sumX += p.x;
    sumY += p.y!;
    sumXY += p.x * p.y!;
    sumXX += p.x * p.x;
  });

  let slope = (m * sumXY - sumX * sumY) / (m * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / m;
  
  // Apply Trend Strength
  slope = slope * trendStrength;

  // 4. Forecast
  return Array.from({ length: 12 }, (_, i) => {
    const x = n + i;
    const projectedTrend = slope * x + intercept;
    const monthIdx = (n + i) % 12;
    return Math.max(0, Math.round(projectedTrend * seasonalIndices[monthIdx]));
  });
};

/**
 * Gaussian elimination with partial pivoting — solves A·x = b.
 * Used internally by calculateARIMA for OLS AR-coefficient estimation.
 */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    if (Math.abs(aug[col][col]) < 1e-12) continue;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col] / aug[col][col];
      for (let c = col; c <= n; c++) aug[row][c] -= factor * aug[col][c];
    }
  }
  return aug.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

/**
 * ARIMA(p, d, q) — proper implementation.
 *
 * p (AR order):  AR coefficients are estimated via OLS on the differenced series.
 *                Captures how strongly past values predict the next value.
 * d (Differencing): Applied d times before fitting to remove trend non-stationarity.
 *                   d=1 models month-over-month changes; d=2 models changes-in-changes.
 * q (MA order):  Moving average of the last q in-sample residuals is added to each
 *                one-step-ahead forecast, dampening the impact of recent shocks.
 *
 * Forecasts are produced one step at a time and then un-differenced back to the
 * original scale by cumulative summation from the last observed values.
 */
export const calculateARIMA = (
  historicalData: number[],
  p: number = 1,
  d: number = 1,
  q: number = 1
): number[] => {
  if (historicalData.length < 2) return Array(12).fill(historicalData[0] ?? 0);

  // Step 1: d-order differencing; save each level for undifferencing
  const diffStack: number[][] = [historicalData];
  let diffSeries = [...historicalData];
  for (let i = 0; i < d; i++) {
    const next: number[] = [];
    for (let j = 1; j < diffSeries.length; j++) next.push(diffSeries[j] - diffSeries[j - 1]);
    diffSeries = next;
    diffStack.push([...diffSeries]);
  }

  // Step 2: Fit AR(p) coefficients via OLS on the differenced series
  // Model: y[t] = c + φ₁·y[t-1] + ... + φₚ·y[t-p]
  const clampedP = Math.min(p, Math.max(0, diffSeries.length - 2));
  let arCoeffs: number[] = Array(clampedP + 1).fill(0); // [intercept, φ₁ … φₚ]

  if (clampedP > 0 && diffSeries.length > clampedP + 1) {
    const X: number[][] = [];
    const Y: number[] = [];
    for (let t = clampedP; t < diffSeries.length; t++) {
      X.push([1, ...Array.from({ length: clampedP }, (_, lag) => diffSeries[t - lag - 1])]);
      Y.push(diffSeries[t]);
    }
    const cols = clampedP + 1;
    const XtX = Array.from({ length: cols }, () => Array(cols).fill(0));
    const XtY = Array(cols).fill(0);
    for (let i = 0; i < X.length; i++) {
      for (let r = 0; r < cols; r++) {
        XtY[r] += X[i][r] * Y[i];
        for (let c = 0; c < cols; c++) XtX[r][c] += X[i][r] * X[i][c];
      }
    }
    arCoeffs = solveLinearSystem(XtX, XtY);
  } else {
    // Not enough data for OLS — intercept = mean of differenced series
    arCoeffs = [diffSeries.length > 0 ? diffSeries.reduce((a, b) => a + b, 0) / diffSeries.length : 0];
  }

  // Step 3: Compute in-sample residuals for the MA(q) component
  const residuals: number[] = Array(clampedP).fill(0);
  for (let t = clampedP; t < diffSeries.length; t++) {
    let fitted = arCoeffs[0] ?? 0;
    for (let lag = 0; lag < clampedP; lag++) fitted += (arCoeffs[lag + 1] ?? 0) * diffSeries[t - lag - 1];
    residuals.push(diffSeries[t] - fitted);
  }

  // Step 4: Forecast 12 steps ahead on the differenced scale
  const extDiff = [...diffSeries];
  const extResid = [...residuals];
  const forecastDiff: number[] = [];

  for (let h = 0; h < 12; h++) {
    let yHat = arCoeffs[0] ?? 0;
    for (let lag = 0; lag < clampedP; lag++) yHat += (arCoeffs[lag + 1] ?? 0) * extDiff[extDiff.length - lag - 1];
    // MA(q): average of last q residuals corrects for recent forecast bias
    const clampedQ = Math.min(q, extResid.length);
    if (clampedQ > 0) {
      const maResids = extResid.slice(-clampedQ);
      yHat += maResids.reduce((a, b) => a + b, 0) / maResids.length;
    }
    forecastDiff.push(yHat);
    extDiff.push(yHat);
    extResid.push(0); // future residuals unknown → 0
  }

  // Step 5: Invert differencing (cumulative sum from last observed value at each level)
  let result = forecastDiff;
  for (let i = d - 1; i >= 0; i--) {
    const base = diffStack[i];
    let prev = base[base.length - 1];
    result = result.map((diff) => { prev = prev + diff; return prev; });
  }

  return result.map((v) => Math.max(0, Math.round(v)));
};

// ── Shared Assumptions interface (used by Demand Planner + Distribution Engine) ─
export interface Assumptions {
  startDate: string;
  aht: number;
  emailAht: number;
  chatAht: number;
  chatConcurrency: number;
  shrinkage: number;
  shrinkageSource: "manual" | "planner_excl" | "planner_incl";
  voiceSlaTarget: number;
  voiceSlaAnswerSeconds: number;
  voiceAsaTargetSeconds: number;
  emailSlaTarget: number;
  emailSlaAnswerSeconds: number;
  emailAsaTargetSeconds: number;
  chatSlaTarget: number;
  chatSlaAnswerSeconds: number;
  chatAsaTargetSeconds: number;
  voiceAvgPatienceSeconds?: number; // Erlang A: mean customer patience for voice (seconds); 0 = Erlang C
  chatAvgPatienceSeconds?: number;  // Erlang A: mean customer patience for chat (seconds); 0 = Erlang C
  occupancy: number;
  growthRate: number;
  safetyMargin: number;
  currency: string;
  annualSalary: number;
  onboardingCost: number;
  fteMonthlyHours: number;
  operatingHoursPerDay: number;
  operatingDaysPerWeek: number;
  useManualVolume: boolean;
  manualHistoricalData: number[];
  useShrinkageModeler?: boolean;
  shrinkageItems?: unknown[];
  planningMonths?: number;
  forecastHorizon?: 1 | 2;
  taskSwitchMultiplier?: number; // AHT inflation for blended async work (email/cases) due to context-switching; default 1.05
}

// ── Shared forecast dispatcher (used by Demand Planner + Distribution Engine) ─
// Extends a 12-month base forecast to `periods` months by tiling the seasonal pattern
// and applying an additional growth multiplier for each extra 12-month cycle.
const tileForecast = (base12: number[], periods: number, growthRatePct: number): number[] => {
  if (periods <= 12) return base12.slice(0, periods);
  const multiplier = growthRatePct === 0 ? 1 : 1 + growthRatePct / 100;
  return Array.from({ length: periods }, (_, i) => {
    const extraCycles = Math.floor(i / 12);
    return Math.round(base12[i % 12] * Math.pow(multiplier, extraCycles));
  });
};

export const getCalculatedVolumes = (
  data: number[],
  forecastMethod: string,
  assumptions: Assumptions,
  hwParams: { alpha: number; beta: number; gamma: number; seasonLength: number },
  arimaParams: { p: number; d: number; q: number },
  decompParams: { trendStrength: number; seasonalityStrength: number },
  forecastPeriods: number = 12
): number[] => {
  const normalizedData = normalizeForecastInput(data);
  if (normalizedData.length === 0) return Array(forecastPeriods).fill(0);
  const applyGrowth = (volumes: number[]) => {
    if (assumptions.growthRate === 0) return volumes;
    const multiplier = 1 + assumptions.growthRate / 100;
    return volumes.map((v) => Math.round(v * multiplier));
  };
  const dataForModel = normalizedData;
  const normalize = (volumes: number[]) => normalizeMonthlyForecast(volumes, dataForModel, forecastPeriods);
  switch (forecastMethod) {
    case "yoy": return normalize(tileForecast(calculateYoY(dataForModel.slice(-12), assumptions.growthRate), forecastPeriods, assumptions.growthRate));
    case "ma": return normalize(tileForecast(applyGrowth(calculateMovingAverage(dataForModel, 3)), forecastPeriods, assumptions.growthRate));
    case "regression": return normalize(tileForecast(applyGrowth(calculateLinearRegression(dataForModel)), forecastPeriods, assumptions.growthRate));
    case "holtwinters": return normalize(applyGrowth(calculateHoltWinters(dataForModel, hwParams.alpha, hwParams.beta, hwParams.gamma, hwParams.seasonLength, forecastPeriods)));
    case "decomposition": return normalize(tileForecast(applyGrowth(calculateDecomposition(dataForModel, decompParams.trendStrength, decompParams.seasonalityStrength)), forecastPeriods, assumptions.growthRate));
    case "arima": return normalize(tileForecast(applyGrowth(calculateARIMA(dataForModel, arimaParams.p, arimaParams.d, arimaParams.q)), forecastPeriods, assumptions.growthRate));
    case "genesys":
    default: return normalize(tileForecast(applyGrowth(dataForModel.slice(-12)), forecastPeriods, assumptions.growthRate));
  }
};

export interface BasicForecastData {
  month: string;
  year: string;
  isFuture: boolean;
  volume: number;
  requiredFTE: number;
  availableFTE: number | null;
  gap: number;
  aht: number;
}

/**
 * Generates automated WFM insights based on forecast data.
 */
export const generateInsights = (data: BasicForecastData[]): string[] => {
  if (data.length === 0) return [];

  const futureData = data.filter(d => d.isFuture);
  if (futureData.length === 0) return [];

  const insights: string[] = [];

  // 1. Peak Volume
  const peakMonth = [...futureData].sort((a, b) => b.volume - a.volume)[0];
  const avgVolume = futureData.reduce((sum, d) => sum + d.volume, 0) / futureData.length;
  const peakIncrease = ((peakMonth.volume - avgVolume) / avgVolume * 100).toFixed(1);
  insights.push(`Volume peaks in ${peakMonth.month} ${peakMonth.year} (+${peakIncrease}% vs avg)`);

  // 2. Understaffing Start
  const firstUnderstaffed = futureData.find(d => d.gap < 0);
  if (firstUnderstaffed) {
    insights.push(`Understaffing begins in ${firstUnderstaffed.month} ${firstUnderstaffed.year}`);
  }

  // 3. Maximum Shortage
  const maxShortage = [...futureData].sort((a, b) => a.gap - b.gap)[0];
  if (maxShortage && maxShortage.gap < 0) {
    insights.push(`Max shortage: ${Math.abs(maxShortage.gap)} FTE in ${maxShortage.month} ${maxShortage.year}`);
  }

  // 4. Overstaffing
  const firstOverstaffed = futureData.find(d => d.gap > 0);
  if (firstOverstaffed) {
    insights.push(`Overstaffing begins in ${firstOverstaffed.month} ${firstOverstaffed.year}`);
  }

  // 5. Sensitivity Insight
  const totalReqFTE = futureData.reduce((sum, d) => sum + d.requiredFTE, 0) / futureData.length;
  const avgAHT = futureData.reduce((sum, d) => sum + d.aht, 0) / futureData.length;
  const fteImpact = (totalReqFTE * (10 / avgAHT)).toFixed(1);
  insights.push(`Increasing AHT by 10s adds approximately ${fteImpact} FTE to total requirement`);

  return insights;
};

export interface HiringRecommendation {
  summary: string;
  monthlyHires: number;
  durationMonths: number;
  totalHires: number;
  startMonth: string;
}

/**
 * Calculates a recommended hiring plan to eliminate staffing gaps.
 */
export const calculateHiringPlan = (data: BasicForecastData[]): HiringRecommendation | null => {
  const futureData = data.filter(d => d.isFuture);
  if (futureData.length === 0) return null;

  // 1. Find the deepest shortage
  const maxGap = Math.min(...futureData.map(d => d.gap));
  if (maxGap >= 0) {
    return {
      summary: "Staffing levels are sufficient. Maintain current hiring for attrition only.",
      monthlyHires: 0,
      durationMonths: 0,
      totalHires: 0,
      startMonth: futureData[0].month
    };
  }

  const absoluteShortage = Math.abs(maxGap);
  const peakIdx = futureData.findIndex(d => d.gap === maxGap);
  
  // 2. WFM Logic: Hire 2 months before peak
  const leadTime = 2;
  const recommendedStartIdx = Math.max(0, peakIdx - leadTime);

  // 3. Distribution: Spread over 2-3 months
  const spreadMonths = absoluteShortage > 20 ? 3 : 2;
  const monthlyRecommendation = Math.ceil(absoluteShortage / spreadMonths);

  return {
    summary: `Hire ${Math.ceil(absoluteShortage)} agents to bridge the ${Math.abs(maxGap)} FTE deficit by ${futureData[peakIdx].month}.`,
    monthlyHires: monthlyRecommendation,
    durationMonths: spreadMonths,
    totalHires: monthlyRecommendation * spreadMonths,
    startMonth: futureData[recommendedStartIdx].month
  };
};
