import { runBacktest } from './backtest-engine';
import type { PriceData, StrategyConfig } from './types';
import crude from '../../../public/india/prices/mcx/CRUDE.json';

const GC: StrategyConfig = {
  indicators: [
    { type: 'sma', params: { period: 50 } },
    { type: 'sma', params: { period: 200 } },
  ],
  rules: [
    { indicator_index: 0, condition: 'is_above', reference_indicator: 1, direction: 'both' },
  ],
  combine_logic: 'or',
  sizing: { risk_budget: 500_000, vol_window: 20, z_multiplier: 1.65 },
  rebalance: 'daily',
};

describe('CRUDE data sanity after 2020-04-20 bar removal', () => {
  it('has no dates on 2020-04-20', () => {
    expect(crude.dates).not.toContain('2020-04-20');
  });

  it('has no sub-₹100 closes', () => {
    expect(Math.min(...crude.close)).toBeGreaterThan(100);
  });

  it('backtest total PnL is within sane magnitude (<₹50Cr on ₹5L risk)', () => {
    const prices: PriceData = {
      ticker: 'CRUDE',
      dates: crude.dates,
      open: crude.open,
      high: crude.high,
      low: crude.low,
      close: crude.close,
      volume: crude.volume,
    };
    const r = runBacktest(prices, GC, 100);
    expect(Math.abs(r.metrics.total_pnl)).toBeLessThan(50_00_00_000);
    expect(Math.abs(r.metrics.max_dd_inr)).toBeLessThan(50_00_00_000);
    expect(r.metrics.num_trades).toBeGreaterThan(0);
  });
});
