/**
 * India Equities — Indicator Metadata
 *
 * Labels, descriptions, categories, and parameter specs for all indicators.
 * Shared between the strategy builder UI and the block pipeline.
 */

import type { IndicatorType } from './types';

export interface IndicatorMeta {
  readonly label: string;
  readonly desc: string;
  readonly category: 'Trend' | 'Momentum' | 'Volatility' | 'Volume' | 'Price';
  readonly params: readonly { key: string; label: string; min: number; max: number; step: number; default: number }[];
}

export const INDICATOR_META: Record<IndicatorType, IndicatorMeta> = {
  sma: { label: 'SMA', desc: 'Simple Moving Average: average of last N closing prices. Smooths noise to reveal trend direction.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  ema: { label: 'EMA', desc: 'Exponential Moving Average: weighted average giving more importance to recent prices. Reacts faster than SMA.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  dema: { label: 'DEMA', desc: 'Double EMA: applies EMA twice to reduce lag. Formula: 2*EMA(N) - EMA(EMA(N)).', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  tema: { label: 'TEMA', desc: 'Triple EMA: three-layer EMA for minimal lag.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  wma: { label: 'WMA', desc: 'Weighted Moving Average: linearly weighted, most recent price gets highest weight.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  hull_ma: { label: 'Hull MA', desc: 'Hull Moving Average: uses WMA of difference between short and long WMA. Very low lag, smooth.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 4, max: 200, step: 1, default: 20 }] },
  vwma: { label: 'VWMA', desc: 'Volume-Weighted Moving Average: weights each price by its volume. High-volume days matter more.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  supertrend: { label: 'SuperTrend', desc: 'Trend-following using ATR bands. Outputs +1 (bullish) or -1 (bearish).', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 10 }, { key: 'multiplier', label: 'Multiplier', min: 1, max: 5, step: 0.1, default: 3 }] },
  ichimoku: { label: 'Ichimoku', desc: 'Ichimoku Cloud: 5 lines showing support, resistance, trend, and momentum.', category: 'Trend', params: [{ key: 'conversion', label: 'Conversion', min: 5, max: 30, step: 1, default: 9 }, { key: 'base', label: 'Base', min: 10, max: 60, step: 1, default: 26 }, { key: 'span_b', label: 'Span B', min: 20, max: 120, step: 1, default: 52 }] },
  parabolic_sar: { label: 'Parabolic SAR', desc: 'Stop and Reverse: dots above/below price signaling trend and trailing stops.', category: 'Trend', params: [{ key: 'af_start', label: 'AF Start', min: 0.01, max: 0.1, step: 0.005, default: 0.02 }, { key: 'af_max', label: 'AF Max', min: 0.1, max: 0.5, step: 0.01, default: 0.2 }] },
  linear_regression: { label: 'Linear Reg', desc: 'Linear Regression: best-fit line through last N prices.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  donchian: { label: 'Donchian', desc: 'Donchian Channel: highest high and lowest low over N periods. Breakout strategy.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  rsi: { label: 'RSI', desc: 'Relative Strength Index (0-100): >70 overbought, <30 oversold.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 2, max: 50, step: 1, default: 14 }] },
  stoch_rsi: { label: 'Stoch RSI', desc: 'Stochastic RSI (0-1): RSI with Stochastic formula. More sensitive.', category: 'Momentum', params: [{ key: 'rsi_period', label: 'RSI Period', min: 2, max: 50, step: 1, default: 14 }, { key: 'stoch_period', label: 'Stoch Period', min: 2, max: 50, step: 1, default: 14 }, { key: 'k_smooth', label: 'K Smooth', min: 1, max: 10, step: 1, default: 3 }] },
  macd: { label: 'MACD', desc: 'Moving Average Convergence Divergence: fast EMA minus slow EMA. >0 bullish.', category: 'Momentum', params: [{ key: 'fast', label: 'Fast', min: 5, max: 50, step: 1, default: 12 }, { key: 'slow', label: 'Slow', min: 10, max: 100, step: 1, default: 26 }, { key: 'signal', label: 'Signal', min: 2, max: 20, step: 1, default: 9 }] },
  adx: { label: 'ADX', desc: 'Average Directional Index (0-100): measures trend strength. >25 strong trend.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 14 }] },
  cci: { label: 'CCI', desc: 'Commodity Channel Index: deviation from statistical mean. >100 overbought.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 20 }] },
  roc: { label: 'ROC', desc: 'Rate of Change (%): percentage price change over N periods.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 1, max: 50, step: 1, default: 12 }] },
  williams_r: { label: 'Williams %R', desc: 'Williams %R (-100 to 0): >-20 overbought, <-80 oversold.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 14 }] },
  momentum: { label: 'Momentum', desc: 'Price Momentum: current price minus price N bars ago.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 1, max: 50, step: 1, default: 10 }] },
  tsi: { label: 'TSI', desc: 'True Strength Index (-100 to +100): double-smoothed momentum.', category: 'Momentum', params: [{ key: 'long_period', label: 'Long', min: 10, max: 50, step: 1, default: 25 }, { key: 'short_period', label: 'Short', min: 5, max: 25, step: 1, default: 13 }] },
  awesome_osc: { label: 'Awesome Osc', desc: 'Awesome Oscillator: difference between 5 and 34-period SMA of midpoints.', category: 'Momentum', params: [{ key: 'fast', label: 'Fast', min: 2, max: 20, step: 1, default: 5 }, { key: 'slow', label: 'Slow', min: 10, max: 50, step: 1, default: 34 }] },
  ppo: { label: 'PPO', desc: 'Percentage Price Oscillator: MACD as a percentage for cross-price comparison.', category: 'Momentum', params: [{ key: 'fast', label: 'Fast', min: 5, max: 50, step: 1, default: 12 }, { key: 'slow', label: 'Slow', min: 10, max: 100, step: 1, default: 26 }] },
  ts_momentum: { label: 'TS Momentum', desc: 'Time-Series Momentum: cumulative return over lookback. >0 trending up.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 5, max: 250, step: 1, default: 126 }] },
  bollinger: { label: 'Bollinger Bands', desc: 'SMA with bands at N standard deviations. Near upper = potentially overbought.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }, { key: 'std_dev', label: 'Std Dev', min: 0.5, max: 4, step: 0.1, default: 2 }] },
  atr: { label: 'ATR', desc: 'Average True Range: average of true ranges (high-low + gaps). Higher = more volatile.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 14 }] },
  keltner: { label: 'Keltner Channel', desc: 'EMA with ATR-based bands. Similar to Bollinger but smoother.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 20 }, { key: 'multiplier', label: 'Multiplier', min: 0.5, max: 4, step: 0.1, default: 1.5 }] },
  hist_vol: { label: 'Historical Vol', desc: 'Annualized standard deviation of daily returns. Measures realized volatility.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  bb_pct_b: { label: 'BB %B', desc: 'Bollinger %B (0-1): 0 = at lower band, 1 = at upper, 0.5 = middle.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }, { key: 'std_dev', label: 'Std Dev', min: 0.5, max: 4, step: 0.1, default: 2 }] },
  bb_width: { label: 'BB Width', desc: 'Band width as % of middle. Low = squeeze (breakout expected).', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }, { key: 'std_dev', label: 'Std Dev', min: 0.5, max: 4, step: 0.1, default: 2 }] },
  std_dev: { label: 'Std Dev', desc: 'Standard deviation of price over N periods. Rising = increasing volatility.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  chaikin_vol: { label: 'Chaikin Vol', desc: 'Rate of change of EMA of (High-Low). Expanding or contracting volatility.', category: 'Volatility', params: [{ key: 'ema_period', label: 'EMA Period', min: 5, max: 50, step: 1, default: 10 }, { key: 'roc_period', label: 'ROC Period', min: 5, max: 50, step: 1, default: 10 }] },
  obv: { label: 'OBV', desc: 'On-Balance Volume: cumulative volume (+ on up days, - on down). Divergence = reversal.', category: 'Volume', params: [] },
  vol_sma: { label: 'Volume SMA', desc: 'Average trading volume over N periods. Compare current vs this.', category: 'Volume', params: [{ key: 'period', label: 'Period', min: 2, max: 100, step: 1, default: 20 }] },
  accum_dist: { label: 'Accum/Dist', desc: 'Volume-weighted accumulation (buying) or distribution (selling) pressure.', category: 'Volume', params: [] },
  cmf: { label: 'CMF', desc: 'Chaikin Money Flow (-1 to +1): buying vs selling pressure over N periods.', category: 'Volume', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 20 }] },
  mfi: { label: 'MFI', desc: 'Money Flow Index (0-100): volume-weighted RSI. >80 overbought, <20 oversold.', category: 'Volume', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 14 }] },
  vwap: { label: 'VWAP', desc: 'Volume-Weighted Average Price: institutional benchmark for fair value.', category: 'Volume', params: [] },
  pivot_points: { label: 'Pivot Points', desc: 'Support/resistance from previous high, low, close. Intraday turning points.', category: 'Price', params: [] },
  price_vs_high_low: { label: 'Price vs H/L', desc: 'Where price sits in N-period range (0-1). 1 = at high, 0 = at low.', category: 'Price', params: [{ key: 'period', label: 'Period', min: 5, max: 250, step: 1, default: 52 }] },
  z_score: { label: 'Z-Score', desc: 'Standard deviations from N-period mean. >+2 high, <-2 low.', category: 'Price', params: [{ key: 'period', label: 'Period', min: 10, max: 200, step: 1, default: 50 }] },
  heikin_ashi: { label: 'Heikin Ashi', desc: 'Smoothed candlestick technique for trend direction.', category: 'Price', params: [] },
  pct_from_high: { label: '% from High', desc: 'How far below N-period high. 0% = at high, -20% = 20% below.', category: 'Price', params: [{ key: 'period', label: 'Period', min: 5, max: 250, step: 1, default: 52 }] },
  support_resistance: { label: 'S/R Levels', desc: 'Key price levels from N-period highs/lows where price reverses.', category: 'Price', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  close_price: { label: 'Close Price', desc: 'Raw closing price. Used for comparing price against moving averages.', category: 'Price', params: [] },
};

export const INDICATOR_CATEGORIES = ['Trend', 'Momentum', 'Volatility', 'Volume', 'Price'] as const;

export const CATEGORY_COLORS: Record<string, string> = {
  Trend: '#3B82F6',
  Momentum: '#8B5CF6',
  Volatility: '#F59E0B',
  Volume: '#10B981',
  Price: '#6B7280',
};

export const TREND_TYPES: readonly IndicatorType[] = [
  'sma', 'ema', 'dema', 'tema', 'wma', 'hull_ma', 'vwma', 'linear_regression', 'parabolic_sar',
];

/** Format indicator label with key params, e.g. "SMA(50)" or "MACD(12,26,9)" */
export function formatBlockLabel(type: IndicatorType, params: Record<string, number>): string {
  const meta = INDICATOR_META[type];
  if (!meta || meta.params.length === 0) return meta?.label ?? type;
  const values = meta.params.map((p) => params[p.key] ?? p.default);
  return `${meta.label}(${values.join(',')})`;
}

export const PRESET_TOOLTIPS: Record<string, string> = {
  golden_cross: 'Long when SMA(50) > SMA(200), short when below. Classic trend-following.',
  rsi_mean_reversion: 'Long when RSI crosses above 30 (oversold), short when crosses below 70.',
  bollinger_bounce: 'Long at lower Bollinger Band, short at upper. Mean reversion.',
  macd_crossover: 'Long when MACD > 0, short when negative. Momentum.',
  supertrend: 'Long above Supertrend line, short below. ATR-based trend.',
  triple_ma: 'Long when EMA(9) > EMA(21) > EMA(55). Strong trend filter.',
  momentum_6m: 'Long when 6-month return positive, short when negative.',
};
