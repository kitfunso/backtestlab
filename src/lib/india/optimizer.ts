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

const TRADING_DAYS = 252;
const RF_RATE = 0.06;
const MAX_ITER = 1000;
const CONVERGENCE_TOL = 1e-8;

export const DEFAULT_CONSTRAINTS: OptimisationConstraints = {
  min_weight: 0,
  max_weight: 0.25,
  max_sector_weight: 0.40,
  long_only: true,
  max_positions: null,
};

export function optimisePortfolio(
  returns: readonly (readonly number[])[],
  config: OptimisationConfig,
): OptimisationResult {
  const n = returns.length;

  if (n === 0) {
    return emptyResult();
  }

  if (n === 1) {
    return singleStockResult(returns[0]);
  }

  const aligned = alignReturns(returns);
  if (aligned.T < 20) {
    return buildResult(equalWeights(n), returns);
  }

  const rawCov = covarianceMatrix(aligned.matrix);
  const cov = shrinkCovariance(rawCov, computeShrinkageIntensity(n, aligned.T));

  const mu = new Array<number>(n);
  const sigma = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    mu[i] = annualisedReturn(aligned.matrix[i]);
    sigma[i] = annualisedVol(aligned.matrix[i]);
  }

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

  weights = enforceConstraints(weights, config.constraints, config.sectors);

  return buildResult(weights, returns, mu, annCov, sigma);
}

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

  const minMu = Math.min(...mu);
  const maxMu = Math.max(...mu);
  const range = maxMu - minMu;

  if (range < 1e-10) {
    const w = minVarianceWeights(annCov, mu, config.constraints, [...config.sectors]);
    const wEnforced = enforceConstraints(w, config.constraints, config.sectors);
    const vol = Math.sqrt(portfolioVariance(wEnforced, annCov));
    const ret = portfolioReturn(wEnforced, mu);
    return [{ return: ret, volatility: vol, sharpe: safeDiv(ret - RF_RATE, vol), weights: wEnforced }];
  }

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

  points.sort((a, b) => a.volatility - b.volatility);
  return deduplicateFrontier(points);
}

function equalWeights(n: number): number[] {
  const w = 1 / n;
  return new Array(n).fill(w);
}

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
      const mrc = sigmaW[i] / portVol;
      const wi = mrc > 1e-15 ? 1 / mrc : 0;
      newWeights[i] = wi;
      sum += wi;
    }

    if (sum > 1e-15) {
      for (let i = 0; i < n; i++) {
        newWeights[i] /= sum;
      }
    } else {
      return equalWeights(n);
    }

    clipWeights(newWeights, constraints);

    let maxDelta = 0;
    for (let i = 0; i < n; i++) {
      maxDelta = Math.max(maxDelta, Math.abs(newWeights[i] - weights[i]));
    }
    weights = newWeights;

    if (maxDelta < CONVERGENCE_TOL) break;
  }

  return weights;
}

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
      const sigmaW = matVecMul(annCov, w);
      return sigmaW.map((v) => 2 * v);
    },
    constraints,
    sectors,
  );
}

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
      return -ret / vol;
    },
    (w) => {
      const ret = dot(w, mu) - RF_RATE;
      const variance = Math.max(portfolioVariance(w, annCov), 1e-15);
      const vol = Math.sqrt(variance);
      const sigmaW = matVecMul(annCov, w);

      const grad = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        grad[i] = -(mu[i] * vol - ret * sigmaW[i] / vol) / (vol * vol);
      }
      return grad;
    },
    constraints,
    sectors,
  );
}

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
        grad[i] = -(sigma[i] * portVol - wSigma * sigmaW[i] / portVol) / (portVol * portVol);
      }
      return grad;
    },
    constraints,
    sectors,
  );
}

function targetVolWeights(
  annCov: readonly (readonly number[])[],
  mu: readonly number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const targetVol = constraints.target_vol ?? 0.15;

  const msWeights = maxSharpeWeights(annCov, mu, constraints, sectors);
  const currentVol = Math.sqrt(Math.max(portfolioVariance(msWeights, annCov), 1e-15));

  if (currentVol < 1e-10) return msWeights;

  const scale = targetVol / currentVol;
  const n = msWeights.length;
  const scaled = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    scaled[i] = msWeights[i] * scale;
  }

  normaliseWeights(scaled);
  return scaled;
}

