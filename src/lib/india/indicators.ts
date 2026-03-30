/**
 * India Equities Strategy Tester - Technical Indicators
 *
 * Pure functions operating on number arrays. Each returns number[] (or a named
 * object for multi-output indicators). Leading values that fall within the
 * lookback window are filled with NaN.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nanArray(len: number): number[] {
  return new Array<number>(len).fill(NaN);
}

function fillNaN(arr: number[], count: number): number[] {
  const out = arr.slice();
  for (let i = 0; i < Math.min(count, out.length); i++) out[i] = NaN;
  return out;
}

function sum(arr: readonly number[], start: number, end: number): number {
  let s = 0;
  for (let i = start; i < end; i++) s += arr[i];
  return s;
}

function mean(arr: readonly number[], start: number, end: number): number {
  return sum(arr, start, end) / (end - start);
}

function trueRange(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  i: number,
): number {
  if (i === 0) return high[0] - low[0];
  return Math.max(
    high[i] - low[i],
    Math.abs(high[i] - close[i - 1]),
    Math.abs(low[i] - close[i - 1]),
  );
}

// =========================================================================
// TREND INDICATORS
// =========================================================================

/** Simple Moving Average */
export function sma(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  let s = 0;
  for (let i = 0; i < period; i++) s += close[i];
  out[period - 1] = s / period;
  for (let i = period; i < n; i++) {
    s += close[i] - close[i - period];
    out[i] = s / period;
  }
  return out;
}

/** Exponential Moving Average */
export function ema(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  // Seed with SMA
  let s = 0;
  for (let i = 0; i < period; i++) s += close[i];
  out[period - 1] = s / period;
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) {
    out[i] = close[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Double Exponential Moving Average */
export function dema(close: readonly number[], period: number): number[] {
  const e1 = ema(close, period);
  const e2 = ema(e1.map((v) => (isNaN(v) ? 0 : v)), period);
  const n = close.length;
  const out = nanArray(n);
  const warmup = (period - 1) * 2;
  for (let i = warmup; i < n; i++) {
    if (isNaN(e1[i]) || isNaN(e2[i])) continue;
    out[i] = 2 * e1[i] - e2[i];
  }
  return out;
}

/** Triple Exponential Moving Average */
export function tema(close: readonly number[], period: number): number[] {
  const e1 = ema(close, period);
  const e1Clean = e1.map((v) => (isNaN(v) ? 0 : v));
  const e2 = ema(e1Clean, period);
  const e2Clean = e2.map((v) => (isNaN(v) ? 0 : v));
  const e3 = ema(e2Clean, period);
  const n = close.length;
  const out = nanArray(n);
  const warmup = (period - 1) * 3;
  for (let i = warmup; i < n; i++) {
    if (isNaN(e1[i]) || isNaN(e2[i]) || isNaN(e3[i])) continue;
    out[i] = 3 * e1[i] - 3 * e2[i] + e3[i];
  }
  return out;
}

/** Weighted Moving Average */
export function wma(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let s = 0;
    for (let j = 0; j < period; j++) {
      s += close[i - period + 1 + j] * (j + 1);
    }
    out[i] = s / denom;
  }
  return out;
}

/** Hull Moving Average: WMA(2*WMA(n/2) - WMA(n), sqrt(n)) */
export function hullMA(close: readonly number[], period: number): number[] {
  const halfPeriod = Math.max(Math.floor(period / 2), 1);
  const sqrtPeriod = Math.max(Math.floor(Math.sqrt(period)), 1);
  const wmaHalf = wma(close, halfPeriod);
  const wmaFull = wma(close, period);
  const n = close.length;
  const diff: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    diff[i] = isNaN(wmaHalf[i]) || isNaN(wmaFull[i]) ? 0 : 2 * wmaHalf[i] - wmaFull[i];
  }
  const raw = wma(diff, sqrtPeriod);
  // Set leading NaNs
  const warmup = period + sqrtPeriod - 2;
  return fillNaN(raw, warmup);
}

