import {
  getPresetWeights,
  listPresets,
  PRESET_LABELS,
  PRESET_DESCRIPTIONS,
} from './presets';

describe('presets metadata', () => {
  it('every preset has a label and description', () => {
    for (const p of listPresets()) {
      expect(PRESET_LABELS[p]).toBeTruthy();
      expect(PRESET_DESCRIPTIONS[p]).toBeTruthy();
    }
  });

  it('getPresetWeights returns a fresh object each call (no mutation leak)', () => {
    const a = getPresetWeights('growth');
    a.mom12_1 = 999;
    const b = getPresetWeights('growth');
    expect(b.mom12_1).not.toBe(999);
  });

  it('listPresets includes all 5 named goals including value', () => {
    expect(listPresets().sort()).toEqual([
      'balanced',
      'contrarian',
      'defensive',
      'growth',
      'value',
    ]);
  });

  it('value preset has strong load on pe, pb, roe, de', () => {
    const w = getPresetWeights('value');
    expect((w.pe ?? 0) + (w.pb ?? 0) + (w.roe ?? 0) + (w.de ?? 0)).toBeGreaterThan(0.7);
  });
});
