/**
 * India Equities - Portfolio Optimisation React Hook
 *
 * Loads price data for a basket of tickers, computes daily returns,
 * runs the optimiser, and generates the efficient frontier.
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { fetchPriceData } from './data';
import { dailyReturns } from './matrix';
import type {
  AllocMethod,
  EfficientFrontierPoint,
  OptimisationConfig,
  OptimisationResult,
} from './optimizer';
import { efficientFrontier, optimisePortfolio } from './optimizer';

// ---------------------------------------------------------------------------
// Hook Config & Return Types
// ---------------------------------------------------------------------------

interface PortfolioOptimisationConfig {
  readonly tickers: readonly string[];
  readonly sectors: readonly string[];
  readonly method: AllocMethod;
  readonly constraints: OptimisationConfig['constraints'];
  readonly capital: number;
  readonly lotSizes: readonly number[];
}

interface PortfolioOptimisationReturn {
  readonly result: OptimisationResult | null;
  readonly frontier: readonly EfficientFrontierPoint[] | null;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly run: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook to run portfolio optimisation for a basket of Indian equities.
 *
 * Call `run()` to trigger the computation. The hook loads price data,
 * computes returns, runs the optimiser, and generates the efficient frontier.
 *
 * @param config - tickers, sectors, method, constraints, capital, lotSizes
 * @returns result, frontier, isLoading, error, run
 */
export function usePortfolioOptimisation(
  config: PortfolioOptimisationConfig,
): PortfolioOptimisationReturn {
  const [result, setResult] = useState<OptimisationResult | null>(null);
  const [frontier, setFrontier] = useState<readonly EfficientFrontierPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(0);

  const run = useCallback(() => {
    const { tickers, sectors, method, constraints } = config;

    if (tickers.length === 0) {
      setError('No tickers selected');
      setResult(null);
      setFrontier(null);
      return;
    }

    const runId = ++abortRef.current;
    setIsLoading(true);
    setError(null);

    // 1. Load all price data in parallel
    const pricePromises = tickers.map((t) => fetchPriceData(t));

    Promise.all(pricePromises)
      .then((allPrices) => {
        if (abortRef.current !== runId) return;

        // 2. Compute daily returns for each stock
        const allReturns: number[][] = [];
        for (let i = 0; i < allPrices.length; i++) {
          const close = allPrices[i].close;
          if (!close || close.length < 2) {
            throw new Error(`Insufficient price data for ${tickers[i]}`);
          }
          const ret = dailyReturns(close);
          // Drop the first NaN element
          allReturns.push(ret.slice(1));
        }

        // 3. Build optimisation config
        const optConfig: OptimisationConfig = {
          method,
          constraints,
          sectors: [...sectors],
        };

        // 4. Run optimisation (synchronous, should be < 500ms for 20 stocks)
        // Use setTimeout to avoid blocking paint
        setTimeout(() => {
          if (abortRef.current !== runId) return;

          try {
            const optResult = optimisePortfolio(allReturns, optConfig);
            if (abortRef.current !== runId) return;

            setResult(optResult);

            // 5. Generate efficient frontier
            const frontierPoints = efficientFrontier(allReturns, optConfig);
            if (abortRef.current !== runId) return;

            setFrontier(frontierPoints);
            setIsLoading(false);
          } catch (err) {
            if (abortRef.current !== runId) return;
            setError(err instanceof Error ? err.message : 'Optimisation failed');
            setIsLoading(false);
          }
        }, 0);
      })
      .catch((err) => {
        if (abortRef.current !== runId) return;
        setError(err instanceof Error ? err.message : 'Failed to load price data');
        setIsLoading(false);
      });
  }, [config]);

  return { result, frontier, isLoading, error, run };
}
