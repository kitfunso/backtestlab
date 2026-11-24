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
