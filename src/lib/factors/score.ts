import { crossSectionalZScore } from './rank';
import type { FactorWeights } from './presets';

export type FactorName =
  | 'mom12_1'
  | 'mom6_1'
  | 'low_vol'
  | 'short_rev'
  | 'low_beta'
  | 'low_disp';

export type FactorScores = Partial<Record<FactorName, number>>;

export type FactorUniverse = Record<string, FactorScores>;

/**
 * +1 means higher raw value is a better signal; -1 means lower raw is better.
 * Applied to the cross-sectional z-score before weighting so that positive
 * weights always mean "load on the good side of this factor".
 */
const FACTOR_DIRECTION: Record<FactorName, 1 | -1> = {
  mom12_1: 1,
  mom6_1: 1,
  low_vol: -1,
  short_rev: -1,
  low_beta: -1,
  low_disp: -1,
};

const ALL_FACTORS: FactorName[] = [
  'mom12_1',
  'mom6_1',
  'low_vol',
  'short_rev',
  'low_beta',
  'low_disp',
];

/**
 * Collapse per-factor z-scores into a single composite per ticker.
 * Factors without a weight in `weights` are skipped (weight = 0).
 */
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

/**
 * Pick the top-N tickers by composite score, capped at `sectorCap` per sector.
 * Tickers whose sector is missing from `sectors` are treated as unsectored
 * and always eligible (no cap applies to them).
 */
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
