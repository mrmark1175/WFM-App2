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
 * Placeholder for a simple linear regression forecast.
 * @param historicalData - An array of numbers representing historical volumes.
 * @returns A new array of 12 numbers representing the forecasted monthly volumes.
 */
export const calculateLinearRegression = (historicalData: number[]): number[] => {
  const n = historicalData.length;
  if (n === 0) return Array(12).fill(0);
  const lastValue = historicalData[n - 1] || 0;
  return Array(12).fill(null).map(() => Math.round(lastValue * 1.02));
};

/**
 * Placeholder for Holt-Winters (Triple Exponential Smoothing).
 * @param historicalData - An array of numbers representing historical volumes.
 * @returns A new array of 12 numbers representing the forecasted monthly volumes.
 */
export const calculateHoltWinters = (historicalData: number[]): number[] => {
  console.log("Placeholder: Holt-Winters calculation");
  return historicalData.map(v => Math.round(v * 1.05)); // Placeholder: 5% growth
};

/**
 * Placeholder for a simplified ARIMA model.
 * @param historicalData - An array of numbers representing historical volumes.
 * @returns A new array of 12 numbers representing the forecasted monthly volumes.
 */
export const calculateARIMA = (historicalData: number[]): number[] => {
  console.log("Placeholder: ARIMA calculation");
  return historicalData.map(v => Math.round(v * 1.03)); // Placeholder: 3% growth
};

/**
 * Placeholder for Decomposition (Trend + Seasonality).
 * @param historicalData - An array of numbers representing historical volumes.
 * @returns A new array of 12 numbers representing the forecasted monthly volumes.
 */
export const calculateDecomposition = (historicalData: number[]): number[] => {
  console.log("Placeholder: Decomposition calculation");
  // Simple seasonality from the first 12 months
  const seasonalFactors = historicalData.slice(0, 12).map((v, i, arr) => v / (arr.reduce((a, b) => a + b, 0) / 12));
  return seasonalFactors.map(factor => Math.round((historicalData.reduce((a,b) => a+b, 0) / historicalData.length) * factor));
};

/**
 * Placeholder for Moving Average.
 * @param historicalData - An array of numbers representing historical volumes.
 * @returns A new array of 12 numbers representing the forecasted monthly volumes.
 */
export const calculateMovingAverage = (historicalData: number[]): number[] => {
  console.log("Placeholder: Moving Average calculation");
  if (historicalData.length === 0) return Array(12).fill(0);
  const avg = historicalData.reduce((a, b) => a + b, 0) / historicalData.length;
  return Array(12).fill(Math.round(avg));
};
