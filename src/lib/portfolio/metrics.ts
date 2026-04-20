/**
 * Portfolio-level metrics.
 *
 * Pure functions. No side effects. Client-safe (no Node-only APIs).
 * All annualization assumes 252 trading days / year. Risk-free default 6% INR.
 *
 * Consumes outputs from `src/lib/india/backtest-engine.ts` — does not recompute
 * returns or equity curves.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Trading days per year used for annualization. */
const TRADING_DAYS_PER_YEAR = 252;

/** Square root of trading days, cached. */
const SQRT_TRADING_DAYS = Math.sqrt(TRADING_DAYS_PER_YEAR);

/** Default rolling window (~6 months of trading days). */
const DEFAULT_ROLLING_WINDOW = 126;

/** Default risk-free rate (6% annual, India government bond proxy). */
const DEFAULT_RF_RATE = 0.06;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrawdownInfo {
  readonly peakDate: string;
  readonly peakValue: number;
  readonly troughDate: string;
  readonly troughValue: number;
  readonly recoveryDate: string | null;
  /** Drawdown magnitude as a positive decimal (e.g. 0.25 = 25% drawdown). */
  readonly drawdownPct: number;
  /** Calendar-index days from peak to trough. */
  readonly durationDays: number;
}

export interface ReturnBucket {
  readonly bucketMin: number;
  readonly bucketMax: number;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (n-1 divisor). Returns 0 when n < 2. */
function sampleStd(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mu = mean(values);
  let ss = 0;
  for (const v of values) {
    const d = v - mu;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1));
}

