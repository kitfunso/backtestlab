/**
 * India Equities - Portfolio Optimisation Engine
 *
 * Seven allocation methods (equal, inverse_vol, risk_parity, min_variance,
 * max_sharpe, max_diversification, target_vol) with constrained gradient
 * descent. Runs entirely in the browser.
 */

import {
  annualisedReturn,
  annualisedVol,
  covarianceMatrix,
  dailyReturns,
  dot,
  matVecMul,
  portfolioReturn,
  portfolioVariance,
  shrinkCovariance,
} from './matrix';

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface OptimisationResult {
  readonly weights: number[];
  readonly expected_return: number;
  readonly volatility: number;
  readonly sharpe: number;
  readonly diversification_ratio: number;
  readonly risk_contributions: number[];
}

export interface OptimisationConstraints {
  readonly min_weight: number;
  readonly max_weight: number;
  readonly max_sector_weight: number;
  readonly long_only: boolean;
  readonly max_positions: number | null;
  readonly target_vol?: number;
}

export type AllocMethod =
  | 'equal'
  | 'risk_parity'
  | 'inverse_vol'
  | 'min_variance'
  | 'max_sharpe'
  | 'max_diversification'
  | 'target_vol';

export interface OptimisationConfig {
  readonly method: AllocMethod;
  readonly constraints: OptimisationConstraints;
  readonly sectors: readonly string[];
}

export interface EfficientFrontierPoint {
  readonly return: number;
  readonly volatility: number;
  readonly sharpe: number;
  readonly weights: number[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRADING_DAYS = 252;
const RF_RATE = 0.06; // India risk-free proxy (~6% p.a.)
const MAX_ITER = 1000;
const CONVERGENCE_TOL = 1e-8;

// ---------------------------------------------------------------------------
// Default constraints
// ---------------------------------------------------------------------------

export const DEFAULT_CONSTRAINTS: OptimisationConstraints = {
  min_weight: 0,
  max_weight: 0.25,
  max_sector_weight: 0.40,
  long_only: true,
  max_positions: null,
};

// ---------------------------------------------------------------------------
// Main Entry Points
// ---------------------------------------------------------------------------

/**
 * Optimise portfolio weights given daily returns per stock.
 *
 * @param returns - [stock][day] daily returns (simple, not log)
 * @param config  - method, constraints, sector labels
 * @returns Optimisation result with weights, metrics, risk decomposition
 */
export function optimisePortfolio(
  returns: readonly (readonly number[])[],
  config: OptimisationConfig,
): OptimisationResult {
  const n = returns.length;

  // Edge case: empty portfolio
  if (n === 0) {
    return emptyResult();
  }

  // Edge case: single stock
  if (n === 1) {
    return singleStockResult(returns[0]);
  }

  // Align returns: find the common date range where all stocks have data
  const aligned = alignReturns(returns);
  if (aligned.T < 20) {
    // Not enough overlapping data; fall back to equal weight
    return buildResult(equalWeights(n), returns);
  }

  // Compute covariance matrix with Ledoit-Wolf shrinkage
  const rawCov = covarianceMatrix(aligned.matrix);
  const cov = shrinkCovariance(rawCov, computeShrinkageIntensity(n, aligned.T));

  // Compute annualised expected returns per stock
  const mu = new Array<number>(n);
  const sigma = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    mu[i] = annualisedReturn(aligned.matrix[i]);
    sigma[i] = annualisedVol(aligned.matrix[i]);
  }

  // Annualise covariance
  const annCov = annualiseCovariance(cov);

  let weights: number[];

  switch (config.method) {
    case 'equal':
      weights = equalWeights(n);
      break;
    case 'inverse_vol':
      weights = inverseVolWeights(sigma);
      break;
    case 'risk_parity':
      weights = riskParityWeights(annCov, config.constraints);
      break;
    case 'min_variance':
      weights = minVarianceWeights(annCov, mu, config.constraints, config.sectors);
      break;
    case 'max_sharpe':
      weights = maxSharpeWeights(annCov, mu, config.constraints, config.sectors);
      break;
    case 'max_diversification':
      weights = maxDiversificationWeights(annCov, sigma, config.constraints, config.sectors);
      break;
    case 'target_vol':
      weights = targetVolWeights(annCov, mu, config.constraints, config.sectors);
      break;
    default:
      weights = equalWeights(n);
  }

  // Apply constraints as final pass
  weights = enforceConstraints(weights, config.constraints, config.sectors);

  return buildResult(weights, returns, mu, annCov, sigma);
}

/**
 * Generate the efficient frontier: a set of return/volatility points.
 *
 * @param returns   - [stock][day] daily returns
 * @param config    - optimisation config (constraints apply to each point)
 * @param numPoints - number of frontier points (default 25)
 * @returns Array of frontier points sorted by volatility
 */
export function efficientFrontier(
  returns: readonly (readonly number[])[],
  config: OptimisationConfig,
  numPoints = 25,
): EfficientFrontierPoint[] {
  const n = returns.length;
  if (n < 2) return [];

  const aligned = alignReturns(returns);
  if (aligned.T < 20) return [];

  const rawCov = covarianceMatrix(aligned.matrix);
  const cov = shrinkCovariance(rawCov, computeShrinkageIntensity(n, aligned.T));
  const annCov = annualiseCovariance(cov);

  const mu = new Array<number>(n);
  const sigma = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    mu[i] = annualisedReturn(aligned.matrix[i]);
    sigma[i] = annualisedVol(aligned.matrix[i]);
  }

