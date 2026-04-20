/**
 * Cross-sectional rank utilities for factor scores.
 *
 * Given a map of `ticker -> rawFactorValue | null`, produce a map of
 * `ticker -> zScore`. Null inputs are treated as neutral (z = 0) so a ticker
 * missing history for one factor does not become uninvestable for the whole
 * composite — it just contributes zero on that dimension.
 *
 * Winsorization is applied at plus/minus 3 sigma on the RAW inputs before
 * z-scoring, per the project plan. This prevents a single extreme outlier
 * from compressing every other ticker into a narrow z-band.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Winsorization clip in standard deviations. */
const WINSOR_SIGMA = 3;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Population standard deviation (n divisor). Returns 0 when n < 1. */
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Cross-sectional z-score with winsorization at plus/minus 3 sigma.
 *
 * Pipeline:
 *   1. Partition inputs into known values and null values.
 *   2. Compute mean and population std of the known values.
 *   3. Winsorize each raw value to `[mu - 3*sigma, mu + 3*sigma]`.
 *   4. Recompute mean and std of the winsorized values.
 *   5. Z-score each ticker against the winsorized moments.
 *   6. Tickers with a null input receive z = 0.
 *
 * Edge cases:
 *   - Empty input -> empty output.
 *   - No known values (all null) -> every ticker maps to 0.
 *   - Zero cross-sectional std (all values identical) -> every known ticker
 *     maps to 0; null tickers also map to 0.
 *
 * @param values - Map of `ticker -> rawFactorValue | null`.
 * @returns Map of `ticker -> zScore` with the same keys as the input.
 */
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

  // Step 1: moments of the raw cross-section.
  const rawMu = mean(known);
  const rawSigma = populationStd(known);

  // If every known value is identical there is nothing to rank.
  if (rawSigma === 0) {
    for (const t of tickers) out[t] = 0;
    return out;
  }

  // Step 2: winsorize raw values to +/- 3 sigma.
  const lowerClip = rawMu - WINSOR_SIGMA * rawSigma;
  const upperClip = rawMu + WINSOR_SIGMA * rawSigma;
  const winsorized: number[] = known.map((v) =>
    Math.min(Math.max(v, lowerClip), upperClip),
  );

  // Step 3: recompute moments of winsorized sample.
  const wMu = mean(winsorized);
  const wSigma = populationStd(winsorized);

  // Step 4: z-score each ticker against winsorized moments.
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