/** Volume Weighted Moving Average */
export function vwma(
  close: readonly number[],
  volume: readonly number[],
  period: number,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let sumPV = 0;
    let sumV = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumPV += close[j] * volume[j];
      sumV += volume[j];
    }
    out[i] = sumV === 0 ? close[i] : sumPV / sumV;
  }
  return out;
}

/** Supertrend indicator */
export function supertrend(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period: number,
  multiplier: number,
): { supertrend: number[]; direction: number[] } {
  const n = close.length;
  const st = nanArray(n);
  const dir = nanArray(n);
  const atrArr = atr(high, low, close, period);

  const upperBand: number[] = new Array(n).fill(0);
  const lowerBand: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    if (isNaN(atrArr[i])) continue;
    const hl2 = (high[i] + low[i]) / 2;
    upperBand[i] = hl2 + multiplier * atrArr[i];
    lowerBand[i] = hl2 - multiplier * atrArr[i];
  }

  // Clamp bands (standard supertrend logic)
  for (let i = period; i < n; i++) {
    // Lower band can only rise (never fall) while price stays above it
    if (close[i - 1] > lowerBand[i - 1]) {
      lowerBand[i] = Math.max(lowerBand[i], lowerBand[i - 1]);
    }
    // Upper band can only fall (never rise) while price stays below it
    if (close[i - 1] < upperBand[i - 1]) {
      upperBand[i] = Math.min(upperBand[i], upperBand[i - 1]);
    }
  }

  // Compute supertrend
  for (let i = period; i < n; i++) {
    if (i === period) {
      dir[i] = close[i] > upperBand[i] ? 1 : -1;
      st[i] = dir[i] === 1 ? lowerBand[i] : upperBand[i];
      continue;
    }
    const prevDir = dir[i - 1] as number;
    if (prevDir === 1) {
      dir[i] = close[i] < lowerBand[i] ? -1 : 1;
    } else {
      dir[i] = close[i] > upperBand[i] ? 1 : -1;
    }
    st[i] = dir[i] === 1 ? lowerBand[i] : upperBand[i];
  }

  return { supertrend: st, direction: dir };
}

/** Ichimoku Cloud */
export function ichimoku(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  conversionPeriod: number = 9,
  basePeriod: number = 26,
  spanBPeriod: number = 52,
  displacement: number = 26,
): {
  tenkan: number[];
  kijun: number[];
  spanA: number[];
  spanB: number[];
  chikou: number[];
} {
  const n = close.length;
  const tenkan = nanArray(n);
  const kijun = nanArray(n);
  const spanA = nanArray(n);
  const spanB = nanArray(n);
  const chikou = nanArray(n);

  const midpoint = (arr: readonly number[], arrLow: readonly number[], idx: number, period: number): number => {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = idx - period + 1; j <= idx; j++) {
      if (arr[j] > hi) hi = arr[j];
      if (arrLow[j] < lo) lo = arrLow[j];
    }
    return (hi + lo) / 2;
  };

  for (let i = conversionPeriod - 1; i < n; i++) {
    tenkan[i] = midpoint(high, low, i, conversionPeriod);
  }
  for (let i = basePeriod - 1; i < n; i++) {
    kijun[i] = midpoint(high, low, i, basePeriod);
  }
  for (let i = basePeriod - 1; i < n; i++) {
    if (!isNaN(tenkan[i]) && !isNaN(kijun[i])) {
      const displaced = i + displacement;
      if (displaced < n) {
        spanA[displaced] = (tenkan[i] + kijun[i]) / 2;
      }
    }
  }
  for (let i = spanBPeriod - 1; i < n; i++) {
    const displaced = i + displacement;
    if (displaced < n) {
      spanB[displaced] = midpoint(high, low, i, spanBPeriod);
    }
  }
  // Chikou = close shifted back
  for (let i = 0; i < n - displacement; i++) {
    chikou[i] = close[i + displacement];
  }

  return { tenkan, kijun, spanA, spanB, chikou };
}

