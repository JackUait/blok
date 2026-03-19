import { describe, it, expect } from 'vitest';
import { COLOR_PRESETS, COLOR_PRESETS_DARK, colorVarName } from '../../../../src/components/shared/color-presets';

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('COLOR_PRESETS', () => {
  it('exports 9 color presets', () => {
    expect(COLOR_PRESETS).toHaveLength(9);
  });

  it('does not include teal (removed in favour of default swatch)', () => {
    const teal = COLOR_PRESETS.find((p) => p.name === 'teal');

    expect(teal).toBeUndefined();
  });

  it('has green positioned directly before blue', () => {
    const names = COLOR_PRESETS.map((p) => p.name);
    const greenIndex = names.indexOf('green');
    const blueIndex = names.indexOf('blue');

    expect(blueIndex).toBe(greenIndex + 1);
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
  it('exports 9 dark color presets', () => {
    expect(COLOR_PRESETS_DARK).toHaveLength(9);
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

  it('does not include teal dark preset (removed in favour of default swatch)', () => {
    const teal = COLOR_PRESETS_DARK.find((p) => p.name === 'teal');

    expect(teal).toBeUndefined();
  });

  it('each dark preset text on bg achieves at least 3.8:1 WCAG contrast ratio', () => {
    for (const preset of COLOR_PRESETS_DARK) {
      const cr = contrastRatio(preset.text, preset.bg);
      expect(cr, `${preset.name}: ${preset.text} on ${preset.bg}`).toBeGreaterThanOrEqual(3.8);
    }
  });
});

describe('colorVarName', () => {
  it('returns CSS var for text mode', () => {
    expect(colorVarName('red', 'text')).toBe('var(--blok-color-red-text)');
  });

  it('returns CSS var for bg mode', () => {
    expect(colorVarName('blue', 'bg')).toBe('var(--blok-color-blue-bg)');
  });

  it('handles all color names', () => {
    expect(colorVarName('gray', 'text')).toBe('var(--blok-color-gray-text)');
    expect(colorVarName('blue', 'bg')).toBe('var(--blok-color-blue-bg)');
  });
});
