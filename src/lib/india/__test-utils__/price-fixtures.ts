import type { PriceData } from '../types';

export function trendingPrices(
  startPrice: number,
  days: number,
  driftPctPerDay: number,
): PriceData {
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

// Two-regime series: flat warmup, then trend. Ensures fast-vs-slow MA crosses
// fire AFTER indicator warmup rather than being missed during the NaN window.
export function regimeShiftPrices(
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
