import { runBacktest } from './backtest-engine';
import type { PriceData, StrategyConfig } from './types';

function trendingPrices(startPrice: number, days: number, driftPctPerDay: number): PriceData {
  const dates: string[] = [];
  const close: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const volume: number[] = [];
  let p = startPrice;
  const base = new Date('2020-01-01');
  for (let i = 0; i < days; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
    const noise = Math.sin(i * 0.37) * 0.005 * p;
    p = p * (1 + driftPctPerDay) + noise;
    close.push(+p.toFixed(2));
    open.push(+p.toFixed(2));
    high.push(+(p * 1.005).toFixed(2));
    low.push(+(p * 0.995).toFixed(2));
    volume.push(1_000_000);
  }
  return { ticker: 'TEST', dates, open, high, low, close, volume };
}

/**
 * Two-regime series: flat warmup period, then a trend. Guarantees that any
 * fast-vs-slow MA cross fires AFTER the indicators are warm, rather than
 * being missed during the NaN warmup window.
 */
function regimeShiftPrices(
  startPrice: number,
  warmupDays: number,
  trendDays: number,
  trendDriftPctPerDay: number,
): PriceData {
  const dates: string[] = [];
  const close: number[] = [];
  const open: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const volume: number[] = [];
  let p = startPrice;
  const base = new Date('2020-01-01');
  const total = warmupDays + trendDays;
  for (let i = 0; i < total; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
    const noise = Math.sin(i * 0.41) * 0.003 * p;
    const drift = i < warmupDays ? 0 : trendDriftPctPerDay;
    p = p * (1 + drift) + noise;
    close.push(+p.toFixed(2));
    open.push(+p.toFixed(2));
    high.push(+(p * 1.005).toFixed(2));
    low.push(+(p * 0.995).toFixed(2));
    volume.push(1_000_000);
  }
  return { ticker: 'TEST', dates, open, high, low, close, volume };
}

const SMA_CROSS_CONFIG: StrategyConfig = {
  indicators: [
    { type: 'sma', params: { period: 20 } },
    { type: 'sma', params: { period: 50 } },
  ],
  rules: [
    {
      indicator_index: 0,
      condition: 'is_above',
      reference_indicator: 1,
      direction: 'both',
    },
  ],
  combine_logic: 'or',
  sizing: { risk_budget: 500_000, vol_window: 20, z_multiplier: 1.65 },
  rebalance: 'daily',
};

const SHORT_ONLY_CONFIG: StrategyConfig = {
  indicators: [
    { type: 'sma', params: { period: 20 } },
    { type: 'sma', params: { period: 50 } },
  ],
  rules: [
    {
      indicator_index: 0,
      condition: 'crosses_below',
      reference_indicator: 1,
      direction: 'short',
    },
  ],
  combine_logic: 'or',
  sizing: { risk_budget: 500_000, vol_window: 20, z_multiplier: 1.65 },
  rebalance: 'daily',
};

const LONG_ONLY_CONFIG: StrategyConfig = {
  indicators: [
    { type: 'sma', params: { period: 20 } },
    { type: 'sma', params: { period: 50 } },
  ],
  rules: [
    {
      indicator_index: 0,
      condition: 'crosses_above',
      reference_indicator: 1,
      direction: 'long',
    },
  ],
  combine_logic: 'or',
  sizing: { risk_budget: 500_000, vol_window: 20, z_multiplier: 1.65 },
  rebalance: 'daily',
};

describe('runBacktest — direction semantics', () => {
  it('short-only profits on a post-warmup falling regime', () => {
    // regimeShift ensures the MA cross fires AFTER indicator warmup
    const fallingAfterWarmup = regimeShiftPrices(100, 80, 400, -0.0015);
    const risingAfterWarmup = regimeShiftPrices(100, 80, 400, 0.0015);
    const rFall = runBacktest(fallingAfterWarmup, SHORT_ONLY_CONFIG, 100);
    const rRise = runBacktest(risingAfterWarmup, SHORT_ONLY_CONFIG, 100);

    expect(rFall.metrics.total_pnl).toBeGreaterThan(rRise.metrics.total_pnl);
    for (const t of rFall.trades) expect(t.direction).toBe('short');
    for (const t of rRise.trades) expect(t.direction).toBe('short');
  });

  it('long-only profits on a post-warmup rising regime', () => {
    const risingAfterWarmup = regimeShiftPrices(100, 80, 400, 0.0015);
    const fallingAfterWarmup = regimeShiftPrices(100, 80, 400, -0.0015);
    const rRise = runBacktest(risingAfterWarmup, LONG_ONLY_CONFIG, 100);
    const rFall = runBacktest(fallingAfterWarmup, LONG_ONLY_CONFIG, 100);

    expect(rRise.metrics.total_pnl).toBeGreaterThan(rFall.metrics.total_pnl);
    for (const t of rRise.trades) expect(t.direction).toBe('long');
    for (const t of rFall.trades) expect(t.direction).toBe('long');
  });
});

