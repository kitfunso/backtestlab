'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { BacktestResult } from '@/lib/india/types';
import { formatINR, formatINRFull, formatPct } from '@/lib/india/format';
import { downloadCSV } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResultTab = 'performance' | 'metrics' | 'monthly' | 'trades' | 'distribution';

interface ResultsPanelProps {
  result: BacktestResult | null;
  isLoading: boolean;
  error: string | null;
  isLight: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResultsPanel({ result, isLoading, error, isLight }: ResultsPanelProps) {
  const [tab, setTab] = useState<ResultTab>('performance');

  const textSecondary = isLight ? 'text-gray-500' : 'text-zinc-400';
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';

  if (error) {
    return (
      <div className={cn('flex items-center justify-center h-full text-sm', 'text-[#EF4444]')}>
        {error}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={cn('flex items-center justify-center h-full text-sm', textSecondary)}>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-[#FF9933] border-t-transparent rounded-full animate-spin" />
          Running backtest...
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className={cn('flex items-center justify-center h-full text-sm', textMuted)}>
        Configure a strategy to see results.
      </div>
    );
  }

  const TABS: { key: ResultTab; label: string }[] = [
    { key: 'performance', label: 'Performance' },
    { key: 'metrics', label: 'Metrics' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'trades', label: 'Trades' },
    { key: 'distribution', label: 'Distribution' },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-3 py-1 rounded-md text-[11px] font-medium border transition-all',
              tab === t.key
                ? 'bg-[#FF9933]/15 border-[#FF9933]/30 text-[#FF9933]'
                : isLight
                  ? 'bg-transparent border-transparent text-gray-500 hover:text-gray-700'
                  : 'bg-transparent border-transparent text-zinc-500 hover:text-zinc-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'performance' && <PerformanceTab result={result} isLight={isLight} />}
      {tab === 'metrics' && <MetricsTab result={result} isLight={isLight} />}
      {tab === 'monthly' && <MonthlyTab result={result} isLight={isLight} />}
      {tab === 'trades' && <TradesTab result={result} isLight={isLight} />}
      {tab === 'distribution' && <DistributionTab result={result} isLight={isLight} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Performance Tab
// ---------------------------------------------------------------------------

function PerformanceTab({ result, isLight }: { result: BacktestResult; isLight: boolean }) {
  const equityData = useMemo(() => {
    return result.equity_curve.dates.map((date, i) => ({
      date,
      equity: result.equity_curve.cumulative[i],
      drawdown: result.drawdown.values[i],
    }));
  }, [result]);

  const gridColor = isLight ? '#e5e7eb' : 'rgba(255,255,255,0.06)';
  const tooltipBg = isLight ? '#ffffff' : '#18181b';
  const tooltipBorder = isLight ? '#e5e7eb' : '#3f3f46';

  return (
    <div className="space-y-4">
      {/* Equity Curve */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={cn('text-xs font-semibold font-[DM_Sans]', isLight ? 'text-gray-500' : 'text-zinc-500')}>
            Equity Curve
          </span>
          <span className="font-mono text-xs text-[#22C55E]">
            {formatINR(result.metrics.total_pnl)}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={equityData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22C55E" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22C55E" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: isLight ? '#9ca3af' : '#71717a' }}
              tickFormatter={(d: string) => d.slice(0, 7)}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: isLight ? '#9ca3af' : '#71717a' }}
              tickFormatter={(v: number) => formatINR(v)}
              width={70}
            />
            <Tooltip
              contentStyle={{
                background: tooltipBg,
                border: `1px solid ${tooltipBorder}`,
                borderRadius: 8,
                fontSize: 11,
              }}
              labelStyle={{ color: isLight ? '#374151' : '#d4d4d8' }}
              formatter={(value: number) => [formatINRFull(value), 'P&L']}
            />
            <ReferenceLine y={0} stroke={isLight ? '#d1d5db' : '#3f3f46'} strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#22C55E"
              fill="url(#equityGrad)"
              strokeWidth={1.5}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Drawdown */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={cn('text-xs font-semibold font-[DM_Sans]', isLight ? 'text-gray-500' : 'text-zinc-500')}>
            Drawdown
          </span>
          <span className="font-mono text-xs text-[#EF4444]">
            {formatPct(result.metrics.max_dd_pct)}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={equityData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity={0.02} />
                <stop offset="100%" stopColor="#EF4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: isLight ? '#9ca3af' : '#71717a' }}
              tickFormatter={(d: string) => d.slice(0, 7)}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={['dataMin', 0]}
              tick={{ fontSize: 10, fill: isLight ? '#9ca3af' : '#71717a' }}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={45}
            />
            <Tooltip
              contentStyle={{
                background: tooltipBg,
                border: `1px solid ${tooltipBorder}`,
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number) => [`${value.toFixed(2)}%`, 'Drawdown']}
            />
            <ReferenceLine y={0} stroke={isLight ? '#d1d5db' : '#3f3f46'} strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke="#EF4444"
              fill="url(#ddGrad)"
              strokeWidth={1.5}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Key metrics inline */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 mt-3">
        {[
          { label: 'Sharpe', value: result.metrics.sharpe.toFixed(2), color: '#FF9933' },
          { label: 'Sortino', value: result.metrics.sortino.toFixed(2), color: '#FF9933' },
          { label: 'Win Rate', value: `${result.metrics.win_rate_pct.toFixed(0)}%`, color: result.metrics.win_rate_pct >= 50 ? '#22C55E' : '#EF4444' },
          { label: 'Profit Factor', value: result.metrics.profit_factor === Infinity ? '∞' : result.metrics.profit_factor.toFixed(2), color: result.metrics.profit_factor >= 1 ? '#22C55E' : '#EF4444' },
          { label: 'Max DD', value: formatPct(result.metrics.max_dd_pct), color: '#EF4444' },
          { label: 'Trades', value: String(result.metrics.num_trades), color: isLight ? '#374151' : '#d4d4d8' },
          { label: 'Avg Hold', value: `${result.metrics.avg_hold_days.toFixed(0)}d`, color: isLight ? '#374151' : '#d4d4d8' },
        ].map((m) => (
          <div
            key={m.label}
            className={cn(
              'rounded-md border px-2 py-1.5 text-center',
              isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700',
            )}
          >
            <div className={cn('text-[8px] uppercase tracking-wider', isLight ? 'text-gray-400' : 'text-zinc-500')}>{m.label}</div>
            <div className="text-xs font-mono font-bold" style={{ color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metrics Tab
// ---------------------------------------------------------------------------

function MetricsTab({ result, isLight }: { result: BacktestResult; isLight: boolean }) {
  const m = result.metrics;

  const cards: { label: string; value: string; color: 'positive' | 'negative' | 'accent' | 'neutral' }[] = [
    { label: 'Sharpe Ratio', value: m.sharpe.toFixed(2), color: m.sharpe >= 0 ? 'accent' : 'negative' },
    { label: 'Sortino Ratio', value: m.sortino.toFixed(2), color: m.sortino >= 0 ? 'accent' : 'negative' },
    { label: 'Calmar Ratio', value: m.calmar.toFixed(2), color: m.calmar >= 0 ? 'accent' : 'negative' },
    { label: 'Total P&L', value: formatINR(m.total_pnl), color: m.total_pnl >= 0 ? 'positive' : 'negative' },
    { label: 'Max Drawdown', value: formatPct(m.max_dd_pct), color: 'negative' },
    { label: 'Max DD (INR)', value: formatINR(m.max_dd_inr), color: 'negative' },
    { label: 'Win Rate', value: `${m.win_rate_pct.toFixed(1)}%`, color: m.win_rate_pct >= 50 ? 'positive' : 'neutral' },
    { label: 'Profit Factor', value: m.profit_factor === Infinity ? '∞' : m.profit_factor.toFixed(2), color: m.profit_factor >= 1 ? 'positive' : 'negative' },
    { label: 'Total Trades', value: `${m.num_trades}`, color: 'neutral' },
    { label: 'Avg Hold Days', value: `${m.avg_hold_days.toFixed(1)}`, color: 'neutral' },
    { label: 'Avg Trade P&L', value: formatINR(m.avg_trade_pnl), color: m.avg_trade_pnl >= 0 ? 'positive' : 'negative' },
    { label: 'Best Trade', value: formatINR(m.best_trade), color: 'positive' },
    { label: 'Worst Trade', value: formatINR(m.worst_trade), color: 'negative' },
    { label: 'Payoff Ratio', value: m.payoff_ratio.toFixed(2), color: m.payoff_ratio >= 1 ? 'positive' : 'neutral' },
    { label: 'Consec Wins', value: `${m.max_consec_wins}`, color: 'neutral' },
    { label: 'Consec Losses', value: `${m.max_consec_losses}`, color: 'neutral' },
    { label: 'Annual Return', value: formatPct(m.annual_return_pct), color: m.annual_return_pct >= 0 ? 'positive' : 'negative' },
    { label: 'Total Return', value: formatPct(m.total_return_pct), color: m.total_return_pct >= 0 ? 'positive' : 'negative' },
  ];

  const colorMap = {
    positive: 'text-[#22C55E]',
    negative: 'text-[#EF4444]',
    accent: 'text-[#FF9933]',
    neutral: isLight ? 'text-gray-700' : 'text-zinc-300',
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn(
            'rounded-lg border p-2.5',
            isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700',
          )}
        >
          <div className={cn('text-[10px] uppercase tracking-wider mb-0.5', isLight ? 'text-gray-400' : 'text-zinc-500')}>
            {c.label}
          </div>
          <div className={cn('font-mono text-base font-semibold', colorMap[c.color])}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly Tab
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function MonthlyTab({ result, isLight }: { result: BacktestResult; isLight: boolean }) {
  const years = useMemo(() => {
    const yearSet = new Set(result.monthly.map((m) => m.year));
    return Array.from(yearSet).sort();
  }, [result.monthly]);

  const monthlyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of result.monthly) {
      map.set(`${m.year}-${m.month}`, m.pnl);
    }
    return map;
  }, [result.monthly]);

  function cellColor(value: number | undefined): string {
    if (value === undefined) return isLight ? 'bg-gray-100 text-gray-400' : 'bg-zinc-700 text-zinc-500';
    if (value >= 100000) return 'bg-emerald-600 text-white';
    if (value >= 50000) return 'bg-emerald-500 text-white';
    if (value >= 10000) return 'bg-emerald-500/60 text-emerald-100';
    if (value >= 0) return 'bg-emerald-500/30 text-emerald-200';
    if (value >= -10000) return 'bg-rose-500/30 text-rose-200';
    if (value >= -50000) return 'bg-rose-500/60 text-rose-100';
    return 'bg-rose-600 text-white';
  }

  // Yearly bar data
  const yearlyData = useMemo(() => {
    return result.yearly.map((y) => ({ year: y.year.toString(), pnl: y.pnl }));
  }, [result.yearly]);

  const gridColor = isLight ? '#e5e7eb' : 'rgba(255,255,255,0.06)';

  return (
    <div className="space-y-6">
      {/* Heatmap */}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr>
              <th className={cn('px-1 py-1 text-left', isLight ? 'text-gray-400' : 'text-zinc-500')}>Year</th>
              {MONTHS.map((m) => (
                <th key={m} className={cn('px-1 py-1 text-center', isLight ? 'text-gray-400' : 'text-zinc-500')}>
                  {m}
                </th>
              ))}
              <th className={cn('px-1 py-1 text-center font-bold', isLight ? 'text-gray-500' : 'text-zinc-400')}>
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const yearTotal = result.yearly.find((y) => y.year === year)?.pnl ?? 0;
              return (
                <tr key={year}>
                  <td className={cn('px-1 py-0.5 font-medium', isLight ? 'text-gray-600' : 'text-zinc-300')}>
                    {year}
                  </td>
                  {MONTHS.map((_, mi) => {
                    const val = monthlyMap.get(`${year}-${mi + 1}`);
                    return (
                      <td key={mi} className={cn('px-0.5 py-0.5')}>
                        <div
                          className={cn(
                            'rounded px-1 py-0.5 text-center tabular-nums',
                            cellColor(val),
                          )}
                        >
                          {val !== undefined ? formatINR(val) : ''}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-0.5 py-0.5">
                    <div
                      className={cn(
                        'rounded px-1 py-0.5 text-center font-bold tabular-nums',
                        cellColor(yearTotal),
                      )}
                    >
                      {formatINR(yearTotal)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Yearly bar chart */}
      <div>
        <span className={cn('text-xs font-semibold font-[DM_Sans] mb-2 block', isLight ? 'text-gray-500' : 'text-zinc-500')}>
          Annual P&L
        </span>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={yearlyData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
            <XAxis dataKey="year" tick={{ fontSize: 10, fill: isLight ? '#9ca3af' : '#71717a' }} />
            <YAxis
              tick={{ fontSize: 10, fill: isLight ? '#9ca3af' : '#71717a' }}
              tickFormatter={(v: number) => formatINR(v)}
              width={60}
            />
            <Tooltip
              contentStyle={{
                background: isLight ? '#ffffff' : '#18181b',
                border: `1px solid ${isLight ? '#e5e7eb' : '#3f3f46'}`,
                borderRadius: 8,
                fontSize: 11,
              }}
              formatter={(value: number) => [formatINRFull(value), 'P&L']}
            />
            <ReferenceLine y={0} stroke={isLight ? '#d1d5db' : '#3f3f46'} />
            <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
              {yearlyData.map((entry, i) => (
                <Cell key={i} fill={entry.pnl >= 0 ? '#22C55E' : '#EF4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trades Tab
// ---------------------------------------------------------------------------

function TradesTab({ result, isLight }: { result: BacktestResult; isLight: boolean }) {
  const handleExport = () => {
    const data = result.trades.map((t, i) => ({
      '#': i + 1,
      entry_date: t.entry_date,
      exit_date: t.exit_date,
      direction: t.direction.toUpperCase(),
      lots: t.lots,
      entry_price: t.entry_price.toFixed(2),
      exit_price: t.exit_price.toFixed(2),
      pnl: t.pnl.toFixed(2),
      duration_days: t.duration_days,
    }));
    downloadCSV(data, 'trades.csv');
  };

  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className={cn('text-xs font-semibold font-[DM_Sans]', isLight ? 'text-gray-500' : 'text-zinc-500')}>
          Trade Log ({result.trades.length} trades)
        </span>
        <button
          onClick={handleExport}
          className={cn(
            'text-[11px] px-2 py-1 rounded border transition-colors',
            isLight
              ? 'border-gray-200 text-gray-600 hover:border-[#FF9933] hover:text-[#FF9933]'
              : 'border-zinc-700 text-zinc-400 hover:border-[#FF9933] hover:text-[#FF9933]',
          )}
        >
          Export CSV
        </button>
      </div>

      <div className="max-h-[400px] overflow-y-auto rounded-lg border">
        <table className={cn('w-full text-[11px] font-mono', isLight ? 'border-gray-200' : 'border-zinc-700')}>
          <thead>
            <tr
              className={cn(
                'text-[10px] uppercase tracking-wider sticky top-0',
                isLight ? 'bg-gray-50 text-gray-400' : 'bg-zinc-800 text-zinc-500',
              )}
            >
              <th className="px-2 py-1.5 text-left">#</th>
              <th className="px-2 py-1.5 text-left">Entry</th>
              <th className="px-2 py-1.5 text-left">Exit</th>
              <th className="px-2 py-1.5 text-center">Dir</th>
              <th className="px-2 py-1.5 text-right">Lots</th>
              <th className="px-2 py-1.5 text-right">Entry ₹</th>
              <th className="px-2 py-1.5 text-right">Exit ₹</th>
              <th className="px-2 py-1.5 text-right">P&L</th>
              <th className="px-2 py-1.5 text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {result.trades.map((t, i) => (
              <tr
                key={i}
                className={cn(
                  'border-t transition-colors',
                  isLight
                    ? 'border-gray-100 hover:bg-gray-50'
                    : 'border-zinc-800/50 hover:bg-zinc-800/30',
                )}
              >
                <td className={cn('px-2 py-1.5', textMuted)}>{i + 1}</td>
                <td className={cn('px-2 py-1.5', isLight ? 'text-gray-700' : 'text-zinc-300')}>
                  {t.entry_date}
                </td>
                <td className={cn('px-2 py-1.5', isLight ? 'text-gray-700' : 'text-zinc-300')}>
                  {t.exit_date}
                </td>
                <td
                  className={cn(
                    'px-2 py-1.5 text-center font-medium uppercase',
                    t.direction === 'long' ? 'text-[#22C55E]' : 'text-[#EF4444]',
                  )}
                >
                  {t.direction === 'long' ? 'L' : 'S'}
                </td>
                <td className={cn('px-2 py-1.5 text-right', isLight ? 'text-gray-700' : 'text-zinc-300')}>
                  {t.lots}
                </td>
                <td className={cn('px-2 py-1.5 text-right tabular-nums', isLight ? 'text-gray-700' : 'text-zinc-300')}>
                  {t.entry_price.toFixed(2)}
                </td>
                <td className={cn('px-2 py-1.5 text-right tabular-nums', isLight ? 'text-gray-700' : 'text-zinc-300')}>
                  {t.exit_price.toFixed(2)}
                </td>
                <td
                  className={cn(
                    'px-2 py-1.5 text-right tabular-nums font-medium',
                    t.pnl >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]',
                  )}
                >
                  {formatINR(t.pnl)}
                </td>
                <td className={cn('px-2 py-1.5 text-right', textMuted)}>{t.duration_days}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {result.trades.length === 0 && (
          <div className={cn('px-4 py-8 text-center text-xs', textMuted)}>
            No trades generated.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribution Tab
// ---------------------------------------------------------------------------

function DistributionTab({ result, isLight }: { result: BacktestResult; isLight: boolean }) {
  const histData = useMemo(() => {
    if (result.trades.length === 0) return [];

    const pnls = result.trades.map((t) => t.pnl);
    const min = Math.min(...pnls);
    const max = Math.max(...pnls);
    const range = max - min;
    if (range === 0) return [{ bucket: '0', count: pnls.length, midpoint: 0 }];

    const numBuckets = Math.min(20, Math.max(5, Math.floor(Math.sqrt(pnls.length))));
    const bucketSize = range / numBuckets;

    const buckets = Array.from({ length: numBuckets }, (_, i) => ({
      lower: min + i * bucketSize,
      upper: min + (i + 1) * bucketSize,
      count: 0,
    }));

    for (const pnl of pnls) {
      const idx = Math.min(Math.floor((pnl - min) / bucketSize), numBuckets - 1);
      buckets[idx].count++;
    }

    return buckets.map((b) => ({
      bucket: formatINR((b.lower + b.upper) / 2),
      count: b.count,
      midpoint: (b.lower + b.upper) / 2,
    }));
  }, [result.trades]);

  const wins = result.trades.filter((t) => t.pnl >= 0);
  const losses = result.trades.filter((t) => t.pnl < 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

  const gridColor = isLight ? '#e5e7eb' : 'rgba(255,255,255,0.06)';
  const textMuted = isLight ? 'text-gray-400' : 'text-zinc-500';

  return (
    <div className="space-y-4">
      {/* Histogram */}
      <div>
        <span className={cn('text-xs font-semibold font-[DM_Sans] mb-2 block', isLight ? 'text-gray-500' : 'text-zinc-500')}>
          Trade P&L Distribution
        </span>
        {histData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={histData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 9, fill: isLight ? '#9ca3af' : '#71717a' }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10, fill: isLight ? '#9ca3af' : '#71717a' }} />
              <Tooltip
                contentStyle={{
                  background: isLight ? '#ffffff' : '#18181b',
                  border: `1px solid ${isLight ? '#e5e7eb' : '#3f3f46'}`,
                  borderRadius: 8,
                  fontSize: 11,
                }}
              />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                {histData.map((entry, i) => (
                  <Cell key={i} fill={entry.midpoint >= 0 ? '#22C55E' : '#EF4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className={cn('text-center py-8 text-xs', textMuted)}>No trades to display.</div>
        )}
      </div>

      {/* Win/Loss summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Wins" value={`${wins.length}`} color="text-[#22C55E]" isLight={isLight} />
        <StatCard label="Losses" value={`${losses.length}`} color="text-[#EF4444]" isLight={isLight} />
        <StatCard label="Avg Win" value={formatINR(avgWin)} color="text-[#22C55E]" isLight={isLight} />
        <StatCard label="Avg Loss" value={formatINR(avgLoss)} color="text-[#EF4444]" isLight={isLight} />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  isLight,
}: {
  label: string;
  value: string;
  color: string;
  isLight: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-2.5',
        isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700',
      )}
    >
      <div className={cn('text-[10px] uppercase tracking-wider mb-0.5', isLight ? 'text-gray-400' : 'text-zinc-500')}>
        {label}
      </div>
      <div className={cn('font-mono text-sm font-semibold', color)}>{value}</div>
    </div>
  );
}
