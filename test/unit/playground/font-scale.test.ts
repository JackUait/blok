/**
 * Playground text-size slider.
 *
 * The slider multiplies every `style.fontSize` token by one scale factor. Two
 * consumers exist and MUST agree: `buildFontScaleConfig` feeds the real
 * `style.fontSize` config on (re)init, and `applyFontScale` writes the same
 * tokens live onto a holder while the slider is dragged (a reinit would destroy
 * the editor mid-drag). At 1× nothing is emitted at all, so the untouched
 * playground renders exactly as an editor built before the slider existed.
 */
import { describe, test, expect } from 'vitest';

import { buildFontScaleConfig, applyFontScale } from '../../../src/playground/font-scale';
import { buildFontSizeVarLines } from '../../../src/components/utils/font-size-tokens';

describe('playground font scale', () => {
  describe('buildFontScaleConfig', () => {
    test('emits nothing at 1x so defaults stay untouched', () => {
      expect(buildFontScaleConfig(1)).toBeUndefined();
    });

    test('scales each scenario from its own CSS default', () => {
      const config = buildFontScaleConfig(1.25);

      expect(config?.paragraph).toBe('calc(1em * 1.25)');
      expect(config?.heading?.['1']).toBe('calc(1.875rem * 1.25)');
      expect(config?.heading?.['6']).toBe('calc(0.875rem * 1.25)');
      expect(config?.quote?.large).toBe('calc(1.2em * 1.25)');
      expect(config?.code).toBe('calc(0.875rem * 1.25)');
      expect(config?.image?.caption).toBe('calc(13.5px * 1.25)');
      expect(config?.bookmark?.title).toBe('calc(14px * 1.25)');
    });

    test('covers every token in the font-size spec', () => {
      const lines = buildFontSizeVarLines(buildFontScaleConfig(0.8));

      // One `--token: value;` line per spec entry — no scenario left unscaled.
      expect(lines).toHaveLength(24);
      expect(lines.every((line) => line.includes('calc('))).toBe(true);
    });
  });

  describe('applyFontScale', () => {
    test('writes the same tokens the config would produce', () => {
      const holder = document.createElement('div');

      applyFontScale(holder, 1.5);

      expect(holder.style.getPropertyValue('--blok-paragraph-font-size')).toBe('calc(1em * 1.5)');
      expect(holder.style.getPropertyValue('--blok-heading-1-font-size')).toBe('calc(1.875rem * 1.5)');
    });

    test('clears the tokens at 1x instead of pinning the defaults inline', () => {
      const holder = document.createElement('div');

      applyFontScale(holder, 1.5);
      applyFontScale(holder, 1);

      expect(holder.style.getPropertyValue('--blok-paragraph-font-size')).toBe('');
      expect(holder.getAttribute('style')).toBe('');
    });

    test('tolerates a missing holder', () => {
      expect(() => applyFontScale(null, 1.25)).not.toThrow();
    });
  });
});