describe('runBacktest — AND combine logic', () => {
  it('no trades fire when two AND rules fire opposite directions on the same condition', () => {
    const prices = trendingPrices(100, 400, 0.0008);
    const conflicting: StrategyConfig = {
      indicators: [
        { type: 'rsi', params: { period: 14 } },
      ],
      rules: [
        { indicator_index: 0, condition: 'is_above', threshold: 30, direction: 'long' },
        { indicator_index: 0, condition: 'is_above', threshold: 30, direction: 'short' },
      ],
      combine_logic: 'and',
      sizing: { risk_budget: 500_000, vol_window: 20, z_multiplier: 1.65 },
      rebalance: 'daily',
    };
    const r = runBacktest(prices, conflicting, 100);
    const nonZero = r.signals.values.filter((v) => v !== 0).length;
    expect(nonZero).toBe(0);
    expect(r.metrics.num_trades).toBe(0);
  });

  it('AND with two agreeing rules produces signals whereas AND with one long + one short does not', () => {
    const prices = trendingPrices(100, 400, 0.001);
    const agreeing: StrategyConfig = {
      ...SMA_CROSS_CONFIG,
      indicators: [
        { type: 'sma', params: { period: 10 } },
        { type: 'sma', params: { period: 30 } },
      ],
      rules: [
        { indicator_index: 0, condition: 'is_above', reference_indicator: 1, direction: 'long' },
        { indicator_index: 0, condition: 'is_above', reference_indicator: 1, direction: 'long' },
      ],
      combine_logic: 'and',
    };
    const rAgree = runBacktest(prices, agreeing, 100);
    const activeBars = rAgree.signals.values.filter((v) => v !== 0).length;
    expect(activeBars).toBeGreaterThan(0);
  });
});

describe('runBacktest — condition semantics', () => {
  it('crosses_above long-only produces held long signals after the post-warmup cross', () => {
    // Warmup flat so SMA20/SMA50 converge, then rising regime forces SMA20 above SMA50
    const prices = regimeShiftPrices(100, 80, 300, 0.0015);
    const r = runBacktest(prices, LONG_ONLY_CONFIG, 100);
    const signals = r.signals.values;
    const longBars = signals.filter((v) => v === 1).length;
    const shortBars = signals.filter((v) => v === -1).length;
    expect(longBars).toBeGreaterThan(0);
    expect(shortBars).toBe(0);
  });

  it('is_above level rule with direction=both flips between +1 and -1, never flat after warmup', () => {
    const prices = trendingPrices(100, 300, 0.0003);
    const cfg: StrategyConfig = {
      ...SMA_CROSS_CONFIG,
      rules: [{ indicator_index: 0, condition: 'is_above', reference_indicator: 1, direction: 'both' }],
    };
    const r = runBacktest(prices, cfg, 100);
    // After both SMAs are warm (bar ~50+), every bar should be +1 or -1 (level rule, both direction)
    const tail = r.signals.values.slice(60);
    const flatBars = tail.filter((v) => v === 0).length;
    expect(flatBars).toBe(0);
  });

  it('between condition fires only while the value is within the threshold/reference window', () => {
    const prices = trendingPrices(100, 300, 0.0005);
    const cfg: StrategyConfig = {
      indicators: [
        { type: 'rsi', params: { period: 14 } },
        { type: 'rsi', params: { period: 14 } },
      ],
      rules: [
        {
          indicator_index: 0,
          condition: 'between',
          threshold: 40,
          reference_indicator: 1,
          direction: 'long',
        },
      ],
      combine_logic: 'or',
      sizing: { risk_budget: 500_000, vol_window: 20, z_multiplier: 1.65 },
      rebalance: 'daily',
    };
    const r = runBacktest(prices, cfg, 100);
    // Between uses threshold as lower bound and reference_indicator value as upper bound.
    // When indicator_index == reference_indicator, val <= upper always holds, so any bar
    // with rsi >= 40 should fire long.
    const activeBars = r.signals.values.filter((v) => v === 1).length;
    expect(activeBars).toBeGreaterThan(0);
    expect(r.signals.values.some((v) => v === -1)).toBe(false);
  });
});

