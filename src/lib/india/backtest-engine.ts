import type {
  BacktestMetrics,
  BacktestResult,
  CombineLogic,
  IndicatorConfig,
  PriceData,
  RebalanceFreq,
  SignalRule,
  SizingConfig,
  StrategyConfig,
  Trade,
} from './types';

import * as ind from './indicators';
import {
  computeTradeCosts,
  type InstrumentClass,
} from '@/lib/portfolio/transaction-costs';

export function runBacktest(
  prices: PriceData,
  config: StrategyConfig,
  lotSize: number,
  instrumentClass: InstrumentClass = 'NSE_FO_STOCK',
): BacktestResult {
  const n = prices.close.length;
  if (n < 2) return emptyResult();

  const indicatorOutputs = computeIndicators(prices, config.indicators);

  const rawSignals = generateSignals(indicatorOutputs, config.rules, config.combine_logic, n);

  const signals = applyRebalance(rawSignals, prices.dates, config.rebalance);

  const lots = computeLots(prices.close as number[], signals, config.sizing, lotSize);

  const grossPnl = computeDailyPnl(prices.close as number[], signals, lots, lotSize);

  const tradeCosts = computeTradeCosts(
    prices.close as number[],
    signals,
    lots,
    lotSize,
    instrumentClass,
  );

  const dailyPnl = grossPnl.map((p, i) => p - (tradeCosts[i] ?? 0));
  const totalCosts = tradeCosts.reduce((a, b) => a + b, 0);

  const trades = buildTradeLog(prices, signals, lots, lotSize);

  const metrics = computeMetrics(dailyPnl, trades, prices.dates as string[]);
  metrics.total_transaction_costs = round2(totalCosts);

  const equityCurve = buildEquityCurve(dailyPnl, prices.dates as string[]);
  const drawdown = buildDrawdown(equityCurve.cumulative);

  const monthly = aggregateMonthly(dailyPnl, prices.dates as string[]);
  const yearly = aggregateYearly(dailyPnl, prices.dates as string[]);

  return {
    metrics,
    equity_curve: equityCurve,
    drawdown: { dates: equityCurve.dates, values: drawdown },
    monthly,
    yearly,
    trades,
    signals: { dates: [...(prices.dates as string[])], values: signals },
  };
}

interface IndicatorOutput {
  primary: number[];
  all: Record<string, number[]>;
}

