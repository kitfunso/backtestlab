import type {
  CombineLogic,
  IndicatorConfig,
  IndicatorType,
  RebalanceFreq,
  SignalCondition,
  SignalRule,
  SizingConfig,
  StrategyConfig,
} from './types';
import type { PresetStrategy } from './types';
import type {
  ActionBlock,
  IndicatorBlock,
  PipelineBlock,
  TriggerBlock,
} from './block-types';
import { blockId } from './block-types';
import { INDICATOR_META, TREND_TYPES } from './indicator-meta';

export function blocksToStrategyConfig(
  blocks: readonly PipelineBlock[],
  sizing: SizingConfig,
  rebalance: RebalanceFreq,
  combineLogic: CombineLogic,
): StrategyConfig | null {
  const indicatorBlocks = blocks.filter((b): b is IndicatorBlock => b.kind === 'indicator');
  const triggerBlocks = blocks.filter((b): b is TriggerBlock => b.kind === 'trigger');
  const actionBlocks = blocks.filter((b): b is ActionBlock => b.kind === 'action');

  if (indicatorBlocks.length === 0) return null;

  const idToIndex = new Map<string, number>();
  const indicators: IndicatorConfig[] = [];

  let closePriceIndex = -1;
  for (const t of triggerBlocks) {
    if (!t.referenceBlockId) {
      const src = indicatorBlocks.find((b) => b.id === t.sourceBlockId);
      if (src && TREND_TYPES.includes(src.indicatorType)) {
        if (closePriceIndex === -1) {
          closePriceIndex = indicators.length;
          indicators.push({ type: 'close_price', params: {} });
        }
      }
    }
  }

  for (const b of indicatorBlocks) {
    idToIndex.set(b.id, indicators.length);
    indicators.push({ type: b.indicatorType, params: { ...b.params } });
  }

  const rules: SignalRule[] = [];
  for (const t of triggerBlocks) {
    const action = actionBlocks.find((a) => a.triggerBlockId === t.id);
    const direction = action?.direction ?? 'both';

    const srcIndex = idToIndex.get(t.sourceBlockId);
    if (srcIndex === undefined) continue;

    if (t.referenceBlockId) {
      const refIndex = idToIndex.get(t.referenceBlockId);
      if (refIndex === undefined) continue;
      rules.push({
        indicator_index: srcIndex,
        condition: t.condition,
        reference_indicator: refIndex,
        direction,
      });
    } else {
      const src = indicatorBlocks.find((b) => b.id === t.sourceBlockId);
      if (src && TREND_TYPES.includes(src.indicatorType) && closePriceIndex !== -1) {
        rules.push({
          indicator_index: closePriceIndex,
          condition: t.condition,
          reference_indicator: srcIndex,
          direction,
        });
      } else {
        rules.push({
          indicator_index: srcIndex,
          condition: t.condition,
          threshold: t.threshold ?? 0,
          direction,
        });
      }
    }
  }

  if (indicators.length === 0) return null;

  return { indicators, rules, combine_logic: combineLogic, sizing, rebalance };
}

export function presetToBlocks(preset: PresetStrategy): PipelineBlock[] {
  const blocks: PipelineBlock[] = [];
  const cfg = preset.config;

  const indexToBlockId = new Map<number, string>();
  for (let i = 0; i < cfg.indicators.length; i++) {
    const ind = cfg.indicators[i];
    if (ind.type === 'close_price') continue;
    const id = blockId();
    indexToBlockId.set(i, id);
    blocks.push({
      id,
      kind: 'indicator',
      indicatorType: ind.type,
      params: { ...ind.params },
    } as IndicatorBlock);
  }

  for (const rule of cfg.rules) {
    const sourceId = indexToBlockId.get(rule.indicator_index);
    if (!sourceId) continue;

    const triggerId = blockId();
    const trigger: TriggerBlock = {
      id: triggerId,
      kind: 'trigger',
      sourceBlockId: sourceId,
      condition: rule.condition,
      ...(rule.reference_indicator !== undefined
        ? { referenceBlockId: indexToBlockId.get(rule.reference_indicator) }
        : { threshold: rule.threshold ?? 0 }),
    };
    blocks.push(trigger);

    blocks.push({
      id: blockId(),
      kind: 'action',
      triggerBlockId: triggerId,
      direction: rule.direction,
    } as ActionBlock);
  }

  return blocks;
}

export function getDefaultBlocks(type: IndicatorType): PipelineBlock[] {
  const meta = INDICATOR_META[type];
  const params: Record<string, number> = {};
  for (const p of meta.params) {
    params[p.key] = p.default;
  }

  const indId = blockId();
  const triggerId = blockId();
  const actionId = blockId();

  const indicator: IndicatorBlock = {
    id: indId,
    kind: 'indicator',
    indicatorType: type,
    params,
  };

  let trigger: TriggerBlock;
  if (type === 'rsi' || type === 'stoch_rsi' || type === 'mfi') {
    trigger = { id: triggerId, kind: 'trigger', sourceBlockId: indId, condition: 'is_above', threshold: 50 };
  } else if (type === 'cci') {
    trigger = { id: triggerId, kind: 'trigger', sourceBlockId: indId, condition: 'is_above', threshold: 0 };
  } else if (type === 'williams_r') {
    trigger = { id: triggerId, kind: 'trigger', sourceBlockId: indId, condition: 'is_above', threshold: -50 };
  } else if (type === 'bb_pct_b') {
    trigger = { id: triggerId, kind: 'trigger', sourceBlockId: indId, condition: 'is_above', threshold: 0.5 };
  } else if (TREND_TYPES.includes(type)) {
    trigger = { id: triggerId, kind: 'trigger', sourceBlockId: indId, condition: 'is_above' };
  } else {
    trigger = { id: triggerId, kind: 'trigger', sourceBlockId: indId, condition: 'is_above', threshold: 0 };
  }

  const action: ActionBlock = {
    id: actionId,
    kind: 'action',
    triggerBlockId: triggerId,
    direction: 'both',
  };

  return [indicator, trigger, action];
}

export function isValidOrder(blocks: readonly PipelineBlock[]): boolean {
  const seen = new Set<string>();
  for (const b of blocks) {
    if (b.kind === 'trigger') {
      const t = b as TriggerBlock;
      if (!seen.has(t.sourceBlockId)) return false;
      if (t.referenceBlockId && !seen.has(t.referenceBlockId)) return false;
    }
    if (b.kind === 'action') {
      const a = b as ActionBlock;
      if (!seen.has(a.triggerBlockId)) return false;
    }
    seen.add(b.id);
  }
  return true;
}

export function removeBlockCascade(blocks: readonly PipelineBlock[], removeId: string): PipelineBlock[] {
  const removed = new Set<string>([removeId]);

  for (const b of blocks) {
    if (b.kind === 'trigger') {
      const t = b as TriggerBlock;
      if (removed.has(t.sourceBlockId) || (t.referenceBlockId && removed.has(t.referenceBlockId))) {
        removed.add(t.id);
      }
    }
  }

  for (const b of blocks) {
    if (b.kind === 'action') {
      const a = b as ActionBlock;
      if (removed.has(a.triggerBlockId)) {
        removed.add(a.id);
      }
    }
  }

  return blocks.filter((b) => !removed.has(b.id));
}
