'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type {
  CombineLogic,
  IndicatorConfig,
  IndicatorType,
  IndiaStock,
  PresetStrategy,
  PriceData,
  RebalanceFreq,
  SignalCondition,
  SignalRule,
  SizingConfig,
  StrategyConfig,
} from '@/lib/india/types';
import { useBacktest } from '@/lib/india/hooks';
import { PRESETS } from '@/lib/india/presets';
import { ResultsPanel } from './ResultsPanel';

// ---------------------------------------------------------------------------
// Indicator Metadata
// ---------------------------------------------------------------------------

interface IndicatorMeta {
  label: string;
  desc: string;
  category: 'Trend' | 'Momentum' | 'Volatility' | 'Volume' | 'Price';
  params: { key: string; label: string; min: number; max: number; step: number; default: number }[];
}

const INDICATOR_META: Record<IndicatorType, IndicatorMeta> = {
  sma: { label: 'SMA', desc: 'Simple Moving Average: average of last N closing prices. Smooths noise to reveal trend direction.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  ema: { label: 'EMA', desc: 'Exponential Moving Average: weighted average giving more importance to recent prices. Reacts faster than SMA.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  dema: { label: 'DEMA', desc: 'Double EMA: applies EMA twice to reduce lag further. Formula: 2*EMA(N) - EMA(EMA(N)).', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  tema: { label: 'TEMA', desc: 'Triple EMA: three-layer EMA for minimal lag. Formula: 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA)).', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  wma: { label: 'WMA', desc: 'Weighted Moving Average: linearly weighted, most recent price gets highest weight.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  hull_ma: { label: 'Hull MA', desc: 'Hull Moving Average: uses WMA of difference between short and long WMA. Very low lag, smooth output.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 4, max: 200, step: 1, default: 20 }] },
  vwma: { label: 'VWMA', desc: 'Volume-Weighted Moving Average: like SMA but weights each price by its volume. High-volume days matter more.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 2, max: 200, step: 1, default: 20 }] },
  supertrend: { label: 'SuperTrend', desc: 'Trend-following indicator using ATR bands. Outputs +1 (bullish) or -1 (bearish) based on price vs dynamic support/resistance.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 10 }, { key: 'multiplier', label: 'Multiplier', min: 1, max: 5, step: 0.1, default: 3 }] },
  ichimoku: { label: 'Ichimoku', desc: 'Ichimoku Cloud: Japanese system with 5 lines showing support, resistance, trend, and momentum at a glance.', category: 'Trend', params: [{ key: 'conversion', label: 'Conversion', min: 5, max: 30, step: 1, default: 9 }, { key: 'base', label: 'Base', min: 10, max: 60, step: 1, default: 26 }, { key: 'span_b', label: 'Span B', min: 20, max: 120, step: 1, default: 52 }] },
  parabolic_sar: { label: 'Parabolic SAR', desc: 'Parabolic Stop and Reverse: places dots above/below price to signal trend direction and trailing stop levels.', category: 'Trend', params: [{ key: 'af_start', label: 'AF Start', min: 0.01, max: 0.1, step: 0.005, default: 0.02 }, { key: 'af_max', label: 'AF Max', min: 0.1, max: 0.5, step: 0.01, default: 0.2 }] },
  linear_regression: { label: 'Linear Reg', desc: 'Linear Regression: fits a straight line through the last N prices. Shows the statistically expected price level.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  donchian: { label: 'Donchian', desc: 'Donchian Channel: highest high and lowest low over N periods. Breakout above upper = bullish, below lower = bearish.', category: 'Trend', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  rsi: { label: 'RSI', desc: 'Relative Strength Index (0-100): measures speed of price changes. Above 70 = overbought, below 30 = oversold.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 2, max: 50, step: 1, default: 14 }] },
  stoch_rsi: { label: 'Stoch RSI', desc: 'Stochastic RSI (0-1): applies Stochastic formula to RSI values. More sensitive than plain RSI for overbought/oversold.', category: 'Momentum', params: [{ key: 'rsi_period', label: 'RSI Period', min: 2, max: 50, step: 1, default: 14 }, { key: 'stoch_period', label: 'Stoch Period', min: 2, max: 50, step: 1, default: 14 }, { key: 'k_smooth', label: 'K Smooth', min: 1, max: 10, step: 1, default: 3 }] },
  macd: { label: 'MACD', desc: 'Moving Average Convergence Divergence: difference between fast and slow EMA. Positive = bullish momentum, negative = bearish.', category: 'Momentum', params: [{ key: 'fast', label: 'Fast', min: 5, max: 50, step: 1, default: 12 }, { key: 'slow', label: 'Slow', min: 10, max: 100, step: 1, default: 26 }, { key: 'signal', label: 'Signal', min: 2, max: 20, step: 1, default: 9 }] },
  adx: { label: 'ADX', desc: 'Average Directional Index (0-100): measures trend strength regardless of direction. Above 25 = strong trend, below 20 = weak/ranging.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 14 }] },
  cci: { label: 'CCI', desc: 'Commodity Channel Index: measures deviation from statistical mean. Above +100 = overbought, below -100 = oversold.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 20 }] },
  roc: { label: 'ROC', desc: 'Rate of Change (%): percentage change over N periods. Positive = upward momentum, negative = downward.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 1, max: 50, step: 1, default: 12 }] },
  williams_r: { label: 'Williams %R', desc: 'Williams %R (-100 to 0): shows where close is relative to high-low range. Above -20 = overbought, below -80 = oversold.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 14 }] },
  momentum: { label: 'Momentum', desc: 'Price Momentum: difference between current price and price N bars ago. Positive = rising, negative = falling.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 1, max: 50, step: 1, default: 10 }] },
  tsi: { label: 'TSI', desc: 'True Strength Index (-100 to +100): double-smoothed momentum oscillator. Crosses above 0 = bullish, below = bearish.', category: 'Momentum', params: [{ key: 'long_period', label: 'Long', min: 10, max: 50, step: 1, default: 25 }, { key: 'short_period', label: 'Short', min: 5, max: 25, step: 1, default: 13 }] },
  awesome_osc: { label: 'Awesome Osc', desc: 'Awesome Oscillator: difference between 5-period and 34-period SMA of midpoint prices. Positive = bullish, negative = bearish.', category: 'Momentum', params: [{ key: 'fast', label: 'Fast', min: 2, max: 20, step: 1, default: 5 }, { key: 'slow', label: 'Slow', min: 10, max: 50, step: 1, default: 34 }] },
  ppo: { label: 'PPO', desc: 'Percentage Price Oscillator: MACD expressed as a percentage. Allows comparison across different price levels.', category: 'Momentum', params: [{ key: 'fast', label: 'Fast', min: 5, max: 50, step: 1, default: 12 }, { key: 'slow', label: 'Slow', min: 10, max: 100, step: 1, default: 26 }] },
  ts_momentum: { label: 'TS Momentum', desc: 'Time-Series Momentum: cumulative return over lookback period. Positive = trending up, negative = trending down.', category: 'Momentum', params: [{ key: 'period', label: 'Period', min: 5, max: 250, step: 1, default: 126 }] },
  bollinger: { label: 'Bollinger Bands', desc: 'Bollinger Bands: SMA with upper/lower bands at N standard deviations. Price near upper band = potentially overbought.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }, { key: 'std_dev', label: 'Std Dev', min: 0.5, max: 4, step: 0.1, default: 2 }] },
  atr: { label: 'ATR', desc: 'Average True Range: measures volatility as the average of true ranges (high-low including gaps). Higher = more volatile.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 14 }] },
  keltner: { label: 'Keltner Channel', desc: 'Keltner Channel: EMA with bands based on ATR. Similar to Bollinger but uses ATR instead of standard deviation.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 20 }, { key: 'multiplier', label: 'Multiplier', min: 0.5, max: 4, step: 0.1, default: 1.5 }] },
  hist_vol: { label: 'Historical Vol', desc: 'Historical Volatility: annualized standard deviation of daily returns over N periods. Measures realized price variability.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  bb_pct_b: { label: 'BB %B', desc: 'Bollinger %B (0 to 1): shows where price sits within the bands. 0 = at lower band, 1 = at upper band, 0.5 = at middle.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }, { key: 'std_dev', label: 'Std Dev', min: 0.5, max: 4, step: 0.1, default: 2 }] },
  bb_width: { label: 'BB Width', desc: 'Bollinger Band Width: distance between upper and lower bands as % of middle. Low width = squeeze (breakout expected).', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }, { key: 'std_dev', label: 'Std Dev', min: 0.5, max: 4, step: 0.1, default: 2 }] },
  std_dev: { label: 'Std Dev', desc: 'Standard Deviation: measures price dispersion over N periods. Rising std dev = increasing volatility.', category: 'Volatility', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  chaikin_vol: { label: 'Chaikin Vol', desc: 'Chaikin Volatility: rate of change of the EMA of (High - Low) range. Measures whether volatility is expanding or contracting.', category: 'Volatility', params: [{ key: 'ema_period', label: 'EMA Period', min: 5, max: 50, step: 1, default: 10 }, { key: 'roc_period', label: 'ROC Period', min: 5, max: 50, step: 1, default: 10 }] },
  obv: { label: 'OBV', desc: 'On-Balance Volume: cumulative sum of volume (added on up days, subtracted on down days). Divergence from price signals potential reversal.', category: 'Volume', params: [] },
  vol_sma: { label: 'Volume SMA', desc: 'Volume Simple Moving Average: average trading volume over N periods. Compare current volume to this for unusual activity.', category: 'Volume', params: [{ key: 'period', label: 'Period', min: 2, max: 100, step: 1, default: 20 }] },
  accum_dist: { label: 'Accum/Dist', desc: 'Accumulation/Distribution Line: volume-weighted measure of whether shares are being accumulated (bought) or distributed (sold).', category: 'Volume', params: [] },
  cmf: { label: 'CMF', desc: 'Chaikin Money Flow (-1 to +1): measures buying/selling pressure over N periods. Positive = buying pressure, negative = selling.', category: 'Volume', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 20 }] },
  mfi: { label: 'MFI', desc: 'Money Flow Index (0-100): volume-weighted RSI. Above 80 = overbought with high volume, below 20 = oversold.', category: 'Volume', params: [{ key: 'period', label: 'Period', min: 5, max: 50, step: 1, default: 14 }] },
  vwap: { label: 'VWAP', desc: 'Volume-Weighted Average Price: average price weighted by volume from the start of data. Institutional benchmark for fair value.', category: 'Volume', params: [] },
  pivot_points: { label: 'Pivot Points', desc: 'Pivot Points: support/resistance levels calculated from previous high, low, close. Used to identify intraday turning points.', category: 'Price', params: [] },
  price_vs_high_low: { label: 'Price vs H/L', desc: 'Price vs High/Low (0 to 1): where current price sits in the N-period range. 1 = at the high, 0 = at the low.', category: 'Price', params: [{ key: 'period', label: 'Period', min: 5, max: 250, step: 1, default: 52 }] },
  z_score: { label: 'Z-Score', desc: 'Z-Score of Price: how many standard deviations price is from its N-period mean. Above +2 = statistically high, below -2 = low.', category: 'Price', params: [{ key: 'period', label: 'Period', min: 10, max: 200, step: 1, default: 50 }] },
  heikin_ashi: { label: 'Heikin Ashi', desc: 'Heikin Ashi Trend: smoothed candlestick technique. Outputs trend direction based on modified open/close calculations.', category: 'Price', params: [] },
  pct_from_high: { label: '% from High', desc: 'Percent from High: how far price is below its N-period high. 0% = at the high, -20% = 20% below the high.', category: 'Price', params: [{ key: 'period', label: 'Period', min: 5, max: 250, step: 1, default: 52 }] },
  support_resistance: { label: 'S/R Levels', desc: 'Support/Resistance: identifies key price levels from N-period highs and lows where price tends to reverse.', category: 'Price', params: [{ key: 'period', label: 'Period', min: 5, max: 100, step: 1, default: 20 }] },
  close_price: { label: 'Close Price', desc: 'Raw closing price. Used internally for comparing price against moving averages.', category: 'Price', params: [] },
};

const INDICATOR_CATEGORIES = ['Trend', 'Momentum', 'Volatility', 'Volume', 'Price'] as const;

/**
 * Create a sensible default signal rule when a user adds an indicator.
 * For trend indicators (SMA, EMA, etc.): "price is above indicator → long/short"
 * For oscillators (RSI, Stochastic, etc.): "crosses above oversold → long"
 * For momentum: "is above 0 → long/short"
 */
function getDefaultRule(type: IndicatorType, indicatorIndex: number): SignalRule | null {
  // Trend indicators: for a single MA, we can't compare price to MA directly
  // because the system compares indicator outputs, not raw prices.
  // Solution: return null here. The addIndicator callback will handle trend MAs
  // by adding a 'price' pseudo-indicator and setting up the cross rule.
  const trendTypes: IndicatorType[] = ['sma', 'ema', 'dema', 'tema', 'wma', 'hull_ma', 'vwma', 'linear_regression', 'parabolic_sar'];
  if (trendTypes.includes(type)) {
    // Will be handled specially in addIndicator
    return null;
  }

  // Oscillators: crosses above/below thresholds
  if (type === 'rsi') return { indicator_index: indicatorIndex, condition: 'is_above', threshold: 50, direction: 'both' };
  if (type === 'stoch_rsi') return { indicator_index: indicatorIndex, condition: 'is_above', threshold: 50, direction: 'both' };
  if (type === 'cci') return { indicator_index: indicatorIndex, condition: 'is_above', threshold: 0, direction: 'both' };
  if (type === 'williams_r') return { indicator_index: indicatorIndex, condition: 'is_above', threshold: -50, direction: 'both' };
  if (type === 'mfi') return { indicator_index: indicatorIndex, condition: 'is_above', threshold: 50, direction: 'both' };

  // Momentum/directional: above 0 = long, below 0 = short
  const momentumTypes: IndicatorType[] = ['macd', 'momentum', 'roc', 'tsi', 'awesome_osc', 'ppo', 'ts_momentum'];
  if (momentumTypes.includes(type)) {
    return { indicator_index: indicatorIndex, condition: 'is_above', threshold: 0, direction: 'both' };
  }

  // Supertrend direction: above 0 = long
  if (type === 'supertrend') return { indicator_index: indicatorIndex, condition: 'is_above', threshold: 0, direction: 'both' };

  // Bollinger %B: above 0.5 = long
  if (type === 'bb_pct_b') return { indicator_index: indicatorIndex, condition: 'is_above', threshold: 0.5, direction: 'both' };

  // Default: is_above 0 → both
  return { indicator_index: indicatorIndex, condition: 'is_above', threshold: 0, direction: 'both' };
}

const PRESET_TOOLTIPS: Record<string, string> = {
  golden_cross: 'Go long when the 50-day SMA is above the 200-day SMA (bullish trend), short when below. Classic trend-following strategy.',
  rsi_mean_reversion: 'Go long when RSI(14) crosses above 30 (oversold bounce), go short when RSI crosses below 70 (overbought reversal). Mean reversion strategy.',
  bollinger_bounce: 'Go long when price touches the lower Bollinger Band (oversold), go short when it touches the upper band (overbought). Uses 20-day, 2σ bands.',
  macd_crossover: 'Go long when MACD histogram is positive (bullish momentum), short when negative. Uses standard 12/26/9 settings.',
  supertrend: 'Trend-following indicator using ATR. Go long when price is above the Supertrend line, short when below. Period 10, multiplier 3.',
  triple_ma: 'Go long when EMA(9) > EMA(21) > EMA(55) — all three moving averages aligned bullish. Requires ALL conditions to agree (strong trend filter).',
  momentum_6m: 'Go long when the 6-month (126-day) return is positive, short when negative. Pure time-series momentum strategy. Rebalances monthly.',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface StrategyBuilderProps {
  stock: IndiaStock | null;
  priceData: PriceData | null;
  isLight: boolean;
  onClose: () => void;
}

export function StrategyBuilder({ stock, priceData, isLight, onClose }: StrategyBuilderProps) {
  const [indicators, setIndicators] = useState<IndicatorConfig[]>([]);
  const [rules, setRules] = useState<SignalRule[]>([]);
  const [combineLogic, setCombineLogic] = useState<CombineLogic>('or');
  const [sizing, setSizing] = useState<SizingConfig>({
    risk_budget: 500000,
    vol_window: 20,
    z_multiplier: 1.65,
  });
  const [rebalance, setRebalance] = useState<RebalanceFreq>('daily');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showAddDropdown, setShowAddDropdown] = useState(false);

  const config: StrategyConfig | null = useMemo(() => {
    if (indicators.length === 0) return null;
    return { indicators, rules, combine_logic: combineLogic, sizing, rebalance };
  }, [indicators, rules, combineLogic, sizing, rebalance]);

  const { result, isLoading, error } = useBacktest({
    ticker: stock?.ticker ?? '',
    lotSize: stock?.lot_size ?? 1,
    config,
    priceData,
  });

  const applyPreset = useCallback((preset: PresetStrategy) => {
    setIndicators([...preset.config.indicators] as IndicatorConfig[]);
    setRules([...preset.config.rules] as SignalRule[]);
    setCombineLogic(preset.config.combine_logic);
    setSizing(preset.config.sizing);
    setRebalance(preset.config.rebalance);
    setActivePreset(preset.id);
  }, []);

  // Auto-apply the first preset when a stock is selected and no strategy is configured
  const prevTickerRef = useRef<string | null>(null);
  useEffect(() => {
    const ticker = stock?.ticker ?? null;
    if (ticker && ticker !== prevTickerRef.current && indicators.length === 0 && PRESETS.length > 0) {
      applyPreset(PRESETS[0]);
    }
    prevTickerRef.current = ticker;
  }, [stock?.ticker, indicators.length, applyPreset]);

  const addIndicator = useCallback((type: IndicatorType) => {
    const meta = INDICATOR_META[type];
    const params: Record<string, number> = {};
    for (const p of meta.params) {
      params[p.key] = p.default;
    }
    const trendTypes: IndicatorType[] = ['sma', 'ema', 'dema', 'tema', 'wma', 'hull_ma', 'vwma', 'linear_regression', 'parabolic_sar'];

    if (trendTypes.includes(type)) {
      // For trend MAs: add close_price as a pseudo-indicator so we can compare
      // "close price is above SMA → long, below → short"
      const newIndicators = [...indicators];
      const closeIndex = newIndicators.length;
      newIndicators.push({ type: 'close_price', params: {} });
      const maIndex = newIndicators.length;
      newIndicators.push({ type, params });
      setIndicators(newIndicators);
      setRules((prev) => [...prev, {
        indicator_index: closeIndex,
        condition: 'is_above',
        reference_indicator: maIndex,
        direction: 'both',
      }]);
    } else {
      const newIndex = indicators.length;
      setIndicators((prev) => [...prev, { type, params }]);

      const defaultRule = getDefaultRule(type, newIndex);
      if (defaultRule) {
        setRules((prev) => [...prev, defaultRule]);
      }
    }

    setActivePreset(null);
    setShowAddDropdown(false);
  }, [indicators.length]);

  const removeIndicator = useCallback((index: number) => {
    const trendTypes: IndicatorType[] = ['sma', 'ema', 'dema', 'tema', 'wma', 'hull_ma', 'vwma', 'linear_regression', 'parabolic_sar'];
    const removedType = indicators[index]?.type;

    // Remove the indicator and clean up rules (filter stale + shift indices)
    let newIndicators = indicators.filter((_, i) => i !== index);
    let newRules = rules
      .filter((r) => r.indicator_index !== index && r.reference_indicator !== index)
      .map((r) => ({
        ...r,
        indicator_index: r.indicator_index > index ? r.indicator_index - 1 : r.indicator_index,
        reference_indicator: r.reference_indicator !== undefined && r.reference_indicator > index
          ? r.reference_indicator - 1
          : r.reference_indicator,
      }));

    // Auto-fix orphaned trend MAs: if a trend indicator lost all its rules,
    // add a close_price pseudo-indicator and "price is_above MA → both" rule
    if (removedType !== 'close_price') {
      const orphanedIndices: number[] = [];
      for (let i = 0; i < newIndicators.length; i++) {
        if (trendTypes.includes(newIndicators[i].type)) {
          const hasRule = newRules.some(
            (r) => r.indicator_index === i || r.reference_indicator === i,
          );
          if (!hasRule) orphanedIndices.push(i);
        }
      }

      if (orphanedIndices.length > 0) {
        // Reuse existing close_price or add a new one
        let closeIdx = newIndicators.findIndex((ind) => ind.type === 'close_price');
        if (closeIdx === -1) {
          closeIdx = newIndicators.length;
          newIndicators = [...newIndicators, { type: 'close_price' as IndicatorType, params: {} }];
        }
        for (const orphanIdx of orphanedIndices) {
          newRules = [...newRules, {
            indicator_index: closeIdx,
            condition: 'is_above' as SignalCondition,
            reference_indicator: orphanIdx,
            direction: 'both' as const,
          }];
        }
      }
    }

    setIndicators(newIndicators);
    setRules(newRules);
    setActivePreset(null);
  }, [indicators, rules]);

  const updateIndicatorParam = useCallback((index: number, key: string, value: number) => {
    setIndicators((prev) =>
      prev.map((ind, i) =>
        i === index ? { ...ind, params: { ...ind.params, [key]: value } } : ind,
      ),
    );
    setActivePreset(null);
  }, []);

  const addRule = useCallback((indicatorIndex: number) => {
    const type = indicators[indicatorIndex]?.type;
    const defaultRule = getDefaultRule(type, indicatorIndex);
    setRules((prev) => [
      ...prev,
      defaultRule ?? {
        indicator_index: indicatorIndex,
        condition: 'is_above' as SignalCondition,
        threshold: 0,
        direction: 'both' as const,
      },
    ]);
    setActivePreset(null);
  }, [indicators]);

  const updateRule = useCallback(
    (ruleIndex: number, updates: Partial<SignalRule>) => {
      setRules((prev) => prev.map((r, i) => (i === ruleIndex ? { ...r, ...updates } : r)));
      setActivePreset(null);
    },
    [],
  );

  const removeRule = useCallback((ruleIndex: number) => {
    setRules((prev) => prev.filter((_, i) => i !== ruleIndex));
    setActivePreset(null);
  }, []);

  // Theme
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900/50';
  const cardBorder = isLight ? 'border-gray-200' : 'border-zinc-800';
  const tertBg = isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
  const textPrimary = isLight ? 'text-gray-900' : 'text-zinc-100';
  const textSecondary = isLight ? 'text-gray-500' : 'text-zinc-400';
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';

  return (
    <div className={cn('rounded-xl border', cardBorder, cardBg)}>
      {/* Top Bar */}
      <div className={cn('flex items-center gap-3 px-4 py-3 border-b flex-wrap', cardBorder)}>
        <div className="flex items-center gap-2 mr-auto">
          <h2 className={cn('text-base font-semibold font-[DM_Sans]', textPrimary)}>
            {stock?.name ?? 'Select a stock'}
          </h2>
          {stock && <span className="font-mono text-xs text-zinc-500">{stock.ticker}</span>}
          {stock && <span className="font-mono text-xs text-zinc-500">Lot: {stock.lot_size}</span>}
        </div>
        <button
          onClick={onClose}
          className={cn('text-xs px-2 py-1 rounded', textMuted, 'hover:text-[#EF4444]')}
        >
          Close
        </button>
      </div>

      {/* Sizing Config Bar */}
      <div
        className={cn(
          'flex gap-4 items-center px-4 py-2.5 border-b text-xs flex-wrap',
          cardBorder,
          tertBg,
        )}
      >
        <SizingItem
          label="Risk Budget"
          value={`\u20B9${(sizing.risk_budget / 100000).toFixed(1)}L`}
          isLight={isLight}
        >
          <input
            type="range"
            min={100000}
            max={5000000}
            step={50000}
            value={sizing.risk_budget}
            onChange={(e) =>
              setSizing((s) => ({ ...s, risk_budget: Number(e.target.value) }))
            }
            className="w-20 h-1 accent-[#FF9933]"
          />
        </SizingItem>

        <SizingItem
          label="Vol Window"
          value={`${sizing.vol_window}d`}
          isLight={isLight}
        >
          <input
            type="range"
            min={5}
            max={60}
            step={1}
            value={sizing.vol_window}
            onChange={(e) =>
              setSizing((s) => ({ ...s, vol_window: Number(e.target.value) }))
            }
            className="w-16 h-1 accent-[#FF9933]"
          />
        </SizingItem>

        <SizingItem
          label="Z Mult"
          value={sizing.z_multiplier.toFixed(2)}
          isLight={isLight}
        >
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={sizing.z_multiplier}
            onChange={(e) =>
              setSizing((s) => ({ ...s, z_multiplier: Number(e.target.value) }))
            }
            className="w-16 h-1 accent-[#FF9933]"
          />
        </SizingItem>

        <div className="flex items-center gap-1.5">
          <span className={cn('text-[11px]', textMuted)}>Rebalance</span>
          <select
            value={rebalance}
            onChange={(e) => setRebalance(e.target.value as RebalanceFreq)}
            className={cn(
              'text-[11px] font-mono px-1.5 py-0.5 rounded border',
              isLight
                ? 'bg-white border-gray-200 text-gray-900'
                : 'bg-zinc-900 border-zinc-700 text-zinc-200',
            )}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      {/* Preset Pills with tooltips */}
      <div className={cn('flex gap-1.5 px-4 py-2.5 border-b flex-wrap', cardBorder)}>
        <span className={cn('text-[11px] font-medium self-center mr-1', textMuted)}>Presets</span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p)}
            title={PRESET_TOOLTIPS[p.id] ?? p.name}
            className={cn(
              'px-2.5 py-1 rounded-md text-[11px] font-medium border transition-all',
              activePreset === p.id
                ? 'bg-[#FF9933]/15 border-[#FF9933]/30 text-[#FF9933]'
                : isLight
                  ? 'bg-gray-50 border-gray-200 text-gray-600 hover:border-[#FF9933] hover:text-[#FF9933]'
                  : 'bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:border-[#FF9933] hover:text-[#FF9933]',
            )}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Split layout: Config + Results */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr]">
        {/* Left: Indicator Config */}
        <div className={cn('p-4 space-y-3 border-r', cardBorder)}>
          {/* Active indicators */}
          {indicators.map((ind, idx) => (
            <IndicatorCard
              key={`${ind.type}-${idx}`}
              indicator={ind}
              rules={rules.filter((r) => r.indicator_index === idx)}
              allRules={rules}
              indicators={indicators}
              onUpdateParam={(key, val) => updateIndicatorParam(idx, key, val)}
              onRemove={() => removeIndicator(idx)}
              onAddRule={() => addRule(idx)}
              onUpdateRule={updateRule}
              onRemoveRule={removeRule}
              isLight={isLight}
            />
          ))}

          {/* Filter logic toggle — only shown with 2+ indicators */}
          {indicators.length >= 2 && (
            <div className="flex items-center gap-2 px-2">
              <span className={cn('text-[11px]', textMuted)}>Filter</span>
              <button
                onClick={() => setCombineLogic('and')}
                className={cn(
                  'px-2 py-0.5 rounded text-[11px] font-medium border transition-all',
                  combineLogic === 'and'
                    ? 'bg-[#FF9933]/15 border-[#FF9933]/30 text-[#FF9933]'
                    : isLight
                      ? 'border-gray-200 text-gray-500'
                      : 'border-zinc-700 text-zinc-500',
                )}
                title="All indicators must agree for a signal to fire"
              >
                All must agree
              </button>
              <button
                onClick={() => setCombineLogic('or')}
                className={cn(
                  'px-2 py-0.5 rounded text-[11px] font-medium border transition-all',
                  combineLogic === 'or'
                    ? 'bg-[#FF9933]/15 border-[#FF9933]/30 text-[#FF9933]'
                    : isLight
                      ? 'border-gray-200 text-gray-500'
                      : 'border-zinc-700 text-zinc-500',
                )}
                title="Any indicator can trigger a signal independently"
              >
                Any triggers
              </button>
            </div>
          )}

          {/* Add Indicator Button */}
          <div className="relative">
            <button
              onClick={() => setShowAddDropdown((v) => !v)}
              className={cn(
                'w-full py-2 rounded-lg border border-dashed text-xs font-medium transition-all',
                isLight
                  ? 'border-gray-300 text-gray-500 hover:border-[#FF9933] hover:text-[#FF9933]'
                  : 'border-zinc-700 text-zinc-500 hover:border-[#FF9933] hover:text-[#FF9933]',
              )}
            >
              + Add Indicator
            </button>

            {showAddDropdown && (
              <AddIndicatorDropdown
                onSelect={addIndicator}
                onClose={() => setShowAddDropdown(false)}
                isLight={isLight}
              />
            )}
          </div>

          {indicators.length === 0 && (
            <div className={cn('text-center py-6 text-xs', textSecondary)}>
              Select a preset or add indicators to build your strategy.
            </div>
          )}
        </div>

        {/* Right: Results */}
        <div className="p-4">
          <ResultsPanel
            result={result}
            isLoading={isLoading}
            error={error}
            isLight={isLight}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SizingItem({
  label,
  value,
  isLight,
  children,
}: {
  label: string;
  value: string;
  isLight: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('text-[11px]', isLight ? 'text-gray-400' : 'text-zinc-500')}>{label}</span>
      {children}
      <span className="font-mono text-xs text-[#FF9933]">{value}</span>
    </div>
  );
}

const CONDITION_OPTIONS: { value: SignalCondition; label: string; hint: string }[] = [
  { value: 'crosses_above', label: 'Crosses above', hint: 'Signal fires once when value crosses up through the level' },
  { value: 'crosses_below', label: 'Crosses below', hint: 'Signal fires once when value crosses down through the level' },
  { value: 'is_above', label: 'Is above', hint: 'Signal is active every bar the value is above the level' },
  { value: 'is_below', label: 'Is below', hint: 'Signal is active every bar the value is below the level' },
];

const DIRECTION_OPTIONS: { value: 'long' | 'short' | 'both'; label: string }[] = [
  { value: 'both', label: 'Long & Short' },
  { value: 'long', label: 'Long only' },
  { value: 'short', label: 'Short only' },
];

function IndicatorCard({
  indicator,
  rules,
  allRules,
  indicators,
  onUpdateParam,
  onRemove,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  isLight,
}: {
  indicator: IndicatorConfig;
  rules: SignalRule[];
  allRules: SignalRule[];
  indicators: IndicatorConfig[];
  onUpdateParam: (key: string, value: number) => void;
  onRemove: () => void;
  onAddRule: () => void;
  onUpdateRule: (ruleIndex: number, updates: Partial<SignalRule>) => void;
  onRemoveRule: (ruleIndex: number) => void;
  isLight: boolean;
}) {
  const meta = INDICATOR_META[indicator.type];
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';
  const selectCls = cn(
    'text-[11px] font-mono px-1.5 py-0.5 rounded border outline-none',
    isLight
      ? 'bg-white border-gray-200 text-gray-900 focus:border-[#FF9933]'
      : 'bg-zinc-900 border-zinc-700 text-zinc-200 focus:border-[#FF9933]',
  );
  const inputCls = cn(
    'w-16 px-1.5 py-0.5 rounded border text-[11px] font-mono text-center outline-none',
    isLight
      ? 'bg-white border-gray-200 text-gray-900 focus:border-[#FF9933]'
      : 'bg-zinc-900 border-zinc-700 text-[#FF9933] focus:border-[#FF9933]',
  );

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <span className={cn('text-[13px] font-semibold font-[DM_Sans]', isLight ? 'text-gray-900' : 'text-zinc-100')}>
          {meta.label}
        </span>
        <button
          onClick={onRemove}
          className={cn('text-[11px]', textMuted, 'hover:text-[#EF4444]')}
        >
          Remove
        </button>
      </div>

      {/* Description */}
      <div className={cn('text-[10px] mb-2 leading-snug', textMuted)}>{meta.desc}</div>

      {/* Parameters */}
      {meta.params.map((p) => (
        <div key={p.key} className="flex items-center gap-2 mb-1.5">
          <span className={cn('text-[11px] min-w-[60px]', textMuted)}>{p.label}</span>
          <input
            type="number"
            min={p.min}
            max={p.max}
            step={p.step}
            value={indicator.params[p.key] ?? p.default}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!isNaN(v)) onUpdateParam(p.key, v);
            }}
            className={cn(
              'w-20 px-2 py-1 rounded border text-xs font-mono text-center outline-none transition-colors',
              isLight
                ? 'bg-white border-gray-200 text-gray-900 focus:border-[#FF9933]'
                : 'bg-zinc-900 border-zinc-700 text-[#FF9933] focus:border-[#FF9933]',
            )}
          />
        </div>
      ))}

      {/* Signal rules — editable inline */}
      {rules.length > 0 && (
        <div className={cn('text-[10px] font-semibold uppercase tracking-wider mt-3 mb-1', textMuted)}>
          Signal Rules
        </div>
      )}
      {rules.map((rule) => {
        const ruleIndex = allRules.indexOf(rule);
        const hasRef = rule.reference_indicator != null;
        const refLabel = hasRef
          ? INDICATOR_META[indicators[rule.reference_indicator!]?.type]?.label ?? `#${rule.reference_indicator}`
          : null;

        return (
          <div
            key={ruleIndex}
            className={cn(
              'rounded border p-2 mt-1.5',
              isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/50 border-zinc-700',
            )}
          >
            {/* Row 1: Condition + Target */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={cn('text-[10px]', textMuted)}>When</span>
              <select
                value={rule.condition}
                onChange={(e) => onUpdateRule(ruleIndex, { condition: e.target.value as SignalCondition })}
                className={selectCls}
              >
                {CONDITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>

              {hasRef ? (
                <span className={cn('text-[11px] font-mono', isLight ? 'text-gray-600' : 'text-zinc-300')}>
                  {refLabel}
                </span>
              ) : (
                <input
                  type="number"
                  value={rule.threshold ?? 0}
                  onChange={(e) => onUpdateRule(ruleIndex, { threshold: Number(e.target.value) })}
                  className={inputCls}
                />
              )}
            </div>

            {/* Row 2: Direction + Remove */}
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className={cn('text-[10px]', textMuted)}>Then</span>
              <select
                value={rule.direction}
                onChange={(e) => onUpdateRule(ruleIndex, { direction: e.target.value as 'long' | 'short' | 'both' })}
                className={selectCls}
              >
                {DIRECTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                onClick={() => onRemoveRule(ruleIndex)}
                className={cn('ml-auto text-[10px] px-1', isLight ? 'text-gray-300 hover:text-red-500' : 'text-zinc-600 hover:text-red-400')}
              >
                Remove rule
              </button>
            </div>
          </div>
        );
      })}

      <button
        onClick={onAddRule}
        className={cn('text-[11px] mt-2', textMuted, 'hover:text-[#FF9933]')}
      >
        + Add Rule
      </button>
    </div>
  );
}

function AddIndicatorDropdown({
  onSelect,
  onClose,
  isLight,
}: {
  onSelect: (type: IndicatorType) => void;
  onClose: () => void;
  isLight: boolean;
}) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[90] bg-black/20" onClick={onClose} />
      <div
        className={cn(
          'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] z-[100] rounded-xl border shadow-2xl max-h-[400px] overflow-y-auto',
          isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-700',
        )}
      >
        <div className={cn('sticky top-0 px-3 py-2 border-b text-xs font-semibold', isLight ? 'bg-white border-gray-200 text-gray-900' : 'bg-zinc-900 border-zinc-700 text-zinc-100')}>
          Select Indicator
        </div>
        {INDICATOR_CATEGORIES.map((cat) => {
          const items = Object.entries(INDICATOR_META).filter(
            ([key, meta]) => meta.category === cat && key !== 'close_price',
          ) as [IndicatorType, IndicatorMeta][];

          return (
            <div key={cat}>
              <div
                className={cn(
                  'px-3 py-1 text-[10px] font-semibold uppercase tracking-wider sticky top-0',
                  isLight ? 'bg-gray-50 text-gray-400' : 'bg-zinc-800 text-zinc-500',
                )}
              >
                {cat}
              </div>
              {items.map(([type, meta]) => (
                <button
                  key={type}
                  onClick={() => onSelect(type)}
                  className={cn(
                    'w-full text-left px-3 py-2 transition-colors group',
                    isLight
                      ? 'text-gray-700 hover:bg-[#FF9933]/5'
                      : 'text-zinc-300 hover:bg-[#FF9933]/10',
                  )}
                >
                  <div className={cn('text-xs font-medium', isLight ? 'group-hover:text-[#FF9933]' : 'group-hover:text-[#FF9933]')}>
                    {meta.label}
                  </div>
                  <div className={cn('text-[10px] leading-snug mt-0.5', isLight ? 'text-gray-400' : 'text-zinc-500')}>
                    {meta.desc}
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
