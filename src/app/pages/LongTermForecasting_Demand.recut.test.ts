import { describe, it, expect } from 'vitest';
import {
  buildDemandForecastTrendSeries,
  buildDemandRecutPlan,
  buildDemandSnapshotRecutSeries,
  buildForecastCalendarMonths,
  buildTwoPassYear2Input,
  getCalculatedVolumes,
  normalizeForecastInput,
  normalizeManualMonthlyOverrides,
  normalizeMonthlyForecast,
  normalizeMonthlyHistoryForExtendedForecast,
} from './forecasting-logic';

const baseYear1 = [
  1000, 1100, 1200, 1300,
  1400, 1500, 1600, 1700,
  1800, 1900, 2000, 2100,
];

const sourceHistory = [
  800, 880, 960, 1040,
  1120, 1200, 1280, 1360,
  1440, 1520, 1600, 1680,
  900, 990, 1080, 1170,
  1260, 1350, 1440, 1530,
  1620, 1710, 1800, 1890,
];

const assumptions: any = {
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
  growthRate: 0,
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
  forecastHorizon: 2,
};

const hwParams = { alpha: 0.3, beta: 0.1, gamma: 0.3, seasonLength: 12 };
const arimaParams = { p: 1, d: 1, q: 1 };
const decompParams = { trendStrength: 1, seasonalityStrength: 1 };

