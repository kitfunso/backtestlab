'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { GICSSector, IndiaStock, PriceData } from '@/lib/india/types';
import {
  initRegistry,
  getAllStocks,
  getStock,
  getStocksBySector,
  SECTOR_LABELS,
  SECTOR_ORDER,
  SECTOR_COLORS,
  getSectorCounts,
} from '@/lib/india/registry';
import { fetchPriceData } from '@/lib/india/data';
import { StrategyBuilder } from './StrategyBuilder';
import registryJson from '../../../public/india/registry.json';
import mcxRegistryJson from '../../../public/india/mcx-registry.json';
import { initMcxRegistry, MCX_COMMODITIES, getCommodity } from '@/lib/mcx/registry';
import { CommodityGrid } from '@/components/mcx/CommodityGrid';
import { usePortfolioOptimisation } from '@/lib/india/portfolio-hooks';
import type { AllocMethod as OptiAllocMethod } from '@/lib/india/optimizer';
import { PortfolioMetricsPanel } from '@/components/portfolio/PortfolioMetricsPanel';
import { DCAPanel } from '@/components/portfolio/DCAPanel';
import { GoalWizard } from '@/components/portfolio/GoalWizard';
import { SavedPortfoliosPanel } from '@/components/portfolio/SavedPortfoliosPanel';
import type { SavedPortfolio } from '@/lib/portfolio/storage';
import { NewsPanel } from '@/components/india/NewsPanel';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  ScatterChart, Scatter, Cell,
} from 'recharts';

// Initialize registries on module load
initRegistry(registryJson as { stocks: { ticker: string; yf: string; name: string; lot_size: number; sector: string }[] });
initMcxRegistry(mcxRegistryJson as Parameters<typeof initMcxRegistry>[0]);

// "Commodities" is a virtual tab alongside the 8 GICS sectors
const COMMODITIES_TAB = 'commodities' as const;
type SectorTab = GICSSector | typeof COMMODITIES_TAB;
const COMMODITIES_COLOR = '#FF9933';

// ---------------------------------------------------------------------------
// NiftyTab
// ---------------------------------------------------------------------------

interface NiftyTabProps {
  isLight: boolean;
}

type ViewMode = 'strategy' | 'portfolio';

