'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
  type DraggableProvidedDragHandleProps,
} from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import type {
  CombineLogic,
  IndicatorType,
  IndiaStock,
  PriceData,
  RebalanceFreq,
  SizingConfig,
  StrategyConfig,
  SignalCondition,
} from '@/lib/india/types';
import { useBacktest } from '@/lib/india/hooks';
import { PRESETS } from '@/lib/india/presets';
import {
  INDICATOR_META,
  INDICATOR_CATEGORIES,
  CATEGORY_COLORS,
  formatBlockLabel,
  PRESET_TOOLTIPS,
} from '@/lib/india/indicator-meta';
import type {
  PipelineBlock,
  IndicatorBlock,
  TriggerBlock,
  ActionBlock,
} from '@/lib/india/block-types';
import { blockId } from '@/lib/india/block-types';
import {
  blocksToStrategyConfig,
  presetToBlocks,
  getDefaultBlocks,
  isValidOrder,
  removeBlockCascade,
} from '@/lib/india/block-utils';
import { ResultsPanel } from './ResultsPanel';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StrategyBuilderProps {
  stock: IndiaStock | null;
  priceData: PriceData | null;
  isLight: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONDITION_LABELS: Record<SignalCondition, string> = {
  crosses_above: 'crosses above',
  crosses_below: 'crosses below',
  is_above: 'is above',
  is_below: 'is below',
  between: 'between',
};

function findIndicatorBlock(
  blocks: readonly PipelineBlock[],
  id: string,
): IndicatorBlock | undefined {
  return blocks.find(
    (b): b is IndicatorBlock => b.kind === 'indicator' && b.id === id,
  );
}

function getTriggerLabel(
  trigger: TriggerBlock,
  blocks: readonly PipelineBlock[],
): string {
  const src = findIndicatorBlock(blocks, trigger.sourceBlockId);
  const srcLabel = src ? formatBlockLabel(src.indicatorType, src.params) : '?';
  const cond = CONDITION_LABELS[trigger.condition] ?? trigger.condition;
  if (trigger.referenceBlockId) {
    const ref = findIndicatorBlock(blocks, trigger.referenceBlockId);
    if (ref) return `${srcLabel} ${cond} ${formatBlockLabel(ref.indicatorType, ref.params)}`;
    return `${srcLabel} ${cond}`;
  }
  if (trigger.threshold !== undefined) return `${srcLabel} ${cond} ${trigger.threshold}`;
  return `${srcLabel} ${cond}`;
}

function getActionLabel(action: ActionBlock): string {
  if (action.direction === 'long') return 'Go Long';
  if (action.direction === 'short') return 'Go Short';
  return 'Go Long/Short';
}

function getBlockWarning(
  block: PipelineBlock,
  blocks: readonly PipelineBlock[],
): string | null {
  if (block.kind === 'indicator') {
    // Check if any trigger references this indicator
    const hasRule = blocks.some(
      (b) => b.kind === 'trigger' && ((b as TriggerBlock).sourceBlockId === block.id || (b as TriggerBlock).referenceBlockId === block.id),
    );
    if (!hasRule) return 'Add a rule (IF) to use this indicator';
  }
  if (block.kind === 'trigger') {
    const hasAction = blocks.some(
      (b) => b.kind === 'action' && (b as ActionBlock).triggerBlockId === block.id,
    );
    if (!hasAction) return 'Add an action (DO) to complete this rule';
  }
  if (block.kind === 'action') {
    const trigger = blocks.find(
      (b) => b.kind === 'trigger' && b.id === (block as ActionBlock).triggerBlockId,
    );
    if (!trigger) return 'Missing trigger (IF) block';
  }
  return null;
}

function getBlockBorderColor(
  block: PipelineBlock,
  _blocks: readonly PipelineBlock[],
): string {
  if (block.kind === 'indicator') {
    const meta = INDICATOR_META[(block as IndicatorBlock).indicatorType];
    return CATEGORY_COLORS[meta?.category] ?? '#6B7280';
  }
  if (block.kind === 'trigger') return '#FF9933';
  const action = block as ActionBlock;
  if (action.direction === 'long') return '#22C55E';
  if (action.direction === 'short') return '#EF4444';
  return 'linear-gradient(to bottom, #22C55E 50%, #EF4444 50%)';
}

function getBlockLabel(
  block: PipelineBlock,
  blocks: readonly PipelineBlock[],
): string {
  if (block.kind === 'indicator') {
    const ind = block as IndicatorBlock;
    return formatBlockLabel(ind.indicatorType, ind.params);
  }
  if (block.kind === 'trigger') return getTriggerLabel(block as TriggerBlock, blocks);
  return getActionLabel(block as ActionBlock);
}

function getBlockTooltip(
  block: PipelineBlock,
  blocks: readonly PipelineBlock[],
): string {
  if (block.kind === 'indicator') {
    const meta = INDICATOR_META[(block as IndicatorBlock).indicatorType];
    return meta?.desc ?? '';
  }
  if (block.kind === 'trigger') {
    const t = block as TriggerBlock;
    const src = findIndicatorBlock(blocks, t.sourceBlockId);
    const srcLabel = src ? formatBlockLabel(src.indicatorType, src.params) : '?';
    return `When ${srcLabel} ${getTriggerLabel(t, blocks)}`;
  }
  const a = block as ActionBlock;
  return `Direction: ${a.direction}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StrategyBuilder({
  stock,
  priceData,
  isLight,
  onClose,
}: StrategyBuilderProps) {
  const [blocks, setBlocks] = useState<PipelineBlock[]>([]);
  const [combineLogic, setCombineLogic] = useState<CombineLogic>('or');
  const [sizing, setSizing] = useState<SizingConfig>({
    risk_budget: 500000,
    vol_window: 20,
    z_multiplier: 1.65,
  });
  const [rebalance, setRebalance] = useState<RebalanceFreq>('daily');
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddRuleModal, setShowAddRuleModal] = useState(false);
  const [expandedBlockId, setExpandedBlockId] = useState<string | null>(null);

  // Derive config from blocks
  const config: StrategyConfig | null = useMemo(
    () => {
      const c = blocksToStrategyConfig(blocks, sizing, rebalance, combineLogic);
      if (blocks.length > 0) {
        console.log('[StrategyBuilder] blocks:', blocks.length, 'config:', c ? `${c.indicators.length} ind, ${c.rules.length} rules` : 'NULL', 'priceData:', priceData ? 'YES' : 'NULL');
      }
      return c;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blocks, sizing, rebalance, combineLogic, priceData],
  );

  const { result, isLoading, error } = useBacktest({
    ticker: stock?.ticker ?? '',
    lotSize: stock?.lot_size ?? 1,
    config,
    priceData,
  });

  // Preset application
  const applyPreset = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      const newBlocks = presetToBlocks(preset);
      setBlocks(newBlocks);
      setCombineLogic(preset.config.combine_logic);
      setSizing(preset.config.sizing);
      setRebalance(preset.config.rebalance);
      setActivePreset(preset.id);
      setExpandedBlockId(null);
    },
    [],
  );

  // Auto-apply first preset on stock selection
  const prevTickerRef = useRef<string | null>(null);
  useEffect(() => {
    const ticker = stock?.ticker ?? null;
    if (
      ticker &&
      ticker !== prevTickerRef.current &&
      blocks.length === 0 &&
      PRESETS.length > 0
    ) {
      applyPreset(PRESETS[0]);
    }
    prevTickerRef.current = ticker;
  }, [stock?.ticker, blocks.length, applyPreset]);

  // Block mutations
  const addIndicator = useCallback((type: IndicatorType) => {
    const meta = INDICATOR_META[type];
    const params: Record<string, number> = {};
    for (const p of meta.params) {
      params[p.key] = p.default;
    }
    const ind: IndicatorBlock = { id: blockId(), kind: 'indicator', indicatorType: type, params };
    setBlocks((prev) => [...prev, ind]);
    setActivePreset(null);
    setShowAddModal(false);
  }, []);

  const addRule = useCallback(
    (sourceBlockId: string, referenceBlockId?: string) => {
      const triggerId = blockId();
      const trigger: TriggerBlock = referenceBlockId
        ? { id: triggerId, kind: 'trigger', sourceBlockId, condition: 'is_above', referenceBlockId }
        : { id: triggerId, kind: 'trigger', sourceBlockId, condition: 'is_above', threshold: 0 };
      const action: ActionBlock = {
        id: blockId(),
        kind: 'action',
        triggerBlockId: triggerId,
        direction: 'both',
      };
      setBlocks((prev) => [...prev, trigger, action]);
      setActivePreset(null);
      setShowAddRuleModal(false);
    },
    [],
  );

  const removeBlock = useCallback(
    (id: string) => {
      setBlocks((prev) => removeBlockCascade(prev, id));
      setActivePreset(null);
      if (expandedBlockId === id) setExpandedBlockId(null);
    },
    [expandedBlockId],
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      setBlocks((prev) => {
        const block = prev.find((b) => b.id === id);
        if (!block || block.kind !== 'indicator') return prev;
        const ind = block as IndicatorBlock;
        const newBlock: IndicatorBlock = {
          id: blockId(),
          kind: 'indicator',
          indicatorType: ind.indicatorType,
          params: { ...ind.params },
        };
        // Insert after the original
        const idx = prev.indexOf(block);
        const copy = [...prev];
        copy.splice(idx + 1, 0, newBlock);
        return copy;
      });
      setActivePreset(null);
    },
    [],
  );

  const updateIndicatorParam = useCallback(
    (blockId: string, key: string, value: number) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && b.kind === 'indicator'
            ? ({ ...b, params: { ...(b as IndicatorBlock).params, [key]: value } } as IndicatorBlock)
            : b,
        ),
      );
      setActivePreset(null);
    },
    [],
  );

  const updateTrigger = useCallback(
    (blockId: string, updates: Partial<Pick<TriggerBlock, 'condition' | 'threshold'>>) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && b.kind === 'trigger'
            ? ({ ...b, ...updates } as TriggerBlock)
            : b,
        ),
      );
      setActivePreset(null);
    },
    [],
  );

  const updateAction = useCallback(
    (blockId: string, direction: ActionBlock['direction']) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && b.kind === 'action'
            ? ({ ...b, direction } as ActionBlock)
            : b,
        ),
      );
      setActivePreset(null);
    },
    [],
  );

  // Drag and drop
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      const from = result.source.index;
      const to = result.destination.index;
      if (from === to) return;

      const reordered = [...blocks];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);

      if (isValidOrder(reordered)) {
        setBlocks(reordered);
        setActivePreset(null);
      }
      // Invalid drop: silently reject, blocks stay in original order
    },
    [blocks],
  );

  // Theme tokens
  const cardBg = isLight ? 'bg-white' : 'bg-zinc-900/50';
  const cardBorder = isLight ? 'border-gray-200' : 'border-zinc-800';
  const tertBg = isLight ? 'bg-gray-50' : 'bg-zinc-800/50';
  const textPrimary = isLight ? 'text-gray-900' : 'text-zinc-100';
  const textSecondary = isLight ? 'text-gray-500' : 'text-zinc-400';
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';

  // Indicator blocks for combine logic toggle and add-rule modal
  const indicatorBlocks = useMemo(() => blocks.filter((b): b is IndicatorBlock => b.kind === 'indicator'), [blocks]);
  const indicatorCount = indicatorBlocks.length;

  return (
    <div className={cn('rounded-xl border', cardBorder, cardBg)}>
      {/* Top Bar */}
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 border-b flex-wrap',
          cardBorder,
        )}
      >
        <div className="flex items-center gap-2 mr-auto">
          <h2
            className={cn(
              'text-base font-semibold font-[DM_Sans]',
              textPrimary,
            )}
          >
            {stock?.name ?? 'Select a stock'}
          </h2>
          {stock && (
            <span className="font-mono text-xs text-zinc-500">
              {stock.ticker}
            </span>
          )}
          {stock && (
            <span className="font-mono text-xs text-zinc-500">
              Lot: {stock.lot_size}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className={cn(
            'text-xs px-2 py-1 rounded',
            textMuted,
            'hover:text-[#EF4444]',
          )}
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
              setSizing((s) => ({
                ...s,
                z_multiplier: Number(e.target.value),
              }))
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

      {/* Preset Pills */}
      <div
        className={cn(
          'flex gap-1.5 px-4 py-2.5 border-b flex-wrap',
          cardBorder,
        )}
      >
        <span
          className={cn('text-[11px] font-medium self-center mr-1', textMuted)}
        >
          Presets
        </span>
        {PRESETS.map((p) => (
          <Tooltip
            key={p.id}
            text={PRESET_TOOLTIPS[p.id] ?? p.name}
            isLight={isLight}
          >
            <button
              onClick={() => applyPreset(p)}
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
          </Tooltip>
        ))}
      </div>

      {/* Block Pipeline — horizontal flow */}
      <div className={cn('px-4 py-2.5 border-b', cardBorder)}>
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="pipeline" direction="horizontal">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="flex flex-wrap items-start gap-1"
              >
                {blocks.map((block, index) => (
                  <Draggable
                    key={block.id}
                    draggableId={block.id}
                    index={index}
                  >
                    {(dragProvided, snapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className="flex items-start gap-1"
                      >
                        {/* Arrow connector */}
                        {index > 0 && (
                          <span className={cn('text-[10px] self-center select-none pt-0.5', textMuted)}>
                            {blocks[index - 1]?.kind === 'action' && block.kind === 'indicator'
                              ? <button
                                  onClick={() => setCombineLogic((l) => l === 'and' ? 'or' : 'and')}
                                  className="px-1 py-0.5 rounded text-[9px] font-bold bg-[#FF9933]/10 text-[#FF9933] hover:bg-[#FF9933]/20"
                                >
                                  {combineLogic === 'and' ? 'AND' : 'OR'}
                                </button>
                              : '→'}
                          </span>
                        )}

                        <BlockPill
                          block={block}
                          blocks={blocks}
                          isExpanded={expandedBlockId === block.id}
                          isDragging={snapshot.isDragging}
                          isLight={isLight}
                          dragHandleProps={dragProvided.dragHandleProps}
                          onToggleExpand={() =>
                            setExpandedBlockId((prev) =>
                              prev === block.id ? null : block.id,
                            )
                          }
                          onRemove={() => removeBlock(block.id)}
                          onDuplicate={block.kind === 'indicator' ? () => duplicateBlock(block.id) : undefined}
                          onUpdateIndicatorParam={(key, val) =>
                            updateIndicatorParam(block.id, key, val)
                          }
                          onUpdateTrigger={(updates) =>
                            updateTrigger(block.id, updates)
                          }
                          onUpdateAction={(dir) =>
                            updateAction(block.id, dir)
                          }
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}

                {/* Inline add buttons */}
                <div className="flex items-center gap-1 self-center">
                  <button
                    onClick={() => setShowAddModal(true)}
                    className={cn(
                      'px-2 py-1 rounded border border-dashed text-[11px] font-medium transition-all',
                      isLight
                        ? 'border-gray-300 text-gray-400 hover:border-[#FF9933] hover:text-[#FF9933]'
                        : 'border-zinc-700 text-zinc-500 hover:border-[#FF9933] hover:text-[#FF9933]',
                    )}
                  >
                    + IND
                  </button>
                  {indicatorBlocks.length > 0 && (
                    <button
                      onClick={() => setShowAddRuleModal(true)}
                      className={cn(
                        'px-2 py-1 rounded border border-dashed text-[11px] font-medium transition-all',
                        isLight
                          ? 'border-orange-300 text-orange-400 hover:border-[#FF9933] hover:text-[#FF9933]'
                          : 'border-orange-700/50 text-orange-500/60 hover:border-[#FF9933] hover:text-[#FF9933]',
                      )}
                    >
                      + IF→DO
                    </button>
                  )}
                </div>
              </div>
            )}
          </Droppable>
        </DragDropContext>

        {blocks.length === 0 && (
          <div className={cn('text-xs py-1', textMuted)}>
            Select a preset or click + IND to start.
          </div>
        )}

        {/* Modals */}
        {showAddModal && (
          <AddBlockModal
            onSelect={addIndicator}
            onClose={() => setShowAddModal(false)}
            isLight={isLight}
          />
        )}
        {showAddRuleModal && (
          <AddRuleModal
            indicatorBlocks={indicatorBlocks}
            onAdd={addRule}
            onClose={() => setShowAddRuleModal(false)}
            isLight={isLight}
          />
        )}
      </div>

      {/* Results — full width */}
      <div className="p-4">
        {!stock && blocks.length > 0 && !result && !isLoading && (
          <div className={cn('flex items-center justify-center py-12 text-sm', textMuted)}>
            Select a stock from the grid above to run the backtest.
          </div>
        )}
        {!stock && blocks.length === 0 && (
          <div className={cn('flex items-center justify-center py-12 text-sm', textMuted)}>
            Select a stock, then configure a strategy.
          </div>
        )}
        {stock && !priceData && blocks.length > 0 && (
          <div className={cn('flex items-center justify-center py-12 text-sm', textSecondary)}>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-[#FF9933] border-t-transparent rounded-full animate-spin" />
              Loading price data...
            </div>
          </div>
        )}
        {(result || isLoading || error || (stock && priceData)) && (
          <ResultsPanel
            result={result}
            isLoading={isLoading}
            error={error}
            isLight={isLight}
          />
        )}
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
      <span
        className={cn(
          'text-[11px]',
          isLight ? 'text-gray-400' : 'text-zinc-500',
        )}
      >
        {label}
      </span>
      {children}
      <span className="font-mono text-xs text-[#FF9933]">{value}</span>
    </div>
  );
}

function Tooltip({
  text,
  children,
  isLight,
}: {
  text: string;
  children: React.ReactNode;
  isLight: boolean;
}) {
  return (
    <span className="relative group/tip">
      {children}
      <span
        className={cn(
          'absolute z-50 left-0 top-full mt-1 w-56 px-2.5 py-1.5 rounded-lg text-[10px] leading-snug shadow-lg',
          'opacity-0 pointer-events-none group-hover/tip:opacity-100 transition-opacity duration-150',
          isLight ? 'bg-gray-900 text-gray-100' : 'bg-zinc-100 text-zinc-900',
        )}
      >
        {text}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Connector line between blocks
// ---------------------------------------------------------------------------

function Connector({
  isLight,
  showLogicToggle,
  combineLogic,
  onToggleLogic,
}: {
  isLight: boolean;
  showLogicToggle: boolean;
  combineLogic: CombineLogic;
  onToggleLogic: () => void;
}) {
  return (
    <div className="flex flex-col items-center py-0">
      <div
        className={cn(
          'w-[2px] border-l-2 border-dashed',
          showLogicToggle ? 'h-1' : 'h-2',
          isLight ? 'border-gray-300' : 'border-zinc-600',
        )}
      />
      {showLogicToggle && (
        <>
          <button
            onClick={onToggleLogic}
            className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-all my-0.5',
              'bg-[#FF9933]/10 border-[#FF9933]/30 text-[#FF9933] hover:bg-[#FF9933]/20',
            )}
          >
            {combineLogic === 'and' ? 'AND' : 'OR'}
          </button>
          <div
            className={cn(
              'w-[2px] h-2 border-l-2 border-dashed',
              isLight ? 'border-gray-300' : 'border-zinc-600',
            )}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block Pill
// ---------------------------------------------------------------------------

function BlockPill({
  block,
  blocks,
  isExpanded,
  isDragging,
  isLight,
  dragHandleProps,
  onToggleExpand,
  onRemove,
  onDuplicate,
  onUpdateIndicatorParam,
  onUpdateTrigger,
  onUpdateAction,
}: {
  block: PipelineBlock;
  blocks: readonly PipelineBlock[];
  isExpanded: boolean;
  isDragging: boolean;
  isLight: boolean;
  dragHandleProps: DraggableProvidedDragHandleProps | null;
  onToggleExpand: () => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onUpdateIndicatorParam: (key: string, value: number) => void;
  onUpdateTrigger: (updates: Partial<Pick<TriggerBlock, 'condition' | 'threshold'>>) => void;
  onUpdateAction: (direction: ActionBlock['direction']) => void;
}) {
  const borderColor = getBlockBorderColor(block, blocks);
  const label = getBlockLabel(block, blocks);
  const tooltip = getBlockTooltip(block, blocks);
  const warning = getBlockWarning(block, blocks);
  const isGradient =
    block.kind === 'action' && (block as ActionBlock).direction === 'both';

  const kindBadge =
    block.kind === 'indicator'
      ? 'IND'
      : block.kind === 'trigger'
        ? 'IF'
        : 'DO';

  const pillBg = isLight ? 'bg-white' : 'bg-zinc-900';
  const pillBorder = isLight ? 'border-gray-200' : 'border-zinc-700';
  const textPrimary = isLight ? 'text-gray-900' : 'text-zinc-100';
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';

  return (
    <Tooltip text={tooltip} isLight={isLight}>
      <div
        className={cn(
          'rounded-lg border transition-shadow',
          pillBg,
          pillBorder,
          isDragging && 'shadow-lg ring-2 ring-[#FF9933]/30',
          isExpanded && 'ring-1 ring-[#FF9933]/20',
        )}
      >
        {/* Collapsed pill row */}
        <div className="flex items-center gap-0 min-h-[30px]">
          {/* Left color border */}
          {isGradient ? (
            <div
              className="w-1 self-stretch rounded-l-lg flex-shrink-0"
              style={{
                background:
                  'linear-gradient(to bottom, #22C55E 50%, #EF4444 50%)',
              }}
            />
          ) : (
            <div
              className="w-1 self-stretch rounded-l-lg flex-shrink-0"
              style={{ backgroundColor: borderColor }}
            />
          )}

          {/* Drag handle */}
          <div
            {...(dragHandleProps ?? {})}
            className={cn(
              'flex items-center px-1.5 cursor-grab active:cursor-grabbing select-none',
              textMuted,
            )}
            style={{ fontSize: '14px', lineHeight: 1, letterSpacing: '1px' }}
          >
            &#x2261;
          </div>

          {/* Kind badge */}
          <span
            className={cn(
              'text-[9px] font-bold uppercase px-1 py-0.5 rounded mr-1.5 flex-shrink-0',
              block.kind === 'indicator'
                ? 'bg-blue-500/10 text-blue-400'
                : block.kind === 'trigger'
                  ? 'bg-orange-500/10 text-orange-400'
                  : 'bg-green-500/10 text-green-400',
            )}
          >
            {kindBadge}
          </span>

          {/* Label */}
          <button
            onClick={onToggleExpand}
            className={cn(
              'flex-1 text-left text-[12px] font-medium truncate cursor-pointer',
              textPrimary,
            )}
          >
            {label}
          </button>

          {/* Duplicate + Remove */}
          {onDuplicate && (
            <button
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
              title="Duplicate"
              className={cn('text-[11px] px-1 py-1 flex-shrink-0 transition-colors', textMuted, 'hover:text-[#FF9933]')}
            >
              &#x2398;
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className={cn('text-[11px] px-1.5 py-1 flex-shrink-0 transition-colors', textMuted, 'hover:text-[#EF4444]')}
          >
            &#x2715;
          </button>
        </div>

        {/* Warning for incomplete blocks */}
        {warning && (
          <div className="px-3 py-1.5 text-[10px] text-[#EF4444] font-medium">
            {warning}
          </div>
        )}

        {/* Expanded inline editor */}
        {isExpanded && (
          <div
            className={cn(
              'px-3 pb-2.5 pt-1 border-t',
              isLight ? 'border-gray-100' : 'border-zinc-800',
            )}
          >
            {block.kind === 'indicator' && (
              <IndicatorEditor
                block={block as IndicatorBlock}
                isLight={isLight}
                onUpdateParam={onUpdateIndicatorParam}
              />
            )}
            {block.kind === 'trigger' && (
              <TriggerEditor
                block={block as TriggerBlock}
                blocks={blocks}
                isLight={isLight}
                onUpdate={onUpdateTrigger}
              />
            )}
            {block.kind === 'action' && (
              <ActionEditor
                block={block as ActionBlock}
                isLight={isLight}
                onUpdate={onUpdateAction}
              />
            )}
          </div>
        )}
      </div>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Inline editors
// ---------------------------------------------------------------------------

function IndicatorEditor({
  block,
  isLight,
  onUpdateParam,
}: {
  block: IndicatorBlock;
  isLight: boolean;
  onUpdateParam: (key: string, value: number) => void;
}) {
  const meta = INDICATOR_META[block.indicatorType];
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';
  const inputCls = cn(
    'w-20 px-2 py-1 rounded border text-xs font-mono text-center outline-none transition-colors',
    isLight
      ? 'bg-white border-gray-200 text-gray-900 focus:border-[#FF9933]'
      : 'bg-zinc-900 border-zinc-700 text-[#FF9933] focus:border-[#FF9933]',
  );

  if (meta.params.length === 0) {
    return (
      <span className={cn('text-[11px]', textMuted)}>No parameters</span>
    );
  }

  return (
    <div className="space-y-1.5">
      {meta.params.map((p) => (
        <div key={p.key} className="flex items-center gap-2">
          <span className={cn('text-[11px] min-w-[60px]', textMuted)}>
            {p.label}
          </span>
          <input
            type="number"
            min={p.min}
            max={p.max}
            step={p.step}
            value={block.params[p.key] ?? p.default}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!isNaN(v)) onUpdateParam(p.key, v);
            }}
            className={inputCls}
          />
        </div>
      ))}
    </div>
  );
}

function TriggerEditor({
  block,
  blocks,
  isLight,
  onUpdate,
}: {
  block: TriggerBlock;
  blocks: readonly PipelineBlock[];
  isLight: boolean;
  onUpdate: (updates: Partial<Pick<TriggerBlock, 'condition' | 'threshold'>>) => void;
}) {
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

  const hasRef = !!block.referenceBlockId;
  const refBlock = hasRef
    ? findIndicatorBlock(blocks, block.referenceBlockId!)
    : null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn('text-[11px]', textMuted)}>Condition</span>
        <select
          value={block.condition}
          onChange={(e) =>
            onUpdate({ condition: e.target.value as SignalCondition })
          }
          className={selectCls}
        >
          <option value="crosses_above">crosses above</option>
          <option value="crosses_below">crosses below</option>
          <option value="is_above">is above</option>
          <option value="is_below">is below</option>
        </select>
        {hasRef && refBlock ? (
          <span
            className={cn(
              'text-[11px] font-mono',
              isLight ? 'text-gray-600' : 'text-zinc-400',
            )}
          >
            {formatBlockLabel(refBlock.indicatorType, refBlock.params)}
          </span>
        ) : (
          <>
            <span className={cn('text-[11px]', textMuted)}>Threshold</span>
            <input
              type="number"
              value={block.threshold ?? 0}
              onChange={(e) => onUpdate({ threshold: Number(e.target.value) })}
              className={inputCls}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ActionEditor({
  block,
  isLight,
  onUpdate,
}: {
  block: ActionBlock;
  isLight: boolean;
  onUpdate: (direction: ActionBlock['direction']) => void;
}) {
  const selectCls = cn(
    'text-[11px] font-mono px-1.5 py-0.5 rounded border outline-none',
    isLight
      ? 'bg-white border-gray-200 text-gray-900 focus:border-[#FF9933]'
      : 'bg-zinc-900 border-zinc-700 text-zinc-200 focus:border-[#FF9933]',
  );
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';

  return (
    <div className="flex items-center gap-2">
      <span className={cn('text-[11px]', textMuted)}>Direction</span>
      <select
        value={block.direction}
        onChange={(e) =>
          onUpdate(e.target.value as ActionBlock['direction'])
        }
        className={selectCls}
      >
        <option value="both">Long/Short</option>
        <option value="long">Long only</option>
        <option value="short">Short only</option>
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Block Modal
// ---------------------------------------------------------------------------

function AddBlockModal({
  onSelect,
  onClose,
  isLight,
}: {
  onSelect: (type: IndicatorType) => void;
  onClose: () => void;
  isLight: boolean;
}) {
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';

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
        <div
          className={cn(
            'sticky top-0 px-3 py-2 border-b text-xs font-semibold flex items-center justify-between',
            isLight
              ? 'bg-white border-gray-200 text-gray-900'
              : 'bg-zinc-900 border-zinc-700 text-zinc-100',
          )}
        >
          <span>Add Indicator Block</span>
          <button
            onClick={onClose}
            className={cn('text-[11px]', textMuted, 'hover:text-[#EF4444]')}
          >
            &#x2715;
          </button>
        </div>

        {INDICATOR_CATEGORIES.map((cat) => {
          const items = (
            Object.entries(INDICATOR_META) as [IndicatorType, (typeof INDICATOR_META)[IndicatorType]][]
          ).filter(
            ([key, m]) => m.category === cat && key !== 'close_price',
          );
          if (items.length === 0) return null;

          const catColor = CATEGORY_COLORS[cat] ?? '#6B7280';

          return (
            <div key={cat} className="px-3 py-2">
              <div
                className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: catColor }}
              >
                {cat}
              </div>
              <div className="flex flex-wrap gap-1">
                {items.map(([key, m]) => (
                  <Tooltip key={key} text={m.desc} isLight={isLight}>
                    <button
                      onClick={() => onSelect(key)}
                      className={cn(
                        'px-2 py-1 rounded text-[11px] font-medium border transition-all',
                        isLight
                          ? 'bg-gray-50 border-gray-200 text-gray-700 hover:border-[#FF9933] hover:text-[#FF9933]'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-[#FF9933] hover:text-[#FF9933]',
                      )}
                    >
                      {m.label}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Add Rule Modal — pick source (and optional reference) indicator for a new IF→DO pair
// ---------------------------------------------------------------------------

function AddRuleModal({
  indicatorBlocks,
  onAdd,
  onClose,
  isLight,
}: {
  indicatorBlocks: readonly IndicatorBlock[];
  onAdd: (sourceBlockId: string, referenceBlockId?: string) => void;
  onClose: () => void;
  isLight: boolean;
}) {
  const [sourceId, setSourceId] = useState(indicatorBlocks[0]?.id ?? '');
  const [useRef, setUseRef] = useState(false);
  const [refId, setRefId] = useState(indicatorBlocks[1]?.id ?? '');
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';
  const selectCls = cn(
    'text-[11px] font-mono px-1.5 py-1 rounded border outline-none w-full',
    isLight
      ? 'bg-white border-gray-200 text-gray-900'
      : 'bg-zinc-900 border-zinc-700 text-zinc-200',
  );

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/20" onClick={onClose} />
      <div
        className={cn(
          'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[320px] z-[100] rounded-xl border shadow-2xl p-4',
          isLight ? 'bg-white border-gray-200' : 'bg-zinc-900 border-zinc-700',
        )}
      >
        <div className="flex items-center justify-between mb-3">
          <span className={cn('text-xs font-semibold', isLight ? 'text-gray-900' : 'text-zinc-100')}>
            Add Rule (IF → DO)
          </span>
          <button onClick={onClose} className={cn('text-[11px]', textMuted, 'hover:text-[#EF4444]')}>
            &#x2715;
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={cn('text-[10px] uppercase tracking-wider font-semibold block mb-1', textMuted)}>
              When this indicator...
            </label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className={selectCls}>
              {indicatorBlocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {formatBlockLabel(b.indicatorType, b.params)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="useRef"
              checked={useRef}
              onChange={(e) => setUseRef(e.target.checked)}
              className="accent-[#FF9933]"
            />
            <label htmlFor="useRef" className={cn('text-[11px]', isLight ? 'text-gray-700' : 'text-zinc-300')}>
              Compare against another indicator
            </label>
          </div>

          {useRef && indicatorBlocks.length >= 2 && (
            <div>
              <label className={cn('text-[10px] uppercase tracking-wider font-semibold block mb-1', textMuted)}>
                ...is compared to
              </label>
              <select value={refId} onChange={(e) => setRefId(e.target.value)} className={selectCls}>
                {indicatorBlocks.filter((b) => b.id !== sourceId).map((b) => (
                  <option key={b.id} value={b.id}>
                    {formatBlockLabel(b.indicatorType, b.params)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => onAdd(sourceId, useRef ? refId : undefined)}
            className="w-full py-2 rounded-lg bg-[#FF9933] text-white text-xs font-semibold hover:bg-[#FF9933]/90 transition-colors"
          >
            Add Rule
          </button>
        </div>
      </div>
    </>
  );
}
