/**
 * India Equities Strategy Tester - Preset Strategies
 *
 * Seven complete strategy configurations ready to run.
 * Each uses a single rule where possible for clarity.
 */

import type { PresetStrategy } from './types';

const DEFAULT_SIZING = {
  risk_budget: 500_000,   // 5 lakh INR
  vol_window: 20,         // 20-day rolling vol
  z_multiplier: 1.65,     // ~95% confidence
} as const;

export const PRESETS: readonly PresetStrategy[] = [
  // 1. Golden Cross: Long when SMA(50) > SMA(200), Short when below
  {
    id: 'golden_cross',
    name: 'Golden Cross (SMA 50/200)',
    config: {
      indicators: [
        { type: 'sma', params: { period: 50 } },
        { type: 'sma', params: { period: 200 } },
      ],
      rules: [
        {
          indicator_index: 0,
          condition: 'is_above',
          reference_indicator: 1,
          direction: 'both',  // above = long, below = short
        },
      ],
      combine_logic: 'or',
      sizing: DEFAULT_SIZING,
      rebalance: 'weekly',
    },
  },

  // 2. RSI Mean Reversion: Long when RSI crosses above 30, Short when crosses below 70
  {
    id: 'rsi_mean_reversion',
    name: 'RSI Mean Reversion (14, 30/70)',
    config: {
      indicators: [
        { type: 'rsi', params: { period: 14 } },
      ],
      rules: [
        {
          indicator_index: 0,
          condition: 'crosses_above',
          threshold: 30,
          direction: 'long',
        },
        {
          indicator_index: 0,
          condition: 'crosses_below',
          threshold: 70,
          direction: 'short',
        },
      ],
      combine_logic: 'or',
      sizing: DEFAULT_SIZING,
      rebalance: 'daily',
    },
  },

  // 3. Bollinger Bounce: Long when %B crosses above 0, Short when crosses below 1
  {
    id: 'bollinger_bounce',
    name: 'Bollinger Bounce (20, 2\u03C3)',
    config: {
      indicators: [
        { type: 'bb_pct_b', params: { period: 20, std_dev: 2 } },
      ],
      rules: [
        {
          indicator_index: 0,
          condition: 'crosses_above',
          threshold: 0,
          direction: 'long',
        },
        {
          indicator_index: 0,
          condition: 'crosses_below',
          threshold: 1,
          direction: 'short',
        },
      ],
      combine_logic: 'or',
      sizing: DEFAULT_SIZING,
      rebalance: 'daily',
    },
  },

  // 4. MACD Crossover: Long when MACD > 0, Short when below
  {
    id: 'macd_crossover',
    name: 'MACD Crossover (12/26/9)',
    config: {
      indicators: [
        { type: 'macd', params: { fast: 12, slow: 26, signal: 9 } },
      ],
      rules: [
        {
          indicator_index: 0,
          condition: 'is_above',
          threshold: 0,
          direction: 'both',
        },
      ],
      combine_logic: 'or',
      sizing: DEFAULT_SIZING,
      rebalance: 'weekly',
    },
  },

  // 5. Supertrend: direction output is +1/-1 directly
  {
    id: 'supertrend',
    name: 'Supertrend (10, 3)',
    config: {
      indicators: [
        { type: 'supertrend', params: { period: 10, multiplier: 3 } },
      ],
      rules: [
        {
          indicator_index: 0,
          condition: 'is_above',
          threshold: 0,
          direction: 'both',
        },
      ],
      combine_logic: 'or',
      sizing: DEFAULT_SIZING,
      rebalance: 'daily',
    },
  },

  // 6. Triple MA: Long when EMA(9) > EMA(21) AND EMA(21) > EMA(55)
  {
    id: 'triple_ma',
    name: 'Triple MA (EMA 9/21/55)',
    config: {
      indicators: [
        { type: 'ema', params: { period: 9 } },
        { type: 'ema', params: { period: 21 } },
        { type: 'ema', params: { period: 55 } },
      ],
      rules: [
        {
          indicator_index: 0,
          condition: 'is_above',
          reference_indicator: 1,
          direction: 'both',
        },
        {
          indicator_index: 1,
          condition: 'is_above',
          reference_indicator: 2,
          direction: 'both',
        },
      ],
      combine_logic: 'and',  // both must agree for trend confirmation
      sizing: DEFAULT_SIZING,
      rebalance: 'weekly',
    },
  },

  // 7. Momentum: Long when 6-month return > 0, Short when < 0
  {
    id: 'momentum_6m',
    name: 'Momentum (6-Month Lookback)',
    config: {
      indicators: [
        { type: 'ts_momentum', params: { period: 126 } },
      ],
      rules: [
        {
          indicator_index: 0,
          condition: 'is_above',
          threshold: 0,
          direction: 'both',
        },
      ],
      combine_logic: 'or',
      sizing: DEFAULT_SIZING,
      rebalance: 'monthly',
    },
  },
];
