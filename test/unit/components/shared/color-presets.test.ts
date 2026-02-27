import { describe, it, expect } from 'vitest';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';

describe('COLOR_PRESETS', () => {
  it('exports 10 color presets', () => {
    expect(COLOR_PRESETS).toHaveLength(10);
  });

  it('includes teal preset with correct hex values', () => {
    const teal = COLOR_PRESETS.find((p) => p.name === 'teal');

    expect(teal).toBeDefined();
    expect(teal?.text).toBe('#2b9a8f');
    expect(teal?.bg).toBe('#e4f5f3');
  });

  it('has teal positioned between green and blue', () => {
    const names = COLOR_PRESETS.map((p) => p.name);
    const greenIndex = names.indexOf('green');
    const tealIndex = names.indexOf('teal');
    const blueIndex = names.indexOf('blue');

    expect(greenIndex).toBeLessThan(tealIndex);
    expect(tealIndex).toBeLessThan(blueIndex);
  });

  it('each preset has name, text, and bg', () => {
    for (const preset of COLOR_PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.text).toMatch(/^#[0-9a-f]{6}$/i);
      expect(preset.bg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
