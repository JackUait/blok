import { describe, it, expect } from 'vitest';
import { COLOR_PRESETS } from '../../../../src/components/shared/color-presets';

describe('COLOR_PRESETS', () => {
  it('exports 9 color presets', () => {
    expect(COLOR_PRESETS).toHaveLength(9);
  });

  it('each preset has name, text, and bg', () => {
    for (const preset of COLOR_PRESETS) {
      expect(preset.name).toBeTruthy();
      expect(preset.text).toMatch(/^#[0-9a-f]{6}$/i);
      expect(preset.bg).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
