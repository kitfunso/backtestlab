const TRADING_DAYS_PER_YEAR = 252;

const SQRT_TRADING_DAYS = Math.sqrt(TRADING_DAYS_PER_YEAR);

const DEFAULT_ROLLING_WINDOW = 126;

const DEFAULT_RF_RATE = 0.06;

export interface DrawdownInfo {
  readonly peakDate: string;
  readonly peakValue: number;
  readonly troughDate: string;
  readonly troughValue: number;
  readonly recoveryDate: string | null;
  readonly drawdownPct: number;
  readonly durationDays: number;
}

export interface ReturnBucket {
  readonly bucketMin: number;
  readonly bucketMax: number;
  readonly count: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

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

export function annualizedVolatility(returns: readonly number[]): number {
  return sampleStd(returns) * SQRT_TRADING_DAYS;
}

export function rollingVolatility(
  returns: readonly number[],
  window: number = DEFAULT_ROLLING_WINDOW,
): (number | null)[] {
  const stds = rollingStd(returns, window);
  return stds.map((s) => (s === null ? null : s * SQRT_TRADING_DAYS));
}

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
    let peakIdx = i;
    let peakVal = equityCurve[i];

    let j = i + 1;
    while (j < len && equityCurve[j] >= peakVal) {
      peakIdx = j;
      peakVal = equityCurve[j];
      j++;
    }

    if (j >= len) break;

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

    if (recoveryIdx === null) break;
    i = recoveryIdx;
  }

  windows.sort((a, b) => b.drawdownPct - a.drawdownPct);
  return windows.slice(0, n);
}

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
  return (excessDaily * TRADING_DAYS_PER_YEAR) / (downsideDev * SQRT_TRADING_DAYS);
}

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

  if (min === max) {
    return [{ bucketMin: min, bucketMax: max, count: returns.length }];
  }

  const width = (max - min) / buckets;
  const counts = new Array<number>(buckets).fill(0);

  for (const r of returns) {
    let idx = Math.floor((r - min) / width);
    if (idx >= buckets) idx = buckets - 1;
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
