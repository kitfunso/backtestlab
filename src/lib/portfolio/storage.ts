export interface SavedPortfolio {
  readonly name: string;
  readonly tickers: readonly string[];
  readonly weights: readonly number[];
  readonly strategy: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SavedPortfolioSummary {
  readonly name: string;
  readonly updatedAt: string;
}

export type SavePortfolioInput = Omit<
  SavedPortfolio,
  'name' | 'createdAt' | 'updatedAt'
>;

const STORAGE_KEY = 'bl.portfolios.v1';
const MAX_PORTFOLIOS = 20;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isSavedPortfolio(value: unknown): value is SavedPortfolio {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== 'string') return false;
  if (!Array.isArray(v.tickers) || !v.tickers.every((t) => typeof t === 'string')) return false;
  if (!Array.isArray(v.weights) || !v.weights.every((w) => typeof w === 'number')) return false;
  if (typeof v.createdAt !== 'string') return false;
  if (typeof v.updatedAt !== 'string') return false;
  return true;
}

function readAll(): SavedPortfolio[] {
  const storage = getStorage();
  if (storage === null) return [];

  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const result: SavedPortfolio[] = [];
  for (const item of parsed) {
    if (isSavedPortfolio(item)) result.push(item);
  }
  return result;
}

function writeAll(records: readonly SavedPortfolio[]): void {
  const storage = getStorage();
  if (storage === null) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function clonePortfolio(p: SavedPortfolio): SavedPortfolio {
  return {
    name: p.name,
    tickers: [...p.tickers],
    weights: [...p.weights],
    strategy: p.strategy === undefined ? undefined : JSON.parse(JSON.stringify(p.strategy)),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function savePortfolio(
  name: string,
  spec: SavePortfolioInput,
): SavedPortfolio {
  const now = new Date().toISOString();
  const records = readAll();

  const existingIdx = records.findIndex((r) => r.name === name);
  let record: SavedPortfolio;

  if (existingIdx >= 0) {
    const existing = records[existingIdx];
    record = {
      name,
      tickers: [...spec.tickers],
      weights: [...spec.weights],
      strategy: spec.strategy,
      createdAt: existing.createdAt,
      updatedAt: now,
    };
    records[existingIdx] = record;
  } else {
    record = {
      name,
      tickers: [...spec.tickers],
      weights: [...spec.weights],
      strategy: spec.strategy,
      createdAt: now,
      updatedAt: now,
    };
    records.push(record);

    while (records.length > MAX_PORTFOLIOS) {
      let oldestIdx = 0;
      for (let i = 1; i < records.length; i++) {
        if (records[i].updatedAt < records[oldestIdx].updatedAt) {
          oldestIdx = i;
        }
      }
      records.splice(oldestIdx, 1);
    }
  }

  writeAll(records);
  return clonePortfolio(record);
}

export function listPortfolios(): SavedPortfolioSummary[] {
  const records = readAll();
  const summaries = records.map((r) => ({ name: r.name, updatedAt: r.updatedAt }));
  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return summaries;
}

export function loadPortfolio(name: string): SavedPortfolio | null {
  const records = readAll();
  const found = records.find((r) => r.name === name);
  return found === undefined ? null : clonePortfolio(found);
}

export function deletePortfolio(name: string): void {
  const records = readAll();
  const filtered = records.filter((r) => r.name !== name);
  if (filtered.length === records.length) return;
  writeAll(filtered);
}
