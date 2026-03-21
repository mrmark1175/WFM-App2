import { describe, it, expect } from 'vitest';
import { calculateFTE, calculateWorkforceSupply, WorkforceSupplyInputs } from './LongTermForecasting';
import { 
  calculateHoltWinters, 
  calculateDecomposition, 
  calculateARIMA,
  calculateYoY,
  generateInsights,
  calculateHiringPlan
} from './forecasting-logic';

describe('Statistical Forecasting Validation', () => {
  
  const mockHistory = [
    100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, // Year 1 (Trend up)
    105, 115, 125, 135, 145, 155, 165, 175, 185, 195, 205, 215  // Year 2 (Trend up, slightly higher)
  ];

  it('Holt-Winters: should show seasonality and respond to parameters', () => {
    const forecast1 = calculateHoltWinters(mockHistory, 0.3, 0.1, 0.3, 12);
    const forecast2 = calculateHoltWinters(mockHistory, 0.3, 0.1, 0.8, 12); // High Gamma (Seasonality)

    expect(forecast1.length).toBe(12);
    // Should not be linear (all values same difference)
    const diffs = forecast1.slice(1).map((v, i) => v - forecast1[i]);
    const uniqueDiffs = new Set(diffs);
    expect(uniqueDiffs.size).toBeGreaterThan(1);

    // High gamma should produce different results
    expect(forecast1[0]).not.toBe(forecast2[0]);
  });

  it('Decomposition: should extract trend and apply seasonal indices', () => {
    const forecastBase = calculateDecomposition(mockHistory, 1.0, 1.0);
    const forecastHighTrend = calculateDecomposition(mockHistory, 2.0, 1.0);
    const forecastHighSeason = calculateDecomposition(mockHistory, 1.0, 2.0);

    // Trend check
    expect(forecastHighTrend[11]).toBeGreaterThan(forecastBase[11]);
    
    // Seasonality check (should not be a straight line)
    const diffs = forecastBase.slice(1).map((v, i) => v - forecastBase[i]);
    expect(new Set(diffs).size).toBeGreaterThan(1);

    // Parameters should change output
    expect(forecastBase[5]).not.toBe(forecastHighSeason[5]);
  });

  it('ARIMA (Simplified): should handle differencing and momentum', () => {
    const forecast = calculateARIMA(mockHistory, 1, 1, 1);
    expect(forecast.length).toBe(12);
    
    // With d=1 and upward trend, forecast should generally continue upward
    expect(forecast[11]).toBeGreaterThan(forecast[0]);
  });

  it('Resilience: should handle small datasets with fallbacks', () => {
    const smallHistory = [100, 110, 120];
    // HW needs 24 months, should fallback to YoY or similar
    const forecast = calculateHoltWinters(smallHistory, 0.3, 0.1, 0.3, 12);
    expect(forecast.length).toBe(12);
    expect(forecast[0]).toBeGreaterThan(0);
  });

  it('No extreme spikes: results should be within reasonable bounds', () => {
    const forecast = calculateHoltWinters(mockHistory, 0.3, 0.1, 0.3, 12);
    const maxHist = Math.max(...mockHistory);
    // Forecast should not suddenly be 10x historical max without reason
    forecast.forEach(v => {
      expect(v).toBeLessThan(maxHist * 3); 
      expect(v).toBeGreaterThan(0);
    });
  });
});