/** Parabolic SAR */
export function parabolicSAR(
  high: readonly number[],
  low: readonly number[],
  afStart: number = 0.02,
  afIncrement: number = 0.02,
  afMax: number = 0.2,
): number[] {
  const n = high.length;
  const sar = nanArray(n);
  if (n < 2) return sar;

  let isLong = high[1] > high[0];
  let af = afStart;
  let ep = isLong ? high[0] : low[0];
  sar[0] = isLong ? low[0] : high[0];

  for (let i = 1; i < n; i++) {
    const prevSar = sar[i - 1] as number;
    let currentSar = prevSar + af * (ep - prevSar);

    if (isLong) {
      // SAR must not be above previous two lows
      if (i >= 2) currentSar = Math.min(currentSar, low[i - 1], low[i - 2]);
      else currentSar = Math.min(currentSar, low[i - 1]);

      if (low[i] < currentSar) {
        // Reverse to short
        isLong = false;
        currentSar = ep;
        ep = low[i];
        af = afStart;
      } else {
        if (high[i] > ep) {
          ep = high[i];
          af = Math.min(af + afIncrement, afMax);
        }
      }
    } else {
      // SAR must not be below previous two highs
      if (i >= 2) currentSar = Math.max(currentSar, high[i - 1], high[i - 2]);
      else currentSar = Math.max(currentSar, high[i - 1]);

      if (high[i] > currentSar) {
        // Reverse to long
        isLong = true;
        currentSar = ep;
        ep = high[i];
        af = afStart;
      } else {
        if (low[i] < ep) {
          ep = low[i];
          af = Math.min(af + afIncrement, afMax);
        }
      }
    }
    sar[i] = currentSar;
  }
  return sar;
}

/** Linear Regression (least squares fit value) */
export function linearRegression(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = close[i - period + 1 + j];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const slope = (period * sumXY - sumX * sumY) / (period * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / period;
    out[i] = intercept + slope * (period - 1);
  }
  return out;
}

/** Donchian Channel */
export function donchianChannel(
  high: readonly number[],
  low: readonly number[],
  period: number,
): { upper: number[]; lower: number[]; middle: number[] } {
  const n = high.length;
  const upper = nanArray(n);
  const lower = nanArray(n);
  const middle = nanArray(n);
  if (n < period) return { upper, lower, middle };
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (high[j] > hi) hi = high[j];
      if (low[j] < lo) lo = low[j];
    }
    upper[i] = hi;
    lower[i] = lo;
    middle[i] = (hi + lo) / 2;
  }
  return { upper, lower, middle };
}

// =========================================================================
// MOMENTUM INDICATORS
// =========================================================================