describe('Long Term Forecasting Demand recut contracts', () => {
  it('uses Jan-Apr actuals and keeps May-Dec as re-cut forecast values', () => {
    const recut = buildDemandRecutPlan({
      basePlan: baseYear1,
      actualsByMonth: [1100, 1210, 1320, 1430, null, null, null, null, null, null, null, null],
      completedMonthIndices: [0, 1, 2, 3],
      sourceHistory,
    });

    expect(recut.year1).toHaveLength(12);
    expect(recut.year1.slice(0, 4)).toEqual([1100, 1210, 1320, 1430]);
    expect(recut.year1.slice(4)).toEqual([1540, 1650, 1760, 1870, 1980, 2090, 2200, 2310]);
    expect(recut.recutFactor).toBeCloseTo(1.1, 6);
    expect(recut.missingCompletedMonthIndices).toEqual([]);
  });

  it('flags missing completed actual months instead of silently re-cutting from a partial subset', () => {
    const recut = buildDemandRecutPlan({
      basePlan: baseYear1,
      actualsByMonth: [1100, null, null, null, null, null, null, null, null, null, null, null],
      completedMonthIndices: [0, 1, 2, 3],
      sourceHistory,
    });

    expect(recut.canApplyRecut).toBe(false);
    expect(recut.recutFactor).toBeNull();
    expect(recut.missingCompletedMonthIndices).toEqual([1, 2, 3]);
    expect(recut.warnings).toContain('Missing completed actual months prevent a safe automatic re-cut.');
    expect(recut.year1.slice(4)).toEqual(baseYear1.slice(4));
  });

  it('treats an explicit zero actual consistently as a valid recorded actual', () => {
    const recut = buildDemandRecutPlan({
      basePlan: baseYear1,
      actualsByMonth: [0, 1210, 1320, 1430, null, null, null, null, null, null, null, null],
      completedMonthIndices: [0, 1, 2, 3],
      sourceHistory,
    });

    expect(recut.canApplyRecut).toBe(true);
    expect(recut.missingCompletedMonthIndices).toEqual([]);
    expect(recut.year1[0]).toBe(0);
    expect(recut.recutFactor).toBeCloseTo((0 + 1210 + 1320 + 1430) / (1000 + 1100 + 1200 + 1300), 6);
  });

  it('keeps Year 1 and Year 2 on aligned twelve-month Jan-Dec outputs', () => {
    const recut = buildDemandRecutPlan({
      basePlan: baseYear1,
      actualsByMonth: [1100, 1210, 1320, 1430, null, null, null, null, null, null, null, null],
      completedMonthIndices: [0, 1, 2, 3],
      sourceHistory,
    });
    const extendedHistory = buildTwoPassYear2Input(
      normalizeMonthlyHistoryForExtendedForecast(sourceHistory),
      normalizeMonthlyForecast(recut.year1, sourceHistory, 12)
    );
    const year2 = normalizeMonthlyForecast(
      getCalculatedVolumes(extendedHistory, 'holtwinters', assumptions, hwParams, arimaParams, decompParams, 12),
      extendedHistory,
      12
    );

    expect(recut.year1).toHaveLength(12);
    expect(year2).toHaveLength(12);
    expect(buildForecastCalendarMonths('2026-01-01', 12).map((month) => month.monthLabel)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
    expect(buildForecastCalendarMonths('2027-01-01', 12).map((month) => month.monthLabel)).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);
  });

  it('does not label a non-January forecast start as a Jan-Dec grid', () => {
    const labels = buildForecastCalendarMonths('2026-03-01', 12).map((month) => `${month.monthLabel} ${month.year}`);

    expect(labels).toEqual([
      'Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026',
      'Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026',
      'Nov 2026', 'Dec 2026', 'Jan 2027', 'Feb 2027',
    ]);
    expect(labels[0]).not.toBe('Jan 2026');
  });

  it('uses the final re-cut values for the one-year graph series instead of stale base forecast values', () => {
    const recut = buildDemandRecutPlan({
      basePlan: baseYear1,
      actualsByMonth: [1100, 1210, 1320, 1430, null, null, null, null, null, null, null, null],
      completedMonthIndices: [0, 1, 2, 3],
      sourceHistory,
    });
    const chartSeries = buildDemandForecastTrendSeries({
      baseYear1,
      finalYear1: recut.year1,
      forecastHorizon: 1,
    });

    expect(chartSeries).toEqual(recut.year1);
    expect(chartSeries).not.toEqual(baseYear1);
  });

  it('publishes the same final re-cut series that the page displays to downstream consumers', () => {
    const recut = buildDemandRecutPlan({
      basePlan: baseYear1,
      actualsByMonth: [1100, 1210, 1320, 1430, null, null, null, null, null, null, null, null],
      completedMonthIndices: [0, 1, 2, 3],
      sourceHistory,
    });
    const year2 = baseYear1.map((value) => value + 1000);
    const displayed = [...recut.year1, ...year2];
    const published = buildDemandSnapshotRecutSeries({
      finalYear1: recut.year1,
      year2,
      forecastHorizon: 2,
    });

    expect(published).toEqual(displayed);
    expect(published).toHaveLength(24);
  });

  it('preserves blank manual override months instead of collapsing later months left', () => {
    const overrides = normalizeManualMonthlyOverrides([
      1000, 1100, null, 1300, undefined, 1500,
    ]);

    expect(overrides).toHaveLength(12);
    expect(overrides.slice(0, 6)).toEqual([1000, 1100, null, 1300, null, 1500]);
    expect(overrides[5]).toBe(1500);
  });

  it('does not treat internal placeholder zeros as real demand in model input', () => {
    const normalized = normalizeForecastInput([1000, 1100, 0, 1300, 1400]);

    expect(normalized).toEqual([1000, 1100, 1300, 1400]);
  });

  it('continues to trim trailing placeholder zeros from historical model input', () => {
    const normalized = normalizeForecastInput([1000, 1100, 1200, 0, 0]);

    expect(normalized).toEqual([1000, 1100, 1200]);
  });

  it('can preserve zero values when the input is explicitly recorded actual demand', () => {
    const normalized = normalizeForecastInput([1000, 0, 1200, 0], { zeroValueMode: 'actual' });

    expect(normalized).toEqual([1000, 0, 1200, 0]);
  });

  it('passes explicit actual zero mode through the shared forecast dispatcher', () => {
    const forecast = getCalculatedVolumes(
      [1000, 0, 1200, 0],
      'genesys',
      assumptions,
      hwParams,
      arimaParams,
      decompParams,
      4,
      { zeroValueMode: 'actual' }
    );

    expect(forecast).toEqual([1000, 0, 1200, 0]);
  });
});
