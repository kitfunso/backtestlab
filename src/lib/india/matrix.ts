/**
 * India Equities - Matrix Math Utilities
 *
 * Covariance, correlation, matrix operations, and portfolio risk/return
 * calculations. Uses plain number[][] for simplicity and browser performance.
 */

// ---------------------------------------------------------------------------
// Statistical helpers
// ---------------------------------------------------------------------------

/** Arithmetic mean of an array, ignoring NaN values. Returns 0 for empty. */
function mean(arr: readonly number[]): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!isFinite(v)) continue;
    sum += v;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// ---------------------------------------------------------------------------
// Covariance & Correlation
// ---------------------------------------------------------------------------

/**
 * Compute the sample covariance matrix from daily returns.
 *
 * @param returns - [stock][day] array of daily returns
 * @returns N x N covariance matrix (sample covariance with Bessel correction)
 */
export function covarianceMatrix(returns: readonly (readonly number[])[]): number[][] {
  const n = returns.length;
  if (n === 0) return [];

  const T = returns[0].length;
  if (T < 2) return Array.from({ length: n }, () => new Array(n).fill(0));

  // Pre-compute means
  const means = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    means[i] = mean(returns[i]);
  }

  // Build covariance matrix (symmetric, so only compute upper triangle)
  const cov: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      let count = 0;
      const ri = returns[i];
      const rj = returns[j];
      const mi = means[i];
      const mj = means[j];

      for (let t = 0; t < T; t++) {
        if (!isFinite(ri[t]) || !isFinite(rj[t])) continue;
        sum += (ri[t] - mi) * (rj[t] - mj);
        count++;
      }

      const val = count > 1 ? sum / (count - 1) : 0;
      cov[i][j] = val;
      cov[j][i] = val;
    }
  }

  return cov;
}

/**
 * Compute the correlation matrix from a covariance matrix.
 *
 * @param cov - N x N covariance matrix
 * @returns N x N correlation matrix (diagonal = 1)
 */
export function correlationMatrix(cov: readonly (readonly number[])[]): number[][] {
  const n = cov.length;
  if (n === 0) return [];

  const corr: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const stdDevs = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    stdDevs[i] = Math.sqrt(Math.max(cov[i][i], 0));
  }

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) {
        corr[i][j] = 1;
      } else {
        const denom = stdDevs[i] * stdDevs[j];
        const val = denom > 1e-15 ? cov[i][j] / denom : 0;
        // Clamp to [-1, 1] for numerical safety
        const clamped = Math.max(-1, Math.min(1, val));
        corr[i][j] = clamped;
        corr[j][i] = clamped;
      }
    }
  }

  return corr;
}

// ---------------------------------------------------------------------------
// Matrix Operations
// ---------------------------------------------------------------------------

/**
 * Matrix multiply: A * B
 *
 * @param a - M x K matrix
 * @param b - K x N matrix
 * @returns M x N result matrix
 */
export function matMul(
  a: readonly (readonly number[])[],
  b: readonly (readonly number[])[],
): number[][] {
  const m = a.length;
  if (m === 0) return [];
  const k = a[0].length;
  const n = b[0]?.length ?? 0;

  const result: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));

  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let p = 0; p < k; p++) {
        sum += a[i][p] * b[p][j];
      }
      result[i][j] = sum;
    }
  }

  return result;
}

/**
 * Matrix-vector multiply: mat * vec
 *
 * @param mat - M x N matrix
 * @param vec - N-length vector
 * @returns M-length result vector
 */
export function matVecMul(
  mat: readonly (readonly number[])[],
  vec: readonly number[],
): number[] {
  const m = mat.length;
  const result = new Array<number>(m);

  for (let i = 0; i < m; i++) {
    let sum = 0;
    const row = mat[i];
    for (let j = 0; j < row.length; j++) {
      sum += row[j] * vec[j];
    }
    result[i] = sum;
  }

  return result;
}

/**
 * Dot product of two vectors.
 */
export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Portfolio Risk & Return
// ---------------------------------------------------------------------------

/**
 * Portfolio variance: w' * Sigma * w
 *
 * @param weights - N-length weight vector
 * @param cov - N x N covariance matrix
 * @returns Portfolio variance (scalar)
 */
export function portfolioVariance(
  weights: readonly number[],
  cov: readonly (readonly number[])[],
): number {
  const sigmaW = matVecMul(cov, weights);
  return Math.max(0, dot(weights, sigmaW));
}

/**
 * Portfolio expected return: w' * mu
 *
 * @param weights - N-length weight vector
 * @param returns - N-length expected return vector
 * @returns Portfolio expected return (scalar)
 */
export function portfolioReturn(
  weights: readonly number[],
  returns: readonly number[],
): number {
  return dot(weights, returns);
}

// ---------------------------------------------------------------------------
// Utility: compute daily returns from close prices
// ---------------------------------------------------------------------------

/**
 * Compute daily log returns from a close price series.
 * First element is NaN (no prior day).
 */
export function dailyReturns(close: readonly number[]): number[] {
  const n = close.length;
  const ret = new Array<number>(n);
  ret[0] = NaN;
  for (let i = 1; i < n; i++) {
    if (close[i - 1] > 0 && isFinite(close[i]) && isFinite(close[i - 1])) {
      ret[i] = (close[i] - close[i - 1]) / close[i - 1];
    } else {
      ret[i] = NaN;
    }
  }
  return ret;
}

/**
 * Compute annualised volatility from daily returns.
 * Uses 252 trading days per year.
 */
export function annualisedVol(dailyRet: readonly number[]): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let i = 0; i < dailyRet.length; i++) {
    const v = dailyRet[i];
    if (!isFinite(v)) continue;
    sum += v;
    sumSq += v * v;
    count++;
  }

  if (count < 2) return 0;
  const variance = (sumSq - (sum * sum) / count) / (count - 1);
  return Math.sqrt(Math.max(0, variance) * 252);
}

/**
 * Compute annualised mean return from daily returns.
 * Uses 252 trading days per year.
 */
export function annualisedReturn(dailyRet: readonly number[]): number {
  return mean(dailyRet) * 252;
}

/**
 * Regularise a covariance matrix using Ledoit-Wolf shrinkage toward the
 * diagonal (identity scaled by average variance). Prevents singularity
 * when N is close to T.
 *
 * @param cov - N x N sample covariance matrix
 * @param shrinkage - shrinkage intensity in [0, 1] (default 0.1)
 * @returns Regularised covariance matrix
 */
export function shrinkCovariance(
  cov: readonly (readonly number[])[],
  shrinkage = 0.1,
): number[][] {
  const n = cov.length;
  if (n === 0) return [];

  // Target: diagonal matrix with average variance
  let avgVar = 0;
  for (let i = 0; i < n; i++) {
    avgVar += cov[i][i];
  }
  avgVar /= n;

  const alpha = Math.max(0, Math.min(1, shrinkage));
  const result: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const target = i === j ? avgVar : 0;
      result[i][j] = (1 - alpha) * cov[i][j] + alpha * target;
    }
  }

  return result;
}
