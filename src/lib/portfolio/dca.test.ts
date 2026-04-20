import {
  simulateLumpSum,
  simulateDCA,
  annualizedReturn,
} from './dca';

function dateRange(n: number): string[] {
  const out: string[] = [];
  const start = new Date('2020-01-02');
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

describe('simulateLumpSum', () => {
  it('preserves capital on a flat curve', () => {
    const curve = [100, 100, 100, 100];
    const r = simulateLumpSum(curve, dateRange(4), 10000);
    expect(r.shares).toBeCloseTo(100, 6);
    expect(r.values[r.values.length - 1]).toBeCloseTo(10000, 6);
  });

  it('2x on a doubling curve', () => {
    const curve = [100, 150, 200];
    const r = simulateLumpSum(curve, dateRange(3), 1000);
    expect(r.values[2]).toBeCloseTo(2000, 6);
  });

  it('rejects empty curve', () => {
    expect(() => simulateLumpSum([], [], 1000)).toThrow();
  });

  it('rejects misaligned dates', () => {
    expect(() => simulateLumpSum([100, 200], dateRange(3), 1000)).toThrow();
  });
});

describe('simulateDCA', () => {
  it('flat curve — terminal value equals capital', () => {
    const n = 60;
    const curve = new Array(n).fill(100);
    const r = simulateDCA(curve, dateRange(n), 10000, 'weekly');
    expect(r.values[n - 1]).toBeCloseTo(10000, 6);
  });

  it('monotonically rising curve — lump-sum beats DCA', () => {
    const n = 120;
    const curve = Array.from({ length: n }, (_, i) => 100 + i);
    const lump = simulateLumpSum(curve, dateRange(n), 12000);
    const dca = simulateDCA(curve, dateRange(n), 12000, 'monthly');
    expect(lump.values[n - 1]).toBeGreaterThan(dca.values[n - 1]);
  });

  it('dip-then-recover — DCA beats lump-sum (classic average-down)', () => {
    // U-shape: start at 100, drop to 50, recover to 100
    const n = 60;
    const curve = Array.from({ length: n }, (_, i) =>
      i < 30 ? 100 - (50 * i) / 29 : 50 + (50 * (i - 30)) / 29,
    );
    const lump = simulateLumpSum(curve, dateRange(n), 12000);
    const dca = simulateDCA(curve, dateRange(n), 12000, 'weekly');
    expect(dca.values[n - 1]).toBeGreaterThan(lump.values[n - 1]);
  });

  it('weekly has ~5x the contributions of monthly over a year', () => {
    const n = 252;
    const curve = new Array(n).fill(100);
    const weekly = simulateDCA(curve, dateRange(n), 10000, 'weekly');
    const monthly = simulateDCA(curve, dateRange(n), 10000, 'monthly');
    const wC = weekly.contributions.filter((c) => c > 0).length;
    const mC = monthly.contributions.filter((c) => c > 0).length;
    expect(wC).toBeGreaterThan(mC * 3); // not exact 5x due to calendar months, but materially more
  });
});

describe('annualizedReturn', () => {
  it('returns 0 for identity input', () => {
    expect(annualizedReturn(1000, 1000, 252)).toBeCloseTo(0, 6);
  });

  it('~10% annual for 1.1x over 252 days', () => {
    expect(annualizedReturn(1100, 1000, 252)).toBeCloseTo(0.1, 3);
  });

  it('NaN for zero span', () => {
    expect(Number.isNaN(annualizedReturn(1000, 1000, 0))).toBe(true);
  });
});
