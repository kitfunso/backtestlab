'use client';

import { useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import {
  rollingSharpe, rollingVolatility, topDrawdowns, sortino, calmar,
  returnDistribution, annualizedVolatility, type DrawdownInfo,
} from '@/lib/portfolio/metrics';
import { diversificationRatio } from '@/lib/portfolio/diversification';

interface PortfolioMetricsPanelProps {
  readonly portfolioReturns: readonly number[];
  readonly portfolioEquityCurve: readonly number[];
  readonly dates: readonly string[];
  readonly perAssetReturns: readonly (readonly number[])[];
  readonly weights: readonly number[];
  readonly assetNames: readonly string[];
  readonly isLight: boolean;
}

const SQRT_252 = Math.sqrt(252);
const fmtPct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const fmtNum = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a), tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  return Math.round((tb - ta) / 86400000);
}

export function PortfolioMetricsPanel({
  portfolioReturns,
  portfolioEquityCurve,
  dates,
  perAssetReturns,
  weights,
  assetNames,
  isLight,
}: PortfolioMetricsPanelProps) {
  // All math comes from @/lib/portfolio — the component is presentation only.
  const annVol = useMemo(() => annualizedVolatility(portfolioReturns), [portfolioReturns]);
  const sortinoRatio = useMemo(() => sortino(portfolioReturns), [portfolioReturns]);
  const calmarRatio = useMemo(() => calmar(portfolioReturns, portfolioEquityCurve), [portfolioReturns, portfolioEquityCurve]);
  const rollSharpe = useMemo(() => rollingSharpe(portfolioReturns), [portfolioReturns]);
  const rollVol = useMemo(() => rollingVolatility(portfolioReturns), [portfolioReturns]);
  const drawdowns = useMemo(() => topDrawdowns(portfolioEquityCurve, dates, 5), [portfolioEquityCurve, dates]);
  const distribution = useMemo(() => returnDistribution(portfolioReturns, 30), [portfolioReturns]);
  const divRatio = useMemo(() => {
    if (perAssetReturns.length === 0 || weights.length === 0) return 0;
    try { return diversificationRatio(perAssetReturns, weights); } catch { return 0; }
  }, [perAssetReturns, weights]);

  // Full-sample annualized Sharpe derived from the full-sample annVol.
  const sharpeRatio = useMemo(() => {
    const n = portfolioReturns.length;
    if (n < 2 || annVol === 0) return 0;
    let sum = 0;
    for (const r of portfolioReturns) sum += r;
    return (((sum / n) - 0.06 / 252) / (annVol / SQRT_252)) * SQRT_252;
  }, [portfolioReturns, annVol]);

  const maxDdPct = useMemo(
    () => (drawdowns.length === 0 ? 0 : Math.max(...drawdowns.map((d) => d.drawdownPct))),
    [drawdowns],
  );

  // Drop leading nulls so chart starts at the first real rolling point.
  const rollingChartData = useMemo(() => {
    const out: { date: string; sharpe: number | null; vol: number | null }[] = [];
    let started = false;
    for (let i = 0; i < dates.length; i++) {
      const s = rollSharpe[i], v = rollVol[i];
      if (!started && s === null && v === null) continue;
      started = true;
      out.push({ date: dates[i], sharpe: s, vol: v });
    }
    return out;
  }, [dates, rollSharpe, rollVol]);

  const histData = useMemo(
    () => distribution.map((b) => ({ mid: (b.bucketMin + b.bucketMax) / 2, count: b.count })),
    [distribution],
  );

  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800';
  const chipBg = isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textMuted = isLight ? 'text-gray-500' : 'text-zinc-400';
  const textStrong = isLight ? 'text-gray-900' : 'text-zinc-100';
  const gridStroke = isLight ? '#e5e7eb' : '#27272a';
  const axisStroke = isLight ? '#d1d5db' : '#3f3f46';
  const axisTick = isLight ? '#6b7280' : '#71717a';
  const tooltipStyle = { fontSize: 11, backgroundColor: isLight ? '#fff' : '#18181b', border: `1px solid ${gridStroke}` };

  if (portfolioReturns.length === 0 || dates.length === 0) {
    return (
      <div className={cn('rounded-xl border p-4 text-center text-sm', cardBg, textMuted)}>
        Not enough price history to compute portfolio metrics.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className={cn('rounded-xl border p-3', cardBg)}>
        <div className={cn('text-[10px] uppercase tracking-wider font-semibold mb-2', textMuted)}>
          Portfolio Metrics (Historical)
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ['Sharpe', fmtNum(sharpeRatio), '#06B6D4'],
            ['Sortino', fmtNum(sortinoRatio), '#06B6D4'],
            ['Calmar', fmtNum(calmarRatio), '#06B6D4'],
            ['Ann. Vol', fmtPct(annVol), '#FF9933'],
            ['Max Drawdown', fmtPct(maxDdPct), '#EF4444'],
            ['Div. Ratio', fmtNum(divRatio), '#22C55E'],
            ['Assets', String(assetNames.length), '#FF9933'],
          ] as const).map(([label, value, accent]) => (
            <div key={label} className={cn('rounded-lg border px-2.5 py-1.5 min-w-[92px]', chipBg)}>
              <div className={cn('text-[9px] uppercase tracking-wider', textMuted)}>{label}</div>
              <div className="text-sm font-mono font-bold" style={{ color: accent }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Rolling charts */}
      <div className={cn('rounded-xl border p-4', cardBg)}>
        <div className={cn('text-[10px] uppercase tracking-wider font-semibold mb-2', textMuted)}>
          Rolling 6-Month Sharpe & Volatility
        </div>
        {rollingChartData.length === 0 ? (
          <div className={cn('text-xs py-8 text-center', textMuted)}>
            Need at least 126 days of history for rolling metrics.
          </div>
        ) : (
          <>
            {([
              ['sharpe', '#06B6D4', 'Sharpe', (v: number) => v.toFixed(1), (v: number) => v.toFixed(2)],
              ['vol', '#FF9933', 'Volatility', (v: number) => `${(v * 100).toFixed(0)}%`, (v: number) => `${(v * 100).toFixed(1)}%`],
            ] as const).map(([key, color, name, yFmt, tipFmt]) => (
              <ResponsiveContainer key={key} width="100%" height={140}>
                <AreaChart data={rollingChartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: axisTick }} stroke={axisStroke} minTickGap={40} />
                  <YAxis tick={{ fontSize: 9, fill: axisTick }} stroke={axisStroke} tickFormatter={yFmt} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(v: number | string) => (typeof v === 'number' ? tipFmt(v) : '—')}
                  />
                  <Area type="monotone" dataKey={key} stroke={color} fill={color} fillOpacity={0.15} name={name} />
                </AreaChart>
              </ResponsiveContainer>
            ))}
          </>
        )}
      </div>

      {/* Top-5 drawdowns */}
      <div className={cn('rounded-xl border overflow-hidden', cardBg)}>
        <div className={cn('px-3 py-2 text-[10px] uppercase tracking-wider font-semibold border-b', textMuted, isLight ? 'border-gray-200' : 'border-zinc-800')}>
          Top 5 Drawdowns
        </div>
        {drawdowns.length === 0 ? (
          <div className={cn('px-3 py-4 text-xs text-center', textMuted)}>
            No drawdowns detected.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={cn(textMuted, isLight ? 'bg-gray-50' : 'bg-zinc-900/80')}>
                  {(['Peak', 'Trough', 'Recovery', 'Depth', 'Duration'] as const).map((h, i) => (
                    <th key={h} className={cn('px-3 py-1.5 font-semibold text-[9px] uppercase tracking-wider', i < 3 ? 'text-left' : 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drawdowns.map((dd: DrawdownInfo, i) => {
                  const isOngoing = dd.recoveryDate === null;
                  return (
                    <tr key={i} className={cn('border-t', isLight ? 'border-gray-100' : 'border-zinc-800/50')}>
                      <td className={cn('px-3 py-1.5 font-mono', textStrong)}>{dd.peakDate}</td>
                      <td className={cn('px-3 py-1.5 font-mono', textStrong)}>{dd.troughDate}</td>
                      <td className="px-3 py-1.5 font-mono">
                        {isOngoing ? (
                          <span className="inline-flex items-center gap-1">
                            <span className={textMuted}>—</span>
                            <span className="text-[9px] px-1 py-[1px] rounded bg-amber-500/15 text-amber-500 border border-amber-500/30">ongoing</span>
                          </span>
                        ) : (
                          <span className={textStrong}>{dd.recoveryDate}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-red-500">
                        -{fmtPct(dd.drawdownPct)}
                      </td>
                      <td className={cn('px-3 py-1.5 text-right font-mono', textMuted)}>
                        {isOngoing
                          ? `${daysBetween(dd.peakDate, dd.troughDate)}d+`
                          : `${daysBetween(dd.peakDate, dd.recoveryDate ?? dd.troughDate)}d`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Return distribution histogram */}
      <div className={cn('rounded-xl border p-4', cardBg)}>
        <div className={cn('text-[10px] uppercase tracking-wider font-semibold mb-2', textMuted)}>
          Daily Return Distribution
        </div>
        {histData.length === 0 ? (
          <div className={cn('text-xs py-4 text-center', textMuted)}>No data.</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={histData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis
                dataKey="mid"
                tick={{ fontSize: 9, fill: axisTick }}
                stroke={axisStroke}
                tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
              />
              <YAxis tick={{ fontSize: 9, fill: axisTick }} stroke={axisStroke} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v: number) => `${(v * 100).toFixed(2)}%`}
                formatter={(v: number) => [v, 'count']}
              />
              <Bar dataKey="count" fill="#FF9933" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Disclaimer footer */}
      <div className={cn('text-[10px] text-center px-2 pb-1', textMuted)}>
        Educational purposes only — not investment advice. Backtests use historical prices; past performance does not predict future results.
      </div>
    </div>
  );
}

