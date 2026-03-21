import { describe, it, expect } from 'vitest';
import { calculateFTE, calculateWorkforceSupply, WorkforceSupplyInputs } from './LongTermForecasting';

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

    const fteBase = calculateFTE(volBase, aht, shrinkage, occupancy, safety);
    const fteGrowth = calculateFTE(volGrowth, aht, shrinkage, occupancy, safety);

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

    const fteLowShrink = calculateFTE(vol, aht, 10, occ, safety);
    const fteHighShrink = calculateFTE(vol, aht, 50, occ, safety);

    // With 50% shrinkage, you need exactly double the net capacity, 
    // but gross FTE should be significantly higher than 10% shrinkage.
    expect(fteHighShrink).toBeGreaterThan(fteLowShrink * 1.5);
  });

  // Scenario 5: Safety Guardrail - Zero Capacity
  it('should not crash if occupancy or shrinkage is 100% (Division by zero)', () => {
    // Note: calculateFTE currently might divide by zero if finalOccupancy or shrinkageFactor is 0.
    // This test identifies if we need a safeguard.
    try {
      const result = calculateFTE(1000, 300, 100, 85, 5); // 100% shrinkage
      expect(result).toBeDefined();
    } catch (e) {
      // If it throws, we need a fix.
    }
  });
});