/** Sliding-window std over `returns`. Emits `null` for indices before window-1. */
function rollingStd(
  returns: readonly number[],
  window: number,
): (number | null)[] {
  const n = returns.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (window < 2 || n < window) return out;

  for (let i = window - 1; i < n; i++) {
    const slice = returns.slice(i - window + 1, i + 1);
    out[i] = sampleStd(slice);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Volatility + Sharpe
// ---------------------------------------------------------------------------

/**
 * Annualized volatility of a return series: std × √252.
 * Uses sample std (n-1). Returns 0 for series with < 2 observations.
 */
export function annualizedVolatility(returns: readonly number[]): number {
  return sampleStd(returns) * SQRT_TRADING_DAYS;
}

/**
 * Rolling annualized volatility.
 *
 * @param returns - Daily return series (decimal, e.g. 0.01 = 1%).
 * @param window - Rolling window size in trading days. Default 126 (~6 months).
 * @returns Array the same length as `returns`. Indices < window-1 are `null`.
 */
export function rollingVolatility(
  returns: readonly number[],
  window: number = DEFAULT_ROLLING_WINDOW,
): (number | null)[] {
  const stds = rollingStd(returns, window);
  return stds.map((s) => (s === null ? null : s * SQRT_TRADING_DAYS));
}

/**
 * Rolling annualized Sharpe ratio.
 *
 * `(mean(r) - dailyRf) / std(r) * √252`, where `dailyRf = rfRate / 252`.
 *
 * @param returns - Daily return series.
 * @param window - Rolling window in trading days. Default 126.
 * @param rfRate - Annual risk-free rate (decimal). Default 0.06 (6% INR).
 * @returns Array the same length as `returns`. Indices < window-1 are `null`.
 *          Entries where rolling std is 0 are `null` (undefined ratio).
 */
export function rollingSharpe(
  returns: readonly number[],
  window: number = DEFAULT_ROLLING_WINDOW,
  rfRate: number = DEFAULT_RF_RATE,
): (number | null)[] {
  const n = returns.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (window < 2 || n < window) return out;

  const dailyRf = rfRate / TRADING_DAYS_PER_YEAR;

  for (let i = window - 1; i < n; i++) {
    const slice = returns.slice(i - window + 1, i + 1);
    const sd = sampleStd(slice);
    if (sd === 0) {
      out[i] = null;
      continue;
    }
    const excess = mean(slice) - dailyRf;
    out[i] = (excess / sd) * SQRT_TRADING_DAYS;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawdowns
// ---------------------------------------------------------------------------

/**
 * Extract top-N non-overlapping drawdown windows, ordered by depth (deepest first).
 *
 * A drawdown is defined by three points:
 *   - peak:     the running high before the decline
 *   - trough:   the local minimum between peak and recovery (or end)
 *   - recovery: first index where equity returns to or above the peak (or null)
 *
 * Non-overlapping: once a drawdown closes (recovery or end), the next window
 * starts from the recovery point forward.
 *
 * @param equityCurve - Portfolio equity values (same length as `dates`).
 * @param dates       - ISO date strings corresponding to equityCurve.
 * @param n           - Max number of drawdowns to return. Default 5.
 */
export function topDrawdowns(
  equityCurve: readonly number[],
  dates: readonly string[],
  n: number = 5,
): DrawdownInfo[] {
  if (equityCurve.length !== dates.length) {
    throw new Error(
      `topDrawdowns: equityCurve length ${equityCurve.length} !== dates length ${dates.length}`,
    );
  }
  const len = equityCurve.length;
  if (len === 0) return [];

  const windows: DrawdownInfo[] = [];

  let i = 0;
  while (i < len) {
    // Establish a peak at i (equityCurve[i]). Walk forward looking for decline.
    let peakIdx = i;
    let peakVal = equityCurve[i];

    // Advance peak while curve keeps making new highs.
    let j = i + 1;
    while (j < len && equityCurve[j] >= peakVal) {
      peakIdx = j;
      peakVal = equityCurve[j];
      j++;
    }

    // j is either past end, or the first point below peakVal.
    if (j >= len) break;

    // From j forward, find trough (min) until recovery (>= peakVal) or end.
    let troughIdx = j;
    let troughVal = equityCurve[j];
    let recoveryIdx: number | null = null;

    let k = j;
    while (k < len) {
      if (equityCurve[k] < troughVal) {
        troughVal = equityCurve[k];
        troughIdx = k;
      }
      if (equityCurve[k] >= peakVal) {
        recoveryIdx = k;
        break;
      }
      k++;
    }

    const drawdownPct = peakVal > 0 ? (peakVal - troughVal) / peakVal : 0;
    windows.push({
      peakDate: dates[peakIdx],
      peakValue: peakVal,
      troughDate: dates[troughIdx],
      troughValue: troughVal,
      recoveryDate: recoveryIdx === null ? null : dates[recoveryIdx],
      drawdownPct,
      durationDays: troughIdx - peakIdx,
    });

    // Advance i: if recovered, continue from recovery; else we're done.
    if (recoveryIdx === null) break;
    i = recoveryIdx;
  }

  // Order by depth (deepest first) and cap at n.
  windows.sort((a, b) => b.drawdownPct - a.drawdownPct);
  return windows.slice(0, n);
}

/**
 * Maximum drawdown of an equity curve, as a positive decimal.
 * Internal helper used by `calmar`.
 */
function maxDrawdown(equityCurve: readonly number[]): number {
  if (equityCurve.length === 0) return 0;
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = (peak - v) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }
  return maxDd;
}

// ---------------------------------------------------------------------------
// Sortino + Calmar
// ---------------------------------------------------------------------------

/**
 * Annualized Sortino ratio.
 *
 * Numerator:   `(mean(r) - target) * 252`
 * Denominator: downside deviation annualized = `sqrt(mean(min(r - target, 0)^2)) * √252`
 *
 * Downside deviation denominator uses ALL observations (not just negative ones),
 * which is the Sortino/Kaplan convention. Returns 0 if downside deviation is 0
 * (no observations below target — avoids Infinity).
 *
 * @param returns      - Daily return series.
 * @param targetReturn - Minimum-acceptable daily return. Default 0.
 */
export function sortino(
  returns: readonly number[],
  targetReturn: number = 0,
): number {
  if (returns.length === 0) return 0;

  let squaredDownsideSum = 0;
  for (const r of returns) {
    const shortfall = Math.min(r - targetReturn, 0);
    squaredDownsideSum += shortfall * shortfall;
  }
  const downsideDev = Math.sqrt(squaredDownsideSum / returns.length);
  if (downsideDev === 0) return 0;

  const excessDaily = mean(returns) - targetReturn;
  // Numerator annualized by * 252; denominator by * √252. Ratio: (excess * √252) / downsideDev.
  return (excessDaily * TRADING_DAYS_PER_YEAR) / (downsideDev * SQRT_TRADING_DAYS);
}

/**
 * Calmar ratio: annualized mean return ÷ absolute max drawdown.
 *
 * Returns 0 if max drawdown is 0 (no downside — avoids Infinity).
 */
export function calmar(
  returns: readonly number[],
  equityCurve: readonly number[],
): number {
  if (returns.length === 0 || equityCurve.length === 0) return 0;
  const maxDd = maxDrawdown(equityCurve);
  if (maxDd === 0) return 0;
  const annualReturn = mean(returns) * TRADING_DAYS_PER_YEAR;
  return annualReturn / maxDd;
}

// ---------------------------------------------------------------------------
// Return distribution
// ---------------------------------------------------------------------------

/**
 * Histogram of a return series over `buckets` linearly-spaced bins in [min, max].
 *
 * The last bucket is inclusive of max so that every observation lands somewhere.
 * Sum of bucket counts equals `returns.length`.
 *
 * @param returns - Return series (any scale; buckets adapt to its range).
 * @param buckets - Number of bins. Default 30.
 */
export function returnDistribution(
  returns: readonly number[],
  buckets: number = 30,
): ReturnBucket[] {
  if (returns.length === 0 || buckets <= 0) return [];

  let min = returns[0];
  let max = returns[0];
  for (const r of returns) {
    if (r < min) min = r;
    if (r > max) max = r;
  }

  // Degenerate case: all values identical. One bucket containing everything.
  if (min === max) {
    return [{ bucketMin: min, bucketMax: max, count: returns.length }];
  }

  const width = (max - min) / buckets;
  const counts = new Array<number>(buckets).fill(0);

  for (const r of returns) {
    let idx = Math.floor((r - min) / width);
    if (idx >= buckets) idx = buckets - 1; // include the max value in last bucket
    if (idx < 0) idx = 0;
    counts[idx]++;
  }

  const result: ReturnBucket[] = [];
  for (let b = 0; b < buckets; b++) {
    result.push({
      bucketMin: min + b * width,
      bucketMax: min + (b + 1) * width,
      count: counts[b],
    });
  }
  return result;
}