  // Find return range
  const minMu = Math.min(...mu);
  const maxMu = Math.max(...mu);
  const range = maxMu - minMu;

  if (range < 1e-10) {
    // All stocks have same expected return; just return min-variance
    const w = minVarianceWeights(annCov, mu, config.constraints, [...config.sectors]);
    const wEnforced = enforceConstraints(w, config.constraints, config.sectors);
    const vol = Math.sqrt(portfolioVariance(wEnforced, annCov));
    const ret = portfolioReturn(wEnforced, mu);
    return [{ return: ret, volatility: vol, sharpe: safeDiv(ret - RF_RATE, vol), weights: wEnforced }];
  }

  // Generate frontier points by targeting different return levels
  const points: EfficientFrontierPoint[] = [];
  const step = range / (numPoints - 1);

  for (let p = 0; p < numPoints; p++) {
    const targetReturn = minMu + step * p;
    const w = targetReturnWeights(annCov, mu, targetReturn, config.constraints, config.sectors);
    const wEnforced = enforceConstraints(w, config.constraints, config.sectors);
    const vol = Math.sqrt(portfolioVariance(wEnforced, annCov));
    const ret = portfolioReturn(wEnforced, mu);
    const sharpe = safeDiv(ret - RF_RATE, vol);
    points.push({ return: ret, volatility: vol, sharpe, weights: [...wEnforced] });
  }

  // Sort by volatility and deduplicate near-identical points
  points.sort((a, b) => a.volatility - b.volatility);
  return deduplicateFrontier(points);
}

// ---------------------------------------------------------------------------
// Allocation Methods
// ---------------------------------------------------------------------------

/** 1. Equal weight: w_i = 1/N */
function equalWeights(n: number): number[] {
  const w = 1 / n;
  return new Array(n).fill(w);
}

/** 2. Inverse volatility: w_i = (1/sigma_i) / sum(1/sigma_j) */
function inverseVolWeights(sigma: readonly number[]): number[] {
  const n = sigma.length;
  const invVol = new Array<number>(n);
  let sum = 0;

  for (let i = 0; i < n; i++) {
    const iv = sigma[i] > 1e-10 ? 1 / sigma[i] : 0;
    invVol[i] = iv;
    sum += iv;
  }

  if (sum < 1e-15) return equalWeights(n);

  for (let i = 0; i < n; i++) {
    invVol[i] /= sum;
  }
  return invVol;
}