function computeIndicators(
  prices: PriceData,
  configs: readonly IndicatorConfig[],
): IndicatorOutput[] {
  const c = prices.close as number[];
  const h = prices.high as number[];
  const l = prices.low as number[];
  const o = prices.open as number[];
  const v = prices.volume as number[];

  return configs.map((cfg): IndicatorOutput => {
    const p = cfg.params;
    switch (cfg.type) {
      case 'sma': {
        const out = ind.sma(c, p.period ?? 20);
        return { primary: out, all: { sma: out } };
      }
      case 'ema': {
        const out = ind.ema(c, p.period ?? 20);
        return { primary: out, all: { ema: out } };
      }
      case 'dema': {
        const out = ind.dema(c, p.period ?? 20);
        return { primary: out, all: { dema: out } };
      }
      case 'tema': {
        const out = ind.tema(c, p.period ?? 20);
        return { primary: out, all: { tema: out } };
      }
      case 'wma': {
        const out = ind.wma(c, p.period ?? 20);
        return { primary: out, all: { wma: out } };
      }
      case 'hull_ma': {
        const out = ind.hullMA(c, p.period ?? 20);
        return { primary: out, all: { hull_ma: out } };
      }
      case 'vwma': {
        const out = ind.vwma(c, v, p.period ?? 20);
        return { primary: out, all: { vwma: out } };
      }
      case 'supertrend': {
        const res = ind.supertrend(h, l, c, p.period ?? 10, p.multiplier ?? 3);
        return { primary: res.direction, all: { supertrend: res.supertrend, direction: res.direction } };
      }
      case 'ichimoku': {
        const res = ind.ichimoku(h, l, c, p.conversion ?? 9, p.base ?? 26, p.span_b ?? 52, p.displacement ?? 26);
        return { primary: res.tenkan, all: { tenkan: res.tenkan, kijun: res.kijun, spanA: res.spanA, spanB: res.spanB, chikou: res.chikou } };
      }
      case 'parabolic_sar': {
        const out = ind.parabolicSAR(h, l, p.af_start ?? 0.02, p.af_increment ?? 0.02, p.af_max ?? 0.2);
        return { primary: out, all: { sar: out } };
      }
      case 'linear_regression': {
        const out = ind.linearRegression(c, p.period ?? 20);
        return { primary: out, all: { lr: out } };
      }
      case 'donchian': {
        const res = ind.donchianChannel(h, l, p.period ?? 20);
        return { primary: res.middle, all: { upper: res.upper, middle: res.middle, lower: res.lower } };
      }
      case 'rsi': {
        const out = ind.rsi(c, p.period ?? 14);
        return { primary: out, all: { rsi: out } };
      }
      case 'stoch_rsi': {
        const res = ind.stochRSI(c, p.rsi_period ?? 14, p.stoch_period ?? 14, p.k_smooth ?? 3, p.d_smooth ?? 3);
        return { primary: res.k, all: { k: res.k, d: res.d } };
      }
      case 'macd': {
        const res = ind.macd(c, p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
        return { primary: res.macd, all: { macd: res.macd, signal: res.signal, histogram: res.histogram } };
      }
      case 'adx': {
        const res = ind.adx(h, l, c, p.period ?? 14);
        return { primary: res.adx, all: { adx: res.adx, plusDI: res.plusDI, minusDI: res.minusDI } };
      }
      case 'cci': {
        const out = ind.cci(h, l, c, p.period ?? 20);
        return { primary: out, all: { cci: out } };
      }
      case 'roc': {
        const out = ind.roc(c, p.period ?? 12);
        return { primary: out, all: { roc: out } };
      }
      case 'williams_r': {
        const out = ind.williamsR(h, l, c, p.period ?? 14);
        return { primary: out, all: { williams_r: out } };
      }
      case 'momentum': {
        const out = ind.momentum(c, p.period ?? 10);
        return { primary: out, all: { momentum: out } };
      }
      case 'tsi': {
        const out = ind.tsi(c, p.long_period ?? 25, p.short_period ?? 13);
        return { primary: out, all: { tsi: out } };
      }
      case 'awesome_osc': {
        const out = ind.awesomeOscillator(h, l, p.fast ?? 5, p.slow ?? 34);
        return { primary: out, all: { ao: out } };
      }
      case 'ppo': {
        const res = ind.ppo(c, p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
        return { primary: res.ppo, all: { ppo: res.ppo, signal: res.signal, histogram: res.histogram } };
      }
      case 'ts_momentum': {
        const out = ind.tsMomentum(c, p.period ?? 126);
        return { primary: out, all: { ts_momentum: out } };
      }
      case 'bollinger': {
        const res = ind.bollingerBands(c, p.period ?? 20, p.std_dev ?? 2);
        return { primary: res.middle, all: { upper: res.upper, middle: res.middle, lower: res.lower } };
      }
      case 'atr': {
        const out = ind.atr(h, l, c, p.period ?? 14);
        return { primary: out, all: { atr: out } };
      }
      case 'keltner': {
        const res = ind.keltnerChannel(h, l, c, p.ema_period ?? 20, p.atr_period ?? 10, p.atr_mult ?? 2);
        return { primary: res.middle, all: { upper: res.upper, middle: res.middle, lower: res.lower } };
      }
      case 'hist_vol': {
        const out = ind.historicalVol(c, p.period ?? 20);
        return { primary: out, all: { hist_vol: out } };
      }
      case 'bb_pct_b': {
        const out = ind.bollingerPctB(c, p.period ?? 20, p.std_dev ?? 2);
        return { primary: out, all: { pct_b: out } };
      }
      case 'bb_width': {
        const out = ind.bollingerWidth(c, p.period ?? 20, p.std_dev ?? 2);
        return { primary: out, all: { bb_width: out } };
      }
      case 'std_dev': {
        const out = ind.stdDev(c, p.period ?? 20);
        return { primary: out, all: { std_dev: out } };
      }
      case 'chaikin_vol': {
        const out = ind.chaikinVol(h, l, p.ema_period ?? 10, p.roc_period ?? 10);
        return { primary: out, all: { chaikin_vol: out } };
      }
      case 'obv': {
        const out = ind.obv(c, v);
        return { primary: out, all: { obv: out } };
      }
      case 'vol_sma': {
        const out = ind.volumeSMA(v, p.period ?? 20);
        return { primary: out, all: { vol_sma: out } };
      }
      case 'accum_dist': {
        const out = ind.accumDist(h, l, c, v);
        return { primary: out, all: { ad: out } };
      }
      case 'cmf': {
        const out = ind.cmf(h, l, c, v, p.period ?? 20);
        return { primary: out, all: { cmf: out } };
      }
      case 'mfi': {
        const out = ind.mfi(h, l, c, v, p.period ?? 14);
        return { primary: out, all: { mfi: out } };
      }
      case 'vwap': {
        const out = ind.vwap(h, l, c, v);
        return { primary: out, all: { vwap: out } };
      }
      case 'pivot_points': {
        const res = ind.pivotPoints(h, l, c);
        return { primary: res.pp, all: { pp: res.pp, r1: res.r1, r2: res.r2, r3: res.r3, s1: res.s1, s2: res.s2, s3: res.s3 } };
      }
      case 'price_vs_high_low': {
        const out = ind.priceVsHighLow(h, l, c, p.period ?? 20);
        return { primary: out, all: { pvhl: out } };
      }
      case 'z_score': {
        const out = ind.zScore(c, p.period ?? 20);
        return { primary: out, all: { z_score: out } };
      }
      case 'heikin_ashi': {
        const res = ind.heikinAshi(o, h, l, c);
        return { primary: res.haClose, all: { haOpen: res.haOpen, haHigh: res.haHigh, haLow: res.haLow, haClose: res.haClose } };
      }
      case 'pct_from_high': {
        const out = ind.pctFromHigh(h, c, p.period ?? 52);
        return { primary: out, all: { pct_from_high: out } };
      }
      case 'support_resistance': {
        const res = ind.supportResistance(h, l, c, p.period ?? 20);
        return { primary: res.support, all: { support: res.support, resistance: res.resistance } };
      }
      case 'close_price': {
        return { primary: [...c], all: { close: [...c] } };
      }
      default:
        return { primary: new Array(c.length).fill(NaN), all: {} };
    }
  });
}

function generateSignals(
  indicators: IndicatorOutput[],
  rules: readonly SignalRule[],
  logic: CombineLogic,
  n: number,
): number[] {
  if (rules.length === 0) return new Array(n).fill(0);

  const rawTriggers: number[][] = rules.map((rule) => evaluateRuleRaw(rule, indicators, n));

  const isLevel: boolean[] = rules.map((r) => r.condition === 'is_above' || r.condition === 'is_below');

  const combined: number[] = new Array(n).fill(0);

  if (logic === 'or') {
    const heldPerRule: number[][] = rawTriggers.map((raw, r) => {
      if (isLevel[r]) return raw;
      const held: number[] = new Array(n).fill(0);
      let last = 0;
      for (let i = 0; i < n; i++) {
        if (raw[i] !== 0) last = raw[i];
        held[i] = last;
      }
      return held;
    });

    for (let i = 0; i < n; i++) {
      let sig = 0;
      for (const held of heldPerRule) {
        if (held[i] !== 0) sig = held[i];
      }
      combined[i] = sig;
    }
  } else {
    const heldSignals: number[][] = rawTriggers.map((raw) => {
      const held: number[] = new Array(n).fill(0);
      let last = 0;
      for (let i = 0; i < n; i++) {
        if (raw[i] !== 0) last = raw[i];
        held[i] = last;
      }
      return held;
    });

    for (let i = 0; i < n; i++) {
      let longCount = 0;
      let shortCount = 0;
      let activeCount = 0;
      for (const hs of heldSignals) {
        if (hs[i] === 1) { longCount++; activeCount++; }
        else if (hs[i] === -1) { shortCount++; activeCount++; }
      }
      if (activeCount > 0 && longCount > 0 && shortCount === 0) combined[i] = 1;
      else if (activeCount > 0 && shortCount > 0 && longCount === 0) combined[i] = -1;
      else combined[i] = 0;
    }
  }

  return combined;
}

function evaluateRuleRaw(
  rule: SignalRule,
  indicators: IndicatorOutput[],
  n: number,
): number[] {
  const out: number[] = new Array(n).fill(0);
  const indData = indicators[rule.indicator_index]?.primary;
  if (!indData) return out;

  const refData = rule.reference_indicator != null
    ? indicators[rule.reference_indicator]?.primary
    : undefined;

  for (let i = 1; i < n; i++) {
    const val = indData[i];
    const prevVal = indData[i - 1];
    if (isNaN(val) || isNaN(prevVal)) continue;

    let fired = false;

    switch (rule.condition) {
      case 'crosses_above': {
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        const prevTarget = refData ? refData[i - 1] : (rule.threshold ?? 0);
        if (isNaN(target) || isNaN(prevTarget)) break;
        fired = prevVal <= prevTarget && val > target;
        break;
      }
      case 'crosses_below': {
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        const prevTarget = refData ? refData[i - 1] : (rule.threshold ?? 0);
        if (isNaN(target) || isNaN(prevTarget)) break;
        fired = prevVal >= prevTarget && val < target;
        break;
      }
      case 'is_above': {
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        if (isNaN(target)) break;
        fired = val > target;
        break;
      }
      case 'is_below': {
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        if (isNaN(target)) break;
        fired = val < target;
        break;
      }
      case 'between': {
        const lower = rule.threshold ?? 0;
        const upper = refData ? refData[i] : 100;
        if (isNaN(upper)) break;
        fired = val >= lower && val <= upper;
        break;
      }
    }

    if (fired) {
      if (rule.direction === 'both') {
        if (rule.condition === 'crosses_above' || rule.condition === 'is_above') out[i] = 1;
        else out[i] = -1;
      } else if (rule.direction === 'long') {
        out[i] = 1;
      } else {
        out[i] = -1;
      }
    } else if (rule.direction === 'both' && (rule.condition === 'is_above' || rule.condition === 'is_below')) {
      const target = refData ? refData[i] : (rule.threshold ?? 0);
      if (!isNaN(val) && !isNaN(target)) {
        if (rule.condition === 'is_above') out[i] = -1;
        else out[i] = 1;
      }
    }
  }

  return out;
}

function evaluateRule(
  rule: SignalRule,
  indicators: IndicatorOutput[],
  n: number,
): number[] {
  const out: number[] = new Array(n).fill(0);
  const indData = indicators[rule.indicator_index]?.primary;
  if (!indData) return out;

  const refData = rule.reference_indicator != null
    ? indicators[rule.reference_indicator]?.primary
    : undefined;

  for (let i = 1; i < n; i++) {
    const val = indData[i];
    const prevVal = indData[i - 1];
    if (isNaN(val) || isNaN(prevVal)) continue;

    let fired = false;

    switch (rule.condition) {
      case 'crosses_above': {
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        const prevTarget = refData ? refData[i - 1] : (rule.threshold ?? 0);
        if (isNaN(target) || isNaN(prevTarget)) break;
        fired = prevVal <= prevTarget && val > target;
        break;
      }
      case 'crosses_below': {
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        const prevTarget = refData ? refData[i - 1] : (rule.threshold ?? 0);
        if (isNaN(target) || isNaN(prevTarget)) break;
        fired = prevVal >= prevTarget && val < target;
        break;
      }
      case 'is_above': {
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        if (isNaN(target)) break;
        fired = val > target;
        break;
      }
      case 'is_below': {
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        if (isNaN(target)) break;
        fired = val < target;
        break;
      }
      case 'between': {
        const lower = rule.threshold ?? 0;
        const upper = refData ? refData[i] : 100;
        if (isNaN(upper)) break;
        fired = val >= lower && val <= upper;
        break;
      }
    }

    if (fired) {
      if (rule.direction === 'both') {
        if (rule.condition === 'crosses_above' || rule.condition === 'is_above') out[i] = 1;
        else out[i] = -1;
      } else if (rule.direction === 'long') {
        out[i] = 1;
      } else {
        out[i] = -1;
      }
    }
  }

  if (rule.condition === 'crosses_above' || rule.condition === 'crosses_below') {
    let lastSignal = 0;
    for (let i = 0; i < n; i++) {
      if (out[i] !== 0) lastSignal = out[i];
      else out[i] = lastSignal;
    }
  }

  if (rule.direction === 'both' && (rule.condition === 'is_above' || rule.condition === 'is_below')) {
    for (let i = 1; i < n; i++) {
      if (out[i] === 0) {
        const val = indData[i];
        const target = refData ? refData[i] : (rule.threshold ?? 0);
        if (!isNaN(val) && !isNaN(target)) {
          if (rule.condition === 'is_above' && val <= target) out[i] = -1;
          else if (rule.condition === 'is_below' && val >= target) out[i] = 1;
        }
      }
    }
  }

  return out;
}

function applyRebalance(
  signals: number[],
  dates: readonly string[],
  freq: RebalanceFreq,
): number[] {
  if (freq === 'daily') return signals;

  const n = signals.length;
  const out: number[] = new Array(n).fill(0);
  let lastRebalanceSignal = 0;
  let lastRebalanceDate: Date | null = null;

  for (let i = 0; i < n; i++) {
    const d = new Date(dates[i]);
    const isRebalanceDay = shouldRebalance(d, lastRebalanceDate, freq);

    if (isRebalanceDay) {
      lastRebalanceSignal = signals[i];
      lastRebalanceDate = d;
    }
    out[i] = lastRebalanceSignal;
  }
  return out;
}

function shouldRebalance(
  current: Date,
  last: Date | null,
  freq: RebalanceFreq,
): boolean {
  if (!last) return true;

  switch (freq) {
    case 'weekly':
      return current.getDay() === 1 || daysDiff(last, current) >= 7;
    case 'biweekly':
      return daysDiff(last, current) >= 14;
    case 'monthly':
      return current.getMonth() !== last.getMonth() || current.getFullYear() !== last.getFullYear();
    default:
      return true;
  }
}

function daysDiff(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

function computeLots(
  close: number[],
  signals: number[],
  sizing: SizingConfig,
  lotSize: number,
): number[] {
  const n = close.length;
  const lots: number[] = new Array(n).fill(0);
  const { risk_budget, vol_window, z_multiplier } = sizing;

  const returns: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    returns[i] = close[i - 1] === 0 ? 0 : (close[i] - close[i - 1]) / close[i - 1];
  }

  for (let i = vol_window; i < n; i++) {
    if (signals[i] === 0) continue;

    let m = 0;
    for (let j = i - vol_window + 1; j <= i; j++) m += returns[j];
    m /= vol_window;
    let variance = 0;
    for (let j = i - vol_window + 1; j <= i; j++) {
      const diff = returns[j] - m;
      variance += diff * diff;
    }
    const vol = Math.sqrt(variance / (vol_window - 1));
    const volFloor = Math.max(vol, 0.01);

    const denom = close[i] * lotSize * volFloor * z_multiplier;
    if (denom <= 0) continue;
    const rawLots = Math.floor(risk_budget / denom);
    lots[i] = Math.max(rawLots, 1);
  }
  return lots;
}

function computeDailyPnl(
  close: number[],
  signals: number[],
  lots: number[],
  lotSize: number,
): number[] {
  const n = close.length;
  const pnl: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const prevSignal = signals[i - 1];
    const prevLots = lots[i - 1];
    if (prevSignal === 0 || prevLots === 0) continue;
    const priceChange = close[i] - close[i - 1];
    pnl[i] = prevSignal * prevLots * lotSize * priceChange;
  }
  return pnl;
}

function buildTradeLog(
  prices: PriceData,
  signals: number[],
  lots: number[],
  lotSize: number,
): Trade[] {
  const trades: Trade[] = [];
  const n = signals.length;
  const close = prices.close as number[];
  const dates = prices.dates as string[];

  let inTrade = false;
  let entryIdx = 0;
  let entrySignal = 0;
  let entryLots = 0;

  for (let i = 1; i < n; i++) {
    const prevSig = signals[i - 1];
    const curSig = signals[i];

    if (!inTrade && curSig !== 0) {
      inTrade = true;
      entryIdx = i;
      entrySignal = curSig;
      entryLots = lots[i];
    } else if (inTrade && (curSig !== entrySignal || curSig === 0)) {
      const entryPrice = close[entryIdx];
      const exitPrice = close[i];
      const tradePnl = entrySignal * entryLots * lotSize * (exitPrice - entryPrice);
      const tradePnlPct = entryPrice === 0 ? 0 : ((exitPrice - entryPrice) / entryPrice) * 100 * entrySignal;
      const dur = daysDiff(new Date(dates[entryIdx]), new Date(dates[i]));

      trades.push({
        entry_date: dates[entryIdx],
        exit_date: dates[i],
        direction: entrySignal === 1 ? 'long' : 'short',
        lots: entryLots,
        entry_price: entryPrice,
        exit_price: exitPrice,
        pnl: tradePnl,
        pnl_pct: tradePnlPct,
        duration_days: Math.max(dur, 1),
      });

      if (curSig !== 0) {
        inTrade = true;
        entryIdx = i;
        entrySignal = curSig;
        entryLots = lots[i];
      } else {
        inTrade = false;
      }
    }
  }

  if (inTrade) {
    const entryPrice = close[entryIdx];
    const exitPrice = close[n - 1];
    const tradePnl = entrySignal * entryLots * lotSize * (exitPrice - entryPrice);
    const tradePnlPct = entryPrice === 0 ? 0 : ((exitPrice - entryPrice) / entryPrice) * 100 * entrySignal;
    const dur = daysDiff(new Date(dates[entryIdx]), new Date(dates[n - 1]));

    trades.push({
      entry_date: dates[entryIdx],
      exit_date: dates[n - 1],
      direction: entrySignal === 1 ? 'long' : 'short',
      lots: entryLots,
      entry_price: entryPrice,
      exit_price: exitPrice,
      pnl: tradePnl,
      pnl_pct: tradePnlPct,
      duration_days: Math.max(dur, 1),
    });
  }

  return trades;
}

function computeMetrics(
  dailyPnl: number[],
  trades: Trade[],
  dates: string[],
): BacktestMetrics {
  const nonZero = dailyPnl.filter((v) => v !== 0);
  const totalPnl = dailyPnl.reduce((a, b) => a + b, 0);

  const cumPnl: number[] = new Array(dailyPnl.length);
  cumPnl[0] = dailyPnl[0];
  for (let i = 1; i < dailyPnl.length; i++) cumPnl[i] = cumPnl[i - 1] + dailyPnl[i];

  const peak = Math.max(...cumPnl.filter((v) => !isNaN(v)), 0);
  const initialEquity = 1_000_000;
  const meanPnl = nonZero.length === 0 ? 0 : nonZero.reduce((a, b) => a + b, 0) / dailyPnl.length;
  const pnlStd = stdDevArr(dailyPnl);
  const sharpe = pnlStd === 0 ? 0 : (meanPnl / pnlStd) * Math.sqrt(252);

  const downsideDev = downsideDeviation(dailyPnl);
  const sortino = downsideDev === 0 ? 0 : (meanPnl / downsideDev) * Math.sqrt(252);

  const { maxDdPct, maxDdInr, maxDdDurationDays } = maxDrawdownStats(cumPnl, dates, initialEquity);

  const years = dates.length / 252;
  const annualReturn = years === 0 ? 0 : totalPnl / years;
  const calmar = maxDdInr === 0 ? 0 : annualReturn / Math.abs(maxDdInr);

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));

  const winRate = trades.length === 0 ? 0 : (wins.length / trades.length) * 100;
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;
  const avgWin = wins.length === 0 ? 0 : grossProfit / wins.length;
  const avgLoss = losses.length === 0 ? 0 : grossLoss / losses.length;
  const payoffRatio = avgLoss === 0 ? 0 : avgWin / avgLoss;

  const avgHoldDays = trades.length === 0
    ? 0
    : trades.reduce((a, t) => a + t.duration_days, 0) / trades.length;

  const tradePnls = trades.map((t) => t.pnl);
  const bestTrade = tradePnls.length === 0 ? 0 : Math.max(...tradePnls);
  const worstTrade = tradePnls.length === 0 ? 0 : Math.min(...tradePnls);

  const { maxConsecWins, maxConsecLosses } = consecutiveStreaks(trades);

  return {
    sharpe: round4(sharpe),
    sortino: round4(sortino),
    calmar: round4(calmar),
    max_dd_pct: round4(-maxDdPct),
    max_dd_inr: round2(-maxDdInr),
    max_dd_duration_days: maxDdDurationDays,
    total_return_pct: round4((totalPnl / initialEquity) * 100),
    annual_return_pct: round4((annualReturn / initialEquity) * 100),
    total_pnl: round2(totalPnl),
    win_rate_pct: round2(winRate),
    profit_factor: round4(profitFactor),
    payoff_ratio: round4(payoffRatio),
    num_trades: trades.length,
    avg_hold_days: round2(avgHoldDays),
    avg_trade_pnl: trades.length === 0 ? 0 : round2(totalPnl / trades.length),
    best_trade: round2(bestTrade),
    worst_trade: round2(worstTrade),
    avg_win: round2(avgWin),
    avg_loss: round2(avgLoss),
    max_consec_wins: maxConsecWins,
    max_consec_losses: maxConsecLosses,
    gross_profit: round2(grossProfit),
    gross_loss: round2(grossLoss),
  };
}

