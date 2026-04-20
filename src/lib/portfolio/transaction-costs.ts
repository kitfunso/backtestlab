/**
 * Transaction cost model — Indian exchanges.
 *
 * Costs are incurred ONLY on position changes (lot delta or direction flip).
 * Per-leg cost = exchange-published fee schedule + size-dependent slippage.
 *
 * Schedules are pinned to 2026 retail broker disclosures (Zerodha-style flat
 * brokerage + statutory components published by NSE/MCX/SEBI). Numbers can
 * be overridden per-user if we ever expose advanced TC config to the UI.
 */

import { isMcxSymbol, getCommodity } from '@/lib/mcx/registry';

export type InstrumentClass = 'NSE_FO_STOCK' | 'MCX_SINGLE' | 'MCX_INDEX';

export type TradeSide = 'BUY' | 'SELL';

// ---------------------------------------------------------------------------
// Fee schedules (percentages are expressed as decimals, e.g. 0.0001 = 0.01%)
// ---------------------------------------------------------------------------

export interface FeeSchedule {
  readonly brokerage_per_order_inr: number;
  readonly exchange_turnover_pct: number; // exchange + SEBI + regulator on notional
  readonly stt_or_ctt_sell_pct: number; // STT (equity F&O) / CTT (non-ag commodities) on sell
  readonly stamp_duty_buy_pct: number; // on buy side notional
  readonly gst_pct: number; // on (brokerage + exchange_turnover)
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

// ---------------------------------------------------------------------------
// Slippage — piecewise-linear in lot count
// ---------------------------------------------------------------------------

export interface SlippageSchedule {
  readonly base_bps: number; // applied up to threshold_lots
  readonly threshold_lots: number; // beyond this, cost ramps toward large_bps
  readonly large_bps: number; // asymptotic ceiling at 2 × threshold_lots
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

// ---------------------------------------------------------------------------
// Single-leg cost
// ---------------------------------------------------------------------------

export interface TradeLeg {
  readonly side: TradeSide;
  readonly lots: number;
  readonly pricePerUnit: number; // quoted price (INR per share / per quoted unit)
  readonly lotSize: number; // units per lot (from registry)
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

// ---------------------------------------------------------------------------
// Daily trade-cost series aligned to PnL
// ---------------------------------------------------------------------------

/**
 * Walks the (signal, lots) series and emits a per-day INR cost array.
 * Cost on day i is charged only when the signed position (signal × lots)
 * changes from day i-1 to day i. Execution price is close[i] (trade-on-next-bar).
 *
 * A direction flip (long → short) is modelled as two legs: a SELL of the
 * previous position and a BUY of the new position, summed on the same day.
 */
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

  // Initial position taken on day 0 is a BUY/SELL of signal[0] × lots[0]
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

    // Direction flip (or unwind-to-flat + open-opposite): charge both legs.
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
      // Same-sign resize, entry from flat, or unwind to flat — one leg.
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

// ---------------------------------------------------------------------------
// Instrument-class auto-detection
// ---------------------------------------------------------------------------

export function detectInstrumentClass(ticker: string): InstrumentClass {
  if (!isMcxSymbol(ticker)) return 'NSE_FO_STOCK';
  const commodity = getCommodity(ticker);
  return commodity?.kind === 'index' ? 'MCX_INDEX' : 'MCX_SINGLE';
}