/**
 * 3. Risk parity: find weights where each stock contributes equally
 * to portfolio variance.
 *
 * Uses iterative Spinu (2013) method:
 *   w_i = 1 / (sigma_i * sqrt(w' Sigma w))
 *   then normalise to sum = 1
 */
function riskParityWeights(
  annCov: readonly (readonly number[])[],
  constraints: OptimisationConstraints,
): number[] {
  const n = annCov.length;
  let weights = equalWeights(n);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const sigmaW = matVecMul(annCov, weights);
    const portVar = Math.max(dot(weights, sigmaW), 1e-15);
    const portVol = Math.sqrt(portVar);

    const newWeights = new Array<number>(n);
    let sum = 0;

    for (let i = 0; i < n; i++) {
      // Marginal risk contribution of asset i
      const mrc = sigmaW[i] / portVol;
      const wi = mrc > 1e-15 ? 1 / mrc : 0;
      newWeights[i] = wi;
      sum += wi;
    }

    // Normalise
    if (sum > 1e-15) {
      for (let i = 0; i < n; i++) {
        newWeights[i] /= sum;
      }
    } else {
      return equalWeights(n);
    }

    // Clip to bounds
    clipWeights(newWeights, constraints);

    // Check convergence
    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(newWeights[i] - weights[i]));
    }
    weights = newWeights;

    if (maxDelta < CONVERGENCE_TOL) break;
  }

  return weights;
}

/**
 * 4. Minimum variance: minimise w' Sigma w
 *
 * Gradient descent with projection onto feasible set.
 */
function minVarianceWeights(
  annCov: readonly (readonly number[])[],
  _mu: readonly number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const n = annCov.length;
  return gradientDescent(
    n,
    (w) => portfolioVariance(w, annCov),
    (w) => {
      // Gradient of w'Σw is 2Σw
      const sigmaW = matVecMul(annCov, w);
      return sigmaW.map((v) => 2 * v);
    },
    constraints,
    sectors,
  );
}

/**
 * 5. Max Sharpe: maximise (w'mu - rf) / sqrt(w'Sigma w)
 *
 * Equivalently, minimise -Sharpe. We use the negative Sharpe gradient.
 */
function maxSharpeWeights(
  annCov: readonly (readonly number[])[],
  mu: readonly number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const n = annCov.length;
  return gradientDescent(
    n,
    (w) => {
      const ret = dot(w, mu) - RF_RATE;
      const vol = Math.sqrt(Math.max(portfolioVariance(w, annCov), 1e-15));
      return -ret / vol; // minimise negative Sharpe
    },
    (w) => {
      // d(-Sharpe)/dw_i
      const ret = dot(w, mu) - RF_RATE;
      const variance = Math.max(portfolioVariance(w, annCov), 1e-15);
      const vol = Math.sqrt(variance);
      const sigmaW = matVecMul(annCov, w);

      const grad = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        // -( mu_i * vol - ret * sigmaW_i / vol ) / vol^2
        grad[i] = -(mu[i] * vol - ret * sigmaW[i] / vol) / (vol * vol);
      }
      return grad;
    },
    constraints,
    sectors,
  );
}

/**
 * 6. Max diversification: maximise (w'sigma) / sqrt(w'Sigma w)
 *
 * Diversification ratio. Minimise the negative.
 */
function maxDiversificationWeights(
  annCov: readonly (readonly number[])[],
  sigma: readonly number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const n = annCov.length;
  return gradientDescent(
    n,
    (w) => {
      const wSigma = dot(w, sigma);
      const portVol = Math.sqrt(Math.max(portfolioVariance(w, annCov), 1e-15));
      return -wSigma / portVol;
    },
    (w) => {
      const wSigma = dot(w, sigma);
      const variance = Math.max(portfolioVariance(w, annCov), 1e-15);
      const portVol = Math.sqrt(variance);
      const sigmaW = matVecMul(annCov, w);

      const grad = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        // d(-DR)/dw_i = -(sigma_i * portVol - wSigma * sigmaW_i / portVol) / portVol^2
        grad[i] = -(sigma[i] * portVol - wSigma * sigmaW[i] / portVol) / (portVol * portVol);
      }
      return grad;
    },
    constraints,
    sectors,
  );
}

