import { crossSectionalZScore } from './rank';
import type { FactorWeights } from './presets';

export type FactorName =
  | 'mom12_1'
  | 'mom6_1'
  | 'low_vol'
  | 'short_rev'
  | 'low_beta'
  | 'low_disp'
  | 'pe'
  | 'pb'
  | 'roe'
  | 'rev_growth'
  | 'de';

export type FactorScores = Partial<Record<FactorName, number>>;

export type FactorUniverse = Record<string, FactorScores>;

const FACTOR_DIRECTION: Record<FactorName, 1 | -1> = {
  mom12_1: 1,
  mom6_1: 1,
  low_vol: -1,
  short_rev: -1,
  low_beta: -1,
  low_disp: -1,
  pe: -1,
  pb: -1,
  roe: 1,
  rev_growth: 1,
  de: -1,
};

const ALL_FACTORS: FactorName[] = [
  'mom12_1',
  'mom6_1',
  'low_vol',
  'short_rev',
  'low_beta',
  'low_disp',
  'pe',
  'pb',
  'roe',
  'rev_growth',
  'de',
];

export const FACTOR_LABELS: Record<FactorName, string> = {
  mom12_1: '12-1 momentum',
  mom6_1: '6-1 momentum',
  low_vol: 'Low volatility',
  short_rev: 'Short reversal',
  low_beta: 'Low beta',
  low_disp: 'Low dispersion',
  pe: 'Low P/E',
  pb: 'Low P/B',
  roe: 'ROE',
  rev_growth: 'Revenue growth',
  de: 'Low debt/equity',
};

export function compositeScore(
  universe: FactorUniverse,
  weights: FactorWeights,
): Record<string, number> {
  const tickers = Object.keys(universe);
  if (tickers.length === 0) return {};

  const zByFactor: Partial<Record<FactorName, Record<string, number>>> = {};
  for (const f of ALL_FACTORS) {
    const w = weights[f];
    if (w === undefined || w === 0) continue;
    const rawByTicker: Record<string, number | null> = {};
    for (const t of tickers) {
      const v = universe[t]?.[f];
      rawByTicker[t] = v === undefined ? null : v;
    }
    zByFactor[f] = crossSectionalZScore(rawByTicker);
  }

  const composite: Record<string, number> = {};
  for (const t of tickers) {
    let s = 0;
    for (const f of ALL_FACTORS) {
      const w = weights[f];
      if (w === undefined || w === 0) continue;
      const z = zByFactor[f]?.[t] ?? 0;
      s += w * FACTOR_DIRECTION[f] * z;
    }
    composite[t] = s;
  }
  return composite;
}

export function factorContributions(
  universe: FactorUniverse,
  weights: FactorWeights,
  ticker: string,
): Array<{ factor: FactorName; contribution: number; rawZ: number }> {
  const tickers = Object.keys(universe);
  const out: Array<{ factor: FactorName; contribution: number; rawZ: number }> = [];
  for (const f of ALL_FACTORS) {
    const w = weights[f];
    if (w === undefined || w === 0) continue;
    const rawByTicker: Record<string, number | null> = {};
    for (const t of tickers) {
      const v = universe[t]?.[f];
      rawByTicker[t] = v === undefined ? null : v;
    }
    const z = crossSectionalZScore(rawByTicker)[ticker] ?? 0;
    out.push({
      factor: f,
      contribution: w * FACTOR_DIRECTION[f] * z,
      rawZ: z,
    });
  }
  out.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  return out;
}

export function selectTopN(
  scores: Record<string, number>,
  sectors: Record<string, string | undefined>,
  n: number,
  sectorCap: number,
): string[] {
  const ranked = Object.entries(scores)
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1]);

  const picks: string[] = [];
  const perSector: Record<string, number> = {};

  for (const [ticker] of ranked) {
    if (picks.length >= n) break;
    const sector = sectors[ticker];
    if (sector) {
      const used = perSector[sector] ?? 0;
      if (used >= sectorCap) continue;
      perSector[sector] = used + 1;
    }
    picks.push(ticker);
  }

  return picks;
}
