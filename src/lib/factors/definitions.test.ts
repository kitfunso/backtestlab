import {
  dispersion,
  downsideBeta,
  momentum12_1,
  momentum6_1,
  shortReversal,
  volatility,
} from './definitions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic Mulberry32 PRNG. */
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

/** Box-Muller transform -> standard normal. */
function randn(rng: () => number): number {
  const u1 = Math.max(rng(), Number.MIN_VALUE);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Build a close series of length n at constant price p. */
function constantSeries(n: number, p: number): number[] {
  return new Array(n).fill(p);
}

/** Build a monotonically compounding close series of length n at daily rate r. */
function compoundSeries(n: number, start: number, r: number): number[] {
  const out: number[] = new Array(n);
  out[0] = start;
  for (let i = 1; i < n; i++) out[i] = out[i - 1] * (1 + r);
  return out;
}

// ---------------------------------------------------------------------------
// momentum12_1
// ---------------------------------------------------------------------------

describe('momentum12_1', () => {
  it('returns null when fewer than 253 observations', () => {
    expect(momentum12_1(constantSeries(252, 100))).toBeNull();
    expect(momentum12_1([])).toBeNull();
  });

  it('returns 0 for a constant series', () => {
    const closes = constantSeries(500, 100);
    expect(momentum12_1(closes)).toBeCloseTo(0, 12);
  });

  it('is positive for a monotonically rising series', () => {
    const closes = compoundSeries(400, 100, 0.001);
    const score = momentum12_1(closes);
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThan(0);
  });

  it('matches the exact (t-21 / t-252) - 1 formula', () => {
    // Build so that close[n-1-252] = 100 and close[n-1-21] = 150 -> expect 0.5.
    const n = 300;
    const closes = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) closes[i] = 100;
    closes[n - 1 - 252] = 100;
    closes[n - 1 - 21] = 150;
    expect(momentum12_1(closes)).toBeCloseTo(0.5, 12);
  });
});

// ---------------------------------------------------------------------------
// momentum6_1
// ---------------------------------------------------------------------------

describe('momentum6_1', () => {
  it('returns null when fewer than 127 observations', () => {
    expect(momentum6_1(constantSeries(126, 100))).toBeNull();
  });

  it('returns 0 for a constant series', () => {
    expect(momentum6_1(constantSeries(200, 50))).toBeCloseTo(0, 12);
  });

  it('matches the exact (t-21 / t-126) - 1 formula', () => {
    const n = 200;
    const closes = new Array<number>(n).fill(100);
    closes[n - 1 - 126] = 100;
    closes[n - 1 - 21] = 120;
    expect(momentum6_1(closes)).toBeCloseTo(0.2, 12);
  });
});

// ---------------------------------------------------------------------------
// shortReversal
// ---------------------------------------------------------------------------

describe('shortReversal', () => {
  it('returns null when fewer than 6 observations', () => {
    expect(shortReversal([100, 100, 100, 100, 100])).toBeNull();
  });

  it('returns the negative of the last 5-day return', () => {
    // [95, ?, ?, ?, ?, 100] -> 5d return = 100/95 - 1; reversal = -(5/95)
    const closes = [95, 96, 97, 98, 99, 100];
    const r = 100 / 95 - 1;
    expect(shortReversal(closes)).toBeCloseTo(-r, 12);
  });

  it('scores a recent drop positively (reversal opportunity)', () => {
    const closes = [100, 100, 100, 100, 100, 95]; // -5% last 5 days
    const score = shortReversal(closes);
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// volatility
// ---------------------------------------------------------------------------

describe('volatility', () => {
  it('returns null when fewer than 253 observations', () => {
    expect(volatility(constantSeries(252, 100))).toBeNull();
  });

  it('returns 0 for a constant series', () => {
    expect(volatility(constantSeries(500, 100))).toBeCloseTo(0, 10);
  });

  it('is approximately sigma*sqrt(252) for lognormal returns (within 15%)', () => {
    const rng = mulberry32(7);
    const sigma = 0.01;
    const n = 600;
    const closes: number[] = [100];
    for (let i = 1; i < n; i++) {
      const r = sigma * randn(rng);
      closes.push(closes[i - 1] * (1 + r));
    }
    const expected = sigma * Math.sqrt(252);
    const vol = volatility(closes);
    expect(vol).not.toBeNull();
    const ratio = (vol as number) / expected;
    expect(ratio).toBeGreaterThan(0.85);
    expect(ratio).toBeLessThan(1.15);
  });
});

// ---------------------------------------------------------------------------
// downsideBeta
// ---------------------------------------------------------------------------

describe('downsideBeta', () => {
  it('returns null when series lengths differ', () => {
    expect(
      downsideBeta(constantSeries(300, 100), constantSeries(299, 100)),
    ).toBeNull();
  });

  it('returns null when fewer than 253 observations', () => {
    expect(
      downsideBeta(constantSeries(252, 100), constantSeries(252, 100)),
    ).toBeNull();
  });

  it('returns ~1.0 when stock tracks the market 1-for-1', () => {
    const rng = mulberry32(11);
    const n = 400;
    const mkt: number[] = [100];
    for (let i = 1; i < n; i++) {
      const r = 0.01 * randn(rng);
      mkt.push(mkt[i - 1] * (1 + r));
    }
    const beta = downsideBeta(mkt, mkt);
    expect(beta).not.toBeNull();
    expect(beta as number).toBeCloseTo(1, 6);
  });

  it('returns ~2.0 when stock returns are 2x market', () => {
    const rng = mulberry32(3);
    const n = 400;
    const mkt: number[] = [100];
    const stock: number[] = [100];
    for (let i = 1; i < n; i++) {
      const r = 0.01 * randn(rng);
      mkt.push(mkt[i - 1] * (1 + r));
      stock.push(stock[i - 1] * (1 + 2 * r));
    }
    const beta = downsideBeta(stock, mkt);
    expect(beta).not.toBeNull();
    expect(beta as number).toBeGreaterThan(1.8);
    expect(beta as number).toBeLessThan(2.2);
  });
});

// ---------------------------------------------------------------------------
// dispersion
// ---------------------------------------------------------------------------

describe('dispersion', () => {
  it('returns null when arrays misalign', () => {
    expect(dispersion([100, 100], [101], [99])).toBeNull();
  });

  it('returns null when fewer than 21 observations', () => {
    expect(
      dispersion(constantSeries(20, 100), constantSeries(20, 101), constantSeries(20, 99)),
    ).toBeNull();
  });

  it('computes mean (high - low)/close over trailing 21 days', () => {
    const closes = constantSeries(30, 100);
    const highs = constantSeries(30, 102);
    const lows = constantSeries(30, 98);
    const d = dispersion(closes, highs, lows);
    expect(d).not.toBeNull();
    // (102 - 98) / 100 = 0.04
    expect(d as number).toBeCloseTo(0.04, 12);
  });

  it('returns 0 when highs equal lows (no intraday range)', () => {
    const closes = constantSeries(25, 100);
    expect(dispersion(closes, closes, closes)).toBeCloseTo(0, 12);
  });
});
