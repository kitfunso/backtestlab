/**
 * MCX Commodities — Registry
 *
 * Mirrors `src/lib/india/registry.ts` pattern: module-local cache + ensureLoaded
 * guard so callers pass the JSON once via `initMcxRegistry()`.
 *
 * Unlike the stock registry, we also expose `MCX_COMMODITIES` as a static import
 * of the JSON so path-routing helpers (e.g. `isMcxSymbol`) work synchronously
 * before `initMcxRegistry()` has been called.
 */

import mcxRegistryJson from '../../../public/india/mcx-registry.json';
import type { CommodityKind, MCXCommodity } from './types';

// ---------------------------------------------------------------------------
// Raw JSON shapes
// ---------------------------------------------------------------------------

interface RawCommodity {
  symbol: string;
  mcx_ticker: string;
  bbg_ticker: string;
  name: string;
  kind: string;
  contract_size: string;
  tick_size: number;
  lot_size: number;
}

interface RawMcxRegistry {
  commodities: RawCommodity[];
}

function toCommodity(raw: RawCommodity): MCXCommodity {
  const kind: CommodityKind = raw.kind === 'index' ? 'index' : 'single';
  return {
    symbol: raw.symbol,
    mcx_ticker: raw.mcx_ticker,
    bbg_ticker: raw.bbg_ticker,
    name: raw.name,
    kind,
    contract_size: raw.contract_size,
    tick_size: raw.tick_size,
    lot_size: raw.lot_size,
  };
}

// ---------------------------------------------------------------------------
// Static fallback (available before initMcxRegistry is called)
// ---------------------------------------------------------------------------

const STATIC_JSON = mcxRegistryJson as RawMcxRegistry;

/** Static snapshot of the registry — safe to import synchronously. */
export const MCX_COMMODITIES: readonly MCXCommodity[] = STATIC_JSON.commodities.map(toCommodity);

const _staticSymbols: ReadonlySet<string> = new Set(MCX_COMMODITIES.map((c) => c.symbol));

// ---------------------------------------------------------------------------
// Mutable cache (populated by initMcxRegistry)
// ---------------------------------------------------------------------------

let _cache: MCXCommodity[] | null = null;
let _bySymbol: Map<string, MCXCommodity> | null = null;

function ensureLoaded(json: RawMcxRegistry): void {
  if (_cache) return;
  _cache = json.commodities.map(toCommodity);
  _bySymbol = new Map(_cache.map((c) => [c.symbol, c]));
}

/** Initialize the MCX registry. Call once at module scope, same as initRegistry. */
export function initMcxRegistry(json: RawMcxRegistry): void {
  ensureLoaded(json);
}

export function getAllCommodities(): readonly MCXCommodity[] {
  if (!_cache) throw new Error('MCX registry not initialized. Call initMcxRegistry first.');
  return _cache;
}

export function getCommodity(symbol: string): MCXCommodity | undefined {
  if (!_bySymbol) throw new Error('MCX registry not initialized');
  return _bySymbol.get(symbol);
}

/**
 * Pure lookup that works even before `initMcxRegistry()` has run — used by
 * `fetchPriceData` to decide the URL path. Falls back to the static JSON
 * snapshot so first-render path routing is correct.
 */
export function isMcxSymbol(ticker: string): boolean {
  if (_bySymbol) return _bySymbol.has(ticker);
  return _staticSymbols.has(ticker);
}