export function NiftyTab({ isLight }: NiftyTabProps) {
  const [activeSector, setActiveSector] = useState<SectorTab>('financials');
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [selectedPriceData, setSelectedPriceData] = useState<PriceData | null>(null);
  const [portfolio, setPortfolio] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('strategy');
  const [search, setSearch] = useState('');
  const [portfolioCapital, setPortfolioCapital] = useState(5000000); // ₹50L default
  const [showWizard, setShowWizard] = useState(false);

  const replacePortfolioTickers = useCallback((tickers: string[]) => {
    setPortfolio(new Set(tickers));
    setViewMode('portfolio');
  }, []);

  const sectorsByTicker = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of getAllStocks()) out[s.ticker] = s.sector;
    return out;
  }, []);

  const namesByTicker = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of getAllStocks()) out[s.ticker] = s.name;
    return out;
  }, []);

  const currentPortfolioSpec = useMemo(() => {
    if (portfolio.size === 0) return null;
    const tickers = Array.from(portfolio);
    return { tickers, weights: tickers.map(() => 1 / tickers.length), strategy: null as unknown };
  }, [portfolio]);

  const handleLoadSaved = useCallback(
    (spec: SavedPortfolio) => {
      replacePortfolioTickers([...spec.tickers]);
    },
    [replacePortfolioTickers],
  );

  const sectorCounts = useMemo(() => getSectorCounts(), []);

  // Stocks in current sector, filtered by search. Empty for the commodities tab.
  const sectorStocks = useMemo(() => {
    if (activeSector === COMMODITIES_TAB) return [] as readonly IndiaStock[];
    let stocks = getStocksBySector(activeSector);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      stocks = stocks.filter(
        (s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q),
      );
    }
    return stocks;
  }, [activeSector, search]);

  // Commodities shown when the virtual tab is active, filtered by search.
  const sectorCommodities = useMemo(() => {
    if (activeSector !== COMMODITIES_TAB) return MCX_COMMODITIES;
    if (!search.trim()) return MCX_COMMODITIES;
    const q = search.toLowerCase().trim();
    return MCX_COMMODITIES.filter(
      (c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [activeSector, search]);

  const portfolioStocks = useMemo(() => {
    return getAllStocks().filter((s) => portfolio.has(s.ticker));
  }, [portfolio]);

  const handleSelectStock = useCallback(async (ticker: string) => {
    setSelectedTicker(ticker);
    try {
      const data = await fetchPriceData(ticker);
      setSelectedPriceData(data);
    } catch {
      setSelectedPriceData(null);
    }
  }, []);

  // Auto-select first stock on mount so the strategy builder is ready
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && sectorStocks.length > 0 && !selectedTicker) {
      didAutoSelect.current = true;
      handleSelectStock(sectorStocks[0].ticker);
    }
  }, [sectorStocks, selectedTicker, handleSelectStock]);

  const handleTogglePortfolio = useCallback((ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPortfolio((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }, []);

  const selectedStock = selectedTicker ? getStock(selectedTicker) : undefined;
  const selectedCommodity = selectedTicker ? getCommodity(selectedTicker) : undefined;
  const selectedInstrument = selectedStock
    ? { ticker: selectedStock.ticker, lot_size: selectedStock.lot_size, name: selectedStock.name }
    : selectedCommodity
      ? { ticker: selectedCommodity.symbol, lot_size: selectedCommodity.lot_size, name: selectedCommodity.name }
      : null;

  // Theme
  const textMuted = isLight ? 'text-gray-500' : 'text-zinc-400';

  return (
    <div className="space-y-3">
      {/* ===== VIEW MODE TOGGLE + PORTFOLIO INFO ===== */}
      <div className="flex items-center gap-3">
        <div className={cn(
          'flex rounded-lg p-0.5 border',
          isLight ? 'bg-gray-100 border-gray-200' : 'bg-zinc-900 border-zinc-800',
        )}>
          <button
            onClick={() => setViewMode('strategy')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all',
              viewMode === 'strategy'
                ? 'bg-[#FF9933] text-black'
                : isLight ? 'text-gray-500 hover:text-gray-700' : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            Strategy
          </button>
          <button
            onClick={() => setViewMode('portfolio')}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded-md transition-all',
              viewMode === 'portfolio'
                ? 'bg-[#FF9933] text-black'
                : isLight ? 'text-gray-500 hover:text-gray-700' : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            Portfolio {portfolio.size > 0 && `(${portfolio.size})`}
          </button>
        </div>

        {/* Search */}
        {viewMode === 'strategy' && (
          <input
            type="text"
            placeholder="Search stocks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn(
              'w-48 px-2.5 py-1.5 rounded-lg text-xs border outline-none transition-colors',
              isLight
                ? 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-[#FF9933]'
                : 'bg-zinc-900 border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:border-[#FF9933]',
            )}
          />
        )}

        {/* Portfolio capital (portfolio mode) */}
        {viewMode === 'portfolio' && portfolio.size > 0 && (
          <div className="flex items-center gap-2">
            <span className={cn('text-xs', textMuted)}>Capital:</span>
            <input
              type="text"
              value={`₹${(portfolioCapital / 100000).toFixed(0)}L`}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, '');
                if (raw) setPortfolioCapital(parseInt(raw) * 100000);
              }}
              className={cn(
                'w-20 px-2 py-1 rounded text-xs font-mono border outline-none text-center',
                isLight
                  ? 'bg-white border-gray-200 text-gray-900 focus:border-[#FF9933]'
                  : 'bg-zinc-900 border-zinc-700 text-[#FF9933] focus:border-[#FF9933]',
              )}
            />
          </div>
        )}

        {/* Selected stock badge */}
        {selectedTicker && viewMode === 'strategy' && (
          <div className="ml-auto flex items-center gap-2">
            <span className={cn('text-xs', textMuted)}>Selected:</span>
            <span className="text-xs font-mono font-bold text-[#FF9933]">{selectedTicker}</span>
            <button
              onClick={() => { setSelectedTicker(null); setSelectedPriceData(null); }}
              className={cn('text-xs px-1.5 py-0.5 rounded', isLight ? 'text-gray-400 hover:text-red-500' : 'text-zinc-500 hover:text-red-400')}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* ===== STRATEGY VIEW ===== */}
      {viewMode === 'strategy' && (
        <>
          {/* Sector tabs */}
          <div className="flex gap-1 overflow-x-auto scrollbar-hide pb-0.5">
            {SECTOR_ORDER.map((sector) => {
              const active = activeSector === sector;
              const color = SECTOR_COLORS[sector];
              const hasPortfolioStocks = getStocksBySector(sector).some((s) => portfolio.has(s.ticker));

              return (
                <button
                  key={sector}
                  onClick={() => { setActiveSector(sector); setSearch(''); }}
                  className={cn(
                    'relative px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-all shrink-0 border',
                    active
                      ? 'text-black'
                      : isLight
                        ? 'text-gray-500 border-transparent hover:bg-gray-100'
                        : 'text-zinc-400 border-transparent hover:bg-zinc-800/50',
                  )}
                  style={active ? { backgroundColor: color, borderColor: color } : undefined}
                >
                  {SECTOR_LABELS[sector]}
                  <span className={cn('ml-1 font-mono text-[10px]', active ? 'opacity-70' : 'opacity-40')}>
                    {sectorCounts[sector]}
                  </span>
                  {/* Portfolio dot indicator */}
                  {hasPortfolioStocks && !active && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#FF9933]" />
                  )}
                </button>
              );
            })}
            {/* Commodities pseudo-sector tab */}
            {(() => {
              const active = activeSector === COMMODITIES_TAB;
              return (
                <button
                  key={COMMODITIES_TAB}
                  onClick={() => { setActiveSector(COMMODITIES_TAB); setSearch(''); }}
                  className={cn(
                    'relative px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-all shrink-0 border',
                    active
                      ? 'text-black'
                      : isLight
                        ? 'text-gray-500 border-transparent hover:bg-gray-100'
                        : 'text-zinc-400 border-transparent hover:bg-zinc-800/50',
                  )}
                  style={active ? { backgroundColor: COMMODITIES_COLOR, borderColor: COMMODITIES_COLOR } : undefined}
                >
                  Commodities
                  <span className={cn('ml-1 font-mono text-[10px]', active ? 'opacity-70' : 'opacity-40')}>
                    {MCX_COMMODITIES.length}
                  </span>
                </button>
              );
            })()}
          </div>

          {/* Stock / Commodity grid card */}
          <div
            className={cn(
              'rounded-xl border overflow-hidden',
              isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800',
            )}
          >
            {activeSector === COMMODITIES_TAB ? (
              <CommodityGrid
                commodities={sectorCommodities}
                selectedSymbol={selectedTicker}
                onSelect={handleSelectStock}
                isLight={isLight}
              />
            ) : (
              <StockGrid
                stocks={sectorStocks}
                selectedTicker={selectedTicker}
                portfolio={portfolio}
                onSelect={handleSelectStock}
                onTogglePortfolio={handleTogglePortfolio}
                isLight={isLight}
              />
            )}
          </div>

          {/* Strategy Builder — always visible */}
          <StrategyBuilder
            stock={selectedInstrument}
            priceData={selectedPriceData}
            isLight={isLight}
            onClose={() => { setSelectedTicker(null); setSelectedPriceData(null); }}
          />

          {/* News feed — filtered to selected ticker or general when none */}
          <NewsPanel ticker={selectedTicker} isLight={isLight} />
        </>
      )}

      {/* ===== PORTFOLIO VIEW ===== */}
      {viewMode === 'portfolio' && (
        <PortfolioView
          stocks={portfolioStocks}
          portfolio={portfolio}
          capital={portfolioCapital}
          onRemove={(ticker) => setPortfolio((prev) => { const n = new Set(prev); n.delete(ticker); return n; })}
          onSelectStock={handleSelectStock}
          isLight={isLight}
          onOpenWizard={() => setShowWizard(true)}
          currentPortfolioSpec={currentPortfolioSpec}
          onLoadSaved={handleLoadSaved}
        />
      )}

      {/* ===== GOAL WIZARD (modal) ===== */}
      {showWizard && (
        <GoalWizard
          isLight={isLight}
          sectors={sectorsByTicker}
          names={namesByTicker}
          onApply={replacePortfolioTickers}
          onClose={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StockGrid — scrollable grid of compact stock cards, 15 visible
// ---------------------------------------------------------------------------

function StockGrid({
  stocks,
  selectedTicker,
  portfolio,
  onSelect,
  onTogglePortfolio,
  isLight,
}: {
  stocks: readonly IndiaStock[];
  selectedTicker: string | null;
  portfolio: Set<string>;
  onSelect: (ticker: string) => void;
  onTogglePortfolio: (ticker: string, e: React.MouseEvent) => void;
  isLight: boolean;
}) {
  const textMuted = isLight ? 'text-gray-500' : 'text-zinc-400';

  if (stocks.length === 0) {
    return (
      <div className={cn('px-4 py-8 text-center text-sm', textMuted)}>
        No stocks found.
      </div>
    );
  }

  return (
    <div className="max-h-[320px] overflow-y-auto scrollbar-thin">
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5 p-2">
        {stocks.map((stock) => {
          const inPortfolio = portfolio.has(stock.ticker);
          const isSelected = selectedTicker === stock.ticker;

          return (
            <div
              key={stock.ticker}
              onClick={() => onSelect(stock.ticker)}
              className={cn(
                'relative rounded-lg border px-2.5 py-2 cursor-pointer transition-all duration-150 group',
                isSelected
                  ? isLight
                    ? 'bg-[#FF9933]/10 border-[#FF9933] ring-1 ring-[#FF9933]/30'
                    : 'bg-[#FF9933]/10 border-[#FF9933] ring-1 ring-[#FF9933]/30'
                  : inPortfolio
                    ? isLight
                      ? 'bg-white border-[#FF9933]/50 shadow-[0_0_6px_rgba(255,153,51,0.15)]'
                      : 'bg-zinc-900/60 border-[#FF9933]/50 shadow-[0_0_6px_rgba(255,153,51,0.15)]'
                    : isLight
                      ? 'bg-white border-gray-100 hover:border-gray-300'
                      : 'bg-zinc-900/40 border-zinc-800/60 hover:border-zinc-600',
              )}
            >
              {/* Sharpe — top right */}
              <div className="absolute top-1.5 right-2 text-[10px] font-mono font-semibold text-[#FF9933]">
                --
              </div>

              {/* Portfolio star */}
              <button
                onClick={(e) => onTogglePortfolio(stock.ticker, e)}
                className={cn(
                  'absolute bottom-1.5 right-1.5 text-[10px] transition-all',
                  inPortfolio
                    ? 'text-[#FF9933]'
                    : cn('opacity-0 group-hover:opacity-100', isLight ? 'text-gray-300 hover:text-[#FF9933]' : 'text-zinc-600 hover:text-[#FF9933]'),
                )}
                title={inPortfolio ? 'Remove from portfolio' : 'Add to portfolio'}
              >
                {inPortfolio ? '★' : '☆'}
              </button>

              {/* Ticker */}
              <div className={cn('text-[11px] font-bold font-mono leading-tight', isLight ? 'text-gray-900' : 'text-zinc-100')}>
                {stock.ticker}
              </div>

              {/* Name */}
              <div className={cn('text-[9px] truncate leading-tight mt-0.5', textMuted)} title={stock.name}>
                {stock.name}
              </div>

              {/* Compact metrics row */}
              <div className="flex items-center gap-2 mt-1.5">
                <div>
                  <div className={cn('text-[7px] uppercase tracking-wider', isLight ? 'text-gray-500' : 'text-zinc-400')}>Lot</div>
                  <div className={cn('text-[10px] font-mono', isLight ? 'text-gray-600' : 'text-zinc-400')}>{stock.lot_size}</div>
                </div>
                <div>
                  <div className={cn('text-[7px] uppercase tracking-wider', isLight ? 'text-gray-500' : 'text-zinc-400')}>Price</div>
                  <div className={cn('text-[10px] font-mono', isLight ? 'text-gray-600' : 'text-zinc-400')}>--</div>
                </div>
                <div>
                  <div className={cn('text-[7px] uppercase tracking-wider', isLight ? 'text-gray-500' : 'text-zinc-400')}>1Y</div>
                  <div className={cn('text-[10px] font-mono', isLight ? 'text-gray-600' : 'text-zinc-400')}>--</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PortfolioView — portfolio optimisation UI
// ---------------------------------------------------------------------------

type AllocMethod = OptiAllocMethod | 'custom';

const ALLOC_METHODS: { id: AllocMethod; label: string; desc: string }[] = [
  { id: 'equal', label: 'Equal Weight', desc: 'Same allocation per stock' },
  { id: 'risk_parity', label: 'Risk Parity', desc: 'Weight by inverse volatility' },
  { id: 'inverse_vol', label: 'Inverse Vol', desc: 'Lower vol = more capital' },
  { id: 'min_variance', label: 'Min Variance', desc: 'Minimise portfolio risk' },
  { id: 'max_sharpe', label: 'Max Sharpe', desc: 'Maximise risk-adjusted return' },
  { id: 'max_diversification', label: 'Max Diversification', desc: 'Maximise diversification ratio' },
  // Custom weights deferred to future version
];

function PortfolioView({
  stocks,
  portfolio,
  capital,
  onRemove,
  onSelectStock,
  isLight,
  onOpenWizard,
  currentPortfolioSpec,
  onLoadSaved,
}: {
  stocks: IndiaStock[];
  portfolio: Set<string>;
  capital: number;
  onRemove: (ticker: string) => void;
  onSelectStock: (ticker: string) => void;
  isLight: boolean;
  onOpenWizard: () => void;
  currentPortfolioSpec: { tickers: string[]; weights: number[]; strategy: unknown } | null;
  onLoadSaved: (spec: SavedPortfolio) => void;
}) {
  const [allocMethod, setAllocMethod] = useState<AllocMethod>('equal');
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [perStockHistory, setPerStockHistory] = useState<Record<string, { dates: readonly string[]; close: readonly number[] }>>({});
  const textMuted = isLight ? 'text-gray-500' : 'text-zinc-400';

  // Load full price history for portfolio stocks (latest price + full close series)
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      stocks.map(async (stock) => {
        try {
          const data = await fetchPriceData(stock.ticker);
          if (!data || data.close.length === 0 || cancelled) return;
          setPrices((prev) => ({ ...prev, [stock.ticker]: data.close[data.close.length - 1] }));
          setPerStockHistory((prev) => ({
            ...prev,
            [stock.ticker]: { dates: data.dates, close: data.close },
          }));
        } catch { /* skip */ }
      }),
    );
    return () => { cancelled = true; };
  }, [stocks]);

  // Portfolio optimisation hook
  const { result: optResult, frontier, isLoading: optLoading, error: optError, run: runOptimisation } = usePortfolioOptimisation({
    tickers: stocks.map((s) => s.ticker),
    sectors: stocks.map((s) => s.sector),
    method: allocMethod === 'custom' ? 'equal' : allocMethod,
    constraints: { min_weight: 0, max_weight: 0.25, max_sector_weight: 0.40, long_only: true, max_positions: null },
    capital,
    lotSizes: stocks.map((s) => s.lot_size),
  });

  // Use optimised weights if available, else equal weight
  const weights = optResult ? optResult.weights : stocks.map(() => 1 / stocks.length);

  // All portfolio stocks have full history loaded?
  const allHistoryLoaded = stocks.length > 0 && stocks.every((s) => perStockHistory[s.ticker]);

  // Compute aligned daily returns, portfolio return series, and equity curve.
  // Alignment rule: intersect trading dates across all stocks (shortest history wins).
  const metricsData = useMemo(() => {
    if (!allHistoryLoaded || stocks.length === 0) return null;

    // Build per-stock date->close maps
    const maps: Map<string, number>[] = stocks.map((s) => {
      const h = perStockHistory[s.ticker];
      const m = new Map<string, number>();
      for (let i = 0; i < h.dates.length; i++) m.set(h.dates[i], h.close[i]);
      return m;
    });

    // Common date intersection — start from the shortest series, filter by presence in all others.
    let shortestIdx = 0;
    let shortestLen = perStockHistory[stocks[0].ticker].dates.length;
    for (let i = 1; i < stocks.length; i++) {
      const len = perStockHistory[stocks[i].ticker].dates.length;
      if (len < shortestLen) { shortestLen = len; shortestIdx = i; }
    }
    const candidateDates = perStockHistory[stocks[shortestIdx].ticker].dates;
    const commonDates: string[] = [];
    for (const d of candidateDates) {
      if (maps.every((m) => m.has(d))) commonDates.push(d);
    }
    if (commonDates.length < 2) return null;

    // Per-stock aligned close series + daily returns (rᵢ = pₜ/pₜ₋₁ − 1)
    const perAssetReturns: number[][] = stocks.map((_s, si) => {
      const m = maps[si];
      const rets: number[] = [];
      let prev = m.get(commonDates[0])!;
      for (let k = 1; k < commonDates.length; k++) {
        const cur = m.get(commonDates[k])!;
        rets.push(prev > 0 ? cur / prev - 1 : 0);
        prev = cur;
      }
      return rets;
    });

    // Portfolio returns: Σᵢ wᵢ rᵢ per day (weights length matches stocks length)
    const n = perAssetReturns[0]?.length ?? 0;
    const portfolioReturns: number[] = new Array(n).fill(0);
    for (let t = 0; t < n; t++) {
      let r = 0;
      for (let i = 0; i < stocks.length; i++) {
        r += (weights[i] ?? 0) * perAssetReturns[i][t];
      }
      portfolioReturns[t] = r;
    }

    // Equity curve: 100 × Π(1 + rₚ), aligned to returnDates (one shorter than commonDates).
    const equity: number[] = new Array(n);
    let eq = 100;
    for (let t = 0; t < n; t++) {
      eq *= 1 + portfolioReturns[t];
      equity[t] = eq;
    }
    const returnDates = commonDates.slice(1);

    return {
      portfolioReturns,
      portfolioEquityCurve: equity,
      dates: returnDates,
      perAssetReturns,
      weights,
      assetNames: stocks.map((s) => s.ticker),
    };
  }, [allHistoryLoaded, stocks, perStockHistory, weights]);

  if (stocks.length === 0) {
    return (
      <div className="space-y-3">
        <div className={cn(
          'rounded-xl border p-8 text-center',
          isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800',
        )}>
          <div className={cn('text-lg font-semibold mb-2', isLight ? 'text-gray-900' : 'text-zinc-100')}>
            No stocks in portfolio
          </div>
          <div className={cn('text-sm mb-3', textMuted)}>
            Switch to Strategy view, browse stocks, and click the ☆ icon to add stocks — or let the wizard pick for you.
          </div>
          <button
            onClick={onOpenWizard}
            className="px-3 py-1.5 rounded text-sm bg-indigo-600 hover:bg-indigo-500 text-white"
          >
            Open goal wizard
          </button>
        </div>
        <SavedPortfoliosPanel
          currentPortfolio={currentPortfolioSpec}
          onLoad={onLoadSaved}
          isLight={isLight}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Wizard + saved portfolios toolbar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <button
          onClick={onOpenWizard}
          className={cn(
            'rounded-xl border p-3 text-left transition-colors',
            isLight ? 'bg-white border-gray-200 hover:border-indigo-400' : 'bg-zinc-900/30 border-zinc-800 hover:border-indigo-500',
          )}
        >
          <div className={cn('text-[10px] uppercase tracking-wider font-semibold', textMuted)}>
            Goal wizard
          </div>
          <div className={cn('text-sm font-medium mt-0.5', isLight ? 'text-gray-900' : 'text-zinc-100')}>
            Replace with factor-ranked picks →
          </div>
        </button>
        <div className="lg:col-span-2">
          <SavedPortfoliosPanel
            currentPortfolio={currentPortfolioSpec}
            onLoad={onLoadSaved}
            isLight={isLight}
          />
        </div>
      </div>

      {/* Allocation method selector */}
      <div className={cn(
        'rounded-xl border p-3',
        isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800',
      )}>
        <div className={cn('text-[10px] uppercase tracking-wider font-semibold mb-2', textMuted)}>
          Allocation Method
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ALLOC_METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => setAllocMethod(m.id)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all',
                allocMethod === m.id
                  ? 'bg-[#FF9933]/15 border-[#FF9933]/40 text-[#FF9933]'
                  : isLight
                    ? 'border-gray-200 text-gray-500 hover:border-gray-300'
                    : 'border-zinc-700 text-zinc-400 hover:border-zinc-500',
              )}
              title={m.desc}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Portfolio stocks table */}
      <div className={cn(
        'rounded-xl border overflow-hidden',
        isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800',
      )}>
        <div className={cn(
          'grid grid-cols-[1fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr_0.3fr] gap-2 px-3 py-2 border-b text-[9px] font-semibold uppercase tracking-wider',
          isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-900/80 border-zinc-800',
          textMuted,
        )}>
          <div>Stock</div>
          <div className="text-right">Weight</div>
          <div className="text-right">Allocation</div>
          <div className="text-right">Price</div>
          <div className="text-right">Lot Size</div>
          <div className="text-right">Lots</div>
          <div></div>
        </div>

        <div className="max-h-[300px] overflow-y-auto">
          {stocks.map((stock, i) => {
            const weight = weights[i] ?? 1 / stocks.length;
            const allocation = capital * weight;
            const price = prices[stock.ticker];
            const lotValue = price ? stock.lot_size * price : null;
            const lots = lotValue ? Math.floor(allocation / lotValue) : null;

            return (
              <div
                key={stock.ticker}
                className={cn(
                  'grid grid-cols-[1fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr_0.3fr] gap-2 px-3 py-2 border-b items-center text-xs cursor-pointer transition-colors',
                  isLight ? 'border-gray-100 hover:bg-gray-50' : 'border-zinc-800/50 hover:bg-zinc-800/30',
                )}
                onClick={() => onSelectStock(stock.ticker)}
              >
                <div>
                  <span className={cn('font-mono font-bold text-[11px]', isLight ? 'text-gray-900' : 'text-zinc-100')}>
                    {stock.ticker}
                  </span>
                  <span className={cn('ml-2 text-[10px]', textMuted)}>{stock.name.slice(0, 20)}</span>
                </div>
                <div className="text-right font-mono text-[#FF9933]">{(weight * 100).toFixed(1)}%</div>
                <div className={cn('text-right font-mono', isLight ? 'text-gray-700' : 'text-zinc-300')}>
                  ₹{(allocation / 100000).toFixed(1)}L
                </div>
                <div className={cn('text-right font-mono', isLight ? 'text-gray-700' : 'text-zinc-300')}>
                  {price ? `₹${price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '--'}
                </div>
                <div className={cn('text-right font-mono', textMuted)}>{stock.lot_size}</div>
                <div className={cn('text-right font-mono', isLight ? 'text-gray-700' : 'text-zinc-300')}>{lots !== null ? lots : '--'}</div>
                <div className="text-right">
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(stock.ticker); }}
                    className={cn('text-[10px] px-1 rounded', isLight ? 'text-gray-400 hover:text-red-500' : 'text-zinc-500 hover:text-red-400')}
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary row */}
        <div className={cn(
          'grid grid-cols-[1fr_0.5fr_0.5fr_0.5fr_0.5fr_0.5fr_0.3fr] gap-2 px-3 py-2 text-xs font-semibold',
          isLight ? 'bg-gray-50 border-t border-gray-200' : 'bg-zinc-900/80 border-t border-zinc-800',
        )}>
          <div className={isLight ? 'text-gray-900' : 'text-zinc-100'}>Total ({stocks.length} stocks)</div>
          <div className="text-right font-mono text-[#FF9933]">100%</div>
          <div className={cn('text-right font-mono', isLight ? 'text-gray-900' : 'text-zinc-100')}>
            ₹{(capital / 100000).toFixed(0)}L
          </div>
          <div></div>
          <div></div>
          <div></div>
          <div></div>
        </div>
      </div>

      {/* Run Optimisation button */}
      <button
        onClick={runOptimisation}
        disabled={optLoading || stocks.length < 2}
        className={cn(
          'w-full py-2.5 rounded-lg text-sm font-semibold transition-colors',
          optLoading
            ? 'bg-[#FF9933]/50 text-black/50 cursor-wait'
            : stocks.length < 2
              ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
              : 'bg-[#FF9933] text-black hover:bg-[#FF9933]/90',
        )}
      >
        {optLoading ? 'Optimising...' : `Run Optimisation (${ALLOC_METHODS.find((m) => m.id === allocMethod)?.label ?? allocMethod})`}
      </button>

      {optError && (
        <div className="text-xs text-red-400 px-2">{optError}</div>
      )}

      {/* Optimisation results */}
      {optResult && (
        <div className="space-y-3">
          {/* Portfolio metrics */}
          <div className={cn('rounded-xl border p-4', isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold mb-3', textMuted)}>
              Portfolio Metrics
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricBox label="Expected Return" value={`${(optResult.expected_return * 100).toFixed(1)}%`} color="#22C55E" isLight={isLight} />
              <MetricBox label="Volatility" value={`${(optResult.volatility * 100).toFixed(1)}%`} color="#FF9933" isLight={isLight} />
              <MetricBox label="Sharpe Ratio" value={optResult.sharpe.toFixed(2)} color="#FF9933" isLight={isLight} />
              <MetricBox label="Diversification" value={optResult.diversification_ratio.toFixed(2)} color="#06B6D4" isLight={isLight} />
            </div>
          </div>

          {/* Risk contribution */}
          <div className={cn('rounded-xl border p-4', isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800')}>
            <div className={cn('text-[10px] uppercase tracking-wider font-semibold mb-3', textMuted)}>
              Risk Contribution
            </div>
            <div className="flex gap-1 h-6 rounded overflow-hidden">
              {stocks.map((stock, i) => {
                const rc = optResult.risk_contributions[i] ?? 0;
                if (rc < 0.01) return null;
                return (
                  <div
                    key={stock.ticker}
                    className="h-full flex items-center justify-center text-[8px] font-mono text-black font-bold"
                    style={{
                      width: `${rc * 100}%`,
                      backgroundColor: SECTOR_COLORS[stock.sector],
                      minWidth: rc > 0.03 ? undefined : '2px',
                    }}
                    title={`${stock.ticker}: ${(rc * 100).toFixed(1)}%`}
                  >
                    {rc > 0.06 ? stock.ticker : ''}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Efficient frontier */}
          {frontier && frontier.length > 0 && (
            <div className={cn('rounded-xl border p-4', isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800')}>
              <div className={cn('text-[10px] uppercase tracking-wider font-semibold mb-3', textMuted)}>
                Efficient Frontier
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <ScatterChart margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e5e7eb' : '#27272a'} />
                  <XAxis
                    dataKey="volatility"
                    type="number"
                    name="Vol"
                    tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                    tick={{ fontSize: 10, fill: isLight ? '#6b7280' : '#71717a' }}
                    stroke={isLight ? '#d1d5db' : '#3f3f46'}
                    label={{ value: 'Annualised Volatility', position: 'bottom', fontSize: 10, fill: isLight ? '#9ca3af' : '#52525b' }}
                  />
                  <YAxis
                    dataKey="return"
                    type="number"
                    name="Return"
                    tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                    tick={{ fontSize: 10, fill: isLight ? '#6b7280' : '#71717a' }}
                    stroke={isLight ? '#d1d5db' : '#3f3f46'}
                    label={{ value: 'Return', angle: -90, position: 'insideLeft', fontSize: 10, fill: isLight ? '#9ca3af' : '#52525b' }}
                  />
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload || payload.length === 0) return null;
                      const d = payload[0]?.payload;
                      if (!d) return null;
                      return (
                        <div className={cn('px-2.5 py-1.5 rounded-lg border text-[11px]', isLight ? 'bg-white border-gray-200' : 'bg-zinc-800 border-zinc-700')}>
                          <div><span className={isLight ? 'text-gray-500' : 'text-zinc-400'}>Return: </span><span className="font-mono text-[#22C55E]">{(d.return * 100).toFixed(1)}%</span></div>
                          <div><span className={isLight ? 'text-gray-500' : 'text-zinc-400'}>Vol: </span><span className="font-mono text-[#FF9933]">{(d.volatility * 100).toFixed(1)}%</span></div>
                          {d.sharpe !== undefined && <div><span className={isLight ? 'text-gray-500' : 'text-zinc-400'}>Sharpe: </span><span className="font-mono text-[#06B6D4]">{d.sharpe.toFixed(2)}</span></div>}
                        </div>
                      );
                    }}
                  />
                  <Scatter data={frontier.map((p) => ({ volatility: p.volatility, return: p.return, sharpe: p.sharpe }))} fill="#FF9933">
                    {frontier.map((_, i) => (
                      <Cell key={i} fill={i === frontier.length - 1 ? '#22C55E' : '#FF9933'} r={i === frontier.length - 1 ? 6 : 3} />
                    ))}
                  </Scatter>
                  {/* Current portfolio point */}
                  <Scatter
                    data={[{ volatility: optResult.volatility, return: optResult.expected_return }]}
                    fill="#22C55E"
                    shape="diamond"
                  >
                    <Cell fill="#22C55E" r={8} />
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Historical portfolio metrics panel (rolling Sharpe/vol, drawdowns, distribution) */}
      {stocks.length >= 2 && !allHistoryLoaded && (
        <div className={cn('rounded-xl border px-4 py-3 text-xs', isLight ? 'bg-white border-gray-200 text-gray-500' : 'bg-zinc-900/30 border-zinc-800 text-zinc-400')}>
          Loading price history for {stocks.length} stocks…
        </div>
      )}
      {metricsData && (
        <PortfolioMetricsPanel
          portfolioReturns={metricsData.portfolioReturns}
          portfolioEquityCurve={metricsData.portfolioEquityCurve}
          dates={metricsData.dates}
          perAssetReturns={metricsData.perAssetReturns}
          weights={metricsData.weights}
          assetNames={metricsData.assetNames}
          isLight={isLight}
        />
      )}
      {metricsData && (
        <DCAPanel
          equityCurve={metricsData.portfolioEquityCurve}
          dates={metricsData.dates}
          capital={capital}
          isLight={isLight}
        />
      )}

      {/* Placeholder when no results */}
      {!optResult && !optLoading && (
        <div className={cn(
          'rounded-xl border p-6 text-center',
          isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800',
        )}>
          <div className={cn('text-sm', textMuted)}>
            Select an allocation method and click &quot;Run Optimisation&quot; to see optimal weights, risk decomposition, and the efficient frontier.
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricBox — compact metric display for portfolio results
// ---------------------------------------------------------------------------

function MetricBox({ label, value, color, isLight }: { label: string; value: string; color: string; isLight: boolean }) {
  return (
    <div className={cn('rounded-lg border p-2.5', isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700')}>
      <div className={cn('text-[9px] uppercase tracking-wider', isLight ? 'text-gray-500' : 'text-zinc-400')}>{label}</div>
      <div className="text-lg font-mono font-bold" style={{ color }}>{value}</div>
    </div>
  );
}
