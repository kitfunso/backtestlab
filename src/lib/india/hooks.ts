'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { BacktestResult, PriceData, StrategyConfig } from './types';
import { runBacktest } from './backtest-engine';
import { detectInstrumentClass } from '@/lib/portfolio/transaction-costs';

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
    (prices: PriceData, cfg: StrategyConfig, lot: number, tkr: string) => {
      const id = ++abortRef.current;
      setIsLoading(true);
      setError(null);

      setTimeout(() => {
        if (abortRef.current !== id) return;
        try {
          const res = runBacktest(prices, cfg, lot, detectInstrumentClass(tkr));
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

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      runEngine(priceData, config, lotSize, ticker);
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ticker, lotSize, config, priceData, runEngine]);

  return { result, isLoading, error };
}