/** Relative Strength Index */
export function rsi(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = close[i] - close[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < n; i++) {
    const change = close[i] - close[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** Stochastic RSI */
export function stochRSI(
  close: readonly number[],
  rsiPeriod: number,
  stochPeriod: number,
  kSmooth: number,
  dSmooth: number,
): { k: number[]; d: number[] } {
  const rsiArr = rsi(close, rsiPeriod);
  const n = close.length;
  const rawK = nanArray(n);

  for (let i = 0; i < n; i++) {
    if (isNaN(rsiArr[i])) continue;
    const start = Math.max(0, i - stochPeriod + 1);
    let minR = Infinity;
    let maxR = -Infinity;
    let valid = true;
    for (let j = start; j <= i; j++) {
      if (isNaN(rsiArr[j])) { valid = false; break; }
      if (rsiArr[j] < minR) minR = rsiArr[j];
      if (rsiArr[j] > maxR) maxR = rsiArr[j];
    }
    if (!valid || i - start + 1 < stochPeriod) continue;
    rawK[i] = maxR === minR ? 50 : ((rsiArr[i] - minR) / (maxR - minR)) * 100;
  }

  const k = smaOnSparse(rawK, kSmooth);
  const d = smaOnSparse(k, dSmooth);
  return { k, d };
}

/** SMA that skips NaN values (for smoothing sparse series) */
function smaOnSparse(arr: number[], period: number): number[] {
  const n = arr.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (isNaN(arr[i])) continue;
    let count = 0;
    let s = 0;
    for (let j = i; j >= 0 && count < period; j--) {
      if (!isNaN(arr[j])) { s += arr[j]; count++; }
    }
    if (count === period) out[i] = s / period;
  }
  return out;
}

/** MACD (Moving Average Convergence Divergence) */
export function macd(
  close: readonly number[],
  fast: number,
  slow: number,
  signalPeriod: number,
): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = ema(close, fast);
  const emaSlow = ema(close, slow);
  const n = close.length;
  const macdLine = nanArray(n);

  for (let i = 0; i < n; i++) {
    if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i])) {
      macdLine[i] = emaFast[i] - emaSlow[i];
    }
  }

  // Signal line = EMA of MACD line
  const macdClean = macdLine.map((v) => (isNaN(v) ? 0 : v));
  const signalRaw = ema(macdClean, signalPeriod);
  const signalLine = nanArray(n);
  const histogram = nanArray(n);

  // Find first valid MACD index
  let firstValid = -1;
  for (let i = 0; i < n; i++) {
    if (!isNaN(macdLine[i])) { firstValid = i; break; }
  }

  if (firstValid >= 0) {
    const warmup = firstValid + signalPeriod - 1;
    for (let i = warmup; i < n; i++) {
      if (!isNaN(macdLine[i]) && !isNaN(signalRaw[i])) {
        signalLine[i] = signalRaw[i];
        histogram[i] = macdLine[i] - signalRaw[i];
      }
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

/** Average Directional Index */
export function adx(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period: number,
): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const n = close.length;
  const adxOut = nanArray(n);
  const plusDI = nanArray(n);
  const minusDI = nanArray(n);
  if (n < period + 1) return { adx: adxOut, plusDI, minusDI };

  const tr: number[] = new Array(n).fill(0);
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    tr[i] = trueRange(high, low, close, i);
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  // Smooth with Wilder's method
  let smoothTR = sum(tr, 1, period + 1);
  let smoothPlusDM = sum(plusDM, 1, period + 1);
  let smoothMinusDM = sum(minusDM, 1, period + 1);

  const dx: number[] = nanArray(n);

  for (let i = period; i < n; i++) {
    if (i > period) {
      smoothTR = smoothTR - smoothTR / period + tr[i];
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    }
    const pdi = smoothTR === 0 ? 0 : (smoothPlusDM / smoothTR) * 100;
    const mdi = smoothTR === 0 ? 0 : (smoothMinusDM / smoothTR) * 100;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    const diSum = pdi + mdi;
    dx[i] = diSum === 0 ? 0 : (Math.abs(pdi - mdi) / diSum) * 100;
  }

  // ADX = smoothed DX
  let adxSum = 0;
  let adxCount = 0;
  for (let i = period; i < n && adxCount < period; i++) {
    if (!isNaN(dx[i])) {
      adxSum += dx[i];
      adxCount++;
      if (adxCount === period) {
        adxOut[i] = adxSum / period;
      }
    }
  }
  // Continue Wilder smoothing
  let started = false;
  for (let i = 0; i < n; i++) {
    if (!isNaN(adxOut[i]) && !started) {
      started = true;
      continue;
    }
    if (started && !isNaN(dx[i])) {
      adxOut[i] = (adxOut[i - 1] * (period - 1) + dx[i]) / period;
    }
  }

  return { adx: adxOut, plusDI, minusDI };
}

/** Commodity Channel Index */
export function cci(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period: number,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;

  const tp: number[] = new Array(n);
  for (let i = 0; i < n; i++) tp[i] = (high[i] + low[i] + close[i]) / 3;

  for (let i = period - 1; i < n; i++) {
    const m = mean(tp, i - period + 1, i + 1);
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j] - m);
    meanDev /= period;
    out[i] = meanDev === 0 ? 0 : (tp[i] - m) / (0.015 * meanDev);
  }
  return out;
}

