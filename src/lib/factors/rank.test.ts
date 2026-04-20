import { crossSectionalZScore } from './rank';

describe('crossSectionalZScore', () => {
  it('returns an empty object for empty input', () => {
    expect(crossSectionalZScore({})).toEqual({});
  });

  it('maps every ticker to 0 when all values are null', () => {
    const z = crossSectionalZScore({ A: null, B: null, C: null });
    expect(z).toEqual({ A: 0, B: 0, C: 0 });
  });

  it('assigns z = 0 to null tickers while scoring the rest', () => {
    const z = crossSectionalZScore({ A: -1, B: 0, C: 1, D: null });
    expect(z.D).toBe(0);
    // A < 0 < C, B = 0 should map to ~0.
    expect(z.A).toBeLessThan(0);
    expect(z.C).toBeGreaterThan(0);
    expect(z.B).toBeCloseTo(0, 12);
  });

  it('maps every ticker to 0 when the cross-section is constant', () => {
    const z = crossSectionalZScore({ A: 5, B: 5, C: 5 });
    expect(z).toEqual({ A: 0, B: 0, C: 0 });
  });

  it('is centered and scaled (mean 0, sigma 1) for a uniform spread', () => {
    // Symmetric 11-point sample in [-5, 5] -> after winsorization no change
    // (max |x| = 5 < 3 * sigma_raw), z-scores should have sample mean 0.
    const values: Record<string, number | null> = {};
    for (let i = -5; i <= 5; i++) values[`T${i + 5}`] = i;
    const z = crossSectionalZScore(values);
    const zs = Object.values(z);
    const sum = zs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 10);
    // Extreme values should land near +/- 1.73 (sqrt(3)) for this distribution,
    // well inside the uniform bound mentioned in the plan (~1.7).
    expect(Math.max(...zs)).toBeLessThan(1.9);
    expect(Math.min(...zs)).toBeGreaterThan(-1.9);
  });

  it('winsorizes outliers to +/- 3 sigma before z-scoring', () => {
    // Nine zeros + one extreme outlier (1000). raw mean ~100, raw sigma ~300.
    // After winsorization the outlier should land at mu + 3*sigma, and its
    // final z-score must be at or below 3.
    const values: Record<string, number | null> = {};
    for (let i = 0; i < 9; i++) values[`T${i}`] = 0;
    values.OUT = 1000;
    const z = crossSectionalZScore(values);
    // The outlier's z-score is clipped: must not exceed 3 (within float eps).
    expect(z.OUT).toBeLessThanOrEqual(3 + 1e-9);
    // And it's still the largest of the group.
    expect(z.OUT).toBeGreaterThan(z.T0);
  });

  it('preserves ordering of the original raw values', () => {
    const z = crossSectionalZScore({ A: 10, B: 20, C: 15, D: 5 });
    expect(z.D).toBeLessThan(z.A);
    expect(z.A).toBeLessThan(z.C);
    expect(z.C).toBeLessThan(z.B);
  });

  it('treats NaN and Infinity as null (assigns z = 0)', () => {
    const z = crossSectionalZScore({
      A: 1,
      B: 2,
      C: 3,
      BAD1: Number.NaN,
      BAD2: Number.POSITIVE_INFINITY,
    });
    expect(z.BAD1).toBe(0);
    expect(z.BAD2).toBe(0);
    expect(z.A).toBeLessThan(z.C);
  });
});
