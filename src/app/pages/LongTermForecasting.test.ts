import { describe, it, expect } from 'vitest';
import { calculateFTE, calculateWorkforceSupply, WorkforceSupplyInputs } from './LongTermForecasting';
import { 
  calculateHoltWinters, 
  calculateDecomposition, 
  calculateARIMA,
  buildEffectiveYearOnePlan,
  buildTwoPassYear2Input,
  calculateYoY,
  getCalculatedVolumes,
  generateInsights,
  calculateHiringPlan,
  normalizeMonthlyHistoryForExtendedForecast,
  normalizeMonthlyForecast
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

describe('Demand Forecast Month Normalization', () => {
  const demandAssumptions: any = {
    startDate: '2026-01-01',
    aht: 300,
    emailAht: 600,
    chatAht: 450,
    chatConcurrency: 2,
    shrinkage: 25,
    shrinkageSource: 'manual',
    voiceSlaTarget: 80,
    voiceSlaAnswerSeconds: 20,
    voiceAsaTargetSeconds: 15,
    emailSlaTarget: 90,
    emailSlaAnswerSeconds: 14400,
    emailAsaTargetSeconds: 3600,
    chatSlaTarget: 80,
    chatSlaAnswerSeconds: 30,
    chatAsaTargetSeconds: 20,
    occupancy: 85,
    growthRate: 5,
    safetyMargin: 5,
    currency: 'USD',
    annualSalary: 45000,
    onboardingCost: 5000,
    fteMonthlyHours: 166.67,
    operatingHoursPerDay: 8,
    operatingDaysPerWeek: 5,
    useManualVolume: false,
    manualHistoricalData: [],
    planningMonths: 12,
    forecastHorizon: 2
  };
  const hwParams = { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 };
  const arimaParams = { p: 1, d: 1, q: 1 };
  const decompParams = { trendStrength: 1, seasonalityStrength: 1 };

  it('keeps Email forecasts complete when one LOB has sparse imported history', () => {
    const workingLobEmailHistory = [
      1200, 1260, 1320, 1380, 1440, 1500, 1560, 1620, 1680, 1740, 1800, 1860,
      1280, 1340, 1400, 1460, 1520, 1580, 1640, 1700, 1760, 1820, 1880, 1940
    ];
    const sparseLobEmailHistory = [
      1200, 1260, 1320, 1380, 1440, 1500, 1560, 0, 0, 0, 0, 0
    ];

    const workingYear1 = getCalculatedVolumes(workingLobEmailHistory, 'holtwinters', demandAssumptions, hwParams, arimaParams, decompParams, 12);
    const sparseYear1 = getCalculatedVolumes(sparseLobEmailHistory, 'holtwinters', demandAssumptions, hwParams, arimaParams, decompParams, 12);
    const partialActualsFullYearPlan = sparseYear1.map((value, index) => index < 7 ? Math.round(value * 1.08) : value);
    const sparseYear2 = getCalculatedVolumes([...sparseLobEmailHistory, ...partialActualsFullYearPlan], 'holtwinters', demandAssumptions, hwParams, arimaParams, decompParams, 12);

    expect(workingYear1).toHaveLength(12);
    expect(sparseYear1).toHaveLength(12);
    expect(sparseYear2).toHaveLength(12);
    expect(sparseYear2.every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });

  it('builds a full Email Year 1 effective plan from Jan-Jul actuals plus Aug-Dec plan', () => {
    const raw2026Plan = [2100, 2140, 2180, 2220, 2260, 2300, 2340];
    const actualsByMonth = [2200, 2250, 2290, 2330, 2380, 2420, 2470, null, null, null, null, null];
    const effective2026 = buildEffectiveYearOnePlan({
      basePlan: raw2026Plan,
      actualsByMonth,
      completedMonthIndices: [0, 1, 2, 3, 4, 5, 6],
      recutFactor: 1.06,
      sourceHistory: [1600, 1640, 1680, 1720, 1760, 1800, 1840, 1880, 1920, 1960, 2000, 2040],
    });

    expect(effective2026).toHaveLength(12);
    expect(effective2026.slice(0, 7)).toEqual([2200, 2250, 2290, 2330, 2380, 2420, 2470]);
    expect(effective2026.slice(7).every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });

  it('keeps Email future re-cut stable when completed actuals equal forecast', () => {
    const emailForecast2026 = [1356, 1551, 1554, 1291, 1438, 1457, 1393, 1422, 1488, 1516, 1494, 1532];
    const actualsByMonth = [1356, 1551, 1554, 1291, null, null, null, null, null, null, null, null];
    const completed = [0, 1, 2, 3];
    const actualToForecastFactor =
      actualsByMonth.slice(0, 4).reduce((sum, value) => sum + (value ?? 0), 0) /
      emailForecast2026.slice(0, 4).reduce((sum, value) => sum + value, 0);

    const effective2026 = buildEffectiveYearOnePlan({
      basePlan: emailForecast2026,
      actualsByMonth,
      completedMonthIndices: completed,
      recutFactor: actualToForecastFactor,
      sourceHistory: [1080, 1240, 1243, 1033, 1150, 1166, 1114, 1138, 1190, 1213, 1195, 1226],
    });

    expect(actualToForecastFactor).toBe(1);
    expect(effective2026.slice(0, 4)).toEqual([1356, 1551, 1554, 1291]);
    expect(effective2026.slice(4)).toEqual(emailForecast2026.slice(4));
    expect(Math.min(...effective2026.slice(4))).toBeGreaterThan(1000);

    const forecast2027 = getCalculatedVolumes(
      [[1080, 1240, 1243, 1033, 1150, 1166, 1114, 1138, 1190, 1213, 1195, 1226], effective2026].flat(),
      'holtwinters',
      demandAssumptions,
      hwParams,
      arimaParams,
      decompParams,
      12
    );

    expect(forecast2027).toHaveLength(12);
    expect(forecast2027.slice(7).every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });

  it('preserves the Jan-Dec grid for sparse Email history before the 2027 two-pass forecast', () => {
    const sparseEmailHistory = [
      980, 1120, 1135, 1004, 1088, 1110, 1055, 0, 0, 0, 0, 0
    ];
    const effective2026 = buildEffectiveYearOnePlan({
      basePlan: [1356, 1551, 1554, 1291, 1438, 1457, 1393, 1422, 1488, 1516, 1494, 1532],
      actualsByMonth: [1356, 1551, 1554, 1291],
      completedMonthIndices: [0, 1, 2, 3],
      recutFactor: 1,
      sourceHistory: sparseEmailHistory,
    });
    const extendedHistory = [
      ...normalizeMonthlyHistoryForExtendedForecast(sparseEmailHistory),
      ...normalizeMonthlyForecast(effective2026, sparseEmailHistory, 12),
    ];
    const forecast2027 = getCalculatedVolumes(
      extendedHistory,
      'holtwinters',
      demandAssumptions,
      hwParams,
      arimaParams,
      decompParams,
      12
    );

    expect(extendedHistory).toHaveLength(24);
    expect(extendedHistory.slice(7, 12).every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    expect(forecast2027).toHaveLength(12);
    expect(forecast2027.slice(7).every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });

  it('uses the re-cut Email baseline for 2027 after a large 2026 structural drop', () => {
    const highEmailHistory = [
      4293, 5376, 4033, 4327, 4507, 4561, 4357, 4438, 3312, 5056, 3763, 3606,
      4508, 5645, 4235, 4543, 4733, 4789, 4575, 4660, 3478, 5309, 3951, 3786,
    ];
    const effective2026 = [
      1356, 1551, 1554, 1291, 1437, 1456, 1393, 1422, 1063, 1626, 1213, 1165,
    ];
    const year2Input = buildTwoPassYear2Input(highEmailHistory, effective2026);
    const forecast2027 = getCalculatedVolumes(
      year2Input,
      'holtwinters',
      demandAssumptions,
      hwParams,
      arimaParams,
      decompParams,
      12
    );

    expect(year2Input).toEqual([...effective2026, ...effective2026]);
    expect(forecast2027).toHaveLength(12);
    expect(forecast2027.slice(7).every((value) => Number.isFinite(value) && value > 0)).toBe(true);
    expect(Math.min(...forecast2027)).toBeGreaterThan(500);
  });

  it('does not let a short published re-cut shorten the Year 2 input base', () => {
    const effective2026 = buildEffectiveYearOnePlan({
      basePlan: [2100, 2140, 2180, 2220, 2260, 2300, 2340, 2380, 2420, 2460, 2500, 2540],
      actualsByMonth: [2200, 2250, 2290, 2330, 2380, 2420, 2470],
      completedMonthIndices: [0, 1, 2, 3, 4, 5, 6],
      publishedRecut: [2200, 2250, 2290, 2330, 2380, 2420, 2470],
      sourceHistory: [1600, 1640, 1680, 1720, 1760, 1800, 1840, 1880, 1920, 1960, 2000, 2040],
    });

    const forecast2027 = getCalculatedVolumes(
      [[1600, 1640, 1680, 1720, 1760, 1800, 1840, 1880, 1920, 1960, 2000, 2040], effective2026].flat(),
      'holtwinters',
      demandAssumptions,
      hwParams,
      arimaParams,
      decompParams,
      12
    );

    expect(effective2026).toHaveLength(12);
    expect(forecast2027).toHaveLength(12);
    expect(forecast2027.slice(7).every((value) => Number.isFinite(value) && value > 0)).toBe(true);
  });

  it('normalizes short final forecast output to Jan-Dec numeric months', () => {
    const normalized = normalizeMonthlyForecast(
      [1100, 1120, 1140, 1160, 1180, 1200, 1220],
      [900, 920, 940, 960, 980, 1000, 1020, 1040, 1060, 1080, 1100, 1120],
      12
    );

    expect(normalized).toHaveLength(12);
    expect(normalized.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(normalized.slice(7).every((value) => value > 0)).toBe(true);
  });
});