/** Rate of Change */
export function roc(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  for (let i = period; i < n; i++) {
    out[i] = close[i - period] === 0 ? 0 : ((close[i] - close[i - period]) / close[i - period]) * 100;
  }
  return out;
}

/** Williams %R */
export function williamsR(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period: number,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (high[j] > hh) hh = high[j];
      if (low[j] < ll) ll = low[j];
    }
    out[i] = hh === ll ? -50 : ((hh - close[i]) / (hh - ll)) * -100;
  }
  return out;
}

/** Momentum (price difference over N periods) */
export function momentum(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  for (let i = period; i < n; i++) {
    out[i] = close[i] - close[i - period];
  }
  return out;
}

/** True Strength Index */
export function tsi(
  close: readonly number[],
  longPeriod: number = 25,
  shortPeriod: number = 13,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < 2) return out;

  const pc: number[] = new Array(n).fill(0);
  const absPC: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    pc[i] = close[i] - close[i - 1];
    absPC[i] = Math.abs(pc[i]);
  }

  const pcEmaLong = ema(pc, longPeriod);
  const pcEmaDouble = ema(pcEmaLong.map((v) => (isNaN(v) ? 0 : v)), shortPeriod);
  const absPCEmaLong = ema(absPC, longPeriod);
  const absPCEmaDouble = ema(absPCEmaLong.map((v) => (isNaN(v) ? 0 : v)), shortPeriod);

  const warmup = longPeriod + shortPeriod - 1;
  for (let i = warmup; i < n; i++) {
    if (!isNaN(pcEmaDouble[i]) && !isNaN(absPCEmaDouble[i]) && absPCEmaDouble[i] !== 0) {
      out[i] = (pcEmaDouble[i] / absPCEmaDouble[i]) * 100;
    }
  }
  return out;
}

/** Awesome Oscillator */
export function awesomeOscillator(
  high: readonly number[],
  low: readonly number[],
  fastPeriod: number = 5,
  slowPeriod: number = 34,
): number[] {
  const n = high.length;
  const midpoints: number[] = new Array(n);
  for (let i = 0; i < n; i++) midpoints[i] = (high[i] + low[i]) / 2;

  const smaFast = sma(midpoints, fastPeriod);
  const smaSlow = sma(midpoints, slowPeriod);
  const out = nanArray(n);

  for (let i = 0; i < n; i++) {
    if (!isNaN(smaFast[i]) && !isNaN(smaSlow[i])) {
      out[i] = smaFast[i] - smaSlow[i];
    }
  }
  return out;
}

/** Percentage Price Oscillator */
export function ppo(
  close: readonly number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9,
): { ppo: number[]; signal: number[]; histogram: number[] } {
  const emaFast = ema(close, fast);
  const emaSlow = ema(close, slow);
  const n = close.length;
  const ppoLine = nanArray(n);

  for (let i = 0; i < n; i++) {
    if (!isNaN(emaFast[i]) && !isNaN(emaSlow[i]) && emaSlow[i] !== 0) {
      ppoLine[i] = ((emaFast[i] - emaSlow[i]) / emaSlow[i]) * 100;
    }
  }

  const ppoClean = ppoLine.map((v) => (isNaN(v) ? 0 : v));
  const signalRaw = ema(ppoClean, signalPeriod);
  const signalLine = nanArray(n);
  const histogram = nanArray(n);

  let firstValid = -1;
  for (let i = 0; i < n; i++) {
    if (!isNaN(ppoLine[i])) { firstValid = i; break; }
  }
  if (firstValid >= 0) {
    const warmup = firstValid + signalPeriod - 1;
    for (let i = warmup; i < n; i++) {
      if (!isNaN(ppoLine[i])) {
        signalLine[i] = signalRaw[i];
        histogram[i] = ppoLine[i] - signalRaw[i];
      }
    }
  }

  return { ppo: ppoLine, signal: signalLine, histogram };
}

