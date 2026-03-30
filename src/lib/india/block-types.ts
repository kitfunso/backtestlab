/**
 * India Equities Strategy Tester — Block Pipeline Types
 *
 * Visual blocks that connect like legos to build strategies.
 * Blocks are converted to StrategyConfig via blocksToStrategyConfig().
 */

import type { IndicatorType, SignalCondition } from './types';

export type BlockKind = 'indicator' | 'trigger' | 'action';

interface BaseBlock {
  readonly id: string;
  readonly kind: BlockKind;
}

export interface IndicatorBlock extends BaseBlock {
  readonly kind: 'indicator';
  readonly indicatorType: IndicatorType;
  readonly params: Record<string, number>;
}

export interface TriggerBlock extends BaseBlock {
  readonly kind: 'trigger';
  readonly sourceBlockId: string;
  readonly condition: SignalCondition;
  readonly referenceBlockId?: string;
  readonly threshold?: number;
}

export interface ActionBlock extends BaseBlock {
  readonly kind: 'action';
  readonly triggerBlockId: string;
  readonly direction: 'long' | 'short' | 'both';
}

export type PipelineBlock = IndicatorBlock | TriggerBlock | ActionBlock;

let _counter = 0;
export function blockId(): string {
  return `blk-${++_counter}-${Math.random().toString(36).slice(2, 6)}`;
}
