/**
 * Diversification metrics for a portfolio of return streams.
 *
 * Pure functions. No side effects. Client-safe.
 */

const WEIGHT_SUM_TOLERANCE = 1e-6;

/** Sample standard deviation (n-1). Returns 0 for series with < 2 observations. */
function sampleStd(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mu = sum / n;
  let ss = 0;
  for (const v of values) {
    const d = v - mu;
    ss += d * d;
  }
  return Math.sqrt(ss / (n - 1));
}

/** Sample covariance between two equal-length series (n-1 divisor). */
function sampleCovariance(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const muA = sumA / n;
  const muB = sumB / n;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - muA) * (b[i] - muB);
  }
  return cov / (n - 1);
}

/**
 * Validate that all rows of `returnsMatrix` have the same length, and that
 * `weights.length === returnsMatrix.length`. Also checks weight sum ≈ 1.
 */
function validateInputs(
  returnsMatrix: readonly (readonly number[])[],
  weights: readonly number[],
): void {
  const k = returnsMatrix.length;
  if (k === 0) {
    throw new Error('diversificationRatio: returnsMatrix is empty');
  }
  if (weights.length !== k) {
    throw new Error(
      `diversificationRatio: weights length ${weights.length} !== assets ${k}`,
    );
  }
  const firstLen = returnsMatrix[0].length;
  for (let i = 1; i < k; i++) {
    if (returnsMatrix[i].length !== firstLen) {
      throw new Error(
        `diversificationRatio: row ${i} length ${returnsMatrix[i].length} !== row 0 length ${firstLen}`,
      );
    }
  }
  let weightSum = 0;
  for (const w of weights) weightSum += w;
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new Error(
      `diversificationRatio: weights sum to ${weightSum}, expected 1 (tolerance ${WEIGHT_SUM_TOLERANCE})`,
    );
  }
}

/**
 * Correlation matrix for a set of return series.
 *
 * `returnsMatrix[i]` is asset i's return history (all rows must be same length).
 * Returns a K×K matrix where entry [i][j] = corr(series_i, series_j).
 * Diagonal is 1 (or 0 if the series is constant — std = 0).
 */
export function correlationMatrix(
  returnsMatrix: readonly (readonly number[])[],
): number[][] {
  const k = returnsMatrix.length;
  if (k === 0) return [];

  const stds: number[] = returnsMatrix.map((row) => sampleStd(row));
  const out: number[][] = Array.from({ length: k }, () =>
    new Array<number>(k).fill(0),
  );

  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      if (i === j) {
        out[i][j] = stds[i] === 0 ? 0 : 1;
      } else {
        const cov = sampleCovariance(returnsMatrix[i], returnsMatrix[j]);
        const denom = stds[i] * stds[j];
        const corr = denom === 0 ? 0 : cov / denom;
        out[i][j] = corr;
        out[j][i] = corr;
      }
    }
  }
  return out;
}

/**
 * Choueifaty–Coignard diversification ratio:
 *
 *   DR = Σᵢ (wᵢ × σᵢ) / σ_portfolio
 *
 * where `σ_portfolio = sqrt(wᵀ Σ w)` and Σ is the covariance matrix.
 *
 * Properties:
 *   - Perfectly correlated assets → DR = 1
 *   - N uncorrelated equal-weight assets → DR = √N
 *   - Always ≥ 1 for long-only portfolios
 *
 * @throws if returnsMatrix rows differ in length, weights length mismatches,
 *         or weights don't sum to 1 within ε = 1e-6.
 */
export function diversificationRatio(
  returnsMatrix: readonly (readonly number[])[],
  weights: readonly number[],
): number {
  validateInputs(returnsMatrix, weights);

  const k = returnsMatrix.length;
  const stds: number[] = returnsMatrix.map((row) => sampleStd(row));

  // Numerator: weighted sum of asset vols.
  let numerator = 0;
  for (let i = 0; i < k; i++) {
    numerator += weights[i] * stds[i];
  }

  // Denominator: portfolio vol = sqrt(w^T Σ w).
  let portfolioVariance = 0;
  for (let i = 0; i < k; i++) {
    // Diagonal term: wᵢ² σᵢ²
    portfolioVariance += weights[i] * weights[i] * stds[i] * stds[i];
    // Off-diagonal (i != j): 2 × wᵢwⱼ cov(i,j)
    for (let j = i + 1; j < k; j++) {
      const cov = sampleCovariance(returnsMatrix[i], returnsMatrix[j]);
      portfolioVariance += 2 * weights[i] * weights[j] * cov;
    }
  }

  // Guard against tiny negative values from float drift.
  if (portfolioVariance <= 0) return 0;

  const portfolioStd = Math.sqrt(portfolioVariance);
  if (portfolioStd === 0) return 0;

  return numerator / portfolioStd;
}
