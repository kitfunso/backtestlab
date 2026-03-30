/**
 * India Equities - React Hooks
 *
 * useBacktest: manages backtest computation with debounced config updates.
 * For now calls the engine directly; worker integration comes later.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { BacktestResult, PriceData, StrategyConfig } from './types';
import { runBacktest } from './backtest-engine';

interface UseBacktestOptions {
  ticker: string;
  lotSize: number;
  config: StrategyConfig | null;
  priceData: PriceData | null;
}

interface UseBacktestReturn {
  result: BacktestResult | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Runs the backtest engine with 300ms debounce on config changes.
 * Returns { result, isLoading, error }.
 */
export function useBacktest({
  ticker,
  lotSize,
  config,
  priceData,
}: UseBacktestOptions): UseBacktestReturn {
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(0);

  const runEngine = useCallback(
    (prices: PriceData, cfg: StrategyConfig, lot: number) => {
      const id = ++abortRef.current;
      setIsLoading(true);
      setError(null);

      // Use setTimeout to avoid blocking the main thread for large computations
      setTimeout(() => {
        if (abortRef.current !== id) return; // stale
        try {
          const res = runBacktest(prices, cfg, lot);
          if (abortRef.current === id) {
            setResult(res);
            setIsLoading(false);
          }
        } catch (err) {
          if (abortRef.current === id) {
            setError(err instanceof Error ? err.message : 'Backtest failed');
            setIsLoading(false);
          }
        }
      }, 0);
    },
    [],
  );

  useEffect(() => {
    if (!config || !priceData || config.indicators.length === 0) {
      setResult(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Debounce: 300ms
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      runEngine(priceData, config, lotSize);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ticker, lotSize, config, priceData, runEngine]);

  return { result, isLoading, error };
}
