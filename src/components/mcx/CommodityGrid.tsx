'use client';

/**
 * CommodityGrid — compact grid of MCX commodity cards.
 *
 * Parallel to `StockGrid` in NiftyTab.tsx. Kept separate because commodities
 * have different metadata (tick_size, contract_size, kind) and no GICS sector,
 * so a shared adapter would be more code than a focused component.
 */

import { cn } from '@/lib/utils';
import type { MCXCommodity } from '@/lib/mcx/types';
import type { PriceSummary } from '@/lib/india/prices-summary';

interface CommodityGridProps {
  readonly commodities: readonly MCXCommodity[];
  readonly selectedSymbol: string | null;
  readonly onSelect: (symbol: string) => void;
  readonly isLight: boolean;
  readonly prices: Record<string, PriceSummary> | null;
}

export function CommodityGrid({
  commodities,
  selectedSymbol,
  onSelect,
  isLight,
  prices,
}: CommodityGridProps) {
  const textMuted = isLight ? 'text-gray-500' : 'text-zinc-400';

  if (commodities.length === 0) {
    return (
      <div className={cn('px-4 py-8 text-center text-sm', textMuted)}>
        No commodities found.
      </div>
    );
  }

  return (
    <div className="max-h-[320px] overflow-y-auto scrollbar-thin">
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5 p-2">
        {commodities.map((c) => {
          const isSelected = selectedSymbol === c.symbol;
          const px = prices?.[c.symbol] ?? null;
          return (
            <div
              key={c.symbol}
              onClick={() => onSelect(c.symbol)}
              className={cn(
                'relative rounded-lg border px-2.5 py-2 cursor-pointer transition-all duration-150',
                isSelected
                  ? 'bg-[#FF9933]/10 border-[#FF9933] ring-1 ring-[#FF9933]/30'
                  : isLight
                    ? 'bg-white border-gray-100 hover:border-gray-300'
                    : 'bg-zinc-900/40 border-zinc-800/60 hover:border-zinc-600',
              )}
            >
              {/* 1Y return — top right */}
              <div
                className={cn(
                  'absolute top-1.5 right-2 text-[10px] font-mono font-semibold',
                  px?.yr1_pct == null
                    ? textMuted
                    : px.yr1_pct >= 0
                      ? 'text-emerald-500'
                      : 'text-red-500',
                )}
              >
                {px?.yr1_pct == null ? '--' : `${px.yr1_pct >= 0 ? '+' : ''}${(px.yr1_pct * 100).toFixed(0)}%`}
              </div>

              {/* Kind badge — below the 1Y chip */}
              <div
                className={cn(
                  'absolute top-5 right-2 text-[8px] font-mono uppercase tracking-wider',
                  c.kind === 'index' ? 'text-cyan-400' : 'text-[#FF9933]',
                )}
              >
                {c.kind === 'index' ? 'IDX' : 'SPOT'}
              </div>

              {/* Symbol */}
              <div className={cn('text-[11px] font-bold font-mono leading-tight', isLight ? 'text-gray-900' : 'text-zinc-100')}>
                {c.symbol}
              </div>

              {/* Name */}
              <div className={cn('text-[9px] truncate leading-tight mt-0.5', textMuted)} title={c.name}>
                {c.name}
              </div>

              {/* Metrics row: price / lot / tick */}
              <div className="flex items-center gap-2 mt-1.5">
                <div>
                  <div className={cn('text-[7px] uppercase tracking-wider', textMuted)}>Price</div>
                  <div className={cn('text-[10px] font-mono', isLight ? 'text-gray-700' : 'text-zinc-300')}>
                    {px ? (px.close >= 1e5 ? `₹${(px.close / 1e5).toFixed(2)}L` : `₹${px.close.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`) : '--'}
                  </div>
                </div>
                <div>
                  <div className={cn('text-[7px] uppercase tracking-wider', textMuted)}>Lot</div>
                  <div className={cn('text-[10px] font-mono', isLight ? 'text-gray-600' : 'text-zinc-400')}>{c.lot_size}</div>
                </div>
                <div>
                  <div className={cn('text-[7px] uppercase tracking-wider', textMuted)}>Tick</div>
                  <div className={cn('text-[10px] font-mono', isLight ? 'text-gray-600' : 'text-zinc-400')}>{c.tick_size}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
