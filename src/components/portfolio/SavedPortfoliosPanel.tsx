'use client';

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  deletePortfolio,
  listPortfolios,
  loadPortfolio,
  savePortfolio,
  type SavedPortfolio,
  type SavedPortfolioSummary,
} from '@/lib/portfolio/storage';

interface SavedPortfoliosPanelProps {
  readonly currentPortfolio: {
    readonly tickers: readonly string[];
    readonly weights: readonly number[];
    readonly strategy: unknown;
  } | null;
  readonly onLoad: (spec: SavedPortfolio) => void;
  readonly isLight?: boolean;
}

/** Human-friendly "updated Xd ago" / "Xh ago" / "just now" label. */
function updatedAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const diffMs = Math.max(0, now - t);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function SavedPortfoliosPanel({
  currentPortfolio,
  onLoad,
  isLight = false,
}: SavedPortfoliosPanelProps) {
  const [items, setItems] = useState<SavedPortfolioSummary[]>([]);

  const refresh = useCallback(() => {
    setItems(listPortfolios());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const canSave =
    currentPortfolio !== null && currentPortfolio.tickers.length > 0;

  const handleSave = useCallback(() => {
    if (!canSave || currentPortfolio === null) return;
    const name = window.prompt('Name this portfolio:');
    if (name === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    savePortfolio(trimmed, {
      tickers: [...currentPortfolio.tickers],
      weights: [...currentPortfolio.weights],
      strategy: currentPortfolio.strategy,
    });
    refresh();
  }, [canSave, currentPortfolio, refresh]);

  const handleLoad = useCallback(
    (name: string) => {
      const record = loadPortfolio(name);
      if (record === null) return;
      onLoad(record);
    },
    [onLoad],
  );

  const handleDelete = useCallback(
    (name: string) => {
      const ok = window.confirm(`Delete "${name}"? This cannot be undone.`);
      if (!ok) return;
      deletePortfolio(name);
      refresh();
    },
    [refresh],
  );

  // Styling tokens mirror PortfolioMetricsPanel so both panels read as a set.
  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800';
  const rowBg = isLight ? 'hover:bg-gray-50' : 'hover:bg-zinc-800/50';
  const rowBorder = isLight ? 'border-gray-100' : 'border-zinc-800/50';
  const textMuted = isLight ? 'text-gray-500' : 'text-zinc-400';
  const textStrong = isLight ? 'text-gray-900' : 'text-zinc-100';
  const saveBtn = canSave
    ? 'bg-[#FF9933] text-white hover:bg-[#e6851f] cursor-pointer'
    : isLight
      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
      : 'bg-zinc-800 text-zinc-500 cursor-not-allowed';
  const deleteBtn = isLight
    ? 'text-gray-400 hover:text-red-500'
    : 'text-zinc-500 hover:text-red-400';

  return (
    <div className={cn('rounded-xl border overflow-hidden', cardBg)}>
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2 border-b',
          isLight ? 'border-gray-200' : 'border-zinc-800',
        )}
      >
        <div className={cn('text-[10px] uppercase tracking-wider font-semibold', textMuted)}>
          Saved Portfolios
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className={cn('text-xs font-medium rounded-md px-2.5 py-1 transition', saveBtn)}
        >
          Save current
        </button>
      </div>

      {items.length === 0 ? (
        <div className={cn('px-3 py-6 text-xs text-center', textMuted)}>
          No saved portfolios yet. Build one and click Save.
        </div>
      ) : (
        <ul>
          {items.map((item) => (
            <li
              key={item.name}
              className={cn(
                'flex items-center justify-between gap-2 px-3 py-2 border-t text-xs transition',
                rowBorder,
                rowBg,
              )}
            >
              <button
                type="button"
                onClick={() => handleLoad(item.name)}
                className="flex-1 min-w-0 text-left"
              >
                <div className={cn('truncate font-medium', textStrong)}>{item.name}</div>
                <div className={cn('text-[10px]', textMuted)}>
                  updated {updatedAgo(item.updatedAt)}
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(item.name)}
                aria-label={`Delete ${item.name}`}
                className={cn('p-1 rounded transition', deleteBtn)}
              >
                <X size={14} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