function buildEquityCurve(
  dailyPnl: number[],
  dates: string[],
): { dates: string[]; cumulative: number[] } {
  const n = dailyPnl.length;
  const cumulative: number[] = new Array(n);
  cumulative[0] = dailyPnl[0];
  for (let i = 1; i < n; i++) cumulative[i] = cumulative[i - 1] + dailyPnl[i];
  return { dates: [...dates], cumulative };
}

function buildDrawdown(cumulative: number[]): number[] {
  const n = cumulative.length;
  const dd: number[] = new Array(n);
  let peak = -Infinity;
  for (let i = 0; i < n; i++) {
    if (cumulative[i] > peak) peak = cumulative[i];
    dd[i] = cumulative[i] - peak;
  }
  return dd;
}

function aggregateMonthly(
  dailyPnl: number[],
  dates: string[],
): Array<{ year: number; month: number; pnl: number }> {
  const map = new Map<string, { year: number; month: number; pnl: number }>();
  for (let i = 0; i < dailyPnl.length; i++) {
    const d = new Date(dates[i]);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const key = `${year}-${month}`;
    const existing = map.get(key);
    if (existing) existing.pnl += dailyPnl[i];
    else map.set(key, { year, month, pnl: dailyPnl[i] });
  }
  return Array.from(map.values()).map((v) => ({ ...v, pnl: round2(v.pnl) }));
}

