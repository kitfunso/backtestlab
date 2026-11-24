import {
  FEE_SCHEDULES,
  SLIPPAGE_SCHEDULES,
  slippageBps,
  computeLegCost,
  computeTradeCosts,
} from './transaction-costs';

describe('slippageBps', () => {
  it('returns base_bps at or below threshold', () => {
    const sch = SLIPPAGE_SCHEDULES.NSE_FO_STOCK;
    expect(slippageBps(1, sch)).toBe(sch.base_bps);
    expect(slippageBps(sch.threshold_lots, sch)).toBe(sch.base_bps);
  });

  it('returns large_bps at or above 2x threshold', () => {
    const sch = SLIPPAGE_SCHEDULES.NSE_FO_STOCK;
    expect(slippageBps(sch.threshold_lots * 2, sch)).toBe(sch.large_bps);
    expect(slippageBps(sch.threshold_lots * 10, sch)).toBe(sch.large_bps);
  });

  it('interpolates linearly between threshold and 2x', () => {
    const sch = SLIPPAGE_SCHEDULES.NSE_FO_STOCK;
    const mid = slippageBps(sch.threshold_lots * 1.5, sch);
    expect(mid).toBeCloseTo((sch.base_bps + sch.large_bps) / 2, 6);
  });
});

describe('computeLegCost', () => {
  it('returns 0 for zero lots', () => {
    expect(
      computeLegCost({
        side: 'BUY',
        lots: 0,
        pricePerUnit: 1000,
        lotSize: 100,
        instrumentClass: 'NSE_FO_STOCK',
      }),
    ).toBe(0);
  });

  it('charges STT on sell but stamp duty on buy for NSE F&O', () => {
    const buy = computeLegCost({
      side: 'BUY',
      lots: 1,
      pricePerUnit: 1000,
      lotSize: 500,
      instrumentClass: 'NSE_FO_STOCK',
    });
    const sell = computeLegCost({
      side: 'SELL',
      lots: 1,
      pricePerUnit: 1000,
      lotSize: 500,
      instrumentClass: 'NSE_FO_STOCK',
    });
    expect(sell).toBeGreaterThan(buy);
  });

  it('scales slippage with size beyond threshold', () => {
    const small = computeLegCost({
      side: 'BUY',
      lots: 10,
      pricePerUnit: 1000,
      lotSize: 500,
      instrumentClass: 'NSE_FO_STOCK',
    });
    const large = computeLegCost({
      side: 'BUY',
      lots: 200,
      pricePerUnit: 1000,
      lotSize: 500,
      instrumentClass: 'NSE_FO_STOCK',
    });
    expect(large / 200).toBeGreaterThan(small / 10);
  });

  it('MCX index has no CTT on sell (exempt)', () => {
    const sell = computeLegCost({
      side: 'SELL',
      lots: 1,
      pricePerUnit: 12000,
      lotSize: 40,
      instrumentClass: 'MCX_INDEX',
    });
    const indexFees = FEE_SCHEDULES.MCX_INDEX;
    expect(indexFees.stt_or_ctt_sell_pct).toBe(0);
    expect(sell).toBeGreaterThan(0);
  });

  it('round-trip NSE F&O cost is a plausible magnitude for liquid large-cap', () => {
    const notional = 500 * 1500;
    const buy = computeLegCost({
      side: 'BUY',
      lots: 1,
      pricePerUnit: 1500,
      lotSize: 500,
      instrumentClass: 'NSE_FO_STOCK',
    });
    const sell = computeLegCost({
      side: 'SELL',
      lots: 1,
      pricePerUnit: 1500,
      lotSize: 500,
      instrumentClass: 'NSE_FO_STOCK',
    });
    const roundTripBps = ((buy + sell) / notional) * 10000;
    expect(roundTripBps).toBeGreaterThan(3);
    expect(roundTripBps).toBeLessThan(60);
  });
});

describe('computeTradeCosts', () => {
  it('returns zeros when positions never change', () => {
    const close = [100, 101, 102, 103];
    const signals = [0, 0, 0, 0];
    const lots = [0, 0, 0, 0];
    const costs = computeTradeCosts(close, signals, lots, 100, 'NSE_FO_STOCK');
    expect(costs.every((c) => c === 0)).toBe(true);
  });

  it('charges on entry, not on unchanged hold', () => {
    const close = [100, 101, 102, 103];
    const signals = [1, 1, 1, 1];
    const lots = [5, 5, 5, 5];
    const costs = computeTradeCosts(close, signals, lots, 100, 'NSE_FO_STOCK');
    expect(costs[0]).toBeGreaterThan(0);
    expect(costs[1]).toBe(0);
    expect(costs[2]).toBe(0);
    expect(costs[3]).toBe(0);
  });

  it('charges double on direction flip (exit + re-entry)', () => {
    const close = [100, 101, 102];
    const signals = [1, -1, -1];
    const lots = [5, 5, 5];
    const costs = computeTradeCosts(close, signals, lots, 100, 'NSE_FO_STOCK');
    const entryCost = costs[0];
    const flipCost = costs[1];
    expect(flipCost).toBeGreaterThan(entryCost * 1.5);
  });

  it('handles lot resize as single leg', () => {
    const close = [100, 101, 102];
    const signals = [1, 1, 1];
    const lots = [5, 10, 10];
    const costs = computeTradeCosts(close, signals, lots, 100, 'NSE_FO_STOCK');
    expect(costs[1]).toBeGreaterThan(0);
    expect(costs[2]).toBe(0);
  });

  it('skips days with non-positive close', () => {
    const close = [100, 0, 102];
    const signals = [1, 1, 1];
    const lots = [5, 5, 5];
    const costs = computeTradeCosts(close, signals, lots, 100, 'NSE_FO_STOCK');
    expect(costs[1]).toBe(0);
  });
});
