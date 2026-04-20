'use client';

import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  simulateLumpSum,
  simulateDCA,
  annualizedReturn,
  type DCAFrequency,
} from '@/lib/portfolio/dca';

export interface DCAPanelProps {
  readonly equityCurve: readonly number[];
  readonly dates: readonly string[];
  readonly capital: number;
  readonly isLight: boolean;
}

type Mode = 'lump' | 'weekly' | 'monthly';

const MODE_LABELS: Record<Mode, string> = {
  lump: 'Lump-sum',
  weekly: 'DCA (weekly)',
  monthly: 'DCA (monthly)',
};

function fmtRupees(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(1)} L`;
  return `₹${Math.round(v).toLocaleString('en-IN')}`;
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

export function DCAPanel({ equityCurve, dates, capital, isLight }: DCAPanelProps) {
  const [mode, setMode] = useState<Mode>('lump');

  const results = useMemo(() => {
    if (equityCurve.length === 0) return null;
    const arr = Array.from(equityCurve);
    const d = Array.from(dates);
    const lump = simulateLumpSum(arr, d, capital);
    const dcaMonthly = simulateDCA(arr, d, capital, 'monthly' as DCAFrequency);
    const dcaWeekly = simulateDCA(arr, d, capital, 'weekly' as DCAFrequency);
    return { lump, dcaMonthly, dcaWeekly };
  }, [equityCurve, dates, capital]);

  const chartData = useMemo(() => {
    if (!results) return [];
    return dates.map((date, i) => ({
      date,
      lump: results.lump.values[i],
      weekly: results.dcaWeekly.values[i],
      monthly: results.dcaMonthly.values[i],
    }));
  }, [results, dates]);

  if (!results) {
    return null;
  }

  const { lump, dcaMonthly, dcaWeekly } = results;
  const terminalLump = lump.values[lump.values.length - 1];
  const terminalMonthly = dcaMonthly.values[dcaMonthly.values.length - 1];
  const terminalWeekly = dcaWeekly.values[dcaWeekly.values.length - 1];
  const tradingDays = equityCurve.length;

  const annLump = annualizedReturn(terminalLump, lump.totalInvested, tradingDays);
  const annMonthly = annualizedReturn(terminalMonthly, dcaMonthly.totalInvested, tradingDays);
  const annWeekly = annualizedReturn(terminalWeekly, dcaWeekly.totalInvested, tradingDays);

  const cardBg = isLight ? 'bg-white border-gray-200' : 'bg-zinc-900/30 border-zinc-800';
  const chipBg = isLight ? 'bg-gray-50 border-gray-200' : 'bg-zinc-800/50 border-zinc-700';
  const textMuted = isLight ? 'text-gray-500' : 'text-zinc-400';
  const axisStroke = isLight ? '#d1d5db' : '#3f3f46';
  const axisTick = isLight ? '#6b7280' : '#a1a1aa';
  const tooltipBg = isLight ? '#ffffff' : '#18181b';

  const activeLine: Record<Mode, string> = {
    lump: '#2563eb',
    weekly: '#16a34a',
    monthly: '#f59e0b',
  };

  return (
    <div className={`rounded-xl border p-4 ${cardBg}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className={`text-[10px] uppercase tracking-wider font-semibold ${textMuted}`}>
            Entry method
          </div>
          <div className={`text-sm font-medium ${isLight ? 'text-gray-900' : 'text-zinc-100'}`}>
            Lump-sum vs DCA on {fmtRupees(capital)} starting capital
          </div>
        </div>
        <div className="flex gap-1">
          {(['lump', 'weekly', 'monthly'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-1 rounded text-[11px] border ${
                mode === m
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : isLight
                    ? 'border-gray-200 hover:border-gray-300 text-gray-700'
                    : 'border-zinc-700 hover:border-zinc-500 text-zinc-300'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <Summary label="Lump-sum" value={terminalLump} ann={annLump} invested={lump.totalInvested} color={activeLine.lump} chip={chipBg} muted={textMuted} />
        <Summary label="DCA weekly" value={terminalWeekly} ann={annWeekly} invested={dcaWeekly.totalInvested} color={activeLine.weekly} chip={chipBg} muted={textMuted} />
        <Summary label="DCA monthly" value={terminalMonthly} ann={annMonthly} invested={dcaMonthly.totalInvested} color={activeLine.monthly} chip={chipBg} muted={textMuted} />
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke={axisStroke} opacity={0.3} />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: axisTick }} stroke={axisStroke} minTickGap={60} />
          <YAxis tick={{ fontSize: 9, fill: axisTick }} stroke={axisStroke} tickFormatter={fmtRupees} />
          <Tooltip
            contentStyle={{ backgroundColor: tooltipBg, border: `1px solid ${axisStroke}`, fontSize: 11 }}
            formatter={(v: number) => fmtRupees(v)}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="lump" name="Lump-sum" stroke={activeLine.lump} strokeWidth={mode === 'lump' ? 2.5 : 1} dot={false} opacity={mode === 'lump' ? 1 : 0.4} />
          <Line type="monotone" dataKey="weekly" name="DCA weekly" stroke={activeLine.weekly} strokeWidth={mode === 'weekly' ? 2.5 : 1} dot={false} opacity={mode === 'weekly' ? 1 : 0.4} />
          <Line type="monotone" dataKey="monthly" name="DCA monthly" stroke={activeLine.monthly} strokeWidth={mode === 'monthly' ? 2.5 : 1} dot={false} opacity={mode === 'monthly' ? 1 : 0.4} />
        </LineChart>
      </ResponsiveContainer>

      <div className={`text-[10px] mt-2 ${textMuted}`}>
        Simulation on the portfolio&apos;s historical equity curve. For educational purposes only — not investment advice.
      </div>
    </div>
  );
}

function Summary({
  label, value, ann, invested, color, chip, muted,
}: {
  label: string; value: number; ann: number; invested: number; color: string; chip: string; muted: string;
}) {
  return (
    <div className={`rounded-lg border p-2 ${chip}`}>
      <div className={`text-[9px] uppercase tracking-wider ${muted}`}>{label}</div>
      <div className="text-sm font-mono font-bold" style={{ color }}>{fmtRupees(value)}</div>
      <div className={`text-[10px] ${muted}`}>
        {fmtPct(ann)}/yr on {fmtRupees(invested)} invested
      </div>
    </div>
  );
}
