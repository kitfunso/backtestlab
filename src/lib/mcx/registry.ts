import mcxRegistryJson from '../../../public/india/mcx-registry.json';
import type { CommodityKind, MCXCommodity } from './types';

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

const STATIC_JSON = mcxRegistryJson as RawMcxRegistry;

export const MCX_COMMODITIES: readonly MCXCommodity[] = STATIC_JSON.commodities.map(toCommodity);

const _staticSymbols: ReadonlySet<string> = new Set(MCX_COMMODITIES.map((c) => c.symbol));

let _cache: MCXCommodity[] | null = null;
let _bySymbol: Map<string, MCXCommodity> | null = null;

function ensureLoaded(json: RawMcxRegistry): void {
  if (_cache) return;
  _cache = json.commodities.map(toCommodity);
  _bySymbol = new Map(_cache.map((c) => [c.symbol, c]));
}

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

export function isMcxSymbol(ticker: string): boolean {
  if (_bySymbol) return _bySymbol.has(ticker);
  return _staticSymbols.has(ticker);
}
