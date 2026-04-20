'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  listPresets,
  getPresetWeights,
  PRESET_LABELS,
  PRESET_DESCRIPTIONS,
  type GoalPreset,
} from '@/lib/factors/presets';
import {
  compositeScore,
  selectTopN,
  factorContributions,
  FACTOR_LABELS,
  type FactorUniverse,
  type FactorName,
} from '@/lib/factors/score';

const ACK_KEY = 'bl.wizard.acknowledged';

type Horizon = '1y' | '3y' | '5y';

interface FactorsFile {
  readonly computed_at: string;
  readonly universe_size: number;
  readonly factors: FactorUniverse;
}

interface SectorMap {
  readonly [ticker: string]: string | undefined;
}

interface NameMap {
  readonly [ticker: string]: string | undefined;
}

export interface WizardProps {
  readonly isLight: boolean;
  readonly sectors: SectorMap;
  readonly names?: NameMap;
  readonly onApply: (tickers: string[]) => void;
  readonly onClose: () => void;
}

export function GoalWizard({ isLight, sectors, names, onApply, onClose }: WizardProps) {
  const [factorsFile, setFactorsFile] = useState<FactorsFile | null>(null);
  const [factorsError, setFactorsError] = useState<string | null>(null);
  const [preset, setPreset] = useState<GoalPreset>('balanced');
  const [horizon, setHorizon] = useState<Horizon>('3y');
  const [size, setSize] = useState<8 | 12 | 16>(12);
  const [acked, setAcked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(ACK_KEY) === 'true';
  });
  const [ackChecked, setAckChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/india/factors.json')
      .then((r) => {
        if (!r.ok) throw new Error(`factors.json HTTP ${r.status}`);
        return r.json();
      })
      .then((d: FactorsFile) => {
        if (!cancelled) setFactorsFile(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setFactorsError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const picks = useMemo<string[]>(() => {
    if (!factorsFile) return [];
    const weights = getPresetWeights(preset);
    const scores = compositeScore(factorsFile.factors, weights);
    return selectTopN(scores, sectors, size, 3);
  }, [factorsFile, preset, size, sectors]);

  const driversByTicker = useMemo<Record<string, Array<{ factor: FactorName; contribution: number; rawZ: number }>>>(() => {
    if (!factorsFile) return {};
    const weights = getPresetWeights(preset);
    const out: Record<string, Array<{ factor: FactorName; contribution: number; rawZ: number }>> = {};
    for (const t of picks) {
      out[t] = factorContributions(factorsFile.factors, weights, t).slice(0, 2);
    }
    return out;
  }, [factorsFile, preset, picks]);

  const panel = isLight ? 'bg-white border-gray-200 text-gray-900' : 'bg-zinc-900 border-zinc-800 text-zinc-100';
  const mutedText = isLight ? 'text-gray-500' : 'text-zinc-400';
  const chip = isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const btnPrimary = 'bg-indigo-600 hover:bg-indigo-500 text-white';
  const btnGhost = isLight
    ? 'border border-gray-300 hover:bg-gray-50 text-gray-700'
    : 'border border-zinc-700 hover:bg-zinc-800 text-zinc-300';

  function handleAcknowledge() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACK_KEY, 'true');
    }
    setAcked(true);
  }

  function handleApply() {
    if (picks.length === 0) return;
    onApply(picks);
    onClose();
  }

  if (!acked) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className={`max-w-lg w-full rounded-lg border p-6 ${panel}`}>
          <h2 className="text-lg font-semibold mb-2">Before you continue</h2>
          <p className={`text-sm leading-relaxed ${mutedText}`}>
            The picks below come from an optimizer ranking historical price patterns. They are <strong>not investment advice</strong>. You must validate each pick yourself before any trade. Past performance does not predict future results.
          </p>
          <label className="mt-4 flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ackChecked}
              onChange={(e) => setAckChecked(e.target.checked)}
            />
            <span>I understand these are research outputs, not advice.</span>
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button className={`px-3 py-1.5 rounded text-sm ${btnGhost}`} onClick={onClose}>
              Cancel
            </button>
            <button
              className={`px-3 py-1.5 rounded text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
              disabled={!ackChecked}
              onClick={handleAcknowledge}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className={`max-w-3xl w-full rounded-lg border p-6 ${panel} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Goal-based portfolio wizard</h2>
            <p className={`text-xs ${mutedText}`}>
              Pick a goal, horizon, and size. We rank 204 NSE F&amp;O names on 6 price factors and cap at 3 stocks per sector.
            </p>
          </div>
          <button className={`px-2 py-1 rounded text-sm ${btnGhost}`} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
          <div>
            <div className={`text-xs uppercase tracking-wide mb-1.5 ${mutedText}`}>Goal</div>
            <div className="flex flex-col gap-1.5">
              {listPresets().map((p) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={`text-left px-3 py-2 rounded border text-sm ${
                    preset === p ? 'border-indigo-500 bg-indigo-500/10' : chip
                  }`}
                >
                  <div className="font-medium">{PRESET_LABELS[p]}</div>
                  <div className={`text-[11px] ${mutedText}`}>{PRESET_DESCRIPTIONS[p]}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className={`text-xs uppercase tracking-wide mb-1.5 ${mutedText}`}>Horizon</div>
            <div className="flex gap-1.5">
              {(['1y', '3y', '5y'] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={`flex-1 px-3 py-2 rounded border text-sm ${
                    horizon === h ? 'border-indigo-500 bg-indigo-500/10' : chip
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
            <div className={`text-[11px] mt-1.5 ${mutedText}`}>
              Shapes the backtest window after you apply picks.
            </div>

            <div className={`text-xs uppercase tracking-wide mt-4 mb-1.5 ${mutedText}`}>Size</div>
            <div className="flex gap-1.5">
              {([8, 12, 16] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setSize(n)}
                  className={`flex-1 px-3 py-2 rounded border text-sm ${
                    size === n ? 'border-indigo-500 bg-indigo-500/10' : chip
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className={`text-xs uppercase tracking-wide mb-1.5 ${mutedText}`}>Status</div>
            {factorsError && (
              <div className="text-sm text-red-500">Failed to load factors: {factorsError}</div>
            )}
            {!factorsError && !factorsFile && (
              <div className={`text-sm ${mutedText}`}>Loading factor scores...</div>
            )}
            {factorsFile && (
              <div className={`text-xs ${mutedText} space-y-0.5`}>
                <div>Universe: {factorsFile.universe_size}</div>
                <div>Computed: {factorsFile.computed_at}</div>
                <div>Sector cap: 3 per GICS sector</div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Picks ({picks.length})</div>
            <button
              className={`px-3 py-1.5 rounded text-sm ${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
              disabled={picks.length === 0}
              onClick={handleApply}
            >
              Add to portfolio
            </button>
          </div>
          {!factorsFile && !factorsError && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
              {Array.from({ length: size }).map((_, i) => (
                <div
                  key={i}
                  className={`rounded border px-2.5 py-1.5 ${chip} animate-pulse`}
                >
                  <div className={`h-3 w-16 rounded ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} mb-1`} />
                  <div className={`h-2 w-24 rounded ${isLight ? 'bg-gray-200' : 'bg-zinc-700'} mb-1`} />
                  <div className={`h-2 w-12 rounded ${isLight ? 'bg-gray-200' : 'bg-zinc-700'}`} />
                </div>
              ))}
            </div>
          )}
          {factorsError && (
            <div className="py-4 text-center text-sm text-red-500">
              Could not load factor scores: {factorsError}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
            {picks.map((t) => {
              const drivers = driversByTicker[t] ?? [];
              return (
                <div key={t} className={`rounded border px-2.5 py-1.5 text-sm ${chip}`}>
                  <div className="font-medium">{t}</div>
                  {names?.[t] && <div className={`text-[10px] truncate ${mutedText}`}>{names[t]}</div>}
                  {sectors[t] && <div className={`text-[10px] ${mutedText}`}>{sectors[t]}</div>}
                  {drivers.length > 0 && (
                    <div className={`text-[10px] mt-0.5 ${mutedText}`}>
                      {drivers
                        .map((d) => `${FACTOR_LABELS[d.factor]} ${d.rawZ >= 0 ? '▲' : '▼'}`)
                        .join(' • ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
