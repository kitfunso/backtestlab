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
});
