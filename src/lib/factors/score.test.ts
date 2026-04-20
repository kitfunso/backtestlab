import { compositeScore, selectTopN, type FactorUniverse } from './score';
import { getPresetWeights, listPresets } from './presets';

describe('presets', () => {
  it('weights sum to ~1.0 for growth, balanced, defensive', () => {
    for (const p of ['growth', 'balanced', 'defensive'] as const) {
      const w = getPresetWeights(p);
      const sum = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
      expect(sum).toBeCloseTo(1.0, 3);
    }
  });

  it('contrarian has net-zero-ish weight (negatives included)', () => {
    const w = getPresetWeights('contrarian');
    const sum = Object.values(w).reduce((a, b) => a + (b ?? 0), 0);
    // magnitude-weighted — not required to sum to 1 since some weights negate
    expect(Math.abs(sum)).toBeLessThan(1.0);
  });

  it('listPresets returns all named goals', () => {
    expect(listPresets().length).toBeGreaterThanOrEqual(4);
  });
});

describe('compositeScore', () => {
  it('empty universe gives empty output', () => {
    expect(compositeScore({}, { mom12_1: 1 })).toEqual({});
  });

  it('zero weights give zero composite for all tickers', () => {
    const u: FactorUniverse = {
      A: { mom12_1: 1, low_vol: 0.2 },
      B: { mom12_1: -1, low_vol: 0.4 },
    };
    const out = compositeScore(u, {});
    expect(out.A).toBe(0);
    expect(out.B).toBe(0);
  });

  it('higher momentum raw produces higher composite with positive momentum weight', () => {
    const u: FactorUniverse = {
      HIGH: { mom12_1: 0.5 },
      MID: { mom12_1: 0.0 },
      LOW: { mom12_1: -0.5 },
    };
    const out = compositeScore(u, { mom12_1: 1 });
    expect(out.HIGH).toBeGreaterThan(out.MID);
    expect(out.MID).toBeGreaterThan(out.LOW);
  });

  it('lower vol raw produces higher composite with positive low_vol weight (direction flip)', () => {
    const u: FactorUniverse = {
      STABLE: { low_vol: 0.15 },
      AVG: { low_vol: 0.30 },
      WILD: { low_vol: 0.60 },
    };
    const out = compositeScore(u, { low_vol: 1 });
    expect(out.STABLE).toBeGreaterThan(out.AVG);
    expect(out.AVG).toBeGreaterThan(out.WILD);
  });

  it('negative momentum weight inverts ranking (contrarian load)', () => {
    const u: FactorUniverse = {
      HIGH: { mom12_1: 0.5 },
      LOW: { mom12_1: -0.5 },
    };
    const out = compositeScore(u, { mom12_1: -1 });
    expect(out.LOW).toBeGreaterThan(out.HIGH);
  });

  it('missing factor on a ticker treated as neutral (z=0)', () => {
    const u: FactorUniverse = {
      FULL: { mom12_1: 0.1, low_vol: 0.25 },
      PARTIAL: { mom12_1: 0.1 },
    };
    const out = compositeScore(u, { mom12_1: 0.5, low_vol: 0.5 });
    expect(Number.isFinite(out.FULL)).toBe(true);
    expect(Number.isFinite(out.PARTIAL)).toBe(true);
  });
});

describe('selectTopN', () => {
  it('picks N highest-score tickers when sector cap is not binding', () => {
    const scores = { A: 1.0, B: 0.5, C: -0.3, D: -1.0 };
    const sectors = { A: 'x', B: 'y', C: 'z', D: 'w' };
    expect(selectTopN(scores, sectors, 2, 3)).toEqual(['A', 'B']);
  });

  it('sector cap excludes extras from the dominant sector', () => {
    const scores = { A: 1.0, B: 0.9, C: 0.8, D: 0.5, E: 0.2 };
    const sectors = { A: 'it', B: 'it', C: 'it', D: 'bank', E: 'pharma' };
    const picks = selectTopN(scores, sectors, 4, 2);
    expect(picks).toEqual(['A', 'B', 'D', 'E']); // C skipped (IT cap hit)
  });

  it('unsectored tickers are not capped', () => {
    const scores = { A: 1.0, B: 0.9, C: 0.8 };
    const sectors = { A: undefined, B: undefined, C: undefined };
    expect(selectTopN(scores, sectors, 3, 1)).toEqual(['A', 'B', 'C']);
  });

  it('returns fewer than N when universe is small', () => {
    const scores = { A: 1.0, B: 0.5 };
    const picks = selectTopN(scores, { A: 'x', B: 'y' }, 5, 3);
    expect(picks).toEqual(['A', 'B']);
  });

  it('skips non-finite scores', () => {
    const scores = { A: NaN, B: 1.0, C: Infinity, D: -0.5 };
    const picks = selectTopN(scores, { A: 'x', B: 'y', C: 'z', D: 'w' }, 3, 3);
    expect(picks).toEqual(['B', 'D']);
  });
});
