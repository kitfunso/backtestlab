import {
  deletePortfolio,
  listPortfolios,
  loadPortfolio,
  savePortfolio,
  type SavePortfolioInput,
} from './storage';

const STORAGE_KEY = 'bl.portfolios.v1';

function baseSpec(overrides: Partial<SavePortfolioInput> = {}): SavePortfolioInput {
  return {
    tickers: ['RELIANCE', 'TCS'],
    weights: [0.6, 0.4],
    strategy: { kind: 'buy-and-hold' },
    ...overrides,
  };
}

/** Advance Date.now so consecutive saves produce monotonic `updatedAt` values. */
function nowSeq(): () => number {
  let t = Date.UTC(2026, 0, 1, 0, 0, 0);
  return () => {
    t += 1000;
    return t;
  };
}

describe('portfolio storage', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Round-trip
  // ---------------------------------------------------------------------------

  it('round-trips save → list → load', () => {
    const saved = savePortfolio('Tech heavy', baseSpec());
    expect(saved.name).toBe('Tech heavy');
    expect(saved.tickers).toEqual(['RELIANCE', 'TCS']);
    expect(saved.weights).toEqual([0.6, 0.4]);
    expect(saved.createdAt).toBe(saved.updatedAt);

    const summaries = listPortfolios();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].name).toBe('Tech heavy');
    expect(summaries[0].updatedAt).toBe(saved.updatedAt);

    const loaded = loadPortfolio('Tech heavy');
    expect(loaded).not.toBeNull();
    expect(loaded!.tickers).toEqual(['RELIANCE', 'TCS']);
    expect(loaded!.weights).toEqual([0.6, 0.4]);
    expect(loaded!.strategy).toEqual({ kind: 'buy-and-hold' });
  });

  it('returns null for an unknown portfolio name', () => {
    savePortfolio('A', baseSpec());
    expect(loadPortfolio('B')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Update by name
  // ---------------------------------------------------------------------------

  it('update by name preserves createdAt and bumps updatedAt', () => {
    const tick = nowSeq();
    const spy = jest.spyOn(Date, 'now').mockImplementation(tick);
    // Fix ISO generation by monkey-patching constructor: jsdom Date uses Date.now() for `new Date()` with no args.
    const OriginalDate = Date;
    const DateMock = function (this: Date, ...args: unknown[]): Date {
      if (args.length === 0) return new OriginalDate(OriginalDate.now());
      // @ts-expect-error — forward args to the real Date constructor
      return new OriginalDate(...args);
    } as unknown as DateConstructor;
    DateMock.now = OriginalDate.now;
    DateMock.parse = OriginalDate.parse;
    DateMock.UTC = OriginalDate.UTC;
    (globalThis as unknown as { Date: DateConstructor }).Date = DateMock;

    try {
      const first = savePortfolio('A', baseSpec());
      const updated = savePortfolio('A', baseSpec({ weights: [0.5, 0.5] }));

      expect(updated.createdAt).toBe(first.createdAt);
      expect(updated.updatedAt > first.updatedAt).toBe(true);
      expect(updated.weights).toEqual([0.5, 0.5]);

      expect(listPortfolios()).toHaveLength(1);
    } finally {
      (globalThis as unknown as { Date: DateConstructor }).Date = OriginalDate;
      spy.mockRestore();
    }
  });

  // ---------------------------------------------------------------------------
  // Listing order
  // ---------------------------------------------------------------------------

  it('lists portfolios sorted by updatedAt desc', () => {
    // Use explicit timestamps by crafting records through save + manual nudge.
    // Saves share wall-clock time within a test; simulate ordering by persisting
    // hand-built records with staggered `updatedAt`.
    const rec = (name: string, updatedAt: string) => ({
      name,
      tickers: ['X'],
      weights: [1],
      strategy: null,
      createdAt: updatedAt,
      updatedAt,
    });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        rec('oldest', '2026-01-01T00:00:00.000Z'),
        rec('newest', '2026-03-01T00:00:00.000Z'),
        rec('middle', '2026-02-01T00:00:00.000Z'),
      ]),
    );

    const summaries = listPortfolios();
    expect(summaries.map((s) => s.name)).toEqual(['newest', 'middle', 'oldest']);
  });

  // ---------------------------------------------------------------------------
  // Eviction
  // ---------------------------------------------------------------------------

  it('evicts the oldest portfolio when the 21st is saved', () => {
    // Seed 20 records with strictly increasing updatedAt so ordering is deterministic.
    const seed = Array.from({ length: 20 }, (_, i) => ({
      name: `P${i}`,
      tickers: ['X'],
      weights: [1],
      strategy: null,
      createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      updatedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    expect(listPortfolios()).toHaveLength(20);

    // 21st save — now() yields a fresh ISO > all seeded entries, so P0 is oldest.
    savePortfolio('P20', baseSpec());

    const summaries = listPortfolios();
    expect(summaries).toHaveLength(20);
    const names = summaries.map((s) => s.name);
    expect(names).toContain('P20');
    expect(names).not.toContain('P0');
  });

  it('updating an existing name does not trigger eviction at the cap', () => {
    const seed = Array.from({ length: 20 }, (_, i) => ({
      name: `P${i}`,
      tickers: ['X'],
      weights: [1],
      strategy: null,
      createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
      updatedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));

    savePortfolio('P5', baseSpec({ weights: [1] }));

    const summaries = listPortfolios();
    expect(summaries).toHaveLength(20);
    expect(summaries.map((s) => s.name).sort()).toEqual(seed.map((s) => s.name).sort());
  });

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  it('delete removes only the named record', () => {
    savePortfolio('A', baseSpec());
    savePortfolio('B', baseSpec());
    savePortfolio('C', baseSpec());

    deletePortfolio('B');

    const names = listPortfolios().map((s) => s.name).sort();
    expect(names).toEqual(['A', 'C']);
    expect(loadPortfolio('B')).toBeNull();
    expect(loadPortfolio('A')).not.toBeNull();
  });

  it('delete on an unknown name is a no-op', () => {
    savePortfolio('A', baseSpec());
    expect(() => deletePortfolio('DoesNotExist')).not.toThrow();
    expect(listPortfolios()).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Malformed storage recovery
  // ---------------------------------------------------------------------------

  it('returns empty list when storage contains malformed JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(listPortfolios()).toEqual([]);
    expect(loadPortfolio('anything')).toBeNull();
  });

  it('returns empty list when storage contains a non-array JSON value', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(listPortfolios()).toEqual([]);
  });

  it('skips malformed entries within an otherwise-valid array', () => {
    const good = {
      name: 'Good',
      tickers: ['X'],
      weights: [1],
      strategy: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([good, { name: 'Bad' /* missing other fields */ }, 42, null]),
    );

    const summaries = listPortfolios();
    expect(summaries.map((s) => s.name)).toEqual(['Good']);
  });

  it('overwrites malformed storage on next save', () => {
    localStorage.setItem(STORAGE_KEY, 'garbage');
    savePortfolio('Fresh', baseSpec());

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBe('garbage');
    expect(listPortfolios().map((s) => s.name)).toEqual(['Fresh']);
  });

  // ---------------------------------------------------------------------------
  // Immutability of returned values
  // ---------------------------------------------------------------------------

  it('loadPortfolio returns a defensive copy — mutation does not affect storage', () => {
    savePortfolio('A', baseSpec());
    const loaded = loadPortfolio('A');
    expect(loaded).not.toBeNull();

    (loaded!.tickers as string[]).push('MUTATED');
    (loaded!.weights as number[]).push(999);
    if (loaded!.strategy && typeof loaded!.strategy === 'object') {
      (loaded!.strategy as Record<string, unknown>).kind = 'HACKED';
    }

    const reloaded = loadPortfolio('A');
    expect(reloaded!.tickers).toEqual(['RELIANCE', 'TCS']);
    expect(reloaded!.weights).toEqual([0.6, 0.4]);
    expect(reloaded!.strategy).toEqual({ kind: 'buy-and-hold' });
  });

  it('savePortfolio returns a defensive copy — mutating it does not affect storage', () => {
    const saved = savePortfolio('A', baseSpec());
    (saved.tickers as string[]).push('MUTATED');

    const reloaded = loadPortfolio('A');
    expect(reloaded!.tickers).toEqual(['RELIANCE', 'TCS']);
  });
});