/**
 * 7. Target volatility: maximise return subject to portfolio vol = target_vol.
 *
 * First find max-Sharpe, then scale weights so portfolio vol matches target.
 */
function targetVolWeights(
  annCov: readonly (readonly number[])[],
  mu: readonly number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const targetVol = constraints.target_vol ?? 0.15;

  // Start from max-Sharpe allocation
  const msWeights = maxSharpeWeights(annCov, mu, constraints, sectors);
  const currentVol = Math.sqrt(Math.max(portfolioVariance(msWeights, annCov), 1e-15));

  if (currentVol < 1e-10) return msWeights;

  // Scale factor to hit target vol
  const scale = targetVol / currentVol;
  const n = msWeights.length;
  const scaled = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    scaled[i] = msWeights[i] * scale;
  }

  // Re-normalise and enforce constraints
  normaliseWeights(scaled);
  return scaled;
}

/**
 * Helper for efficient frontier: minimise variance for a target return level.
 * Adds a return penalty term to the variance objective.
 */
function targetReturnWeights(
  annCov: readonly (readonly number[])[],
  mu: readonly number[],
  targetReturn: number,
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const n = annCov.length;
  const penalty = 100; // Lagrange-like penalty strength

  return gradientDescent(
    n,
    (w) => {
      const variance = portfolioVariance(w, annCov);
      const retDiff = dot(w, mu) - targetReturn;
      return variance + penalty * retDiff * retDiff;
    },
    (w) => {
      const sigmaW = matVecMul(annCov, w);
      const retDiff = dot(w, mu) - targetReturn;
      const grad = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        grad[i] = 2 * sigmaW[i] + 2 * penalty * retDiff * mu[i];
      }
      return grad;
    },
    constraints,
    sectors,
  );
}

// ---------------------------------------------------------------------------
// Constrained Gradient Descent
// ---------------------------------------------------------------------------

/**
 * Projected gradient descent on a weight vector.
 *
 * After each step: clip to [min_weight, max_weight], enforce sector caps,
 * normalise to sum = 1, optionally enforce max_positions.
 */
function gradientDescent(
  n: number,
  objective: (w: number[]) => number,
  gradient: (w: number[]) => number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  let weights = equalWeights(n);
  let lr = 0.01;
  let bestWeights = [...weights];
  let bestObj = objective(weights);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const grad = gradient(weights);

    // Gradient step
    const candidate = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      candidate[i] = weights[i] - lr * grad[i];
    }

    // Project onto feasible set
    projectOntoFeasible(candidate, constraints, sectors);

    const obj = objective(candidate);

    if (obj < bestObj) {
      bestObj = obj;
      bestWeights = [...candidate];
      weights = candidate;
    } else {
      // Reduce learning rate on stagnation
      lr *= 0.95;
    }

    // Convergence check: gradient norm
    let gradNorm = 0;
    for (let i = 0; i < n; i++) {
      gradNorm += grad[i] * grad[i];
    }
    if (Math.sqrt(gradNorm) < CONVERGENCE_TOL) break;

    // Learning rate decay
    if (iter % 100 === 99) {
      lr *= 0.5;
    }
  }

  return bestWeights;
}

/**
 * Project weights onto the feasible set:
 * 1. Clip to [min, max] (or [0, max] if long_only)
 * 2. Enforce sector caps
 * 3. Enforce max_positions (zero out smallest weights)
 * 4. Normalise to sum = 1
 */
