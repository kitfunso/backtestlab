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
    expect(z.A).toBeLessThan(0);
    expect(z.C).toBeGreaterThan(0);
    expect(z.B).toBeCloseTo(0, 12);
  });

  it('maps every ticker to 0 when the cross-section is constant', () => {
    const z = crossSectionalZScore({ A: 5, B: 5, C: 5 });
    expect(z).toEqual({ A: 0, B: 0, C: 0 });
  });

  it('is centered and scaled (mean 0, sigma 1) for a uniform spread', () => {
    const values: Record<string, number | null> = {};
    for (let i = -5; i <= 5; i++) values[`T${i + 5}`] = i;
    const z = crossSectionalZScore(values);
    const zs = Object.values(z);
    const sum = zs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 10);
    expect(Math.max(...zs)).toBeLessThan(1.9);
    expect(Math.min(...zs)).toBeGreaterThan(-1.9);
  });

  it('winsorizes outliers to +/- 3 sigma before z-scoring', () => {
    const values: Record<string, number | null> = {};
    for (let i = 0; i < 9; i++) values[`T${i}`] = 0;
    values.OUT = 1000;
    const z = crossSectionalZScore(values);
    expect(z.OUT).toBeLessThanOrEqual(3 + 1e-9);
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
