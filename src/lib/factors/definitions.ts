/**
 * Price-derived single-stock factor definitions.
 *
 * Pure functions operating on raw close-price arrays (oldest first).
 * All returns a single `number` factor score, or `null` when the input
 * series is too short to satisfy the factor's lookback requirements.
 *
 * Conventions:
 *   - Closes are ordered oldest -> newest.
 *   - Daily returns are simple (p_t / p_{t-1} - 1).
 *   - 252 trading days = 1 year. 21 = ~1 month. 126 = ~6 months.
 *
 * Consumed by `scripts/build_factors.py` (re-implemented in Python) and
 * at runtime by `src/lib/factors/score.ts` (Sprint 2 Step 6).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Trading days per year. */
const DAYS_YEAR = 252;

/** Skip-month offset used by "12-1" / "6-1" momentum to avoid short reversal. */
const SKIP_DAYS = 21;

/** Short-term reversal lookback. */
const REVERSAL_DAYS = 5;

/** Dispersion lookback window. */
const DISPERSION_DAYS = 21;

/** 6-month momentum lookback. */
const MOM6_DAYS = 126;

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/** Simple daily returns. Length = closes.length - 1. */
function simpleReturns(closes: readonly number[]): number[] {
  const out: number[] = new Array(Math.max(closes.length - 1, 0));
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    out[i - 1] = prev === 0 ? 0 : closes[i] / prev - 1;
  }
  return out;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Sample standard deviation (n-1). Returns 0 when n < 2. */
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

// ---------------------------------------------------------------------------
// Momentum factors
// ---------------------------------------------------------------------------

/**
 * 12-minus-1 month momentum: return from t-252 to t-21.
 *
 * Skipping the most recent month is the standard Jegadeesh-Titman convention
 * that avoids contaminating momentum with short-term reversal.
 *
 * @param closes - Close-price series (oldest first).
 * @returns `(close_{t-21} / close_{t-252}) - 1`, or `null` if fewer than 253
 *          observations are available.
 */
export function momentum12_1(closes: readonly number[]): number | null {
  const n = closes.length;
  if (n < DAYS_YEAR + 1) return null;
  const start = closes[n - 1 - DAYS_YEAR];
  const end = closes[n - 1 - SKIP_DAYS];
  if (start <= 0) return null;
  return end / start - 1;
}

/**
 * 6-minus-1 month momentum: return from t-126 to t-21.
 *
 * @param closes - Close-price series (oldest first).
 * @returns `(close_{t-21} / close_{t-126}) - 1`, or `null` if fewer than 127
 *          observations are available.
 */
export function momentum6_1(closes: readonly number[]): number | null {
  const n = closes.length;
  if (n < MOM6_DAYS + 1) return null;
  const start = closes[n - 1 - MOM6_DAYS];
  const end = closes[n - 1 - SKIP_DAYS];
  if (start <= 0) return null;
  return end / start - 1;
}

// ---------------------------------------------------------------------------
// Short-term reversal
// ---------------------------------------------------------------------------

/**
 * Short-term reversal: negative of the last 5-day return.
 *
 * Stocks that sold off recently tend to bounce; this factor scores them
 * higher. Equivalent to `-(close_t / close_{t-5} - 1)`.
 *
 * @param closes - Close-price series (oldest first).
 * @returns `-(return_{t-5..t})`, or `null` if fewer than 6 observations.
 */
export function shortReversal(closes: readonly number[]): number | null {
  const n = closes.length;
  if (n < REVERSAL_DAYS + 1) return null;
  const start = closes[n - 1 - REVERSAL_DAYS];
  const end = closes[n - 1];
  if (start <= 0) return null;
  return -(end / start - 1);
}

// ---------------------------------------------------------------------------
// Volatility
// ---------------------------------------------------------------------------

/**
 * 252-day annualized volatility of daily simple returns.
 *
 * Lower values indicate a more stable price path — the "low-vol anomaly"
 * in the factor zoo. Sample std (n-1) scaled by sqrt(252).
 *
 * @param closes - Close-price series (oldest first).
 * @returns Annualized vol as a decimal (e.g. 0.25 = 25%), or `null` if fewer
 *          than 253 observations.
 */
export function volatility(closes: readonly number[]): number | null {
  const n = closes.length;
  if (n < DAYS_YEAR + 1) return null;
  const returns = simpleReturns(closes.slice(n - DAYS_YEAR - 1));
  const std = sampleStd(returns);
  return std * Math.sqrt(DAYS_YEAR);
}

// ---------------------------------------------------------------------------
// Downside beta
// ---------------------------------------------------------------------------

/**
 * Downside beta: beta of stock returns against market returns, conditional on
 * market-down days (market return < 0).
 *
 * Computed as `cov(r_stock, r_mkt | r_mkt < 0) / var(r_mkt | r_mkt < 0)` over
 * the trailing 252-day window.
 *
 * @param closes       - Stock close-price series (oldest first).
 * @param marketCloses - Market index close-price series, aligned with `closes`
 *                       (same length, same date index).
 * @returns Downside beta, or `null` if the two series differ in length, have
 *          fewer than 253 observations, or contain no market-down days.
 */
export function downsideBeta(
  closes: readonly number[],
  marketCloses: readonly number[],
): number | null {
  if (closes.length !== marketCloses.length) return null;
  const n = closes.length;
  if (n < DAYS_YEAR + 1) return null;

  const stockRet = simpleReturns(closes.slice(n - DAYS_YEAR - 1));
  const mktRet = simpleReturns(marketCloses.slice(n - DAYS_YEAR - 1));

  const downStock: number[] = [];
  const downMkt: number[] = [];
  for (let i = 0; i < mktRet.length; i++) {
    if (mktRet[i] < 0) {
      downStock.push(stockRet[i]);
      downMkt.push(mktRet[i]);
    }
  }
  if (downMkt.length < 2) return null;

  const muStock = mean(downStock);
  const muMkt = mean(downMkt);
  let cov = 0;
  let varMkt = 0;
  for (let i = 0; i < downMkt.length; i++) {
    const dm = downMkt[i] - muMkt;
    cov += (downStock[i] - muStock) * dm;
    varMkt += dm * dm;
  }
  if (varMkt === 0) return null;
  return cov / varMkt;
}

// ---------------------------------------------------------------------------
// Dispersion
// ---------------------------------------------------------------------------

/**
 * Intraday-range dispersion: mean of `(high - low) / close` over the last
 * 21 trading days.
 *
 * Higher values indicate noisier intraday price action; lower values indicate
 * tighter trading ranges. Used as a "quality of price path" factor — low
 * dispersion is typically preferred in defensive sleeves.
 *
 * @param closes - Close-price series (oldest first).
 * @param highs  - Daily high series, aligned with closes.
 * @param lows   - Daily low series, aligned with closes.
 * @returns Mean (high-low)/close over the trailing 21 days, or `null` if any
 *          array is shorter than 21 elements or arrays are misaligned.
 */
export function dispersion(
  closes: readonly number[],
  highs: readonly number[],
  lows: readonly number[],
): number | null {
  const n = closes.length;
  if (n !== highs.length || n !== lows.length) return null;
  if (n < DISPERSION_DAYS) return null;

  let sum = 0;
  let count = 0;
  for (let i = n - DISPERSION_DAYS; i < n; i++) {
    const c = closes[i];
    if (c <= 0) continue;
    sum += (highs[i] - lows[i]) / c;
    count++;
  }
  if (count === 0) return null;
  return sum / count;
}
