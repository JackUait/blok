import { describe, it, expect } from 'vitest';
import { COLOR_PRESETS, COLOR_PRESETS_DARK } from '../../../../src/components/shared/color-presets';

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

describe('COLOR_PRESETS_DARK', () => {
  it('exports 10 dark color presets', () => {
    expect(COLOR_PRESETS_DARK).toHaveLength(10);
  });

  it('has the same preset names in the same order as light presets', () => {
    const lightNames = COLOR_PRESETS.map((p) => p.name);
    const darkNames = COLOR_PRESETS_DARK.map((p) => p.name);

    expect(darkNames).toEqual(lightNames);
  });

  it('each dark preset has name, text, and bg as valid hex', () => {
    for (const preset of COLOR_PRESETS_DARK) {
      expect(preset.name).toBeTruthy();
      expect(preset.text).toMatch(/^#[0-9a-f]{6}$/i);
      expect(preset.bg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('dark preset colors differ from light preset colors', () => {
    for (let i = 0; i < COLOR_PRESETS.length; i++) {
      const light = COLOR_PRESETS[i];
      const dark = COLOR_PRESETS_DARK[i];

      expect(light.text !== dark.text || light.bg !== dark.bg).toBe(true);
    }
  });

  it('includes teal dark preset with correct hex values', () => {
    const teal = COLOR_PRESETS_DARK.find((p) => p.name === 'teal');

    expect(teal).toBeDefined();
    expect(teal?.text).toBe('#4dab9a');
    expect(teal?.bg).toBe('#2e4d4b');
  });
});
