import { isMcxSymbol, getCommodity } from '@/lib/mcx/registry';

export type InstrumentClass = 'NSE_FO_STOCK' | 'MCX_SINGLE' | 'MCX_INDEX';

export type TradeSide = 'BUY' | 'SELL';

export interface FeeSchedule {
  readonly brokerage_per_order_inr: number;
  readonly exchange_turnover_pct: number;
  readonly stt_or_ctt_sell_pct: number;
  readonly stamp_duty_buy_pct: number;
  readonly gst_pct: number;
}

export const FEE_SCHEDULES: Record<InstrumentClass, FeeSchedule> = {
  NSE_FO_STOCK: {
    brokerage_per_order_inr: 20,
    exchange_turnover_pct: 0.0000183, // NSE F&O 0.00173% + SEBI 0.0001%
    stt_or_ctt_sell_pct: 0.000125, // 0.0125% on sell notional for futures
    stamp_duty_buy_pct: 0.00002, // 0.002% on buy
    gst_pct: 0.18,
  },
  MCX_SINGLE: {
    brokerage_per_order_inr: 20,
    exchange_turnover_pct: 0.000026, // 0.0026% MCX + SEBI
    stt_or_ctt_sell_pct: 0.0001, // 0.01% CTT on non-ag commodities sell
    stamp_duty_buy_pct: 0.00002, // 0.002% on buy
    gst_pct: 0.18,
  },
  MCX_INDEX: {
    brokerage_per_order_inr: 20,
    exchange_turnover_pct: 0.000026,
    stt_or_ctt_sell_pct: 0, // index derivatives currently exempt from CTT
    stamp_duty_buy_pct: 0.00002,
    gst_pct: 0.18,
  },
};

export interface SlippageSchedule {
  readonly base_bps: number;
  readonly threshold_lots: number;
  readonly large_bps: number;
}

export const SLIPPAGE_SCHEDULES: Record<InstrumentClass, SlippageSchedule> = {
  NSE_FO_STOCK: { base_bps: 2, threshold_lots: 50, large_bps: 8 },
  MCX_SINGLE: { base_bps: 3, threshold_lots: 10, large_bps: 10 },
  MCX_INDEX: { base_bps: 4, threshold_lots: 20, large_bps: 12 },
};

export function slippageBps(lots: number, schedule: SlippageSchedule): number {
  const n = Math.max(0, lots);
  if (n <= schedule.threshold_lots) return schedule.base_bps;
  const ratio = Math.min((n - schedule.threshold_lots) / schedule.threshold_lots, 1);
  return schedule.base_bps + ratio * (schedule.large_bps - schedule.base_bps);
}

export interface TradeLeg {
  readonly side: TradeSide;
  readonly lots: number;
  readonly pricePerUnit: number;
  readonly lotSize: number;
  readonly instrumentClass: InstrumentClass;
}

export function computeLegCost(leg: TradeLeg): number {
  if (leg.lots <= 0) return 0;
  const fees = FEE_SCHEDULES[leg.instrumentClass];
  const slippageSch = SLIPPAGE_SCHEDULES[leg.instrumentClass];
  const notional = leg.lots * leg.lotSize * leg.pricePerUnit;
  if (notional <= 0) return 0;

  const brokerage = fees.brokerage_per_order_inr;
  const exchangeFee = notional * fees.exchange_turnover_pct;
  const regulatoryTax =
    leg.side === 'SELL'
      ? notional * fees.stt_or_ctt_sell_pct
      : notional * fees.stamp_duty_buy_pct;
  const gst = (brokerage + exchangeFee) * fees.gst_pct;
  const slippage = (notional * slippageBps(leg.lots, slippageSch)) / 10000;

  return brokerage + exchangeFee + regulatoryTax + gst + slippage;
}

export function computeTradeCosts(
  close: readonly number[],
  signals: readonly number[],
  lots: readonly number[],
  lotSize: number,
  instrumentClass: InstrumentClass,
): number[] {
  const n = close.length;
  const costs: number[] = new Array(n).fill(0);
  if (n === 0 || lotSize <= 0) return costs;

  const initialPosition = (signals[0] ?? 0) * (lots[0] ?? 0);
  if (initialPosition !== 0 && close[0] > 0) {
    costs[0] = computeLegCost({
      side: initialPosition > 0 ? 'BUY' : 'SELL',
      lots: Math.abs(initialPosition),
      pricePerUnit: close[0],
      lotSize,
      instrumentClass,
    });
  }

  for (let i = 1; i < n; i++) {
    const prevPosition = (signals[i - 1] ?? 0) * (lots[i - 1] ?? 0);
    const currPosition = (signals[i] ?? 0) * (lots[i] ?? 0);
    if (prevPosition === currPosition) continue;
    if (close[i] <= 0) continue;

    let dayCost = 0;

    const signsDiffer =
      Math.sign(prevPosition) !== Math.sign(currPosition) &&
      prevPosition !== 0 &&
      currPosition !== 0;

    if (signsDiffer) {
      dayCost += computeLegCost({
        side: prevPosition > 0 ? 'SELL' : 'BUY',
        lots: Math.abs(prevPosition),
        pricePerUnit: close[i],
        lotSize,
        instrumentClass,
      });
      dayCost += computeLegCost({
        side: currPosition > 0 ? 'BUY' : 'SELL',
        lots: Math.abs(currPosition),
        pricePerUnit: close[i],
        lotSize,
        instrumentClass,
      });
    } else {
      const delta = currPosition - prevPosition;
      const side: TradeSide = delta > 0 ? 'BUY' : 'SELL';
      dayCost += computeLegCost({
        side,
        lots: Math.abs(delta),
        pricePerUnit: close[i],
        lotSize,
        instrumentClass,
      });
    }

    costs[i] = dayCost;
  }
  return costs;
}

export function detectInstrumentClass(ticker: string): InstrumentClass {
  if (!isMcxSymbol(ticker)) return 'NSE_FO_STOCK';
  const commodity = getCommodity(ticker);
  return commodity?.kind === 'index' ? 'MCX_INDEX' : 'MCX_SINGLE';
}