function projectOntoFeasible(
  weights: number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): void {
  const n = weights.length;
  const minW = constraints.long_only ? Math.max(0, constraints.min_weight) : constraints.min_weight;
  const maxW = constraints.max_weight;

  // 1. Clip individual bounds
  for (let i = 0; i < n; i++) {
    weights[i] = Math.max(minW, Math.min(maxW, weights[i]));
  }

  // 2. Enforce max_positions: zero out smallest weights beyond limit
  if (constraints.max_positions !== null && constraints.max_positions < n) {
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => weights[b] - weights[a]);
    for (let i = constraints.max_positions; i < n; i++) {
      weights[indices[i]] = 0;
    }
  }

  // 3. Enforce sector weight caps
  enforceSectorCaps(weights, sectors, constraints.max_sector_weight);

  // 4. Normalise to sum = 1
  normaliseWeights(weights);
}

/** Clip individual weights to [min, max] and re-normalise. */
function clipWeights(weights: number[], constraints: OptimisationConstraints): void {
  const n = weights.length;
  const minW = constraints.long_only ? Math.max(0, constraints.min_weight) : constraints.min_weight;
  const maxW = constraints.max_weight;

  for (let i = 0; i < n; i++) {
    weights[i] = Math.max(minW, Math.min(maxW, weights[i]));
  }
  normaliseWeights(weights);
}

/** Cap total weight per sector, redistributing excess proportionally. */
function enforceSectorCaps(
  weights: number[],
  sectors: readonly string[],
  maxSectorWeight: number,
): void {
  // Group indices by sector
  const sectorIndices = new Map<string, number[]>();
  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i];
    const arr = sectorIndices.get(s);
    if (arr) {
      arr.push(i);
    } else {
      sectorIndices.set(s, [i]);
    }
  }

  // Iteratively cap sectors (may need multiple passes)
  for (let pass = 0; pass < 5; pass++) {
    let didCap = false;

    for (const [, indices] of sectorIndices) {
      let sectorSum = 0;
      for (const idx of indices) {
        sectorSum += weights[idx];
      }

      if (sectorSum > maxSectorWeight && sectorSum > 1e-15) {
        const scale = maxSectorWeight / sectorSum;
        for (const idx of indices) {
          weights[idx] *= scale;
        }
        didCap = true;
      }
    }

    if (!didCap) break;
  }
}

/** Normalise weights to sum to 1, handling the all-zero case. */
function normaliseWeights(weights: number[]): void {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i];
  }

  if (sum < 1e-15) {
    // Fallback to equal weight
    const w = 1 / weights.length;
    for (let i = 0; i < weights.length; i++) {
      weights[i] = w;
    }
    return;
  }

  for (let i = 0; i < weights.length; i++) {
    weights[i] /= sum;
  }
}

/** Final constraint enforcement pass (idempotent). */
function enforceConstraints(
  weights: number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const result = [...weights];
  projectOntoFeasible(result, constraints, sectors);
  return result;
}

// ---------------------------------------------------------------------------
// Risk Decomposition
// ---------------------------------------------------------------------------

/**
 * Compute percentage risk contribution of each asset.
 * RC_i = w_i * (Sigma * w)_i / (w' * Sigma * w)
 */
function computeRiskContributions(
  weights: readonly number[],
  annCov: readonly (readonly number[])[],
): number[] {
  const n = weights.length;
  const sigmaW = matVecMul(annCov, weights);
  const portVar = Math.max(dot(weights, sigmaW), 1e-15);

  const rc = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    rc[i] = (weights[i] * sigmaW[i]) / portVar;
  }
  return rc;
}

/** Diversification ratio: (w' sigma) / sqrt(w' Sigma w) */
function computeDiversificationRatio(
  weights: readonly number[],
  sigma: readonly number[],
  annCov: readonly (readonly number[])[],
): number {
  const wSigma = dot(weights, sigma);
  const portVol = Math.sqrt(Math.max(portfolioVariance(weights, annCov), 1e-15));
  return portVol > 1e-15 ? wSigma / portVol : 1;
}

// ---------------------------------------------------------------------------
// Result Builders
// ---------------------------------------------------------------------------

