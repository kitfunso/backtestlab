'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NewsItem {
  readonly title: string;
  readonly url: string;
  readonly source: string;
  readonly published: string; // ISO8601
  readonly tickers: readonly string[];
}

interface NewsPayload {
  readonly updated_at: string;
  readonly items: readonly NewsItem[];
}

interface NewsPanelProps {
  readonly ticker: string | null;
  readonly isLight?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 min — matches server cron
const MAX_RENDERED_ITEMS = 20;
const NEWS_URL = '/india/news.json';

// ---------------------------------------------------------------------------
// Helpers (local — no date-fns)
// ---------------------------------------------------------------------------

function relativeTime(iso: string, now: number): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  const diffWk = Math.round(diffDay / 7);
  if (diffWk < 5) return `${diffWk}w ago`;
  const diffMo = Math.round(diffDay / 30);
  return `${diffMo}mo ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NewsPanel({ ticker, isLight = false }: NewsPanelProps) {
  const [payload, setPayload] = useState<NewsPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // `now` is stored in state so relative timestamps re-render on refresh.
  const [now, setNow] = useState<number>(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${NEWS_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as NewsPayload;
      setPayload(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load news.');
    } finally {
      setIsLoading(false);
      setNow(Date.now());
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load();
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const filtered = useMemo<readonly NewsItem[]>(() => {
    if (!payload) return [];
    if (ticker) {
      return payload.items.filter((item) => item.tickers.includes(ticker));
    }
    return payload.items.slice(0, MAX_RENDERED_ITEMS);
  }, [payload, ticker]);

  const rendered = filtered.slice(0, MAX_RENDERED_ITEMS);

  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800';
  const textMuted = isLight ? 'text-gray-500' : 'text-zinc-400';
  const textStrong = isLight ? 'text-gray-900' : 'text-zinc-100';
  const rowBorder = isLight ? 'border-gray-100' : 'border-zinc-800/50';
  const linkHover = isLight ? 'hover:text-cyan-700' : 'hover:text-cyan-400';
  const chipBg = isLight ? 'bg-gray-100 text-gray-600' : 'bg-zinc-800 text-zinc-400';

  const heading = ticker ? `News — ${ticker}` : 'Market News';

  return (
    <div className={cn('rounded-xl border overflow-hidden', cardBg)}>
      <div
        className={cn(
          'px-3 py-2 flex items-center justify-between border-b',
          isLight ? 'border-gray-200' : 'border-zinc-800',
        )}
      >
        <div className={cn('text-[10px] uppercase tracking-wider font-semibold', textMuted)}>
          {heading}
        </div>
        {payload ? (
          <div className={cn('text-[9px] font-mono', textMuted)}>
            updated {relativeTime(payload.updated_at, now)}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className={cn('px-3 py-6 text-xs text-center', textMuted)}>Loading news…</div>
      ) : error ? (
        <div className={cn('px-3 py-6 text-xs text-center', textMuted)}>
          Could not load news ({error}).
        </div>
      ) : rendered.length === 0 ? (
        <div className={cn('px-3 py-6 text-xs text-center', textMuted)}>
          {ticker
            ? `No recent headlines tagged ${ticker}.`
            : 'No headlines available right now.'}
        </div>
      ) : (
        <ul className="divide-y">
          {rendered.map((item) => (
            <li key={item.url} className={cn('px-3 py-2.5 border-t first:border-t-0', rowBorder)}>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('block text-xs font-medium leading-snug', textStrong, linkHover)}
              >
                {item.title}
              </a>
              <div className="mt-1 flex items-center gap-2 text-[10px] font-mono">
                <span className={cn('px-1.5 py-[1px] rounded', chipBg)}>{item.source}</span>
                <span className={textMuted}>{relativeTime(item.published, now)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
