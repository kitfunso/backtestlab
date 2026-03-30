/**
 * India Equities - Stock Registry
 *
 * Loads registry.json and provides typed accessors for stocks, sectors, and colors.
 * The JSON uses full GICS names (consumer_discretionary, consumer_staples) while
 * the internal GICSSector type uses short forms (consumer_disc, consumer_staples).
 */

import type { GICSSector, IndiaStock } from './types';

// ---------------------------------------------------------------------------
// Sector Colors (from design preview)
// ---------------------------------------------------------------------------

export const SECTOR_COLORS: Record<GICSSector, string> = {
  financials: '#F59E0B',
  it: '#06B6D4',
  energy: '#EF4444',
  materials: '#F97316',
  healthcare: '#10B981',
  consumer_disc: '#8B5CF6',
  consumer_staples: '#84CC16',
  industrials: '#3B82F6',
} as const;

export const SECTOR_LABELS: Record<GICSSector, string> = {
  financials: 'Financials',
  it: 'IT',
  energy: 'Energy',
  materials: 'Materials',
  healthcare: 'Healthcare',
  consumer_disc: 'Consumer Disc',
  consumer_staples: 'Consumer Staples',
  industrials: 'Industrials',
} as const;

export const SECTOR_ORDER: readonly GICSSector[] = [
  'financials',
  'it',
  'energy',
  'materials',
  'healthcare',
  'consumer_disc',
  'consumer_staples',
  'industrials',
] as const;

// Tailwind classes for sector chips (dark mode)
export const SECTOR_CHIP_DARK: Record<GICSSector, { bg: string; border: string; text: string }> = {
  financials: { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-400' },
  it: { bg: 'bg-cyan-500/15', border: 'border-cyan-500/30', text: 'text-cyan-400' },
  energy: { bg: 'bg-red-500/15', border: 'border-red-500/30', text: 'text-red-400' },
  materials: { bg: 'bg-orange-500/15', border: 'border-orange-500/30', text: 'text-orange-400' },
  healthcare: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', text: 'text-emerald-400' },
  consumer_disc: { bg: 'bg-violet-500/15', border: 'border-violet-500/30', text: 'text-violet-400' },
  consumer_staples: { bg: 'bg-lime-500/15', border: 'border-lime-500/30', text: 'text-lime-400' },
  industrials: { bg: 'bg-blue-500/15', border: 'border-blue-500/30', text: 'text-blue-400' },
};

export const SECTOR_CHIP_LIGHT: Record<GICSSector, { bg: string; border: string; text: string }> = {
  financials: { bg: 'bg-amber-50', border: 'border-amber-400/60', text: 'text-amber-700' },
  it: { bg: 'bg-cyan-50', border: 'border-cyan-400/60', text: 'text-cyan-700' },
  energy: { bg: 'bg-red-50', border: 'border-red-400/60', text: 'text-red-700' },
  materials: { bg: 'bg-orange-50', border: 'border-orange-400/60', text: 'text-orange-700' },
  healthcare: { bg: 'bg-emerald-50', border: 'border-emerald-400/60', text: 'text-emerald-700' },
  consumer_disc: { bg: 'bg-violet-50', border: 'border-violet-400/60', text: 'text-violet-700' },
  consumer_staples: { bg: 'bg-lime-50', border: 'border-lime-400/60', text: 'text-lime-700' },
  industrials: { bg: 'bg-blue-50', border: 'border-blue-400/60', text: 'text-blue-700' },
};

// ---------------------------------------------------------------------------
// Registry JSON -> Typed data
// ---------------------------------------------------------------------------

/** Map registry JSON sector names to internal GICSSector */
function mapSector(raw: string): GICSSector {
  if (raw === 'consumer_discretionary') return 'consumer_disc';
  return raw as GICSSector;
}

interface RawStock {
  ticker: string;
  yf: string;
  name: string;
  lot_size: number;
  sector: string;
}

interface RawRegistry {
  stocks: RawStock[];
}

let _cache: IndiaStock[] | null = null;
let _byTicker: Map<string, IndiaStock> | null = null;
let _bySector: Map<GICSSector, IndiaStock[]> | null = null;

function ensureLoaded(registryJson: RawRegistry): void {
  if (_cache) return;
  _cache = registryJson.stocks.map((s) => ({
    ticker: s.ticker,
    yf: s.yf,
    name: s.name,
    lot_size: s.lot_size,
    sector: mapSector(s.sector),
  }));
  _byTicker = new Map(_cache.map((s) => [s.ticker, s]));
  _bySector = new Map();
  for (const s of _cache) {
    const arr = _bySector.get(s.sector) ?? [];
    arr.push(s);
    _bySector.set(s.sector, arr);
  }
}

/** Initialize registry with imported JSON. Call once at module scope. */
export function initRegistry(json: RawRegistry): void {
  ensureLoaded(json);
}

export function getAllStocks(): readonly IndiaStock[] {
  if (!_cache) throw new Error('Registry not initialized. Call initRegistry first.');
  return _cache;
}

export function getStock(ticker: string): IndiaStock | undefined {
  if (!_byTicker) throw new Error('Registry not initialized');
  return _byTicker.get(ticker);
}

export function isValidStock(ticker: string): boolean {
  if (!_byTicker) return false;
  return _byTicker.has(ticker);
}

export function getStocksBySector(sector: GICSSector): readonly IndiaStock[] {
  if (!_bySector) throw new Error('Registry not initialized');
  return _bySector.get(sector) ?? [];
}

export function getSectorCounts(): Record<GICSSector, number> {
  if (!_bySector) throw new Error('Registry not initialized');
  const counts = {} as Record<GICSSector, number>;
  for (const s of SECTOR_ORDER) {
    counts[s] = _bySector.get(s)?.length ?? 0;
  }
  return counts;
}
