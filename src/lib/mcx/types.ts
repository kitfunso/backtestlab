/**
 * MCX Commodities — Type Definitions
 *
 * Commodity-side mirror of `src/lib/india/types.ts`. Scope intentionally narrow:
 * the backtest engine is shared, so only metadata shapes live here.
 */

export type CommodityKind = 'single' | 'index';

export interface MCXCommodity {
  readonly symbol: string;
  readonly mcx_ticker: string;
  readonly bbg_ticker: string;
  readonly name: string;
  readonly kind: CommodityKind;
  readonly contract_size: string;
  readonly tick_size: number;
  readonly lot_size: number;
}