function aggregateYearly(
  dailyPnl: number[],
  dates: string[],
): Array<{ year: number; pnl: number }> {
  const map = new Map<number, number>();
  for (let i = 0; i < dailyPnl.length; i++) {
    const year = new Date(dates[i]).getFullYear();
    map.set(year, (map.get(year) ?? 0) + dailyPnl[i]);
  }
  return Array.from(map.entries())
    .map(([year, pnl]) => ({ year, pnl: round2(pnl) }))
    .sort((a, b) => a.year - b.year);
}

function stdDevArr(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  let m = 0;
  for (let i = 0; i < n; i++) m += arr[i];
  m /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const diff = arr[i] - m;
    variance += diff * diff;
  }
  return Math.sqrt(variance / (n - 1));
}

function downsideDeviation(arr: number[]): number {
  const negatives = arr.filter((v) => v < 0);
  if (negatives.length === 0) return 0;
  let m = 0;
  for (const v of negatives) m += v;
  m /= arr.length;
  let variance = 0;
  for (const v of arr) {
    if (v < 0) {
      const diff = v - m;
      variance += diff * diff;
    }
  }
  return Math.sqrt(variance / (arr.length - 1));
}

function maxDrawdownStats(
  cumPnl: number[],
  dates: string[],
  initialEquity: number,
): { maxDdPct: number; maxDdInr: number; maxDdDurationDays: number } {
  let peak = 0;
  let maxDdInr = 0;
  let maxDdPct = 0;
  let peakIdx = 0;
  let maxDdDuration = 0;

  for (let i = 0; i < cumPnl.length; i++) {
    if (cumPnl[i] > peak) {
      peak = cumPnl[i];
      peakIdx = i;
    }
    const dd = peak - cumPnl[i];
    if (dd > maxDdInr) {
      maxDdInr = dd;
      const equity = initialEquity + peak;
      maxDdPct = equity === 0 ? 0 : (dd / equity) * 100;
      maxDdDuration = daysDiff(new Date(dates[peakIdx]), new Date(dates[i]));
    }
  }
  return { maxDdPct, maxDdInr, maxDdDurationDays: maxDdDuration };
}