/** Time-series Momentum (rolling return over N periods) */
export function tsMomentum(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  for (let i = period; i < n; i++) {
    out[i] = close[i - period] === 0 ? 0 : (close[i] / close[i - period] - 1) * 100;
  }
  return out;
}

// =========================================================================
// VOLATILITY INDICATORS
// =========================================================================

/** Bollinger Bands */
export function bollingerBands(
  close: readonly number[],
  period: number,
  mult: number,
): { upper: number[]; middle: number[]; lower: number[] } {
  const mid = sma(close, period);
  const n = close.length;
  const upper = nanArray(n);
  const lower = nanArray(n);

  for (let i = period - 1; i < n; i++) {
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = close[j] - mid[i];
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { upper, middle: mid, lower };
}

/** Average True Range */
export function atr(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period: number,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;

  let s = 0;
  for (let i = 0; i < period; i++) s += trueRange(high, low, close, i);
  out[period - 1] = s / period;

  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + trueRange(high, low, close, i)) / period;
  }
  return out;
}

/** Keltner Channel */
export function keltnerChannel(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  emaPeriod: number,
  atrPeriod: number,
  atrMult: number,
): { upper: number[]; middle: number[]; lower: number[] } {
  const mid = ema(close, emaPeriod);
  const atrArr = atr(high, low, close, atrPeriod);
  const n = close.length;
  const upper = nanArray(n);
  const lower = nanArray(n);

  for (let i = 0; i < n; i++) {
    if (!isNaN(mid[i]) && !isNaN(atrArr[i])) {
      upper[i] = mid[i] + atrMult * atrArr[i];
      lower[i] = mid[i] - atrMult * atrArr[i];
    }
  }
  return { upper, middle: mid, lower };
}

/** Historical Volatility (annualized, based on close-to-close log returns) */
export function historicalVol(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period + 1) return out;

  const logReturns: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    logReturns[i] = close[i - 1] === 0 ? 0 : Math.log(close[i] / close[i - 1]);
  }

  for (let i = period; i < n; i++) {
    const m = mean(logReturns, i - period + 1, i + 1);
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = logReturns[j] - m;
      variance += diff * diff;
    }
    variance /= period - 1;
    out[i] = Math.sqrt(variance * 252) * 100; // annualized, as percentage
  }
  return out;
}

/** Bollinger %B */
export function bollingerPctB(
  close: readonly number[],
  period: number,
  mult: number,
): number[] {
  const { upper, lower } = bollingerBands(close, period, mult);
  const n = close.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNaN(upper[i]) && !isNaN(lower[i]) && upper[i] !== lower[i]) {
      out[i] = (close[i] - lower[i]) / (upper[i] - lower[i]);
    }
  }
  return out;
}

/** Bollinger Band Width */
export function bollingerWidth(
  close: readonly number[],
  period: number,
  mult: number,
): number[] {
  const { upper, middle, lower } = bollingerBands(close, period, mult);
  const n = close.length;
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!isNaN(upper[i]) && !isNaN(lower[i]) && !isNaN(middle[i]) && middle[i] !== 0) {
      out[i] = ((upper[i] - lower[i]) / middle[i]) * 100;
    }
  }
  return out;
}

/** Standard Deviation */
export function stdDev(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    const m = mean(close, i - period + 1, i + 1);
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = close[j] - m;
      variance += diff * diff;
    }
    out[i] = Math.sqrt(variance / period);
  }
  return out;
}

