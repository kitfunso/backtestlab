import type { FactorName } from './score';

export type GoalPreset = 'growth' | 'balanced' | 'defensive' | 'contrarian' | 'value';

export type FactorWeights = Partial<Record<FactorName, number>>;

const PRESETS: Record<GoalPreset, FactorWeights> = {
  growth: {
    mom12_1: 0.30,
    mom6_1: 0.15,
    low_vol: 0.05,
    short_rev: 0.00,
    low_beta: 0.05,
    low_disp: 0.15,
    pe: 0.00,
    pb: 0.00,
    roe: 0.15,
    rev_growth: 0.15,
    de: 0.00,
  },
  balanced: {
    mom12_1: 0.15,
    mom6_1: 0.10,
    low_vol: 0.15,
    short_rev: 0.00,
    low_beta: 0.15,
    low_disp: 0.10,
    pe: 0.10,
    pb: 0.05,
    roe: 0.10,
    rev_growth: 0.05,
    de: 0.05,
  },
  defensive: {
    mom12_1: 0.05,
    mom6_1: 0.05,
    low_vol: 0.25,
    short_rev: 0.05,
    low_beta: 0.25,
    low_disp: 0.10,
    pe: 0.05,
    pb: 0.05,
    roe: 0.05,
    rev_growth: 0.00,
    de: 0.10,
  },
  contrarian: {
    mom12_1: -0.20,
    mom6_1: -0.10,
    low_vol: 0.10,
    short_rev: 0.30,
    low_beta: 0.05,
    low_disp: 0.10,
    pe: 0.15,
    pb: 0.05,
    roe: 0.00,
    rev_growth: 0.00,
    de: 0.05,
  },
  value: {
    mom12_1: 0.00,
    mom6_1: 0.00,
    low_vol: 0.05,
    short_rev: 0.00,
    low_beta: 0.05,
    low_disp: 0.05,
    pe: 0.30,
    pb: 0.20,
    roe: 0.15,
    rev_growth: 0.05,
    de: 0.15,
  },
};

export const PRESET_LABELS: Record<GoalPreset, string> = {
  growth: 'Growth',
  balanced: 'Balanced',
  defensive: 'Defensive',
  contrarian: 'Contrarian',
  value: 'Value',
};

export const PRESET_DESCRIPTIONS: Record<GoalPreset, string> = {
  growth: 'Winners with earnings behind them. Momentum + ROE + revenue growth.',
  balanced: 'Diversified tilt: some momentum, some quality, some value, low vol.',
  defensive: 'Minimize drawdowns. Heavy low-vol and low-beta, small value tilt.',
  contrarian: 'Fade the crowd. Negative momentum + short reversal + cheap valuations.',
  value: 'Cheap and financially sound. Low P/E, low P/B, strong ROE, low leverage.',
};

export function getPresetWeights(preset: GoalPreset): FactorWeights {
  return { ...PRESETS[preset] };
}

export function listPresets(): GoalPreset[] {
  return Object.keys(PRESETS) as GoalPreset[];
}