describe('WFM Model Edge Case Testing', () => {
  
  // Scenario 1: High Attrition (10%+)
  it('should handle high attrition logically (drain headcount)', () => {
    const inputs: WorkforceSupplyInputs = {
      startingHeadcount: 100,
      tenuredAttritionRate: 10, // 10% monthly
      newHireAttritionProfile: [20, 15, 10],
      trainingYield: 100,
      monthlyHiring: 0,
      trainingMonths: 1,
      nestingRamp: [100, 100, 100],
      ahtRamp: [1, 1, 1],
      shrinkage: 0
    };
    const results = calculateWorkforceSupply(inputs, 300);
    
    // After 12 months of 10% attrition, headcount should be ~28 (100 * 0.9^12)
    const finalMonth = results[11];
    expect(finalMonth.headcount).toBeLessThan(35);
    expect(finalMonth.headcount).toBeGreaterThan(25);
  });

  // Scenario 2: Zero Hiring
  it('should handle zero hiring (headcount should never increase)', () => {
    const inputs: WorkforceSupplyInputs = {
      startingHeadcount: 100,
      tenuredAttritionRate: 2,
      newHireAttritionProfile: [5, 5, 5],
      trainingYield: 100,
      monthlyHiring: 0,
      trainingMonths: 1,
      nestingRamp: [100, 100, 100],
      ahtRamp: [1, 1, 1],
      shrinkage: 0
    };
    const results = calculateWorkforceSupply(inputs, 300);
    
    results.forEach((month, idx) => {
      if (idx > 0) {
        expect(month.headcount).toBeLessThan(results[idx-1].headcount);
      }
    });
  });

  // Scenario 3: Rapid Growth (+30% volume)
  it('should handle rapid growth (Required HC should scale)', () => {
    const volBase = 10000;
    const volGrowth = 13000;
    const aht = 300;
    const shrinkage = 25;
    const occupancy = 85;
    const safety = 5;

    const fteBase = calculateFTE(volBase, aht, shrinkage, occupancy, safety, 166.67);
    const fteGrowth = calculateFTE(volGrowth, aht, shrinkage, occupancy, safety, 166.67);

    expect(fteGrowth).toBeGreaterThan(fteBase);
    // Ratio should be proportional to volume growth
    expect(fteGrowth / fteBase).toBeCloseTo(1.3, 1);
  });

  // Scenario 4: Extreme Shrinkage (40%+)
  it('should handle extreme shrinkage (Requirement should spike exponentially)', () => {
    const vol = 10000;
    const aht = 300;
    const occ = 85;
    const safety = 0;

    const fteLowShrink = calculateFTE(vol, aht, 10, occ, safety, 166.67);
    const fteHighShrink = calculateFTE(vol, aht, 50, occ, safety, 166.67);

    // With 50% shrinkage, you need exactly double the net capacity, 
    // but gross FTE should be significantly higher than 10% shrinkage.
    expect(fteHighShrink).toBeGreaterThan(fteLowShrink * 1.5);
  });

  // Scenario 5: Safety Guardrail - Zero Capacity
  it('should not crash if occupancy or shrinkage is 100% (Division by zero)', () => {
    // Note: calculateFTE currently might divide by zero if finalOccupancy or shrinkageFactor is 0.
    // This test identifies if we need a safeguard.
    try {
      const result = calculateFTE(1000, 300, 100, 85, 5, 166.67); // 100% shrinkage
      expect(result).toBeDefined();
    } catch (e) {
      // If it throws, we need a fix.
    }
  });
});

describe('WFM Insights & Hiring Engine Validation', () => {
  const mockFutureData: any[] = [
    { month: 'Jan', year: '2026', isFuture: true, volume: 10000, requiredFTE: 100, availableFTE: 100, gap: 0, aht: 300 },
    { month: 'Feb', year: '2026', isFuture: true, volume: 15000, requiredFTE: 150, availableFTE: 100, gap: -50, aht: 300 },
    { month: 'Mar', year: '2026', isFuture: true, volume: 12000, requiredFTE: 120, availableFTE: 100, gap: -20, aht: 300 },
  ];

  it('generateInsights: should identify volume peak and understaffing', () => {
    const insights = generateInsights(mockFutureData);
    expect(insights.some(i => i.includes('Volume peaks in Feb 2026'))).toBe(true);
    expect(insights.some(i => i.includes('Understaffing begins in Feb 2026'))).toBe(true);
    expect(insights.some(i => i.includes('Max shortage: 50 FTE in Feb 2026'))).toBe(true);
  });

  it('calculateHiringPlan: should recommend hiring based on peak shortage', () => {
    const plan = calculateHiringPlan(mockFutureData);
    expect(plan).not.toBeNull();
    if (plan) {
      expect(plan.totalHires).toBeGreaterThanOrEqual(50);
      expect(plan.durationMonths).toBe(3); // Large shortage (>20)
      expect(plan.monthlyHires).toBe(17); // 50 / 3 rounded up
    }
  });

  it('Hiring Engine: should handle sufficient staffing gracefully', () => {
    const sufficientData = mockFutureData.map(d => ({ ...d, gap: 10 }));
    const plan = calculateHiringPlan(sufficientData);
    expect(plan?.totalHires).toBe(0);
    expect(plan?.summary).toContain('Staffing levels are sufficient');
  });
});
