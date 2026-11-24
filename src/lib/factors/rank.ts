const WINSOR_SIGMA = 3;

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function populationStd(values: readonly number[]): number {
  const n = values.length;
  if (n < 1) return 0;
  const mu = mean(values);
  let ss = 0;
  for (const v of values) {
    const d = v - mu;
    ss += d * d;
  }
  return Math.sqrt(ss / n);
}

export function crossSectionalZScore(
  values: Record<string, number | null>,
): Record<string, number> {
  const tickers = Object.keys(values);
  const out: Record<string, number> = {};
  if (tickers.length === 0) return out;

  const known: number[] = [];
  for (const t of tickers) {
    const v = values[t];
    if (v !== null && Number.isFinite(v)) known.push(v);
  }

  if (known.length === 0) {
    for (const t of tickers) out[t] = 0;
    return out;
  }

  const rawMu = mean(known);
  const rawSigma = populationStd(known);

  if (rawSigma === 0) {
    for (const t of tickers) out[t] = 0;
    return out;
  }

  const lowerClip = rawMu - WINSOR_SIGMA * rawSigma;
  const upperClip = rawMu + WINSOR_SIGMA * rawSigma;
  const winsorized: number[] = known.map((v) =>
    Math.min(Math.max(v, lowerClip), upperClip),
  );

  const wMu = mean(winsorized);
  const wSigma = populationStd(winsorized);

  for (const t of tickers) {
    const raw = values[t];
    if (raw === null || !Number.isFinite(raw)) {
      out[t] = 0;
      continue;
    }
    if (wSigma === 0) {
      out[t] = 0;
      continue;
    }
    const clipped = Math.min(Math.max(raw, lowerClip), upperClip);
    out[t] = (clipped - wMu) / wSigma;
  }
  return out;
}