/** Chaikin Volatility */
export function chaikinVol(
  high: readonly number[],
  low: readonly number[],
  emaPeriod: number = 10,
  rocPeriod: number = 10,
): number[] {
  const n = high.length;
  const hl: number[] = new Array(n);
  for (let i = 0; i < n; i++) hl[i] = high[i] - low[i];
  const emaHL = ema(hl, emaPeriod);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    const prev = i - rocPeriod;
    if (prev >= 0 && !isNaN(emaHL[i]) && !isNaN(emaHL[prev]) && emaHL[prev] !== 0) {
      out[i] = ((emaHL[i] - emaHL[prev]) / emaHL[prev]) * 100;
    }
  }
  return out;
}

// =========================================================================
// VOLUME INDICATORS
// =========================================================================

/** On-Balance Volume */
export function obv(close: readonly number[], volume: readonly number[]): number[] {
  const n = close.length;
  const out: number[] = new Array(n).fill(0);
  out[0] = volume[0];
  for (let i = 1; i < n; i++) {
    if (close[i] > close[i - 1]) out[i] = out[i - 1] + volume[i];
    else if (close[i] < close[i - 1]) out[i] = out[i - 1] - volume[i];
    else out[i] = out[i - 1];
  }
  return out;
}

/** Volume SMA */
export function volumeSMA(volume: readonly number[], period: number): number[] {
  return sma(volume, period);
}

/** Accumulation/Distribution Line */
export function accumDist(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  volume: readonly number[],
): number[] {
  const n = close.length;
  const out: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const hl = high[i] - low[i];
    const mfm = hl === 0 ? 0 : ((close[i] - low[i]) - (high[i] - close[i])) / hl;
    const mfv = mfm * volume[i];
    out[i] = (i === 0 ? 0 : out[i - 1]) + mfv;
  }
  return out;
}

/** Chaikin Money Flow */
export function cmf(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  volume: readonly number[],
  period: number,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;

  const mfv: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const hl = high[i] - low[i];
    const mfm = hl === 0 ? 0 : ((close[i] - low[i]) - (high[i] - close[i])) / hl;
    mfv[i] = mfm * volume[i];
  }

  for (let i = period - 1; i < n; i++) {
    let sumMFV = 0;
    let sumVol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumMFV += mfv[j];
      sumVol += volume[j];
    }
    out[i] = sumVol === 0 ? 0 : sumMFV / sumVol;
  }
  return out;
}

/** Money Flow Index */
export function mfi(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  volume: readonly number[],
  period: number,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period + 1) return out;

  const tp: number[] = new Array(n);
  for (let i = 0; i < n; i++) tp[i] = (high[i] + low[i] + close[i]) / 3;

  let posFlow = 0;
  let negFlow = 0;
  for (let i = 1; i <= period; i++) {
    const rawMF = tp[i] * volume[i];
    if (tp[i] > tp[i - 1]) posFlow += rawMF;
    else if (tp[i] < tp[i - 1]) negFlow += rawMF;
  }
  out[period] = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);

  for (let i = period + 1; i < n; i++) {
    // Remove oldest bar from window
    const oldIdx = i - period;
    const oldMF = tp[oldIdx] * volume[oldIdx];
    if (oldIdx > 0 && tp[oldIdx] > tp[oldIdx - 1]) posFlow -= oldMF;
    else if (oldIdx > 0 && tp[oldIdx] < tp[oldIdx - 1]) negFlow -= oldMF;

    // Add newest bar
    const newMF = tp[i] * volume[i];
    if (tp[i] > tp[i - 1]) posFlow += newMF;
    else if (tp[i] < tp[i - 1]) negFlow += newMF;

    // Clamp to prevent floating point drift below zero
    posFlow = Math.max(0, posFlow);
    negFlow = Math.max(0, negFlow);

    out[i] = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
  }
  return out;
}

/** Volume Weighted Average Price (session-based, resets daily) */
export function vwap(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  volume: readonly number[],
): number[] {
  const n = close.length;
  const out: number[] = new Array(n);
  let cumTPV = 0;
  let cumVol = 0;
  for (let i = 0; i < n; i++) {
    const tp = (high[i] + low[i] + close[i]) / 3;
    cumTPV += tp * volume[i];
    cumVol += volume[i];
    out[i] = cumVol === 0 ? close[i] : cumTPV / cumVol;
  }
  return out;
}

