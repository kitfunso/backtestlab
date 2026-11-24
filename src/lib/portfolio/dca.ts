export type DCAFrequency = 'weekly' | 'monthly';

export interface LumpSumResult {
  readonly values: number[];
  readonly shares: number;
  readonly totalInvested: number;
}

export interface DCAResult {
  readonly values: number[];
  readonly shares: number[];
  readonly contributions: number[];
  readonly totalInvested: number;
}

function requireAligned(equityCurve: readonly number[], dates: readonly string[]): void {
  if (equityCurve.length === 0 || dates.length === 0) {
    throw new Error('dca: equityCurve and dates must be non-empty');
  }
  if (equityCurve.length !== dates.length) {
    throw new Error('dca: equityCurve and dates must have equal length');
  }
}

export function simulateLumpSum(
  equityCurve: readonly number[],
  dates: readonly string[],
  capital: number,
): LumpSumResult {
  requireAligned(equityCurve, dates);
  const startPrice = equityCurve[0];
  if (startPrice <= 0) throw new Error('dca: starting price must be positive');
  const shares = capital / startPrice;
  const values = equityCurve.map((p) => shares * p);
  return { values, shares, totalInvested: capital };
}

function contributionIndices(
  dates: readonly string[],
  frequency: DCAFrequency,
): number[] {
  const idxs: number[] = [0];
  if (frequency === 'weekly') {
    for (let i = 5; i < dates.length; i += 5) idxs.push(i);
    return idxs;
  }
  let lastMonth = dates[0].slice(0, 7);
  for (let i = 1; i < dates.length; i++) {
    const m = dates[i].slice(0, 7);
    if (m !== lastMonth) {
      idxs.push(i);
      lastMonth = m;
    }
  }
  return idxs;
}

export function simulateDCA(
  equityCurve: readonly number[],
  dates: readonly string[],
  capital: number,
  frequency: DCAFrequency,
): DCAResult {
  requireAligned(equityCurve, dates);
  const idxs = contributionIndices(dates, frequency);
  if (idxs.length === 0) {
    return {
      values: equityCurve.map(() => 0),
      shares: equityCurve.map(() => 0),
      contributions: equityCurve.map(() => 0),
      totalInvested: 0,
    };
  }
  const perContribution = capital / idxs.length;

  const contributions = equityCurve.map(() => 0);
  for (const i of idxs) contributions[i] = perContribution;

  const shares = new Array<number>(equityCurve.length).fill(0);
  const values = new Array<number>(equityCurve.length).fill(0);

  let cumShares = 0;
  for (let i = 0; i < equityCurve.length; i++) {
    if (contributions[i] > 0) {
      const price = equityCurve[i];
      if (price > 0) cumShares += contributions[i] / price;
    }
    shares[i] = cumShares;
    values[i] = cumShares * equityCurve[i];
  }

  return { values, shares, contributions, totalInvested: perContribution * idxs.length };
}

export function annualizedReturn(
  terminalValue: number,
  totalInvested: number,
  tradingDays: number,
): number {
  if (tradingDays <= 0 || totalInvested <= 0) return NaN;
  const years = tradingDays / 252;
  return Math.pow(terminalValue / totalInvested, 1 / years) - 1;
}
