export type GICSSector =
  | 'financials'
  | 'it'
  | 'energy'
  | 'materials'
  | 'healthcare'
  | 'consumer_disc'
  | 'consumer_staples'
  | 'industrials';

export interface IndiaStock {
  readonly ticker: string;
  readonly yf: string;
  readonly name: string;
  readonly lot_size: number;
  readonly sector: GICSSector;
}

export interface PriceData {
  readonly ticker: string;
  readonly dates: readonly string[];
  readonly open: readonly number[];
  readonly high: readonly number[];
  readonly low: readonly number[];
  readonly close: readonly number[];
  readonly volume: readonly number[];
}

export type IndicatorType =
  | 'sma'
  | 'ema'
  | 'dema'
  | 'tema'
  | 'wma'
  | 'hull_ma'
  | 'vwma'
  | 'supertrend'
  | 'ichimoku'
  | 'parabolic_sar'
  | 'linear_regression'
  | 'donchian'
  // Momentum
  | 'rsi'
  | 'stoch_rsi'
  | 'macd'
  | 'adx'
  | 'cci'
  | 'roc'
  | 'williams_r'
  | 'momentum'
  | 'tsi'
  | 'awesome_osc'
  | 'ppo'
  | 'ts_momentum'
  // Volatility
  | 'bollinger'
  | 'atr'
  | 'keltner'
  | 'hist_vol'
  | 'bb_pct_b'
  | 'bb_width'
  | 'std_dev'
  | 'chaikin_vol'
  // Volume
  | 'obv'
  | 'vol_sma'
  | 'accum_dist'
  | 'cmf'
  | 'mfi'
  | 'vwap'
  // Price
  | 'pivot_points'
  | 'price_vs_high_low'
  | 'z_score'
  | 'heikin_ashi'
  | 'pct_from_high'
  | 'support_resistance'
  // Pseudo
  | 'close_price';

export interface IndicatorConfig {
  readonly type: IndicatorType;
  readonly params: Readonly<Record<string, number>>;
}

export type SignalCondition =
  | 'crosses_above'
  | 'crosses_below'
  | 'is_above'
  | 'is_below'
  | 'between';

export interface SignalRule {
  readonly indicator_index: number;
  readonly condition: SignalCondition;
  readonly threshold?: number;
  readonly reference_indicator?: number;
  readonly direction: 'long' | 'short' | 'both';
}

export type CombineLogic = 'and' | 'or';

export type RebalanceFreq = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface SizingConfig {
  readonly risk_budget: number;
  readonly vol_window: number;
  readonly z_multiplier: number;
}

export interface StrategyConfig {
  readonly indicators: readonly IndicatorConfig[];
  readonly rules: readonly SignalRule[];
  readonly combine_logic: CombineLogic;
  readonly sizing: SizingConfig;
  readonly rebalance: RebalanceFreq;
}

export interface BacktestMetrics {
  readonly sharpe: number;
  readonly sortino: number;
  readonly calmar: number;
  readonly max_dd_pct: number;
  readonly max_dd_inr: number;
  readonly max_dd_duration_days: number;
  readonly total_return_pct: number;
  readonly annual_return_pct: number;
  readonly total_pnl: number;
  readonly win_rate_pct: number;
  readonly profit_factor: number;
  readonly payoff_ratio: number;
  readonly num_trades: number;
  readonly avg_hold_days: number;
  readonly avg_trade_pnl: number;
  readonly best_trade: number;
  readonly worst_trade: number;
  readonly avg_win: number;
  readonly avg_loss: number;
  readonly max_consec_wins: number;
  readonly max_consec_losses: number;
  readonly gross_profit: number;
  readonly gross_loss: number;
  total_transaction_costs?: number;
}

export interface Trade {
  readonly entry_date: string;
  readonly exit_date: string;
  readonly direction: 'long' | 'short';
  readonly lots: number;
  readonly entry_price: number;
  readonly exit_price: number;
  readonly pnl: number;
  readonly pnl_pct: number;
  readonly duration_days: number;
}

export interface BacktestResult {
  readonly metrics: BacktestMetrics;
  readonly equity_curve: { readonly dates: string[]; readonly cumulative: number[] };
  readonly drawdown: { readonly dates: string[]; readonly values: number[] };
  readonly monthly: ReadonlyArray<{ readonly year: number; readonly month: number; readonly pnl: number }>;
  readonly yearly: ReadonlyArray<{ readonly year: number; readonly pnl: number }>;
  readonly trades: readonly Trade[];
  readonly signals: { readonly dates: string[]; readonly values: number[] };
}

export interface PresetStrategy {
  readonly id: string;
  readonly name: string;
  readonly config: StrategyConfig;
}