function consecutiveStreaks(trades: Trade[]): { maxConsecWins: number; maxConsecLosses: number } {
  let maxW = 0;
  let maxL = 0;
  let curW = 0;
  let curL = 0;

  for (const t of trades) {
    if (t.pnl > 0) {
      curW++;
      curL = 0;
      if (curW > maxW) maxW = curW;
    } else {
      curL++;
      curW = 0;
      if (curL > maxL) maxL = curL;
    }
  }
  return { maxConsecWins: maxW, maxConsecLosses: maxL };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

function emptyResult(): BacktestResult {
  return {
    metrics: {
      sharpe: 0, sortino: 0, calmar: 0,
      max_dd_pct: 0, max_dd_inr: 0, max_dd_duration_days: 0,
      total_return_pct: 0, annual_return_pct: 0, total_pnl: 0,
      win_rate_pct: 0, profit_factor: 0, payoff_ratio: 0,
      num_trades: 0, avg_hold_days: 0, avg_trade_pnl: 0,
      best_trade: 0, worst_trade: 0,
      avg_win: 0, avg_loss: 0,
      max_consec_wins: 0, max_consec_losses: 0,
      gross_profit: 0, gross_loss: 0,
    },
    equity_curve: { dates: [], cumulative: [] },
    drawdown: { dates: [], values: [] },
    monthly: [],
    yearly: [],
    trades: [],
    signals: { dates: [], values: [] },
  };
}
