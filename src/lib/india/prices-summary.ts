import { useEffect, useState } from 'react';

export interface PriceSummary {
  readonly close: number;
  readonly yr1_pct: number | null;
  readonly date: string;
}

export interface PricesSummaryFile {
  readonly generated_at: string;
  readonly stocks: Record<string, PriceSummary>;
  readonly mcx: Record<string, PriceSummary>;
}

export function usePricesSummary(): PricesSummaryFile | null {
  const [data, setData] = useState<PricesSummaryFile | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/india/prices-summary.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PricesSummaryFile | null) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}

export function formatPrice(v: number): string {
  if (!Number.isFinite(v)) return '--';
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1)}L`;
  if (v >= 1000) return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return `₹${v.toFixed(2)}`;
}

export function formatYr1Pct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '--';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
}
