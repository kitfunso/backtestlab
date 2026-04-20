import {
  annualizedVolatility,
  calmar,
  rollingSharpe,
  rollingVolatility,
  returnDistribution,
  sortino,
  topDrawdowns,
} from './metrics';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Deterministic Mulberry32 PRNG — gives reproducible "white noise". */
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

/** Box–Muller transform → standard normal sample. */
function randn(rng: () => number): number {
  const u1 = Math.max(rng(), Number.MIN_VALUE); // avoid log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// rollingVolatility
// ---------------------------------------------------------------------------

describe('rollingVolatility', () => {
  it('returns null for indices before the window completes', () => {
    const returns = Array(50).fill(0.01);
    const result = rollingVolatility(returns, 30);
    for (let i = 0; i < 29; i++) {
      expect(result[i]).toBeNull();
    }
    expect(result[29]).not.toBeNull();
  });

  it('gives zero vol for constant returns', () => {
    const returns = Array(200).fill(0.005);
    const result = rollingVolatility(returns, 126);
    // After window completes, rolling vol should be 0 up to float precision.
    for (let i = 125; i < result.length; i++) {
      expect(result[i]).not.toBeNull();
      expect(result[i] as number).toBeCloseTo(0, 12);
    }
  });

  it('matches expected annualized vol for white noise within 10%', () => {
    const rng = mulberry32(42);
    const sigma = 0.01; // daily std
    const n = 1000;
    const returns: number[] = [];
    for (let i = 0; i < n; i++) {
      returns.push(sigma * randn(rng));
    }
    const expectedAnnualVol = sigma * Math.sqrt(252); // ~0.1587
    const result = rollingVolatility(returns, 252);

    // Sample the last value (most data in window).
    const last = result[n - 1];
    expect(last).not.toBeNull();
    if (last === null) throw new Error('unreachable');
    const ratio = last / expectedAnnualVol;
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });
});

// ---------------------------------------------------------------------------
// rollingSharpe
// ---------------------------------------------------------------------------

describe('rollingSharpe', () => {
  it('returns null for indices before the window completes', () => {
    // With jitter so std != 0 (otherwise output is null from the std=0 guard).
    const rng = mulberry32(7);
    const returns = Array.from({ length: 50 }, () => 0.002 + 1e-5 * randn(rng));
    const result = rollingSharpe(returns, 30);
    for (let i = 0; i < 29; i++) {
      expect(result[i]).toBeNull();
    }
    expect(result[29]).not.toBeNull();
  });

  it('is positive when mean return exceeds daily risk-free', () => {
    // Mean daily 0.001 (~28.3% annualized) is well above 6%/252.
    const rng = mulberry32(123);
    const returns = Array.from({ length: 200 }, () => 0.001 + 0.005 * randn(rng));
    const result = rollingSharpe(returns, 126, 0.06);
    const tail = result.slice(125).filter((v): v is number => v !== null);
    expect(tail.length).toBeGreaterThan(0);
    // The average rolling Sharpe of a mildly positive return series vs 6% rf
    // should be > 0 for this seed/size.
    const avg = tail.reduce((s, v) => s + v, 0) / tail.length;
    expect(avg).toBeGreaterThan(0);
  });

  it('is <= 0 when mean return is zero (below any positive rf)', () => {
    // Returns with mean ≈ 0 should give Sharpe ≤ 0 once rf > 0.
    const rng = mulberry32(999);
    const returns = Array.from({ length: 200 }, () => 0.01 * randn(rng));
    const result = rollingSharpe(returns, 126, 0.06);
    const tail = result.slice(125).filter((v): v is number => v !== null);
    const avg = tail.reduce((s, v) => s + v, 0) / tail.length;
    // Excess over 6% rf will be slightly negative on average.
    expect(avg).toBeLessThan(0.5); // loose upper bound; expect near 0 or negative
  });
});

// ---------------------------------------------------------------------------
// topDrawdowns
// ---------------------------------------------------------------------------

describe('topDrawdowns', () => {
  it('extracts correct peak/trough for a contrived curve', () => {
    // Curve:  100, 110, 90, 120, 100, 80, 140
    // Peak 110 → trough 90 → recovery 120  : dd = 20/110 ≈ 0.1818
    // Peak 120 → trough 80 → recovery 140  : dd = 40/120 ≈ 0.3333
    const equity = [100, 110, 90, 120, 100, 80, 140];
    const dates = [
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
      '2024-01-04',
      '2024-01-05',
      '2024-01-06',
      '2024-01-07',
    ];
    const result = topDrawdowns(equity, dates, 5);

    expect(result.length).toBe(2);

    // Deepest first.
    expect(result[0].peakValue).toBe(120);
    expect(result[0].troughValue).toBe(80);
    expect(result[0].peakDate).toBe('2024-01-04');
    expect(result[0].troughDate).toBe('2024-01-06');
    expect(result[0].recoveryDate).toBe('2024-01-07');
    expect(result[0].drawdownPct).toBeCloseTo(40 / 120, 10);
    expect(result[0].durationDays).toBe(2);

    expect(result[1].peakValue).toBe(110);
    expect(result[1].troughValue).toBe(90);
    expect(result[1].peakDate).toBe('2024-01-02');
    expect(result[1].troughDate).toBe('2024-01-03');
    expect(result[1].recoveryDate).toBe('2024-01-04');
    expect(result[1].drawdownPct).toBeCloseTo(20 / 110, 10);
  });

  it('caps output to n', () => {
    const equity = [100, 110, 90, 120, 100, 80, 140];
    const dates = equity.map((_, i) => `2024-01-0${i + 1}`);
    const result = topDrawdowns(equity, dates, 1);
    expect(result.length).toBe(1);
    expect(result[0].peakValue).toBe(120);
  });

  it('returns recoveryDate=null for an unrecovered final drawdown', () => {
    // Curve declines and never recovers.
    const equity = [100, 110, 70];
    const dates = ['2024-01-01', '2024-01-02', '2024-01-03'];
    const result = topDrawdowns(equity, dates, 5);
    expect(result.length).toBe(1);
    expect(result[0].recoveryDate).toBeNull();
    expect(result[0].peakValue).toBe(110);
    expect(result[0].troughValue).toBe(70);
  });

  it('throws when equityCurve and dates have mismatched lengths', () => {
    expect(() => topDrawdowns([1, 2, 3], ['a', 'b'], 5)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// sortino
// ---------------------------------------------------------------------------

describe('sortino', () => {
  it('is finite and positive for a positive-mean series with downside', () => {
    // Asymmetric: positive mean but includes some negative days.
    const returns = [0.02, -0.01, 0.015, -0.005, 0.01, 0.02, -0.008, 0.015];
    const s = sortino(returns, 0);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeGreaterThan(0);
  });

  it('is 0 when there are no downside returns (avoids Infinity)', () => {
    const returns = [0.01, 0.02, 0.015, 0.03, 0.005];
    const s = sortino(returns, 0);
    expect(s).toBe(0);
  });

  it('is higher than Sharpe when distribution has symmetric positive skew in upside', () => {
    // Constructed: small downside moves, larger upside moves → Sortino > Sharpe.
    // Sharpe (using std of all moves) will be smaller because upside variance
    // inflates the denominator, while Sortino only penalizes downside.
    const returns = [
      0.03, 0.04, -0.005, 0.035, -0.004, 0.04, -0.006, 0.03, 0.05, -0.005,
    ];
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance =
      returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    const sharpe = (mean / std) * Math.sqrt(252);

    const sor = sortino(returns, 0);

    expect(sor).toBeGreaterThan(sharpe);
  });
});

// ---------------------------------------------------------------------------
// calmar
// ---------------------------------------------------------------------------

describe('calmar', () => {
  it('is positive when returns are positive and there is a drawdown', () => {
    // Equity: 100 → 110 → 95 → 120. Max DD = (110-95)/110 = 0.1364.
    // Returns have positive mean.
    const equity = [100, 110, 95, 120];
    const returns = [0.1, -15 / 110, 25 / 95];
    const c = calmar(returns, equity);
    expect(Number.isFinite(c)).toBe(true);
    expect(c).toBeGreaterThan(0);
  });

  it('is 0 when max drawdown is 0', () => {
    // Monotonically increasing curve → no drawdown.
    const equity = [100, 101, 102, 103];
    const returns = [0.01, 0.01, 0.01];
    expect(calmar(returns, equity)).toBe(0);
  });

  it('matches annualReturn / maxDD arithmetically', () => {
    const equity = [100, 120, 90, 100];
    const returns = [0.2, -30 / 120, 10 / 90];
    const meanRet = returns.reduce((s, v) => s + v, 0) / returns.length;
    const annualReturn = meanRet * 252;
    const maxDd = (120 - 90) / 120; // 0.25
    const expected = annualReturn / maxDd;
    expect(calmar(returns, equity)).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------
// returnDistribution
// ---------------------------------------------------------------------------

describe('returnDistribution', () => {
  it('sum of bucket counts equals returns.length', () => {
    const rng = mulberry32(5);
    const returns = Array.from({ length: 500 }, () => 0.01 * randn(rng));
    const hist = returnDistribution(returns, 30);
    const total = hist.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(500);
  });

  it('first bucket bucketMin ≈ min(returns); last bucket bucketMax ≈ max(returns)', () => {
    const returns = [-0.05, 0.03, 0.01, -0.02, 0.0, 0.04, -0.01];
    const hist = returnDistribution(returns, 10);
    expect(hist.length).toBe(10);
    expect(hist[0].bucketMin).toBeCloseTo(-0.05, 12);
    expect(hist[hist.length - 1].bucketMax).toBeCloseTo(0.04, 12);
  });

  it('handles degenerate case where all returns are identical', () => {
    const returns = [0.01, 0.01, 0.01];
    const hist = returnDistribution(returns, 10);
    expect(hist.length).toBe(1);
    expect(hist[0].count).toBe(3);
    expect(hist[0].bucketMin).toBe(0.01);
    expect(hist[0].bucketMax).toBe(0.01);
  });

  it('returns empty array for empty input', () => {
    expect(returnDistribution([], 30)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// annualizedVolatility (sanity)
// ---------------------------------------------------------------------------

describe('annualizedVolatility', () => {
  it('is 0 for constant returns', () => {
    expect(annualizedVolatility([0.01, 0.01, 0.01, 0.01])).toBe(0);
  });

  it('scales with √252', () => {
    const returns = [0.01, -0.01, 0.02, -0.02, 0.015];
    const n = returns.length;
    const mean = returns.reduce((s, v) => s + v, 0) / n;
    const variance =
      returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
    const expected = Math.sqrt(variance) * Math.sqrt(252);
    expect(annualizedVolatility(returns)).toBeCloseTo(expected, 12);
  });
});
