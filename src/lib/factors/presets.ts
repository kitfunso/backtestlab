import type { FactorName } from './score';

export type GoalPreset = 'growth' | 'balanced' | 'defensive' | 'contrarian';

export type FactorWeights = Partial<Record<FactorName, number>>;

const PRESETS: Record<GoalPreset, FactorWeights> = {
  growth: {
    mom12_1: 0.40,
    mom6_1: 0.20,
    low_vol: 0.10,
    short_rev: 0.00,
    low_beta: 0.10,
    low_disp: 0.20,
  },
  balanced: {
    mom12_1: 0.20,
    mom6_1: 0.15,
    low_vol: 0.25,
    short_rev: 0.00,
    low_beta: 0.25,
    low_disp: 0.15,
  },
  defensive: {
    mom12_1: 0.05,
    mom6_1: 0.05,
    low_vol: 0.35,
    short_rev: 0.10,
    low_beta: 0.35,
    low_disp: 0.10,
  },
  contrarian: {
    mom12_1: -0.20,
    mom6_1: -0.10,
    low_vol: 0.20,
    short_rev: 0.40,
    low_beta: 0.10,
    low_disp: 0.20,
  },
};

export const PRESET_LABELS: Record<GoalPreset, string> = {
  growth: 'Growth',
  balanced: 'Balanced',
  defensive: 'Defensive',
  contrarian: 'Contrarian',
};

export const PRESET_DESCRIPTIONS: Record<GoalPreset, string> = {
  growth: 'Lean into winners. Loads up on 12-1 momentum with a dispersion tilt.',
  balanced: 'Half momentum, half quality. Moderate exposure to low-vol and low-beta.',
  defensive: 'Minimize drawdowns. Heavy low-vol + low-beta, small momentum.',
  contrarian: 'Fade the crowd. Negative momentum load, strong short-reversal tilt.',
};

export function getPresetWeights(preset: GoalPreset): FactorWeights {
  return { ...PRESETS[preset] };
}

export function listPresets(): GoalPreset[] {
  return Object.keys(PRESETS) as GoalPreset[];
}