function targetReturnWeights(
  annCov: readonly (readonly number[])[],
  mu: readonly number[],
  targetReturn: number,
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const n = annCov.length;
  const penalty = 100;

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

    const candidate = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      candidate[i] = weights[i] - lr * grad[i];
    }

    projectOntoFeasible(candidate, constraints, sectors);

    const obj = objective(candidate);

    if (obj < bestObj) {
      bestObj = obj;
      bestWeights = [...candidate];
      weights = candidate;
    } else {
      lr *= 0.95;
    }

    let gradNorm = 0;
    for (let i = 0; i < n; i++) {
      gradNorm += grad[i] * grad[i];
    }
    if (Math.sqrt(gradNorm) < CONVERGENCE_TOL) break;

    if (iter % 100 === 99) {
      lr *= 0.5;
    }
  }

  return bestWeights;
}

function projectOntoFeasible(
  weights: number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): void {
  const n = weights.length;
  const minW = constraints.long_only ? Math.max(0, constraints.min_weight) : constraints.min_weight;
  const maxW = constraints.max_weight;

  for (let i = 0; i < n; i++) {
    weights[i] = Math.max(minW, Math.min(maxW, weights[i]));
  }

  if (constraints.max_positions !== null && constraints.max_positions < n) {
    const indices = Array.from({ length: n }, (_, i) => i);
    indices.sort((a, b) => weights[b] - weights[a]);
    for (let i = constraints.max_positions; i < n; i++) {
      weights[indices[i]] = 0;
    }
  }

  enforceSectorCaps(weights, sectors, constraints.max_sector_weight);

  normaliseWeights(weights);
}

function clipWeights(weights: number[], constraints: OptimisationConstraints): void {
  const n = weights.length;
  const minW = constraints.long_only ? Math.max(0, constraints.min_weight) : constraints.min_weight;
  const maxW = constraints.max_weight;

  for (let i = 0; i < n; i++) {
    weights[i] = Math.max(minW, Math.min(maxW, weights[i]));
  }
  normaliseWeights(weights);
}

function enforceSectorCaps(
  weights: number[],
  sectors: readonly string[],
  maxSectorWeight: number,
): void {
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

function normaliseWeights(weights: number[]): void {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += weights[i];
  }

  if (sum < 1e-15) {
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

function enforceConstraints(
  weights: number[],
  constraints: OptimisationConstraints,
  sectors: readonly string[],
): number[] {
  const result = [...weights];
  projectOntoFeasible(result, constraints, sectors);
  return result;
}

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

function computeDiversificationRatio(
  weights: readonly number[],
  sigma: readonly number[],
  annCov: readonly (readonly number[])[],
): number {
  const wSigma = dot(weights, sigma);
  const portVol = Math.sqrt(Math.max(portfolioVariance(weights, annCov), 1e-15));
  return portVol > 1e-15 ? wSigma / portVol : 1;
}

function buildResult(
  weights: number[],
  returns: readonly (readonly number[])[],
  mu?: readonly number[],
  annCov?: readonly (readonly number[])[],
  sigma?: readonly number[],
): OptimisationResult {
  const n = returns.length;

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

function alignReturns(
  returns: readonly (readonly number[])[],
): { matrix: number[][]; T: number } {
  const n = returns.length;
  if (n === 0) return { matrix: [], T: 0 };

  const minLen = Math.min(...returns.map((r) => r.length));
  if (minLen < 2) return { matrix: returns.map((r) => [...r]), T: minLen };

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

function computeShrinkageIntensity(n: number, T: number): number {
  const ratio = n / (n + T);
  return Math.max(0.01, Math.min(0.5, ratio));
}

function safeDiv(numerator: number, denominator: number): number {
  return Math.abs(denominator) > 1e-10 ? numerator / denominator : 0;
}

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

export { dailyReturns } from './matrix';
