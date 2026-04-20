import {
  correlationMatrix,
  diversificationRatio,
} from './diversification';

// ---------------------------------------------------------------------------
// Deterministic PRNG for building uncorrelated series.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng: () => number): number {
  const u1 = Math.max(rng(), Number.MIN_VALUE);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// diversificationRatio
// ---------------------------------------------------------------------------

describe('diversificationRatio', () => {
  it('returns 1 for two perfectly correlated (identical) series', () => {
    const a = [0.01, -0.02, 0.015, 0.005, -0.01, 0.02, 0.0, -0.005];
    const matrix = [a, a]; // identical → correlation 1
    const dr = diversificationRatio(matrix, [0.5, 0.5]);
    expect(dr).toBeCloseTo(1, 6);
  });

  it('returns ≈ √2 for two uncorrelated equal-weight series', () => {
    const rngA = mulberry32(11);
    const rngB = mulberry32(9973); // independent seed
    const n = 2000;
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      a.push(randn(rngA));
      b.push(randn(rngB));
    }
    const dr = diversificationRatio([a, b], [0.5, 0.5]);
    // True value is √2 ≈ 1.4142. Finite sample drift → allow 5% tolerance.
    expect(dr).toBeGreaterThan(Math.sqrt(2) * 0.95);
    expect(dr).toBeLessThan(Math.sqrt(2) * 1.05);
  });

  it('throws when weights do not sum to 1', () => {
    const a = [0.01, 0.02, -0.01, 0.015];
    const b = [0.005, -0.01, 0.02, 0.0];
    expect(() => diversificationRatio([a, b], [0.25, 0.25])).toThrow(
      /weights sum/i,
    );
  });

  it('throws when weights length does not match number of assets', () => {
    const a = [0.01, 0.02, 0.0];
    const b = [0.0, -0.01, 0.01];
    expect(() => diversificationRatio([a, b], [1.0])).toThrow(/weights length/i);
  });

  it('throws when matrix rows have differing lengths', () => {
    const a = [0.01, 0.02, 0.0];
    const b = [0.0, -0.01];
    expect(() => diversificationRatio([a, b], [0.5, 0.5])).toThrow(/row/);
  });
});

// ---------------------------------------------------------------------------
// correlationMatrix
// ---------------------------------------------------------------------------

describe('correlationMatrix', () => {
  it('has 1s on the diagonal for non-constant series', () => {
    const a = [0.01, -0.01, 0.02, 0.0];
    const b = [0.0, 0.005, -0.01, 0.015];
    const m = correlationMatrix([a, b]);
    expect(m[0][0]).toBeCloseTo(1, 10);
    expect(m[1][1]).toBeCloseTo(1, 10);
  });

  it('is symmetric', () => {
    const a = [0.01, -0.01, 0.02, 0.0, 0.005];
    const b = [0.0, 0.005, -0.01, 0.015, -0.002];
    const m = correlationMatrix([a, b]);
    expect(m[0][1]).toBeCloseTo(m[1][0], 10);
  });

  it('gives correlation ≈ 1 for identical series', () => {
    const a = [0.01, -0.01, 0.02, 0.0, 0.005];
    const m = correlationMatrix([a, a]);
    expect(m[0][1]).toBeCloseTo(1, 10);
  });
});