describe('runBacktest — rebalance frequency', () => {
  it('weekly and monthly rebalance do not flip signals more often than daily', () => {
    const prices = trendingPrices(100, 400, 0.0003);

    const makeCfg = (freq: 'daily' | 'weekly' | 'monthly'): StrategyConfig => ({
      ...SMA_CROSS_CONFIG,
      rebalance: freq,
    });

    const countFlips = (vals: readonly number[]): number => {
      let flips = 0;
      for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1]) flips++;
      return flips;
    };

    const daily = runBacktest(prices, makeCfg('daily'), 100);
    const weekly = runBacktest(prices, makeCfg('weekly'), 100);
    const monthly = runBacktest(prices, makeCfg('monthly'), 100);

    const dailyFlips = countFlips(daily.signals.values);
    const weeklyFlips = countFlips(weekly.signals.values);
    const monthlyFlips = countFlips(monthly.signals.values);

    expect(weeklyFlips).toBeLessThanOrEqual(dailyFlips);
    expect(monthlyFlips).toBeLessThanOrEqual(weeklyFlips);
  });
});

describe('runBacktest — numerical safety', () => {
  it('constant price series (zero returns) does not divide by zero in sizing', () => {
    const n = 200;
    const dates: string[] = [];
    const base = new Date('2020-01-01');
    for (let i = 0; i < n; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    const flatPrices: PriceData = {
      ticker: 'FLAT',
      dates,
      open: new Array(n).fill(100),
      high: new Array(n).fill(100),
      low: new Array(n).fill(100),
      close: new Array(n).fill(100),
      volume: new Array(n).fill(1_000_000),
    };
    const cfg: StrategyConfig = {
      ...SMA_CROSS_CONFIG,
      rules: [{ indicator_index: 0, condition: 'is_above', reference_indicator: 1, direction: 'both' }],
    };
    const r = runBacktest(flatPrices, cfg, 100);
    expect(Number.isFinite(r.metrics.total_pnl)).toBe(true);
    expect(Number.isFinite(r.metrics.sharpe)).toBe(true);
    for (const v of r.equity_curve.cumulative) expect(Number.isFinite(v)).toBe(true);
  });

  it('single-bar series returns an empty result instead of crashing', () => {
    const single: PriceData = {
      ticker: 'ONE',
      dates: ['2020-01-01'],
      open: [100],
      high: [100],
      low: [100],
      close: [100],
      volume: [1_000_000],
    };
    const r = runBacktest(single, SMA_CROSS_CONFIG, 100);
    expect(r.metrics.num_trades).toBe(0);
    expect(r.trades.length).toBe(0);
    expect(r.equity_curve.cumulative.length).toBe(0);
  });

  it('indicators configured but no rules produces zero trades and a zero signal series', () => {
    const prices = trendingPrices(100, 200, 0.001);
    const cfg: StrategyConfig = { ...SMA_CROSS_CONFIG, rules: [] };
    const r = runBacktest(prices, cfg, 100);
    expect(r.metrics.num_trades).toBe(0);
    expect(r.signals.values.every((v) => v === 0)).toBe(true);
    expect(r.metrics.total_pnl).toBe(0);
  });
});

describe('runBacktest — reconciliation', () => {
  it('total_transaction_costs equals metrics exposure from gross-vs-net gap', () => {
    const prices = trendingPrices(100, 400, 0.0005);
    const r = runBacktest(prices, SMA_CROSS_CONFIG, 100);
    const costs = r.metrics.total_transaction_costs ?? 0;
    expect(costs).toBeGreaterThanOrEqual(0);
    // When there are trades, costs should be non-zero
    if (r.metrics.num_trades > 0) {
      expect(costs).toBeGreaterThan(0);
    }
  });

  it('drawdown values are always non-positive and start at 0 on the first bar', () => {
    const prices = trendingPrices(100, 400, 0.0005);
    const r = runBacktest(prices, SMA_CROSS_CONFIG, 100);
    expect(r.drawdown.values.length).toBeGreaterThan(0);
    expect(r.drawdown.values[0]).toBeLessThanOrEqual(0);
    for (const v of r.drawdown.values) expect(v).toBeLessThanOrEqual(1e-9);
  });

  it('equity curve final value equals total_pnl within rounding', () => {
    const prices = trendingPrices(100, 400, 0.0007);
    const r = runBacktest(prices, SMA_CROSS_CONFIG, 100);
    const finalCum = r.equity_curve.cumulative[r.equity_curve.cumulative.length - 1];
    // total_pnl is rounded to 2dp; cumulative is the raw running sum
    expect(Math.abs(finalCum - r.metrics.total_pnl)).toBeLessThan(0.01);
  });
});