// =========================================================================
// PRICE INDICATORS
// =========================================================================

/** Pivot Points (Classic) */
export function pivotPoints(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
): { pp: number[]; r1: number[]; r2: number[]; r3: number[]; s1: number[]; s2: number[]; s3: number[] } {
  const n = close.length;
  const pp = nanArray(n);
  const r1 = nanArray(n);
  const r2 = nanArray(n);
  const r3 = nanArray(n);
  const s1 = nanArray(n);
  const s2 = nanArray(n);
  const s3 = nanArray(n);

  // Use previous bar's HLC for pivot calculation
  for (let i = 1; i < n; i++) {
    const p = (high[i - 1] + low[i - 1] + close[i - 1]) / 3;
    pp[i] = p;
    r1[i] = 2 * p - low[i - 1];
    s1[i] = 2 * p - high[i - 1];
    r2[i] = p + (high[i - 1] - low[i - 1]);
    s2[i] = p - (high[i - 1] - low[i - 1]);
    r3[i] = high[i - 1] + 2 * (p - low[i - 1]);
    s3[i] = low[i - 1] - 2 * (high[i - 1] - p);
  }
  return { pp, r1, r2, r3, s1, s2, s3 };
}

/** Price vs. rolling High/Low (normalized 0-100 scale) */
export function priceVsHighLow(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period: number,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (high[j] > hh) hh = high[j];
      if (low[j] < ll) ll = low[j];
    }
    out[i] = hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100;
  }
  return out;
}

/** Z-Score of price relative to rolling mean */
export function zScore(close: readonly number[], period: number): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    const m = mean(close, i - period + 1, i + 1);
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = close[j] - m;
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / period);
    out[i] = sd === 0 ? 0 : (close[i] - m) / sd;
  }
  return out;
}

/** Heikin-Ashi candles */
export function heikinAshi(
  open: readonly number[],
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
): { haOpen: number[]; haHigh: number[]; haLow: number[]; haClose: number[] } {
  const n = close.length;
  const haOpen: number[] = new Array(n);
  const haHigh: number[] = new Array(n);
  const haLow: number[] = new Array(n);
  const haClose: number[] = new Array(n);

  haClose[0] = (open[0] + high[0] + low[0] + close[0]) / 4;
  haOpen[0] = (open[0] + close[0]) / 2;
  haHigh[0] = high[0];
  haLow[0] = low[0];

  for (let i = 1; i < n; i++) {
    haClose[i] = (open[i] + high[i] + low[i] + close[i]) / 4;
    haOpen[i] = (haOpen[i - 1] + haClose[i - 1]) / 2;
    haHigh[i] = Math.max(high[i], haOpen[i], haClose[i]);
    haLow[i] = Math.min(low[i], haOpen[i], haClose[i]);
  }
  return { haOpen, haHigh, haLow, haClose };
}

/** Percentage from rolling high */
export function pctFromHigh(
  high: readonly number[],
  close: readonly number[],
  period: number,
): number[] {
  const n = close.length;
  const out = nanArray(n);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (high[j] > hh) hh = high[j];
    }
    out[i] = hh === 0 ? 0 : ((close[i] - hh) / hh) * 100;
  }
  return out;
}

/** Support and Resistance (based on pivot-like local extremes) */
export function supportResistance(
  high: readonly number[],
  low: readonly number[],
  close: readonly number[],
  period: number,
): { support: number[]; resistance: number[] } {
  const n = close.length;
  const support = nanArray(n);
  const resistance = nanArray(n);
  if (n < period) return { support, resistance };

  for (let i = period - 1; i < n; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (high[j] > hh) hh = high[j];
      if (low[j] < ll) ll = low[j];
    }
    resistance[i] = hh;
    support[i] = ll;
  }
  return { support, resistance };
}
