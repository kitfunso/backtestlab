/**
 * India Equities - Price Data Fetcher
 *
 * Fetches price JSON from /india/prices/{TICKER}.json with in-memory caching.
 */

import type { PriceData } from './types';

const priceCache = new Map<string, PriceData>();

export async function fetchPriceData(ticker: string): Promise<PriceData> {
  const cached = priceCache.get(ticker);
  if (cached) return cached;

  const res = await fetch(`/india/prices/${encodeURIComponent(ticker)}.json`);
  if (!res.ok) {
    throw new Error(`Failed to fetch price data for ${ticker}: ${res.status}`);
  }

  const data: PriceData = await res.json();
  priceCache.set(ticker, data);
  return data;
}

/** Preload price data for a list of tickers (fire-and-forget). */
export function preloadPriceData(tickers: readonly string[]): void {
  for (const t of tickers) {
    if (!priceCache.has(t)) {
      fetchPriceData(t).catch(() => {
        // Silently ignore preload failures
      });
    }
  }
}

/** Check if price data is already cached. */
export function isPriceCached(ticker: string): boolean {
  return priceCache.has(ticker);
}

/** Clear the price cache (for testing). */
export function clearPriceCache(): void {
  priceCache.clear();
}
