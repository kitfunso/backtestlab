const DAYS_YEAR = 252;

const SKIP_DAYS = 21;

const REVERSAL_DAYS = 5;

const DISPERSION_DAYS = 21;

const MOM6_DAYS = 126;

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

export function momentum12_1(closes: readonly number[]): number | null {
  const n = closes.length;
  if (n < DAYS_YEAR + 1) return null;
  const start = closes[n - 1 - DAYS_YEAR];
  const end = closes[n - 1 - SKIP_DAYS];
  if (start <= 0) return null;
  return end / start - 1;
}

export function momentum6_1(closes: readonly number[]): number | null {
  const n = closes.length;
  if (n < MOM6_DAYS + 1) return null;
  const start = closes[n - 1 - MOM6_DAYS];
  const end = closes[n - 1 - SKIP_DAYS];
  if (start <= 0) return null;
  return end / start - 1;
}

export function shortReversal(closes: readonly number[]): number | null {
  const n = closes.length;
  if (n < REVERSAL_DAYS + 1) return null;
  const start = closes[n - 1 - REVERSAL_DAYS];
  const end = closes[n - 1];
  if (start <= 0) return null;
  return -(end / start - 1);
}

export function volatility(closes: readonly number[]): number | null {
  const n = closes.length;
  if (n < DAYS_YEAR + 1) return null;
  const returns = simpleReturns(closes.slice(n - DAYS_YEAR - 1));
  const std = sampleStd(returns);
  return std * Math.sqrt(DAYS_YEAR);
}

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
