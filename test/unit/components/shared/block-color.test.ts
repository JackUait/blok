import { describe, it, expect, vi } from 'vitest';
import {
  applyBlockColor,
  buildBlockColorTunes,
  BLOCK_COLOR_SANITIZE,
  type BlockColorData,
} from '../../../../src/components/shared/block-color';

const labels = { textColor: 'Text color', background: 'Background', default: 'Default' };

describe('block-color foundation', () => {
  describe('applyBlockColor', () => {
    it('sets text and background color via the shared CSS vars', () => {
      const el = document.createElement('div');

      applyBlockColor(el, { textColor: 'red', backgroundColor: 'blue' });

      expect(el.style.color).toBe('var(--blok-color-red-text)');
      expect(el.style.backgroundColor).toBe('var(--blok-color-blue-bg)');
    });

    it('clears styles when the field is absent (idempotent)', () => {
      const el = document.createElement('div');

      applyBlockColor(el, { textColor: 'green' });
      applyBlockColor(el, {});

      expect(el.style.color).toBe('');
      expect(el.style.backgroundColor).toBe('');
    });
  });

  describe('BLOCK_COLOR_SANITIZE', () => {
    it('declares the color data fields so they are preserved', () => {
      expect(BLOCK_COLOR_SANITIZE).toMatchObject({ textColor: false, backgroundColor: false });
    });
  });

  describe('buildBlockColorTunes', () => {
    it('returns Text color and Background submenus with Default + 9 swatches each', () => {
      const tunes = buildBlockColorTunes({ data: {}, labels, onPick: vi.fn() }) as Array<{
        title: string;
        children: { items: unknown[] };
      }>;

      expect(tunes).toHaveLength(2);
      expect(tunes[0].title).toBe('Text color');
      expect(tunes[1].title).toBe('Background');
      // Default + 9 presets
      expect(tunes[0].children.items).toHaveLength(10);
      expect(tunes[1].children.items).toHaveLength(10);
    });

    it('marks the active swatch from data and the Default when unset', () => {
      const tunes = buildBlockColorTunes({
        data: { textColor: 'purple' },
        labels,
        onPick: vi.fn(),
      }) as Array<{ children: { items: Array<{ title: string; isActive: () => boolean }> } }>;

      const textItems = tunes[0].children.items;
      const purple = textItems.find((i) => i.title === 'Purple');
      const def = textItems.find((i) => i.title === 'Default');
      const bgItems = tunes[1].children.items;
      const bgDefault = bgItems.find((i) => i.title === 'Default');

      expect(purple?.isActive()).toBe(true);
      expect(def?.isActive()).toBe(false);
      // background unset → its Default is active
      expect(bgDefault?.isActive()).toBe(true);
    });

    it('calls onPick with the field + preset name, and undefined for Default', () => {
      const onPick = vi.fn();
      const tunes = buildBlockColorTunes({ data: {}, labels, onPick }) as Array<{
        children: { items: Array<{ title: string; onActivate: () => void }> };
      }>;

      const bgItems = tunes[1].children.items;

      bgItems.find((i) => i.title === 'Red')?.onActivate();
      expect(onPick).toHaveBeenCalledWith('backgroundColor', 'red');

      bgItems.find((i) => i.title === 'Default')?.onActivate();
      expect(onPick).toHaveBeenCalledWith('backgroundColor', undefined);
    });
  });
});
