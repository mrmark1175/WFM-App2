/**
 * Applies a year-over-year growth rate to a historical data series.
 * @param historicalData - An array of 12 numbers representing last year's monthly volumes.
 * @param growthRate - The percentage growth rate to apply (e.g., 5 for 5%).
 * @returns A new array of 12 numbers representing the forecasted monthly volumes.
 */
export const calculateYoY = (historicalData: number[], growthRate: number): number[] => {
  const growthMultiplier = 1 + growthRate / 100;
  return historicalData.map(volume => Math.round(volume * growthMultiplier));
};

/**
 * Moving Average: Rolling average (last N months).
 * Projects a flat line based on the average of the most recent N periods.
 */
export const calculateMovingAverage = (historicalData: number[], periods: number = 3): number[] => {
  if (historicalData.length === 0) return Array(12).fill(0);
  
  const recentData = historicalData.slice(-Math.min(periods, historicalData.length));
  const avg = recentData.reduce((a, b) => a + b, 0) / recentData.length;
  
  return Array(12).fill(Math.round(avg));
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
  seasonLength: number = 12
): number[] => {
  if (data.length < seasonLength * 2) {
    // Fallback to YoY if not enough data for real HW
    const last12 = data.slice(-12);
    const results = calculateYoY(last12, 3);
    
    if (results.length === 12) return results;
    
    // If input was even shorter than 12, pad it to 12
    const baseValue = results[results.length - 1] || (data[data.length - 1] * 1.03) || 0;
    const padding = Array(12 - results.length).fill(Math.round(baseValue));
    return [...results, ...padding];
  }

  const forecastLength = 12;
  const seasons = Math.floor(data.length / seasonLength);
  
  let level = data.slice(0, seasonLength).reduce((a, b) => a + b, 0) / seasonLength;
  let trend = (data.slice(seasonLength, 2 * seasonLength).reduce((a, b) => a + b, 0) - 
                data.slice(0, seasonLength).reduce((a, b) => a + b, 0)) / (seasonLength * seasonLength);

  let seasonal: number[] = [];
  for (let i = 0; i < seasonLength; i++) {
    let sumOverSeasons = 0;
    for (let j = 0; j < seasons; j++) {
      sumOverSeasons += data[j * seasonLength + i];
    }
    seasonal.push(sumOverSeasons / seasons / level);
  }

  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    const lastLevel = level;
    const lastTrend = trend;
    const lastSeasonal = seasonal[i % seasonLength];

    level = alpha * (value / lastSeasonal) + (1 - alpha) * (lastLevel + lastTrend);
    trend = beta * (level - lastLevel) + (1 - beta) * lastTrend;
    seasonal[i % seasonLength] = gamma * (value / level) + (1 - gamma) * lastSeasonal;
  }

  return Array.from({ length: forecastLength }, (_, i) => {
    const m = i + 1;
    return Math.round((level + m * trend) * seasonal[i % seasonLength]);
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
      seasonalIndices[monthIdx] += historicalData[i] / trend[i];
      counts[monthIdx]++;
    }
  }

  for (let i = 0; i < 12; i++) {
    if (counts[i] > 0) {
      let baseIndex = seasonalIndices[i] / counts[i];
      seasonalIndices[i] = 1.0 + (baseIndex - 1.0) * seasonalityStrength;
    } else {
      // Fallback for missing data
      seasonalIndices[i] = 1.0;
    }
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
 * ARIMA (SIMPLIFIED): Basic differencing + autoregression.
 * Focuses on momentum and persistence without complex noise modeling.
 */
export const calculateARIMA = (
  historicalData: number[],
  p: number = 1, // Autoregressive terms (momentum)
  d: number = 1, // Differencing (1 = look at growth, 2 = look at acceleration)
  q: number = 1  // MA window (smoothing)
): number[] => {
  if (historicalData.length < 2) return Array(12).fill(0);
  
  // Apply differencing (d)
  let diffSeries = [...historicalData];
  for (let i = 0; i < d; i++) {
    const nextDiff = [];
    for (let j = 1; j < diffSeries.length; j++) {
      nextDiff.push(diffSeries[j] - diffSeries[j-1]);
    }
    diffSeries = nextDiff;
  }

  // Basic Autoregression (p): Predict next difference based on average of last 'p' differences
  const lastPDiffs = diffSeries.slice(-p);
  const avgDiff = lastPDiffs.reduce((a, b) => a + b, 0) / lastPDiffs.length;

  // Moving Average Smoothing (q): Scale the difference projection
  const qFactor = Math.min(1, 1 / q);

  const forecast: number[] = [];
  let currentLastValue = historicalData[historicalData.length - 1];
  let currentLastDiff = avgDiff;

  for (let i = 0; i < 12; i++) {
    // Project the difference forward, applying q-based smoothing to the growth
    const nextValue = currentLastValue + (currentLastDiff * qFactor);
    forecast.push(Math.round(nextValue));
    
    // Update for next iteration (simplified persistence)
    currentLastValue = nextValue;
  }

  return forecast;
};

export interface BasicForecastData {
  month: string;
  year: string;
  isFuture: boolean;
  volume: number;
  requiredFTE: number;
  availableFTE: number;
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