function buildResult(
  weights: number[],
  returns: readonly (readonly number[])[],
  mu?: readonly number[],
  annCov?: readonly (readonly number[])[],
  sigma?: readonly number[],
): OptimisationResult {
  const n = returns.length;

  // If we don't have pre-computed values, compute them
  const actualMu = mu ?? returns.map((r) => annualisedReturn(r));
  const actualSigma = sigma ?? returns.map((r) => annualisedVol(r));

  let actualCov: number[][];
  if (annCov) {
    actualCov = annCov as number[][];
  } else {
    const aligned = alignReturns(returns);
    const rawCov = covarianceMatrix(aligned.matrix);
    actualCov = annualiseCovariance(
      shrinkCovariance(rawCov, computeShrinkageIntensity(n, aligned.T)),
    );
  }

  const expectedReturn = portfolioReturn(weights, actualMu);
  const volatility = Math.sqrt(Math.max(portfolioVariance(weights, actualCov), 0));
  const sharpe = safeDiv(expectedReturn - RF_RATE, volatility);
  const diversificationRatio = computeDiversificationRatio(weights, actualSigma, actualCov);
  const riskContributions = computeRiskContributions(weights, actualCov);

  return {
    weights: [...weights],
    expected_return: expectedReturn,
    volatility,
    sharpe,
    diversification_ratio: diversificationRatio,
    risk_contributions: riskContributions,
  };
}

function emptyResult(): OptimisationResult {
  return {
    weights: [],
    expected_return: 0,
    volatility: 0,
    sharpe: 0,
    diversification_ratio: 1,
    risk_contributions: [],
  };
}

function singleStockResult(returns: readonly number[]): OptimisationResult {
  const ret = annualisedReturn(returns);
  const vol = annualisedVol(returns);
  return {
    weights: [1],
    expected_return: ret,
    volatility: vol,
    sharpe: safeDiv(ret - RF_RATE, vol),
    diversification_ratio: 1,
    risk_contributions: [1],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Align return series: trim to common date range, replace NaN with 0.
 * Returns the aligned matrix and effective sample size T.
 */
function alignReturns(
  returns: readonly (readonly number[])[],
): { matrix: number[][]; T: number } {
  const n = returns.length;
  if (n === 0) return { matrix: [], T: 0 };

  const minLen = Math.min(...returns.map((r) => r.length));
  if (minLen < 2) return { matrix: returns.map((r) => [...r]), T: minLen };

  // Use the tail of each series (most recent data, most likely to overlap)
  const matrix: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = returns[i];
    const start = r.length - minLen;
    const row = new Array<number>(minLen);
    for (let t = 0; t < minLen; t++) {
      const v = r[start + t];
      row[t] = isFinite(v) ? v : 0;
    }
    matrix[i] = row;
  }

  return { matrix, T: minLen };
}

/** Annualise a daily covariance matrix by multiplying by 252. */
function annualiseCovariance(dailyCov: readonly (readonly number[])[]): number[][] {
  const n = dailyCov.length;
  const result: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      result[i][j] = dailyCov[i][j] * TRADING_DAYS;
    }
  }
  return result;
}

/**
 * Adaptive shrinkage intensity: more shrinkage when N is large relative to T.
 * Rule of thumb: alpha = N / (N + T)
 */
function computeShrinkageIntensity(n: number, T: number): number {
  const ratio = n / (n + T);
  return Math.max(0.01, Math.min(0.5, ratio));
}

/** Safe division, returns 0 when denominator is near zero. */
function safeDiv(numerator: number, denominator: number): number {
  return Math.abs(denominator) > 1e-10 ? numerator / denominator : 0;
}

/** Remove near-duplicate frontier points (within 0.1% volatility). */
function deduplicateFrontier(points: EfficientFrontierPoint[]): EfficientFrontierPoint[] {
  if (points.length < 2) return points;

  const result: EfficientFrontierPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    if (Math.abs(points[i].volatility - prev.volatility) > 0.001) {
      result.push(points[i]);
    }
  }
  return result;
}

// Re-export dailyReturns for convenience
export { dailyReturns } from './matrix';
